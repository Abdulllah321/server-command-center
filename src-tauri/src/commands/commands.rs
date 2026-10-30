use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::error::{CommandResult, CommandError};
use rusqlite::OptionalExtension;
use uuid::Uuid;

use tauri::AppHandle;
use tokio::time::{timeout, Duration};
use std::time::Instant;
use russh::ChannelMsg;
use crate::db::{log_activity, ActivityEntry};

#[derive(Serialize)]
pub struct CommandOutput {
    pub output: String,
    pub exit_code: Option<i32>,
    pub duration_ms: i64,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CommandItem {
    pub id: String,
    pub server_id: Option<String>,
    pub name: String,
    pub command: String,
    pub category: Option<String>,
    pub icon: Option<String>,
    pub is_destructive: bool,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct CreateCommandOptions {
    pub server_id: Option<String>,
    pub name: String,
    pub command: String,
    pub category: Option<String>,
    pub icon: Option<String>,
    pub is_destructive: bool,
}

#[derive(Deserialize)]
pub struct UpdateCommandOptions {
    pub name: Option<String>,
    pub command: Option<String>,
    pub category: Option<String>,
    pub icon: Option<String>,
    pub is_destructive: Option<bool>,
}

pub fn seed_default_commands(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "INSERT OR IGNORE INTO commands (id, server_id, name, command, category, icon, is_destructive, created_at)
        VALUES
          ('cmd-diag-memory', NULL, 'Top Memory Apps', 'ps aux --sort=-%mem | head -n 12', 'Diagnostics', '🧠', 0, datetime('now')),
          ('cmd-diag-cpu', NULL, 'Top CPU Apps', 'ps aux --sort=-%cpu | head -n 12', 'Diagnostics', '⚡', 0, datetime('now')),
          ('cmd-diag-disk', NULL, 'Disk & Inodes Space', 'df -h && echo \"\" && echo \"=== INODES ===\" && df -ih', 'Diagnostics', '💾', 0, datetime('now')),
          ('cmd-diag-ports', NULL, 'Listening Ports', 'ss -tulpn 2>/dev/null || netstat -tulnp 2>/dev/null', 'Network', '🔌', 0, datetime('now')),
          ('cmd-diag-failed', NULL, 'Check Failed Services', 'systemctl --failed --all', 'Diagnostics', '🩺', 0, datetime('now')),
          ('cmd-nginx-reload', NULL, 'Reload Nginx', 'sudo nginx -t && sudo systemctl reload nginx', 'Web Server', '🌐', 0, datetime('now')),
          ('cmd-nginx-restart', NULL, 'Restart Nginx', 'sudo systemctl restart nginx', 'Web Server', '🔄', 0, datetime('now')),
          ('cmd-pm2-flush', NULL, 'Flush PM2 Logs', 'pm2 flush', 'PM2', '🧹', 0, datetime('now')),
          ('cmd-pm2-status', NULL, 'PM2 Status Table', 'pm2 status', 'PM2', '📊', 0, datetime('now')),
          ('cmd-maint-journal', NULL, 'Clean System Journal', 'sudo journalctl --vacuum-time=3d', 'Maintenance', '🗑️', 0, datetime('now')),
          ('cmd-maint-dropcache', NULL, 'Reclaim RAM Caches', 'sync && echo 3 | sudo tee /proc/sys/vm/drop_caches', 'Maintenance', '🚀', 0, datetime('now')),
          ('cmd-sys-reboot', NULL, 'Reboot Server', 'sudo reboot', 'System', '⚠️', 1, datetime('now'));"
    )
}

#[tauri::command]
pub async fn reset_default_commands(
    state: tauri::State<'_, AppState>,
) -> CommandResult<()> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    seed_default_commands(&conn).map_err(|e| CommandError::Internal(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn list_commands(
    state: tauri::State<'_, AppState>,
    server_id: Option<String>,
) -> CommandResult<Vec<CommandItem>> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;

    // Auto-seed defaults if commands table is currently empty
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM commands", [], |r| r.get(0)).unwrap_or(0);
    if count == 0 {
        let _ = seed_default_commands(&conn);
    }
    
    let mut stmt = if server_id.is_some() {
        conn.prepare("SELECT id, server_id, name, command, category, icon, is_destructive, created_at FROM commands WHERE server_id IS NULL OR server_id = ?1 ORDER BY created_at ASC")
            .map_err(|e| CommandError::Internal(e.to_string()))?
    } else {
        conn.prepare("SELECT id, server_id, name, command, category, icon, is_destructive, created_at FROM commands WHERE server_id IS NULL ORDER BY created_at ASC")
            .map_err(|e| CommandError::Internal(e.to_string()))?
    };
    
    let map_fn = |row: &rusqlite::Row| -> rusqlite::Result<CommandItem> {
        Ok(CommandItem {
            id: row.get(0)?,
            server_id: row.get(1)?,
            name: row.get(2)?,
            command: row.get(3)?,
            category: row.get(4)?,
            icon: row.get(5)?,
            is_destructive: row.get::<_, i32>(6)? == 1,
            created_at: row.get(7)?,
        })
    };

    let mut cmds = Vec::new();
    if let Some(ref sid) = server_id {
        let rows = stmt.query_map(rusqlite::params![sid], map_fn)
            .map_err(|e| CommandError::Internal(e.to_string()))?;
        for row_res in rows {
            cmds.push(row_res.map_err(|e| CommandError::Internal(e.to_string()))?);
        }
    } else {
        let rows = stmt.query_map([], map_fn)
            .map_err(|e| CommandError::Internal(e.to_string()))?;
        for row_res in rows {
            cmds.push(row_res.map_err(|e| CommandError::Internal(e.to_string()))?);
        }
    }

    Ok(cmds)
}

#[tauri::command]
pub async fn get_command(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<CommandItem> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    let mut stmt = conn.prepare("SELECT id, server_id, name, command, category, icon, is_destructive, created_at FROM commands WHERE id = ?1")
        .map_err(|e| CommandError::Internal(e.to_string()))?;
        
    let cmd = stmt.query_row(rusqlite::params![id], |row| {
        Ok(CommandItem {
            id: row.get(0)?,
            server_id: row.get(1)?,
            name: row.get(2)?,
            command: row.get(3)?,
            category: row.get(4)?,
            icon: row.get(5)?,
            is_destructive: row.get::<_, i32>(6)? == 1,
            created_at: row.get(7)?,
        })
    }).optional().map_err(|e| CommandError::Internal(e.to_string()))?
    .ok_or_else(|| CommandError::NotFound("Command not found".into()))?;
    
    Ok(cmd)
}

#[tauri::command]
pub async fn create_command(
    state: tauri::State<'_, AppState>,
    opts: CreateCommandOptions,
) -> CommandResult<CommandItem> {
    if opts.name.trim().is_empty() || opts.command.trim().is_empty() {
        return Err(CommandError::InvalidInput("Name and command cannot be empty".into()));
    }

    let id = Uuid::new_v4().to_string();
    let is_destructive_int = if opts.is_destructive { 1 } else { 0 };
    
    {
        let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
        conn.execute(
            "INSERT INTO commands (id, server_id, name, command, category, icon, is_destructive, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
            rusqlite::params![id, opts.server_id, opts.name, opts.command, opts.category, opts.icon, is_destructive_int]
        ).map_err(|e| CommandError::Internal(e.to_string()))?;
    }
    
    get_command(state, id).await
}

#[tauri::command]
pub async fn update_command(
    state: tauri::State<'_, AppState>,
    id: String,
    opts: UpdateCommandOptions,
) -> CommandResult<CommandItem> {
    {
        let mut conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
        
        let tx = conn.transaction().map_err(|e| CommandError::Internal(e.to_string()))?;
        
        if let Some(ref name) = opts.name {
            tx.execute("UPDATE commands SET name = ?1 WHERE id = ?2", rusqlite::params![name, id])
                .map_err(|e| CommandError::Internal(e.to_string()))?;
        }
        if let Some(ref cmd) = opts.command {
            tx.execute("UPDATE commands SET command = ?1 WHERE id = ?2", rusqlite::params![cmd, id])
                .map_err(|e| CommandError::Internal(e.to_string()))?;
        }
        if let Some(ref cat) = opts.category {
            tx.execute("UPDATE commands SET category = ?1 WHERE id = ?2", rusqlite::params![cat, id])
                .map_err(|e| CommandError::Internal(e.to_string()))?;
        }
        if let Some(ref icon) = opts.icon {
            tx.execute("UPDATE commands SET icon = ?1 WHERE id = ?2", rusqlite::params![icon, id])
                .map_err(|e| CommandError::Internal(e.to_string()))?;
        }
        if let Some(dest) = opts.is_destructive {
            let is_dest_int = if dest { 1 } else { 0 };
            tx.execute("UPDATE commands SET is_destructive = ?1 WHERE id = ?2", rusqlite::params![is_dest_int, id])
                .map_err(|e| CommandError::Internal(e.to_string()))?;
        }
        
        tx.commit().map_err(|e| CommandError::Internal(e.to_string()))?;
    }
    
    get_command(state, id).await
}

#[tauri::command]
pub async fn delete_command(
    state: tauri::State<'_, AppState>,
    id: String,
    confirmation_token: Option<String>,
) -> CommandResult<()> {
    // Check if command is destructive before demanding token
    let is_destructive = {
        let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
        conn.query_row(
            "SELECT is_destructive FROM commands WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok(row.get::<_, i32>(0)? == 1)
        ).unwrap_or(false)
    };

    if is_destructive {
        crate::commands::confirmation::consume_token(confirmation_token.as_deref()).await?;
    }

    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    conn.execute(
        "DELETE FROM commands WHERE id = ?1",
        rusqlite::params![id]
    ).map_err(|e| CommandError::Internal(e.to_string()))?;
    
    Ok(())
}

#[tauri::command]
pub async fn run_server_command(
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
    server_id: String,
    command_text: String,
    command_name: Option<String>,
    confirmation_token: Option<String>,
) -> CommandResult<CommandOutput> {
    if command_text.trim().is_empty() {
        return Err(CommandError::InvalidInput("Command cannot be empty".into()));
    }
    
    // Check if command_name matches a stored command that is marked destructive
    // If we only have the raw command_text, we could also do a generic token requirement
    // but the spec says "run_command when the underlying stored command has is_destructive = true"
    // So we lookup if there is a command with this name/text that is destructive.
    let is_destructive = {
        let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
        let name = command_name.as_deref().unwrap_or("");
        conn.query_row(
            "SELECT is_destructive FROM commands WHERE name = ?1 AND command = ?2",
            rusqlite::params![name, command_text],
            |row| Ok(row.get::<_, i32>(0)? == 1)
        ).unwrap_or(false)
    };

    if is_destructive {
        crate::commands::confirmation::consume_token(confirmation_token.as_deref()).await?;
    }

    let mut channel = {
        let session_arc = state.session_manager.get_or_connect(
            server_id.clone(), 
            state.db.clone(), 
            app_handle.clone()
        ).await?;
        
        let chan_res = {
            let session = session_arc.lock().await;
            session.channel_open_session().await
        };
        
        match chan_res {
            Ok(chan) => chan,
            Err(e) => {
                log::warn!("Failed to open channel ({}), evicting session and reconnecting...", e);
                state.session_manager.evict_session(&server_id).await;
                let new_session_arc = state.session_manager.get_or_connect(
                    server_id.clone(), 
                    state.db.clone(), 
                    app_handle
                ).await?;
                let new_session = new_session_arc.lock().await;
                new_session.channel_open_session().await
                    .map_err(|e2| CommandError::Internal(format!("Failed to open SSH channel: {}", e2)))?
            }
        }
    };

    channel.exec(true, command_text.as_str()).await
        .map_err(|e| CommandError::Internal(format!("Failed to execute command: {}", e)))?;

    let mut combined_output = String::new();
    let mut exit_code: Option<i32> = None;
    let start_time = Instant::now();
    let timeout_duration = Duration::from_secs(60 * 5); // 5 minute max timeout

    let max_output_len = 1024 * 1024; // Cap at 1MB

    loop {
        let msg_future = channel.wait();
        let msg_opt = match timeout(timeout_duration, msg_future).await {
            Ok(opt) => opt,
            Err(_) => {
                let _ = channel.close().await;
                return Err(CommandError::Internal("Command timed out after 5 minutes".into()));
            }
        };

        match msg_opt {
            Some(ChannelMsg::Data { ref data }) => {
                if combined_output.len() < max_output_len {
                    combined_output.push_str(&String::from_utf8_lossy(data));
                }
            }
            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                if combined_output.len() < max_output_len {
                    combined_output.push_str(&String::from_utf8_lossy(data));
                }
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = Some(exit_status as i32);
            }
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                break;
            }
            _ => {}
        }
    }

    let _ = channel.close().await;

    let duration_ms = start_time.elapsed().as_millis() as i64;
    
    if combined_output.len() >= max_output_len {
        combined_output.push_str("\n...[Output truncated, exceeded 1MB limit]...");
    }

    let sanitized_output = crate::secrets::redact::redact_secrets(&combined_output);

    // Write Activity Log
    let final_status = if let Some(0) = exit_code { "success" } else { "failed" };
    let detail = if let Some(0) = exit_code {
        format!("Command completed successfully in {} ms.", duration_ms)
    } else {
        format!("Command failed with exit code {:?}. Output: {}", exit_code, 
            sanitized_output.chars().take(200).collect::<String>())
    };

    if let Ok(conn) = state.db.lock() {
        let display_name = command_name.unwrap_or_else(|| "Custom Command".into());
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: "run_command".into(),
            target: Some(display_name),
            status: final_status.into(),
            detail: Some(detail),
            duration_ms: Some(duration_ms),
        });
    }

    Ok(CommandOutput {
        output: sanitized_output,
        exit_code,
        duration_ms,
    })
}
