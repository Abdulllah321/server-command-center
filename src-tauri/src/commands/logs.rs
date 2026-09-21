use crate::AppState;
use crate::error::{CommandError, CommandResult};
use russh::ChannelMsg;
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use std::time::SystemTime;
use std::path::PathBuf;
use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;
use regex::Regex;
use std::collections::HashMap;
use tokio::sync::mpsc;
use crate::ssh::client::SshClientHandler;
use russh::client::Handle;

#[derive(Clone, Serialize)]
struct LogLineEvent {
    session_id: String,
    level: String,
    content: String,
}



fn determine_log_level(line: &str) -> &'static str {
    // Simple heuristic regex compilation could be cached, but for simplicity we match string manually or use lazy regex
    lazy_static::lazy_static! {
        static ref RE_ERROR: Regex = Regex::new(r"(?i)\b(error|exception|fail|trace|panic)\b").unwrap();
        static ref RE_WARN: Regex = Regex::new(r"(?i)\b(warn|warning)\b").unwrap();
        static ref RE_DEBUG: Regex = Regex::new(r"(?i)\b(debug)\b").unwrap();
    }

    if RE_ERROR.is_match(line) {
        "ERROR"
    } else if RE_WARN.is_match(line) {
        "WARN"
    } else if RE_DEBUG.is_match(line) {
        "DEBUG"
    } else {
        "INFO"
    }
}

// Ensure the local log directory exists
async fn get_logs_dir(app_handle: &AppHandle) -> Result<PathBuf, CommandError> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| CommandError::Internal(e.to_string()))?;
    let logs_dir = app_dir.join("logs");
    if !logs_dir.exists() {
        fs::create_dir_all(&logs_dir).await.map_err(|e| CommandError::Internal(e.to_string()))?;
    }
    Ok(logs_dir)
}

async fn prune_old_log_sessions(app_handle: &AppHandle, state: &tauri::State<'_, AppState>, application_id: &str) {
    let conn_guard = match state.db.lock() {
        Ok(c) => c,
        Err(_) => return,
    };

    // Keep only the last 10 sessions per application
    let mut stmt = match conn_guard.prepare(
        "SELECT id, file_path FROM log_sessions 
         WHERE application_id = ?1 
         ORDER BY started_at DESC 
         LIMIT -1 OFFSET 10"
    ) {
        Ok(s) => s,
        Err(_) => return,
    };

    let mut rows = match stmt.query(rusqlite::params![application_id]) {
        Ok(r) => r,
        Err(_) => return,
    };

    let mut to_delete_ids = Vec::new();
    while let Ok(Some(row)) = rows.next() {
        let id: String = match row.get(0) {
            Ok(i) => i,
            Err(_) => continue,
        };
        let file_path: String = match row.get(1) {
            Ok(p) => p,
            Err(_) => continue,
        };

        let _ = tokio::fs::remove_file(&file_path).await;
        to_delete_ids.push(id);
    }

    // SQLite doesn't easily allow binding a list of IDs in a single simple query without dynamic construction,
    // so we just loop for V1 cleanup
    for id in to_delete_ids {
        let _ = conn_guard.execute(
            "DELETE FROM log_sessions WHERE id = ?1",
            rusqlite::params![id]
        );
    }
}

#[tauri::command]
pub async fn open_log_stream(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    pm2_name: String,
) -> CommandResult<String> {
    let session_id = Uuid::new_v4().to_string();
    
    // 1. Get or create Application ID to satisfy log_sessions schema
    let application_id = {
        let conn_guard = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
        
        let mut stmt = conn_guard.prepare("SELECT id FROM applications WHERE server_id = ?1 AND pm2_name = ?2")
            .map_err(|e| CommandError::Internal(e.to_string()))?;
            
        let mut rows = stmt.query(rusqlite::params![server_id, pm2_name])
            .map_err(|e| CommandError::Internal(e.to_string()))?;
            
        if let Some(row) = rows.next().unwrap_or(None) {
            row.get::<_, String>(0).unwrap_or_else(|_| Uuid::new_v4().to_string())
        } else {
            // Auto-create dummy application
            let new_app_id = Uuid::new_v4().to_string();
            conn_guard.execute(
                "INSERT INTO applications (id, server_id, name, pm2_name, created_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))",
                rusqlite::params![new_app_id, server_id, pm2_name, pm2_name]
            ).map_err(|e| CommandError::Internal(e.to_string()))?;
            new_app_id
        }
    };

    // 2. Create local log file
    let logs_dir = get_logs_dir(&app_handle).await?;
    let file_path = logs_dir.join(format!("{}.log", session_id));
    let file_path_str = file_path.to_string_lossy().to_string();

    // 3. Create log_sessions entry
    {
        let conn_guard = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
        conn_guard.execute(
            "INSERT INTO log_sessions (id, application_id, started_at, file_path) VALUES (?1, ?2, datetime('now'), ?3)",
            rusqlite::params![session_id, application_id, file_path_str]
        ).map_err(|e| CommandError::Internal(e.to_string()))?;
    }

    // 3b. Prune old sessions
    prune_old_log_sessions(&app_handle, &state, &application_id).await;

    // 4. Connect SSH and spawn reader task
    let session_manager = {
        let sm_guard = state.session_manager.lock().await;
        sm_guard.clone()
    };

    let session = session_manager
        .get_or_connect(server_id.clone(), state.clone(), app_handle.clone())
        .await?;

    let cmd = format!("pm2 logs {} --raw", pm2_name);
    let (pty_id, mut rx) = state
        .pty_manager
        .open_pty(session, 80, 24, Some(&cmd))
        .await?;

    // We store the pty_id as our session_id so close_log_stream can kill the PTY
    let session_id_clone = pty_id.clone();
    
    // Replace the generated session_id with the one generated by PtyManager in log_sessions
    {
        let conn_guard = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
        conn_guard.execute(
            "UPDATE log_sessions SET id = ?1 WHERE id = ?2",
            rusqlite::params![pty_id, session_id]
        ).map_err(|e| CommandError::Internal(e.to_string()))?;
    }
    
    // We update file_path too to match new id
    let new_file_path = logs_dir.join(format!("{}.log", pty_id));
    if let Err(e) = tokio::fs::rename(&file_path, &new_file_path).await {
        log::error!("Failed to rename log file: {}", e);
    }
    let file_path_clone = new_file_path.clone();

    let app_handle_clone = app_handle.clone();

    tokio::spawn(async move {
        let mut file = match OpenOptions::new().create(true).append(true).open(&file_path_clone).await {
            Ok(f) => f,
            Err(e) => {
                log::error!("Failed to open log file for writing: {}", e);
                return;
            }
        };

        let mut buffer = String::new();
        let mut bytes_written = 0usize;
        let max_bytes = 5 * 1024 * 1024; // 5MB cap per session

        while let Some(msg) = rx.recv().await {
            use russh::ChannelMsg;
            use tauri::Emitter;

            match msg {
                ChannelMsg::Data { ref data } | ChannelMsg::ExtendedData { ref data, .. } => {
                    let chunk = String::from_utf8_lossy(data);
                    buffer.push_str(&chunk);

                    while let Some(idx) = buffer.find('\n') {
                        let line = buffer[..idx].to_string();
                        buffer.remove_range(..=idx);
                        
                        let clean_line = line.trim_end_matches('\r').to_string();
                        if clean_line.is_empty() { continue; }

                        let level = determine_log_level(&clean_line);

                        // Write to local file
                        if bytes_written < max_bytes {
                            let line_bytes = format!("[{}] {}\n", level, clean_line);
                            if let Ok(_) = file.write_all(line_bytes.as_bytes()).await {
                                bytes_written += line_bytes.len();
                            }
                        }

                        // Emit to frontend
                        let _ = app_handle_clone.emit(&format!("logs://data:{}", session_id_clone), LogLineEvent {
                            session_id: session_id_clone.clone(),
                            level: level.to_string(),
                            content: clean_line,
                        });
                    }
                }
                ChannelMsg::Eof | ChannelMsg::Close => {
                    log::info!("SSH channel closed for log stream {}", session_id_clone);
                    break;
                }
                _ => {}
            }
        }
        
        let _ = file.sync_all().await;
        use tauri::Emitter;
        let _ = app_handle_clone.emit(&format!("logs://disconnected:{}", session_id_clone), ());
    });

    Ok(pty_id)
}

#[tauri::command]
pub async fn close_log_stream(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> CommandResult<()> {
    // We now just close the underlying PTY session
    state.pty_manager.close(&session_id).await?;

    let conn_guard = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    conn_guard.execute(
        "UPDATE log_sessions SET ended_at = datetime('now') WHERE id = ?1",
        rusqlite::params![session_id]
    ).map_err(|e| CommandError::Internal(e.to_string()))?;

    Ok(())
}

#[tauri::command]
pub async fn get_log_session_file(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> CommandResult<String> {
    let conn_guard = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    
    let mut stmt = conn_guard.prepare("SELECT file_path FROM log_sessions WHERE id = ?1")
        .map_err(|e| CommandError::Internal(e.to_string()))?;
        
    let mut rows = stmt.query(rusqlite::params![session_id])
        .map_err(|e| CommandError::Internal(e.to_string()))?;
        
    if let Some(row) = rows.next().unwrap_or(None) {
        let file_path: String = row.get(0).map_err(|e| CommandError::Internal(e.to_string()))?;
        Ok(file_path)
    } else {
        Err(CommandError::NotFound("Log session not found".into()))
    }
}

#[tauri::command]
pub async fn read_log_session_file(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> CommandResult<String> {
    let file_path = get_log_session_file(state, session_id).await?;
    let content = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| CommandError::Internal(format!("Failed to read log file: {}", e)))?;
    Ok(content)
}
