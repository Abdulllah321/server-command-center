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

use crate::commands::confirmation::consume_token;
use chrono::{NaiveDateTime, Utc};

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
    pub issuer: Option<String>,
    pub cert_path: Option<String>,
    pub status_level: String, // "healthy", "expiring_soon", "critical", "expired"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SslOverview {
    pub certificates: Vec<SslCertificate>,
    pub total_certs: usize,
    pub healthy_count: usize,
    pub expiring_soon_count: usize,
    pub expired_count: usize,
    pub is_auto_renew_timer_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueCertPayload {
    pub domain: String,
    pub email: String,
    pub staging_test: bool,
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

fn parse_all_ssl_output(output: &str) -> (Vec<SslCertificate>, bool) {
    let mut certs = Vec::new();
    let mut is_timer_active = false;

    let parts: Vec<&str> = output.split("===OPENSSL_CERTS===").collect();
    let certbot_part = parts.get(0).copied().unwrap_or("");
    let remainder = parts.get(1).copied().unwrap_or("");

    let (openssl_part, timer_part) = if let Some(idx) = remainder.find("===TIMER_STATUS===") {
        (&remainder[..idx], &remainder[idx + 18..])
    } else {
        (remainder, "")
    };

    if timer_part.contains("active") {
        is_timer_active = true;
    }

    // 1. Parse Certbot Output
    let mut current_name = String::new();
    let mut current_domains = String::new();
    let mut current_expiry = None;
    let mut days_remaining = None;
    let mut is_valid = true;

    for line in certbot_part.lines() {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix("Certificate Name:") {
            if !current_name.is_empty() {
                let status_level = match days_remaining {
                    Some(d) if d <= 0 => "expired",
                    Some(d) if d < 15 => "critical",
                    Some(d) if d <= 30 => "expiring_soon",
                    _ => if is_valid { "healthy" } else { "expired" },
                }.to_string();

                certs.push(SslCertificate {
                    domain: current_domains.clone(),
                    cert_name: current_name.clone(),
                    expiry_date: current_expiry.clone(),
                    days_remaining,
                    is_valid,
                    issuer: Some("Let's Encrypt".to_string()),
                    cert_path: Some(format!("/etc/letsencrypt/live/{}/fullchain.pem", current_name)),
                    status_level,
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
        let status_level = match days_remaining {
            Some(d) if d <= 0 => "expired",
            Some(d) if d < 15 => "critical",
            Some(d) if d <= 30 => "expiring_soon",
            _ => if is_valid { "healthy" } else { "expired" },
        }.to_string();

        certs.push(SslCertificate {
            domain: current_domains,
            cert_name: current_name.clone(),
            expiry_date: current_expiry,
            days_remaining,
            is_valid,
            issuer: Some("Let's Encrypt".to_string()),
            cert_path: Some(format!("/etc/letsencrypt/live/{}/fullchain.pem", current_name)),
            status_level,
        });
    }

    // 2. Parse OpenSSL certificates from Nginx directives
    let now = Utc::now().naive_utc();
    let cert_blocks = openssl_part.split("---END_CERT---");

    for block in cert_blocks {
        let trimmed_block = block.trim();
        if trimmed_block.is_empty() {
            continue;
        }

        let mut path = String::new();
        let mut subject_cn = String::new();
        let mut issuer_name = String::new();
        let mut not_after = String::new();
        let mut san_domains = Vec::new();

        for line in trimmed_block.lines() {
            let l = line.trim();
            if let Some(p) = l.strip_prefix("PATH:") {
                path = p.trim().to_string();
            } else if l.contains("subject=") {
                if let Some(idx) = l.find("CN = ") {
                    subject_cn = l[idx + 5..].split(',').next().unwrap_or("").trim().to_string();
                } else if let Some(idx) = l.find("CN=") {
                    subject_cn = l[idx + 3..].split(',').next().unwrap_or("").trim().to_string();
                }
            } else if l.contains("issuer=") {
                if l.contains("Cloudflare") {
                    issuer_name = "Cloudflare Origin CA".to_string();
                } else if l.contains("Let's Encrypt") {
                    issuer_name = "Let's Encrypt".to_string();
                } else if l.contains("DigiCert") {
                    issuer_name = "DigiCert".to_string();
                } else if l.contains("ZeroSSL") {
                    issuer_name = "ZeroSSL".to_string();
                } else if let Some(idx) = l.find("O = ") {
                    issuer_name = l[idx + 4..].split(',').next().unwrap_or("Custom / Enterprise").trim().to_string();
                } else {
                    issuer_name = "Custom / Self-Signed".to_string();
                }
            } else if let Some(na) = l.strip_prefix("notAfter=") {
                not_after = na.trim().to_string();
            } else if l.contains("DNS:") {
                for item in l.split(',') {
                    let item = item.trim();
                    if let Some(dns) = item.strip_prefix("DNS:") {
                        let clean = dns.trim().to_string();
                        if !clean.is_empty() && !san_domains.contains(&clean) {
                            san_domains.push(clean);
                        }
                    }
                }
            }
        }

        if path.is_empty() {
            continue;
        }

        // Deduplicate against certbot certs
        let already_listed = certs.iter().any(|c| {
            if let Some(ref cp) = c.cert_path {
                if cp == &path { return true; }
            }
            if !subject_cn.is_empty() && (c.cert_name == subject_cn || c.domain.contains(&subject_cn)) {
                return true;
            }
            false
        });

        if already_listed {
            continue;
        }

        let cert_display_name = if !subject_cn.is_empty() {
            subject_cn.clone()
        } else {
            path.rsplit('/').next().unwrap_or(&path).to_string()
        };

        let domains_str = if !san_domains.is_empty() {
            san_domains.join(" ")
        } else if !subject_cn.is_empty() {
            subject_cn.clone()
        } else {
            cert_display_name.clone()
        };

        let mut openssl_days_remaining = None;
        let mut is_cert_valid = true;

        if !not_after.is_empty() {
            let normalized_date = not_after.split_whitespace().collect::<Vec<_>>().join(" ");
            if let Ok(expiry_dt) = NaiveDateTime::parse_from_str(&normalized_date, "%b %d %H:%M:%S %Y GMT") {
                let diff_days = (expiry_dt - now).num_days();
                openssl_days_remaining = Some(diff_days);
                if diff_days <= 0 {
                    is_cert_valid = false;
                }
            }
        }

        let status_level = match openssl_days_remaining {
            Some(d) if d <= 0 => "expired",
            Some(d) if d < 15 => "critical",
            Some(d) if d <= 30 => "expiring_soon",
            _ => if is_cert_valid { "healthy" } else { "expired" },
        }.to_string();

        certs.push(SslCertificate {
            domain: domains_str,
            cert_name: cert_display_name,
            expiry_date: if not_after.is_empty() { None } else { Some(not_after) },
            days_remaining: openssl_days_remaining,
            is_valid: is_cert_valid,
            issuer: if issuer_name.is_empty() { Some("Custom / SSL".into()) } else { Some(issuer_name) },
            cert_path: Some(path),
            status_level,
        });
    }

    (certs, is_timer_active)
}

#[tauri::command]
pub async fn get_ssl_overview(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<SslOverview> {
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let cmd = r#"
export LC_ALL=C
sudo certbot certificates 2>/dev/null || true
echo "===OPENSSL_CERTS==="
grep -rohP '(?<=ssl_certificate\s)[^;]+' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | sort -u | while read -r cert_file; do
    cert_file=$(echo "$cert_file" | tr -d ' "')
    if [ -f "$cert_file" ]; then
        echo "PATH:$cert_file"
        openssl x509 -in "$cert_file" -noout -subject -issuer -dates 2>/dev/null || true
        openssl x509 -in "$cert_file" -noout -ext subjectAltName 2>/dev/null || true
        echo "---END_CERT---"
    fi
done
echo "===TIMER_STATUS==="
systemctl is-active certbot.timer 2>/dev/null || echo "inactive"
"#;

    let output = exec_ssh_command(&mut session, cmd).await.unwrap_or_default();
    let (certificates, is_auto_renew_timer_active) = parse_all_ssl_output(&output);

    let total_certs = certificates.len();
    let mut healthy_count = 0;
    let mut expiring_soon_count = 0;
    let mut expired_count = 0;

    for c in &certificates {
        match c.status_level.as_str() {
            "critical" | "expired" => expired_count += 1,
            "expiring_soon" => expiring_soon_count += 1,
            _ => healthy_count += 1,
        }
    }

    Ok(SslOverview {
        certificates,
        total_certs,
        healthy_count,
        expiring_soon_count,
        expired_count,
        is_auto_renew_timer_active,
    })
}

#[tauri::command]
pub async fn get_ssl_certificates(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<Vec<SslCertificate>> {
    let overview = get_ssl_overview(state, app_handle, server_id).await?;
    Ok(overview.certificates)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertRenewalResult {
    pub success: bool,
    pub output: String,
}

/// Triggers certbot renewal (dry run or real renewal) for all domains or specific cert
#[tauri::command]
pub async fn renew_ssl_certificates(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    cert_name: Option<String>,
    dry_run: bool,
) -> CommandResult<CertRenewalResult> {
    let start_time = std::time::Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let cert_target = cert_name.as_deref().unwrap_or("");
    let cert_arg = if !cert_target.is_empty() {
        format!("--cert-name {} ", cert_target)
    } else {
        "".to_string()
    };

    let cmd = if dry_run {
        format!("sudo certbot renew {}--dry-run 2>&1", cert_arg)
    } else {
        format!("sudo certbot renew {}--nginx --non-interactive 2>&1; sudo systemctl reload nginx 2>/dev/null || sudo nginx -s reload 2>/dev/null || true", cert_arg)
    };

    let output = exec_ssh_command(&mut session, &cmd).await?;
    let success = output.contains("Congratulations, all renewals succeeded") 
        || output.contains("The following certificates are not due for renewal yet")
        || output.contains("dry run: all simulated renewals succeeded")
        || output.contains("Certificate not yet due for renewal")
        || (!output.contains("FAILED") && !output.contains("An error occurred"));

    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: if dry_run { "ssl_certbot_dry_run".into() } else { actions::RENEW_SSL_CERTIFICATES.into() },
            target: Some(if cert_target.is_empty() { "all_certificates".into() } else { cert_target.into() }),
            status: if success { "success".into() } else { "failed".into() },
            detail: Some(output.lines().take(5).collect::<Vec<_>>().join("\n")),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    Ok(CertRenewalResult { success, output })
}

#[tauri::command]
pub async fn issue_ssl_certificate(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    payload: IssueCertPayload,
) -> CommandResult<CertRenewalResult> {
    let start_time = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let domain = payload.domain.trim();
    if domain.is_empty() {
        return Err(CommandError::Validation("Domain cannot be empty".into()));
    }

    let staging_flag = if payload.staging_test { "--staging " } else { "" };
    let email_arg = if !payload.email.trim().is_empty() {
        format!("-m {} ", payload.email.trim())
    } else {
        "--register-unsafely-without-email ".to_string()
    };

    let cmd = format!(
        "sudo certbot --nginx -d {} --non-interactive --agree-tos {}{}--redirect 2>&1; sudo systemctl reload nginx 2>/dev/null || sudo nginx -s reload 2>/dev/null || true",
        domain, email_arg, staging_flag
    );

    let output = exec_ssh_command(&mut session, &cmd).await?;
    let success = output.contains("Congratulations")
        || output.contains("Successfully received certificate")
        || output.contains("Certificate not yet due for renewal")
        || (!output.contains("An error occurred") && !output.contains("FAILED"));

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::ISSUE_SSL_CERTIFICATE.into(),
            target: Some(domain.into()),
            status: if success { "success".into() } else { "failed".into() },
            detail: Some(output.lines().take(6).collect::<Vec<_>>().join("\n")),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    Ok(CertRenewalResult { success, output })
}

#[tauri::command]
pub async fn toggle_ssl_auto_renewal(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    enable: bool,
) -> CommandResult<bool> {
    let start_time = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let cmd = if enable {
        "sudo systemctl enable --now certbot.timer 2>&1"
    } else {
        "sudo systemctl disable --now certbot.timer 2>&1"
    };

    let output = exec_ssh_command(&mut session, cmd).await?;
    let success = !output.contains("Failed to");

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::TOGGLE_SSL_AUTO_RENEWAL.into(),
            target: Some("certbot.timer".into()),
            status: if success { "success".into() } else { "failed".into() },
            detail: Some(format!("Auto-renewal timer set to: {}", enable)),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    Ok(enable)
}

#[tauri::command]
pub async fn delete_ssl_certificate(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    cert_name: String,
    confirmation_token: Option<String>,
) -> CommandResult<String> {
    consume_token(confirmation_token.as_deref()).await?;

    let start_time = Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let cmd = format!("sudo certbot delete --cert-name {} --non-interactive 2>&1", cert_name);
    let output = exec_ssh_command(&mut session, &cmd).await?;
    let success = output.contains("Deleted all files relating to certificate")
        || output.contains("Successfully deleted")
        || !output.contains("No certificate found");

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::DELETE_SSL_CERTIFICATE.into(),
            target: Some(cert_name.clone()),
            status: if success { "success".into() } else { "failed".into() },
            detail: Some(output.lines().take(4).collect::<Vec<_>>().join("\n")),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    if success {
        Ok(format!("Successfully deleted certificate {}", cert_name))
    } else {
        Err(CommandError::Internal(output))
    }
}

