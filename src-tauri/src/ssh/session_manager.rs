use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};
use tokio::time::{Instant, Duration};
use russh::client::Handle;
use crate::ssh::client::SshClientHandler;
use crate::error::CommandError;

pub struct SessionInfo {
    pub handle: Arc<Mutex<Handle<SshClientHandler>>>,
    pub last_used: Instant,
}

#[derive(Clone)]
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionInfo>>>,
    pub pending_verifications: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    pub trusted_host_keys: Arc<std::sync::Mutex<HashMap<String, String>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        let manager = Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            pending_verifications: Arc::new(Mutex::new(HashMap::new())),
            trusted_host_keys: Arc::new(std::sync::Mutex::new(HashMap::new())),
        };

        // Start idle eviction loop
        let sessions_ref = manager.sessions.clone();
        tauri::async_runtime::spawn(async move {
            let timeout = Duration::from_secs(15 * 60); // 15 minutes
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await; // Check every minute
                
                let mut map = sessions_ref.lock().await;
                map.retain(|server_id, info| {
                    let idle = info.last_used.elapsed();
                    if idle > timeout {
                        println!("Evicting idle session for server {}", server_id);
                        false // drop
                    } else {
                        true
                    }
                });
            }
        });

        manager
    }

    /// Fetches an existing healthy session, returning None if not found or closed.
    pub async fn get_session(&self, server_id: &str) -> Option<Arc<Mutex<Handle<SshClientHandler>>>> {
        let mut map = self.sessions.lock().await;
        if let Some(info) = map.get(server_id) {
            let is_dead = {
                let guard = info.handle.lock().await;
                guard.is_closed()
            };
            if is_dead {
                map.remove(server_id);
                return None;
            }
        }
        if let Some(info) = map.get_mut(server_id) {
            info.last_used = Instant::now();
            return Some(info.handle.clone());
        }
        None
    }

    pub async fn insert_session(&self, server_id: String, handle: Handle<SshClientHandler>) -> Arc<Mutex<Handle<SshClientHandler>>> {
        let mut map = self.sessions.lock().await;
        let arc_handle = Arc::new(Mutex::new(handle));
        map.insert(server_id, SessionInfo {
            handle: arc_handle.clone(),
            last_used: Instant::now(),
        });
        arc_handle
    }

    pub async fn close_session(&self, server_id: &str) -> Result<(), CommandError> {
        let mut map = self.sessions.lock().await;
        if let Some(info) = map.remove(server_id) {
            let handle = info.handle.lock().await;
            let _ = handle.disconnect(russh::Disconnect::ByApplication, "Closed by user", "en-US").await;
        }
        Ok(())
    }

    pub async fn evict_session(&self, server_id: &str) {
        let mut map = self.sessions.lock().await;
        if let Some(info) = map.remove(server_id) {
            let handle = info.handle.lock().await;
            let _ = handle.disconnect(russh::Disconnect::ByApplication, "Evicted dead session", "en-US").await;
        }
    }

    pub async fn get_or_connect(
        &self,
        server_id: String,
        db: Arc<std::sync::Mutex<rusqlite::Connection>>,
        app_handle: tauri::AppHandle,
    ) -> Result<Arc<Mutex<Handle<SshClientHandler>>>, CommandError> {
        if let Some(handle) = self.get_session(&server_id).await {
            return Ok(handle);
        }

        // We need to connect.
        // 1. Fetch server & credential info
        let (server_details, cred_details) = {
            let conn = db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
            let server_details: (String, String, u16, String) = conn.query_row(
                "SELECT name, hostname, ssh_port, username FROM servers WHERE id = ?1",
                [&server_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            ).map_err(|_| CommandError::NotFound("Server not found".into()))?;

            let cred_details: Result<(String, String), _> = conn.query_row(
                "SELECT auth_method, keychain_ref FROM credentials WHERE server_id = ?1 LIMIT 1",
                [&server_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            );
            (server_details, cred_details)
        };
        
        let (server_name, hostname, ssh_port, username) = server_details;
        let (auth_method, keychain_ref) = cred_details.map_err(|_| CommandError::NotFound("No credentials found for server".into()))?;

        // 2. Fetch decrypted secret
        let secret = match auth_method.as_str() {
            "password" | "ssh_agent" => {
                let sec = crate::secrets::keychain::read_secret(&keychain_ref)
                    .map_err(|_| CommandError::NotFound("No saved password found in Keychain. Please edit the server and re-enter your SSH password.".into()))?;
                zeroize::Zeroizing::new(sec)
            }
            "private_key" | "password_key" => {
                if let Ok(sec) = crate::secrets::keychain::read_secret(&keychain_ref) {
                    zeroize::Zeroizing::new(sec)
                } else {
                    return Err(CommandError::Validation("Vault is locked. Please unlock the Vault in Settings to connect using private keys.".into()));
                }
            }
            _ => return Err(CommandError::Internal("Unknown auth method".into())),
        };

        // 3. Connect
        let config = Arc::new(russh::client::Config::default());
        let handler = SshClientHandler {
            server_id: server_id.clone(),
            server_name: Some(server_name),
            hostname: Some(hostname.clone()),
            port: ssh_port,
            app_handle,
            db: db.clone(),
            pending_verifications: self.pending_verifications.clone(),
            trusted_host_keys: self.trusted_host_keys.clone(),
        };

        let mut session = russh::client::connect(
            config,
            (hostname.as_str(), ssh_port),
            handler,
        ).await.map_err(|_| CommandError::Internal("Failed to connect to host".into()))?;

        // 4. Authenticate
        let auth_future = async {
            match auth_method.as_str() {
                "password" => {
                    let res = session.authenticate_password(username, &*secret).await
                        .map_err(|e| CommandError::Internal(crate::secrets::redact::redact_secrets(&e.to_string())))?;
                    Ok(res)
                }
                "private_key" | "password_key" => {
                    let key_pair = russh_keys::decode_secret_key(&secret, None)
                        .map_err(|e| CommandError::Internal(crate::secrets::redact::redact_secrets(&e.to_string())))?;
                    let res = session.authenticate_publickey(username, Arc::new(key_pair)).await
                        .map_err(|e| CommandError::Internal(crate::secrets::redact::redact_secrets(&e.to_string())))?;
                    Ok(res)
                }
                _ => {
                    Err(CommandError::Validation("Auth method not supported".into()))
                }
            }
        };

        let auth_result = tokio::time::timeout(Duration::from_secs(15), auth_future)
            .await
            .map_err(|_| CommandError::Internal("Authentication timed out (or blocked on TOFU)".into()))?;

        match auth_result {
            Ok(true) => {
                let arc_handle = self.insert_session(server_id, session).await;
                Ok(arc_handle)
            }
            Ok(false) => Err(CommandError::Internal("Authentication failed".into())),
            Err(e) => Err(e),
        }
    }
}
