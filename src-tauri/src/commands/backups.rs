use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::db::{log_activity, ActivityEntry, actions};
use crate::commands::confirmation::consume_token;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::time::Instant;
use russh::ChannelMsg;
use tokio::time::{timeout, Duration};
use crate::ssh::client::SshClientHandler;
use russh::client::Handle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupRecord {
    pub id: String,
    pub server_id: String,
    pub target: String,
    pub destination: String,
    pub size_bytes: Option<i64>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateBackupOptions {
    pub target_type: String, // "postgres", "mysql", "redis", "directory", "custom"
    pub target_name: String,
    pub destination_dir: Option<String>,
    pub custom_command: Option<String>,
}

async fn exec_ssh_command(
    session: &mut Handle<SshClientHandler>,
    cmd: &str,
) -> Result<String, CommandError> {
    let mut channel = session.channel_open_session().await
        .map_err(|e| CommandError::Internal(format!("Failed to open SSH channel: {}", e)))?;

    channel.exec(true, cmd).await
        .map_err(|e| CommandError::Internal(format!("Failed to exec command '{}': {}", cmd, e)))?;

    let mut output = String::new();
    let timeout_duration = Duration::from_secs(120); // allow up to 2 mins for dump
    
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
pub async fn list_backups(
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> CommandResult<Vec<BackupRecord>> {
    let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, server_id, target, destination, size_bytes, status, created_at
         FROM backups
         WHERE server_id = ?1
         ORDER BY created_at DESC"
    ).map_err(|e| CommandError::Database(e.to_string()))?;

    let rows = stmt.query_map([&server_id], |row| {
        Ok(BackupRecord {
            id: row.get(0)?,
            server_id: row.get(1)?,
            target: row.get(2)?,
            destination: row.get(3)?,
            size_bytes: row.get(4)?,
            status: row.get(5)?,
            created_at: row.get(6)?,
        })
    }).map_err(|e| CommandError::Database(e.to_string()))?;

    let mut results = Vec::new();
    for r in rows {
        if let Ok(item) = r {
            results.push(item);
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn create_backup(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    options: CreateBackupOptions,
) -> CommandResult<BackupRecord> {
    if options.target_name.trim().is_empty() {
        return Err(CommandError::Validation("Target name/path cannot be empty".into()));
    }

    let backup_id = Uuid::new_v4().to_string();
    let dest_dir = options.destination_dir.as_deref().unwrap_or("/var/backups");
    let timestamp_str = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let sanitized_target = options.target_name.replace(['/', '\\', ' '], "_");
    
    let dest_file = match options.target_type.as_str() {
        "postgres" => format!("{}/pg_{}_{}.sql.gz", dest_dir, sanitized_target, timestamp_str),
        "mysql" => format!("{}/mysql_{}_{}.sql.gz", dest_dir, sanitized_target, timestamp_str),
        "redis" => format!("{}/redis_{}_{}.rdb", dest_dir, sanitized_target, timestamp_str),
        _ => format!("{}/backup_{}_{}.tar.gz", dest_dir, sanitized_target, timestamp_str),
    };

    let start_time = Instant::now();

    // 1. Acquire pooled SSH session
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    // 2. Prepare destination directory on remote
    let mkdir_cmd = format!("mkdir -p {}", dest_dir);
    let _ = exec_ssh_command(&mut session, &mkdir_cmd).await;

    // 3. Build backup command
    let dump_cmd = match options.target_type.as_str() {
        "postgres" => format!("pg_dump \"{}\" | gzip > \"{}\"", options.target_name, dest_file),
        "mysql" => format!("mysqldump \"{}\" | gzip > \"{}\"", options.target_name, dest_file),
        "redis" => format!("redis-cli bgsave && sleep 2 && (cp /var/lib/redis/dump.rdb \"{}\" || cp /var/lib/redis/6379/dump.rdb \"{}\")", dest_file, dest_file),
        "custom" => {
            if let Some(ref custom) = options.custom_command {
                custom.replace("{{dest}}", &dest_file)
            } else {
                format!("tar -czf \"{}\" \"{}\"", dest_file, options.target_name)
            }
        },
        _ => format!("tar -czf \"{}\" \"{}\"", dest_file, options.target_name),
    };

    let exec_res = exec_ssh_command(&mut session, &dump_cmd).await;

    // 4. Determine file size
    let mut size_bytes = None;
    let mut status = "success";
    let mut error_detail = None;

    if exec_res.is_ok() {
        let size_check_cmd = format!("stat -c %s \"{}\" 2>/dev/null || stat -f %z \"{}\" 2>/dev/null || wc -c < \"{}\"", dest_file, dest_file, dest_file);
        if let Ok(size_out) = exec_ssh_command(&mut session, &size_check_cmd).await {
            if let Ok(bytes) = size_out.trim().parse::<i64>() {
                size_bytes = Some(bytes);
            }
        }
    } else {
        status = "failed";
        error_detail = exec_res.err().map(|e| e.to_string());
    }

    let now_iso = chrono::Utc::now().to_rfc3339();

    // 5. Store in DB
    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        conn.execute(
            "INSERT INTO backups (id, server_id, target, destination, size_bytes, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                backup_id,
                server_id,
                options.target_name,
                dest_file,
                size_bytes,
                status,
                now_iso
            ],
        ).map_err(|e| CommandError::Database(e.to_string()))?;

        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id.clone()),
            action: actions::CREATE_BACKUP.into(),
            target: Some(options.target_name.clone()),
            status: status.into(),
            detail: error_detail.or_else(|| Some(format!("Created backup: {} ({} bytes)", dest_file, size_bytes.unwrap_or(0)))),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    if status == "failed" {
        return Err(CommandError::Internal("Backup command execution failed on remote server".into()));
    }

    Ok(BackupRecord {
        id: backup_id,
        server_id,
        target: options.target_name,
        destination: dest_file,
        size_bytes,
        status: status.into(),
        created_at: now_iso,
    })
}

#[tauri::command]
pub async fn restore_backup(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    backup_id: String,
    confirmation_token: Option<String>,
) -> CommandResult<()> {
    // 1. Authorize - Verify confirmation token for destructive restore
    consume_token(confirmation_token.as_deref()).await?;

    let start_time = Instant::now();
    let (target, destination) = {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        let mut stmt = conn.prepare("SELECT target, destination FROM backups WHERE id = ?1 AND server_id = ?2")
            .map_err(|e| CommandError::Database(e.to_string()))?;
        stmt.query_row([&backup_id, &server_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        }).map_err(|_| CommandError::NotFound(format!("Backup {} not found", backup_id)))?
    };

    // 2. Acquire SSH Session
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    // 3. Build restore command
    let restore_cmd = if destination.ends_with(".sql.gz") {
        if destination.contains("pg_") {
            format!("gunzip -c \"{}\" | psql \"{}\"", destination, target)
        } else {
            format!("gunzip -c \"{}\" | mysql \"{}\"", destination, target)
        }
    } else if destination.ends_with(".rdb") {
        format!("sudo systemctl stop redis && cp \"{}\" /var/lib/redis/dump.rdb && sudo systemctl start redis", destination)
    } else {
        format!("tar -xzf \"{}\" -C /", destination)
    };

    let result = exec_ssh_command(&mut session, &restore_cmd).await;

    // 4. Audit
    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id.clone()),
            action: actions::RESTORE_BACKUP.into(),
            target: Some(target),
            status: if result.is_ok() { "success".into() } else { "failed".into() },
            detail: result.as_ref().err().map(|e| e.to_string()),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    result.map(|_| ())
}

#[tauri::command]
pub async fn delete_backup(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    backup_id: String,
) -> CommandResult<()> {
    let start_time = Instant::now();
    let destination: Option<String> = {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        let mut stmt = conn.prepare("SELECT destination FROM backups WHERE id = ?1 AND server_id = ?2")
            .map_err(|e| CommandError::Database(e.to_string()))?;
        stmt.query_row([&backup_id, &server_id], |r| r.get(0)).ok()
    };

    if let Some(dest_file) = destination {
        if let Ok(session_arc) = state.session_manager.get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone()).await {
            let mut session = session_arc.lock().await;
            let rm_cmd = format!("rm -f \"{}\"", dest_file);
            let _ = exec_ssh_command(&mut session, &rm_cmd).await;
        }
    }

    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        conn.execute("DELETE FROM backups WHERE id = ?1 AND server_id = ?2", rusqlite::params![backup_id, server_id])
            .map_err(|e| CommandError::Database(e.to_string()))?;

        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::DELETE_BACKUP.into(),
            target: Some(backup_id),
            status: "success".into(),
            detail: Some("Deleted remote backup archive and database record".into()),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    Ok(())
}
