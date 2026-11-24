## Server Command Center v1.2.6 — Powered by Falah Tech (falah-tech.com)

### 🌐 Fleet Commander (Multi-Server Bulk Execution & Auditing)
Server Command Center `v1.2.6` introduces **Fleet Commander**, an enterprise-grade cockpit engineered to execute commands across dozens or hundreds of remote servers concurrently. Built on top of Rust's asynchronous `tokio::task::JoinSet` and pooled SSH multiplexing, Fleet Commander brings high-throughput bulk orchestration with zero client lag and instant node-by-node feedback.

---

### 🚀 Key Highlights & New Capabilities

#### 1. Concurrent Fleet Execution Engine
- **Parallel Multiplexing**: Execute shell queries and audit scripts concurrently across remote servers using asynchronous pooled SSH worker tasks.
- **Configurable Per-Node Timeout**: Granular execution safeguards with customizable timeout intervals (from 5s up to 120s), automatically canceling unresponsive nodes without blocking healthy infrastructure.
- **Zero-Daemon Architecture**: Operates directly over standard OpenSSH without requiring agent daemons or external control planes.

#### 2. Granular Target Fleet Selection
- **Environment Filtering**: 1-click filtering by server group tags (`Production`, `Staging`, `Development`, `Clients`, `All`).
- **Interactive Checkboxes**: Select all, deselect all, or hand-pick specific servers with live target counters and status badges.
- **Node Search**: Real-time name and IP filtering to pinpoint target machines within seconds.

#### 3. Curated Fleet Runbooks Palette
- **Uptime & Kernel Audit**: `uptime; uname -r` — Immediate visibility into cluster uptime, load averages, and Linux kernel versions.
- **Root Disk Usage**: `df -h /` — Instant fleet-wide disk utilization audit to detect low disk space before incidents occur.
- **RAM & Swap Health**: `free -h` — Inspect available memory, buffers, and swap allocations across nodes.
- **Pending Security Upgrades**: Non-destructive dry-run package checks to detect outstanding critical patches.
- **Listening Ports Audit**: `ss -tulpn` — Fleet-wide open port and socket audit for rapid security scanning.
- **PM2 Cluster Management**: Check process table (`pm2 list`) and trigger zero-downtime cluster reloads (`pm2 reload all`).
- **Memory Optimization**: Flush pagecache, dentries, and inodes safely (`sync; echo 3 > /proc/sys/vm/drop_caches`).

#### 4. Live Execution Matrix & Response Deck
- **Node-by-Node Status Cards**: Live visual badges (`Running`, `Success`, `Failed`, `Timeout`, `Offline`) with millisecond execution latency and process exit codes.
- **Terminal Output Viewer**: Expandable stdout and stderr streams with 1-click clipboard copying.
- **Result Search & Filtering**: Filter cluster responses by server name, status, or regex search query.

#### 5. Destructive Command Guards & Safety Tokens
- **Pre-execution Analysis**: Detects dangerous system operations (e.g. `pm2 reload`, `drop_caches`, cluster-wide restarts) and requires explicit confirmation tokens and confirmation modals.
- **Blind Deletion Blocks**: Hard blocks blind root deletions (`rm -rf /`) and fork bombs to protect production clusters.
- **Full Audit Logging**: Every fleet execution is logged with timestamp, target count, execution summary, and duration in the Activity Log (`actions::FLEET_COMMAND`).

#### 6. Markdown Audit Report Export
- Generate and download comprehensive Markdown audit reports with execution timestamps, summary statistics, and formatted per-node command logs ready for compliance and DevOps post-mortems.

---

### 📦 Available Assets & Binaries
- `Server.Command.Center_1.2.6_x64-setup.exe` — Windows Setup Installer (NSIS)
- `server-command-center.exe` — Windows Portable Executable
- `checksums-windows-x64.txt` — SHA-256 verification hashes

