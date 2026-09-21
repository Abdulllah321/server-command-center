use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::secrets::{keychain, vault};
use crate::ssh::exec::test_connection as ssh_test_connection;
use crate::db::{log_activity, ActivityEntry};
use std::time::Instant;

#[tauri::command]
pub async fn test_connection(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    auth_method: String,
    master_password_if_needed: Option<String>,
) -> CommandResult<()> {
    if server_id.is_empty() {
        return Err(CommandError::Validation("Server ID required".into()));
    }

    let start = Instant::now();

    // 1. Fetch server & credential info
    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
    
    let server_details: (String, u16, String) = conn.query_row(
        "SELECT hostname, ssh_port, username FROM servers WHERE id = ?1",
        [&server_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).map_err(|_| CommandError::NotFound("Server not found".into()))?;
    
    let (hostname, ssh_port, username) = server_details;

    let keychain_ref: String = conn.query_row(
        "SELECT keychain_ref FROM credentials WHERE server_id = ?1 AND auth_method = ?2",
        [&server_id, &auth_method],
        |row| row.get(0),
    ).map_err(|_| CommandError::NotFound("Credential not found for this auth method".into()))?;
    
    drop(conn);

    // 2. Fetch decrypted secret
    let secret = match auth_method.as_str() {
        "password" | "ssh_agent" => {
            keychain::read_secret(&keychain_ref)?
        }
        "private_key" | "password_key" => {
            let password = master_password_if_needed
                .ok_or_else(|| CommandError::Validation("Master password required".into()))?;
            let app_dir = app_handle.path().app_data_dir().expect("App data dir not found");
            let vault_handle = vault::unlock(&password, &app_dir)?;
            vault::read_entry(&vault_handle, &keychain_ref)?
        }
        _ => return Err(CommandError::Internal("Unknown auth method".into())),
    };

    // 3. Execute SSH connection
    let res = ssh_test_connection(&hostname, ssh_port, &username, &auth_method, secret).await;

    // 4. Audit Log
    let status = if res.is_ok() { "success" } else { "failed" };
    let detail = res.as_ref().err().map(|e| e.to_string());
    
    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
    log_activity(&conn, ActivityEntry {
        server_id: Some(server_id.clone()),
        action: "test_ssh_connection".into(),
        target: None,
        status: status.into(),
        detail,
        duration_ms: Some(start.elapsed().as_millis() as i64),
    });

    res
}
