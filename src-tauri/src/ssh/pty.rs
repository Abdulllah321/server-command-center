use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;
use tauri::{AppHandle, Emitter};
use serde::Serialize;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use russh::client::Handle;
use crate::ssh::client::SshClientHandler;
use crate::error::CommandError;

#[derive(Serialize, Clone)]
pub struct TerminalDataEvent {
    pub pty_id: String,
    pub data_base64: String, // Sent as Base64 to safely transmit ANSI escapes
}

#[derive(Serialize, Clone)]
pub struct TerminalStatusEvent {
    pub pty_id: String,
}

pub struct PtyState {
    pub session: Handle<SshClientHandler>,
    pub channel_id: russh::ChannelId,
}

#[derive(Clone)]
pub struct PtyManager {
    ptys: Arc<Mutex<HashMap<String, PtyState>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            ptys: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn open_pty(
        &self,
        session: Handle<SshClientHandler>,
        cols: u32,
        rows: u32,
        command: Option<&str>,
    ) -> Result<(String, tokio::sync::mpsc::UnboundedReceiver<russh::ChannelMsg>), CommandError> {
        let mut session_clone = session.clone();
        let mut channel = session_clone.channel_open_session().await.map_err(|e| CommandError::Internal(format!("Failed to open channel: {}", e)))?;
        
        channel.request_pty(false, "xterm-256color", cols, rows, 0, 0, &[]).await.map_err(|_| CommandError::Internal("Failed to request PTY".into()))?;
        
        if let Some(cmd) = command {
            channel.exec(true, cmd.as_bytes()).await.map_err(|_| CommandError::Internal("Failed to execute command".into()))?;
        } else {
            channel.request_shell(true).await.map_err(|_| CommandError::Internal("Failed to request shell".into()))?;
        }

        let pty_id = Uuid::new_v4().to_string();
        let channel_id = channel.id();
        
        // Save the reference for write/resize
        {
            let mut ptys = self.ptys.lock().await;
            ptys.insert(pty_id.clone(), PtyState {
                session: session.clone(),
                channel_id,
            });
        }

        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let pty_id_clone = pty_id.clone();
        let manager_clone = self.clone();
        
        tokio::spawn(async move {
            while let Some(msg) = channel.wait().await {
                // Determine if we should break early before forwarding
                let is_end = matches!(msg, russh::ChannelMsg::Eof | russh::ChannelMsg::Close);
                
                if tx.send(msg).is_err() {
                    break;
                }

                if is_end {
                    break;
                }
            }

            // Cleanup when loop breaks
            let mut ptys = manager_clone.ptys.lock().await;
            ptys.remove(&pty_id_clone);
        });

        Ok((pty_id, rx))
    }

    pub async fn write(&self, pty_id: &str, data: &[u8]) -> Result<(), CommandError> {
        let mut ptys = self.ptys.lock().await;
        if let Some(state) = ptys.get_mut(pty_id) {
            state.session.data(state.channel_id, data).await.map_err(|_| CommandError::Internal("Failed to write to channel".into()))?;
            Ok(())
        } else {
            Err(CommandError::NotFound("PTY session not found".into()))
        }
    }

    pub async fn resize(&self, pty_id: &str, cols: u32, rows: u32) -> Result<(), CommandError> {
        let mut ptys = self.ptys.lock().await;
        if let Some(state) = ptys.get_mut(pty_id) {
            state.session.window_change(state.channel_id, cols, rows, 0, 0).await.map_err(|_| CommandError::Internal("Failed to resize channel".into()))?;
            Ok(())
        } else {
            Err(CommandError::NotFound("PTY session not found".into()))
        }
    }

    pub async fn close(&self, pty_id: &str) -> Result<(), CommandError> {
        let mut ptys = self.ptys.lock().await;
        if let Some(mut state) = ptys.remove(pty_id) {
            let _ = state.session.eof(state.channel_id).await;
            let _ = state.session.close(state.channel_id).await;
        }
        Ok(())
    }
}
