use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::db::{log_activity, ActivityEntry, actions};
use serde::{Deserialize, Serialize};
use std::time::Instant;
use russh::ChannelMsg;
use tokio::time::{timeout, Duration};
use crate::ssh::client::SshClientHandler;
use russh::client::Handle;
use base64::Engine as _;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxSite {
    pub name: String,
    pub domains: Vec<String>,
    pub proxy_pass: Option<String>,
    pub ssl_enabled: bool,
    pub ssl_certificate: Option<String>,
    pub is_enabled: bool,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SslCertificate {
    pub domain: String,
    pub cert_name: String,
    pub expiry_date: Option<String>,
    pub days_remaining: Option<i64>,
    pub is_valid: bool,
}

async fn exec_ssh_command(
    session: &mut Handle<SshClientHandler>,
    cmd: &str,
) -> Result<String, CommandError> {
    let mut channel = session.channel_open_session().await
        .map_err(|e| CommandError::Internal(format!("Failed to open SSH channel: {}", e)))?;

    channel.exec(true, cmd).await
        .map_err(|e| CommandError::Internal(format!("Failed to exec command '{}': {}", cmd, e)))?;

    let mut output = String::new();
    let timeout_duration = Duration::from_secs(30);
    
    loop {
        let msg_future = channel.wait();
        let msg_opt = match timeout(timeout_duration, msg_future).await {
            Ok(opt) => opt,
            Err(_) => {
                let _ = channel.close().await;
                return Err(CommandError::Internal("SSH command timed out".into()));
            }
        };

        match msg_opt {
            Some(ChannelMsg::Data { ref data }) => {
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                break;
            }
            _ => {}
        }
    }
    
    let _ = channel.close().await;
    Ok(output)
}

#[tauri::command]
pub async fn list_nginx_sites(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<Vec<NginxSite>> {
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;
    
    // Check sites-available and sites-enabled
    let script = r#"
        for f in /etc/nginx/sites-available/* /etc/nginx/conf.d/*.conf; do
            [ -f "$f" ] || continue
            bname=$(basename "$f" .conf)
            enabled=0
            if [ -L "/etc/nginx/sites-enabled/$bname" ] || [ -L "/etc/nginx/sites-enabled/$(basename "$f")" ] || [[ "$f" == *"/conf.d/"* ]]; then
                enabled=1
            fi
            echo "---SITE---"
            echo "FILE:$f"
            echo "NAME:$bname"
            echo "ENABLED:$enabled"
            echo "CONTENT:"
            cat "$f" 2>/dev/null
        done
    "#;

    let output = exec_ssh_command(&mut session, script).await.unwrap_or_default();
    let mut sites = Vec::new();

    let chunks: Vec<&str> = output.split("---SITE---").filter(|s| !s.trim().is_empty()).collect();

    for chunk in chunks {
        let mut file_path = String::new();
        let mut name = String::new();
        let mut is_enabled = false;
        let mut content = String::new();

        let mut lines = chunk.lines();
        while let Some(line) = lines.next() {
            let line = line.trim();
            if let Some(path) = line.strip_prefix("FILE:") {
                file_path = path.trim().to_string();
            } else if let Some(n) = line.strip_prefix("NAME:") {
                name = n.trim().to_string();
            } else if let Some(en) = line.strip_prefix("ENABLED:") {
                is_enabled = en.trim() == "1";
            } else if line.starts_with("CONTENT:") {
                content = lines.collect::<Vec<&str>>().join("\n");
                break;
            }
        }

        if name.is_empty() {
            continue;
        }

        // Parse domains, proxy_pass, ssl from content
        let mut domains = Vec::new();
        let mut proxy_pass = None;
        let mut ssl_certificate = None;
        let mut ssl_enabled = false;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') {
                continue;
            }

            if trimmed.starts_with("server_name") {
                let parts: Vec<&str> = trimmed
                    .trim_start_matches("server_name")
                    .trim_end_matches(';')
                    .split_whitespace()
                    .filter(|s| !s.is_empty())
                    .collect();
                for d in parts {
                    domains.push(d.to_string());
                }
            } else if trimmed.starts_with("proxy_pass") {
                let target = trimmed
                    .trim_start_matches("proxy_pass")
                    .trim_end_matches(';')
                    .trim();
                if proxy_pass.is_none() {
                    proxy_pass = Some(target.to_string());
                }
            } else if trimmed.starts_with("ssl_certificate ") && !trimmed.starts_with("ssl_certificate_key") {
                let cert = trimmed
                    .trim_start_matches("ssl_certificate")
                    .trim_end_matches(';')
                    .trim();
                ssl_certificate = Some(cert.to_string());
                ssl_enabled = true;
            } else if trimmed.contains("listen") && trimmed.contains("443") && trimmed.contains("ssl") {
                ssl_enabled = true;
            }
        }

        sites.push(NginxSite {
            name,
            domains,
            proxy_pass,
            ssl_enabled,
            ssl_certificate,
            is_enabled,
            file_path,
        });
    }

    Ok(sites)
}

fn validate_site_name(name: &str) -> CommandResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(CommandError::Validation("Site name cannot be empty".into()));
    }
    if !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_') {
        return Err(CommandError::Validation(format!(
            "Invalid site name '{}'. Only letters, numbers, dots, hyphens, and underscores are allowed.",
            trimmed
        )));
    }
    if trimmed.contains("..") || trimmed.starts_with('/') || trimmed.starts_with('\\') {
        return Err(CommandError::Validation("Path traversal in site name is not permitted".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_nginx_config(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    site_name: String,
) -> CommandResult<String> {
    validate_site_name(&site_name)?;
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let read_cmd = format!(
        "cat /etc/nginx/sites-available/{} 2>/dev/null || cat /etc/nginx/conf.d/{}.conf 2>/dev/null",
        site_name, site_name
    );
    let output = exec_ssh_command(&mut session, &read_cmd).await?;
    Ok(output)
}

#[tauri::command]
pub async fn save_nginx_config(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    site_name: String,
    content: String,
) -> CommandResult<String> {
    validate_site_name(&site_name)?;
    let start_time = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let encoded_b64 = base64::engine::general_purpose::STANDARD.encode(content.as_bytes());
    let temp_file = format!("/tmp/nginx_cfg_{}_{}.conf", site_name, chrono::Utc::now().timestamp());
    let target_file = format!("/etc/nginx/sites-available/{}", site_name);

    // Write temp file, validate with nginx -t
    let write_and_test_script = format!(
        r#"
        echo "{}" | base64 -d > "{}"
        if sudo nginx -t; then
            sudo cp "{}" "{}"
            sudo rm -f "{}"
            echo "SUCCESS"
        else
            sudo rm -f "{}"
            echo "INVALID_CONFIG"
            exit 1
        fi
        "#,
        encoded_b64, temp_file, temp_file, target_file, temp_file, temp_file
    );

    let res = exec_ssh_command(&mut session, &write_and_test_script).await;
    
    // Audit mutation
    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::SAVE_NGINX_CONFIG.into(),
            target: Some(site_name),
            status: if res.is_ok() { "success".into() } else { "failed".into() },
            detail: res.as_ref().err().map(|e| e.to_string()),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    res
}

#[tauri::command]
pub async fn toggle_nginx_site(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    site_name: String,
    enable: bool,
) -> CommandResult<()> {
    validate_site_name(&site_name)?;
    let start_time = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let cmd = if enable {
        format!(
            "sudo ln -sf /etc/nginx/sites-available/{} /etc/nginx/sites-enabled/{} && sudo nginx -t && sudo systemctl reload nginx",
            site_name, site_name
        )
    } else {
        format!(
            "sudo rm -f /etc/nginx/sites-enabled/{} && sudo nginx -t && sudo systemctl reload nginx",
            site_name
        )
    };

    let res = exec_ssh_command(&mut session, &cmd).await;

    // Audit mutation
    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::TOGGLE_NGINX_SITE.into(),
            target: Some(site_name.clone()),
            status: if res.is_ok() { "success".into() } else { "failed".into() },
            detail: Some(format!("Site {} set to {}", site_name, if enable { "enabled" } else { "disabled" })),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    res.map(|_| ())
}

#[tauri::command]
pub async fn test_nginx_config(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<String> {
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let output = exec_ssh_command(&mut session, "sudo nginx -t 2>&1").await?;
    Ok(output)
}

#[tauri::command]
pub async fn reload_nginx(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<()> {
    let start_time = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let res = exec_ssh_command(&mut session, "sudo systemctl reload nginx").await;

    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::RELOAD_NGINX.into(),
            target: Some("nginx".into()),
            status: if res.is_ok() { "success".into() } else { "failed".into() },
            detail: res.as_ref().err().map(|e| e.to_string()),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    res.map(|_| ())
}

#[tauri::command]
pub async fn get_ssl_certificates(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<Vec<SslCertificate>> {
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let cmd = "sudo certbot certificates 2>/dev/null || true";
    let output = exec_ssh_command(&mut session, cmd).await.unwrap_or_default();

    let mut certs = Vec::new();
    let mut current_name = String::new();
    let mut current_domains = String::new();
    let mut current_expiry = None;
    let mut days_remaining = None;
    let mut is_valid = true;

    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix("Certificate Name:") {
            if !current_name.is_empty() {
                certs.push(SslCertificate {
                    domain: current_domains.clone(),
                    cert_name: current_name.clone(),
                    expiry_date: current_expiry.clone(),
                    days_remaining,
                    is_valid,
                });
            }
            current_name = name.trim().to_string();
            current_domains.clear();
            current_expiry = None;
            days_remaining = None;
            is_valid = true;
        } else if let Some(doms) = trimmed.strip_prefix("Domains:") {
            current_domains = doms.trim().to_string();
        } else if let Some(exp_str) = trimmed.strip_prefix("Expiry Date:") {
            current_expiry = Some(exp_str.trim().to_string());
            if let Some(valid_idx) = exp_str.find("(VALID: ") {
                let rest = &exp_str[valid_idx + 8..];
                if let Some(days_str) = rest.split_whitespace().next() {
                    days_remaining = days_str.parse::<i64>().ok();
                }
            }
            if exp_str.contains("INVALID") || exp_str.contains("EXPIRED") {
                is_valid = false;
            }
        }
    }

    if !current_name.is_empty() {
        certs.push(SslCertificate {
            domain: current_domains,
            cert_name: current_name,
            expiry_date: current_expiry,
            days_remaining,
            is_valid,
        });
    }

    Ok(certs)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertRenewalResult {
    pub success: bool,
    pub output: String,
}

/// Triggers certbot renewal (dry run or real renewal) for all domains
#[tauri::command]
pub async fn renew_ssl_certificates(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    dry_run: bool,
) -> CommandResult<CertRenewalResult> {
    let start_time = std::time::Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let cmd = if dry_run {
        "sudo certbot renew --dry-run 2>&1"
    } else {
        "sudo certbot renew --nginx --non-interactive 2>&1"
    };

    let output = exec_ssh_command(&mut session, cmd).await?;
    let success = output.contains("Congratulations, all renewals succeeded") 
        || output.contains("The following certificates are not due for renewal yet")
        || output.contains("dry run: all simulated renewals succeeded")
        || (!output.contains("FAILED") && !output.contains("An error occurred"));

    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: if dry_run { "ssl_certbot_dry_run".into() } else { "ssl_certbot_renew".into() },
            target: Some("certbot".into()),
            status: if success { "success".into() } else { "failed".into() },
            detail: Some(output.lines().take(5).collect::<Vec<_>>().join("\n")),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    Ok(CertRenewalResult { success, output })
}
