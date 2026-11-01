use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::db::{log_activity, ActivityEntry, actions};
use crate::commands::confirmation::consume_token;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::time::Instant;
use russh::ChannelMsg;
use tokio::time::{timeout, Duration};
use tokio::io::AsyncWriteExt;
use tauri::Manager;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadBackupResult {
    pub local_path: String,
    pub bytes_written: u64,
}

#[derive(Debug, Deserialize)]
pub struct CreateBackupOptions {
    pub target_type: String, // "postgres", "mysql", "redis", "directory", "custom"
    pub target_name: String,
    pub destination_dir: Option<String>,
    pub db_user: Option<String>,
    pub db_password: Option<String>,
    pub db_host: Option<String>,
    pub db_port: Option<u16>,
    pub custom_command: Option<String>,
}

#[derive(Debug, Default)]
pub struct SshCommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_status: Option<u32>,
}

fn escape_bash(s: &str) -> String {
    s.replace('\'', "'\\''")
}

async fn exec_ssh_command_full(
    session: &mut Handle<SshClientHandler>,
    cmd: &str,
    timeout_duration: Duration,
) -> Result<SshCommandOutput, CommandError> {
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
                return Err(CommandError::Internal("SSH command timed out".into()));
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
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                break;
            }
            _ => {}
        }
    }
    
    let _ = channel.close().await;
    Ok(SshCommandOutput { stdout, stderr, exit_status: exit_code })
}

async fn exec_ssh_command(
    session: &mut Handle<SshClientHandler>,
    cmd: &str,
) -> Result<String, CommandError> {
    let out = exec_ssh_command_full(session, cmd, Duration::from_secs(120)).await?;
    if let Some(code) = out.exit_status {
        if code != 0 && out.stdout.is_empty() && !out.stderr.is_empty() {
            return Err(CommandError::Internal(out.stderr.trim().to_string()));
        }
    }
    Ok(out.stdout)
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
        "postgres" => {
            let user = options.db_user.as_deref().unwrap_or("").trim();
            let pass = options.db_password.as_deref().unwrap_or("").trim();
            let host = options.db_host.as_deref().unwrap_or("").trim();
            let port = options.db_port.unwrap_or(5432);
            let target = escape_bash(&options.target_name);
            let dest = escape_bash(&dest_file);

            format!(
                r#"bash -c '
set -e
set -o pipefail

DEST="{dest}"
TARGET="{target}"
USER="{user}"
PASS="{pass}"
HOST="{host}"
PORT="{port}"

run_dump() {{
    # 1. If explicit password or remote host provided, use standard TCP/auth
    if [ -n "$PASS" ] || [ -n "$HOST" ]; then
        export PGPASSWORD="$PASS"
        H_ARG=""
        [ -n "$HOST" ] && H_ARG="-h $HOST"
        U_ARG=""
        [ -n "$USER" ] && U_ARG="-U $USER"
        pg_dump $H_ARG -p "$PORT" $U_ARG "$TARGET"
        return $?
    fi

    # 2. If explicit user provided (without pass/host)
    if [ -n "$USER" ]; then
        if [ "$(id -u)" -eq 0 ] && id -u "$USER" >/dev/null 2>&1; then
            sudo -u "$USER" pg_dump "$TARGET"
            return $?
        elif pg_dump -U "$USER" "$TARGET" 2>/dev/null; then
            return 0
        fi
    fi

    # 3. Running as root (default SSH login) -> standard Ubuntu/Debian peer auth as postgres
    if [ "$(id -u)" -eq 0 ]; then
        if id -u postgres >/dev/null 2>&1; then
            sudo -u postgres pg_dump "$TARGET"
            return $?
        elif su - postgres -c "pg_dump \"$TARGET\"" 2>/dev/null; then
            return 0
        fi
    fi

    # 4. Try pg_dump directly
    if pg_dump "$TARGET" 2>/dev/null; then
        return 0
    fi

    # 5. Check if running inside a Docker container
    if command -v docker >/dev/null 2>&1; then
        DOCKER_PG=$(docker ps --format "{{{{.Names}}}} {{{{.Image}}}}" 2>/dev/null | grep -iE "postgres|timescale" | awk "{{print \$1}}" | head -n 1)
        if [ -n "$DOCKER_PG" ]; then
            U_NAME="${{USER:-postgres}}"
            docker exec "$DOCKER_PG" pg_dump -U "$U_NAME" "$TARGET"
            return $?
        fi
    fi

    # 6. Final direct attempt capturing stderr
    pg_dump -U "${{USER:-postgres}}" "$TARGET"
}}

# Execute dump pipeline into compressed archive
run_dump | gzip > "$DEST"

# Verification
if [ ! -f "$DEST" ]; then
    echo "ERROR: Backup archive was not created on disk" >&2
    exit 1
fi

SIZE=$(wc -c < "$DEST" | tr -d " ")
if [ "$SIZE" -le 40 ]; then
    rm -f "$DEST"
    echo "ERROR: PostgreSQL dump produced 0 data bytes (empty backup). Please check that database \"$TARGET\" exists and is accessible." >&2
    exit 1
fi
echo "SUCCESS:$SIZE"
'"#
            )
        },
        "mysql" => {
            let user = options.db_user.as_deref().unwrap_or("").trim();
            let pass = options.db_password.as_deref().unwrap_or("").trim();
            let host = options.db_host.as_deref().unwrap_or("").trim();
            let port = options.db_port.unwrap_or(3306);
            let target = escape_bash(&options.target_name);
            let dest = escape_bash(&dest_file);

            format!(
                r#"bash -c '
set -e
set -o pipefail

DEST="{dest}"
TARGET="{target}"
USER="{user}"
PASS="{pass}"
HOST="{host}"
PORT="{port}"

run_dump() {{
    if [ -n "$PASS" ]; then
        MYSQL_PWD="$PASS" mysqldump -u "${{USER:-root}}" ${{HOST:+-h "$HOST"}} -P "$PORT" "$TARGET"
        return $?
    fi

    if [ -f /etc/mysql/debian.cnf ]; then
        mysqldump --defaults-file=/etc/mysql/debian.cnf "$TARGET"
        return $?
    fi

    if [ "$(id -u)" -eq 0 ]; then
        if sudo mysqldump "$TARGET" 2>/dev/null; then
            return 0
        fi
    fi

    if command -v docker >/dev/null 2>&1; then
        DOCKER_MYSQL=$(docker ps --format "{{{{.Names}}}} {{{{.Image}}}}" 2>/dev/null | grep -iE "mysql|mariadb" | awk "{{print \$1}}" | head -n 1)
        if [ -n "$DOCKER_MYSQL" ]; then
            docker exec "$DOCKER_MYSQL" mysqldump -u "${{USER:-root}}" "$TARGET"
            return $?
        fi
    fi

    mysqldump -u "${{USER:-root}}" "$TARGET"
}}

run_dump | gzip > "$DEST"

if [ ! -f "$DEST" ]; then
    echo "ERROR: Backup archive was not created on disk" >&2
    exit 1
fi

SIZE=$(wc -c < "$DEST" | tr -d " ")
if [ "$SIZE" -le 40 ]; then
    rm -f "$DEST"
    echo "ERROR: MySQL dump produced 0 data bytes (empty backup). Please check that database \"$TARGET\" exists." >&2
    exit 1
fi
echo "SUCCESS:$SIZE"
'"#
            )
        },
        "redis" => {
            let dest = escape_bash(&dest_file);
            format!(
                r#"bash -c '
set -e
redis-cli bgsave 2>/dev/null || true
sleep 2
RDB_FILE=""
if [ -f /var/lib/redis/dump.rdb ]; then
    RDB_FILE="/var/lib/redis/dump.rdb"
elif [ -f /var/lib/redis/6379/dump.rdb ]; then
    RDB_FILE="/var/lib/redis/6379/dump.rdb"
fi

if [ -n "$RDB_FILE" ]; then
    cp "$RDB_FILE" "{dest}"
elif command -v docker >/dev/null 2>&1; then
    DOCKER_REDIS=$(docker ps --format "{{{{.Names}}}} {{{{.Image}}}}" 2>/dev/null | grep -iE "redis" | awk "{{print \$1}}" | head -n 1)
    if [ -n "$DOCKER_REDIS" ]; then
        docker exec "$DOCKER_REDIS" redis-cli bgsave 2>/dev/null || true
        sleep 2
        docker cp "$DOCKER_REDIS:/data/dump.rdb" "{dest}" 2>/dev/null || docker cp "$DOCKER_REDIS:/var/lib/redis/dump.rdb" "{dest}"
    fi
fi

if [ ! -f "{dest}" ] || [ "$(wc -c < "{dest}" | tr -d " ")" -le 10 ]; then
    echo "ERROR: Redis dump.rdb could not be located or copied" >&2
    exit 1
fi
'"#
            )
        },
        "directory" => {
            let target = escape_bash(&options.target_name);
            let dest = escape_bash(&dest_file);
            format!(
                r#"bash -c '
set -e
set -o pipefail
if [ ! -d "{target}" ]; then
    echo "ERROR: Directory \"{target}\" does not exist" >&2
    exit 1
fi
tar -czf "{dest}" -C "$(dirname "{target}")" "$(basename "{target}")"
SIZE=$(wc -c < "{dest}" 2>/dev/null | tr -d " ")
if [ ! -f "{dest}" ] || [ "$SIZE" -le 40 ]; then
    rm -f "{dest}"
    echo "ERROR: Directory archive produced 0 bytes" >&2
    exit 1
fi
'"#
            )
        },
        "custom" => {
            if let Some(ref custom) = options.custom_command {
                custom.replace("{{dest}}", &dest_file)
            } else {
                format!("tar -czf \"{}\" \"{}\"", dest_file, options.target_name)
            }
        },
        _ => format!("tar -czf \"{}\" \"{}\"", dest_file, options.target_name),
    };

    let exec_res = exec_ssh_command_full(&mut session, &dump_cmd, Duration::from_secs(300)).await;

    // 4. Determine file size & validate outcome
    let mut size_bytes = None;
    let mut status = "success";
    let mut error_detail = None;

    match exec_res {
        Ok(out) => {
            if out.exit_status.unwrap_or(0) != 0 {
                status = "failed";
                let err = if !out.stderr.trim().is_empty() {
                    out.stderr.trim().to_string()
                } else if !out.stdout.trim().is_empty() {
                    out.stdout.trim().to_string()
                } else {
                    format!("Command exited with non-zero exit status {:?}", out.exit_status)
                };
                error_detail = Some(err);
            } else {
                let size_check_cmd = format!(
                    "stat -c %s \"{}\" 2>/dev/null || stat -f %z \"{}\" 2>/dev/null || wc -c < \"{}\"",
                    dest_file, dest_file, dest_file
                );
                if let Ok(size_out) = exec_ssh_command_full(&mut session, &size_check_cmd, Duration::from_secs(10)).await {
                    if let Ok(bytes) = size_out.stdout.trim().parse::<i64>() {
                        if bytes > 40 {
                            size_bytes = Some(bytes);
                        } else {
                            status = "failed";
                            error_detail = Some("Backup file is empty (<= 40 bytes)".into());
                            let _ = exec_ssh_command(&mut session, &format!("rm -f \"{}\"", dest_file)).await;
                        }
                    }
                }
            }
        }
        Err(e) => {
            status = "failed";
            error_detail = Some(e.to_string());
        }
    }

    let now_iso = chrono::Utc::now().to_rfc3339();

    // 5. Store in DB
    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        if status == "success" {
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
        }

        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id.clone()),
            action: actions::CREATE_BACKUP.into(),
            target: Some(options.target_name.clone()),
            status: status.into(),
            detail: error_detail.clone().or_else(|| Some(format!("Created backup: {} ({} bytes)", dest_file, size_bytes.unwrap_or(0)))),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    if status == "failed" {
        let msg = error_detail.unwrap_or_else(|| "Backup command execution failed on remote server".into());
        return Err(CommandError::Internal(msg));
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
        let escaped_dest = escape_bash(&destination);
        let escaped_target = escape_bash(&target);
        if destination.contains("pg_") {
            format!(
                r#"bash -c '
set -e
set -o pipefail
DEST="{escaped_dest}"
TARGET="{escaped_target}"

if [ "$(id -u)" -eq 0 ] && id -u postgres >/dev/null 2>&1; then
    gunzip -c "$DEST" | sudo -u postgres psql "$TARGET"
elif command -v docker >/dev/null 2>&1 && [ -n "$(docker ps --format "{{{{.Names}}}} {{{{.Image}}}}" 2>/dev/null | grep -iE "postgres|timescale" | awk "{{print \$1}}" | head -n 1)" ]; then
    D_PG=$(docker ps --format "{{{{.Names}}}} {{{{.Image}}}}" 2>/dev/null | grep -iE "postgres|timescale" | awk "{{print \$1}}" | head -n 1)
    gunzip -c "$DEST" | docker exec -i "$D_PG" psql -U postgres "$TARGET"
else
    gunzip -c "$DEST" | (psql -U postgres "$TARGET" 2>/dev/null || psql "$TARGET")
fi
'"#
            )
        } else {
            format!(
                r#"bash -c '
set -e
set -o pipefail
DEST="{escaped_dest}"
TARGET="{escaped_target}"

if [ -f /etc/mysql/debian.cnf ]; then
    gunzip -c "$DEST" | mysql --defaults-file=/etc/mysql/debian.cnf "$TARGET"
elif [ "$(id -u)" -eq 0 ]; then
    gunzip -c "$DEST" | (sudo mysql "$TARGET" 2>/dev/null || mysql -u root "$TARGET")
else
    gunzip -c "$DEST" | mysql "$TARGET"
fi
'"#
            )
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

#[tauri::command]
pub async fn download_backup(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    backup_id: String,
    target_local_dir: Option<String>,
) -> CommandResult<DownloadBackupResult> {
    let start_time = Instant::now();

    // 1. Validate & fetch backup record
    let destination = {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        let mut stmt = conn.prepare("SELECT destination FROM backups WHERE id = ?1 AND server_id = ?2")
            .map_err(|e| CommandError::Database(e.to_string()))?;
        stmt.query_row([&backup_id, &server_id], |r| r.get::<_, String>(0))
            .map_err(|_| CommandError::NotFound(format!("Backup {} not found", backup_id)))?
    };

    // 2. Resolve destination local folder & file path
    let filename = std::path::Path::new(&destination)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("backup_archive.tar.gz");

    let local_dir = if let Some(custom) = target_local_dir.filter(|s| !s.trim().is_empty()) {
        std::path::PathBuf::from(custom)
    } else {
        app_handle.path().download_dir()
            .map_err(|e| CommandError::Internal(format!("Failed to locate downloads folder: {}", e)))?
    };

    tokio::fs::create_dir_all(&local_dir).await
        .map_err(|e| CommandError::Internal(format!("Failed to create directory {:?}: {}", local_dir, e)))?;

    let local_file_path = local_dir.join(filename);

    // 3. Acquire pooled SSH session
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;

    // 4. Stream remote file via cat command
    let mut file = tokio::fs::File::create(&local_file_path).await
        .map_err(|e| CommandError::Internal(format!("Failed to create local file {:?}: {}", local_file_path, e)))?;

    let mut bytes_written: u64 = 0;
    {
        let session = session_arc.lock().await;
        let mut channel = session.channel_open_session().await
            .map_err(|e| CommandError::Internal(format!("Failed to open SSH channel: {}", e)))?;

        let cat_cmd = format!("cat \"{}\"", destination);
        channel.exec(true, cat_cmd).await
            .map_err(|e| CommandError::Internal(format!("Failed to stream file over SSH: {}", e)))?;

        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { ref data }) => {
                    file.write_all(data).await
                        .map_err(|e| CommandError::Internal(format!("Failed writing to local file: {}", e)))?;
                    bytes_written += data.len() as u64;
                }
                Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                    let err_str = String::from_utf8_lossy(data);
                    if !err_str.trim().is_empty() {
                        eprintln!("Download backup remote stderr: {}", err_str);
                    }
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                    break;
                }
                _ => {}
            }
        }
        let _ = channel.close().await;
    }
    file.flush().await
        .map_err(|e| CommandError::Internal(format!("Failed to flush downloaded file: {}", e)))?;

    // 5. Audit log
    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::DOWNLOAD_BACKUP.into(),
            target: Some(destination),
            status: "success".into(),
            detail: Some(format!("Downloaded backup to {:?} ({} bytes)", local_file_path, bytes_written)),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    Ok(DownloadBackupResult {
        local_path: local_file_path.to_string_lossy().to_string(),
        bytes_written,
    })
}
