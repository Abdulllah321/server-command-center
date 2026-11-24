## Server Command Center v1.2.7 — Powered by Falah Tech (falah-tech.com)

### 🗄️ Database Query Runner & Connection Monitor
Server Command Center `v1.2.7` introduces the **Database Deck**, a high-performance, zero-daemon query runner, connection monitor, and schema explorer for remote servers. Built directly into the Server Detail view, it empowers developers and sysadmins to inspect, query, and monitor PostgreSQL, MySQL, and Redis instances over pooled SSH connections without requiring third-party GUI clients or opened public firewall ports.

---

### 🚀 Key Highlights & New Capabilities

#### 1. Multi-Engine Remote Database Deck
- **Unified Engine Support**: Switch seamlessly between **PostgreSQL** (`psql`), **MySQL / MariaDB** (`mysql`), and **Redis** (`redis-cli`).
- **Smart Discovery**: Automatically identifies databases, schemas, and Redis keyspaces using multi-strategy discovery (peer socket authentication, debian.cnf, root/sudo, and active Docker containers).
- **Flexible Auth Modes**: Run instantly over Unix peer sockets or configure custom database credentials (host, port, user, password) with masked password toggles.

#### 2. Interactive SQL & Command Runner
- **Monospace Query Cockpit**: Write and execute queries with `Ctrl+Enter` keyboard shortcuts, query line numbers, and formatted tabular outputs.
- **Engine-Specific Quick Snippets**: 1-click execution palette for mission-critical diagnostics:
  - **PostgreSQL**: Active connections & query latency, top 10 largest tables by disk size, database storage breakdown, index cache hit ratio, dead tuples & vacuum requirements.
  - **MySQL**: Live processlist, table data/index sizes, InnoDB Buffer Pool hit rate, global uptime & slow query counters.
  - **Redis**: Full system `INFO`, memory utilization breakdown, keys count (`DBSIZE`), connected clients (`CLIENT LIST`), and safe cursor scans (`SCAN 0 COUNT 50`).
- **Recent Query History**: Stores past executed queries per server with execution latencies and timestamps for 1-click reloading.

#### 3. Read-Only Safe Mode & Confirmation Gate
- **Safe Mode Default**: Read-Only Safe Mode is active by default to protect production databases, automatically intercepting and blocking dangerous mutations (`DROP`, `DELETE`, `UPDATE`, `ALTER`, `TRUNCATE`, `FLUSHDB`, `FLUSHALL`).
- **Single-Use Confirmation Tokens**: When Safe Mode is toggled off, destructive operations require explicit modal confirmation and single-use cryptographic token verification before executing.
- **Activity Log Integration**: All query mutations and connection terminations are recorded in the local SQLite Activity Log with credentials strictly redacted.

#### 4. Tabular Results Grid & Multi-Format Export
- **Interactive Grid**: Sticky column headers, row numbering, explicit `NULL` and boolean styling, and real-time execution timing badges.
- **Live Search & Filter**: Filter thousands of result cells instantly using the integrated search bar.
- **Export Formats**: 1-click export of full result sets to **CSV** and **JSON**, or copy tab-separated values (TSV) directly to the system clipboard.
- **Memory Protection**: Automatically truncates output grids exceeding 1,000 rows with clear truncation badges to prevent client memory bloat.

#### 5. Live Active Connection Monitor
- **Real-Time Client Inspection**: Direct visibility into connected clients (`pg_stat_activity`, `SHOW FULL PROCESSLIST`, `CLIENT LIST`) with PID/ID, database name, username, remote IP/socket, state, duration (seconds), and active query text.
- **Cluster Capacity Gauges**: Summary cards displaying total connections, active running queries, idle connections, and max connection limits with percentage utilization bars.
- **Connection Termination**: Terminate hung or runaway queries directly from the UI (`pg_terminate_backend`, `KILL <id>`, `CLIENT KILL ID <id>`).
- **Configurable Auto-Refresh**: Toggle automatic background polling (3s, 5s, 10s, or Off) for real-time traffic monitoring.

#### 6. Database & Schema Explorer
- Inspect all tables within the selected database with table name, schema name, estimated row count, and human-readable disk size (e.g., `45.2 MB`, `1.2 GB`).
- **1-Click Quick SELECT**: Click any table row to instantly generate and execute `SELECT * FROM <table> LIMIT 50` in the Query Runner.

---

### 📦 Available Assets & Binaries
- `Server.Command.Center_1.2.7_x64-setup.exe` — Windows Setup Installer (NSIS)
- `server-command-center.exe` — Windows Portable Executable
- `checksums-windows-x64.txt` — SHA-256 verification hashes

