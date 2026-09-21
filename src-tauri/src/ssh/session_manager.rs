use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};
use tokio::time::{Instant, Duration};
use russh::client::Handle;
use tauri::AppHandle;
use crate::ssh::client::SshClientHandler;
use crate::error::CommandError;
use crate::AppState;

pub struct SessionInfo {
    pub handle: Handle<SshClientHandler>,
    pub last_used: Instant,
}

#[derive(Clone)]
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionInfo>>>,
    pub pending_verifications: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        let manager = Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            pending_verifications: Arc::new(Mutex::new(HashMap::new())),
        };

        // Start idle eviction loop
        let sessions_ref = manager.sessions.clone();
        tokio::spawn(async move {
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
    pub async fn get_session(&self, server_id: &str) -> Option<Handle<SshClientHandler>> {
        let mut map = self.sessions.lock().await;
        if let Some(info) = map.get_mut(server_id) {
            // Check if connection is still healthy by pinging or relying on channel errors later
            info.last_used = Instant::now();
            return Some(info.handle.clone());
        }
        None
    }

    pub async fn insert_session(&self, server_id: String, handle: Handle<SshClientHandler>) {
        let mut map = self.sessions.lock().await;
        map.insert(server_id, SessionInfo {
            handle,
            last_used: Instant::now(),
        });
    }

    pub async fn close_session(&self, server_id: &str) -> Result<(), CommandError> {
        let mut map = self.sessions.lock().await;
        if let Some(mut info) = map.remove(server_id) {
            let _ = info.handle.disconnect(russh::Disconnect::ByApplication, "Closed by user", "en-US").await;
        }
        Ok(())
    }

    pub async fn get_or_connect(
        &self,
        server_id: String,
        state: tauri::State<'_, AppState>,
        app_handle: tauri::AppHandle,
    ) -> Result<Handle<SshClientHandler>, CommandError> {
        if let Some(handle) = self.get_session(&server_id).await {
            return Ok(handle);
        }

        // We need to connect.
        // 1. Fetch server & credential info
        let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
        let server_details: (String, u16, String) = conn.query_row(
            "SELECT hostname, ssh_port, username FROM servers WHERE id = ?1",
            [&server_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(|_| CommandError::NotFound("Server not found".into()))?;
        
        let (hostname, ssh_port, username) = server_details;

        // Note: For real use, we need the auth_method to know what credential to use.
        // If there are multiple, we pick the first or specify one.
        // For now we just get the first credential for this server.
        let cred_details: Result<(String, String), _> = conn.query_row(
            "SELECT auth_method, keychain_ref FROM credentials WHERE server_id = ?1 LIMIT 1",
            [&server_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        let db_arc = Arc::new(std::sync::Mutex::new(crate::db::init_db(
            &app_handle.path().app_data_dir().unwrap().join("command_center.sqlite")
        ).unwrap())); // We create a new clone of the DB connection for the handler to own, or we could pass AppState.
        
        drop(conn);

        let (auth_method, keychain_ref) = cred_details.map_err(|_| CommandError::NotFound("No credentials found for server".into()))?;

        // 2. Fetch decrypted secret
        // For now, if it requires a master password, we might fail unless it's stored in session/vault.
        // This is a known architectural challenge for background connects. We'll use the vault::read_entry 
        // without prompting if we can, but vault::unlock requires the password. 
        // We will assume the vault state was unlocked elsewhere or it's a simple OS keychain secret for MVP.
        let mut secret = match auth_method.as_str() {
            "password" | "ssh_agent" => {
                crate::secrets::keychain::read_secret(&keychain_ref)?
            }
            "private_key" | "password_key" => {
                // Return an error for now if we can't get the master password here.
                return Err(CommandError::Internal("Background connect for Vault-secured credentials requires active session integration".into()));
            }
            _ => return Err(CommandError::Internal("Unknown auth method".into())),
        };

        // 3. Connect
        let config = Arc::new(russh::client::Config::default());
        let handler = SshClientHandler {
            server_id: server_id.clone(),
            app_handle,
            db: db_arc,
            pending_verifications: self.pending_verifications.clone(),
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
                    let res = session.authenticate_password(username, &secret).await;
                    use zeroize::Zeroize;
                    secret.zeroize();
                    res
                }
                _ => {
                    use zeroize::Zeroize;
                    secret.zeroize();
                    return Err(CommandError::Validation("Auth method not supported in this MVP".into()));
                }
            }
        };

        let auth_result = tokio::time::timeout(Duration::from_secs(15), auth_future)
            .await
            .map_err(|_| CommandError::Internal("Authentication timed out (or blocked on TOFU)".into()))?;

        match auth_result {
            Ok(true) => {
                let handle = session.clone();
                self.insert_session(server_id, session).await;
                Ok(handle)
            }
            Ok(false) => Err(CommandError::Internal("Authentication failed".into())),
            Err(e) => Err(e),
        }
    }
}
