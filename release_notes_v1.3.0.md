# 🚀 Release Notes - Server Command Center v1.3.0
*Desktop Server Administration & Cockpit Suite — Powered by Falah Tech (falah-tech.com)*

---

## 🚨 Feature 3: SSL Certificate Expiry Watchdog & Renewal Cockpit

Server Command Center **v1.3.0** introduces a complete, production-grade SSL certificate management cockpit and proactive expiration watchdog. Protect your web properties against sudden certificate expiration downtime with automated discovery, color-coded countdown badges, 1-click Let's Encrypt issuance, dry-run renewal tests, and systemd auto-renewal timer controls.

---

### ✨ What's New in v1.3.0

#### 1. 🔍 Universal Multi-Domain Certificate Discovery
- **Certbot & OpenSSL Hybrid Inspection**: Combines `sudo certbot certificates` with direct Nginx site configuration inspection (`grep -rohP '(?<=ssl_certificate\s)[^;]+'`) evaluated via `openssl x509 -noout -subject -issuer -dates -ext subjectAltName`.
- **100% Certificate Coverage**: Captures Let's Encrypt certificates, custom uploaded SSL certificates, self-signed certificates, and Cloudflare Origin CA certificates across all domains and SANs.
- **Detailed Certificate Insights**: Inspect certificate names, domains covered, validation date ranges, issuer authorities (Let's Encrypt, DigiCert, Cloudflare, etc.), and file system certificate paths.

#### 2. ⏳ Expiration Urgency Watchdog & Badges
- **Color-Coded Health Status**:
  - 🟢 **Healthy**: `> 30 days` remaining.
  - 🟡 **Warning**: `15 - 30 days` remaining.
  - 🟠 **Critical**: `< 15 days` remaining.
  - 🔴 **Expired**: Certificate has lapsed (`≤ 0 days`).
- **Overview Expiry Alert Banner**: High-urgency alert banner on the main Server Overview immediately informs operators if any domains are expiring within 30 days or already expired, featuring a 1-click **"Open SSL Cockpit"** action.

#### 3. 🌐 1-Click Free Let's Encrypt Certificate Issuance
- **Rapid Issuance Modal**: Enter comma-separated domain names (e.g. `api.example.com, web.example.com`) and contact email.
- **Staging Test Toggle**: Test Let's Encrypt issuance against ACME staging servers first to prevent hitting production rate limits during setup.
- **Auto HTTP-to-HTTPS Redirection**: Optionally configure automatic HTTP-to-HTTPS redirects upon successful certificate issuance.

#### 4. 🧪 Dry-Run Renewal & Safe Real Renewal
- **Dry-Run Testing**: Test whether renewal challenges will pass before altering server state using `--dry-run`.
- **Bulk or Single-Cert Renewal**: Renew all certificates in one click or renew specific domain certificates individually.
- **Detailed Execution Modal**: Inspect full Certbot stdout/stderr outputs in an interactive terminal-style modal.

#### 5. ⏰ Systemd Auto-Renewal Timer Toggle
- **1-Click Daemon Control**: Directly inspect and toggle `certbot.timer` systemd service (`systemctl enable/disable --now certbot.timer`) from the cockpit KPI cards.

#### 6. 🛡️ Confirmation-Gated Certificate Deletion & Audit Logging
- **Token-Gated Safety**: Removing a certificate (`certbot delete --cert-name`) requires typing the certificate name into a confirmation dialog and validates a single-use token on the backend.
- **Activity Log Persistence**: All SSL operations (`ISSUE_SSL_CERTIFICATE`, `RENEW_SSL_CERTIFICATES`, `TOGGLE_SSL_AUTO_RENEWAL`, `DELETE_SSL_CERTIFICATE`) are permanently logged to SQLite.

---

### 📦 Installation & Artifacts

| Platform | Installer / Package | Details |
| :--- | :--- | :--- |
| **Windows** | `Server Command Center_1.3.0_x64-setup.exe` / `.msi` | Signed NSIS installer & MSI package |
| **macOS** | `Server Command Center_1.3.0_universal.dmg` | Universal binary (Apple Silicon & Intel) |
| **Linux** | `server-command-center_1.3.0_amd64.deb` / `.AppImage` | Debian / Ubuntu & Standalone AppImage |

*Server Command Center by Falah Tech — Professional Desktop Infrastructure Command.*
