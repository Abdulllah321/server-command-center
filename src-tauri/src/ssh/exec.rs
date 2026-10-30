use std::sync::Arc;
use std::time::Duration;
use russh::client::Config;
use tokio::time::timeout;
use crate::error::CommandError;
use zeroize::Zeroizing;

use crate::ssh::client::SshClientHandler;

pub async fn test_connection(
    server_id: String,
    server_name: Option<String>,
    hostname: &str,
    port: u16,
    username: &str,
    auth_method: &str,
    secret: String,
    app_handle: tauri::AppHandle,
    db: Arc<std::sync::Mutex<rusqlite::Connection>>,
    pending_verifications: Arc<tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<bool>>>>,
    trusted_host_keys: Arc<std::sync::Mutex<std::collections::HashMap<String, String>>>,
) -> Result<(), CommandError> {
    let secret = Zeroizing::new(secret);
    let config = Config::default();
    let config = Arc::new(config);
    let handler = SshClientHandler {
        server_id,
        server_name,
        hostname: Some(hostname.to_string()),
        port,
        app_handle,
        db,
        pending_verifications,
        trusted_host_keys,
    };

    let mut session = russh::client::connect(
        config,
        (hostname, port),
        handler,
    )
    .await
    .map_err(|_| CommandError::Internal("Failed to connect to host (connection refused or unreachable)".into()))?;

    // Hardcode 10 second timeout for the auth phase
    let auth_future = async {
        match auth_method {
            "password" => {
                let res = session.authenticate_password(username, &*secret).await
                    .map_err(|e| CommandError::Internal(crate::secrets::redact::redact_secrets(&e.to_string())))?;
                Ok(res)
            }
            "private_key" | "password_key" => {
                // Parse the key
                let key_pair = russh_keys::decode_secret_key(&secret, None)
                    .map_err(|e| CommandError::Internal(crate::secrets::redact::redact_secrets(&e.to_string())))?;
                let res = session.authenticate_publickey(username, Arc::new(key_pair)).await
                    .map_err(|e| CommandError::Internal(crate::secrets::redact::redact_secrets(&e.to_string())))?;
                Ok(res)
            }
            "ssh_agent" => {
                // To keep this MVP simple, ssh_agent routing is often deferred or requires additional setup,
                // but we will return an unimplemented error for now as it needs a running agent socket
                Err(CommandError::Internal("SSH Agent authentication not yet implemented in test loop".into()))
            }
            _ => {
                Err(CommandError::Validation("Unknown auth method".into()))
            }
        }
    };

    let auth_result = timeout(Duration::from_secs(10), auth_future)
        .await
        .map_err(|_| CommandError::Internal("Connection timed out waiting for authentication".into()))?;

    match auth_result {
        Ok(true) => {
            let _ = session.disconnect(russh::Disconnect::ByApplication, "", "en-US").await;
            Ok(())
        },
        Ok(false) => Err(CommandError::Internal("Authentication failed".into())),
        Err(_) => Err(CommandError::Internal("Authentication process error".into())),
    }
}
