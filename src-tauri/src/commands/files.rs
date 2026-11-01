use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::db::{log_activity, ActivityEntry, actions};
use crate::commands::confirmation::consume_token;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use russh::ChannelMsg;
use tokio::time::{timeout, Duration};
use crate::ssh::client::SshClientHandler;
use russh::client::Handle;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: i64,       // Unix timestamp in seconds
    pub permissions: String, // e.g. "drwxr-xr-x"
    pub mode: String,        // e.g. "0755"
    pub owner: String,       // owner username or UID
    pub group: String,       // group name or GID
    pub extension: String,   // lowercase extension (e.g. "sh", "env", "json")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteDirectoryListing {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<RemoteFileEntry>,
    pub total_files: usize,
    pub total_dirs: usize,
    pub total_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFileContent {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub is_binary: bool,
    pub is_truncated: bool,
    pub encoding: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadedFilePayload {
    pub filename: String,
    pub base64_content: String,
    pub size: u64,
    pub is_archive: bool,
}

/// Helper to execute a command over SSH with a strict timeout and zero server memory footprint
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
                return Err(CommandError::Internal("SSH file command timed out".into()));
            }
        };

        match msg_opt {
            Some(ChannelMsg::Data { ref data }) => {
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                // Include stderr for diagnostics if output is empty
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

/// Lists files and directories at `path` on the remote server
#[tauri::command]
pub async fn list_remote_files(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    path: Option<String>,
) -> CommandResult<RemoteDirectoryListing> {
    if server_id.is_empty() {
        return Err(CommandError::Validation("Server ID required".into()));
    }

    let target_path = path.unwrap_or_else(|| "~".to_string());
    
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    // Zero-server-memory script: prefers Python 3 for high-speed, 100% strict JSON serialization;
    // seamlessly falls back to pure POSIX shell + stat/ls if Python is unavailable.
    let script = format!(
        r#"
TARGET="{}"
[ -z "$TARGET" ] && TARGET="~"

if command -v python3 >/dev/null 2>&1; then
python3 -c '
import os, sys, stat, json, pwd, grp

target = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else "~"
try:
    target = os.path.expanduser(target)
    target = os.path.abspath(target)
    entries = []
    total_files = 0
    total_dirs = 0
    total_size = 0
    
    with os.scandir(target) as it:
        for e in it:
            try:
                s = e.stat(follow_symlinks=False)
                is_dir = stat.S_ISDIR(s.st_mode)
                is_lnk = stat.S_ISLNK(s.st_mode)
                size = s.st_size if not is_dir else 0
                
                try: owner = pwd.getpwuid(s.st_uid).pw_name
                except: owner = str(s.st_uid)
                try: group = grp.getgrgid(s.st_gid).gr_name
                except: group = str(s.st_gid)
                
                ext = ""
                if not is_dir and "." in e.name and not e.name.startswith("."):
                    ext = e.name.rsplit(".", 1)[-1].lower()
                elif not is_dir and e.name.startswith("."):
                    ext = e.name[1:].lower()
                    
                entries.append({{
                    "name": e.name,
                    "path": os.path.join(target, e.name),
                    "is_dir": is_dir,
                    "is_symlink": is_lnk,
                    "size": size,
                    "modified": int(s.st_mtime),
                    "permissions": stat.filemode(s.st_mode),
                    "mode": oct(s.st_mode & 0o777)[2:].zfill(4),
                    "owner": owner,
                    "group": group,
                    "extension": ext
                }})
                if is_dir:
                    total_dirs += 1
                else:
                    total_files += 1
                    total_size += size
            except Exception:
                pass
                
    parent = os.path.dirname(target) if target != "/" else None
    print(json.dumps({{
        "success": True,
        "current_path": target,
        "parent_path": parent,
        "entries": entries,
        "total_files": total_files,
        "total_dirs": total_dirs,
        "total_size": total_size
    }}))
except Exception as err:
    print(json.dumps({{"success": False, "error": str(err)}}))
' "$TARGET"
else
  # Minimal pure POSIX fallback
  TARGET=$(eval echo "$TARGET")
  cd "$TARGET" 2>/dev/null || {{ echo '{{"success":false,"error":"Directory not accessible"}}'; exit 0; }}
  REAL_PATH=$(pwd -P)
  PARENT=$(dirname "$REAL_PATH")
  [ "$REAL_PATH" = "/" ] && PARENT=""
  echo -n '{{"success":true,"current_path":"'$REAL_PATH'","parent_path":'
  if [ -n "$PARENT" ]; then echo -n '"'$PARENT'",'; else echo -n 'null,'; fi
  echo -n '"entries":['
  FIRST=1
  TOTAL_FILES=0
  TOTAL_DIRS=0
  TOTAL_SIZE=0
  for f in .* *; do
    [ "$f" = "." ] || [ "$f" = ".." ] && continue
    [ -e "$f" ] || [ -L "$f" ] || continue
    [ "$FIRST" = "0" ] && echo -n ','
    FIRST=0
    IS_DIR=false; [ -d "$f" ] && IS_DIR=true
    IS_LNK=false; [ -L "$f" ] && IS_LNK=true
    SZ=$(stat -c%s "$f" 2>/dev/null || echo 0)
    [ "$IS_DIR" = "true" ] && SZ=0
    MT=$(stat -c%Y "$f" 2>/dev/null || echo 0)
    PERM=$(stat -c%A "$f" 2>/dev/null || echo "-rw-r--r--")
    MODE=$(stat -c%a "$f" 2>/dev/null || echo "0644")
    OWNER=$(stat -c%U "$f" 2>/dev/null || echo "root")
    GRP=$(stat -c%G "$f" 2>/dev/null || echo "root")
    EXT="${{f##*.}}"
    [ "$EXT" = "$f" ] && EXT=""
    [ "$IS_DIR" = "true" ] && TOTAL_DIRS=$((TOTAL_DIRS + 1)) || {{ TOTAL_FILES=$((TOTAL_FILES + 1)); TOTAL_SIZE=$((TOTAL_SIZE + SZ)); }}
    echo -n '{{"name":"'$f'","path":"'$REAL_PATH/$f'","is_dir":'$IS_DIR',"is_symlink":'$IS_LNK',"size":'$SZ',"modified":'$MT',"permissions":"'$PERM'","mode":"'$MODE'","owner":"'$OWNER'","group":"'$GRP'","extension":"'$EXT'"}}'
  done
  echo -n '],"total_files":'$TOTAL_FILES',"total_dirs":'$TOTAL_DIRS',"total_size":'$TOTAL_SIZE'}}'
fi
"#,
        target_path.replace('"', "\\\"")
    );

    let output = exec_ssh_command(&mut session, &script).await?;
    let trimmed = output.trim();
    
    // Parse JSON response
    #[derive(Deserialize)]
    struct ScriptResponse {
        success: bool,
        error: Option<String>,
        current_path: Option<String>,
        parent_path: Option<String>,
        entries: Option<Vec<RemoteFileEntry>>,
        total_files: Option<usize>,
        total_dirs: Option<usize>,
        total_size: Option<u64>,
    }

    let parsed: ScriptResponse = serde_json::from_str(trimmed)
        .map_err(|e| CommandError::Internal(format!("Failed to parse remote directory response: {} (Raw: {})", e, trimmed)))?;

    if !parsed.success {
        return Err(CommandError::NotFound(parsed.error.unwrap_or_else(|| "Failed to read directory".into())));
    }

    let mut entries = parsed.entries.unwrap_or_default();
    // Sort directories first, then alphabetically
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    let current_path = parsed.current_path.unwrap_or_else(|| target_path);
    let parent_path = parsed.parent_path.filter(|p| p != &current_path);

    Ok(RemoteDirectoryListing {
        current_path,
        parent_path,
        total_files: parsed.total_files.unwrap_or(entries.iter().filter(|e| !e.is_dir).count()),
        total_dirs: parsed.total_dirs.unwrap_or(entries.iter().filter(|e| e.is_dir).count()),
        total_size: parsed.total_size.unwrap_or(entries.iter().map(|e| e.size).sum()),
        entries,
    })
}

/// Reads the text or base64 content of a file for viewing or editing
#[tauri::command]
pub async fn read_remote_file_content(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    path: String,
    max_bytes: Option<u64>,
) -> CommandResult<RemoteFileContent> {
    if server_id.is_empty() || path.is_empty() {
        return Err(CommandError::Validation("Server ID and file path required".into()));
    }

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let limit = max_bytes.unwrap_or(2 * 1024 * 1024); // Default 2 MB preview limit

    let script = format!(
        r#"
P="{}"
if [ ! -f "$P" ] && [ ! -L "$P" ]; then
    echo "FILE_NOT_FOUND"
    exit 0
fi

SIZE=$(stat -c%s "$P" 2>/dev/null || wc -c < "$P" 2>/dev/null || echo 0)
IS_BINARY=0
# Check if file has null byte in first 4KB
if head -c 4096 "$P" | grep -q $'\0' 2>/dev/null; then
    IS_BINARY=1
fi

LIMIT={}
TRUNCATED=0
if [ "$SIZE" -gt "$LIMIT" ]; then
    TRUNCATED=1
fi

echo "---META---"
echo "SIZE:$SIZE"
echo "IS_BINARY:$IS_BINARY"
echo "TRUNCATED:$TRUNCATED"
echo "---CONTENT---"
head -c "$LIMIT" "$P" | base64
"#,
        path.replace('"', "\\\""),
        limit
    );

    let output = exec_ssh_command(&mut session, &script).await?;
    if output.contains("FILE_NOT_FOUND") {
        return Err(CommandError::NotFound(format!("File not found: {}", path)));
    }

    let mut size = 0u64;
    let mut is_binary = false;
    let mut is_truncated = false;
    let mut b64_content = String::new();

    if let Some((meta, content_part)) = output.split_once("---CONTENT---") {
        for line in meta.lines() {
            let l = line.trim();
            if let Some(s) = l.strip_prefix("SIZE:") {
                size = s.parse().unwrap_or(0);
            } else if let Some(b) = l.strip_prefix("IS_BINARY:") {
                is_binary = b == "1";
            } else if let Some(t) = l.strip_prefix("TRUNCATED:") {
                is_truncated = t == "1";
            }
        }
        b64_content = content_part.chars().filter(|c| !c.is_whitespace()).collect();
    }

    let decoded_bytes = B64.decode(&b64_content).unwrap_or_default();
    let text_content = if !is_binary {
        String::from_utf8_lossy(&decoded_bytes).to_string()
    } else {
        b64_content // Return base64 for binary
    };

    Ok(RemoteFileContent {
        path,
        content: text_content,
        size,
        is_binary,
        is_truncated,
        encoding: if is_binary { "base64".into() } else { "utf-8".into() },
    })
}

/// Atomically writes content to a remote file, with optional auto-backup (.bak)
#[tauri::command]
pub async fn write_remote_file_content(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    path: String,
    content: String,
    create_backup: bool,
) -> CommandResult<()> {
    if server_id.is_empty() || path.is_empty() {
        return Err(CommandError::Validation("Server ID and file path required".into()));
    }

    let start = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let b64_payload = B64.encode(content.as_bytes());
    let tmp_file = format!("{}.tmp.{}", path, uuid::Uuid::new_v4().simple());

    let script = format!(
        r#"
P="{}"
TMP="{}"

# Optional backup
if [ "{}" = "1" ] && [ -f "$P" ]; then
    cp -p "$P" "$P.bak.$(date +%s)" 2>/dev/null || true
fi

# Write atomically via base64 decode
DIR=$(dirname "$P")
mkdir -p "$DIR" 2>/dev/null || true

printf '%s' "{}" | base64 -d > "$TMP" && mv "$TMP" "$P"
"#,
        path.replace('"', "\\\""),
        tmp_file.replace('"', "\\\""),
        if create_backup { "1" } else { "0" },
        b64_payload
    );

    let output = exec_ssh_command(&mut session, &script).await;

    // Audit log
    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::WRITE_REMOTE_FILE.into(),
            target: Some(path),
            status: if output.is_ok() { "success".into() } else { "failed".into() },
            detail: output.as_ref().err().map(|e| e.to_string()),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
    }

    output.map(|_| ())
}

/// Downloads a remote file or directory (compressed into tar.gz on the fly)
#[tauri::command]
pub async fn download_remote_file(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    path: String,
) -> CommandResult<DownloadedFilePayload> {
    if server_id.is_empty() || path.is_empty() {
        return Err(CommandError::Validation("Server ID and path required".into()));
    }

    let start = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let script = format!(
        r#"
P="{}"
if [ ! -e "$P" ]; then
    echo "PATH_NOT_FOUND"
    exit 0
fi

BNAME=$(basename "$P")
if [ -d "$P" ]; then
    echo "---ARCHIVE---"
    echo "FILENAME:${{BNAME}}.tar.gz"
    echo "---DATA---"
    tar -czf - -C "$(dirname "$P")" "$BNAME" 2>/dev/null | base64
else
    echo "---FILE---"
    echo "FILENAME:$BNAME"
    echo "---DATA---"
    cat "$P" | base64
fi
"#,
        path.replace('"', "\\\"")
    );

    let output = exec_ssh_command(&mut session, &script).await?;
    if output.contains("PATH_NOT_FOUND") {
        return Err(CommandError::NotFound(format!("Remote path not found: {}", path)));
    }

    let is_archive = output.contains("---ARCHIVE---");
    let mut filename = "download".to_string();
    let mut base64_content = String::new();

    if let Some((meta, data_part)) = output.split_once("---DATA---") {
        for line in meta.lines() {
            if let Some(f) = line.strip_prefix("FILENAME:") {
                filename = f.trim().to_string();
            }
        }
        base64_content = data_part.chars().filter(|c| !c.is_whitespace()).collect();
    }

    let size = (base64_content.len() * 3 / 4) as u64;

    // Audit log
    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::DOWNLOAD_REMOTE_FILE.into(),
            target: Some(path),
            status: "success".into(),
            detail: Some(format!("Downloaded {}, size ~{} bytes", filename, size)),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
    }

    Ok(DownloadedFilePayload {
        filename,
        base64_content,
        size,
        is_archive,
    })
}

/// Uploads a file to a remote directory via base64 stream (zero daemon, atomic write)
#[tauri::command]
pub async fn upload_remote_file(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    remote_dir: String,
    filename: String,
    base64_content: String,
) -> CommandResult<()> {
    if server_id.is_empty() || remote_dir.is_empty() || filename.is_empty() {
        return Err(CommandError::Validation("Server ID, remote dir, and filename required".into()));
    }

    // Sanitize filename to prevent directory traversal
    let safe_filename = filename.replace('/', "").replace('\\', "").replace("..", "");
    if safe_filename.is_empty() {
        return Err(CommandError::Validation("Invalid filename".into()));
    }

    let start = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let target_path = format!("{}/{}", remote_dir.trim_end_matches('/'), safe_filename);
    let tmp_file = format!("{}.tmp.{}", target_path, uuid::Uuid::new_v4().simple());

    let script = format!(
        r#"
DIR="{}"
TARGET="{}"
TMP="{}"

mkdir -p "$DIR" 2>/dev/null || true
printf '%s' "{}" | base64 -d > "$TMP" && mv "$TMP" "$TARGET"
"#,
        remote_dir.replace('"', "\\\""),
        target_path.replace('"', "\\\""),
        tmp_file.replace('"', "\\\""),
        base64_content
    );

    let output = exec_ssh_command(&mut session, &script).await;

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::UPLOAD_REMOTE_FILE.into(),
            target: Some(target_path),
            status: if output.is_ok() { "success".into() } else { "failed".into() },
            detail: output.as_ref().err().map(|e| e.to_string()),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
    }

    output.map(|_| ())
}

/// Creates a new directory on the remote server
#[tauri::command]
pub async fn create_remote_directory(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    path: String,
) -> CommandResult<()> {
    if server_id.is_empty() || path.is_empty() {
        return Err(CommandError::Validation("Server ID and directory path required".into()));
    }

    let start = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let script = format!("mkdir -p \"{}\"", path.replace('"', "\\\""));
    let output = exec_ssh_command(&mut session, &script).await;

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::CREATE_REMOTE_DIRECTORY.into(),
            target: Some(path),
            status: if output.is_ok() { "success".into() } else { "failed".into() },
            detail: output.as_ref().err().map(|e| e.to_string()),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
    }

    output.map(|_| ())
}

/// Creates a new empty file on the remote server
#[tauri::command]
pub async fn create_remote_file(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    path: String,
) -> CommandResult<()> {
    if server_id.is_empty() || path.is_empty() {
        return Err(CommandError::Validation("Server ID and file path required".into()));
    }

    let start = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let script = format!(
        "mkdir -p \"$(dirname \"{}\")\" && touch \"{}\"",
        path.replace('"', "\\\""),
        path.replace('"', "\\\"")
    );
    let output = exec_ssh_command(&mut session, &script).await;

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::CREATE_REMOTE_FILE.into(),
            target: Some(path),
            status: if output.is_ok() { "success".into() } else { "failed".into() },
            detail: output.as_ref().err().map(|e| e.to_string()),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
    }

    output.map(|_| ())
}

/// Renames or moves a file or folder on the remote server
#[tauri::command]
pub async fn rename_remote_path(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    old_path: String,
    new_path: String,
) -> CommandResult<()> {
    if server_id.is_empty() || old_path.is_empty() || new_path.is_empty() {
        return Err(CommandError::Validation("Paths cannot be empty".into()));
    }

    let start = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let script = format!(
        "mv \"{}\" \"{}\"",
        old_path.replace('"', "\\\""),
        new_path.replace('"', "\\\"")
    );
    let output = exec_ssh_command(&mut session, &script).await;

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::RENAME_REMOTE_PATH.into(),
            target: Some(format!("{} -> {}", old_path, new_path)),
            status: if output.is_ok() { "success".into() } else { "failed".into() },
            detail: output.as_ref().err().map(|e| e.to_string()),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
    }

    output.map(|_| ())
}

/// Deletes one or multiple files/directories, verified with confirmation token
#[tauri::command]
pub async fn delete_remote_paths(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    paths: Vec<String>,
    recursive: bool,
    confirmation_token: String,
) -> CommandResult<()> {
    if server_id.is_empty() || paths.is_empty() {
        return Err(CommandError::Validation("Server ID and paths required".into()));
    }

    // Verify confirmation token for destructive file deletion
    consume_token(Some(&confirmation_token)).await?;

    // Safety checks against deleting root system directories
    let forbidden_roots = ["/", "/etc", "/bin", "/boot", "/dev", "/lib", "/lib64", "/proc", "/sys", "/usr", "/root"];
    for p in &paths {
        let clean = p.trim().trim_end_matches('/');
        if forbidden_roots.contains(&clean) {
            return Err(CommandError::Forbidden(format!("Refusing to delete critical system path: {}", p)));
        }
    }

    let start = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let mut escaped_paths = Vec::new();
    for p in &paths {
        escaped_paths.push(format!("\"{}\"", p.replace('"', "\\\"")));
    }

    let rm_cmd = if recursive { "rm -rf" } else { "rm -f" };
    let script = format!("{} {}", rm_cmd, escaped_paths.join(" "));
    let output = exec_ssh_command(&mut session, &script).await;

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::DELETE_REMOTE_PATH.into(),
            target: Some(paths.join(", ")),
            status: if output.is_ok() { "success".into() } else { "failed".into() },
            detail: output.as_ref().err().map(|e| e.to_string()),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
    }

    output.map(|_| ())
}

/// Modifies file or folder permissions (chmod)
#[tauri::command]
pub async fn change_remote_permissions(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    path: String,
    mode: String,
    recursive: bool,
) -> CommandResult<()> {
    if server_id.is_empty() || path.is_empty() || mode.is_empty() {
        return Err(CommandError::Validation("Server ID, path, and mode required".into()));
    }

    // Validate mode to prevent shell injection (octal like 0755 or symbolic like +x, u+rwx, go-w)
    let is_valid_mode = mode.chars().all(|c| c.is_ascii_digit() || "+-=ugoa rwxXst,".contains(c));
    if !is_valid_mode {
        return Err(CommandError::Validation("Invalid permissions mode format".into()));
    }

    let start = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let script = format!(
        "chmod {} \"{}\" \"{}\"",
        if recursive { "-R" } else { "" },
        mode,
        path.replace('"', "\\\"")
    );
    let output = exec_ssh_command(&mut session, &script).await;

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::CHMOD_REMOTE_PATH.into(),
            target: Some(format!("chmod {} {}", mode, path)),
            status: if output.is_ok() { "success".into() } else { "failed".into() },
            detail: output.as_ref().err().map(|e| e.to_string()),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
    }

    output.map(|_| ())
}

/// Searches files and folders matching a query under `path`
#[tauri::command]
pub async fn search_remote_files(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    path: String,
    query: String,
) -> CommandResult<Vec<RemoteFileEntry>> {
    if server_id.is_empty() || path.is_empty() || query.is_empty() {
        return Ok(Vec::new());
    }

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let script = format!(
        r#"
P="{}"
Q="{}"

if command -v python3 >/dev/null 2>&1; then
python3 -c '
import os, sys, stat, json, pwd, grp

target = sys.argv[1]
query = sys.argv[2].lower()
entries = []

try:
    for root, dirs, files in os.walk(target):
        if len(entries) >= 100:
            break
        # Depth check: limit search depth to 4 levels
        rel_depth = root[len(target):].count(os.sep)
        if rel_depth > 4:
            dirs.clear()
            continue
            
        for name in dirs + files:
            if query in name.lower():
                full_path = os.path.join(root, name)
                try:
                    s = os.stat(full_path, follow_symlinks=False)
                    is_dir = stat.S_ISDIR(s.st_mode)
                    is_lnk = stat.S_ISLNK(s.st_mode)
                    size = s.st_size if not is_dir else 0
                    
                    try: owner = pwd.getpwuid(s.st_uid).pw_name
                    except: owner = str(s.st_uid)
                    try: group = grp.getgrgid(s.st_gid).gr_name
                    except: group = str(s.st_gid)
                    
                    ext = ""
                    if not is_dir and "." in name and not name.startswith("."):
                        ext = name.rsplit(".", 1)[-1].lower()
                    elif not is_dir and name.startswith("."):
                        ext = name[1:].lower()
                        
                    entries.append({{
                        "name": name,
                        "path": full_path,
                        "is_dir": is_dir,
                        "is_symlink": is_lnk,
                        "size": size,
                        "modified": int(s.st_mtime),
                        "permissions": stat.filemode(s.st_mode),
                        "mode": oct(s.st_mode & 0o777)[2:].zfill(4),
                        "owner": owner,
                        "group": group,
                        "extension": ext
                    }})
                    if len(entries) >= 100:
                        break
                except Exception:
                    pass
    print(json.dumps({{"entries": entries}}))
except Exception as err:
    print(json.dumps({{"entries": []}}))
' "$P" "$Q"
else
  # Fast find fallback
  find "$P" -maxdepth 4 -iname "*$Q*" 2>/dev/null | head -n 100
fi
"#,
        path.replace('"', "\\\""),
        query.replace('"', "\\\"")
    );

    let output = exec_ssh_command(&mut session, &script).await?;
    let trimmed = output.trim();

    #[derive(Deserialize)]
    struct SearchResponse {
        entries: Vec<RemoteFileEntry>,
    }

    if let Ok(res) = serde_json::from_str::<SearchResponse>(trimmed) {
        return Ok(res.entries);
    }

    Ok(Vec::new())
}

