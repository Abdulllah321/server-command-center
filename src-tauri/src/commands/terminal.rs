use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::db::{log_activity, ActivityEntry};
use std::time::Instant;

#[tauri::command]
pub async fn open_terminal(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    cols: u32,
    rows: u32,
) -> CommandResult<String> {
    if server_id.is_empty() {
        return Err(CommandError::Validation("Server ID required".into()));
    }

    let start = Instant::now();

    // Re-use existing session from SessionManager, or connect if needed
    let session_handle = state
        .session_manager
        .get_or_connect(server_id.clone(), state.clone(), app_handle.clone())
        .await?;
        
    let (pty_id, mut rx) = state
        .pty_manager
        .open_pty(session_handle, cols, rows, None)
        .await?;

    let pty_id_clone = pty_id.clone();
    let app_handle_clone = app_handle.clone();

    tokio::spawn(async move {
        let mut close_reason = "closed";
        while let Some(msg) = rx.recv().await {
            use russh::ChannelMsg;
            use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
            use tauri::Emitter;

            match msg {
                ChannelMsg::Data { ref data } | ChannelMsg::ExtendedData { ref data, .. } => {
                    let base64_str = BASE64.encode(data);
                    let _ = app_handle_clone.emit(&format!("terminal://data:{}", pty_id_clone), crate::ssh::pty::TerminalDataEvent {
                        pty_id: pty_id_clone.clone(),
                        data_base64: base64_str,
                    });
                }
                ChannelMsg::Eof | ChannelMsg::Close => {
                    close_reason = "closed";
                    break;
                }
                _ => {}
            }
        }

        use tauri::Emitter;
        let _ = app_handle_clone.emit(&format!("terminal://{}:{}", close_reason, pty_id_clone), crate::ssh::pty::TerminalStatusEvent {
            pty_id: pty_id_clone.clone(),
        });
    });

    // Audit Log: only log the initiation of the terminal session
    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
    log_activity(&conn, ActivityEntry {
        server_id: Some(server_id.clone()),
        action: "open_terminal".into(),
        target: Some(pty_id.clone()), // Use pty_id as the target identifier
        status: "success".into(),
        detail: None,
        duration_ms: Some(start.elapsed().as_millis() as i64),
    });

    Ok(pty_id)
}

#[tauri::command]
pub async fn write_terminal(
    state: tauri::State<'_, AppState>,
    session_id: String, // Maps to pty_id
    data: Vec<u8>,
) -> CommandResult<()> {
    state.pty_manager.write(&session_id, &data).await?;
    Ok(())
}

#[tauri::command]
pub async fn resize_terminal(
    state: tauri::State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> CommandResult<()> {
    state.pty_manager.resize(&session_id, cols, rows).await?;
    Ok(())
}

#[tauri::command]
pub async fn close_terminal(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> CommandResult<()> {
    state.pty_manager.close(&session_id).await?;
    Ok(())
}
