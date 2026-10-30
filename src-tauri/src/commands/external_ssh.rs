use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::secrets::{keychain, vault};
use crate::db::{log_activity, ActivityEntry};
use std::process::Command;
use std::time::Instant;
use std::io::Write;
use tauri::Manager;
use zeroize::Zeroizing;

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
    let (server_details, cred_details) = {
        let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
        
        let server_details: (String, u16, String, String) = conn.query_row(
            "SELECT hostname, ssh_port, username, id FROM servers WHERE id = ?1",
            [&server_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).map_err(|_| CommandError::NotFound("Server not found".into()))?;
        
        let cred_details: Result<(String, String), _> = conn.query_row(
            "SELECT auth_method, keychain_ref FROM credentials WHERE server_id = ?1 LIMIT 1",
            [&server_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        
        (server_details, cred_details)
    };
    
    let (hostname, ssh_port, username, _id) = server_details;
    let mut temp_key_path = None;
    let mut temp_askpass_path = None;
    let mut askpass_password_env: Option<Zeroizing<String>> = None;

    if let Ok((auth_method, keychain_ref)) = cred_details {
        match auth_method.as_str() {
            "password" => {
                if let Ok(secret) = keychain::read_secret(&keychain_ref) {
                    let mut temp_file = tempfile::Builder::new()
                        .prefix("veyra_askpass_")
                        .suffix(".cmd")
                        .tempfile()
                        .map_err(|e| CommandError::Internal(format!("Failed to create askpass script: {}", e)))?;
                    
                    // Script outputs the password stored in environment variable %_VEYRA_SSH_PASS%
                    let script = "@echo off\r\necho %_VEYRA_SSH_PASS%\r\n";
                    temp_file.write_all(script.as_bytes())
                        .map_err(|e| CommandError::Internal(format!("Failed to write askpass script: {}", e)))?;
                    
                    temp_askpass_path = Some(temp_file.into_temp_path());
                    askpass_password_env = Some(Zeroizing::new(secret));
                }
            }
            "private_key" | "password_key" => {
                let password = master_password_if_needed
                    .ok_or_else(|| CommandError::Validation("Master password required for private key".into()))?;
                let app_dir = app_handle.path().app_data_dir().expect("App data dir not found");
                let vault_handle = vault::unlock(&password, &app_dir)?;
                let secret = Zeroizing::new(vault::read_entry(&vault_handle, &keychain_ref)?);
                
                // Write to temp file
                let mut temp_file = tempfile::Builder::new()
                    .prefix("veyra_key_")
                    .tempfile()
                    .map_err(|e| CommandError::Internal(format!("Failed to create temp file: {}", e)))?;
                
                temp_file.write_all(secret.as_bytes())
                    .map_err(|e| CommandError::Internal(format!("Failed to write temp key: {}", e)))?;
                
                let path = temp_file.into_temp_path();
                temp_key_path = Some(path);
            }
            _ => {}
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

    // Helper to configure askpass environment for automatic password authentication
    let apply_env = |cmd: &mut Command| {
        if let Some(ref askpass) = temp_askpass_path {
            cmd.env("SSH_ASKPASS", askpass.to_str().unwrap_or_default());
            cmd.env("SSH_ASKPASS_REQUIRE", "force");
            cmd.env("DISPLAY", "dummy:0");
            if let Some(ref pass) = askpass_password_env {
                cmd.env("_VEYRA_SSH_PASS", &**pass);
            }
        }
    };

    // 3. Spawn external terminal
    let res = match terminal_preference.as_str() {
        "windows_terminal" => {
            let mut args = vec!["ssh"];
            args.extend(ssh_args.iter().map(|s| s.as_str()));
            
            let mut cmd = Command::new("wt");
            cmd.args(&args);
            apply_env(&mut cmd);
            cmd.spawn()
                .map_err(|e| CommandError::Internal(format!("Failed to launch Windows Terminal: {}", e)))
        }
        "powershell" => {
            // we launch powershell and tell it to run ssh
            let ssh_cmd = format!("ssh {}", ssh_args.join(" "));
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-Command", &ssh_cmd]);
            apply_env(&mut cmd);
            cmd.spawn()
                .map_err(|e| CommandError::Internal(format!("Failed to launch PowerShell: {}", e)))
        }
        _ => Err(CommandError::Validation("Unknown terminal preference".into()))
    };

    // Note: temp files will automatically be deleted when they go out of scope.
    // Give external SSH process 3.5 seconds to read key/askpass before deletion.
    if temp_key_path.is_some() || temp_askpass_path.is_some() {
        tokio::time::sleep(tokio::time::Duration::from_millis(3500)).await;
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
