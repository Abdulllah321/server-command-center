use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;
use tokio::time::Instant;
use serde::{Deserialize, Serialize};

use crate::error::{CommandError, CommandResult};

lazy_static::lazy_static! {
    static ref CONFIRMATION_TOKENS: Arc<Mutex<HashMap<String, Instant>>> = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Serialize)]
pub struct ConfirmationTokenResponse {
    pub token: String,
}

#[derive(Deserialize)]
pub struct RequestConfirmationPayload {
    pub action_description: String,
    pub targets: Option<Vec<String>>,
}

#[tauri::command]
pub async fn request_confirmation(
    _payload: RequestConfirmationPayload,
) -> CommandResult<ConfirmationTokenResponse> {
    // In a real application, this endpoint would verify the user's master password 
    // or biometrics before returning a token. For V1 MVP, we assume the frontend 
    // dialog has handled the UX and we just issue the token.
    
    let token = Uuid::new_v4().to_string();
    let expiration = Instant::now() + std::time::Duration::from_secs(5 * 60); // 5 minute TTL
    
    let mut tokens = CONFIRMATION_TOKENS.lock().await;
    
    // Clean up expired tokens periodically
    let now = Instant::now();
    tokens.retain(|_, exp| *exp > now);
    
    tokens.insert(token.clone(), expiration);
    
    Ok(ConfirmationTokenResponse { token })
}

pub async fn consume_token(token: Option<&str>) -> CommandResult<()> {
    let token_str = match token {
        Some(t) => t,
        None => return Err(CommandError::Unauthorized("Confirmation token required".into())),
    };

    let mut tokens = CONFIRMATION_TOKENS.lock().await;
    let now = Instant::now();
    
    // Check if token exists and is valid
    if let Some(exp) = tokens.get(token_str) {
        if *exp > now {
            // Valid! Consume it (single-use)
            tokens.remove(token_str);
            Ok(())
        } else {
            tokens.remove(token_str);
            Err(CommandError::Unauthorized("Confirmation token expired".into()))
        }
    } else {
        Err(CommandError::Unauthorized("Invalid confirmation token".into()))
    }
}
