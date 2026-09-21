use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::secrets::{keychain, vault};
use crate::db::{log_activity, ActivityEntry};
use std::process::Command;
use std::time::Instant;
use std::io::Write;

#[tauri::command]
pub async fn open_external_ssh(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    terminal_preference: String,
    master_password_if_needed: Option<String>,
) -> CommandResult<()> {
    if terminal_preference == "integrated" {
        return Ok(()); // Handled entirely by frontend navigation
    }

    let start = Instant::now();

    // 1. Fetch server info
    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
    
    let server_details: (String, u16, String, String) = conn.query_row(
        "SELECT hostname, ssh_port, username, id FROM servers WHERE id = ?1",
        [&server_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).map_err(|_| CommandError::NotFound("Server not found".into()))?;
    
    let (hostname, ssh_port, username, _id) = server_details;

    // We assume the first credential is the active one, or we fetch the most recently used/default
    // For simplicity, we just grab the first one bound to this server (similar to test_connection but without specifying auth_method strictly upfront)
    let cred_details: Result<(String, String), _> = conn.query_row(
        "SELECT auth_method, keychain_ref FROM credentials WHERE server_id = ?1 LIMIT 1",
        [&server_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    );

    drop(conn);

    let mut temp_key_path = None;

    if let Ok((auth_method, keychain_ref)) = cred_details {
        match auth_method.as_str() {
            "private_key" | "password_key" => {
                let password = master_password_if_needed
                    .ok_or_else(|| CommandError::Validation("Master password required for private key".into()))?;
                let app_dir = app_handle.path().app_data_dir().expect("App data dir not found");
                let vault_handle = vault::unlock(&password, &app_dir)?;
                let secret = vault::read_entry(&vault_handle, &keychain_ref)?;
                
                // Write to temp file
                let mut temp_file = tempfile::Builder::new()
                    .prefix("veyra_key_")
                    .tempfile()
                    .map_err(|e| CommandError::Internal(format!("Failed to create temp file: {}", e)))?;
                
                temp_file.write_all(secret.as_bytes())
                    .map_err(|e| CommandError::Internal(format!("Failed to write temp key: {}", e)))?;
                
                // Keep the temp file alive by extracting the path, but we will leak it or delete it later.
                // Best practice for native external spawn is keeping the file until the process spawns.
                let path = temp_file.into_temp_path();
                temp_key_path = Some(path);
            }
            _ => {} // Passwords rely on interactive prompt
        }
    }

    // 2. Build the SSH command
    let mut ssh_args = vec![
        "-p".to_string(),
        ssh_port.to_string(),
        format!("{}@{}", username, hostname),
    ];

    if let Some(path) = &temp_key_path {
        ssh_args.insert(0, path.to_string_lossy().to_string());
        ssh_args.insert(0, "-i".to_string());
    }

    // 3. Spawn external terminal
    let res = match terminal_preference.as_str() {
        "windows_terminal" => {
            let mut args = vec!["ssh"];
            args.extend(ssh_args.iter().map(|s| s.as_str()));
            
            Command::new("wt")
                .args(&args)
                .spawn()
                .map_err(|e| CommandError::Internal(format!("Failed to launch Windows Terminal: {}", e)))
        }
        "powershell" => {
            // we launch powershell and tell it to run ssh
            let ssh_cmd = format!("ssh {}", ssh_args.join(" "));
            Command::new("powershell")
                .args(["-NoProfile", "-Command", &ssh_cmd])
                .spawn()
                .map_err(|e| CommandError::Internal(format!("Failed to launch PowerShell: {}", e)))
        }
        _ => Err(CommandError::Validation("Unknown terminal preference".into()))
    };

    // Note: temp_key_path (TempPath) will automatically delete the file when it goes out of scope here.
    // However, if the external process hasn't read it yet, it might fail. 
    // Wait for the spawn to complete, then we sleep briefly just to let ssh read the key before deletion.
    if temp_key_path.is_some() {
        tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
    }

    let status = if res.is_ok() { "success" } else { "failed" };
    let detail = res.as_ref().err().map(|e| e.to_string());

    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
    log_activity(&conn, ActivityEntry {
        server_id: Some(server_id.clone()),
        action: "open_external_ssh".into(),
        target: Some(terminal_preference),
        status: status.into(),
        detail,
        duration_ms: Some(start.elapsed().as_millis() as i64),
    });

    res.map(|_| ())
}
