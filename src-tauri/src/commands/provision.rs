use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::db::{log_activity, ActivityEntry, actions};

lazy_static::lazy_static! {
    static ref ACTIVE_PROVISIONS: Arc<Mutex<HashMap<String, mpsc::Sender<()>>>> = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewServerDetails {
    pub name: String,
    pub hostname: String,
    pub ssh_port: u16,
    pub username: String,
    pub auth_method: String, // "password" | "private_key"
    pub secret: String,
    pub master_password_if_needed: Option<String>,
    pub environment: String, // "production" | "staging" | "dev"
    pub description: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvisionPlan {
    pub server_id: Option<String>,
    pub new_server: Option<NewServerDetails>,

    // User & Hardening
    pub create_deploy_user: bool,
    pub deploy_username: String,
    pub deploy_public_key: Option<String>,
    pub disable_root_login: bool,
    pub disable_password_auth: bool,
    pub server_hostname: Option<String>,
    pub timezone: Option<String>,
    pub enable_unattended_upgrades: bool,

    // Swap Memory Optimizer (Zero Docker)
    pub swap_size_gb: u32,
    pub swappiness: u32,

    // Firewall & Security Suite
    pub enable_ufw: bool,
    pub ufw_allow_ports: Vec<String>,
    pub enable_fail2ban: bool,

    // Runtimes & Essentials
    pub install_essentials: bool,
    pub install_node: bool,
    pub node_version: String, // "20" | "22"
    pub install_pm2: bool,
    pub install_bun: bool,
    pub install_python: bool,

    // Web & SSL
    pub install_nginx: bool,
    pub install_certbot: bool,

    // Native Database & Cache (Zero Docker)
    pub database_engine: String, // "none" | "postgresql" | "mariadb" | "mysql"
    pub install_redis: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvisionStep {
    pub id: String,
    pub label: String,
    pub description: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvisionSessionInfo {
    pub session_id: String,
    pub server_id: String,
    pub server_name: String,
    pub steps: Vec<ProvisionStep>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProvisionStepEvent {
    pub session_id: String,
    pub step_index: usize,
    pub step_id: String,
    pub label: String,
    pub status: String, // "running" | "success" | "failed" | "skipped"
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProvisionLogEvent {
    pub session_id: String,
    pub step_index: usize,
    pub text: String,
    pub is_stderr: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProvisionCompleteEvent {
    pub session_id: String,
    pub server_id: String,
    pub status: String, // "success" | "failed" | "aborted"
    pub total_duration_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvisionRecord {
    pub id: String,
    pub server_id: String,
    pub server_name: Option<String>,
    pub status: String,
    pub logs: String,
    pub started_at: String,
    pub completed_at: Option<String>,
}

fn build_provision_steps(plan: &ProvisionPlan) -> Vec<ProvisionStep> {
    let mut steps = Vec::new();

    // 1. OS Pre-flight
    steps.push(ProvisionStep {
        id: "os_preflight".into(),
        label: "OS Pre-Flight & Health Audit".into(),
        description: "Verify OS distribution, root permissions, CPU architecture, and storage capacity.".into(),
        command: r#"echo "=== Target System Inspection ==="
uname -a
if [ -f /etc/os-release ]; then
  cat /etc/os-release | grep -E "^(NAME|VERSION|ID)="
fi
echo "Current user: $(whoami)"
df -h /
free -m
echo "[OK] Pre-flight inspection completed."#
            .into(),
    });

    // 2. System updates & essentials
    if plan.install_essentials {
        steps.push(ProvisionStep {
            id: "system_update".into(),
            label: "Update Repositories & Base Tools".into(),
            description: "Run apt update, install core dependencies (curl, wget, git, build-essential, htop, jq).".into(),
            command: r#"export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends curl wget git build-essential htop jq software-properties-common ca-certificates gnupg ufw
echo "[OK] System updated and base tools installed."#
                .into(),
        });
    }

    // 3. Timezone & Hostname
    if plan.timezone.is_some() || plan.server_hostname.is_some() {
        let mut tz_cmd = String::new();
        if let Some(ref tz) = plan.timezone {
            let clean_tz = tz.trim();
            if !clean_tz.is_empty() {
                tz_cmd.push_str(&format!("timedatectl set-timezone \"{}\" || true\n", clean_tz));
            }
        }
        if let Some(ref hn) = plan.server_hostname {
            let clean_hn = hn.trim();
            if !clean_hn.is_empty() {
                tz_cmd.push_str(&format!("hostnamectl set-hostname \"{}\" || true\n", clean_hn));
                tz_cmd.push_str(&format!("echo \"127.0.1.1 {}\" >> /etc/hosts || true\n", clean_hn));
            }
        }
        tz_cmd.push_str("timedatectl status || true\necho \"[OK] Hostname & Timezone configured.\"");

        steps.push(ProvisionStep {
            id: "system_identity".into(),
            label: "Configure System Identity & Time".into(),
            description: "Apply server hostname, hosts map, and synchronized timezone.".into(),
            command: tz_cmd,
        });
    }

    // 4. Unattended Upgrades
    if plan.enable_unattended_upgrades {
        steps.push(ProvisionStep {
            id: "unattended_upgrades".into(),
            label: "Automatic Security Upgrades".into(),
            description: "Install and enable unattended-upgrades to automatically patch CVEs.".into(),
            command: r#"export DEBIAN_FRONTEND=noninteractive
apt-get install -y unattended-upgrades
echo 'APT::Periodic::Update-Package-Lists "1";' > /etc/apt/apt.conf.d/20auto-upgrades
echo 'APT::Periodic::Unattended-Upgrade "1";' >> /etc/apt/apt.conf.d/20auto-upgrades
systemctl enable unattended-upgrades || true
systemctl restart unattended-upgrades || true
echo "[OK] Unattended upgrades configured."#
                .into(),
        });
    }

    // 5. User Creation & SSH Key Provisioning
    if plan.create_deploy_user {
        let username = plan.deploy_username.trim();
        let safe_user = if username.is_empty() { "deploy" } else { username };

        let pubkey_setup = if let Some(ref key) = plan.deploy_public_key {
            let clean_key = key.trim();
            if !clean_key.is_empty() {
                format!(r#"echo "{}" >> /home/{}/.ssh/authorized_keys"#, clean_key, safe_user)
            } else {
                format!(r#"if [ -f /root/.ssh/authorized_keys ]; then cp /root/.ssh/authorized_keys /home/{}/.ssh/authorized_keys; fi"#, safe_user)
            }
        } else {
            format!(r#"if [ -f /root/.ssh/authorized_keys ]; then cp /root/.ssh/authorized_keys /home/{}/.ssh/authorized_keys; fi"#, safe_user)
        };

        let user_cmd = format!(
            r#"if ! id -u {0} >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" {0}
fi
usermod -aG sudo {0} || usermod -aG wheel {0} || true
mkdir -p /etc/sudoers.d
echo "{0} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/99-scc-{0}
chmod 0440 /etc/sudoers.d/99-scc-{0}
mkdir -p /home/{0}/.ssh
chmod 700 /home/{0}/.ssh
{1}
if [ -f /home/{0}/.ssh/authorized_keys ]; then
  chmod 600 /home/{0}/.ssh/authorized_keys
fi
chown -R {0}:{0} /home/{0}/.ssh
echo "[OK] User '{0}' created with passwordless sudo and authorized SSH key.""#,
            safe_user, pubkey_setup
        );

        steps.push(ProvisionStep {
            id: "deploy_user".into(),
            label: format!("Create Non-Root User ('{}')", safe_user),
            description: "Provision dedicated sudo user, configure passwordless sudo, and register authorized SSH keys.".into(),
            command: user_cmd,
        });
    }

    // 6. Swap Memory Optimizer
    if plan.swap_size_gb > 0 {
        let gb = plan.swap_size_gb;
        let swappiness = plan.swappiness;
        let swap_cmd = format!(
            r#"if [ ! -f /swapfile ]; then
  echo "Allocating {0}GB swapfile..."
  fallocate -l {0}G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count={1}
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  sysctl vm.swappiness={2}
  if ! grep -q 'vm.swappiness' /etc/sysctl.conf; then
    echo 'vm.swappiness={2}' >> /etc/sysctl.conf
  fi
  echo "[OK] Swap file created successfully ({0}GB)."
else
  echo "Swap file already exists, skipping creation."
fi
free -h"#,
            gb,
            gb * 1024,
            swappiness
        );

        steps.push(ProvisionStep {
            id: "swap_memory".into(),
            label: format!("Swap Memory Protection ({} GB)", gb),
            description: "Create /swapfile and set kernel swappiness to prevent out-of-memory crashes on resource-intensive builds.".into(),
            command: swap_cmd,
        });
    }

    // 7. Firewall & Security (Zero Docker!)
    if plan.enable_ufw || plan.enable_fail2ban {
        let mut sec_cmd = String::new();
        if plan.enable_ufw {
            sec_cmd.push_str(
                r#"export DEBIAN_FRONTEND=noninteractive
apt-get install -y ufw
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
"#,
            );
            for port in &plan.ufw_allow_ports {
                let trimmed = port.trim();
                if !trimmed.is_empty() {
                    sec_cmd.push_str(&format!("ufw allow {}\n", trimmed));
                }
            }
            sec_cmd.push_str("ufw --force enable\nufw status verbose\n");
        }

        if plan.enable_fail2ban {
            sec_cmd.push_str(
                r#"export DEBIAN_FRONTEND=noninteractive
apt-get install -y fail2ban
systemctl enable --now fail2ban || true
echo "[OK] Fail2ban enabled and monitoring SSH jail."
"#,
            );
        }
        sec_cmd.push_str("echo \"[OK] Firewall and intrusion defense configured.\"");

        steps.push(ProvisionStep {
            id: "firewall_security".into(),
            label: "Firewall & Intrusion Defense (UFW + Fail2ban)".into(),
            description: "Configure native Linux UFW firewall rules and activate fail2ban SSH brute-force protection.".into(),
            command: sec_cmd,
        });
    }

    // 8. SSH Hardening
    if plan.disable_root_login || plan.disable_password_auth {
        let mut ssh_harden = r#"cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup.$(date +%s)
"#
        .to_string();

        if plan.disable_root_login {
            ssh_harden.push_str(
                r#"sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
if [ -d /etc/ssh/sshd_config.d ]; then
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config.d/*.conf 2>/dev/null || true
fi
"#,
            );
        }

        if plan.disable_password_auth {
            ssh_harden.push_str(
                r#"sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
if [ -d /etc/ssh/sshd_config.d ]; then
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config.d/*.conf 2>/dev/null || true
fi
"#,
            );
        }

        ssh_harden.push_str(
            r#"if sshd -t; then
  systemctl reload ssh || systemctl reload sshd || service ssh reload || true
  echo "[OK] OpenSSH configuration validated and reloaded safely."
else
  echo "[WARN] sshd configuration test failed; restoring original backup."
  cp /etc/ssh/sshd_config.backup.* /etc/ssh/sshd_config
fi"#,
        );

        steps.push(ProvisionStep {
            id: "ssh_hardening".into(),
            label: "OpenSSH Daemon Hardening".into(),
            description: "Apply strict SSH policies (disable direct root login or password authentication) with fallback backup.".into(),
            command: ssh_harden,
        });
    }

    // 9. Runtimes: Node.js, PM2, Bun, Python
    if plan.install_node || plan.install_pm2 || plan.install_bun || plan.install_python {
        let mut runtimes_cmd = String::new();

        if plan.install_node {
            let ver = if plan.node_version == "22" { "22" } else { "20" };
            runtimes_cmd.push_str(&format!(
                r#"export DEBIAN_FRONTEND=noninteractive
curl -fsSL https://deb.nodesource.com/setup_{0}.x | bash -
apt-get install -y nodejs
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"
"#,
                ver
            ));
        }

        if plan.install_pm2 {
            runtimes_cmd.push_str(
                r#"npm install -g pm2
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root || true
pm2 -v
echo "[OK] PM2 installed and systemd startup registered."
"#,
            );
        }

        if plan.install_bun {
            runtimes_cmd.push_str(
                r#"curl -fsSL https://bun.sh/install | bash
if [ -f /root/.bun/bin/bun ]; then
  ln -sf /root/.bun/bin/bun /usr/local/bin/bun
  echo "Bun version: $(/usr/local/bin/bun --version)"
fi
"#,
            );
        }

        if plan.install_python {
            runtimes_cmd.push_str(
                r#"export DEBIAN_FRONTEND=noninteractive
apt-get install -y python3 python3-pip python3-venv
echo "Python version: $(python3 --version)"
"#,
            );
        }

        steps.push(ProvisionStep {
            id: "app_runtimes".into(),
            label: "Application Runtimes (Node, PM2, Bun)".into(),
            description: "Install runtime engines and process managers natively on the host.".into(),
            command: runtimes_cmd,
        });
    }

    // 10. Web Server & SSL: Nginx & Certbot
    if plan.install_nginx || plan.install_certbot {
        let mut web_cmd = String::new();
        if plan.install_nginx {
            web_cmd.push_str(
                r#"export DEBIAN_FRONTEND=noninteractive
apt-get install -y nginx
systemctl enable --now nginx
nginx -v
"#,
            );
        }

        if plan.install_certbot {
            web_cmd.push_str(
                r#"export DEBIAN_FRONTEND=noninteractive
apt-get install -y certbot python3-certbot-nginx
certbot --version
"#,
            );
        }

        web_cmd.push_str("echo \"[OK] Nginx and Certbot SSL stack initialized.\"");

        steps.push(ProvisionStep {
            id: "web_server_ssl".into(),
            label: "Nginx Web Server & Certbot SSL".into(),
            description: "Install and enable Nginx HTTP server and Let's Encrypt automated ACME client.".into(),
            command: web_cmd,
        });
    }

    // 11. Native Linux Databases (Zero Docker!)
    if plan.database_engine != "none" || plan.install_redis {
        let mut db_cmd = String::new();

        match plan.database_engine.as_str() {
            "postgresql" => {
                db_cmd.push_str(
                    r#"export DEBIAN_FRONTEND=noninteractive
apt-get install -y postgresql postgresql-contrib
systemctl enable --now postgresql
echo "PostgreSQL Status: $(systemctl is-active postgresql)"
"#,
                );
            }
            "mariadb" => {
                db_cmd.push_str(
                    r#"export DEBIAN_FRONTEND=noninteractive
apt-get install -y mariadb-server
systemctl enable --now mariadb
echo "MariaDB Status: $(systemctl is-active mariadb)"
"#,
                );
            }
            "mysql" => {
                db_cmd.push_str(
                    r#"export DEBIAN_FRONTEND=noninteractive
apt-get install -y mysql-server
systemctl enable --now mysql
echo "MySQL Status: $(systemctl is-active mysql)"
"#,
                );
            }
            _ => {}
        }

        if plan.install_redis {
            db_cmd.push_str(
                r#"export DEBIAN_FRONTEND=noninteractive
apt-get install -y redis-server
systemctl enable --now redis-server
echo "Redis Status: $(systemctl is-active redis-server)"
"#,
            );
        }

        steps.push(ProvisionStep {
            id: "native_database".into(),
            label: "Native Database & Cache Engine".into(),
            description: "Install and start native systemd-managed database instances (zero Docker overhead).".into(),
            command: db_cmd,
        });
    }

    // 12. Final Health Audit & Completion
    steps.push(ProvisionStep {
        id: "final_audit".into(),
        label: "Final Verification & Infrastructure Cockpit Ready".into(),
        description: "Verify all installed daemons are active and output system status summary.".into(),
        command: r#"echo "=========================================================="
echo "          SERVER COMMAND CENTER - BOOTSTRAP AUDIT"
echo "=========================================================="
echo "System Uptime: $(uptime -p 2>/dev/null || uptime)"
echo "Memory Available:"
free -h
echo "Active Storage:"
df -h /
echo "Service Daemons:"
systemctl is-active nginx 2>/dev/null && echo "  - Nginx: Active" || true
systemctl is-active fail2ban 2>/dev/null && echo "  - Fail2ban: Active" || true
systemctl is-active postgresql 2>/dev/null && echo "  - PostgreSQL: Active" || true
systemctl is-active mariadb 2>/dev/null && echo "  - MariaDB: Active" || true
systemctl is-active mysql 2>/dev/null && echo "  - MySQL: Active" || true
systemctl is-active redis-server 2>/dev/null && echo "  - Redis: Active" || true
which pm2 >/dev/null 2>&1 && echo "  - PM2: $(pm2 -v)" || true
which node >/dev/null 2>&1 && echo "  - Node: $(node -v)" || true
echo "=========================================================="
echo "[SUCCESS] Server is fully provisioned and ready for production orchestration!""#
            .into(),
    });

    steps
}

/// Generates a unified, standalone Bash bootstrap script corresponding to the given plan.
#[tauri::command]
pub async fn generate_provision_script(plan: ProvisionPlan) -> CommandResult<String> {
    let steps = build_provision_steps(&plan);
    let mut script = String::new();

    script.push_str(
        r#"#!/usr/bin/env bash
# ==============================================================================
# Server Command Center — Production Server Bootstrap Script
# Powered by Falah Tech (falah-tech.com)
# Native Linux Administration (Zero Docker Overhead)
# ==============================================================================
set -eo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "Starting Server Command Center bootstrap sequence..."

"#,
    );

    for (idx, step) in steps.iter().enumerate() {
        script.push_str(&format!(
            "# ------------------------------------------------------------------------------\n# Step {}: {}\n# ------------------------------------------------------------------------------\necho \"\n>>> [{}/{}] {}\"\n{}\n\n",
            idx + 1,
            step.label,
            idx + 1,
            steps.len(),
            step.label,
            step.command
        ));
    }

    script.push_str(
        r#"echo "
==============================================================================
Server Command Center: Provisioning completed successfully!
==============================================================================
"
"#,
    );

    Ok(script)
}

/// Initiates real-time provisioning for an existing or newly registered server.
#[tauri::command]
pub async fn start_server_provisioning(
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
    plan: ProvisionPlan,
) -> CommandResult<ProvisionSessionInfo> {
    // 1. Resolve or Create Server
    let (server_id, server_name) = if let Some(ref existing_id) = plan.server_id {
        let conn = state.db.lock().map_err(|_| CommandError::Internal("Database lock poisoned".into()))?;
        let name: String = conn
            .query_row("SELECT name FROM servers WHERE id = ?1", [existing_id], |row| row.get(0))
            .map_err(|_| CommandError::NotFound(format!("Server {} not found", existing_id)))?;
        (existing_id.clone(), name)
    } else if let Some(ref new_s) = plan.new_server {
        if new_s.name.trim().is_empty() {
            return Err(CommandError::Validation("Server name cannot be empty".into()));
        }
        if new_s.hostname.trim().is_empty() {
            return Err(CommandError::Validation("Hostname/IP cannot be empty".into()));
        }

        let sid = Uuid::new_v4().to_string();
        {
            let conn = state.db.lock().map_err(|_| CommandError::Internal("Database lock poisoned".into()))?;
            conn.execute(
                "INSERT INTO servers (id, name, hostname, ssh_port, username, os, provider, environment, description, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'), datetime('now'))",
                rusqlite::params![
                    &sid,
                    &new_s.name,
                    &new_s.hostname,
                    new_s.ssh_port,
                    &new_s.username,
                    "linux",
                    "custom",
                    &new_s.environment,
                    new_s.description.as_deref().unwrap_or("Provisioned via Server Command Center")
                ],
            )?;

            for tag in &new_s.tags {
                let _ = conn.execute("INSERT INTO server_tags (server_id, tag) VALUES (?1, ?2)", [&sid, tag]);
            }
        }

        // Store credential
        let cred_id = Uuid::new_v4().to_string();
        let keychain_ref = format!("scc:credential:{}", cred_id);
        match new_s.auth_method.as_str() {
            "password" | "ssh_agent" => {
                crate::secrets::keychain::store_secret(&keychain_ref, &new_s.secret)?;
            }
            "private_key" | "password_key" => {
                let password = new_s.master_password_if_needed.as_deref().ok_or_else(|| {
                    CommandError::Validation("Master password required to unlock Vault for storing SSH key".into())
                })?;
                let app_dir = app_handle.path().app_data_dir().expect("App data dir not found");
                let vault_handle = crate::secrets::vault::unlock(password, &app_dir)?;
                crate::secrets::vault::store_entry(&vault_handle, &keychain_ref, &new_s.secret)?;
            }
            _ => return Err(CommandError::Validation("Unsupported authentication method".into())),
        }

        {
            let conn = state.db.lock().map_err(|_| CommandError::Internal("Database lock poisoned".into()))?;
            conn.execute(
                "INSERT INTO credentials (id, server_id, auth_method, keychain_ref, created_at)
                 VALUES (?1, ?2, ?3, ?4, datetime('now'))",
                rusqlite::params![&cred_id, &sid, &new_s.auth_method, &keychain_ref],
            )?;
        }

        (sid, new_s.name.clone())
    } else {
        return Err(CommandError::Validation("Either server_id or new_server must be provided".into()));
    };

    let steps = build_provision_steps(&plan);
    let session_id = Uuid::new_v4().to_string();
    let (cancel_tx, mut cancel_rx) = mpsc::channel::<()>(1);

    {
        let mut map = ACTIVE_PROVISIONS.lock().await;
        map.insert(session_id.clone(), cancel_tx);
    }

    // Save initial record to server_provisioning_logs
    let plan_json = serde_json::to_string(&plan).unwrap_or_default();
    {
        let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock poisoned".into()))?;
        let _ = conn.execute(
            "INSERT INTO server_provisioning_logs (id, server_id, plan_json, status, logs, started_at)
             VALUES (?1, ?2, ?3, 'running', '', datetime('now'))",
            rusqlite::params![&session_id, &server_id, &plan_json],
        );
    }

    let session_info = ProvisionSessionInfo {
        session_id: session_id.clone(),
        server_id: server_id.clone(),
        server_name: server_name.clone(),
        steps: steps.clone(),
    };

    // Spawn async background runner
    let session_id_clone = session_id.clone();
    let server_id_clone = server_id.clone();
    let app_handle_clone = app_handle.clone();
    let db_clone = state.db.clone();
    let session_manager_clone = state.session_manager.clone();
    let total_start = Instant::now();

    tauri::async_runtime::spawn(async move {
        let mut overall_success = true;
        let mut overall_logs = String::new();
        let mut error_msg: Option<String> = None;

        // Acquire SSH session
        let session_result = session_manager_clone
            .get_or_connect(server_id_clone.clone(), db_clone.clone(), app_handle_clone.clone())
            .await;

        match session_result {
            Err(e) => {
                overall_success = false;
                let err_str = format!("Failed to establish SSH connection to {}: {}", server_name, e);
                overall_logs.push_str(&format!("[FATAL] {}\n", err_str));
                error_msg = Some(err_str);
            }
            Ok(session_arc) => {
                let session = session_arc.lock().await;

                for (idx, step) in steps.iter().enumerate() {
                    // Check if cancelled
                    if cancel_rx.try_recv().is_ok() {
                        overall_success = false;
                        error_msg = Some("Provisioning aborted by user".into());
                        overall_logs.push_str("\n[ABORTED] Provisioning aborted by operator.\n");
                        break;
                    }

                    let step_start = Instant::now();

                    // Emit step running event
                    let _ = app_handle_clone.emit(
                        &format!("provision://step:{}", session_id_clone),
                        ProvisionStepEvent {
                            session_id: session_id_clone.clone(),
                            step_index: idx,
                            step_id: step.id.clone(),
                            label: step.label.clone(),
                            status: "running".into(),
                            duration_ms: 0,
                            exit_code: None,
                        },
                    );

                    let log_header = format!("\n==================================================\n>>> [{}/{}] {}\n==================================================\n", idx + 1, steps.len(), step.label);
                    overall_logs.push_str(&log_header);
                    let _ = app_handle_clone.emit(
                        &format!("provision://log:{}", session_id_clone),
                        ProvisionLogEvent {
                            session_id: session_id_clone.clone(),
                            step_index: idx,
                            text: log_header,
                            is_stderr: false,
                        },
                    );

                    // Open SSH channel for this step
                    let channel_res = session.channel_open_session().await;
                    let mut step_success = false;
                    let mut exit_code: Option<i32> = None;

                    if let Ok(mut channel) = channel_res {
                        if channel.exec(true, step.command.as_str()).await.is_ok() {
                            loop {
                                tokio::select! {
                                    _ = cancel_rx.recv() => {
                                        overall_success = false;
                                        error_msg = Some("Provisioning aborted by user".into());
                                        break;
                                    }
                                    msg_opt = channel.wait() => {
                                        match msg_opt {
                                            Some(ChannelMsg::Data { ref data }) => {
                                                let text = String::from_utf8_lossy(data).into_owned();
                                                overall_logs.push_str(&text);
                                                let _ = app_handle_clone.emit(
                                                    &format!("provision://log:{}", session_id_clone),
                                                    ProvisionLogEvent {
                                                        session_id: session_id_clone.clone(),
                                                        step_index: idx,
                                                        text,
                                                        is_stderr: false,
                                                    },
                                                );
                                            }
                                            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                                                let text = String::from_utf8_lossy(data).into_owned();
                                                overall_logs.push_str(&text);
                                                let _ = app_handle_clone.emit(
                                                    &format!("provision://log:{}", session_id_clone),
                                                    ProvisionLogEvent {
                                                        session_id: session_id_clone.clone(),
                                                        step_index: idx,
                                                        text,
                                                        is_stderr: true,
                                                    },
                                                );
                                            }
                                            Some(ChannelMsg::ExitStatus { exit_status }) => {
                                                exit_code = Some(exit_status as i32);
                                                step_success = exit_status == 0;
                                            }
                                            Some(ChannelMsg::Eof) => {}
                                            Some(ChannelMsg::Close) | None => {
                                                break;
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                            }
                            let _ = channel.close().await;

                            if exit_code.is_none() {
                                exit_code = Some(0);
                                step_success = true;
                            }
                        } else {
                            let err = "Failed to execute step on remote SSH channel.\n";
                            overall_logs.push_str(err);
                            let _ = app_handle_clone.emit(
                                &format!("provision://log:{}", session_id_clone),
                                ProvisionLogEvent {
                                    session_id: session_id_clone.clone(),
                                    step_index: idx,
                                    text: err.into(),
                                    is_stderr: true,
                                },
                            );
                        }
                    } else {
                        let err = "Failed to allocate remote SSH channel.\n";
                        overall_logs.push_str(err);
                        let _ = app_handle_clone.emit(
                            &format!("provision://log:{}", session_id_clone),
                            ProvisionLogEvent {
                                session_id: session_id_clone.clone(),
                                step_index: idx,
                                text: err.into(),
                                is_stderr: true,
                            },
                        );
                    }

                    let step_duration = step_start.elapsed().as_millis() as u64;
                    let step_status = if step_success { "success" } else { "failed" };

                    let _ = app_handle_clone.emit(
                        &format!("provision://step:{}", session_id_clone),
                        ProvisionStepEvent {
                            session_id: session_id_clone.clone(),
                            step_index: idx,
                            step_id: step.id.clone(),
                            label: step.label.clone(),
                            status: step_status.into(),
                            duration_ms: step_duration,
                            exit_code,
                        },
                    );

                    if !step_success {
                        overall_success = false;
                        error_msg = Some(format!("Step '{}' failed with exit status {:?}", step.label, exit_code));
                        break;
                    }
                }
            }
        }

        // Clean up active map
        {
            let mut map = ACTIVE_PROVISIONS.lock().await;
            map.remove(&session_id_clone);
        }

        let total_duration = total_start.elapsed().as_millis() as u64;
        let final_status = if overall_success {
            "success"
        } else if error_msg.as_deref() == Some("Provisioning aborted by user") {
            "aborted"
        } else {
            "failed"
        };

        // Update database record & write activity log
        if let Ok(conn) = db_clone.lock() {
            let _ = conn.execute(
                "UPDATE server_provisioning_logs SET status = ?1, logs = ?2, completed_at = datetime('now') WHERE id = ?3",
                rusqlite::params![final_status, &overall_logs, &session_id_clone],
            );

            log_activity(
                &conn,
                ActivityEntry {
                    server_id: Some(server_id_clone.clone()),
                    action: actions::PROVISION_SERVER.to_string(),
                    target: Some("server_provisioning".to_string()),
                    status: final_status.to_string(),
                    detail: error_msg.clone().or_else(|| Some(format!("Provisioned in {}ms", total_duration))),
                    duration_ms: Some(total_duration as i64),
                },
            );
        }

        // Emit final completion event
        let _ = app_handle_clone.emit(
            &format!("provision://complete:{}", session_id_clone),
            ProvisionCompleteEvent {
                session_id: session_id_clone,
                server_id: server_id_clone,
                status: final_status.to_string(),
                total_duration_ms: total_duration,
                error: error_msg,
            },
        );
    });

    Ok(session_info)
}

/// Cancels an actively running provisioning session.
#[tauri::command]
pub async fn cancel_server_provisioning(session_id: String) -> CommandResult<()> {
    let mut map = ACTIVE_PROVISIONS.lock().await;
    if let Some(tx) = map.remove(&session_id) {
        let _ = tx.send(()).await;
        Ok(())
    } else {
        Err(CommandError::NotFound(format!("No active provisioning session with ID {}", session_id)))
    }
}

/// Fetches historical provisioning logs for a specific server or the entire fleet.
#[tauri::command]
pub async fn get_provision_history(
    state: tauri::State<'_, AppState>,
    server_id: Option<String>,
) -> CommandResult<Vec<ProvisionRecord>> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("Database lock poisoned".into()))?;

    let mut records = Vec::new();
    if let Some(sid) = server_id {
        let mut stmt = conn.prepare(
            "SELECT l.id, l.server_id, s.name, l.status, l.logs, l.started_at, l.completed_at
             FROM server_provisioning_logs l
             LEFT JOIN servers s ON l.server_id = s.id
             WHERE l.server_id = ?1
             ORDER BY l.started_at DESC LIMIT 50",
        )?;
        let rows = stmt.query_map([&sid], |row| {
            Ok(ProvisionRecord {
                id: row.get(0)?,
                server_id: row.get(1)?,
                server_name: row.get(2)?,
                status: row.get(3)?,
                logs: row.get(4)?,
                started_at: row.get(5)?,
                completed_at: row.get(6)?,
            })
        })?;
        for r in rows.flatten() {
            records.push(r);
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT l.id, l.server_id, s.name, l.status, l.logs, l.started_at, l.completed_at
             FROM server_provisioning_logs l
             LEFT JOIN servers s ON l.server_id = s.id
             ORDER BY l.started_at DESC LIMIT 50",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ProvisionRecord {
                id: row.get(0)?,
                server_id: row.get(1)?,
                server_name: row.get(2)?,
                status: row.get(3)?,
                logs: row.get(4)?,
                started_at: row.get(5)?,
                completed_at: row.get(6)?,
            })
        })?;
        for r in rows.flatten() {
            records.push(r);
        }
    }

    Ok(records)
}
