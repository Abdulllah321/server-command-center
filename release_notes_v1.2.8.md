## Server Command Center v1.2.8 — Powered by Falah Tech (falah-tech.com)

### ⏰ Crontab & Scheduled Automation Manager
Server Command Center `v1.2.8` brings enterprise-grade scheduled automation to remote servers with the **Crontab & Automation Deck**. Manage, edit, troubleshoot, and trigger scheduled jobs across your infrastructure with zero daemon requirements, visual cron expression builders, real-time English schedule translation, and 1-click ad-hoc execution.

---

### 🚀 Key Highlights & New Capabilities

#### 1. Direct Remote Crontab Synchronization
- **Live Bidirectional Crontab Sync**: Inspect, add, edit, and remove cron jobs directly on remote servers (`crontab -l`, `crontab -`) over pooled SSH.
- **Active vs. Paused State**: Toggle tasks on or off with a single click — automatically commenting out or uncommenting crontab lines without losing their command or description.
- **Comment & Tag Preservation**: Preserves user comments, description headers, and environment variables across edits.

#### 2. Visual Schedule Builder & Plain-English Translation
- **Preset Schedule Buttons**: 1-click scheduling with presets:
  - *Every Minute* (`* * * * *`)
  - *Every 5 Minutes* (`*/5 * * * *`)
  - *Every 15 Minutes* (`*/15 * * * *`)
  - *Hourly* (`0 * * * *`)
  - *Daily at Midnight* (`0 0 * * *`)
  - *Daily at 2:00 AM* (`0 2 * * *`)
  - *Weekly on Sunday* (`0 0 * * 0`)
  - *Monthly on 1st* (`0 0 1 * *`)
  - *At System Reboot* (`@reboot`)
- **Real-Time Human Language Preview**: Translates obscure 5-field cron strings into clear English descriptions (e.g. `0 2 * * *` -> *"Daily at 02:00 AM"*, `0 5 * * 0` -> *"Every Sunday at 05:00 AM"*).

#### 3. 1-Click Ad-Hoc Execution ("Run Now")
- **Instant On-Demand Execution**: Execute any scheduled task immediately with the **Run Now** button without waiting for its next cron schedule.
- **Real-Time Output Terminal**: Captures stdout, stderr, process exit status, and execution duration in milliseconds.
- **Log Copying**: 1-click copy of task execution output for rapid troubleshooting.

#### 4. Curated Automation Runbooks Palette
- Standard 1-click automation runbooks ready to install on any server:
  - **SSL Auto-Renew**: Let's Encrypt `certbot renew --quiet` twice daily.
  - **Log Rotation & Purge**: Clean archived `.gz` logs older than 14 days to preserve disk space.
  - **Temp & Session Cleanup**: Remove old temporary files from `/tmp`.
  - **Free PageCache & Inodes**: Safely flush memory cache weekly on Sunday.
  - **Docker System Prune**: Clean unused volumes and dangling container images weekly.
  - **PostgreSQL Auto-Analyze**: Daily database statistics update for optimal query plans.
  - **Laravel / PHP Task Runner**: Standard Laravel schedule runner (`artisan schedule:run`).

#### 5. Safety Gates & Activity Log Discipline
- **Destructive Command Detection**: Critical commands (`rm -rf`, `drop database`, `mkfs`) trigger confirmation modal requirements before being written to crontab.
- **Activity Log Audit**: All crontab creations, updates, toggles, deletions, and ad-hoc executions are recorded in the local SQLite Activity Log (`actions::CREATE_CRON_JOB`, `actions::TOGGLE_CRON_JOB`, etc.).

---

### 📦 Available Assets & Binaries
- `Server.Command.Center_1.2.8_x64-setup.exe` — Windows Setup Installer (NSIS)
- `server-command-center.exe` — Windows Portable Executable
- `checksums-windows-x64.txt` — SHA-256 verification hashes
