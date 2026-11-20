use base64::engine::general_purpose::STANDARD as b64;
use base64::Engine as _;
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

// ─────────────────────────────────────────────────────────────────────────────
// Backup Schedules (Server-Side Native Cron Jobs) & Cloud Storage Integration
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupSchedule {
    pub id: String,
    pub server_id: String,
    pub name: String,
    pub target_type: String,
    pub target_name: String,
    pub cron_expression: String,
    pub destination_dir: String,
    pub retention_count: i64,
    pub db_user: Option<String>,
    pub db_password: Option<String>,
    pub db_host: Option<String>,
    pub db_port: Option<u16>,
    pub custom_command: Option<String>,
    pub storage_provider: String, // "none", "s3", "dropbox"
    pub storage_config: Option<String>,
    pub is_active: bool,
    pub remote_script_path: Option<String>,
    pub last_run_at: Option<String>,
    pub last_status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateBackupScheduleOptions {
    pub name: String,
    pub target_type: String,
    pub target_name: String,
    pub cron_expression: String,
    pub destination_dir: Option<String>,
    pub retention_count: Option<i64>,
    pub db_user: Option<String>,
    pub db_password: Option<String>,
    pub db_host: Option<String>,
    pub db_port: Option<u16>,
    pub custom_command: Option<String>,
    pub storage_provider: Option<String>,
    pub storage_config: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudStorageConfig {
    pub id: String,
    pub name: String,
    pub provider: String, // "s3" or "dropbox"
    pub config_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct SaveCloudStorageConfigOptions {
    pub id: Option<String>,
    pub name: String,
    pub provider: String,
    pub config_json: String,
}

#[derive(Debug, Serialize)]
pub struct TestCloudStorageResult {
    pub success: bool,
    pub message: String,
    pub details: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CloudUploadResult {
    pub success: bool,
    pub message: String,
    pub remote_path: String,
}

#[derive(Debug, Serialize)]
pub struct ScheduleRunResult {
    pub success: bool,
    pub message: String,
    pub output: String,
    pub backup_record: Option<BackupRecord>,
}

/// Generates a standalone, self-contained bash script that executes on the remote server
/// under Linux cron independently of whether Server Command Center is currently active.
fn generate_cron_backup_script(
    schedule_id: &str,
    name: &str,
    target_type: &str,
    target_name: &str,
    destination_dir: &str,
    retention_count: i64,
    db_user: Option<&str>,
    db_password: Option<&str>,
    db_host: Option<&str>,
    db_port: Option<u16>,
    custom_command: Option<&str>,
    storage_provider: &str,
    storage_config_json: Option<&str>,
    script_dir: &str,
) -> String {
    let sanitized_target = target_name.replace(['/', '\\', ' '], "_");
    let (prefix, ext) = match target_type {
        "postgres" => ("pg", "sql.gz"),
        "mysql" => ("mysql", "sql.gz"),
        "redis" => ("redis", "rdb"),
        _ => ("backup", "tar.gz"),
    };

    let dump_logic = match target_type {
        "postgres" => {
            let u = db_user.unwrap_or("").trim();
            let p = db_password.unwrap_or("").trim();
            let h = db_host.unwrap_or("").trim();
            let pt = db_port.unwrap_or(5432);
            format!(
                r#"run_dump() {{
    if [ -n "{p}" ] || [ -n "{h}" ]; then
        export PGPASSWORD="{p}"
        pg_dump {h_arg} -p "{pt}" {u_arg} "{target_name}"
        return $?
    fi
    if [ -n "{u}" ]; then
        if [ "$(id -u)" -eq 0 ] && id -u "{u}" >/dev/null 2>&1; then
            sudo -u "{u}" pg_dump "{target_name}"
            return $?
        elif pg_dump -U "{u}" "{target_name}" 2>/dev/null; then
            return 0
        fi
    fi
    if [ "$(id -u)" -eq 0 ]; then
        if id -u postgres >/dev/null 2>&1; then
            sudo -u postgres pg_dump "{target_name}"
            return $?
        elif su - postgres -c "pg_dump \"{target_name}\"" 2>/dev/null; then
            return 0
        fi
    fi
    if pg_dump "{target_name}" 2>/dev/null; then
        return 0
    fi
    if command -v docker >/dev/null 2>&1; then
        DOCKER_PG=$(docker ps --format "{{{{.Names}}}} {{{{.Image}}}}" 2>/dev/null | grep -iE "postgres|timescale" | awk '{{print $1}}' | head -n 1)
        if [ -n "$DOCKER_PG" ]; then
            docker exec "$DOCKER_PG" pg_dump -U "{u_fallback}" "{target_name}"
            return $?
        fi
    fi
    pg_dump -U "{u_fallback}" "{target_name}"
}}
run_dump | gzip > "$DEST_FILE""#,
                p = escape_bash(p),
                h = escape_bash(h),
                h_arg = if !h.is_empty() { format!("-h \"{}\"", escape_bash(h)) } else { "".into() },
                u_arg = if !u.is_empty() { format!("-U \"{}\"", escape_bash(u)) } else { "".into() },
                pt = pt,
                target_name = escape_bash(target_name),
                u = escape_bash(u),
                u_fallback = if !u.is_empty() { escape_bash(u) } else { "postgres".into() }
            )
        },
        "mysql" => {
            let u = db_user.unwrap_or("").trim();
            let p = db_password.unwrap_or("").trim();
            let h = db_host.unwrap_or("").trim();
            let pt = db_port.unwrap_or(3306);
            format!(
                r#"run_dump() {{
    if [ -n "{p}" ]; then
        MYSQL_PWD="{p}" mysqldump -u "{u_fallback}" {h_arg} -P "{pt}" "{target_name}"
        return $?
    fi
    if [ -f /etc/mysql/debian.cnf ]; then
        mysqldump --defaults-file=/etc/mysql/debian.cnf "{target_name}"
        return $?
    fi
    if [ "$(id -u)" -eq 0 ]; then
        if sudo mysqldump "{target_name}" 2>/dev/null; then
            return 0
        fi
    fi
    if command -v docker >/dev/null 2>&1; then
        DOCKER_MYSQL=$(docker ps --format "{{{{.Names}}}} {{{{.Image}}}}" 2>/dev/null | grep -iE "mysql|mariadb" | awk '{{print $1}}' | head -n 1)
        if [ -n "$DOCKER_MYSQL" ]; then
            docker exec "$DOCKER_MYSQL" mysqldump -u "{u_fallback}" "{target_name}"
            return $?
        fi
    fi
    mysqldump -u "{u_fallback}" "{target_name}"
}}
run_dump | gzip > "$DEST_FILE""#,
                p = escape_bash(p),
                u_fallback = if !u.is_empty() { escape_bash(u) } else { "root".into() },
                h_arg = if !h.is_empty() { format!("-h \"{}\"", escape_bash(h)) } else { "".into() },
                pt = pt,
                target_name = escape_bash(target_name)
            )
        },
        "redis" => {
            format!(
                r#"redis-cli bgsave 2>/dev/null || true
sleep 2
RDB_FILE=""
if [ -f /var/lib/redis/dump.rdb ]; then
    RDB_FILE="/var/lib/redis/dump.rdb"
elif [ -f /var/lib/redis/6379/dump.rdb ]; then
    RDB_FILE="/var/lib/redis/6379/dump.rdb"
fi
if [ -n "$RDB_FILE" ]; then
    cp "$RDB_FILE" "$DEST_FILE"
elif command -v docker >/dev/null 2>&1; then
    DOCKER_REDIS=$(docker ps --format "{{{{.Names}}}} {{{{.Image}}}}" 2>/dev/null | grep -iE "redis" | awk '{{print $1}}' | head -n 1)
    if [ -n "$DOCKER_REDIS" ]; then
        docker exec "$DOCKER_REDIS" redis-cli bgsave 2>/dev/null || true
        sleep 2
        docker cp "$DOCKER_REDIS:/data/dump.rdb" "$DEST_FILE" 2>/dev/null || docker cp "$DOCKER_REDIS:/var/lib/redis/dump.rdb" "$DEST_FILE"
    fi
fi"#
            )
        },
        "directory" => {
            let target = escape_bash(target_name);
            format!(
                r#"if [ ! -d "{target}" ]; then
    echo "ERROR: Directory \"{target}\" does not exist" >&2
    exit 1
fi
tar -czf "$DEST_FILE" -C "$(dirname "{target}")" "$(basename "{target}")""#,
                target = target
            )
        },
        _ => {
            if let Some(cmd) = custom_command {
                cmd.replace("{{dest}}", "\"$DEST_FILE\"")
            } else {
                format!("tar -czf \"$DEST_FILE\" \"{}\"", escape_bash(target_name))
            }
        }
    };

    let mut cloud_logic = String::new();
    if storage_provider == "dropbox" {
        if let Some(cfg_str) = storage_config_json {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(cfg_str) {
                let token = v["access_token"].as_str().unwrap_or("");
                let path = v["path"].as_str().unwrap_or("/ServerCommandCenter/Backups");
                if !token.is_empty() {
                    cloud_logic = format!(
                        r#"
# --- OFFSITE CLOUD: DROPBOX UPLOAD ---
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Uploading to Dropbox folder: {path}..."
DROPBOX_TOKEN="{token}"
DROPBOX_TARGET_DIR="{path}"
[[ "$DROPBOX_TARGET_DIR" != /* ]] && DROPBOX_TARGET_DIR="/$DROPBOX_TARGET_DIR"
DROPBOX_DEST_FILE="${{DROPBOX_TARGET_DIR%/}}/$(basename "$DEST_FILE")"

DBX_RESP=$(curl -s -X POST https://content.dropboxapi.com/2/files/upload \
  --header "Authorization: Bearer $DROPBOX_TOKEN" \
  --header "Dropbox-API-Arg: {{\"path\": \"$DROPBOX_DEST_FILE\",\"mode\": \"add\",\"autorename\": true,\"mute\": false}}" \
  --header "Content-Type: application/octet-stream" \
  --data-binary @"$DEST_FILE")

if echo "$DBX_RESP" | grep -q '"id":'; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Dropbox upload succeeded: $DROPBOX_DEST_FILE"
else
    echo "WARNING: Dropbox upload returned unexpected response: $DBX_RESP" >&2
fi
"#,
                        token = escape_bash(token),
                        path = escape_bash(path)
                    );
                }
            }
        }
    } else if storage_provider == "s3" {
        if let Some(cfg_str) = storage_config_json {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(cfg_str) {
                let bucket = v["bucket"].as_str().unwrap_or("");
                let region = v["region"].as_str().unwrap_or("us-east-1");
                let endpoint = v["endpoint"].as_str().unwrap_or("");
                let access_key = v["access_key_id"].as_str().or_else(|| v["access_key"].as_str()).unwrap_or("");
                let secret_key = v["secret_access_key"].as_str().or_else(|| v["secret_key"].as_str()).unwrap_or("");
                let prefix = v["prefix"].as_str().unwrap_or("");

                if !bucket.is_empty() && !access_key.is_empty() {
                    cloud_logic = format!(
                        r#"
# --- OFFSITE CLOUD: S3 UPLOAD ---
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Uploading to S3 bucket: {bucket}..."
S3_BUCKET="{bucket}"
S3_REGION="{region}"
S3_ENDPOINT="{endpoint}"
S3_ACCESS_KEY="{access_key}"
S3_SECRET_KEY="{secret_key}"
S3_PREFIX="{prefix}"
S3_FNAME="$(basename "$DEST_FILE")"
S3_KEY="${{S3_PREFIX:+${{S3_PREFIX%/}}/}}${{S3_FNAME}}"

if command -v aws >/dev/null 2>&1; then
    ENDPOINT_FLAG=""
    [ -n "$S3_ENDPOINT" ] && ENDPOINT_FLAG="--endpoint-url $S3_ENDPOINT"
    AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" AWS_DEFAULT_REGION="$S3_REGION" \
    aws s3 cp "$DEST_FILE" "s3://${{S3_BUCKET}}/${{S3_KEY}}" $ENDPOINT_FLAG
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] S3 upload succeeded via aws-cli: s3://${{S3_BUCKET}}/${{S3_KEY}}"
else
    # Lightweight pure-Python 3 SigV4 uploader (Zero dependencies, works on any modern Linux distro)
    python3 - << 'PY_EOF'
import sys, os, datetime, hashlib, hmac, urllib.request

bucket = os.environ.get("S3_BUCKET", "{bucket}")
region = os.environ.get("S3_REGION", "{region}")
endpoint = os.environ.get("S3_ENDPOINT", "{endpoint}")
access_key = os.environ.get("S3_ACCESS_KEY", "{access_key}")
secret_key = os.environ.get("S3_SECRET_KEY", "{secret_key}")
prefix = os.environ.get("S3_PREFIX", "{prefix}")
file_path = os.environ.get("DEST_FILE", "")

if not file_path or not os.path.exists(file_path):
    sys.exit(0)

fname = os.path.basename(file_path)
key = f"{{prefix.strip('/')}}/{{fname}}" if prefix.strip('/') else fname

proto = "https"
if not endpoint:
    if region in ("us-east-1", ""):
        host = f"{{bucket}}.s3.amazonaws.com"
    else:
        host = f"{{bucket}}.s3.{{region}}.amazonaws.com"
    url = f"https://{{host}}/{{key}}"
    canonical_uri = f"/{{key}}"
else:
    clean_ep = endpoint.replace("https://", "").replace("http://", "").rstrip("/")
    proto = "https" if "https" in endpoint else "http"
    host = clean_ep
    url = f"{{proto}}://{{host}}/{{bucket}}/{{key}}"
    canonical_uri = f"/{{bucket}}/{{key}}"

file_size = os.path.getsize(file_path)
h = hashlib.sha256()
with open(file_path, "rb") as f:
    for chunk in iter(lambda: f.read(1048576), b""):
        h.update(chunk)
payload_hash = h.hexdigest()
now = datetime.datetime.now(datetime.timezone.utc)
amz_date = now.strftime('%Y%m%dT%H%M%SZ')
date_stamp = now.strftime('%Y%m%d')

canonical_headers = f"host:{{host}}\nx-amz-content-sha256:{{payload_hash}}\nx-amz-date:{{amz_date}}\n"
signed_headers = "host;x-amz-content-sha256;x-amz-date"
canonical_request = f"PUT\n{{canonical_uri}}\n\n{{canonical_headers}}\n{{signed_headers}}\n{{payload_hash}}"

algorithm = "AWS4-HMAC-SHA256"
credential_scope = f"{{date_stamp}}/{{region}}/s3/aws4_request"
string_to_sign = f"{{algorithm}}\n{{amz_date}}\n{{credential_scope}}\n{{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}}"

def sign(k, m):
    return hmac.new(k, m.encode('utf-8'), hashlib.sha256).digest()

k_date = sign(('AWS4' + secret_key).encode('utf-8'), date_stamp)
k_region = sign(k_date, region)
k_service = sign(k_region, "s3")
k_signing = sign(k_service, "aws4_request")
signature = hmac.new(k_signing, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()

auth_header = f"{{algorithm}} Credential={{access_key}}/{{credential_scope}}, SignedHeaders={{signed_headers}}, Signature={{signature}}"

with open(file_path, "rb") as f:
    req = urllib.request.Request(url, data=f, method="PUT")
    req.add_header("Host", host)
    req.add_header("x-amz-date", amz_date)
    req.add_header("x-amz-content-sha256", payload_hash)
    req.add_header("Authorization", auth_header)
    req.add_header("Content-Type", "application/octet-stream")
    req.add_header("Content-Length", str(file_size))

    try:
        with urllib.request.urlopen(req, timeout=1800) as resp:
            if resp.status in (200, 204):
                print(f"S3 upload succeeded: {{url}}")
            else:
                print(f"S3 upload HTTP status {{resp.status}}", file=sys.stderr)
    except Exception as e:
        print(f"WARNING: S3 upload failed: {{e}}", file=sys.stderr)
PY_EOF
fi
"#,
                        bucket = escape_bash(bucket),
                        region = escape_bash(region),
                        endpoint = escape_bash(endpoint),
                        access_key = escape_bash(access_key),
                        secret_key = escape_bash(secret_key),
                        prefix = escape_bash(prefix),
                    );
                }
            }
        }
    }

    format!(
        r#"#!/usr/bin/env bash
# ==============================================================================
# Server Command Center - Native Automated Cron Backup Script
# Powered by Falah Tech (falah-tech.com)
# Schedule ID: {schedule_id}
# Schedule Name: {name}
# Target: {target_type} -> {target_name}
# ==============================================================================
set -e
set -o pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

DEST_DIR="{destination_dir}"
mkdir -p "$DEST_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DEST_FILE="${{DEST_DIR}}/{prefix}_{sanitized_target}_${{TIMESTAMP}}.{ext}"
STATUS_FILE="{script_dir}/scc_backup_{schedule_id}.status"
MANIFEST_FILE="{script_dir}/scc_backup_manifest.jsonl"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting automated backup for {target_name}..."

# 1. Execute database / filesystem dump
{dump_logic}

# 2. Verify file creation and non-zero size
if [ ! -f "$DEST_FILE" ]; then
    echo "ERROR: Backup archive was not created on disk: $DEST_FILE" >&2
    echo "{{\"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"status\": \"failed\", \"error\": \"Backup file not created\"}}" > "$STATUS_FILE"
    exit 1
fi

SIZE=$(wc -c < "$DEST_FILE" | tr -d " ")
if [ "$SIZE" -le 40 ]; then
    rm -f "$DEST_FILE"
    echo "ERROR: Backup produced 0 data bytes" >&2
    echo "{{\"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"status\": \"failed\", \"error\": \"Empty backup file (<= 40 bytes)\"}}" > "$STATUS_FILE"
    exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Local backup created successfully: $DEST_FILE ($SIZE bytes)"

# 3. Retention policy: prune older backups on the server
RETENTION={retention_count}
if [ "$RETENTION" -gt 0 ]; then
    echo "Pruning older backups (retaining latest $RETENTION)..."
    ls -t "${{DEST_DIR}}/{prefix}_{sanitized_target}_"* 2>/dev/null | tail -n +$((RETENTION + 1)) | while read -r old_file; do
        if [ -f "$old_file" ] && [ "$old_file" != "$DEST_FILE" ]; then
            echo "Removing expired backup: $old_file"
            rm -f "$old_file"
        fi
    done
fi

# 4. Offsite Cloud Upload
export DEST_FILE
{cloud_logic}

# 5. Record final status and append to sync manifest
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "{{\"timestamp\": \"$NOW_ISO\", \"status\": \"success\", \"file\": \"$DEST_FILE\", \"size\": $SIZE}}" > "$STATUS_FILE"
echo "{{\"schedule_id\": \"{schedule_id}\", \"target\": \"{target_name}\", \"destination\": \"$DEST_FILE\", \"size_bytes\": $SIZE, \"status\": \"success\", \"created_at\": \"$NOW_ISO\"}}" >> "$MANIFEST_FILE"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup schedule execution complete."
"#,
        schedule_id = schedule_id,
        name = name,
        target_type = target_type,
        target_name = target_name,
        destination_dir = destination_dir,
        prefix = prefix,
        sanitized_target = sanitized_target,
        ext = ext,
        script_dir = script_dir,
        dump_logic = dump_logic,
        retention_count = retention_count,
        cloud_logic = cloud_logic
    )
}

#[tauri::command]
pub async fn list_backup_schedules(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<Vec<BackupSchedule>> {
    // 1. Fetch from SQLite
    let mut schedules = {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, server_id, name, target_type, target_name, cron_expression,
                    destination_dir, retention_count, db_user, db_password, db_host,
                    db_port, custom_command, storage_provider, storage_config,
                    is_active, remote_script_path, last_run_at, last_status,
                    created_at, updated_at
             FROM backup_schedules
             WHERE server_id = ?1
             ORDER BY created_at DESC"
        ).map_err(|e| CommandError::Database(e.to_string()))?;

        let rows = stmt.query_map([&server_id], |r| {
            let active_int: i32 = r.get(15)?;
            Ok(BackupSchedule {
                id: r.get(0)?,
                server_id: r.get(1)?,
                name: r.get(2)?,
                target_type: r.get(3)?,
                target_name: r.get(4)?,
                cron_expression: r.get(5)?,
                destination_dir: r.get(6)?,
                retention_count: r.get(7)?,
                db_user: r.get(8)?,
                db_password: r.get(9)?,
                db_host: r.get(10)?,
                db_port: r.get(11)?,
                custom_command: r.get(12)?,
                storage_provider: r.get(13)?,
                storage_config: r.get(14)?,
                is_active: active_int != 0,
                remote_script_path: r.get(16)?,
                last_run_at: r.get(17)?,
                last_status: r.get(18)?,
                created_at: r.get(19)?,
                updated_at: r.get(20)?,
            })
        }).map_err(|e| CommandError::Database(e.to_string()))?;

        let mut res = Vec::new();
        for row in rows {
            if let Ok(item) = row {
                res.push(item);
            }
        }
        res
    };

    // 2. Synchronize real-time status and remote cron manifest from the server
    if let Ok(session_arc) = state.session_manager.get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone()).await {
        let mut session = session_arc.lock().await;

        // Sync manifest entries created by server cron into the backups table
        let sync_cmd = r#"bash -c '
MANIFEST="/var/scripts/scc_backup_manifest.jsonl"
[ ! -f "$MANIFEST" ] && MANIFEST="$HOME/.scc_backups/scc_backup_manifest.jsonl"
if [ -f "$MANIFEST" ]; then
    tail -n 50 "$MANIFEST"
fi
'"#;
        if let Ok(manifest_out) = exec_ssh_command_full(&mut session, sync_cmd, Duration::from_secs(5)).await {
            if !manifest_out.stdout.trim().is_empty() {
                if let Ok(conn) = state.db.lock() {
                    for line in manifest_out.stdout.lines() {
                        let trimmed = line.trim();
                        if trimmed.is_empty() { continue; }
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            if let (Some(dest), Some(tgt), Some(ts)) = (
                                v["destination"].as_str(),
                                v["target"].as_str(),
                                v["created_at"].as_str()
                            ) {
                                let size = v["size_bytes"].as_i64();
                                let id = format!("cron_{}", &dest.replace(['/', '\\', '.', '_'], ""));
                                let _ = conn.execute(
                                    "INSERT OR IGNORE INTO backups (id, server_id, target, destination, size_bytes, status, created_at)
                                     VALUES (?1, ?2, ?3, ?4, ?5, 'success', ?6)",
                                    rusqlite::params![id, server_id, tgt, dest, size, ts]
                                );
                            }
                        }
                    }
                }
            }
        }

        // Read real-time status files for each schedule
        for sched in &mut schedules {
            let status_cmd = format!(
                "cat \"/var/scripts/scc_backup_{}.status\" 2>/dev/null || cat \"$HOME/.scc_backups/scc_backup_{}.status\" 2>/dev/null || true",
                sched.id, sched.id
            );
            if let Ok(status_out) = exec_ssh_command_full(&mut session, &status_cmd, Duration::from_secs(5)).await {
                let txt = status_out.stdout.trim();
                if !txt.is_empty() {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(txt) {
                        if let Some(ts) = v["timestamp"].as_str() {
                            sched.last_run_at = Some(ts.to_string());
                        }
                        if let Some(st) = v["status"].as_str() {
                            sched.last_status = Some(st.to_string());
                        }
                    }
                }
            }
        }
    }

    Ok(schedules)
}

#[tauri::command]
pub async fn create_backup_schedule(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    options: CreateBackupScheduleOptions,
) -> CommandResult<BackupSchedule> {
    if options.name.trim().is_empty() {
        return Err(CommandError::Validation("Schedule name cannot be empty".into()));
    }
    if options.target_name.trim().is_empty() {
        return Err(CommandError::Validation("Target name/path cannot be empty".into()));
    }

    // Validate cron expression (standard 5 fields)
    let parts: Vec<&str> = options.cron_expression.trim().split_whitespace().collect();
    if parts.len() != 5 {
        return Err(CommandError::Validation(
            "Cron expression must contain exactly 5 space-separated fields (minute, hour, day-of-month, month, day-of-week), e.g. '0 2,14 * * *' for twice daily.".into()
        ));
    }

    let schedule_id = Uuid::new_v4().to_string();
    let dest_dir = options.destination_dir.as_deref().unwrap_or("/var/backups");
    let retention = options.retention_count.unwrap_or(7);
    let start_time = Instant::now();

    // 1. Acquire pooled SSH session
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    // 2. Determine remote script directory
    let dir_detect_cmd = r#"bash -c '
if [ -d /var/scripts ] || mkdir -p /var/scripts 2>/dev/null; then
    echo "/var/scripts"
else
    mkdir -p "$HOME/.scc_backups" && echo "$HOME/.scc_backups"
fi
'"#;
    let dir_out = exec_ssh_command_full(&mut session, dir_detect_cmd, Duration::from_secs(10)).await?;
    let script_dir = dir_out.stdout.trim().lines().last().unwrap_or("/var/scripts").to_string();
    let script_path = format!("{}/scc_backup_{}.sh", script_dir, schedule_id);
    let log_path = format!("{}/scc_backup_{}.log", script_dir, schedule_id);

    // 3. Generate script content and write to remote server
    let script_content = generate_cron_backup_script(
        &schedule_id,
        &options.name,
        &options.target_type,
        &options.target_name,
        dest_dir,
        retention,
        options.db_user.as_deref(),
        options.db_password.as_deref(),
        options.db_host.as_deref(),
        options.db_port,
        options.custom_command.as_deref(),
        options.storage_provider.as_deref().unwrap_or("none"),
        options.storage_config.as_deref(),
        &script_dir,
    );

    let b64_script = b64.encode(script_content.as_bytes());
    let write_cmd = format!(
        "echo \"{}\" | base64 -d > \"{}\" && chmod 700 \"{}\"",
        b64_script, script_path, script_path
    );
    exec_ssh_command_full(&mut session, &write_cmd, Duration::from_secs(15)).await?;

    // 4. Install crontab entry directly on the server
    let cron_expr = options.cron_expression.trim();
    let install_cron_cmd = format!(
        r#"bash -c '
set -e
EXISTING=$(crontab -l 2>/dev/null | grep -v "SCC_BACKUP_{id}" || true)
NEW_CRON="{cron_expr} /bin/bash \"{script_path}\" >> \"{log_path}\" 2>&1 # SCC_BACKUP_{id}"

printf "%s\n%s\n" "$EXISTING" "$NEW_CRON" | sed "/^[[:space:]]*$/d" | crontab -
crontab -l 2>/dev/null | grep "SCC_BACKUP_{id}"
'
"#,
        id = schedule_id,
        cron_expr = cron_expr,
        script_path = script_path,
        log_path = log_path
    );

    let cron_res = exec_ssh_command_full(&mut session, &install_cron_cmd, Duration::from_secs(15)).await?;
    if cron_res.exit_status.unwrap_or(0) != 0 || cron_res.stdout.trim().is_empty() {
        return Err(CommandError::Internal(format!(
            "Failed to register cron job on server crontab: {}",
            cron_res.stderr.trim()
        )));
    }

    let now_iso = chrono::Utc::now().to_rfc3339();

    // 5. Store in local SQLite
    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        conn.execute(
            "INSERT INTO backup_schedules (
                id, server_id, name, target_type, target_name, cron_expression,
                destination_dir, retention_count, db_user, db_password, db_host,
                db_port, custom_command, storage_provider, storage_config,
                is_active, remote_script_path, last_status, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 1, ?16, 'active', ?17, ?17)",
            rusqlite::params![
                schedule_id,
                server_id,
                options.name,
                options.target_type,
                options.target_name,
                cron_expr,
                dest_dir,
                retention,
                options.db_user,
                options.db_password,
                options.db_host,
                options.db_port,
                options.custom_command,
                options.storage_provider.unwrap_or_else(|| "none".into()),
                options.storage_config,
                script_path,
                now_iso
            ],
        ).map_err(|e| CommandError::Database(e.to_string()))?;

        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id.clone()),
            action: actions::CREATE_BACKUP_SCHEDULE.into(),
            target: Some(options.name.clone()),
            status: "success".into(),
            detail: Some(format!(
                "Created server-side cron backup schedule (cron: '{}', script: '{}')",
                cron_expr, script_path
            )),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    Ok(BackupSchedule {
        id: schedule_id,
        server_id,
        name: options.name,
        target_type: options.target_type,
        target_name: options.target_name,
        cron_expression: cron_expr.to_string(),
        destination_dir: dest_dir.to_string(),
        retention_count: retention,
        db_user: options.db_user,
        db_password: options.db_password,
        db_host: options.db_host,
        db_port: options.db_port,
        custom_command: options.custom_command,
        storage_provider: "none".to_string(),
        storage_config: None,
        is_active: true,
        remote_script_path: Some(script_path),
        last_run_at: None,
        last_status: Some("active".into()),
        created_at: now_iso.clone(),
        updated_at: now_iso,
    })
}

#[tauri::command]
pub async fn toggle_backup_schedule(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    schedule_id: String,
    enable: bool,
) -> CommandResult<BackupSchedule> {
    let start_time = Instant::now();

    // 1. Fetch existing schedule from DB
    let sched = {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, server_id, name, target_type, target_name, cron_expression,
                    destination_dir, retention_count, db_user, db_password, db_host,
                    db_port, custom_command, storage_provider, storage_config,
                    is_active, remote_script_path, last_run_at, last_status,
                    created_at, updated_at
             FROM backup_schedules
             WHERE id = ?1 AND server_id = ?2"
        ).map_err(|e| CommandError::Database(e.to_string()))?;

        stmt.query_row([&schedule_id, &server_id], |r| {
            let active_int: i32 = r.get(15)?;
            Ok(BackupSchedule {
                id: r.get(0)?,
                server_id: r.get(1)?,
                name: r.get(2)?,
                target_type: r.get(3)?,
                target_name: r.get(4)?,
                cron_expression: r.get(5)?,
                destination_dir: r.get(6)?,
                retention_count: r.get(7)?,
                db_user: r.get(8)?,
                db_password: r.get(9)?,
                db_host: r.get(10)?,
                db_port: r.get(11)?,
                custom_command: r.get(12)?,
                storage_provider: r.get(13)?,
                storage_config: r.get(14)?,
                is_active: active_int != 0,
                remote_script_path: r.get(16)?,
                last_run_at: r.get(17)?,
                last_status: r.get(18)?,
                created_at: r.get(19)?,
                updated_at: r.get(20)?,
            })
        }).map_err(|_| CommandError::NotFound(format!("Backup schedule {} not found", schedule_id)))?
    };

    // 2. Connect to server
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    // 3. Add or remove from server crontab
    let script_path = sched.remote_script_path.clone().unwrap_or_else(|| format!("/var/scripts/scc_backup_{}.sh", schedule_id));
    let log_path = format!("{}.log", script_path.trim_end_matches(".sh"));

    if enable {
        let install_cron_cmd = format!(
            r#"bash -c '
EXISTING=$(crontab -l 2>/dev/null | grep -v "SCC_BACKUP_{id}" || true)
NEW_CRON="{cron_expr} /bin/bash \"{script_path}\" >> \"{log_path}\" 2>&1 # SCC_BACKUP_{id}"
printf "%s\n%s\n" "$EXISTING" "$NEW_CRON" | sed "/^[[:space:]]*$/d" | crontab -
'
"#,
            id = schedule_id,
            cron_expr = sched.cron_expression,
            script_path = script_path,
            log_path = log_path
        );
        exec_ssh_command_full(&mut session, &install_cron_cmd, Duration::from_secs(15)).await?;
    } else {
        let remove_cron_cmd = format!(
            r#"bash -c '
REMAINING=$(crontab -l 2>/dev/null | grep -v "SCC_BACKUP_{id}" || true)
if [ -n "$REMAINING" ]; then
    printf "%s\n" "$REMAINING" | sed "/^[[:space:]]*$/d" | crontab -
else
    crontab -r 2>/dev/null || true
fi
'
"#,
            id = schedule_id
        );
        exec_ssh_command_full(&mut session, &remove_cron_cmd, Duration::from_secs(15)).await?;
    }

    let now_iso = chrono::Utc::now().to_rfc3339();

    // 4. Update DB
    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        conn.execute(
            "UPDATE backup_schedules SET is_active = ?1, updated_at = ?2 WHERE id = ?3 AND server_id = ?4",
            rusqlite::params![if enable { 1 } else { 0 }, now_iso, schedule_id, server_id]
        ).map_err(|e| CommandError::Database(e.to_string()))?;

        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::UPDATE_BACKUP_SCHEDULE.into(),
            target: Some(sched.name.clone()),
            status: "success".into(),
            detail: Some(format!(
                "{} backup schedule (cron: '{}')",
                if enable { "Enabled" } else { "Paused" },
                sched.cron_expression
            )),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    let mut updated = sched;
    updated.is_active = enable;
    updated.updated_at = now_iso;
    Ok(updated)
}

#[tauri::command]
pub async fn delete_backup_schedule(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    schedule_id: String,
) -> CommandResult<()> {
    let start_time = Instant::now();

    // 1. Fetch remote script path
    let script_path: Option<String> = {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        let mut stmt = conn.prepare("SELECT remote_script_path FROM backup_schedules WHERE id = ?1 AND server_id = ?2")
            .map_err(|e| CommandError::Database(e.to_string()))?;
        stmt.query_row([&schedule_id, &server_id], |r| r.get(0)).ok()
    };

    // 2. Remove from crontab and clean up remote script
    if let Ok(session_arc) = state.session_manager.get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone()).await {
        let mut session = session_arc.lock().await;
        let script = script_path.unwrap_or_else(|| format!("/var/scripts/scc_backup_{}.sh", schedule_id));
        let log = format!("{}.log", script.trim_end_matches(".sh"));
        let status = format!("{}.status", script.trim_end_matches(".sh"));

        let cleanup_cmd = format!(
            r#"bash -c '
REMAINING=$(crontab -l 2>/dev/null | grep -v "SCC_BACKUP_{id}" || true)
if [ -n "$REMAINING" ]; then
    printf "%s\n" "$REMAINING" | sed "/^[[:space:]]*$/d" | crontab -
else
    crontab -r 2>/dev/null || true
fi
rm -f "{script}" "{log}" "{status}"
'
"#,
            id = schedule_id,
            script = script,
            log = log,
            status = status
        );
        let _ = exec_ssh_command_full(&mut session, &cleanup_cmd, Duration::from_secs(15)).await;
    }

    // 3. Remove from SQLite
    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        conn.execute("DELETE FROM backup_schedules WHERE id = ?1 AND server_id = ?2", rusqlite::params![schedule_id, server_id])
            .map_err(|e| CommandError::Database(e.to_string()))?;

        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::DELETE_BACKUP_SCHEDULE.into(),
            target: Some(schedule_id),
            status: "success".into(),
            detail: Some("Deleted server backup schedule and removed cron job".into()),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn run_backup_schedule_now(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    schedule_id: String,
) -> CommandResult<ScheduleRunResult> {
    let start_time = Instant::now();

    // 1. Fetch schedule
    let sched = {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, server_id, name, target_type, target_name, cron_expression,
                    destination_dir, retention_count, db_user, db_password, db_host,
                    db_port, custom_command, storage_provider, storage_config,
                    is_active, remote_script_path, last_run_at, last_status,
                    created_at, updated_at
             FROM backup_schedules
             WHERE id = ?1 AND server_id = ?2"
        ).map_err(|e| CommandError::Database(e.to_string()))?;

        stmt.query_row([&schedule_id, &server_id], |r| {
            let active_int: i32 = r.get(15)?;
            Ok(BackupSchedule {
                id: r.get(0)?,
                server_id: r.get(1)?,
                name: r.get(2)?,
                target_type: r.get(3)?,
                target_name: r.get(4)?,
                cron_expression: r.get(5)?,
                destination_dir: r.get(6)?,
                retention_count: r.get(7)?,
                db_user: r.get(8)?,
                db_password: r.get(9)?,
                db_host: r.get(10)?,
                db_port: r.get(11)?,
                custom_command: r.get(12)?,
                storage_provider: r.get(13)?,
                storage_config: r.get(14)?,
                is_active: active_int != 0,
                remote_script_path: r.get(16)?,
                last_run_at: r.get(17)?,
                last_status: r.get(18)?,
                created_at: r.get(19)?,
                updated_at: r.get(20)?,
            })
        }).map_err(|_| CommandError::NotFound(format!("Backup schedule {} not found", schedule_id)))?
    };

    let script_path = sched.remote_script_path.unwrap_or_else(|| format!("/var/scripts/scc_backup_{}.sh", schedule_id));

    // 2. Connect via SSH
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    // 3. Execute the script immediately
    let exec_cmd = format!("/bin/bash \"{}\"", script_path);
    let run_out = exec_ssh_command_full(&mut session, &exec_cmd, Duration::from_secs(360)).await?;

    let is_success = run_out.exit_status.unwrap_or(0) == 0;
    let output = if !run_out.stdout.is_empty() { run_out.stdout } else { run_out.stderr };
    let status_label = if is_success { "success" } else { "failed" };
    let now_iso = chrono::Utc::now().to_rfc3339();

    // 4. Read created backup file from status file
    let mut created_backup_record = None;
    let status_cmd = format!("cat \"{}.status\" 2>/dev/null || true", script_path.trim_end_matches(".sh"));
    if let Ok(st_out) = exec_ssh_command_full(&mut session, &status_cmd, Duration::from_secs(5)).await {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(st_out.stdout.trim()) {
            if let Some(dest_file) = v["file"].as_str() {
                let size = v["size"].as_i64();
                let backup_id = Uuid::new_v4().to_string();

                if let Ok(conn) = state.db.lock() {
                    let _ = conn.execute(
                        "INSERT INTO backups (id, server_id, target, destination, size_bytes, status, created_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, 'success', ?6)",
                        rusqlite::params![backup_id, server_id, sched.target_name, dest_file, size, now_iso]
                    );
                }

                created_backup_record = Some(BackupRecord {
                    id: backup_id,
                    server_id: server_id.clone(),
                    target: sched.target_name.clone(),
                    destination: dest_file.to_string(),
                    size_bytes: size,
                    status: "success".into(),
                    created_at: now_iso.clone(),
                });
            }
        }
    }

    // 5. Update schedule last status
    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        let _ = conn.execute(
            "UPDATE backup_schedules SET last_run_at = ?1, last_status = ?2, updated_at = ?1 WHERE id = ?3 AND server_id = ?4",
            rusqlite::params![now_iso, status_label, schedule_id, server_id]
        );

        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::RUN_BACKUP_SCHEDULE.into(),
            target: Some(sched.name),
            status: status_label.into(),
            detail: Some(format!("Executed scheduled backup manually. Status: {}", status_label)),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    Ok(ScheduleRunResult {
        success: is_success,
        message: if is_success {
            "Scheduled backup executed successfully on server!".into()
        } else {
            "Scheduled backup execution failed. Review output logs.".into()
        },
        output,
        backup_record: created_backup_record,
    })
}

#[tauri::command]
pub async fn test_cloud_storage_connection(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    provider: String,
    config_json: String,
) -> CommandResult<TestCloudStorageResult> {
    let session_arc = state.session_manager
        .get_or_connect(server_id, state.db.clone(), app_handle)
        .await?;
    let mut session = session_arc.lock().await;

    if provider == "dropbox" {
        let v: serde_json::Value = serde_json::from_str(&config_json)
            .map_err(|e| CommandError::Validation(format!("Invalid Dropbox JSON config: {}", e)))?;
        let token = v["access_token"].as_str().unwrap_or("").trim();
        if token.is_empty() {
            return Err(CommandError::Validation("Dropbox Access Token cannot be empty".into()));
        }

        let test_cmd = format!(
            r#"curl -s -X POST https://api.dropboxapi.com/2/users/get_current_account \
  --header "Authorization: Bearer {}" \
  --header "Content-Type: application/json""#,
            escape_bash(token)
        );

        let out = exec_ssh_command_full(&mut session, &test_cmd, Duration::from_secs(15)).await?;
        let txt = out.stdout.trim();
        if txt.contains("\"account_id\"") {
            let json: serde_json::Value = serde_json::from_str(txt).unwrap_or_default();
            let name = json["name"]["display_name"].as_str().unwrap_or("Authorized Account");
            let email = json["email"].as_str().unwrap_or("");
            Ok(TestCloudStorageResult {
                success: true,
                message: format!("Successfully verified Dropbox access for {} ({})", name, email),
                details: Some(txt.to_string()),
            })
        } else {
            Ok(TestCloudStorageResult {
                success: false,
                message: "Dropbox authentication failed. Please check that your access token is valid and unexpired.".into(),
                details: Some(txt.to_string()),
            })
        }
    } else if provider == "s3" {
        let v: serde_json::Value = serde_json::from_str(&config_json)
            .map_err(|e| CommandError::Validation(format!("Invalid S3 JSON config: {}", e)))?;
        let bucket = v["bucket"].as_str().unwrap_or("").trim();
        let region = v["region"].as_str().unwrap_or("us-east-1").trim();
        let endpoint = v["endpoint"].as_str().unwrap_or("").trim();
        let akey = v["access_key_id"].as_str().or_else(|| v["access_key"].as_str()).unwrap_or("").trim();
        let skey = v["secret_access_key"].as_str().or_else(|| v["secret_key"].as_str()).unwrap_or("").trim();

        if bucket.is_empty() {
            return Err(CommandError::Validation("Bucket name cannot be empty".into()));
        }
        if akey.is_empty() || skey.is_empty() {
            return Err(CommandError::Validation("Access Key ID and Secret Access Key are required".into()));
        }

        let py_script = format!(
            r#"import sys, datetime, hashlib, hmac, urllib.request, urllib.error

bucket = "{bucket}"
region = "{region}"
endpoint = "{endpoint}"
access_key = "{akey}"
secret_key = "{skey}"

proto = "https"
if not endpoint:
    if region in ("us-east-1", ""):
        host = f"{{bucket}}.s3.amazonaws.com"
    else:
        host = f"{{bucket}}.s3.{{region}}.amazonaws.com"
    url = f"https://{{host}}/?list-type=2&max-keys=1"
    canonical_uri = "/"
else:
    clean_ep = endpoint.replace("https://", "").replace("http://", "").rstrip("/")
    proto = "https" if "https" in endpoint else "http"
    host = clean_ep
    url = f"{{proto}}://{{host}}/{{bucket}}?list-type=2&max-keys=1"
    canonical_uri = f"/{{bucket}}"

canonical_querystring = "list-type=2&max-keys=1"
payload_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

now = datetime.datetime.now(datetime.timezone.utc)
amz_date = now.strftime('%Y%m%dT%H%M%SZ')
date_stamp = now.strftime('%Y%m%d')

canonical_headers = f"host:{{host}}\nx-amz-content-sha256:{{payload_hash}}\nx-amz-date:{{amz_date}}\n"
signed_headers = "host;x-amz-content-sha256;x-amz-date"
canonical_request = f"GET\n{{canonical_uri}}\n{{canonical_querystring}}\n{{canonical_headers}}\n{{signed_headers}}\n{{payload_hash}}"

algorithm = "AWS4-HMAC-SHA256"
effective_region = region if region else "us-east-1"
credential_scope = f"{{date_stamp}}/{{effective_region}}/s3/aws4_request"
string_to_sign = f"{{algorithm}}\n{{amz_date}}\n{{credential_scope}}\n{{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}}"

def sign(k, m):
    return hmac.new(k, m.encode('utf-8'), hashlib.sha256).digest()

k_date = sign(('AWS4' + secret_key).encode('utf-8'), date_stamp)
k_region = sign(k_date, effective_region)
k_service = sign(k_region, "s3")
k_signing = sign(k_service, "aws4_request")
signature = hmac.new(k_signing, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()

auth_header = f"{{algorithm}} Credential={{access_key}}/{{credential_scope}}, SignedHeaders={{signed_headers}}, Signature={{signature}}"

req = urllib.request.Request(url, method="GET")
req.add_header("Host", host)
req.add_header("x-amz-date", amz_date)
req.add_header("x-amz-content-sha256", payload_hash)
req.add_header("Authorization", auth_header)

try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        if resp.status in (200, 204):
            print("S3_SUCCESS")
        else:
            print(f"S3_STATUS_{{resp.status}}")
except urllib.error.HTTPError as e:
    err_body = ""
    try:
        err_body = e.read().decode('utf-8', errors='replace')[:200]
    except Exception:
        pass
    if e.code in (200, 204):
        print("S3_SUCCESS")
    elif e.code == 403:
        print(f"S3_HTTP_403: {{err_body}}")
    elif e.code == 404:
        print(f"S3_HTTP_404: {{err_body}}")
    else:
        print(f"S3_HTTP_{{e.code}}: {{err_body}}")
except Exception as e:
    print(f"S3_ERR_{{e}}")
"#,
            bucket = bucket.replace('\\', "\\\\").replace('"', "\\\""),
            region = region.replace('\\', "\\\\").replace('"', "\\\""),
            endpoint = endpoint.replace('\\', "\\\\").replace('"', "\\\""),
            akey = akey.replace('\\', "\\\\").replace('"', "\\\""),
            skey = skey.replace('\\', "\\\\").replace('"', "\\\"")
        );

        let py_b64 = b64.encode(py_script.as_bytes());

        let test_cmd = format!(
            r#"if command -v aws >/dev/null 2>&1; then
    ENDPOINT_FLAG=""
    [ -n "{endpoint}" ] && ENDPOINT_FLAG="--endpoint-url {endpoint}"
    AWS_ACCESS_KEY_ID="{akey}" AWS_SECRET_ACCESS_KEY="{skey}" AWS_DEFAULT_REGION="{region}" \
    aws s3 ls "s3://{bucket}" $ENDPOINT_FLAG >/dev/null 2>&1 && echo "S3_SUCCESS" || echo "S3_FAILED"
else
    python3 -c "import base64; exec(base64.b64decode('{py_b64}').decode('utf-8'))"
fi"#,
            bucket = escape_bash(bucket),
            region = escape_bash(region),
            endpoint = escape_bash(endpoint),
            akey = escape_bash(akey),
            skey = escape_bash(skey),
            py_b64 = py_b64
        );

        let out = exec_ssh_command_full(&mut session, &test_cmd, Duration::from_secs(20)).await?;
        let txt = out.stdout.trim();
        if txt.contains("S3_SUCCESS") || txt.contains("S3_STATUS_200") {
            Ok(TestCloudStorageResult {
                success: true,
                message: format!("Successfully connected to S3 bucket '{}' ({})", bucket, if endpoint.is_empty() { region } else { endpoint }),
                details: Some(txt.to_string()),
            })
        } else if txt.contains("403") {
            Ok(TestCloudStorageResult {
                success: false,
                message: format!("Reached S3, but Access Denied (HTTP 403). Verify Access Key permissions for bucket '{}'.", bucket),
                details: Some(txt.to_string()),
            })
        } else if txt.contains("404") {
            Ok(TestCloudStorageResult {
                success: false,
                message: format!("Reached S3, but Bucket Not Found (HTTP 404). Check bucket name '{}'.", bucket),
                details: Some(txt.to_string()),
            })
        } else {
            Ok(TestCloudStorageResult {
                success: false,
                message: format!("Failed to connect to S3: {}", if txt.is_empty() { out.stderr.trim() } else { txt }),
                details: Some(out.stderr.trim().to_string()),
            })
        }
    } else {
        Err(CommandError::Validation(format!("Unsupported storage provider '{}'", provider)))
    }
}

#[tauri::command]
pub async fn upload_backup_to_cloud(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    backup_id: String,
    cloud_config_id: Option<String>,
    override_config_json: Option<String>,
    override_provider: Option<String>,
    provider: Option<String>,
    config_json: Option<String>,
) -> CommandResult<CloudUploadResult> {
    let start_time = Instant::now();

    // 0. Resolve provider and config_json (support both cloud_config_id and inline overrides)
    let (target_provider, target_config_json) = if let Some(ref cid) = cloud_config_id {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        let mut stmt = conn.prepare("SELECT provider, config_json FROM cloud_storage_configs WHERE id = ?1")
            .map_err(|e| CommandError::Database(e.to_string()))?;
        stmt.query_row([cid], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|_| CommandError::NotFound(format!("Cloud configuration '{}' not found", cid)))?
    } else if let (Some(p), Some(c)) = (override_provider.or(provider), override_config_json.or(config_json)) {
        (p, c)
    } else {
        return Err(CommandError::Validation("Cloud storage configuration is required".into()));
    };

    // 1. Fetch backup destination path from DB
    let dest_file = {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        let mut stmt = conn.prepare("SELECT destination FROM backups WHERE id = ?1 AND server_id = ?2")
            .map_err(|e| CommandError::Database(e.to_string()))?;
        stmt.query_row([&backup_id, &server_id], |r| r.get::<_, String>(0))
            .map_err(|_| CommandError::NotFound(format!("Backup {} not found", backup_id)))?
    };

    // 2. Connect via SSH
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    // 3. Perform upload
    if target_provider == "dropbox" {
        let v: serde_json::Value = serde_json::from_str(&target_config_json)
            .map_err(|e| CommandError::Validation(format!("Invalid Dropbox JSON config: {}", e)))?;
        let token = v["access_token"].as_str().unwrap_or("").trim();
        let folder = v["path"].as_str().unwrap_or("/ServerCommandCenter/Backups").trim();

        if token.is_empty() {
            return Err(CommandError::Validation("Dropbox token cannot be empty".into()));
        }

        let py_script = format!(
            r#"import sys, os, json, urllib.request

token = "{token}"
file_path = "{dest_file}"
target_path = "{target_path}"
file_size = os.path.getsize(file_path)
CHUNK_SIZE = 16 * 1024 * 1024

try:
    with open(file_path, "rb") as f:
        first_chunk = f.read(CHUNK_SIZE)
        req = urllib.request.Request(
            "https://content.dropboxapi.com/2/files/upload_session/start",
            data=first_chunk,
            headers={{
                "Authorization": f"Bearer {{token}}",
                "Dropbox-API-Arg": json.dumps({{"close": False}}),
                "Content-Type": "application/octet-stream",
            }}
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            session_id = json.loads(resp.read().decode())["session_id"]
        
        offset = len(first_chunk)
        while offset < file_size:
            chunk = f.read(CHUNK_SIZE)
            is_last = (offset + len(chunk)) >= file_size
            if not is_last:
                req = urllib.request.Request(
                    "https://content.dropboxapi.com/2/files/upload_session/append_v2",
                    data=chunk,
                    headers={{
                        "Authorization": f"Bearer {{token}}",
                        "Dropbox-API-Arg": json.dumps({{"cursor": {{"session_id": session_id, "offset": offset}}, "close": False}}),
                        "Content-Type": "application/octet-stream",
                    }}
                )
                with urllib.request.urlopen(req, timeout=300) as resp:
                    resp.read()
            else:
                req = urllib.request.Request(
                    "https://content.dropboxapi.com/2/files/upload_session/finish",
                    data=chunk,
                    headers={{
                        "Authorization": f"Bearer {{token}}",
                        "Dropbox-API-Arg": json.dumps({{
                            "cursor": {{"session_id": session_id, "offset": offset}},
                            "commit": {{"path": target_path, "mode": "add", "autorename": True, "mute": False}}
                        }}),
                        "Content-Type": "application/octet-stream",
                    }}
                )
                with urllib.request.urlopen(req, timeout=600) as resp:
                    resp.read()
            offset += len(chunk)
    print(f"SUCCESS:{{target_path}}")
except Exception as e:
    print(f"ERROR:{{e}}", file=sys.stderr)
    sys.exit(1)
"#,
            token = token.replace('\\', "\\\\").replace('"', "\\\""),
            dest_file = dest_file.replace('\\', "\\\\").replace('"', "\\\""),
            target_path = format!("{}/{}", folder.trim_end_matches('/'), std::path::Path::new(&dest_file).file_name().and_then(|f| f.to_str()).unwrap_or("backup.tar.gz")).replace('\\', "\\\\").replace('"', "\\\"")
        );

        let py_b64 = b64.encode(py_script.as_bytes());

        let upload_cmd = format!(
            r#"DEST="{dest_file}"
TOKEN="{token}"
FOLDER="{folder}"
FNAME=$(basename "$DEST")
TARGET="${{FOLDER%/}}/${{FNAME}}"
[[ "$TARGET" != /* ]] && TARGET="/$TARGET"

FSIZE=$(stat -c%s "$DEST" 2>/dev/null || stat -f%z "$DEST" 2>/dev/null || echo 0)

if [ "$FSIZE" -le 146800640 ]; then
    RESP=$(curl -s -X POST https://content.dropboxapi.com/2/files/upload \
      --header "Authorization: Bearer $TOKEN" \
      --header "Dropbox-API-Arg: {{\"path\": \"$TARGET\",\"mode\": \"add\",\"autorename\": true,\"mute\": false}}" \
      --header "Content-Type: application/octet-stream" \
      --data-binary @"$DEST")

    if echo "$RESP" | grep -q "\"id\":"; then
        echo "SUCCESS:$TARGET"
    else
        echo "ERROR:$RESP" >&2
        exit 1
    fi
else
    python3 -c "import base64; exec(base64.b64decode('{py_b64}').decode('utf-8'))"
fi"#,
            dest_file = escape_bash(&dest_file),
            token = escape_bash(token),
            folder = escape_bash(folder),
            py_b64 = py_b64
        );

        let out = exec_ssh_command_full(&mut session, &upload_cmd, Duration::from_secs(1800)).await?;
        if out.exit_status.unwrap_or(0) != 0 {
            return Err(CommandError::Internal(format!("Dropbox upload failed: {}", out.stderr.trim())));
        }

        let remote_path = out.stdout.trim().strip_prefix("SUCCESS:").unwrap_or(folder).to_string();

        {
            let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
            log_activity(&conn, ActivityEntry {
                server_id: Some(server_id),
                action: actions::UPLOAD_BACKUP_CLOUD.into(),
                target: Some(dest_file),
                status: "success".into(),
                detail: Some(format!("Uploaded backup archive to Dropbox at {}", remote_path)),
                duration_ms: Some(start_time.elapsed().as_millis() as i64),
            });
        }

        Ok(CloudUploadResult {
            success: true,
            message: format!("Backup successfully uploaded to Dropbox at {}", remote_path),
            remote_path,
        })
    } else if target_provider == "s3" {
        let v: serde_json::Value = serde_json::from_str(&target_config_json)
            .map_err(|e| CommandError::Validation(format!("Invalid S3 JSON config: {}", e)))?;
        let bucket = v["bucket"].as_str().unwrap_or("").trim();
        let region = v["region"].as_str().unwrap_or("us-east-1").trim();
        let endpoint = v["endpoint"].as_str().unwrap_or("").trim();
        let akey = v["access_key_id"].as_str().or_else(|| v["access_key"].as_str()).unwrap_or("").trim();
        let skey = v["secret_access_key"].as_str().or_else(|| v["secret_key"].as_str()).unwrap_or("").trim();
        let prefix = v["prefix"].as_str().unwrap_or("").trim();

        if bucket.is_empty() || akey.is_empty() || skey.is_empty() {
            return Err(CommandError::Validation("Bucket, Access Key, and Secret Key are required for S3 upload".into()));
        }

        let py_script = format!(
            r#"import sys, os, datetime, hashlib, hmac, urllib.request

bucket = "{bucket}"
region = "{region}"
endpoint = "{endpoint}"
access_key = "{akey}"
secret_key = "{skey}"
prefix = "{prefix}"
file_path = "{dest_file}"

if not file_path or not os.path.exists(file_path):
    print("ERROR: File not found", file=sys.stderr)
    sys.exit(1)

fname = os.path.basename(file_path)
key = f"{{prefix.strip('/')}}/{{fname}}" if prefix.strip('/') else fname

proto = "https"
if not endpoint:
    if region in ("us-east-1", ""):
        host = f"{{bucket}}.s3.amazonaws.com"
    else:
        host = f"{{bucket}}.s3.{{region}}.amazonaws.com"
    url = f"https://{{host}}/{{key}}"
    canonical_uri = f"/{{key}}"
else:
    clean_ep = endpoint.replace("https://", "").replace("http://", "").rstrip("/")
    proto = "https" if "https" in endpoint else "http"
    host = clean_ep
    url = f"{{proto}}://{{host}}/{{bucket}}/{{key}}"
    canonical_uri = f"/{{bucket}}/{{key}}"

file_size = os.path.getsize(file_path)
h = hashlib.sha256()
with open(file_path, "rb") as f:
    for chunk in iter(lambda: f.read(1048576), b""):
        h.update(chunk)
payload_hash = h.hexdigest()
now = datetime.datetime.now(datetime.timezone.utc)
amz_date = now.strftime('%Y%m%dT%H%M%SZ')
date_stamp = now.strftime('%Y%m%d')

canonical_headers = f"host:{{host}}\nx-amz-content-sha256:{{payload_hash}}\nx-amz-date:{{amz_date}}\n"
signed_headers = "host;x-amz-content-sha256;x-amz-date"
canonical_request = f"PUT\n{{canonical_uri}}\n\n{{canonical_headers}}\n{{signed_headers}}\n{{payload_hash}}"

algorithm = "AWS4-HMAC-SHA256"
effective_region = region if region else "us-east-1"
credential_scope = f"{{date_stamp}}/{{effective_region}}/s3/aws4_request"
string_to_sign = f"{{algorithm}}\n{{amz_date}}\n{{credential_scope}}\n{{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}}"

def sign(k, m):
    return hmac.new(k, m.encode('utf-8'), hashlib.sha256).digest()

k_date = sign(('AWS4' + secret_key).encode('utf-8'), date_stamp)
k_region = sign(k_date, effective_region)
k_service = sign(k_region, "s3")
k_signing = sign(k_service, "aws4_request")
signature = hmac.new(k_signing, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()

auth_header = f"{{algorithm}} Credential={{access_key}}/{{credential_scope}}, SignedHeaders={{signed_headers}}, Signature={{signature}}"

with open(file_path, "rb") as f:
    req = urllib.request.Request(url, data=f, method="PUT")
    req.add_header("Host", host)
    req.add_header("x-amz-date", amz_date)
    req.add_header("x-amz-content-sha256", payload_hash)
    req.add_header("Authorization", auth_header)
    req.add_header("Content-Type", "application/octet-stream")
    req.add_header("Content-Length", str(file_size))

    try:
        with urllib.request.urlopen(req, timeout=1800) as resp:
            if resp.status in (200, 204):
                print(f"SUCCESS:s3://{{bucket}}/{{key}}")
            else:
                print(f"ERROR:HTTP {{resp.status}}", file=sys.stderr)
                sys.exit(1)
    except Exception as e:
        print(f"ERROR:{{e}}", file=sys.stderr)
        sys.exit(1)
"#,
            bucket = bucket.replace('\\', "\\\\").replace('"', "\\\""),
            region = region.replace('\\', "\\\\").replace('"', "\\\""),
            endpoint = endpoint.replace('\\', "\\\\").replace('"', "\\\""),
            akey = akey.replace('\\', "\\\\").replace('"', "\\\""),
            skey = skey.replace('\\', "\\\\").replace('"', "\\\""),
            prefix = prefix.replace('\\', "\\\\").replace('"', "\\\""),
            dest_file = dest_file.replace('\\', "\\\\").replace('"', "\\\"")
        );

        let py_b64 = b64.encode(py_script.as_bytes());

        let upload_cmd = format!(
            r#"DEST="{dest_file}"
BUCKET="{bucket}"
REGION="{region}"
ENDPOINT="{endpoint}"
AKEY="{akey}"
SKEY="{skey}"
PREFIX="{prefix}"
FNAME="$(basename "$DEST")"
SKEY_PATH="${{PREFIX:+${{PREFIX%/}}/}}${{FNAME}}"

if command -v aws >/dev/null 2>&1; then
    ENDPOINT_FLAG=""
    [ -n "$ENDPOINT" ] && ENDPOINT_FLAG="--endpoint-url $ENDPOINT"
    AWS_ACCESS_KEY_ID="$AKEY" AWS_SECRET_ACCESS_KEY="$SKEY" AWS_DEFAULT_REGION="$REGION" \
    aws s3 cp "$DEST" "s3://${{BUCKET}}/${{SKEY_PATH}}" $ENDPOINT_FLAG
    echo "SUCCESS:s3://${{BUCKET}}/${{SKEY_PATH}}"
else
    python3 -c "import base64; exec(base64.b64decode('{py_b64}').decode('utf-8'))"
fi"#,
            dest_file = escape_bash(&dest_file),
            bucket = escape_bash(bucket),
            region = escape_bash(region),
            endpoint = escape_bash(endpoint),
            akey = escape_bash(akey),
            skey = escape_bash(skey),
            prefix = escape_bash(prefix),
            py_b64 = py_b64
        );

        let out = exec_ssh_command_full(&mut session, &upload_cmd, Duration::from_secs(1800)).await?;
        if out.exit_status.unwrap_or(0) != 0 {
            return Err(CommandError::Internal(format!("S3 upload failed: {}", out.stderr.trim())));
        }

        let remote_path = out.stdout.trim().lines().find(|l| l.starts_with("SUCCESS:")).map(|l| l.strip_prefix("SUCCESS:").unwrap_or(l)).unwrap_or(&format!("s3://{}/{}", bucket, prefix)).to_string();

        {
            let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
            log_activity(&conn, ActivityEntry {
                server_id: Some(server_id),
                action: actions::UPLOAD_BACKUP_CLOUD.into(),
                target: Some(dest_file),
                status: "success".into(),
                detail: Some(format!("Uploaded backup archive to S3 at {}", remote_path)),
                duration_ms: Some(start_time.elapsed().as_millis() as i64),
            });
        }

        Ok(CloudUploadResult {
            success: true,
            message: format!("Backup successfully uploaded to S3: {}", remote_path),
            remote_path,
        })
    } else {
        Err(CommandError::Validation(format!("Unsupported storage provider '{}'", target_provider)))
    }
}

#[tauri::command]
pub async fn list_cloud_configs(
    state: tauri::State<'_, AppState>,
) -> CommandResult<Vec<CloudStorageConfig>> {
    let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, name, provider, config_json, created_at, updated_at
         FROM cloud_storage_configs
         ORDER BY name ASC"
    ).map_err(|e| CommandError::Database(e.to_string()))?;

    let rows = stmt.query_map([], |r| {
        Ok(CloudStorageConfig {
            id: r.get(0)?,
            name: r.get(1)?,
            provider: r.get(2)?,
            config_json: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
        })
    }).map_err(|e| CommandError::Database(e.to_string()))?;

    let mut res = Vec::new();
    for row in rows {
        if let Ok(c) = row {
            res.push(c);
        }
    }
    Ok(res)
}

#[tauri::command]
pub async fn save_cloud_config(
    state: tauri::State<'_, AppState>,
    options: SaveCloudStorageConfigOptions,
) -> CommandResult<CloudStorageConfig> {
    if options.name.trim().is_empty() {
        return Err(CommandError::Validation("Cloud configuration name cannot be empty".into()));
    }
    let id = options.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let now_iso = chrono::Utc::now().to_rfc3339();

    let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
    conn.execute(
        "INSERT INTO cloud_storage_configs (id, name, provider, config_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            provider = excluded.provider,
            config_json = excluded.config_json,
            updated_at = excluded.updated_at",
        rusqlite::params![id, options.name, options.provider, options.config_json, now_iso]
    ).map_err(|e| CommandError::Database(e.to_string()))?;

    Ok(CloudStorageConfig {
        id,
        name: options.name,
        provider: options.provider,
        config_json: options.config_json,
        created_at: now_iso.clone(),
        updated_at: now_iso,
    })
}

#[tauri::command]
pub async fn delete_cloud_config(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
    conn.execute("DELETE FROM cloud_storage_configs WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| CommandError::Database(e.to_string()))?;
    Ok(())
}
