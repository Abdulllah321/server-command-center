use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub ssh_port: u16,
    pub username: String,
    pub os: Option<String>,
    pub provider: Option<String>,
    pub environment: String, // 'production', 'staging', 'dev'
    pub description: Option<String>,
    pub status: String,
    pub last_checked_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerTag {
    pub server_id: String,
    pub tag: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerPayload {
    pub name: String,
    pub hostname: String,
    pub ssh_port: u16,
    pub username: String,
    pub os: Option<String>,
    pub provider: Option<String>,
    pub environment: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerUpdatePayload {
    pub name: Option<String>,
    pub hostname: Option<String>,
    pub ssh_port: Option<u16>,
    pub username: Option<String>,
    pub os: Option<String>,
    pub provider: Option<String>,
    pub environment: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialMetadata {
    pub id: String,
    pub server_id: String,
    pub auth_method: String,
    pub key_fingerprint: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialMetadataExtended {
    pub id: String,
    pub server_id: String,
    pub server_name: String,
    pub auth_method: String,
    pub key_fingerprint: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct CreateCredentialPayload {
    pub server_id: String,
    pub auth_method: String,
    pub secret_payload: String,
    pub key_fingerprint: Option<String>,
    pub master_password: Option<String>,
}

impl std::fmt::Debug for CreateCredentialPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CreateCredentialPayload")
            .field("server_id", &self.server_id)
            .field("auth_method", &self.auth_method)
            .field("secret_payload", &"***REDACTED***")
            .field("key_fingerprint", &self.key_fingerprint)
            .field("master_password", &"***REDACTED***")
            .finish()
    }
}
