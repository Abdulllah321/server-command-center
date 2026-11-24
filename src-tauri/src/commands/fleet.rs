use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::db::{log_activity, ActivityEntry, actions};
use crate::commands::confirmation::consume_token;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use russh::ChannelMsg;
use tokio::time::{timeout, Duration};
use tokio::task::JoinSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FleetServerResult {
    pub server_id: String,
    pub server_name: String,
    pub hostname: String,
    pub environment: String,
    pub status: String, // "success", "failed", "timeout", "offline"
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FleetExecutionSummary {
    pub total_servers: usize,
    pub successful: usize,
    pub failed: usize,
    pub total_duration_ms: u64,
    pub command: String,
    pub results: Vec<FleetServerResult>,
}

#[derive(Debug, Clone)]
struct ServerMeta {
    id: String,
    name: String,
    hostname: String,
    environment: String,
}

/// Executes a shell command in parallel across multiple targeted servers
#[tauri::command]
pub async fn execute_fleet_command(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_ids: Vec<String>,
    command: String,
    timeout_seconds: Option<u64>,
    confirmation_token: Option<String>,
) -> CommandResult<FleetExecutionSummary> {
    if server_ids.is_empty() {
        return Err(CommandError::Validation("At least one server must be targeted".into()));
    }

    let cmd_trimmed = command.trim();
    if cmd_trimmed.is_empty() {
        return Err(CommandError::Validation("Command cannot be empty".into()));
    }

    // If confirmation token is passed, verify it
    if let Some(ref token) = confirmation_token {
        consume_token(Some(token)).await?;
    }

    // Safety checks against dangerous blind deletion commands across entire fleets
    let dangerous_patterns = ["rm -rf /", "rm -rf /*", "mkfs", "dd if=/dev/zero", ":(){ :|:& };:"];
    for dp in dangerous_patterns {
        if cmd_trimmed.contains(dp) {
            return Err(CommandError::Forbidden(format!("Dangerous destructive fleet command blocked: {}", dp)));
        }
    }

    // Fetch server metadata from SQLite
    let mut servers_meta = Vec::new();
    {
        let conn = state.db.lock()
            .map_err(|e| CommandError::Database(format!("Failed to acquire DB lock: {}", e)))?;

        for sid in &server_ids {
            let mut stmt = conn.prepare("SELECT id, name, hostname, environment FROM servers WHERE id = ?1")
                .map_err(|e| CommandError::Database(e.to_string()))?;

            let res = stmt.query_row([sid], |row| {
                Ok(ServerMeta {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    hostname: row.get(2)?,
                    environment: row.get(3)?,
                })
            });

            match res {
                Ok(meta) => servers_meta.push(meta),
                Err(_) => {
                    servers_meta.push(ServerMeta {
                        id: sid.clone(),
                        name: sid.clone(),
                        hostname: "unknown".into(),
                        environment: "unknown".into(),
                    });
                }
            }
        }
    }

    let overall_start = Instant::now();
    let per_server_timeout = Duration::from_secs(timeout_seconds.unwrap_or(30).clamp(5, 180));
    let mut join_set = JoinSet::new();

    for meta in servers_meta {
        let app_handle_clone = app_handle.clone();
        let session_manager = state.session_manager.clone();
        let db_arc = state.db.clone();
        let cmd = cmd_trimmed.to_string();

        join_set.spawn(async move {
            let start = Instant::now();
            let server_id = meta.id.clone();

            // Try to acquire or open pooled SSH connection
            let session_res = session_manager
                .get_or_connect(server_id.clone(), db_arc, app_handle_clone)
                .await;

            let session_arc = match session_res {
                Ok(s) => s,
                Err(err) => {
                    return FleetServerResult {
                        server_id: meta.id,
                        server_name: meta.name,
                        hostname: meta.hostname,
                        environment: meta.environment,
                        status: "offline".into(),
                        stdout: String::new(),
                        stderr: format!("Connection failed: {}", err),
                        exit_code: Some(-1),
                        duration_ms: start.elapsed().as_millis() as u64,
                    };
                }
            };

            let session = session_arc.lock().await;

            // Execute command with timeout
            let exec_fut = async {
                let mut channel = session.channel_open_session().await
                    .map_err(|e| format!("Failed to open SSH channel: {}", e))?;

                channel.exec(true, cmd.as_str()).await
                    .map_err(|e| format!("Failed to exec command: {}", e))?;

                let mut stdout = String::new();
                let mut stderr = String::new();
                let mut exit_status: Option<i32> = None;

                loop {
                    match channel.wait().await {
                        Some(ChannelMsg::Data { ref data }) => {
                            stdout.push_str(&String::from_utf8_lossy(data));
                        }
                        Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                            stderr.push_str(&String::from_utf8_lossy(data));
                        }
                        Some(ChannelMsg::ExitStatus { exit_status: code }) => {
                            exit_status = Some(code as i32);
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                            break;
                        }
                        _ => {}
                    }
                }

                let _ = channel.close().await;
                Ok::<(String, String, Option<i32>), String>((stdout, stderr, exit_status))
            };

            match timeout(per_server_timeout, exec_fut).await {
                Ok(Ok((stdout, stderr, exit_status))) => {
                    let is_success = exit_status.unwrap_or(0) == 0;
                    FleetServerResult {
                        server_id: meta.id,
                        server_name: meta.name,
                        hostname: meta.hostname,
                        environment: meta.environment,
                        status: if is_success { "success".into() } else { "failed".into() },
                        stdout,
                        stderr,
                        exit_code: exit_status,
                        duration_ms: start.elapsed().as_millis() as u64,
                    }
                }
                Ok(Err(err)) => {
                    FleetServerResult {
                        server_id: meta.id,
                        server_name: meta.name,
                        hostname: meta.hostname,
                        environment: meta.environment,
                        status: "failed".into(),
                        stdout: String::new(),
                        stderr: err,
                        exit_code: Some(1),
                        duration_ms: start.elapsed().as_millis() as u64,
                    }
                }
                Err(_) => {
                    FleetServerResult {
                        server_id: meta.id,
                        server_name: meta.name,
                        hostname: meta.hostname,
                        environment: meta.environment,
                        status: "timeout".into(),
                        stdout: String::new(),
                        stderr: format!("Execution timed out after {}s", per_server_timeout.as_secs()),
                        exit_code: Some(124),
                        duration_ms: start.elapsed().as_millis() as u64,
                    }
                }
            }
        });
    }

    let mut results = Vec::new();
    while let Some(res) = join_set.join_next().await {
        if let Ok(item) = res {
            results.push(item);
        }
    }

    // Sort results to preserve deterministic ordering (e.g. by server name)
    results.sort_by(|a, b| a.server_name.cmp(&b.server_name));

    let successful = results.iter().filter(|r| r.status == "success").count();
    let failed = results.len() - successful;
    let total_duration_ms = overall_start.elapsed().as_millis() as u64;

    // Audit log fleet execution
    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: None,
            action: actions::FLEET_COMMAND.into(),
            target: Some(format!("{} servers: {}", results.len(), cmd_trimmed)),
            status: if failed == 0 { "success".into() } else { "partial".into() },
            detail: Some(format!(
                "Success: {}/{}, Total Duration: {}ms",
                successful, results.len(), total_duration_ms
            )),
            duration_ms: Some(total_duration_ms as i64),
        });
    }

    Ok(FleetExecutionSummary {
        total_servers: results.len(),
        successful,
        failed,
        total_duration_ms,
        command: cmd_trimmed.to_string(),
        results,
    })
}
