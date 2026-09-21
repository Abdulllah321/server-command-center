use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};
use russh_keys::key::PublicKey;
use tauri::{AppHandle, Emitter};
use serde::Serialize;
use rusqlite::Connection;

#[derive(Clone, Serialize)]
pub struct HostKeyVerificationEvent {
    pub server_id: String,
    pub fingerprint: String,
}

pub struct SshClientHandler {
    pub server_id: String,
    pub app_handle: AppHandle,
    pub db: Arc<std::sync::Mutex<Connection>>,
    pub pending_verifications: Arc<Mutex<std::collections::HashMap<String, oneshot::Sender<bool>>>>,
}

#[async_trait::async_trait]
impl russh::client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint();

        // 1. Check SQLite for existing pinned key
        let db = self.db.lock().map_err(|_| russh::Error::SendError)?; // map lock poison to generic error
        let existing: Result<String, _> = db.query_row(
            "SELECT fingerprint FROM known_hosts WHERE server_id = ?1",
            [&self.server_id],
            |row| row.get(0),
        );
        drop(db);

        match existing {
            Ok(pinned) => {
                if pinned == fingerprint {
                    return Ok(true);
                } else {
                    eprintln!("WARNING: HOST KEY MISMATCH for server {}", self.server_id);
                    return Ok(false); // Fail loudly
                }
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                // Not pinned. Need to prompt user.
                let (tx, rx) = oneshot::channel();
                
                {
                    let mut pending = self.pending_verifications.lock().await;
                    pending.insert(self.server_id.clone(), tx);
                }

                // Emit event to frontend
                let _ = self.app_handle.emit("host_key_verification_required", HostKeyVerificationEvent {
                    server_id: self.server_id.clone(),
                    fingerprint: fingerprint.clone(),
                });

                // Wait for the user's response
                match rx.await {
                    Ok(true) => {
                        // User accepted, store to DB
                        let db = self.db.lock().map_err(|_| russh::Error::SendError)?;
                        let _ = db.execute(
                            "INSERT INTO known_hosts (server_id, fingerprint, created_at) VALUES (?1, ?2, datetime('now'))",
                            rusqlite::params![self.server_id, fingerprint],
                        );
                        Ok(true)
                    }
                    Ok(false) => Ok(false),
                    Err(_) => Ok(false), // Channel closed before response
                }
            }
            Err(_) => Ok(false),
        }
    }
}
