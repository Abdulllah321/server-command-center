use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::db::{log_activity, ActivityEntry, actions};
use serde::{Deserialize, Serialize};
use std::time::Instant;
use russh::ChannelMsg;
use tokio::time::{timeout, Duration};
use crate::ssh::client::SshClientHandler;
use russh::client::Handle;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvFileEntry {
    pub path: String,
    pub filename: String,
    pub size: u64,
    pub modified: i64,
    pub app_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVariableItem {
    pub key: String,
    pub value: String,
    pub raw_line: String,
    pub comment: Option<String>,
    pub is_secret: bool,
    pub line_number: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvBackupEntry {
    pub backup_path: String,
    pub filename: String,
    pub size: u64,
    pub modified: i64,
    pub timestamp_str: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvFileDetails {
    pub path: String,
    pub raw_content: String,
    pub items: Vec<EnvVariableItem>,
    pub modified: i64,
    pub size: u64,
    pub backups: Vec<EnvBackupEntry>,
}

/// Helper to execute an SSH command with timeout
async fn exec_ssh_command(
    session: &mut Handle<SshClientHandler>,
    cmd: &str,
) -> Result<String, CommandError> {
    let mut channel = session.channel_open_session().await
        .map_err(|e| CommandError::Internal(format!("Failed to open SSH channel: {}", e)))?;

    channel.exec(true, cmd).await
        .map_err(|e| CommandError::Internal(format!("Failed to exec command '{}': {}", cmd, e)))?;

    let mut output = String::new();
    let timeout_duration = Duration::from_secs(45);

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
            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
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

/// Determines whether a key name represents a sensitive credential
pub fn is_sensitive_key(key: &str) -> bool {
    let k = key.to_uppercase();
    k.contains("SECRET")
        || k.contains("PASSWORD")
        || k.contains("PASSWD")
        || k.contains("TOKEN")
        || k.contains("API_KEY")
        || k.contains("APIKEY")
        || k.contains("AUTH")
        || k.contains("PRIVATE")
        || k.contains("CERT")
        || k.contains("CREDENTIAL")
        || k.contains("DATABASE_URL")
        || k.contains("DB_PASS")
        || k.contains("JWT")
        || k.contains("ENCRYPTION")
        || k.contains("SIGNING")
        || k.contains("HASH")
        || k.contains("ACCESS_KEY")
}

/// Parses .env raw text into structured items
pub fn parse_env_content(raw: &str) -> Vec<EnvVariableItem> {
    let mut items = Vec::new();
    let mut current_comment: Option<String> = None;

    for (idx, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            current_comment = None;
            continue;
        }

        if trimmed.starts_with('#') {
            let comment_text = trimmed.trim_start_matches('#').trim().to_string();
            current_comment = Some(comment_text);
            continue;
        }

        // Parse KEY=VALUE
        if let Some((k, v)) = trimmed.split_once('=') {
            let key = k.trim().to_string();
            let mut val = v.trim().to_string();

            // Strip surrounding matching single or double quotes
            if (val.starts_with('"') && val.ends_with('"') && val.len() >= 2)
                || (val.starts_with('\'') && val.ends_with('\'') && val.len() >= 2)
            {
                val = val[1..val.len() - 1].to_string();
            }

            let is_secret = is_sensitive_key(&key);

            items.push(EnvVariableItem {
                key,
                value: val,
                raw_line: line.to_string(),
                comment: current_comment.take(),
                is_secret,
                line_number: idx + 1,
            });
        }
    }

    items
}

/// Discovers .env files across applications and standard paths
#[tauri::command]
pub async fn list_server_env_files(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    custom_paths: Option<Vec<String>>,
) -> CommandResult<Vec<EnvFileEntry>> {
    if server_id.is_empty() {
        return Err(CommandError::Validation("Server ID required".into()));
    }

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let extra_roots = custom_paths.unwrap_or_default();
    let roots_json = serde_json::to_string(&extra_roots).unwrap_or_else(|_| "[]".into());

    let script = format!(
        r#"
python3 -c '
import os, json, stat, sys

extra_roots = json.loads({roots_json_raw:?})
search_roots = ["/var/www", "/home", "/root", "/etc"] + extra_roots
found = []
seen = set()

# Inspect running PM2 processes if available
try:
    import subprocess
    res = subprocess.run(["pm2", "jlist"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
    if res.returncode == 0:
        apps = json.loads(res.stdout)
        for app in apps:
            cwd = app.get("pm2_env", {{}}).get("pm_cwd")
            name = app.get("name")
            if cwd and os.path.isdir(cwd):
                for f in os.listdir(cwd):
                    if f.startswith(".env") and not f.endswith(".bak") and ".bak." not in f and not f.endswith(".tmp"):
                        fp = os.path.join(cwd, f)
                        if fp not in seen and os.path.isfile(fp):
                            seen.add(fp)
                            s = os.stat(fp)
                            found.append({{
                                "path": fp,
                                "filename": f,
                                "size": s.st_size,
                                "modified": int(s.st_mtime),
                                "app_name": name
                            }})
except Exception:
    pass

for root_dir in search_roots:
    if not os.path.isdir(root_dir):
        continue
    for root, dirs, files in os.walk(root_dir):
        depth = root[len(root_dir):].count(os.sep)
        if depth > 4:
            dirs.clear()
            continue
        for f in files:
            if f.startswith(".env") and not f.endswith(".bak") and ".bak." not in f and not f.endswith(".tmp"):
                fp = os.path.join(root, f)
                if fp not in seen:
                    seen.add(fp)
                    try:
                        s = os.stat(fp)
                        found.append({{
                            "path": fp,
                            "filename": f,
                            "size": s.st_size,
                            "modified": int(s.st_mtime),
                            "app_name": os.path.basename(root)
                        }})
                    except Exception:
                        pass
        if len(found) >= 150:
            break

found.sort(key=lambda x: x["path"])
print(json.dumps({{"files": found}}))
' 2>/dev/null || (
  find /var/www /home /root -maxdepth 4 -name ".env*" ! -name "*.bak*" 2>/dev/null | head -n 50
)
"#,
        roots_json_raw = roots_json
    );

    let output = exec_ssh_command(&mut session, &script).await?;
    let trimmed = output.trim();

    #[derive(Deserialize)]
    struct FilesResp {
        files: Vec<EnvFileEntry>,
    }

    if let Ok(parsed) = serde_json::from_str::<FilesResp>(trimmed) {
        return Ok(parsed.files);
    }

    // Fallback parser if JSON failed
    let mut fallback_entries = Vec::new();
    for line in trimmed.lines() {
        let p = line.trim();
        if !p.is_empty() {
            let filename = p.split('/').last().unwrap_or(p).to_string();
            fallback_entries.push(EnvFileEntry {
                path: p.to_string(),
                filename,
                size: 0,
                modified: 0,
                app_name: None,
            });
        }
    }

    Ok(fallback_entries)
}

/// Reads a remote .env file, parses items, and lists available backups
#[tauri::command]
pub async fn read_env_file(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    file_path: String,
) -> CommandResult<EnvFileDetails> {
    if server_id.is_empty() || file_path.is_empty() {
        return Err(CommandError::Validation("Server ID and file path required".into()));
    }

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let path_clean = file_path.replace('"', "\\\"");

    let script = format!(
        r#"
P="{}"
if [ ! -f "$P" ]; then
    echo "ERROR: File not found" >&2
    exit 1
fi

B64=$(base64 "$P" 2>/dev/null || cat "$P" | base64)
SIZE=$(wc -c < "$P" 2>/dev/null || stat -c%s "$P" 2>/dev/null || echo 0)
MTIME=$(stat -c%Y "$P" 2>/dev/null || echo 0)

DIR=$(dirname "$P")
BASE=$(basename "$P")

python3 -c '
import os, sys, json, stat, glob, datetime

p = sys.argv[1]
b64 = sys.argv[2]
size = int(sys.argv[3])
mtime = int(sys.argv[4])
d = os.path.dirname(p)
base = os.path.basename(p)

backups = []
try:
    for bf in glob.glob(os.path.join(d, base + ".bak.*")):
        if os.path.isfile(bf):
            s = os.stat(bf)
            ts_part = os.path.basename(bf).split(".bak.")[-1]
            backups.append({{
                "backup_path": bf,
                "filename": os.path.basename(bf),
                "size": s.st_size,
                "modified": int(s.st_mtime),
                "timestamp_str": ts_part
            }})
except Exception:
    pass

backups.sort(key=lambda x: x["modified"], reverse=True)

print(json.dumps({{
    "path": p,
    "b64": b64,
    "size": size,
    "modified": mtime,
    "backups": backups
}}))
' "$P" "$B64" "$SIZE" "$MTIME"
"#,
        path_clean
    );

    let output = exec_ssh_command(&mut session, &script).await?;
    let trimmed = output.trim();

    #[derive(Deserialize)]
    struct DetailsRaw {
        path: String,
        b64: String,
        size: u64,
        modified: i64,
        backups: Vec<EnvBackupEntry>,
    }

    let parsed = serde_json::from_str::<DetailsRaw>(trimmed)
        .map_err(|e| CommandError::Internal(format!("Failed to parse file response: {}", e)))?;

    let clean_b64: String = parsed.b64.chars().filter(|c| !c.is_whitespace()).collect();
    let raw_bytes = B64.decode(clean_b64)
        .map_err(|e| CommandError::Internal(format!("Base64 decode error: {}", e)))?;
    let raw_content = String::from_utf8_lossy(&raw_bytes).to_string();

    let items = parse_env_content(&raw_content);

    Ok(EnvFileDetails {
        path: parsed.path,
        raw_content,
        items,
        modified: parsed.modified,
        size: parsed.size,
        backups: parsed.backups,
    })
}

/// Atomically saves content to a remote .env file with an automatic timestamped backup
#[tauri::command]
pub async fn save_env_file(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    file_path: String,
    content: String,
    create_backup: bool,
) -> CommandResult<String> {
    if server_id.is_empty() || file_path.is_empty() {
        return Err(CommandError::Validation("Server ID and file path required".into()));
    }

    // Safety checks against overwriting critical system files
    let forbidden_roots = ["/etc/passwd", "/etc/shadow", "/etc/sudoers", "/bin", "/boot", "/dev", "/sys", "/proc"];
    for fb in forbidden_roots {
        if file_path == fb {
            return Err(CommandError::Forbidden(format!("Refusing to write to critical system path: {}", file_path)));
        }
    }

    let start = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let b64_payload = B64.encode(content.as_bytes());
    let path_clean = file_path.replace('"', "\\\"");
    let tmp_file = format!("{}.tmp.{}", file_path, uuid::Uuid::new_v4().simple());

    let script = format!(
        r#"
P="{}"
TMP="{}"
CREATE_BAK="{}"

DIR=$(dirname "$P")
mkdir -p "$DIR" 2>/dev/null || true

BACKUP_PATH=""
if [ "$CREATE_BAK" = "1" ] && [ -f "$P" ]; then
    TS=$(date +%Y%m%d_%H%M%S)
    BACKUP_PATH="$P.bak.$TS"
    cp -p "$P" "$BACKUP_PATH" 2>/dev/null || true
fi

printf '%s' "{}" | base64 -d > "$TMP" && mv "$TMP" "$P"
echo "BACKUP:$BACKUP_PATH"
"#,
        path_clean,
        tmp_file.replace('"', "\\\""),
        if create_backup { "1" } else { "0" },
        b64_payload
    );

    let output = exec_ssh_command(&mut session, &script).await;

    let backup_created = match &output {
        Ok(out) => {
            out.lines()
                .find(|l| l.starts_with("BACKUP:"))
                .map(|l| l.trim_start_matches("BACKUP:").trim().to_string())
                .unwrap_or_default()
        }
        Err(_) => String::new(),
    };

    // Audit log without leaking secret values!
    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::SAVE_ENV_FILE.into(),
            target: Some(file_path.clone()),
            status: if output.is_ok() { "success".into() } else { "failed".into() },
            detail: Some(format!(
                "Lines: {}, Backup: {}",
                content.lines().count(),
                if backup_created.is_empty() { "none" } else { &backup_created }
            )),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
    }

    output.map(|_| backup_created)
}

/// Lists all backup snapshots for a given .env file
#[tauri::command]
pub async fn list_env_backups(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    file_path: String,
) -> CommandResult<Vec<EnvBackupEntry>> {
    if server_id.is_empty() || file_path.is_empty() {
        return Err(CommandError::Validation("Server ID and file path required".into()));
    }

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let path_clean = file_path.replace('"', "\\\"");

    let script = format!(
        r#"
P="{}"
DIR=$(dirname "$P")
BASE=$(basename "$P")

python3 -c '
import os, sys, json, stat, glob

p = sys.argv[1]
d = os.path.dirname(p)
base = os.path.basename(p)

backups = []
try:
    for bf in glob.glob(os.path.join(d, base + ".bak.*")):
        if os.path.isfile(bf):
            s = os.stat(bf)
            ts_part = os.path.basename(bf).split(".bak.")[-1]
            backups.append({{
                "backup_path": bf,
                "filename": os.path.basename(bf),
                "size": s.st_size,
                "modified": int(s.st_mtime),
                "timestamp_str": ts_part
            }})
except Exception:
    pass

backups.sort(key=lambda x: x["modified"], reverse=True)
print(json.dumps({{"backups": backups}}))
' "$P"
"#,
        path_clean
    );

    let output = exec_ssh_command(&mut session, &script).await?;
    let trimmed = output.trim();

    #[derive(Deserialize)]
    struct BackupsResp {
        backups: Vec<EnvBackupEntry>,
    }

    if let Ok(parsed) = serde_json::from_str::<BackupsResp>(trimmed) {
        return Ok(parsed.backups);
    }

    Ok(Vec::new())
}

/// Restores a selected backup file to the target .env file with pre-rollback snapshot
#[tauri::command]
pub async fn restore_env_backup(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    file_path: String,
    backup_path: String,
) -> CommandResult<()> {
    if server_id.is_empty() || file_path.is_empty() || backup_path.is_empty() {
        return Err(CommandError::Validation("Server ID, file path, and backup path required".into()));
    }

    let start = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let script = format!(
        r#"
P="{}"
BAK="{}"

if [ ! -f "$BAK" ]; then
    echo "ERROR: Backup file does not exist" >&2
    exit 1
fi

# Take safety backup of current state
if [ -f "$P" ]; then
    cp -p "$P" "$P.bak.pre_rollback_$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
fi

cp -p "$BAK" "$P"
"#,
        file_path.replace('"', "\\\""),
        backup_path.replace('"', "\\\"")
    );

    let output = exec_ssh_command(&mut session, &script).await;

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::RESTORE_ENV_FILE.into(),
            target: Some(file_path.clone()),
            status: if output.is_ok() { "success".into() } else { "failed".into() },
            detail: Some(format!("Restored from: {}", backup_path)),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
    }

    output.map(|_| ())
}

