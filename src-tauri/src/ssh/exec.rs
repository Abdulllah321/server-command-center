use std::sync::Arc;
use std::time::Duration;
use russh::client::{Config, Handler, Session};
use russh_keys::key::KeyPair;
use tokio::time::timeout;
use crate::error::CommandError;
use zeroize::Zeroize;

struct DummyClient {}

#[async_trait::async_trait]
impl Handler for DummyClient {
    type Error = russh::Error;
    
    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // TODO: Phase 2 Task 16 - Implement TOFU and known_hosts pinning.
        // For this one-shot test, we blindly accept the key.
        Ok(true)
    }
}

pub async fn test_connection(
    hostname: &str,
    port: u16,
    username: &str,
    auth_method: &str,
    mut secret: String,
) -> Result<(), CommandError> {
    let config = Config::default();
    let config = Arc::new(config);
    let mut session = russh::client::connect(
        config,
        (hostname, port),
        DummyClient {},
    )
    .await
    .map_err(|_| CommandError::Internal("Failed to connect to host (connection refused or unreachable)".into()))?;

    // Hardcode 10 second timeout for the auth phase
    let auth_future = async {
        match auth_method {
            "password" => {
                let res = session.authenticate_password(username, &secret).await;
                secret.zeroize();
                res
            }
            "private_key" | "password_key" => {
                // Parse the key
                let key_pair = russh_keys::decode_secret_key(&secret, None)
                    .map_err(|_| russh::Error::SendError)?; // Map key parse error generic
                secret.zeroize();
                session.authenticate_publickey(username, Arc::new(key_pair)).await
            }
            "ssh_agent" => {
                secret.zeroize();
                // To keep this MVP simple, ssh_agent routing is often deferred or requires additional setup,
                // but we will return an unimplemented error for now as it needs a running agent socket
                return Err(CommandError::Internal("SSH Agent authentication not yet implemented in test loop".into()));
            }
            _ => {
                secret.zeroize();
                return Err(CommandError::Validation("Unknown auth method".into()));
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
