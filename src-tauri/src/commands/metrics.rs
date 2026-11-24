use std::time::Instant;
use russh::ChannelMsg;
use russh::client::Handle;
use serde::{Deserialize, Serialize};
use tokio::time::{timeout, Duration};

use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::ssh::client::SshClientHandler;
use crate::db::{log_activity, ActivityEntry, actions};
use crate::commands::confirmation::consume_token;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricPoint {
    pub timestamp: String,
    pub cpu_pct: f32,
    pub ram_pct: f32,
    pub disk_pct: f32,
    pub load_1m: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessItem {
    pub pid: u32,
    pub ppid: u32,
    pub user: String,
    pub cpu_pct: f32,
    pub mem_pct: f32,
    pub vsz_kb: u64,
    pub rss_kb: u64,
    pub stat: String,
    pub command: String,
    pub args: String,
}

struct SshOutput {
    stdout: String,
    stderr: String,
    exit_status: Option<u32>,
}

async fn exec_ssh_command_full(
    session: &mut Handle<SshClientHandler>,
    cmd: &str,
    timeout_duration: Duration,
) -> Result<SshOutput, CommandError> {
    let mut channel = session.channel_open_session().await
        .map_err(|e| CommandError::Internal(format!("Failed to open SSH channel: {}", e)))?;

    channel.exec(true, cmd).await
        .map_err(|e| CommandError::Internal(format!("Failed to exec command '{}': {}", cmd, e)))?;

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut exit_code = None;

    loop {
        let msg_future = channel.wait();
        let msg_opt = match timeout(timeout_duration, msg_future).await {
            Ok(opt) => opt,
            Err(_) => {
                let _ = channel.close().await;
                return Err(CommandError::Internal("Remote command timed out".into()));
            }
        };

        match msg_opt {
            Some(ChannelMsg::Data { ref data }) => {
                stdout.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                stderr.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = Some(exit_status);
            }
            Some(ChannelMsg::Eof) => {}
            Some(ChannelMsg::Close) | None => {
                break;
            }
            _ => {}
        }
    }

    let _ = channel.close().await;
    if exit_code.is_none() {
        exit_code = Some(0);
    }

    Ok(SshOutput {
        stdout,
        stderr,
        exit_status: exit_code,
    })
}

#[tauri::command]
pub async fn record_metric_point(
    state: tauri::State<'_, AppState>,
    server_id: String,
    cpu_pct: f32,
    ram_pct: f32,
    disk_pct: f32,
    load_1m: f32,
) -> CommandResult<()> {
    if let Ok(conn) = state.db.lock() {
        let _ = conn.execute(
            "INSERT INTO server_metrics_history (server_id, cpu_pct, ram_pct, disk_pct, load_1m) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![&server_id, cpu_pct, ram_pct, disk_pct, load_1m],
        );
        let _ = conn.execute(
            "DELETE FROM server_metrics_history WHERE recorded_at < datetime('now', '-7 days')",
            [],
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn get_metrics_history(
    state: tauri::State<'_, AppState>,
    server_id: String,
    time_range: Option<String>,
) -> CommandResult<Vec<MetricPoint>> {
    let range = time_range.unwrap_or_else(|| "1h".to_string());
    let conn = state.db.lock()
        .map_err(|e| CommandError::Internal(format!("Failed to lock DB: {}", e)))?;

    let points = match range.as_str() {
        "7d" => {
            // Aggregate in 1-hour buckets for smooth 7-day visualization
            let mut stmt = conn.prepare(
                "SELECT 
                    strftime('%Y-%m-%dT%H:00:00Z', recorded_at) as bucket,
                    ROUND(AVG(cpu_pct), 2),
                    ROUND(AVG(ram_pct), 2),
                    ROUND(AVG(disk_pct), 2),
                    ROUND(AVG(load_1m), 2)
                 FROM server_metrics_history
                 WHERE server_id = ?1 AND recorded_at >= datetime('now', '-7 days')
                 GROUP BY bucket
                 ORDER BY bucket ASC"
            ).map_err(|e| CommandError::Internal(e.to_string()))?;

            let rows = stmt.query_map(rusqlite::params![&server_id], |row| {
                Ok(MetricPoint {
                    timestamp: row.get(0)?,
                    cpu_pct: row.get::<_, f64>(1)? as f32,
                    ram_pct: row.get::<_, f64>(2)? as f32,
                    disk_pct: row.get::<_, f64>(3)? as f32,
                    load_1m: row.get::<_, f64>(4)? as f32,
                })
            }).map_err(|e| CommandError::Internal(e.to_string()))?;

            let mut results = Vec::new();
            for r in rows {
                if let Ok(p) = r {
                    results.push(p);
                }
            }
            results
        },
        "24h" => {
            // Aggregate in 10-minute buckets for 24 hours
            let mut stmt = conn.prepare(
                "SELECT 
                    strftime('%Y-%m-%dT%H:', recorded_at) || printf('%02d:00Z', (CAST(strftime('%M', recorded_at) AS INTEGER) / 10) * 10) as bucket,
                    ROUND(AVG(cpu_pct), 2),
                    ROUND(AVG(ram_pct), 2),
                    ROUND(AVG(disk_pct), 2),
                    ROUND(AVG(load_1m), 2)
                 FROM server_metrics_history
                 WHERE server_id = ?1 AND recorded_at >= datetime('now', '-24 hours')
                 GROUP BY bucket
                 ORDER BY bucket ASC"
            ).map_err(|e| CommandError::Internal(e.to_string()))?;

            let rows = stmt.query_map(rusqlite::params![&server_id], |row| {
                Ok(MetricPoint {
                    timestamp: row.get(0)?,
                    cpu_pct: row.get::<_, f64>(1)? as f32,
                    ram_pct: row.get::<_, f64>(2)? as f32,
                    disk_pct: row.get::<_, f64>(3)? as f32,
                    load_1m: row.get::<_, f64>(4)? as f32,
                })
            }).map_err(|e| CommandError::Internal(e.to_string()))?;

            let mut results = Vec::new();
            for r in rows {
                if let Ok(p) = r {
                    results.push(p);
                }
            }
            results
        },
        _ => {
            // Default 1h - raw or dense points
            let mut stmt = conn.prepare(
                "SELECT recorded_at, cpu_pct, ram_pct, disk_pct, load_1m
                 FROM server_metrics_history
                 WHERE server_id = ?1 AND recorded_at >= datetime('now', '-1 hour')
                 ORDER BY recorded_at ASC"
            ).map_err(|e| CommandError::Internal(e.to_string()))?;

            let rows = stmt.query_map(rusqlite::params![&server_id], |row| {
                Ok(MetricPoint {
                    timestamp: row.get(0)?,
                    cpu_pct: row.get::<_, f64>(1)? as f32,
                    ram_pct: row.get::<_, f64>(2)? as f32,
                    disk_pct: row.get::<_, f64>(3)? as f32,
                    load_1m: row.get::<_, f64>(4)? as f32,
                })
            }).map_err(|e| CommandError::Internal(e.to_string()))?;

            let mut results = Vec::new();
            for r in rows {
                if let Ok(p) = r {
                    results.push(p);
                }
            }
            results
        }
    };

    Ok(points)
}

#[tauri::command]
pub async fn get_top_processes(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    sort_by: Option<String>,
    limit: Option<usize>,
) -> CommandResult<Vec<ProcessItem>> {
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;

    let sort_flag = match sort_by.as_deref() {
        Some("mem") => "--sort=-%mem",
        _ => "--sort=-%cpu",
    };

    let script = format!(
        "export LC_ALL=C; ps -eo pid,ppid,user,%cpu,%mem,vsz,rss,stat,comm,args {} 2>/dev/null || ps -eo pid,ppid,user,%cpu,%mem,vsz,rss,stat,comm,args 2>/dev/null",
        sort_flag
    );

    let output = {
        let mut session = session_arc.lock().await;
        exec_ssh_command_full(&mut session, &script, Duration::from_secs(8)).await?
    };

    let mut processes: Vec<ProcessItem> = Vec::new();

    for line in output.stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 9 {
            continue;
        }

        // Check if header line (PID)
        let pid = match parts[0].parse::<u32>() {
            Ok(p) => p,
            Err(_) => continue,
        };

        let ppid = parts[1].parse::<u32>().unwrap_or(0);
        let user = parts[2].to_string();
        let cpu_pct = parts[3].parse::<f32>().unwrap_or(0.0);
        let mem_pct = parts[4].parse::<f32>().unwrap_or(0.0);
        let vsz_kb = parts[5].parse::<u64>().unwrap_or(0);
        let rss_kb = parts[6].parse::<u64>().unwrap_or(0);
        let stat = parts[7].to_string();
        let command = parts[8].to_string();
        let args = if parts.len() > 9 {
            parts[9..].join(" ")
        } else {
            format!("[{}]", command)
        };

        processes.push(ProcessItem {
            pid,
            ppid,
            user,
            cpu_pct,
            mem_pct,
            vsz_kb,
            rss_kb,
            stat,
            command,
            args,
        });
    }

    // Sort accurately in Rust
    match sort_by.as_deref() {
        Some("mem") => {
            processes.sort_by(|a, b| b.mem_pct.partial_cmp(&a.mem_pct).unwrap_or(std::cmp::Ordering::Equal));
        }
        _ => {
            processes.sort_by(|a, b| b.cpu_pct.partial_cmp(&a.cpu_pct).unwrap_or(std::cmp::Ordering::Equal));
        }
    }

    let max_items = limit.unwrap_or(35).min(200);
    processes.truncate(max_items);

    Ok(processes)
}

#[tauri::command]
pub async fn kill_server_process(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    pid: u32,
    signal: Option<String>,
    confirmation_token: Option<String>,
) -> CommandResult<String> {
    if pid <= 1 {
        return Err(CommandError::Validation("Cannot terminate system init process (PID <= 1)".into()));
    }

    consume_token(confirmation_token.as_deref()).await?;

    let (sig_num, sig_name) = match signal.as_deref() {
        Some("SIGKILL") | Some("9") => ("9", "SIGKILL"),
        Some("SIGHUP") | Some("1") => ("1", "SIGHUP"),
        _ => ("15", "SIGTERM"),
    };

    let started = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;

    let cmd = format!("kill -s {} {} 2>&1 || kill -{} {} 2>&1", sig_num, pid, sig_num, pid);

    let res = {
        let mut session = session_arc.lock().await;
        exec_ssh_command_full(&mut session, &cmd, Duration::from_secs(6)).await
    };

    let (is_success, msg) = match res {
        Ok(out) => {
            if out.exit_status == Some(0) || out.stdout.is_empty() && out.stderr.is_empty() {
                (true, format!("Successfully dispatched {} to PID {}", sig_name, pid))
            } else {
                let err_detail = if !out.stderr.is_empty() { out.stderr } else { out.stdout };
                (false, format!("Failed to terminate PID {}: {}", pid, err_detail.trim()))
            }
        }
        Err(e) => (false, format!("SSH error killing process {}: {}", pid, e)),
    };

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id.clone()),
            action: actions::KILL_PROCESS.into(),
            target: Some(format!("PID {}", pid)),
            status: if is_success { "success".into() } else { "failed".into() },
            detail: Some(msg.clone()),
            duration_ms: Some(started.elapsed().as_millis() as i64),
        });
    }

    if is_success {
        Ok(msg)
    } else {
        Err(CommandError::Internal(msg))
    }
}
