use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::db::{log_activity, ActivityEntry, actions};
use serde::{Deserialize, Serialize};
use std::time::Instant;
use russh::ChannelMsg;
use tokio::time::{timeout, Duration};
use crate::ssh::client::SshClientHandler;
use russh::client::Handle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pm2Process {
    pub pm_id: u32,
    pub name: String,
    pub status: String,
    pub cpu: f64,
    pub memory: u64,
    pub restarts: u32,
    pub uptime: u64,
    pub script_path: String,
    pub pm_cwd: Option<String>,
    pub pm_err_log_path: Option<String>,
    pub env: Option<serde_json::Value>,
}

// Inner structs for deserializing `pm2 jlist`
#[derive(Deserialize)]
struct Pm2JlistEntry {
    pm_id: u32,
    name: String,
    pm2_env: Pm2Env,
    monit: Option<Pm2Monit>,
}

#[derive(Deserialize)]
struct Pm2Env {
    status: String,
    restart_time: u32,
    pm_uptime: u64,
    pm_exec_path: String,
    pm_cwd: Option<String>,
    pm_err_log_path: Option<String>,
    env: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct Pm2Monit {
    memory: u64,
    cpu: f64,
}

/// Executes a shell command on the pooled SSH session, returning its stdout.
async fn exec_ssh_command(
    session: &mut Handle<SshClientHandler>,
    cmd: &str,
) -> Result<String, CommandError> {
    let mut channel = session.channel_open_session().await
        .map_err(|e| CommandError::Internal(format!("Failed to open SSH channel: {}", e)))?;

    channel.exec(true, cmd).await
        .map_err(|e| CommandError::Internal(format!("Failed to exec command '{}': {}", cmd, e)))?;

    let mut output = String::new();
    let timeout_duration = Duration::from_secs(10);
    
    loop {
        let msg_future = channel.wait();
        let msg_opt = match timeout(timeout_duration, msg_future).await {
            Ok(opt) => opt,
            Err(_) => {
                let _ = channel.close().await;
                return Err(CommandError::Internal("SSH command timed out".into()));
            }
        };

        match msg_opt {
            Some(ChannelMsg::Data { ref data }) => {
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                break;
            }
            _ => {}
        }
    }
    
    let _ = channel.close().await;
    Ok(output)
}

#[tauri::command]
pub async fn list_processes(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<Vec<Pm2Process>> {
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    
    let output_res = {
        let mut session = session_arc.lock().await;
        exec_ssh_command(&mut session, "pm2 jlist").await
    };

    let output = match output_res {
        Ok(out) => out,
        Err(e) => {
            let err_str = e.to_string();
            if err_str.contains("ConnectFailed") || err_str.contains("Failed to open SSH channel") || err_str.contains("closed") {
                log::warn!("PM2 SSH channel failed ({}), reconnecting...", err_str);
                state.session_manager.evict_session(&server_id).await;
                let new_session_arc = state.session_manager
                    .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
                    .await?;
                let mut new_session = new_session_arc.lock().await;
                exec_ssh_command(&mut new_session, "pm2 jlist").await?
            } else {
                return Err(e);
            }
        }
    };

    if output.trim().is_empty() {
        return Err(CommandError::Internal("PM2 not found or empty output (ensure PM2 is in PATH)".into()));
    }

    let parsed: Vec<Pm2JlistEntry> = serde_json::from_str(&output).map_err(|_| {
        if output.contains("command not found") {
            CommandError::Internal("PM2 not found on this server".into())
        } else {
            CommandError::Internal("Failed to parse PM2 output".into())
        }
    })?;

    let mut result = Vec::new();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or(Duration::ZERO).as_millis() as u64;

    for entry in parsed {
        // PM2 uptime is often an absolute timestamp in ms. We convert it to seconds elapsed.
        let uptime_ms = entry.pm2_env.pm_uptime;
        let uptime_secs = if uptime_ms > 0 && now > uptime_ms {
            (now - uptime_ms) / 1000
        } else {
            0
        };

        let mut env_redacted = entry.pm2_env.env.clone();
        if let Some(serde_json::Value::Object(ref mut map)) = env_redacted {
            for (k, v) in map.iter_mut() {
                let k_lower = k.to_lowercase();
                let is_sensitive_key = k_lower.contains("secret")
                    || k_lower.contains("password")
                    || k_lower.contains("token")
                    || k_lower.contains("key")
                    || k_lower.contains("pass")
                    || k_lower.contains("auth")
                    || k_lower.contains("cred")
                    || k_lower.contains("private")
                    || k_lower.contains("hash")
                    || k_lower.contains("salt")
                    || k_lower.contains("cookie")
                    || k_lower.contains("jwt")
                    || k_lower.contains("api")
                    || k_lower.contains("cert")
                    || k_lower.contains("database_url")
                    || k_lower.contains("db_pass")
                    || k_lower.contains("conn_str")
                    || k_lower.contains("dsn")
                    || k_lower.contains("webhook")
                    || k_lower.contains("session");

                if is_sensitive_key {
                    *v = serde_json::Value::String("***REDACTED***".to_string());
                } else if let serde_json::Value::String(ref val_str) = v {
                    *v = serde_json::Value::String(crate::secrets::redact::redact_secrets(val_str));
                }
            }
        }

        result.push(Pm2Process {
            pm_id: entry.pm_id,
            name: entry.name,
            status: entry.pm2_env.status,
            cpu: entry.monit.as_ref().map(|m| m.cpu).unwrap_or(0.0),
            memory: entry.monit.as_ref().map(|m| m.memory).unwrap_or(0),
            restarts: entry.pm2_env.restart_time,
            uptime: uptime_secs,
            script_path: entry.pm2_env.pm_exec_path,
            pm_cwd: entry.pm2_env.pm_cwd,
            pm_err_log_path: entry.pm2_env.pm_err_log_path,
            env: env_redacted,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn start_process(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    process_id: String,
) -> CommandResult<()> {
    execute_pm2_action(state, app_handle, server_id, "start", process_id, false, None).await
}

#[tauri::command]
pub async fn stop_process(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    process_id: String,
) -> CommandResult<()> {
    execute_pm2_action(state, app_handle, server_id, "stop", process_id, false, None).await
}

#[tauri::command]
pub async fn restart_process(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    process_id: String,
) -> CommandResult<()> {
    execute_pm2_action(state, app_handle, server_id, "restart", process_id, false, None).await
}

#[tauri::command]
pub async fn reload_process(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    process_id: String,
) -> CommandResult<()> {
    execute_pm2_action(state, app_handle, server_id, "reload", process_id, false, None).await
}

#[tauri::command]
pub async fn delete_process(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    process_id: String,
    confirmation_token: Option<String>,
) -> CommandResult<()> {
    crate::commands::confirmation::consume_token(confirmation_token.as_deref()).await?;
    execute_pm2_action(state, app_handle, server_id, "delete", process_id, true, None).await
}

#[tauri::command]
pub async fn save_processes(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<()> {
    execute_pm2_action(state, app_handle, server_id, "save", "".to_string(), false, None).await
}


// Shared executer for mutating actions
async fn execute_pm2_action(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    action: &str,
    target: String,
    _is_destructive: bool,
    _token: Option<String>,
) -> CommandResult<()> {
    let start = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let cmd = if action == "save" {
        "pm2 save".to_string()
    } else {
        format!("pm2 {} {}", action, target)
    };

    let mut result = {
        let mut session = session_arc.lock().await;
        exec_ssh_command(&mut session, &cmd).await
    };

    if let Err(ref e) = result {
        let err_str = e.to_string();
        if err_str.contains("ConnectFailed") || err_str.contains("Failed to open SSH channel") || err_str.contains("closed") {
            log::warn!("PM2 action SSH channel failed ({}), reconnecting...", err_str);
            state.session_manager.evict_session(&server_id).await;
            if let Ok(new_session_arc) = state.session_manager.get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone()).await {
                let mut new_session = new_session_arc.lock().await;
                result = exec_ssh_command(&mut new_session, &cmd).await;
            }
        }
    }

    // Stage 5: Audit log
    let status = if result.is_ok() { "success" } else { "failed" };
    let detail = result.as_ref().err().map(|e| e.to_string());

    if let Ok(conn) = state.db.lock() {
        let canonical_action = match action {
            "start"   => actions::PM2_START,
            "stop"    => actions::PM2_STOP,
            "restart" => actions::PM2_RESTART,
            "reload"  => actions::PM2_RELOAD,
            "delete"  => actions::PM2_DELETE,
            "save"    => actions::PM2_SAVE,
            other     => other,  // fallback — shouldn't happen
        };
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: canonical_action.into(),
            target: if action == "save" { None } else { Some(target) },
            status: status.into(),
            detail,
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
    }

    result.map(|_| ())
}

#[tauri::command]
pub async fn tail_process_log(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    log_path: String,
    lines: u32,
) -> CommandResult<String> {
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let cmd = format!("tail -n {} \"{}\"", lines, log_path);
    let mut result = {
        let mut session = session_arc.lock().await;
        exec_ssh_command(&mut session, &cmd).await
    };

    if let Err(ref e) = result {
        let err_str = e.to_string();
        if err_str.contains("ConnectFailed") || err_str.contains("Failed to open SSH channel") || err_str.contains("closed") {
            state.session_manager.evict_session(&server_id).await;
            if let Ok(new_session_arc) = state.session_manager.get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone()).await {
                let mut new_session = new_session_arc.lock().await;
                result = exec_ssh_command(&mut new_session, &cmd).await;
            }
        }
    }

    let output = result?;
    Ok(crate::secrets::redact::redact_secrets(&output))
}
