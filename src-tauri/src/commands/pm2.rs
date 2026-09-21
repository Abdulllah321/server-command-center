use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::db::{log_activity, ActivityEntry};
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
            Err(_) => return Err(CommandError::Internal("SSH command timed out".into())),
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
    
    Ok(output)
}

#[tauri::command]
pub async fn list_processes(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<Vec<Pm2Process>> {
    let session_manager = {
        let sm_guard = state.session_manager.lock().await;
        sm_guard.clone()
    };

    let mut session = session_manager
        .get_or_connect(server_id.clone(), state.clone(), app_handle.clone())
        .await?;

    let output = exec_ssh_command(&mut session, "pm2 jlist").await?;

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
            env: entry.pm2_env.env,
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
    confirmation_token: String,
) -> CommandResult<()> {
    // Stage 2: Gate destructive action
    // In a full implementation we would check `state.confirm_gate.verify(&confirmation_token)`
    // Here we just demand the token is present to simulate the chokepoint
    if confirmation_token.is_empty() {
        return Err(CommandError::Validation("Missing confirmation token for deletion".into()));
    }
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
    let session_manager = {
        let sm_guard = state.session_manager.lock().await;
        sm_guard.clone()
    };

    let mut session = session_manager
        .get_or_connect(server_id.clone(), state.clone(), app_handle.clone())
        .await?;

    let cmd = if action == "save" {
        "pm2 save".to_string()
    } else {
        format!("pm2 {} {}", action, target)
    };

    let result = exec_ssh_command(&mut session, &cmd).await;

    // Stage 5: Audit log
    let status = if result.is_ok() { "success" } else { "failed" };
    let detail = result.as_ref().err().map(|e| e.to_string());

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: format!("pm2_{}", action),
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
    let session_manager = {
        let sm_guard = state.session_manager.lock().await;
        sm_guard.clone()
    };

    let mut session = session_manager
        .get_or_connect(server_id.clone(), state.clone(), app_handle.clone())
        .await?;

    let cmd = format!("tail -n {} \"{}\"", lines, log_path);
    exec_ssh_command(&mut session, &cmd).await
}
