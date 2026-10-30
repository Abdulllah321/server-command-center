use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};
use russh_keys::key::PublicKey;
use tauri::{AppHandle, Emitter};
use serde::Serialize;
use rusqlite::Connection;

#[derive(Clone, Serialize)]
pub struct HostKeyVerificationEvent {
    pub server_id: String,
    pub server_name: String,
    pub hostname: String,
    pub fingerprint: String,
    pub old_fingerprint: Option<String>,
    pub is_mismatch: bool,
}

pub struct SshClientHandler {
    pub server_id: String,
    pub server_name: Option<String>,
    pub hostname: Option<String>,
    pub port: u16,
    pub app_handle: AppHandle,
    pub db: Arc<std::sync::Mutex<Connection>>,
    pub pending_verifications: Arc<Mutex<std::collections::HashMap<String, oneshot::Sender<bool>>>>,
    pub trusted_host_keys: Arc<std::sync::Mutex<std::collections::HashMap<String, String>>>,
}

#[async_trait::async_trait]
impl russh::client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint();

        // 1. Fetch server info and check SQLite for existing pinned key
        let (server_name, hostname, old_fingerprint, is_mismatch) = {
            let db = self.db.lock().map_err(|_| russh::Error::SendError)?;
            let (db_name, db_host): (Option<String>, Option<String>) = db.query_row(
                "SELECT name, hostname FROM servers WHERE id = ?1",
                [&self.server_id],
                |row| Ok((Some(row.get(0)?), Some(row.get(1)?))),
            ).unwrap_or((None, None));

            let server_name = db_name.or_else(|| self.server_name.clone()).unwrap_or_else(|| "Unknown".into());
            let hostname = db_host.or_else(|| self.hostname.clone()).unwrap_or_else(|| "Unknown".into());

            let existing: Result<String, _> = db.query_row(
                "SELECT fingerprint FROM known_hosts WHERE server_id = ?1",
                [&self.server_id],
                |row| row.get(0),
            );

            let mut mismatch = false;
            let mut old_fp = None;
            match existing {
                Ok(pinned) => {
                    if pinned == fingerprint {
                        return Ok(true);
                    } else {
                        eprintln!("WARNING: HOST KEY MISMATCH for server {}", self.server_id);
                        mismatch = true;
                        old_fp = Some(pinned);
                    }
                }
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    // Check in-memory trusted_host_keys cache (e.g. for unsaved servers tested in modal)
                    let host_key_addr = format!("{}:{}", hostname, self.port);
                    let trusted = self.trusted_host_keys.lock().map_err(|_| russh::Error::SendError)?;
                    if let Some(cached_fp) = trusted.get(&host_key_addr) {
                        if cached_fp == &fingerprint {
                            return Ok(true);
                        } else {
                            eprintln!("WARNING: HOST KEY MISMATCH for host {}", host_key_addr);
                            mismatch = true;
                            old_fp = Some(cached_fp.clone());
                        }
                    }
                }
                Err(_) => return Ok(false),
            }

            (server_name, hostname, old_fp, mismatch)
        };

        // Emit prompt to frontend (either first connect or mismatch)
        let (tx, rx) = oneshot::channel();
        
        {
            let mut pending = self.pending_verifications.lock().await;
            pending.insert(self.server_id.clone(), tx);
        }

        // Emit event to frontend
        let _ = self.app_handle.emit("host_key_verification_required", HostKeyVerificationEvent {
            server_id: self.server_id.clone(),
            server_name,
            hostname: hostname.clone(),
            fingerprint: fingerprint.clone(),
            old_fingerprint,
            is_mismatch,
        });

        // Wait for the user's response
        match rx.await {
            Ok(true) => {
                // Pin in in-memory trusted_host_keys cache
                let host_key_addr = format!("{}:{}", hostname, self.port);
                if let Ok(mut trusted) = self.trusted_host_keys.lock() {
                    trusted.insert(host_key_addr, fingerprint.clone());
                }

                // User accepted, store to DB if this is a persisted server in the servers table
                let db = self.db.lock().map_err(|_| russh::Error::SendError)?;
                if is_mismatch {
                    let _ = db.execute(
                        "UPDATE known_hosts SET fingerprint = ?1, created_at = datetime('now') WHERE server_id = ?2",
                        rusqlite::params![fingerprint, self.server_id],
                    );
                } else {
                    let is_real_server: bool = db.query_row(
                        "SELECT COUNT(*) FROM servers WHERE id = ?1",
                        [&self.server_id],
                        |row| row.get::<_, i64>(0),
                    ).map(|c| c > 0).unwrap_or(false);

                    if is_real_server {
                        let _ = db.execute(
                            "INSERT OR REPLACE INTO known_hosts (server_id, fingerprint, created_at) VALUES (?1, ?2, datetime('now'))",
                            rusqlite::params![self.server_id, fingerprint],
                        );
                    }
                }
                Ok(true)
            }
            Ok(false) => Ok(false),
            Err(_) => Ok(false), // Channel closed before response
        }
    }
}
