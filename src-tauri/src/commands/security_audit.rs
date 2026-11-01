/*!
# Security Audit & Port Scanner Module
Provides comprehensive infrastructure security checks:
- Active listening ports scanner (ss -tulpn) with public vs localhost risk classification
- UFW Firewall management (status, rules, allow/deny toggling)
- SSH daemon configuration hardening audit & scoring
- Fail2ban & pending OS security updates check
*/

use std::time::Duration;
use serde::{Deserialize, Serialize};
use russh::client::Handle;
use russh::ChannelMsg;
use tokio::time::timeout;

use crate::AppState;
use crate::error::{CommandResult, CommandError};
use crate::ssh::client::SshClientHandler;
use crate::db::{log_activity, ActivityEntry};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListeningPort {
    pub protocol: String,
    pub local_port: u16,
    pub bind_address: String,
    pub process_name: String,
    pub pid: Option<u32>,
    pub is_public: bool,
    pub risk_level: String, // "safe", "normal", "high"
    pub risk_description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UfwRule {
    pub number: u32,
    pub to_port: String,
    pub action: String, // "ALLOW", "DENY", "LIMIT"
    pub from_ip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UfwStatus {
    pub is_installed: bool,
    pub is_active: bool,
    pub default_incoming: String,
    pub default_outgoing: String,
    pub rules: Vec<UfwRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityRecommendation {
    pub severity: String, // "critical", "warning", "info", "good"
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshHardeningAudit {
    pub permit_root_login: String,
    pub password_authentication: String,
    pub port: u16,
    pub pubkey_authentication: String,
    pub max_auth_tries: u32,
    pub score: u32,
    pub recommendations: Vec<SecurityRecommendation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityOverview {
    pub fail2ban_active: bool,
    pub banned_ips_count: u32,
    pub pending_security_updates: u32,
    pub total_listening_ports: usize,
    pub public_ports_count: usize,
    pub high_risk_ports_count: usize,
    pub firewall_active: bool,
    pub ssh_score: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityAuditReport {
    pub ports: Vec<ListeningPort>,
    pub ufw: UfwStatus,
    pub ssh: SshHardeningAudit,
    pub overview: SecurityOverview,
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
                return Err(CommandError::Internal("Security check command timed out".into()));
            }
        };

        match msg_opt {
            Some(ChannelMsg::Data { ref data }) => {
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExitStatus { .. }) => {}
            Some(ChannelMsg::Close) | None => break,
            _ => {}
        }
    }

    let _ = channel.close().await;
    Ok(output)
}

fn parse_listening_ports(output: &str) -> Vec<ListeningPort> {
    let mut ports = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("Netid") || trimmed.starts_with("Active") || trimmed.starts_with("Proto") {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }

        // Determine protocol: tcp / udp
        let protocol = parts[0].to_lowercase();
        if !protocol.starts_with("tcp") && !protocol.starts_with("udp") {
            continue;
        }

        // ss format: Netid State Recv-Q Send-Q Local_Address:Port Peer_Address:Port Process
        // Look for column containing ':' for Local Address:Port
        let local_addr_col = parts.iter().find(|p| p.contains(':') && !p.starts_with("users:"));
        let local_str = match local_addr_col {
            Some(s) => *s,
            None => continue,
        };

        // Extract port and bind address
        let last_colon = match local_str.rfind(':') {
            Some(idx) => idx,
            None => continue,
        };

        let bind_address = &local_str[..last_colon];
        let port_str = &local_str[last_colon + 1..];
        let port = match port_str.parse::<u16>() {
            Ok(p) => p,
            Err(_) => continue,
        };

        // Extract process name and pid if available (e.g. users:(("sshd",pid=789,fd=3)))
        let mut process_name = "unknown".to_string();
        let mut pid = None;

        if let Some(user_part) = parts.iter().find(|p| p.contains("users:(") || p.contains("pid=")) {
            if let Some(quote_start) = user_part.find('"') {
                if let Some(quote_end) = user_part[quote_start + 1..].find('"') {
                    process_name = user_part[quote_start + 1..quote_start + 1 + quote_end].to_string();
                }
            }
            if let Some(pid_idx) = user_part.find("pid=") {
                let rest = &user_part[pid_idx + 4..];
                let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                pid = num_str.parse::<u32>().ok();
            }
        }

        // Determine public accessibility
        let is_public = bind_address == "0.0.0.0" 
            || bind_address == "::" 
            || bind_address == "*" 
            || (!bind_address.starts_with("127.") && bind_address != "::1" && !bind_address.is_empty());

        let (risk_level, risk_description) = if !is_public {
            ("safe".to_string(), "Localhost Only — safe from external network attacks".to_string())
        } else if [5432, 3306, 27017, 6379, 9200, 2375, 11211].contains(&port) {
            ("high".to_string(), format!("High Risk: Internal Database/Cache port {} is publicly exposed to the internet!", port))
        } else if [80, 443].contains(&port) {
            ("normal".to_string(), "Standard Web Traffic (HTTP/HTTPS)".to_string())
        } else if port == 22 {
            ("normal".to_string(), "SSH Remote Administration Port".to_string())
        } else {
            ("normal".to_string(), format!("Custom publicly accessible port ({})", port))
        };

        ports.push(ListeningPort {
            protocol,
            local_port: port,
            bind_address: if bind_address.is_empty() { "*".into() } else { bind_address.to_string() },
            process_name,
            pid,
            is_public,
            risk_level,
            risk_description,
        });
    }

    // Deduplicate ports (e.g. IPv4 and IPv6 instances of the same port)
    ports.sort_by_key(|p| p.local_port);
    ports.dedup_by(|a, b| a.local_port == b.local_port && a.protocol == b.protocol && a.bind_address == b.bind_address);
    ports
}

fn parse_ufw_output(output: &str) -> UfwStatus {
    let is_installed = !output.contains("command not found") && !output.contains("not found");
    let is_active = output.contains("Status: active");
    
    let default_incoming = if output.contains("default: deny (incoming)") {
        "deny".to_string()
    } else {
        "allow".to_string()
    };

    let default_outgoing = if output.contains("allow (outgoing)") {
        "allow".to_string()
    } else {
        "allow".to_string()
    };

    let mut rules = Vec::new();
    let mut in_rules = false;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("[ ") || trimmed.starts_with('[') {
            in_rules = true;
        }

        if in_rules && (trimmed.starts_with('[') || trimmed.starts_with("[ ")) {
            // e.g. "[ 1] 22/tcp                     ALLOW IN    Anywhere"
            if let Some(close_bracket) = trimmed.find(']') {
                let num_str = trimmed[1..close_bracket].trim();
                if let Ok(num) = num_str.parse::<u32>() {
                    let rest = trimmed[close_bracket + 1..].trim();
                    let parts: Vec<&str> = rest.split_whitespace().collect();
                    if parts.len() >= 3 {
                        let to_port = parts[0].to_string();
                        let action = parts[1].to_string();
                        let from_ip = parts[parts.len() - 1].to_string();
                        rules.push(UfwRule {
                            number: num,
                            to_port,
                            action,
                            from_ip,
                        });
                    }
                }
            }
        }
    }

    UfwStatus {
        is_installed,
        is_active,
        default_incoming,
        default_outgoing,
        rules,
    }
}

fn parse_ssh_config(output: &str) -> SshHardeningAudit {
    let mut permit_root_login = "unknown".to_string();
    let mut password_authentication = "unknown".to_string();
    let mut port: u16 = 22;
    let mut pubkey_authentication = "yes".to_string();
    let mut max_auth_tries: u32 = 6;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        let lower = trimmed.to_lowercase();
        if lower.starts_with("permitrootlogin ") {
            permit_root_login = lower.split_whitespace().nth(1).unwrap_or("unknown").to_string();
        } else if lower.starts_with("passwordauthentication ") {
            password_authentication = lower.split_whitespace().nth(1).unwrap_or("unknown").to_string();
        } else if lower.starts_with("port ") {
            if let Some(p_str) = lower.split_whitespace().nth(1) {
                if let Ok(p) = p_str.parse::<u16>() {
                    port = p;
                }
            }
        } else if lower.starts_with("pubkeyauthentication ") {
            pubkey_authentication = lower.split_whitespace().nth(1).unwrap_or("yes").to_string();
        } else if lower.starts_with("maxauthtries ") {
            if let Some(t_str) = lower.split_whitespace().nth(1) {
                if let Ok(t) = t_str.parse::<u32>() {
                    max_auth_tries = t;
                }
            }
        }
    }

    // Calculate score & recommendations
    let mut score: i32 = 100;
    let mut recommendations = Vec::new();

    if permit_root_login == "yes" {
        score -= 25;
        recommendations.push(SecurityRecommendation {
            severity: "critical".into(),
            title: "Direct Root Password Login Enabled".into(),
            description: "Direct root login with password makes the server vulnerable to automated brute-force attacks. Recommend setting 'PermitRootLogin prohibit-password' or 'no'.".into(),
        });
    } else {
        recommendations.push(SecurityRecommendation {
            severity: "good".into(),
            title: "Root Login Protected".into(),
            description: "Direct root password logins are prohibited.".into(),
        });
    }

    if password_authentication == "yes" {
        score -= 20;
        recommendations.push(SecurityRecommendation {
            severity: "warning".into(),
            title: "Password Authentication Enabled".into(),
            description: "SSH allows password logins. Switching to cryptographic SSH Key Pairs prevents credential stuffing and dictionary attacks.".into(),
        });
    } else if password_authentication == "no" {
        recommendations.push(SecurityRecommendation {
            severity: "good".into(),
            title: "Key-Only SSH Authentication".into(),
            description: "SSH passwords are fully disabled in favor of cryptographic keys.".into(),
        });
    }

    if port == 22 {
        score -= 5;
        recommendations.push(SecurityRecommendation {
            severity: "info".into(),
            title: "Standard SSH Port 22".into(),
            description: "Port 22 is constantly probed by internet bots. Moving to a high-range custom port (e.g. 2222 or 5222) eliminates >95% of automated log noise.".into(),
        });
    } else {
        recommendations.push(SecurityRecommendation {
            severity: "good".into(),
            title: format!("Custom SSH Port ({})", port),
            description: "Standard port 22 is obscured, minimizing automated port scanner noise.".into(),
        });
    }

    if max_auth_tries > 6 {
        score -= 10;
        recommendations.push(SecurityRecommendation {
            severity: "warning".into(),
            title: "High Max Authentication Attempts".into(),
            description: format!("MaxAuthTries is set to {}. Recommend setting to 3 to terminate brute force sessions quickly.", max_auth_tries),
        });
    }

    SshHardeningAudit {
        permit_root_login,
        password_authentication,
        port,
        pubkey_authentication,
        max_auth_tries,
        score: score.max(0) as u32,
        recommendations,
    }
}

/// Retrieves complete server security audit: listening ports, UFW firewall, SSH hardening, and fail2ban stats.
#[tauri::command]
pub async fn get_security_audit(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<SecurityAuditReport> {
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    // Run combined query to minimize SSH round trips
    let script = r#"
echo "===PORTS==="
sudo ss -tulpn 2>/dev/null || ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null || true
echo "===UFW==="
sudo ufw status numbered 2>/dev/null || true
echo "===SSH==="
sudo sshd -T 2>/dev/null || cat /etc/ssh/sshd_config 2>/dev/null || true
echo "===FAIL2BAN==="
systemctl is-active fail2ban 2>/dev/null || echo "inactive"
sudo fail2ban-client status sshd 2>/dev/null | grep -i "Currently banned:" || true
echo "===UPDATES==="
apt list --upgradable 2>/dev/null | grep -c -i "security" || echo "0"
"#;

    let output = exec_ssh_command(&mut session, script).await?;

    let mut ports_section = String::new();
    let mut ufw_section = String::new();
    let mut ssh_section = String::new();
    let mut fail2ban_section = String::new();
    let mut updates_section = String::new();

    let mut current_sec = "";
    for line in output.lines() {
        if line.starts_with("===PORTS===") {
            current_sec = "ports";
        } else if line.starts_with("===UFW===") {
            current_sec = "ufw";
        } else if line.starts_with("===SSH===") {
            current_sec = "ssh";
        } else if line.starts_with("===FAIL2BAN===") {
            current_sec = "f2b";
        } else if line.starts_with("===UPDATES===") {
            current_sec = "updates";
        } else {
            match current_sec {
                "ports" => { ports_section.push_str(line); ports_section.push('\n'); }
                "ufw" => { ufw_section.push_str(line); ufw_section.push('\n'); }
                "ssh" => { ssh_section.push_str(line); ssh_section.push('\n'); }
                "f2b" => { fail2ban_section.push_str(line); fail2ban_section.push('\n'); }
                "updates" => { updates_section.push_str(line); updates_section.push('\n'); }
                _ => {}
            }
        }
    }

    let ports = parse_listening_ports(&ports_section);
    let ufw = parse_ufw_output(&ufw_section);
    let ssh = parse_ssh_config(&ssh_section);

    let fail2ban_active = fail2ban_section.contains("active") && !fail2ban_section.contains("inactive");
    let mut banned_ips_count = 0;
    if let Some(idx) = fail2ban_section.find("Currently banned:") {
        let rest = &fail2ban_section[idx + 17..];
        let num_str: String = rest.chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()).collect();
        banned_ips_count = num_str.parse::<u32>().unwrap_or(0);
    }

    let pending_security_updates = updates_section.trim().parse::<u32>().unwrap_or(0);
    let public_ports_count = ports.iter().filter(|p| p.is_public).count();
    let high_risk_ports_count = ports.iter().filter(|p| p.risk_level == "high").count();

    let overview = SecurityOverview {
        fail2ban_active,
        banned_ips_count,
        pending_security_updates,
        total_listening_ports: ports.len(),
        public_ports_count,
        high_risk_ports_count,
        firewall_active: ufw.is_active,
        ssh_score: ssh.score,
    };

    Ok(SecurityAuditReport {
        ports,
        ufw,
        ssh,
        overview,
    })
}

/// Enables or disables UFW firewall.
#[tauri::command]
pub async fn toggle_ufw(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    enable: bool,
) -> CommandResult<String> {
    let start_time = std::time::Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let cmd = if enable {
        "sudo ufw --force enable 2>&1"
    } else {
        "sudo ufw disable 2>&1"
    };

    let output = exec_ssh_command(&mut session, cmd).await?;

    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: if enable { "ufw_enable".into() } else { "ufw_disable".into() },
            target: Some("ufw".into()),
            status: "success".into(),
            detail: Some(output.clone()),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    Ok(output)
}

/// Adds a UFW firewall rule (e.g. allow 443/tcp, deny 5432).
#[tauri::command]
pub async fn add_ufw_rule(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    port: String,
    allow: bool,
    proto: Option<String>,
) -> CommandResult<String> {
    let start_time = std::time::Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let port_trimmed = port.trim();
    if port_trimmed.is_empty() || !port_trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == ':') {
        return Err(CommandError::Validation("Invalid port format. Must be an alphanumeric service or port range (e.g. '80', '8080:8090').".into()));
    }

    let proto_suffix = match proto.as_deref() {
        Some("tcp") => "/tcp",
        Some("udp") => "/udp",
        Some("") | None => "",
        _ => return Err(CommandError::Validation("Invalid protocol. Must be 'tcp' or 'udp'.".into())),
    };

    let action_str = if allow { "allow" } else { "deny" };
    let cmd = format!("sudo ufw {} {}{} 2>&1", action_str, port_trimmed, proto_suffix);
    let output = exec_ssh_command(&mut session, &cmd).await?;

    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: "ufw_add_rule".into(),
            target: Some(format!("{} {}{}", action_str, port, proto_suffix)),
            status: "success".into(),
            detail: Some(output.clone()),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    Ok(output)
}

/// Deletes a numbered UFW firewall rule.
#[tauri::command]
pub async fn delete_ufw_rule(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    rule_number: u32,
) -> CommandResult<String> {
    let start_time = std::time::Instant::now();
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let cmd = format!("sudo ufw --force delete {} 2>&1", rule_number);
    let output = exec_ssh_command(&mut session, &cmd).await?;

    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: "ufw_delete_rule".into(),
            target: Some(format!("rule #{}", rule_number)),
            status: "success".into(),
            detail: Some(output.clone()),
            duration_ms: Some(start_time.elapsed().as_millis() as i64),
        });
    }

    Ok(output)
}
