use crate::error::{CommandError, CommandResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadUpdateProgressPayload {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallUpdatePayload {
    pub download_url: String,
    pub filename: String,
    pub total_bytes: u64,
}

impl<'de> Deserialize<'de> for InstallUpdatePayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let val = serde_json::Value::deserialize(deserializer)?;

        let download_url = val.get("downloadUrl")
            .or_else(|| val.get("download_url"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let filename = val.get("filename")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let total_bytes = val.get("totalBytes")
            .or_else(|| val.get("total_bytes"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        Ok(InstallUpdatePayload {
            download_url,
            filename,
            total_bytes,
        })
    }
}

/// Downloads the release asset to %TEMP% with real-time progress, launches the installer, and restarts the app
#[tauri::command]
pub async fn download_and_install_update(
    app_handle: tauri::AppHandle,
    payload: InstallUpdatePayload,
) -> CommandResult<()> {
    if payload.download_url.is_empty() || payload.filename.is_empty() {
        return Err(CommandError::Validation("Download URL and filename are required".into()));
    }

    let safe_filename: String = payload.filename.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();

    if safe_filename.is_empty() {
        return Err(CommandError::Validation("Invalid filename".into()));
    }

    let temp_dir = std::env::temp_dir();
    let target_file: PathBuf = temp_dir.join(&safe_filename);

    // Remove any previous partial download
    let _ = tokio::fs::remove_file(&target_file).await;

    // Spawn curl.exe (standard on modern Windows) to download with redirect following
    let mut child = tokio::process::Command::new("curl.exe")
        .args(["-L", "-f", "-s", "-o"])
        .arg(&target_file)
        .arg(&payload.download_url)
        .spawn()
        .map_err(|e| CommandError::Internal(format!("Failed to start download process: {}", e)))?;

    // Track download progress by polling file size
    let poll_interval = Duration::from_millis(200);
    loop {
        tokio::select! {
            status = child.wait() => {
                let status = status.map_err(|e| CommandError::Internal(format!("Download wait error: {}", e)))?;
                if !status.success() {
                    let _ = tokio::fs::remove_file(&target_file).await;
                    return Err(CommandError::Internal(format!("Download failed with exit code: {:?}", status.code())));
                }
                break;
            }
            _ = tokio::time::sleep(poll_interval) => {
                if let Ok(metadata) = tokio::fs::metadata(&target_file).await {
                    let downloaded = metadata.len();
                    let total = if payload.total_bytes > 0 { payload.total_bytes } else { downloaded };
                    let percent = if total > 0 {
                        ((downloaded as f64 / total as f64) * 100.0).min(100.0) as u32
                    } else {
                        0
                    };

                    let _ = app_handle.emit("update-download-progress", DownloadUpdateProgressPayload {
                        downloaded_bytes: downloaded,
                        total_bytes: total,
                        percent,
                    });
                }
            }
        }
    }

    // Final 100% progress emit
    let final_size = tokio::fs::metadata(&target_file).await.map(|m| m.len()).unwrap_or(payload.total_bytes);
    let _ = app_handle.emit("update-download-progress", DownloadUpdateProgressPayload {
        downloaded_bytes: final_size,
        total_bytes: final_size,
        percent: 100,
    });

    // Launch the downloaded installer
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(&target_file)
            .spawn()
            .map_err(|e| CommandError::Internal(format!("Failed to launch installer executable: {}", e)))?;

        // Give installer process time to detach before terminating the current process
        tokio::time::sleep(Duration::from_millis(600)).await;
        app_handle.exit(0);
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err(CommandError::Internal("Direct installer launch is supported on Windows".into()));
    }

    Ok(())
}

/// Opens an external HTTP/HTTPS URL in the user's default operating system browser
#[tauri::command]
pub async fn open_external_url(url: String) -> CommandResult<()> {
    let trimmed = url.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") && !trimmed.starts_with("mailto:") {
        return Err(CommandError::Validation("Invalid URL protocol. Only HTTP, HTTPS, and mailto URLs can be opened externally.".into()));
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("cmd")
            .args(["/c", "start", "", trimmed])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| CommandError::Internal(format!("Failed to open external browser: {}", e)))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| CommandError::Internal(format!("Failed to open external browser: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| CommandError::Internal(format!("Failed to open external browser: {}", e)))?;
    }

    Ok(())
}

