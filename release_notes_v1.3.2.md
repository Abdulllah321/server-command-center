# 🚀 Release Notes - Server Command Center v1.3.2
*Desktop Server Administration & Cockpit Suite — Powered by Falah Tech (falah-tech.com)*

---

## 🚨 Feature 10: Global Alert Notification Center & Sub-Navigation Peeling Fix

Server Command Center **v1.3.2** delivers a complete overhaul of the **Health Watchdog & Alerting Engine**, introducing an automated background evaluation engine with intelligent 5-minute debouncing, default rule auto-seeding, a global top-bar **Notification Center** dropdown with unread badges and Web Audio chimes, proactive Server Overview alert banners, and a definitive fix for sub-navigation tab left clipping ("Overview" peeking/hidden).

---

### ✨ What's New in v1.3.2

#### 1. 🔍 Sub-Navigation Left Peeling & Tab Clipping Fixed
- **Root Cause Eliminated**: Resolved the flexbox centering bug where `justify-center` on an `overflow-x-auto` tab container pushed the leftmost tab ("Overview") into negative X space (`scrollLeft = 0`), cutting off its beginning.
- **Left-Aligned Responsive Tabstrip**: Switched default `tabsListVariants` to `justify-start` with `shrink-0 whitespace-nowrap` on all tabs, ensuring "Overview" is 100% visible from `0px`.
- **Interactive Smooth Scroll Controls**: Added subtle left and right scroll navigation arrows (`<ChevronLeft />` and `<ChevronRight />`) that appear on hover, allowing 1-click smooth horizontal scrolling across all 14 cockpit sub-tabs.

#### 2. ⚡ Automated Background Alert Evaluation
- **Continuous Telemetry Evaluation**: Alert rules are now automatically evaluated against live server telemetry on every health snapshot poll (`get_health`).
- **Full Metric Coverage**: Real-time threshold monitoring for:
  - **CPU Utilization (%)**
  - **Memory (RAM) Usage (%)**
  - **Storage (Disk) Space (%)**
  - **1-Minute System Load Average**
  - **Crashed / Errored PM2 Process Count**
- **Intelligent 5-Minute Debouncing**: Automatic time-window throttling prevents alert spamming when a server experiences sustained high resource consumption.

#### 3. 🌱 Automatic Production Rule Seeding
- **Zero-Config Watchdog**: Every server added to Server Command Center now automatically inherits sensible default production alert thresholds:
  - CPU usage > 85%
  - Memory usage > 90%
  - Disk storage > 90%
  - Crashed PM2 workloads ≥ 1
- **Granular Customization**: Operators can still fine-tune, toggle, or delete rules at any time via the **Alerts** sub-deck.

#### 4. 🔔 Global TopBar Notification Center
- **Dedicated Watchdog Bell**: Integrated into the global application TopBar next to the Vault indicator.
- **Real-Time Unread Badge**: Displays a pulsing red/amber badge with active unread alert count.
- **Fleet-Wide Feed Dropdown**: 1-click access to recent alerts across all managed servers with metric icons, severity ratings, human-readable server names, and relative timestamps.
- **1-Click Deep Navigation**: Clicking any alert navigates directly to that server's alert history deck (`/servers/{id}?tab=alerts`).
- **History Management**: 1-click "Clear History" button to purge recorded notifications.

#### 5. 🔊 Cross-Platform Audio Synth Chimes & Sonner Toasts
- **Native Web Audio Synthesizer**: Plays an alert chime without external audio files, working seamlessly across all desktop operating systems.
- **Mute Control**: Easily toggle alert chimes on or off directly within the Notification Center header.
- **High-Urgency Toast Dispatcher**: Pops up persistent, actionable Sonner toasts with server name, breached metric, and 1-click "Inspect" jump.

#### 6. ⚠️ Proactive Server Overview Alert Banner
- **Instant Urgency Awareness**: A dedicated alert banner appears on the Server Overview if that server has active or recent critical alerts, warning operators immediately without requiring them to visit the Alerts tab.

---

### 📦 Installation & Artifacts

| Platform | Installer / Package | Details |
| :--- | :--- | :--- |
| **Windows** | `Server Command Center_1.3.2_x64-setup.exe` / `.msi` | Signed NSIS installer & MSI package |
| **macOS** | `Server Command Center_1.3.2_universal.dmg` | Universal binary (Apple Silicon & Intel) |
| **Linux** | `server-command-center_1.3.2_amd64.deb` / `.AppImage` | Debian / Ubuntu & Standalone AppImage |

*Server Command Center by Falah Tech — Professional Desktop Infrastructure Command.*

