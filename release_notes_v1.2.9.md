# 🚀 Release Notes - Server Command Center v1.2.9
*Desktop Server Administration & Cockpit Suite — Powered by Falah Tech (falah-tech.com)*

---

## 📈 Feature 9: Historical Metrics & Process Top Consumers

Server Command Center **v1.2.9** introduces comprehensive system telemetry persistence and OS-level process management. Monitor multi-day resource utilization curves directly within the app and instantly identify, inspect, and terminate resource hogs with full cryptographic confirmation safety.

---

### ✨ What's New in v1.2.9

#### 1. 🗄️ Local SQLite Metrics Persistence & Resolution Downsampling
- **Zero-Dependency History**: Automatically records telemetry snapshots (CPU %, RAM %, Disk %, Load Average 1m) into a local SQLite database (`server_metrics_history`) on every health poll or overview visit.
- **Rolling 7-Day Retention**: Automatic pruning ensures database footprint remains ultra-lean (<5MB).
- **Intelligent Downsampling**:
  - **1 Hour**: High-resolution instantaneous timeline.
  - **24 Hours**: Downsampled into smooth 10-minute buckets via SQLite aggregations.
  - **7 Days**: Downsampled into 1-hour hourly buckets for rapid query execution (<3ms).

#### 2. 📊 Interactive Historical Telemetry Charts
- **Multi-Metric Switcher**: Seamlessly switch between **CPU Utilization (%)**, **RAM Memory (%)**, **Disk Space (%)**, and **Load Average (1m)**.
- **Dynamic Stats Summary**: Live min, max, average, and current value pills for the selected metric.
- **Interactive SVG Engine**: Built with zero external charting dependencies for maximum speed and compatibility. Features crosshair guidance and hover tooltips showing exact timestamps and breakdown.
- **Time-Range Selectors**: 1-click toggling between **1 Hour**, **24 Hours**, and **7 Days**.

#### 3. ⚙️ Top Process Consumers Deck
- **Remote OS-Level Inspection**: Queries active processes via `ps -eo pid,ppid,user,%cpu,%mem,vsz,rss,stat,comm,args` over pooled SSH.
- **Sort by % CPU or % Memory**: Real-time sorting by highest processor or memory consumers.
- **Instant Search & Filter**: Filter live processes by PID, binary name, username, or command line arguments.
- **Process Details & Arguments**: Inspect full command line arguments, parent process PID (PPID), and virtual size (VSZ) with 1-click argument copying.

#### 4. 🛡️ Safe Confirmation-Gated Process Termination
- **Dual Signal Options**: Choose between graceful polite termination (`SIGTERM` - 15) or immediate uncatchable termination (`SIGKILL` - 9).
- **System Init Safeguard**: Explicitly blocks attempts to kill PID 0 or PID 1.
- **Confirmation Gate**: Destructive process termination is strictly gated behind short-lived single-use confirmation tokens.
- **Audit Logging**: Every process termination is permanently recorded in the central Activity Log (`actions::KILL_PROCESS`).

---

### 📦 Installation & Artifacts

| Platform | Installer / Package | Checksum / Details |
| :--- | :--- | :--- |
| **Windows** | `Server Command Center_1.2.9_x64-setup.exe` / `.msi` | Signed NSIS installer & MSI package |
| **macOS** | `Server Command Center_1.2.9_universal.dmg` | Universal (Apple Silicon & Intel) |
| **Linux** | `server-command-center_1.2.9_amd64.deb` / `.AppImage` | Debian / Ubuntu & Standalone AppImage |

*Server Command Center by Falah Tech — Professional Desktop Infrastructure Command.*

