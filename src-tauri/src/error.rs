use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),
    
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Conflict: {0}")]
    Conflict(String),

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

impl From<russh::Error> for CommandError {
    fn from(err: russh::Error) -> Self {
        CommandError::Internal(crate::secrets::redact::redact_secrets(&err.to_string()))
    }
}

impl From<russh_keys::Error> for CommandError {
    fn from(err: russh_keys::Error) -> Self {
        CommandError::Internal(crate::secrets::redact::redact_secrets(&err.to_string()))
    }
}

// Ensure CommandError can be serialized over the Tauri IPC bridge with automatic secret redaction
impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let raw_err = self.to_string();
        let redacted = crate::secrets::redact::redact_secrets(&raw_err);
        serializer.serialize_str(&redacted)
    }
}

pub type CommandResult<T> = Result<T, CommandError>;
