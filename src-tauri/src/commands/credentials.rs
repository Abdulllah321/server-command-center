use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::models::{CreateCredentialPayload, CredentialMetadata};
use crate::secrets::{keychain, vault};
use crate::secrets::windows_hello::{self, WindowsHelloStatus};
use crate::db::{log_activity, ActivityEntry, actions};
use uuid::Uuid;
use zeroize::Zeroize;
use std::time::Instant;
use tauri::Manager;

/// Creates a new credential, writing the raw payload to the appropriate backend,
/// and the metadata to SQLite.
#[tauri::command]
pub async fn create_credential(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    mut payload: CreateCredentialPayload,
) -> CommandResult<CredentialMetadata> {
    if payload.server_id.is_empty() {
        return Err(CommandError::Validation("Server ID required".into()));
    }
    if payload.secret_payload.is_empty() {
        return Err(CommandError::Validation("Secret payload required".into()));
    }

    let id = Uuid::new_v4().to_string();
    let keychain_ref = format!("scc:credential:{}", id);

    // Route to appropriate backend
    // Decision (from Task 8/9): 'password' & 'ssh_agent' fit nicely into OS Keychains.
    // 'private_key' & 'password_key' are stored in the AES Vault to avoid multi-line length 
    // limitations or cross-platform inconsistencies in native OS keychains.
    match payload.auth_method.as_str() {
        "password" | "ssh_agent" => {
            keychain::store_secret(&keychain_ref, &payload.secret_payload)?;
        }
        "private_key" | "password_key" => {
            let password = payload.master_password
                .as_deref()
                .ok_or_else(|| CommandError::Validation("Master password required to unlock vault for saving credential".into()))?;
            let app_dir = app_handle.path().app_data_dir().expect("App data dir not found");
            let vault_handle = vault::unlock(password, &app_dir)?;
            vault::store_entry(&vault_handle, &keychain_ref, &payload.secret_payload)?;
        }
        _ => return Err(CommandError::Validation("Unknown auth method".into())),
    }

    // Zeroize payload from memory proactively
    payload.secret_payload.zeroize();
    if let Some(mut mp) = payload.master_password.take() {
        mp.zeroize();
    }

    let start = Instant::now();
    {
        let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;

        // Remove previous credentials for this server and auth method
        let _ = conn.execute("DELETE FROM credentials WHERE server_id = ?1 AND auth_method = ?2", [&payload.server_id, &payload.auth_method]);

        let res = conn.execute(
            "INSERT INTO credentials (id, server_id, auth_method, keychain_ref, key_fingerprint, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
            rusqlite::params![
                &id,
                &payload.server_id,
                &payload.auth_method,
                &keychain_ref,
                &payload.key_fingerprint,
            ],
        );
        let status = if res.is_ok() { "success" } else { "failed" };
        log_activity(&conn, ActivityEntry {
            server_id: Some(payload.server_id.clone()),
            action: actions::CREATE_CREDENTIAL.into(),
            target: Some(format!("{} ({})", payload.auth_method, keychain_ref)),
            status: status.into(),
            detail: res.as_ref().err().map(|e| e.to_string()),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
        res?;
    }

    get_credential_metadata(state, id).await
}

/// Retrieves metadata only, no secrets.
#[tauri::command]
pub async fn get_credential_metadata(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<CredentialMetadata> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;

    let meta = conn.query_row(
        "SELECT id, server_id, auth_method, key_fingerprint, created_at FROM credentials WHERE id = ?1",
        [&id],
        |row| {
            Ok(CredentialMetadata {
                id: row.get(0)?,
                server_id: row.get(1)?,
                auth_method: row.get(2)?,
                key_fingerprint: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    ).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => CommandError::NotFound("Credential not found".into()),
        _ => CommandError::Database(e.to_string()),
    })?;

    Ok(meta)
}

/// Retrieves all credentials metadata, joining the server name
#[tauri::command]
pub async fn list_credentials_metadata(
    state: tauri::State<'_, AppState>,
) -> CommandResult<Vec<crate::models::CredentialMetadataExtended>> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;

    let mut stmt = conn.prepare(
        "SELECT c.id, c.server_id, s.name as server_name, c.auth_method, c.key_fingerprint, c.created_at 
         FROM credentials c
         JOIN servers s ON c.server_id = s.id
         ORDER BY c.created_at DESC"
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(crate::models::CredentialMetadataExtended {
            id: row.get(0)?,
            server_id: row.get(1)?,
            server_name: row.get(2)?,
            auth_method: row.get(3)?,
            key_fingerprint: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;

    let mut credentials = Vec::new();
    for row in rows {
        credentials.push(row?);
    }

    Ok(credentials)
}

/// The ONLY path that returns a decrypted secret.
#[tauri::command]
pub async fn reveal_credential(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    id: String,
    master_password_if_needed: Option<String>,
) -> CommandResult<String> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;

    let (auth_method, keychain_ref): (String, String) = conn.query_row(
        "SELECT auth_method, keychain_ref FROM credentials WHERE id = ?1",
        [&id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|_| CommandError::NotFound("Credential not found".into()))?;

    drop(conn);

    match auth_method.as_str() {
        "password" | "ssh_agent" => {
            let secret = keychain::read_secret(&keychain_ref)?;
            Ok(secret)
        }
        "private_key" | "password_key" => {
            let password = master_password_if_needed
                .ok_or_else(|| CommandError::Validation("Master password required to unlock vault".into()))?;
                
            let app_dir = app_handle.path().app_data_dir().expect("App data dir not found");
            let vault_handle = vault::unlock(&password, &app_dir)?;
            let secret = vault::read_entry(&vault_handle, &keychain_ref)?;
            Ok(secret)
        }
        _ => Err(CommandError::Internal("Unknown auth method in database".into())),
    }
}

/// Deletes the credential from SQLite AND the backing storage.
#[tauri::command]
pub async fn delete_credential(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    id: String,
    master_password_if_needed: Option<String>,
) -> CommandResult<()> {
    let start = Instant::now();
    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;

    let (auth_method, keychain_ref): (String, String) = conn.query_row(
        "SELECT auth_method, keychain_ref FROM credentials WHERE id = ?1",
        [&id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|_| CommandError::NotFound("Credential not found".into()))?;

    let server_id: Option<String> = conn.query_row(
        "SELECT server_id FROM credentials WHERE id = ?1",
        [&id],
        |row| row.get(0),
    ).ok();

    // Delete from DB first
    let del_res = conn.execute("DELETE FROM credentials WHERE id = ?1", [&id]);
    let status = if del_res.is_ok() { "success" } else { "failed" };
    log_activity(&conn, ActivityEntry {
        server_id,
        action: actions::DELETE_CREDENTIAL.into(),
        target: Some(format!("{} ({})", auth_method, id)),
        status: status.into(),
        detail: del_res.as_ref().err().map(|e| e.to_string()),
        duration_ms: Some(start.elapsed().as_millis() as i64),
    });
    del_res?;
    drop(conn);

    // Delete from storage backend
    match auth_method.as_str() {
        "password" | "ssh_agent" => {
            let _ = keychain::delete_secret(&keychain_ref);
        }
        "private_key" | "password_key" => {
            if let Some(password) = master_password_if_needed {
                let app_dir = app_handle.path().app_data_dir().expect("App data dir not found");
                if let Ok(vault_handle) = vault::unlock(&password, &app_dir) {
                    let _ = vault::delete_entry(&vault_handle, &keychain_ref);
                }
            }
        }
        _ => {}
    }

    Ok(())
}

/// Checks if vault.json exists on disk
#[tauri::command]
pub async fn is_vault_initialized(
    app_handle: tauri::AppHandle,
) -> CommandResult<bool> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| CommandError::Internal(e.to_string()))?;
    Ok(app_dir.join("vault.json").exists())
}

/// Validates master password and verifies/initializes the vault
#[tauri::command]
pub async fn unlock_vault(
    app_handle: tauri::AppHandle,
    mut password: String,
) -> CommandResult<bool> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| CommandError::Internal(e.to_string()))?;
    let res = vault::unlock(&password, &app_dir);
    password.zeroize();
    match res {
        Ok(_) => Ok(true),
        Err(e) => Err(e.into()),
    }
}

/// Initializes master password setup for the vault
#[tauri::command]
pub async fn setup_vault(
    app_handle: tauri::AppHandle,
    mut password: String,
) -> CommandResult<()> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| CommandError::Internal(e.to_string()))?;
    let res = vault::unlock(&password, &app_dir);
    password.zeroize();
    res.map(|_| ()).map_err(Into::into)
}

const WINDOWS_HELLO_KEY_REF: &str = "scc:vault:windows_hello_key";

/// Checks if Windows Hello biometric authentication is supported and enabled for this vault
#[tauri::command]
pub async fn check_windows_hello() -> CommandResult<WindowsHelloStatus> {
    let supported = windows_hello::is_available().await;
    let enabled = if supported {
        keychain::read_secret(WINDOWS_HELLO_KEY_REF).is_ok()
    } else {
        false
    };

    Ok(WindowsHelloStatus {
        supported,
        enrolled: supported,
        enabled,
    })
}

/// Enrolls Windows Hello: verifies master password, prompts user for biometric verification,
/// and securely stores the master password in the OS Keychain protected entry.
#[tauri::command]
pub async fn enable_windows_hello(
    app_handle: tauri::AppHandle,
    mut password: String,
) -> CommandResult<bool> {
    if password.is_empty() {
        return Err(CommandError::Validation("Master password cannot be empty".into()));
    }

    let supported = windows_hello::is_available().await;
    if !supported {
        return Err(CommandError::Forbidden("Windows Hello biometric verification is not available on this device".into()));
    }

    // Verify master password unlocks the vault
    let app_dir = app_handle.path().app_data_dir().map_err(|e| CommandError::Internal(e.to_string()))?;
    vault::unlock(&password, &app_dir)?;

    // Biometric confirmation prompt
    windows_hello::request_user_consent("Verify your identity with Windows Hello to enable biometric unlock for Server Command Center").await?;

    // Store in OS keychain
    keychain::store_secret(WINDOWS_HELLO_KEY_REF, &password)?;
    password.zeroize();

    Ok(true)
}

/// Disables Windows Hello unlock by removing the vault key from the OS keychain
#[tauri::command]
pub async fn disable_windows_hello() -> CommandResult<()> {
    let _ = keychain::delete_secret(WINDOWS_HELLO_KEY_REF);
    Ok(())
}

/// Prompts Windows Hello biometric verification and, if verified, retrieves the master password from OS keychain
#[tauri::command]
pub async fn unlock_vault_with_windows_hello(
    app_handle: tauri::AppHandle,
) -> CommandResult<String> {
    // 1. Check if Windows Hello key exists in Keychain
    let stored_pw = keychain::read_secret(WINDOWS_HELLO_KEY_REF)
        .map_err(|_| CommandError::Forbidden("Windows Hello biometric unlock is not enabled".into()))?;

    // 2. Request user biometric verification
    windows_hello::request_user_consent("Verify your identity with Windows Hello to unlock Server Command Center Vault").await?;

    // 3. Verify vault unlocks with the stored password
    let app_dir = app_handle.path().app_data_dir().map_err(|e| CommandError::Internal(e.to_string()))?;
    vault::unlock(&stored_pw, &app_dir)?;

    Ok(stored_pw)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    #[test]
    fn test_db_inserts_only_metadata() {
        let conn = Connection::open_in_memory().unwrap();
        let init_sql = include_str!("../db/migrations/0001_init.sql");
        conn.execute_batch(init_sql).unwrap();

        // Insert a dummy server for the foreign key
        conn.execute(
            "INSERT INTO servers (id, name, hostname, ssh_port, username, environment, created_at, updated_at)
             VALUES ('server-1', 'Test', 'localhost', 22, 'root', 'dev', datetime('now'), datetime('now'))",
            [],
        ).unwrap();

        let id = "cred-1";
        let keychain_ref = "scc:credential:cred-1";

        conn.execute(
            "INSERT INTO credentials (id, server_id, auth_method, keychain_ref, created_at)
             VALUES (?1, ?2, ?3, ?4, datetime('now'))",
            rusqlite::params![id, "server-1", "password", keychain_ref],
        ).unwrap();

        // Verify the raw secret isn't in this table
        let stmt = conn.prepare("SELECT * FROM credentials WHERE id = 'cred-1'").unwrap();
        let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        assert!(!column_names.contains(&"secret".to_string()));
        assert!(!column_names.contains(&"payload".to_string()));
        assert!(!column_names.contains(&"password".to_string()));
    }
}
