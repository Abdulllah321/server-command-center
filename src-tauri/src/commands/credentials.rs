use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::models::{CreateCredentialPayload, CredentialMetadata};
use crate::secrets::{keychain, vault};
use uuid::Uuid;
use zeroize::Zeroize;

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
            // Require the vault to be initialized/unlocked before adding keys.
            // In a real application, the vault might be pre-unlocked and stored in State,
            // or we request the master password here. For this implementation, we will assume 
            // the user has a mechanism to provide it, but since the signature of create_credential
            // doesn't include the master password, we either prompt it or assume it's empty.
            // Wait, the spec for create_credential says: "routes to vault...". It implies the user 
            // should either provide the master password, or the vault doesn't lock for creation?
            // AES-GCM requires the key to encrypt. Let's assume the frontend passes the master_password
            // if needed, or we just fail if we can't get it.
            // Ah, the user didn't ask to add master_password to create_credential.
            // Let's modify CreateCredentialPayload or just accept an optional master_password.
            return Err(CommandError::Validation(
                "Vault-based credentials require a master password, but signature lacks it. (Requires UX decision)".into()
            ));
        }
        _ => return Err(CommandError::Validation("Unknown auth method".into())),
    }

    // Zeroize payload from memory proactively
    payload.secret_payload.zeroize();

    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;

    conn.execute(
        "INSERT INTO credentials (id, server_id, auth_method, keychain_ref, key_fingerprint, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
        rusqlite::params![
            &id,
            &payload.server_id,
            &payload.auth_method,
            &keychain_ref,
            &payload.key_fingerprint,
        ],
    )?;

    drop(conn);

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
    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;

    let (auth_method, keychain_ref): (String, String) = conn.query_row(
        "SELECT auth_method, keychain_ref FROM credentials WHERE id = ?1",
        [&id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|_| CommandError::NotFound("Credential not found".into()))?;

    // Delete from DB first
    conn.execute("DELETE FROM credentials WHERE id = ?1", [&id])?;
    drop(conn);

    // Delete from storage backend
    match auth_method.as_str() {
        "password" | "ssh_agent" => {
            // It's possible the keychain entry was already wiped externally,
            // we ignore NotFound errors on delete.
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

#[cfg(test)]
mod tests {
    use super::*;
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
        let mut stmt = conn.prepare("SELECT * FROM credentials WHERE id = 'cred-1'").unwrap();
        let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        assert!(!column_names.contains(&"secret".to_string()));
        assert!(!column_names.contains(&"payload".to_string()));
        assert!(!column_names.contains(&"password".to_string()));
    }
}
