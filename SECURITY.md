# Security Audit Report & Policy

**Scope**: Full-codebase audit across Phases 1–11 per the `ssh-secrets-security-checklist` skill.  
**Audited Subsystems**: Frontend React/Zustand stores, Tauri IPC bridge, SQLite DB layer, SSH Session & PTY Manager, Vault & Keychain secrets engine, Rebuild Pipeline engine, PM2 Process Management, Log Streaming & Persistence, Activity Logging, and Global Panic / Crash Handlers.

---

## 1. Audit Methodology & Grep Vectors

| Audit Target | Search Patterns & Method | Areas Inspected |
| :--- | :--- | :--- |
| **Struct `Debug` Implementations** | `derive.*Debug`, `#[derive(`, `struct ` | `src-tauri/src/models.rs`, `secrets/vault.rs`, `secrets/keychain.rs`, `ssh/*.rs`, `commands/*.rs` |
| **Decrypted Secret Handling & Zeroization** | `zeroize`, `Zeroizing`, `.password`, `.private_key`, `.secret_payload`, `master_password` | `secrets/vault.rs`, `secrets/keychain.rs`, `commands/credentials.rs`, `ssh/session_manager.rs`, `ssh/exec.rs`, `commands/external_ssh.rs` |
| **Logging & Stdout Leakage** | `log::`, `tracing::`, `println!`, `eprintln!`, `dbg!` | All `.rs` files across `src-tauri/src/` |
| **Raw Command & Stream Outputs** | `combined_output`, `exec_ssh_command`, `step_output`, `pm2 logs`, `tail` | `commands/commands.rs`, `commands/pm2.rs`, `commands/logs.rs`, `pipelines/rebuild_engine.rs` |
| **Activity Log Sanitization** | `log_activity`, `ActivityEntry`, `get_activity_log` | `db/mod.rs`, `commands/activity.rs`, all `commands/*.rs` callers |
| **Error Serialization & IPC Leakage** | `CommandError`, `serialize`, `From<russh::Error>` | `error.rs`, `commands/*.rs` |
| **Frontend Secret Storage & Env Display** | `localStorage`, `sessionStorage`, `process.env`, `ProcessDetailDrawer` | `src/features/**`, `src/lib/**` |
| **Global Panic & Crash Handling** | `set_hook`, `PanicHookInfo` | `src-tauri/src/lib.rs` |

---

## 2. Findings and Remediations

### A. Credentials & Struct Debug Derivations
- **Finding**: Any struct holding raw plaintext secrets (`secret_payload`, `master_password`, or AES key bytes) could dump plaintext secrets to stdout/crash dumps if deriving `std::fmt::Debug`.
- **Remediation**:
  - `CreateCredentialPayload` (`src-tauri/src/models.rs`): Explicitly implemented manual `std::fmt::Debug` formatting with `"***REDACTED***"` placeholders for `secret_payload` and `master_password`.
  - `VaultHandle` (`src-tauri/src/secrets/vault.rs`): Implemented manual `std::fmt::Debug` formatting that outputs `key: "[REDACTED]"` while preserving `Zeroize` and `ZeroizeOnDrop` memory sanitization.
  - `VaultFile`, `PtyCommand`, `SshClientHandler`: Do not derive `Debug` and do not expose unredacted buffers.

### B. Secret Zeroization Across Execution Paths
- **Finding**: Secrets in `session_manager.rs`, `exec.rs`, and `external_ssh.rs` were relying on manual `zeroize()` calls placed after asynchronous operations. If an SSH authentication call failed or timed out early, the secret string would not have been zeroized before being dropped.
- **Remediation**:
  - `ssh/session_manager.rs`: Wrapped decrypted credentials in `zeroize::Zeroizing::new(secret)` immediately upon reading from Keychain.
  - `ssh/exec.rs`: Wrapped connection test credentials in `zeroize::Zeroizing::new(secret)` immediately on entry.
  - `commands/external_ssh.rs`: Wrapped decrypted private keys in `zeroize::Zeroizing::new(...)` before writing to ephemeral temp files.

### C. Command & Stream Output Scrubbing
- **Finding**: Output from `run_server_command` (`commands.rs`), PM2 error log tailing (`pm2.rs`), rebuild pipeline execution (`rebuild_engine.rs`), and live PTY log streams (`logs.rs`) could capture verbose build errors or scripts that echo secrets (e.g., connection strings, auth tokens, PEM keys).
- **Remediation**:
  - `commands/commands.rs`: Sanitized `combined_output` using `crate::secrets::redact::redact_secrets` before returning to frontend and before recording in `activity_log.detail`.
  - `commands/pm2.rs`: Added `redact_secrets` scrubbing on `tail_process_log` output.
  - `commands/logs.rs`: Applied `redact_secrets` on streaming log chunks before persisting to disk (`.log` session files) and before broadcasting over Tauri IPC `logs://data` events.
  - `pipelines/rebuild_engine.rs`: All step output chunks are stripped of ANSI escape sequences and scrubbed through `redact_secrets` before emission and database persistence.

### D. PM2 Environment Variable Masking
- **Finding**: `pm2 jlist` retrieves full `process.env` blocks. Node.js applications frequently store database connection strings, JWT keys, and API tokens in environment variables.
- **Remediation**:
  - `commands/pm2.rs`: Implemented comprehensive key name screening (`secret`, `password`, `token`, `key`, `pass`, `auth`, `cred`, `private`, `hash`, `salt`, `cookie`, `jwt`, `api`, `cert`, `database_url`, `db_pass`, `conn_str`, `dsn`, `webhook`, `session`). Values matching these keys are replaced with `"***REDACTED***"`. Any non-matching string values are additionally scanned and scrubbed via `redact_secrets`.
  - `ProcessDetailDrawer.tsx`: UI table masks all environment variable values by default (`••••••••`).

### E. Activity Log Dual-Layer Redaction
- **Finding**: `activity_log.detail` records operational metadata and error messages.
- **Remediation**:
  - `db/mod.rs` (`log_activity`): Automatically pipes `entry.detail` through `redact_secrets` on SQLite write.
  - `commands/activity.rs` (`get_activity_log`): Re-applies `redact_secrets` on read when returning entries to the frontend, ensuring legacy or external rows are also sanitized.

### F. IPC Error Serialization & SSH Auth Error Redaction
- **Finding**: Raw SSH error strings or russh/russh_keys internal failures could echo connection attempts or parameters.
- **Remediation**:
  - `error.rs`: `CommandError::serialize` passes the formatted error string through `crate::secrets::redact::redact_secrets` before serializing across the Tauri IPC bridge.
  - `error.rs`: `From<russh::Error>` and `From<russh_keys::Error>` converters sanitize error strings on creation.

### G. Global Panic Redaction Hook
- **Finding**: Unhandled panics in Rust print error payloads and source locations to stderr.
- **Remediation**:
  - `src-tauri/src/lib.rs`: Installed a global `std::panic::set_hook` that intercepts the panic payload and location, executes regex pattern matching via `redact_secrets`, and emits sanitized crash diagnostics to `eprintln!`.

---

## 3. Redaction Engine Capabilities (`src-tauri/src/secrets/redact.rs`)

The centralized `redact_secrets` engine redacts:
1. **PEM & SSH Private Keys**: Multi-line RSA, OPENSSH, DSA, EC, and SSH2 encrypted private key blocks.
2. **Internal References**: `scc:credential:<uuid>` and `scc:test:<uuid>` keychain identifiers.
3. **API & Cloud Tokens**: AWS Access Key IDs (`AKIA...`), GitHub Personal Access Tokens & OAuth tokens (`ghp_...`, `github_pat_...`).
4. **Bearer Tokens**: `Bearer <token>` headers and strings.
5. **Database Connection URIs**: `postgres://`, `mysql://`, `redis://`, `mongodb://`, `amqp://`, `mssql://` connection strings with password masking.
6. **Key-Value Secret Strings**: Standard `password=...`, `secret_key=...`, `api_key=...` assignments.

---

## 4. Verification & Testing

- **Rust Unit Tests**:
  - `secrets::redact::tests::test_redact_pem_private_keys` (PASSED)
  - `secrets::redact::tests::test_redact_credential_refs` (PASSED)
  - `secrets::redact::tests::test_redact_tokens` (PASSED)
  - `secrets::redact::tests::test_redact_bearer_tokens` (PASSED)
  - `secrets::redact::tests::test_redact_database_urls` (PASSED)
  - `secrets::redact::tests::test_redact_key_value_secrets` (PASSED)
  - `secrets::vault::tests::test_vault_lifecycle` (PASSED)
  - `secrets::keychain::tests::test_keychain_crud` (PASSED)
  - `commands::credentials::tests::test_db_inserts_only_metadata` (PASSED)
  - `commands::servers::tests::test_crud_server` (PASSED)
- **Frontend Build**: `npm run build` completes with 0 errors.
- **Clean Backend Build**: `cargo test` builds with 0 errors and 0 critical warnings.

---

## 5. Vulnerability Disclosure Policy

If you discover a security vulnerability within Server Command Center, please report it responsibly:

- **Contact**: Email security reports to `abdullahsufyan2007@gmail.com` with the subject line `[SECURITY DISCLOSURE] Server Command Center - Falah Tech`.
- **Details**: Please include reproducible steps, affected platform/architecture, and a proof of concept if applicable.
- **Response Timeline**:
  - Initial acknowledgement: within 24 hours.
  - Vulnerability assessment & patch release: within 72 hours for critical severity issues.
- **Responsible Disclosure**: Please do not publicly disclose vulnerabilities until an official patch release has been published.
