# 🚀 Release Notes - Server Command Center v1.3.1
*Desktop Server Administration & Cockpit Suite — Powered by Falah Tech (falah-tech.com)*

---

## 🚀 Feature 1: Fresh Server Provisioning & Setup Wizard (Bootstrap Engine)

Server Command Center **v1.3.1** introduces a comprehensive, production-grade **Fresh Server Provisioning Engine**. Transform raw, bare-metal or cloud VPS instances (Ubuntu/Debian) into hardened, production-orchestrated servers with native systemd services, UFW firewall, fail2ban intrusion defense, swap memory protection, and app runtimes — all with zero Docker overhead.

---

### ✨ What's New in v1.3.1

#### 1. 🎯 Flexible Destination Modes
- **New Fresh VPS Mode**: Provision brand new servers right from their initial IP, SSH port, and root credentials (password or private key stored in Vault). Server Command Center automatically registers the server into your infrastructure fleet upon launch.
- **Existing Server Mode**: Re-bootstrap, harden, or configure modular packages on existing servers already in your fleet.

#### 2. ⚡ Curated 1-Click Architecture Presets
- **Node & PM2 Production Stack**:
  - Sudo deploy user with authorized SSH key.
  - 2GB Swapfile allocation & kernel swappiness tuning.
  - UFW Firewall (SSH 22, HTTP 80, HTTPS 443) & Fail2ban SSH jail.
  - Node.js LTS (v20 / v22 via NodeSource) & global PM2 with systemd startup.
  - Nginx reverse proxy & automated Certbot SSL client.
- **Full-Stack with Native PostgreSQL & Redis**:
  - Everything in the Node stack plus native PostgreSQL & Redis server (Zero Docker overhead).
- **Full-Stack with Native MariaDB/MySQL & Redis**:
  - Everything in the Node stack plus native MariaDB server & Redis server.
- **Hardened Base VPS**:
  - Dedicated deploy user, swap memory protection, UFW firewall (port 22 only), Fail2ban intrusion defense, and unattended security updates.
- **Custom Blueprint**:
  - Full granular control over every individual package, swap size, user credentials, and daemon.

#### 3. 🛡️ System Hardening & Memory Protection
- **Dedicated Sudo Deploy User**: Automatically provisions a non-root user (default `deploy`) with passwordless sudo permissions and installs your authorized SSH key (or copies root's existing authorized keys).
- **Swap Memory Protection**: Prevents build crashes and out-of-memory errors on low-RAM instances (1GB / 2GB VPSs) with configurable 1GB, 2GB, 4GB, or 8GB swap allocations and persistence in `/etc/fstab`.
- **UFW Firewall & Fail2ban Defense**: Default-deny incoming firewall policy with automatic port exceptions and active fail2ban SSH brute-force jail monitoring.
- **OpenSSH Daemon Hardening**: Optional 1-click toggles to disable root login (`PermitRootLogin no`) and password authentication (`PasswordAuthentication no`) with automated syntax testing (`sshd -t`) and backup fallback.
- **Automated Security Upgrades**: Configures `unattended-upgrades` to automatically patch security vulnerabilities and CVEs in the background.

#### 4. 📜 Standalone Bash Bootstrap Script Generator
- **Audit & Export**: 1-click "Preview Script" tab displays the exact generated POSIX/Bash bootstrap script.
- **Copy & Download**: Copy script to clipboard or download as `.sh` for cloud-init or bare-metal automation outside the app.

#### 5. 💻 Real-Time Execution Pipeline & Streaming Terminal
- **Interactive Step Pipeline**: Visual pipeline display showing real-time execution status (Pending, Running with animated spinner, Success with duration, Failed with exit code).
- **Live SSH Terminal Stream**: Line-by-line streaming of stdout and stderr directly from the remote SSH session over Tauri events.
- **Auto-Scroll & Log Export**: Terminal viewer with auto-scroll and 1-click log copying.
- **Abortion Control**: Operator can safely cancel running provisioning jobs on demand.
- **1-Click Cockpit Launch**: Seamless navigation directly to the provisioned server's cockpit upon completion.

#### 6. 🗄️ SQLite Provisioning Audit Archive
- **Persistent History**: All provisioning executions, configurations, and terminal logs are permanently archived in the SQLite database (`server_provisioning_logs`).
- **Interactive History Modal**: Inspect past bootstrap executions and copy full session logs at any time.

---

### 📦 Installation & Artifacts

| Platform | Installer / Package | Details |
| :--- | :--- | :--- |
| **Windows** | `Server Command Center_1.3.1_x64-setup.exe` / `.msi` | Signed NSIS installer & MSI package |
| **macOS** | `Server Command Center_1.3.1_universal.dmg` | Universal binary (Apple Silicon & Intel) |
| **Linux** | `server-command-center_1.3.1_amd64.deb` / `.AppImage` | Debian / Ubuntu & Standalone AppImage |

*Server Command Center by Falah Tech — Professional Desktop Infrastructure Command.*

