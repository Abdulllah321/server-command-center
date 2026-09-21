/*!
# Vault Secrets Module

**SECURITY CONSTRAINT**: This module handles the AES-256-GCM encrypted vault.
Per the `ssh-secrets-security-checklist`, NO secret value (including the master password, the derived key, or any stored secret) should ever appear in a log line, an error message, or Debug output.
The derived AES key is held in a `Zeroizing<[u8; 32]>` so that it is scrubbed from memory when the `VaultHandle` is dropped.
Errors returned by this module use safe, static variants.
*/

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{rand_core::OsRng, SaltString},
    Argon2,
};
use base64::{engine::general_purpose::STANDARD as b64, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("Invalid master password or corrupted vault")]
    InvalidPassword,

    #[error("Secret not found in the vault")]
    NotFound,

    #[error("Failed to read or write the vault file")]
    IoError,

    #[error("Cryptographic error occurred")]
    CryptoError,

    #[error("Vault file format is invalid")]
    InvalidFormat,
}

/// The structure of the encrypted vault file on disk.
#[derive(Serialize, Deserialize)]
struct VaultFile {
    /// Base64 encoded Argon2 salt
    salt: String,
    /// Base64 encoded AES-GCM nonce
    nonce: String,
    /// Base64 encoded ciphertext
    ciphertext: String,
}

/// A handle to an unlocked vault. 
/// The `key` is wrapped in a type that automatically zeroes itself out when dropped.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct VaultHandle {
    key: [u8; 32],
    #[zeroize(skip)]
    path: PathBuf,
}

/// Derives a 32-byte AES key using Argon2id.
fn derive_key(password: &str, salt: &str) -> Result<[u8; 32], VaultError> {
    let argon2 = Argon2::default();
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt.as_bytes(), &mut key)
        .map_err(|_| VaultError::CryptoError)?;
    Ok(key)
}

/// Unlocks the vault at the given app_dir using the master password.
/// If the vault does not exist, a new one is initialized.
pub fn unlock(master_password: &str, app_dir: &Path) -> Result<VaultHandle, VaultError> {
    let vault_path = app_dir.join("vault.json");
    
    let key = if vault_path.exists() {
        // Vault exists, read it to extract the salt and derive the key
        let content = fs::read_to_string(&vault_path).map_err(|_| VaultError::IoError)?;
        let vault_file: VaultFile = serde_json::from_str(&content).map_err(|_| VaultError::InvalidFormat)?;
        
        let derived_key = derive_key(master_password, &vault_file.salt)?;
        
        // Verify we can decrypt the payload with this key to ensure password is correct
        let cipher = Aes256Gcm::new_from_slice(&derived_key).map_err(|_| VaultError::CryptoError)?;
        let nonce_bytes = b64.decode(&vault_file.nonce).map_err(|_| VaultError::InvalidFormat)?;
        let ciphertext_bytes = b64.decode(&vault_file.ciphertext).map_err(|_| VaultError::InvalidFormat)?;
        
        let nonce = Nonce::from_slice(&nonce_bytes);
        cipher.decrypt(nonce, Payload { msg: &ciphertext_bytes, aad: b"" })
            .map_err(|_| VaultError::InvalidPassword)?;
            
        derived_key
    } else {
        // Initialize a new empty vault
        let salt = SaltString::generate(&mut OsRng).to_string();
        let derived_key = derive_key(master_password, &salt)?;
        
        let mut raw_nonce = [0u8; 12];
        OsRng.fill_bytes(&mut raw_nonce);
        let nonce = Nonce::from_slice(&raw_nonce);
        
        let cipher = Aes256Gcm::new_from_slice(&derived_key).map_err(|_| VaultError::CryptoError)?;
        
        // Empty hashmap for secrets
        let empty_payload = serde_json::to_vec(&HashMap::<String, String>::new()).unwrap();
        
        let ciphertext = cipher.encrypt(nonce, Payload { msg: &empty_payload, aad: b"" })
            .map_err(|_| VaultError::CryptoError)?;
            
        let vault_file = VaultFile {
            salt,
            nonce: b64.encode(raw_nonce),
            ciphertext: b64.encode(ciphertext),
        };
        
        let content = serde_json::to_string(&vault_file).map_err(|_| VaultError::InvalidFormat)?;
        fs::write(&vault_path, content).map_err(|_| VaultError::IoError)?;
        
        derived_key
    };

    Ok(VaultHandle {
        key,
        path: vault_path,
    })
}

/// Helper to read, decrypt, and parse the internal secrets map
fn load_secrets_map(handle: &VaultHandle) -> Result<(VaultFile, HashMap<String, String>), VaultError> {
    let content = fs::read_to_string(&handle.path).map_err(|_| VaultError::IoError)?;
    let vault_file: VaultFile = serde_json::from_str(&content).map_err(|_| VaultError::InvalidFormat)?;
    
    let cipher = Aes256Gcm::new_from_slice(&handle.key).map_err(|_| VaultError::CryptoError)?;
    let nonce_bytes = b64.decode(&vault_file.nonce).map_err(|_| VaultError::InvalidFormat)?;
    let ciphertext_bytes = b64.decode(&vault_file.ciphertext).map_err(|_| VaultError::InvalidFormat)?;
    
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher.decrypt(nonce, Payload { msg: &ciphertext_bytes, aad: b"" })
        .map_err(|_| VaultError::InvalidPassword)?;
        
    let map: HashMap<String, String> = serde_json::from_slice(&plaintext).map_err(|_| VaultError::InvalidFormat)?;
    Ok((vault_file, map))
}

/// Helper to serialize, encrypt, and save the secrets map
fn save_secrets_map(handle: &VaultHandle, vault_file: &mut VaultFile, map: &HashMap<String, String>) -> Result<(), VaultError> {
    let cipher = Aes256Gcm::new_from_slice(&handle.key).map_err(|_| VaultError::CryptoError)?;
    
    // Always generate a new nonce when re-encrypting!
    let mut raw_nonce = [0u8; 12];
    OsRng.fill_bytes(&mut raw_nonce);
    let nonce = Nonce::from_slice(&raw_nonce);
    
    let plaintext = serde_json::to_vec(map).map_err(|_| VaultError::InvalidFormat)?;
    
    let ciphertext = cipher.encrypt(nonce, Payload { msg: &plaintext, aad: b"" })
        .map_err(|_| VaultError::CryptoError)?;
        
    vault_file.nonce = b64.encode(raw_nonce);
    vault_file.ciphertext = b64.encode(ciphertext);
    
    let content = serde_json::to_string(vault_file).map_err(|_| VaultError::InvalidFormat)?;
    fs::write(&handle.path, content).map_err(|_| VaultError::IoError)?;
    
    Ok(())
}

/// Stores an entry in the vault.
pub fn store_entry(handle: &VaultHandle, ref_id: &str, secret: &str) -> Result<(), VaultError> {
    let (mut vault_file, mut map) = load_secrets_map(handle)?;
    map.insert(ref_id.to_string(), secret.to_string());
    save_secrets_map(handle, &mut vault_file, &map)?;
    Ok(())
}

/// Reads an entry from the vault.
pub fn read_entry(handle: &VaultHandle, ref_id: &str) -> Result<String, VaultError> {
    let (_, map) = load_secrets_map(handle)?;
    map.get(ref_id).cloned().ok_or(VaultError::NotFound)
}

/// Deletes an entry from the vault.
pub fn delete_entry(handle: &VaultHandle, ref_id: &str) -> Result<(), VaultError> {
    let (mut vault_file, mut map) = load_secrets_map(handle)?;
    if map.remove(ref_id).is_none() {
        return Err(VaultError::NotFound);
    }
    save_secrets_map(handle, &mut vault_file, &map)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_vault_lifecycle() {
        let dir = tempdir().unwrap();
        let app_dir = dir.path();
        
        let master_pass = "super_secure_master_password";
        let secret = "my_private_ssh_key_string";
        let ref_id = "scc:credential:1234";

        // 1. Initializing new vault
        let handle = unlock(master_pass, app_dir).expect("Should initialize vault");
        
        // 2. Store secret
        store_entry(&handle, ref_id, secret).expect("Should store secret");
        
        // 3. Read secret back
        let retrieved = read_entry(&handle, ref_id).expect("Should read secret");
        assert_eq!(retrieved, secret);
        
        // Drop handle, which triggers Zeroize on the key
        drop(handle);

        // 4. Try unlocking with wrong password
        let err = unlock("wrong_password", app_dir).unwrap_err();
        assert!(matches!(err, VaultError::InvalidPassword));

        // 5. Unlock with right password
        let handle2 = unlock(master_pass, app_dir).expect("Should unlock vault");
        let retrieved2 = read_entry(&handle2, ref_id).expect("Should read secret again");
        assert_eq!(retrieved2, secret);

        // 6. Delete secret
        delete_entry(&handle2, ref_id).expect("Should delete secret");
        
        // 7. Verify deletion
        let err2 = read_entry(&handle2, ref_id).unwrap_err();
        assert!(matches!(err2, VaultError::NotFound));
    }
}
