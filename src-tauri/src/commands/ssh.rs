use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::secrets::{keychain, vault};
use crate::ssh::exec::test_connection as ssh_test_connection;
use crate::db::{log_activity, ActivityEntry};
use std::time::Instant;
use tauri::Manager;

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
    let (server_name, hostname, ssh_port, username, keychain_ref) = {
        let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
        
        let server_details: (String, String, u16, String) = conn.query_row(
            "SELECT name, hostname, ssh_port, username FROM servers WHERE id = ?1",
            [&server_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).map_err(|_| CommandError::NotFound("Server not found".into()))?;
        
        let (server_name, hostname, ssh_port, username) = server_details;

        let keychain_ref: String = conn.query_row(
            "SELECT keychain_ref FROM credentials WHERE server_id = ?1 AND auth_method = ?2",
            [&server_id, &auth_method],
            |row| row.get(0),
        ).map_err(|_| CommandError::NotFound("Credential not found for this auth method".into()))?;
        
        (server_name, hostname, ssh_port, username, keychain_ref)
    };

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
    let res = ssh_test_connection(
        server_id.clone(),
        Some(server_name),
        &hostname,
        ssh_port,
        &username,
        &auth_method,
        secret,
        app_handle.clone(),
        state.db.clone(),
        state.session_manager.pending_verifications.clone(),
        state.session_manager.trusted_host_keys.clone(),
    ).await;

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

#[tauri::command]
pub async fn resolve_host_key_verification(
    state: tauri::State<'_, AppState>,
    server_id: String,
    accepted: bool,
) -> CommandResult<()> {
    let mut pending = state.session_manager.pending_verifications.lock().await;
    if let Some(tx) = pending.remove(&server_id) {
        let _ = tx.send(accepted);
    }
    Ok(())
}

#[tauri::command]
pub async fn reconnect_server(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<()> {
    log::info!("Manual reconnect requested for server {}", server_id);
    state.session_manager.evict_session(&server_id).await;
    let _ = state.session_manager
        .get_or_connect(server_id, state.db.clone(), app_handle)
        .await?;
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct DirectTestConnectionPayload {
    pub server_id: Option<String>,
    pub server_name: Option<String>,
    pub hostname: String,
    pub ssh_port: u16,
    pub username: String,
    pub auth_method: String,
    pub secret_payload: String,
}

#[tauri::command]
pub async fn test_direct_connection(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    payload: DirectTestConnectionPayload,
) -> CommandResult<()> {
    if payload.hostname.trim().is_empty() {
        return Err(CommandError::Validation("Hostname/IP required".into()));
    }
    if payload.username.trim().is_empty() {
        return Err(CommandError::Validation("SSH Username required".into()));
    }
    if payload.secret_payload.trim().is_empty() && payload.auth_method != "ssh_agent" {
        return Err(CommandError::Validation("Password or Private Key required".into()));
    }

    let test_server_id = payload.server_id.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| format!("test-{}", uuid::Uuid::new_v4()));
    
    ssh_test_connection(
        test_server_id,
        payload.server_name,
        &payload.hostname,
        payload.ssh_port,
        &payload.username,
        &payload.auth_method,
        payload.secret_payload,
        app_handle,
        state.db.clone(),
        state.session_manager.pending_verifications.clone(),
        state.session_manager.trusted_host_keys.clone(),
    ).await
}



