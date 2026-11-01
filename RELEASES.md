# 🚀 Server Command Center: Releases & Distribution Guide

### Powered by [Falah Tech](https://falah-tech.com)

Official release binaries, installation instructions, build hashes, and changelog history for **Server Command Center**, powered by **[Falah Tech](https://falah-tech.com)**.

---

## 📦 Version 1.0.0 (Latest Release)

*Release Date: November 2026*  
*Target Platforms: Windows 10/11 (x64) • Android 8.0+ (ARM64 / ARMv7 / x86_64)*

### 📥 Release Downloads

| Platform | Format | Filename | Distribution Role |
| :--- | :--- | :--- | :--- |
| **Windows x64** | **Setup Installer (.exe)** | [`Server Command Center_1.0.0_x64-setup.exe`](file:///d:/projects/Veyra/server-command-center/src-tauri/target/release/bundle/nsis/Server%20Command%20Center_1.0.0_x64-setup.exe) | Recommended for desktop: installs Start Menu shortcuts, desktop icon, and uninstaller. |
| **Windows x64** | **Portable Binary (.exe)** | [`server-command-center.exe`](file:///d:/projects/Veyra/server-command-center/src-tauri/target/release/server-command-center.exe) | Standalone single binary: portable, runs directly from USB or local drive without installation. |
| **Android** | **Mobile Package (.apk)** | `server-command-center.apk` | Native Android APK with soft-keyboard terminal support and thumb navigation. |

---

### 💻 Windows Installation Guide

#### Standard Installer (.exe)
1. Download `Server Command Center_1.0.0_x64-setup.exe`.
2. Double-click the setup file. The NSIS installer will guide you through installation into `%LOCALAPPDATA%\Programs\server-command-center`.
3. Launch from your Start Menu or Desktop shortcut.

#### Silent / Unattended Installation (for Enterprise / IT deployment)
```powershell
.\Server Command Center_1.0.0_x64-setup.exe /S
```

#### Portable Mode (.exe)
1. Download `server-command-center.exe`.
2. Move it to any desired folder (e.g., `C:\Tools\ServerCommandCenter\`).
3. Run directly. Settings and local databases are saved safely in your Windows user profile (`%APPDATA%\com.servercommandcenter.app\`).

---

### 📱 Android APK Installation Guide

1. Download `server-command-center.apk` to your Android device.
2. In Android Settings, ensure **Install from Unknown Sources** is enabled for your browser or file manager.
3. Tap the `.apk` file to install.
4. Open **Server Command Center** and enjoy full server fleet control from your smartphone.

#### Building the APK from Source
To compile the APK with your own signing key:
```powershell
cd server-command-center

# 1. Install Android target
rustup target add aarch64-linux-android

# 2. Build release APK
$env:NDK_HOME = "C:\Users\abdullah.sufyan\AppData\Local\Android\Sdk\ndk\27.1.12297006"
npm run tauri android build --apk
```
*Generated output: `src-tauri/gen/android/app/build/outputs/apk/release/app-release-unsigned.apk`.*

---

## 📝 v1.0.0 Detailed Changelog

### 🚀 Highlights & Major Milestones

#### 1. Mobile-First Responsive Experience & Soft-Keyboard Toolbar
- **Dynamic 100dvh Viewport**: Upgraded container layout to `100dvh`, preventing content jumping when mobile browser navigation pills or Android software keyboards open.
- **Thumb Bottom Navigation Bar**: Clean 5-destination bar (`Servers`, `Activity`, `Search`, `Vault`, `Settings`) adhering to Apple and Android safe-area insets (`env(safe-area-inset-bottom)`).
- **Mobile Terminal Soft-Keys**: Fixed the critical mobile SSH limitation by providing on-screen touch buttons for `ESC`, `TAB`, `^C` (SIGINT), `^D` (EOF), arrow keys (`↑` `↓` `←` `→`), pipe `|`, tilde `~`, slash `/`, dash `-`, and `Enter`.
- **Horizontal Smooth Scrollers**: Cockpit and settings tabs smoothly scroll horizontally with hidden scrollbars and edge-fade indicators.

#### 2. Enterprise 3-Tier Security Vault & Windows Hello Biometrics
- **Tier 1 (OS Keychain / DPAPI)**: Encrypts SSH passwords and secrets using Windows DPAPI hardware-backed encryption at rest.
- **Tier 2 (Windows Hello Biometrics)**: Added native TPM 2.0 biometric unlock support using Windows `UserConsentVerifier` API. Unlock master credentials in 1 click using Fingerprint, Face ID, or PIN.
- **Tier 3 (Argon2id Encrypted Vault)**: AES-256-GCM file vault protected by a user master password. In-memory master keys use `ZeroizeOnDrop` buffers that automatically purge memory upon session lock or inactivity timeout.
- **Secret Redaction Filter**: Real-time regex engine scrubs private keys, database passwords, auth tokens, and session secrets from terminal output, PM2 logs, build logs, and SQLite activity records.

#### 3. Fleet Cockpit & SSH Multiplexing
- **Real-time Health Probes**: Live telemetry for CPU load averages, RAM allocation, and root disk usage.
- **Group Hierarchy**: Flexible client and environment grouping (`Production`, `Staging`, `Development`).
- **SSH Pinned Host Keys**: Cryptographic verification of remote server fingerprints to eliminate Man-In-The-Middle (MITM) risks.

#### 4. Zero-Downtime Rebuilds & Scheduled Pipelines
- **Atomic 5-Stage Pipeline**: Parallel build runner supporting `git pull` $\to$ cached dependency sync $\to$ staging build $\to$ atomic directory swap $\to$ PM2 cluster reload.
- **Automated Cron Scheduler**: SQLite-persisted rebuild scheduler executes automated off-peak rebuilds on recurring cron schedules.

#### 5. SFTP Remote File Manager & Chmod Calculator
- **Full File Operations**: Upload, download, rename, delete, and view remote filesystem trees.
- **Visual Chmod Permission Calculator**: Interactive octal permission tool (`0755`, `0644`, etc.) with user/group/others flags.
- **Remote Code Editor**: In-app configuration file editor with line numbers and syntax highlighting.
- **Directory Bookmarks**: Instant shortcuts for `Home (~)` `/var/www`, `/etc/nginx`, `/var/log`, `/tmp`, and `Root (/)`.

#### 6. Security Audit & Firewall Deck
- **Listening Sockets Inspector**: Live parse of `ss -tulpn` highlighting open ports and flagging exposed databases or caching engines.
- **UFW Firewall Controller**: Add, delete, and inspect active firewall packet-filtering rules.
- **SSH Hardening Engine**: Inspects `/etc/ssh/sshd_config` for root password logins and port 22 exposure, assigning a hardening score (0–100).

#### 7. Nginx Proxy & SSH Port Forwarding
- **Nginx Sites-Enabled Inspector**: Visual analysis of server blocks, SSL certificate validity, and upstream proxy targets.
- **Port Tunneling**: Secure local-to-remote port forwarding directly through the active SSH session.

#### 8. Database Snapshots & Backups
- **Automated Snapshots**: Remote execution of `pg_dump`, `mongodump`, `mysqldump`, and `tar.gz` archives with size tracking.
- **One-Click Restore**: Remote snapshot restoration with safety confirmation dialogs.

---

## 🔒 Security & Integrity Verification

To verify that your downloaded binaries have not been tampered with:

```powershell
# In PowerShell:
Get-FileHash -Algorithm SHA256 ".\Server Command Center_1.0.0_x64-setup.exe"
Get-FileHash -Algorithm SHA256 ".\server-command-center.exe"
```

Report any security findings or discrepancies directly via the guidelines documented in [SECURITY.md](SECURITY.md).

