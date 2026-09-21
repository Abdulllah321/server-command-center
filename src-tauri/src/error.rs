use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Validation error: {0}")]
    Validation(String),
    
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

use crate::secrets::keychain::KeychainError;
use crate::secrets::vault::VaultError;

// Convert rusqlite errors to CommandError
impl From<rusqlite::Error> for CommandError {
    fn from(err: rusqlite::Error) -> Self {
        CommandError::Database(err.to_string())
    }
}

impl From<KeychainError> for CommandError {
    fn from(err: KeychainError) -> Self {
        // Redact the raw secret context
        CommandError::Internal(err.to_string())
    }
}

impl From<VaultError> for CommandError {
    fn from(err: VaultError) -> Self {
        // Redact the raw secret context
        CommandError::Internal(err.to_string())
    }
}

// Ensure CommandError can be serialized over the Tauri IPC bridge
impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub type CommandResult<T> = Result<T, CommandError>;
