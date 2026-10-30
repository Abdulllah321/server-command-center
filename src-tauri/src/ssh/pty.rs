use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};
use uuid::Uuid;
use serde::Serialize;
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

enum PtyCommand {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

pub struct PtyState {
    cmd_tx: mpsc::UnboundedSender<PtyCommand>,
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
        session: &mut Handle<SshClientHandler>,
        cols: u32,
        rows: u32,
        command: Option<&str>,
    ) -> Result<(String, mpsc::UnboundedReceiver<russh::ChannelMsg>), CommandError> {
        let mut channel = session.channel_open_session().await.map_err(|e| CommandError::Internal(format!("Failed to open channel: {}", e)))?;
        
        channel.request_pty(false, "xterm-256color", cols, rows, 0, 0, &[]).await.map_err(|_| CommandError::Internal("Failed to request PTY".into()))?;
        
        if let Some(cmd) = command {
            channel.exec(true, cmd.as_bytes()).await.map_err(|_| CommandError::Internal("Failed to execute command".into()))?;
        } else {
            channel.request_shell(true).await.map_err(|_| CommandError::Internal("Failed to request shell".into()))?;
        }

        let pty_id = Uuid::new_v4().to_string();
        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<PtyCommand>();
        
        // Save the reference for write/resize
        {
            let mut ptys = self.ptys.lock().await;
            ptys.insert(pty_id.clone(), PtyState {
                cmd_tx,
            });
        }

        let (tx, rx) = mpsc::unbounded_channel();
        let pty_id_clone = pty_id.clone();
        let manager_clone = self.clone();
        
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    msg_opt = channel.wait() => {
                        match msg_opt {
                            Some(msg) => {
                                let is_end = matches!(msg, russh::ChannelMsg::Eof | russh::ChannelMsg::Close);
                                if tx.send(msg).is_err() || is_end {
                                    break;
                                }
                            }
                            None => break,
                        }
                    }
                    cmd_opt = cmd_rx.recv() => {
                        match cmd_opt {
                            Some(PtyCommand::Data(data)) => {
                                let _ = channel.data(&data[..]).await;
                            }
                            Some(PtyCommand::Resize { cols, rows }) => {
                                let _ = channel.window_change(cols, rows, 0, 0).await;
                            }
                            Some(PtyCommand::Close) | None => {
                                let _ = channel.eof().await;
                                let _ = channel.close().await;
                                break;
                            }
                        }
                    }
                }
            }

            let _ = channel.close().await;

            // Cleanup when loop breaks
            let mut ptys = manager_clone.ptys.lock().await;
            ptys.remove(&pty_id_clone);
        });

        Ok((pty_id, rx))
    }

    pub async fn write(&self, pty_id: &str, data: &[u8]) -> Result<(), CommandError> {
        let ptys = self.ptys.lock().await;
        if let Some(state) = ptys.get(pty_id) {
            state.cmd_tx.send(PtyCommand::Data(data.to_vec())).map_err(|_| CommandError::Internal("PTY channel closed".into()))?;
            Ok(())
        } else {
            Err(CommandError::NotFound("PTY session not found".into()))
        }
    }

    pub async fn resize(&self, pty_id: &str, cols: u32, rows: u32) -> Result<(), CommandError> {
        let ptys = self.ptys.lock().await;
        if let Some(state) = ptys.get(pty_id) {
            state.cmd_tx.send(PtyCommand::Resize { cols, rows }).map_err(|_| CommandError::Internal("PTY channel closed".into()))?;
            Ok(())
        } else {
            Err(CommandError::NotFound("PTY session not found".into()))
        }
    }

    pub async fn close(&self, pty_id: &str) -> Result<(), CommandError> {
        let mut ptys = self.ptys.lock().await;
        if let Some(state) = ptys.remove(pty_id) {
            let _ = state.cmd_tx.send(PtyCommand::Close);
        }
        Ok(())
    }
}
