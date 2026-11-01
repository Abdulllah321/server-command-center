use crate::error::{CommandResult, CommandError};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowsHelloStatus {
    pub supported: bool,
    pub enrolled: bool,
    pub enabled: bool,
}

#[cfg(windows)]
pub async fn is_available() -> bool {
    use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerifierAvailability};
    
    tokio::task::spawn_blocking(|| {
        if let Ok(op) = UserConsentVerifier::CheckAvailabilityAsync() {
            if let Ok(avail) = op.get() {
                return avail == UserConsentVerifierAvailability::Available;
            }
        }
        false
    }).await.unwrap_or(false)
}

#[cfg(not(windows))]
pub async fn is_available() -> bool {
    false
}

#[cfg(windows)]
pub async fn request_user_consent(prompt: &str) -> CommandResult<bool> {
    use windows::core::HSTRING;
    use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerificationResult};

    let prompt_hstring = HSTRING::from(prompt);
    
    let res = tokio::task::spawn_blocking(move || {
        let op = UserConsentVerifier::RequestVerificationAsync(&prompt_hstring)
            .map_err(|e| CommandError::Internal(format!("Failed to request Windows Hello: {}", e)))?;
            
        let result = op.get()
            .map_err(|e| CommandError::Internal(format!("Windows Hello verification error: {}", e)))?;

        match result {
            UserConsentVerificationResult::Verified => Ok(true),
            UserConsentVerificationResult::Canceled => Err(CommandError::Forbidden("Windows Hello verification canceled by user".into())),
            UserConsentVerificationResult::DeviceBusy => Err(CommandError::Internal("Windows Hello biometric sensor is busy".into())),
            UserConsentVerificationResult::DeviceNotPresent => Err(CommandError::NotFound("Windows Hello device not present".into())),
            UserConsentVerificationResult::NotConfiguredForUser => Err(CommandError::Forbidden("Windows Hello is not set up on this Windows account".into())),
            UserConsentVerificationResult::DisabledByPolicy => Err(CommandError::Forbidden("Windows Hello disabled by group policy".into())),
            _ => Err(CommandError::Forbidden("Windows Hello verification failed".into())),
        }
    }).await.map_err(|e| CommandError::Internal(e.to_string()))??;

    Ok(res)
}

#[cfg(not(windows))]
pub async fn request_user_consent(_prompt: &str) -> CommandResult<bool> {
    Err(CommandError::InvalidInput("Windows Hello is only supported on Windows".into()))
}

