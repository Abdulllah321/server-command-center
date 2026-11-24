/**
 * Software Update Checker for Server Command Center
 * Powered by Falah Tech (falah-tech.com)
 */

export const APP_VERSION = '1.3.1';
export const GITHUB_REPO = 'Abdulllah321/server-command-center';

export interface DocumentedRelease {
  summary: string;
  highlights: string[];
  features?: string[];
  fixes?: string[];
  performance?: string[];
}

export const DOCUMENTED_CHANGELOGS: Record<string, DocumentedRelease> = {
  'v1.3.1': {
    summary: 'Fresh Server Provisioning & Setup Wizard: Complete server bootstrap engine to transform bare-metal or cloud VPS instances into production-hardened hosts with zero Docker overhead. Features 1-click architecture presets, non-root deploy user creation, swap memory protection, UFW firewall, fail2ban defense, standalone Bash script export, and real-time streaming SSH terminal execution.',
    highlights: [
      'Flexible Destination Modes: Provision freshly created VPS instances directly via root credentials or re-bootstrap and harden existing servers already in your fleet.',
      'Curated Architecture Presets: 1-click recipes for Node & PM2 Production, Full-Stack PostgreSQL + Redis, Full-Stack MariaDB + Redis, Minimal Hardened Base, and Custom Blueprints.',
      'Swap Memory Optimizer: Configurable swapfile creation (1GB, 2GB, 4GB, 8GB) with kernel swappiness tuning and fstab persistence to prevent out-of-memory build failures on budget VPSs.',
      'Native Linux Security Suite: Zero Docker! Automated UFW firewall rules, fail2ban SSH brute-force jail defense, non-root sudo deploy user, and optional SSH hardening (disabling root login and password auth).',
      'Standalone Bash Script Generator: Instant preview, copy, or download of the complete POSIX bootstrap script for external auditing or cloud-init automation.',
      'Real-Time Execution & Terminal Stream: Live step-by-step pipeline tracker with animated status icons, duration counters, line-by-line SSH terminal output streaming, and safe cancellation control.',
      'Audit Archive: All provisioning executions and stdout/stderr logs are permanently recorded in the local SQLite database (`server_provisioning_logs`).'
    ],
    features: [
      'Backend Commands: `generate_provision_script`, `start_server_provisioning`, `cancel_server_provisioning`, and `get_provision_history`.',
      'Event Channels: Real-time telemetry streamed via `provision://step:SESSION_ID`, `provision://log:SESSION_ID`, and `provision://complete:SESSION_ID`.'
    ]
  },
  'v1.3.0': {
    summary: 'SSL Certificate Expiry Watchdog & Renewal Cockpit: Universal multi-domain discovery (Certbot + direct OpenSSL Nginx config parsing), color-coded expiration countdown badges, 1-click Let\'s Encrypt certificate issuance with dry-run verification, systemd auto-renewal timer toggle, and proactive expiration alert banners.',
    highlights: [
      'Universal Certificate Discovery: Exhaustively inspects both Certbot managed certificates and custom/manual/Cloudflare Origin CA certificates by scanning Nginx site configurations (`grep -rohP ssl_certificate`) and parsing with OpenSSL X509.',
      'Proactive Expiry Watchdog: Instant color-coded urgency badges (>30d healthy green, 15-30d warning amber, <15d critical orange, ≤0d expired red) with days-until-expiry countdowns.',
      'Server Overview Expiry Alert Banner: High-visibility urgency alert banner displayed right on the server overview if any certificate is expiring within 30 days or already expired, with 1-click cockpit jump.',
      '1-Click Free Let\'s Encrypt Issuance: Issue production or staging test certificates (`certbot --nginx -d ...`) with optional HTTP-to-HTTPS redirect enforcement directly from the UI.',
      'Dry-Run Verification & Real Renewal: Test certificate renewal integrity safely with Certbot dry-run mode before executing real renewals, with live captured command output reports.',
      'Automated Timer Management: 1-click toggle for systemd `certbot.timer` auto-renewal background service directly from the cockpit status deck.',
      'Safe Certificate Deletion: Destructive certificate removal protected behind short-lived single-use confirmation tokens and recorded in the audit log.'
    ],
    features: [
      'Backend Commands: `get_ssl_overview`, `renew_ssl_certificates`, `issue_ssl_certificate`, `toggle_ssl_auto_renewal`, and `delete_ssl_certificate` over pooled SSH.',
      'Security Audit Log: Every issuance, renewal, timer toggle, and deletion is recorded in the SQLite Activity Log.'
    ]
  },
  'v1.2.9': {
    summary: 'Historical Metrics & Process Top Consumers: Local persistent SQLite metrics history (1h, 24h, 7d) for CPU, RAM, Disk, and Load averages with interactive SVG charts, alongside a real-time Top Process Consumers deck with sort, filter, and 1-click token-gated termination.',
    highlights: [
      'Local Metrics Persistence: Automated SQLite storage for server telemetry snapshots with rolling 7-day retention and intelligent multi-resolution downsampling (10m buckets for 24h, 1h buckets for 7d).',
      'Interactive Historical Telemetry Charts: Full SVG area/line trend charts with hover crosshairs, precise tooltips, min/max/average stat summary pills, and 1h / 24h / 7d time-range selectors.',
      'Top Process Consumers Deck: Live inspection of remote OS processes with % CPU, % Memory, RSS, state flags, and collapsible command line arguments.',
      'Sorting & Real-Time Filtering: Sort processes dynamically by % CPU or % Memory, with instant search filtering by binary, user, PID, or command args.',
      'Safe Process Termination: 1-click process termination supporting both graceful SIGTERM (15) and immediate force SIGKILL (9), strictly gated behind confirmation tokens and protected against terminating system init (PID 1).'
    ],
    features: [
      'Backend Commands: `get_metrics_history`, `record_metric_point`, `get_top_processes`, and `kill_server_process` over pooled SSH.',
      'Activity Audit: Process terminations are cryptographically validated and logged to the central activity log.'
    ]
  },
  'v1.2.8': {
    summary: 'Crontab & Scheduled Automation Manager: Direct remote crontab synchronization, visual cron schedule builder with plain-English translator, 1-click ad-hoc execution ("Run Now"), and curated automation runbooks.',
    highlights: [
      'Direct Crontab Synchronization: View, edit, and manage user and system crontabs directly (crontab -l, crontab -) with live active vs. paused (commented out) state detection.',
      'Visual Schedule Builder & Plain-English Translation: Craft schedules with presets (every minute, 5/15 mins, hourly, daily, weekly, monthly, @reboot) with real-time human-language description preview (e.g. "Daily at 02:00 AM").',
      '1-Click Ad-Hoc Execution ("Run Now"): Instantly trigger any scheduled task on demand over pooled SSH without waiting for its cron interval, with real-time stdout/stderr log capture and exit status.',
      'Curated Automation Runbooks Palette: 1-click installation of production-ready automation scripts (SSL auto-renewal, log compression & purge, temp/session cleanup, weekly PageCache drop, Docker prune, database auto-vacuum).',
      'Safe Editing & Token Gate: Dangerous cron jobs (system wipe, mkfs, destructive deletes) require explicit confirmation tokens before installation.'
    ],
    features: [
      'Native Backend Commands: `list_server_cron_jobs`, `save_server_cron_job`, `toggle_server_cron_job`, `delete_server_cron_job`, and `run_cron_job_now` over pooled SSH.',
      'Audit Logging: Crontab modifications and manual triggers are securely recorded in the Activity Log.'
    ]
  },
  'v1.2.7': {
    summary: 'Database Query Runner & Connection Monitor: Multi-engine support for PostgreSQL, MySQL, and Redis, with real-time query execution, live client connection monitoring, table disk size analysis, and read-only Safe Mode.',
    highlights: [
      'Multi-Engine Database Deck: Native support for PostgreSQL (psql), MySQL / MariaDB (mysql), and Redis (redis-cli) with automatic database and keyspace discovery via peer socket auth, docker containers, and custom credentials.',
      'Interactive SQL & Command Editor: High-speed query execution with engine-specific quick snippet templates (active locks, top 10 table disk sizes, index cache hit ratio, dead tuples & vacuum status, buffer pool hit rate, slow queries).',
      'Read-Only Safe Mode & Confirmation Gate: Active-by-default safe mode blocks mutation and destructive queries (DROP, DELETE, UPDATE, ALTER, TRUNCATE, FLUSHDB) unless explicitly disabled and confirmed with single-use tokens.',
      'Tabular Results Grid with Search & Export: Sort, search, and paginate through thousands of rows with null-value indicators, duration timings, and 1-click export to CSV, JSON, or clipboard.',
      'Live Active Connection Monitor: Real-time inspection of client connections (pg_stat_activity, SHOW FULL PROCESSLIST, CLIENT LIST), connection duration, current query snippets, and 1-click connection termination / kill.',
      'Database & Schema Explorer: Instant visibility into all tables, estimated row counts, human-readable disk sizes, and 1-click quick SELECT queries.'
    ],
    features: [
      'Native Backend Commands: `execute_database_query`, `get_database_connections`, `terminate_database_connection`, `get_database_schema_tables` running securely over pooled SSH sessions.',
      'Activity Log Discipline: Query mutations and terminated connections are securely logged in SQLite with credentials strictly masked.'
    ]
  },
  'v1.2.6': {
    summary: 'Fleet Commander (Multi-Server Bulk Execution): Concurrently run commands across all or filtered server clusters via pooled SSH sessions, curated Runbooks palette, real-time node matrix, and Markdown audit export.',
    highlights: [
      'Concurrent Fleet Execution: Execute commands simultaneously across dozens of remote servers in parallel using Rust tokio::task::JoinSet with pooled SSH connections and configurable per-node timeouts.',
      'Target Fleet Selector: Filter nodes by environment group (Production, Staging, Dev, Clients, All) or granular individual server checkboxes with real-time target counters.',
      'Curated Fleet Runbooks: 1-click execution palette for infrastructure health audits (Uptime & Kernel, Root Disk Usage, RAM & Swap, Pending Security Upgrades, Listening Ports, PM2 Cluster Status & Zero-Downtime Reload, PageCache Memory Freeing).',
      'Live Execution Matrix: Visual node-by-node response deck displaying real-time status badges (Running, Success, Failed, Timeout, Offline), execution latency, process exit codes, and individual stdout/stderr logs.',
      'Integrated Safety & Destructive Guards: Dangerous system operations require explicit confirmation tokens and double-confirmation modals before execution to prevent accidental cluster-wide outages.',
      'Audit Export & Search: Filter cluster results by server name, status, or search query; copy command outputs to clipboard or export a full Markdown fleet audit report.'
    ],
    features: [
      'Native Rust Command: `execute_fleet_command` registered in Tauri with pooled SSH async execution and comprehensive audit logging.',
      'Workspace Tab Integration: Dedicated Fleet tab (/fleet) with full navigation, workspace tab preservation, and responsive layout.'
    ]
  },
  'v1.2.5': {
    summary: 'Environment Variables & Secrets Deck: Zero-daemon remote .env discovery, sensitive credential masking, versioned auto-backups, instant rollback, and cross-environment diffing.',
    highlights: [
      'Automated .env File Discovery: Scans active applications and common server roots (/var/www, /home, /root, PM2 app directories) to instantly surface all environment configuration files.',
      'Sensitive Credential Masking: Automatically identifies and masks secret credentials (passwords, tokens, API keys, private certs, connection strings) with individual and master eye toggles.',
      'Versioned Automated Backups: Every save automatically creates a timestamped backup snapshot (.bak.<timestamp>) on the remote server with safe atomic writing via base64 decoders.',
      'One-Click Rollback Drawer: View complete history of past .env snapshots and roll back to any previous state in a single click (with automatic pre-rollback safety snapshot).',
      'Cross-Environment Diff & Comparison: Compare .env files side-by-side across staging, production, or different servers with missing key highlights and 1-click key importing.',
      'Structured Table & Raw Code Modes: Switch between a classified key-value table (Database, Secret, Network, Config) and a raw syntax-highlighted editor with zero sync friction.'
    ],
    features: [
      'Native Backend Commands: `list_server_env_files`, `read_env_file`, `save_env_file`, `list_env_backups`, and `restore_env_backup` running over pooled SSH channels.',
      'Zero Secret Leakage Audit: State mutations are securely logged in the Activity Log with sensitive values completely redacted.'
    ]
  },
  'v1.2.4': {
    summary: 'Full desktop-class remote SFTP File Explorer: move, cut-copy-paste, duplicate in place, compress, archive extraction, native drag-and-drop, and custom context menu.',
    highlights: [
      'Remote Cut, Copy & Paste: Move and copy files and subfolders across directories via keyboard shortcuts (Ctrl+X, Ctrl+C, Ctrl+V) or context menu with visual dimming for cut items.',
      'One-Click In-Place Duplication: Instantly duplicate files or directories (Ctrl+D) with automatic non-conflicting naming (e.g. file_copy.ext).',
      'Archive Compression & Extraction: Compress selected items to .zip or .tar.gz, and extract archives directly on the remote server with "Extract Here" or "Extract to Folder".',
      'Seamless Drag-and-Drop: Drag remote files or folders onto directory rows to move them instantly; drag desktop files into the explorer to upload.',
      'Custom Desktop Context Menu: Right-click on files, folders, or empty table canvas for instant access to open, edit, cut, copy, duplicate, chmod, compress, extract, download, and delete actions.',
      'Fixed Table Layout: Resolved table header column collisions and overlap glitch for crisp presentation across all screen sizes.'
    ],
    features: [
      'Native SFTP Commands: `move_remote_paths`, `copy_remote_paths`, `duplicate_remote_path`, `compress_remote_paths`, and `extract_remote_archive` over pooled SSH sessions.',
      'Visual Clipboard State: Floating banner and dimmed rows provide real-time clipboard feedback with instant paste and cancellation.'
    ]
  },
  'v1.2.3': {
    summary: 'Cloud sync tracking, offsite cloud replica inspection ("See Cloud"), direct cloud downloads, and duplicate upload prevention.',
    highlights: [
      'Cloud Sync Tracking: Backup records now track offsite sync status, cloud provider (Amazon S3 / Dropbox), remote object URI, and timestamp.',
      'Offsite Cloud Inspection ("See Cloud"): Dedicated modal displays cloud storage location, provider details, and 1-click cloud URI copy.',
      'Direct Download from Cloud: Stream backup archives directly from Amazon S3 / Dropbox straight to your local PC downloads folder over secure SSH channels.',
      'Duplicate Upload Prevention: Backups already pushed to cloud feature prominent status badges and require deliberate confirmation before re-uploading, preventing accidental duplicate offsite copies.',
      'Retroactive Detection: Automatically detects and surfaces past cloud uploads from activity logs for seamless backward compatibility.'
    ],
    features: [
      'Cloud Download Command: Native backend command `download_backup_from_cloud` streams S3 and Dropbox objects straight to local storage.',
      'Cloud Metadata Migration: SQLite schema migration `0007_backup_cloud_metadata` tracks `cloud_uploaded`, `cloud_provider`, `cloud_remote_path`, and `cloud_uploaded_at`.'
    ],
    fixes: [
      'Eliminated duplicate cloud uploads by replacing blind "Push to Cloud" buttons with "See Cloud" and "From Cloud" actions for synced archives.'
    ],
    performance: [
      'Zero-RAM streaming download from cloud storage providers directly to local disk without buffering large archives in memory.'
    ]
  },
  'v1.2.2': {
    summary: 'Automated database discovery and dropdown selection across PostgreSQL, MySQL/MariaDB, and Redis for ad-hoc dumps and scheduled server backups.',
    highlights: [
      'Automated Database Discovery: Remote Linux servers and Docker containers are queried live over pooled SSH connections to discover all available databases.',
      'Dropdown DB Selection: Replaced manual database text input with an interactive selection dropdown displaying engine icons (🐘 PostgreSQL, 🐬 MySQL, ⚡ Redis).',
      'Intelligent Primary Database Pre-Selection: Automatically detects and selects your primary application database so you can create dumps in 1 click.',
      'Docker & Root Peer Auth Auto-Detection: Discovers databases running natively via peer socket or inside PostgreSQL/MySQL/Redis Docker containers without manual configuration.',
      'Seamless Fallback & Re-scan: Full support for custom database names, unlisted schemas, and instant 1-click live server re-scan.'
    ],
    features: [
      'Database Discovery Command: Native backend command `list_server_databases` inspects `pg_database`, `information_schema.schemata`, and Redis keyspaces.',
      'Dual Modal Integration: Dropdown selection integrated into both the Ad-hoc Live Dump modal and the Server-Native Cron Schedule modal.'
    ],
    fixes: [
      'Eliminated manual database typing requirement for server dumps and cron backup schedules.'
    ],
    performance: [
      'Ultra-fast sub-second database inspection reusing persistent pooled SSH channels without launching separate daemon processes.'
    ]
  },
  'v1.2.1': {
    summary: 'Isolated internal SPA routes from external link interceptor, ensuring internal navigation (dashboard, servers, tabs, settings) stays seamlessly inside the app.',
    highlights: [
      'Strict Route Isolation: Internal navigation links (`/server/*`, `/activity`, `/settings`) stay 100% inside the desktop window.',
      'Eliminated `tauri.localhost` External Browser Tabs: Resolved issue where clicking internal links was erroneously opening `http://tauri.localhost/` in external browser tabs.',
      'Dual Guard Architecture: Frontend URL parser checks origin and hostname while backend rejects any `tauri.localhost` browser dispatch requests.',
      'Preserved External Link Routing: External links (GitHub, documentation, downloads, falah-tech.com) continue opening cleanly in your default browser.'
    ],
    features: [
      'Origin-Aware Link Delegation: Smart domain resolution differentiates between internal client router links and third-party web targets.'
    ],
    fixes: [
      'Fixed inner pages (e.g. `http://tauri.localhost/`) opening in external browser tabs on link clicks.'
    ],
    performance: [
      'Instant client-side link resolution without unnecessary IPC dispatches for internal routes.'
    ]
  },
  'v1.2.0': {
    summary: 'Native OS browser routing for all external links and release assets, eliminating broken WebView navigation and suppressing useless default browser context menus.',
    highlights: [
      'Native OS Browser Integration: All external links, release URLs, and download targets route directly to the user\'s default desktop browser via system shell association.',
      'Suppressed WebView Context Menu: Eliminated useless default browser context menus ("Open link in new window", "Save link as") across desktop views while keeping terminal and text inputs fully functional.',
      'Interactive Binary Asset Actions: 1-click update trigger for setup installers, direct browser download launcher, and 1-click copy download URL for all compiled binaries and SHA-256 checksums.',
      'Context Menu Copy Action: Right-clicking any release binary automatically copies its secure download URL directly to the system clipboard.'
    ],
    features: [
      'Interactive Asset Cards: Every release asset item provides direct 1-click update, in-browser download, and clipboard copy actions.',
      'Desktop Link Routing: Global link interceptor ensures zero broken WebView2 windows when clicking any web link.'
    ],
    fixes: [
      'Fixed non-functional clicking on release binaries, setup installers, and portable EXEs in the release timeline.',
      'Eliminated useless browser context menus on right-clicking links and cards.'
    ],
    performance: [
      'Zero overhead URL delegation directly using operating system shell process spawn.'
    ]
  },
  'v1.1.9': {
    summary: 'Resolved file upload chunk payload deserialization conflict, ensuring seamless large file (1 GB+) streaming uploads with zero server memory footprint.',
    highlights: [
      'Eliminated `invalid args payload for command upload_remote_file_chunk: missing field server_id` error.',
      'Flexible Field Deserialization: Custom deserializer resolves both camelCase and snake_case upload metadata without serde derive conflicts.',
      'Resilient Multi-Gigabyte SFTP Uploads: High-performance 1 MB binary chunk streaming with atomic reassembly and progress tracking.',
      'Guaranteed Fallback: Backend accepts both wrapped payloads and flat top-level parameters for all remote file upload and cancellation calls.'
    ],
    features: [
      'Zero-Daemon Chunked Uploads: Streams files up to multiple gigabytes directly into remote disk with zero daemon dependencies.',
      'Auto-Cleanup on Cancel: Gracefully terminates active streams and purges temporary chunk files upon cancellation.'
    ],
    fixes: [
      'Fixed `missing field server_id` error on chunk 0 of file upload.',
      'Fixed upload cancellation parameter alignment between frontend and backend.'
    ],
    performance: [
      'Minimal client and server memory consumption using slice-by-slice base64 streaming over pooled SSH channels.'
    ]
  },
  'v1.1.8': {
    summary: 'Resolved server ID argument mismatch in backup CRON schedule creation, toggle, delete, and manual run commands, with full cloud storage integration.',
    highlights: [
      'Eliminated `invalid args serverId for command create_backup_schedule: missing required key serverId` error.',
      'Flexible Server ID Resolution: Accepts `serverId` at top level or extracts from `options.server_id` seamlessly.',
      'Autonomous Cloud Upload Injection: Remote server crontabs directly read S3 / Dropbox configurations and upload generated archives automatically.',
      'Robust Schedule Lifecycle: Hardened toggle, delete, and run-now commands to query by schedule ID even when serverId is omitted.'
    ],
    features: [
      'Resilient Schedule Arguments: All backup schedule IPC commands support both camelCase and snake_case parameters.',
      'Autonomous Server-Side Backup Daemon: Remote cron schedules execute independently on the target Linux servers.'
    ],
    fixes: [
      'Fixed `invalid args serverId for command create_backup_schedule` error when saving new cron jobs.',
      'Fixed schedule toggle and deletion when operating across multiple server tabs.'
    ],
    performance: [
      'Zero round-trip overhead during schedule creation; uses pooled SSH session.'
    ]
  },
  'v1.1.7': {
    summary: 'Resolved duplicate field deserialization conflict in updater engine, ensuring seamless 1-click in-app upgrades across all versions.',
    highlights: [
      'Eliminated `duplicate field downloadUrl` error by replacing Serde derive alias with immune custom Value deserializer.',
      'Guaranteed backward and forward compatibility for all camelCase and snake_case updater payloads.',
      'Smooth automated download and in-place upgrade workflow from the Releases & Changelog interface.'
    ],
    features: [
      'Robust Updater Deserialization: Handles camelCase, snake_case, or mixed legacy keys without schema rejection.',
      'Silent In-Place Upgrade: Seamlessly fetches installer to temp and launches cleanly.'
    ],
    fixes: [
      'Fixed `invalid args payload for command download_and_install_update: duplicate field downloadUrl` error.'
    ],
    performance: [
      'Zero serialization overhead when launching updater daemon.'
    ]
  },
  'v1.1.6': {
    summary: 'Browser-style multi-server workspace tabbing system (Edge / WPS style) with keep-alive background execution for terminals, rebuilds, and backups.',
    highlights: [
      'Multi-Server Tabs: Manage multiple servers simultaneously inside a single window with a native horizontal tab strip.',
      'Keep-Alive Background Execution: Switching tabs keeps terminal `./rebuild.sh` runs, Next.js compilations, and backups running continuously without interruption.',
      'Smart Tab Controls: Middle-click to close, right-click context menu, dynamic server names, and keyboard navigation (Ctrl+Tab, Ctrl+W, Ctrl+1..9).'
    ],
    features: [
      'Native Workspace Tab Bar: Edge / WPS style tabs with status indicators, close buttons, and quick plus switcher.',
      'Continuous Tab Viewport: Inactive tabs stay rendered in DOM (`display: none`), preserving SSH channels and xterm state.',
      'Responsive Terminal Auto-Fit: Terminal automatically re-fits rows and columns upon switching back.'
    ],
    fixes: [
      'Eliminated need to open multiple OS windows side-by-side to monitor simultaneous servers.'
    ],
    performance: [
      'Instant zero-reload tab switching with preserved client-side and SSH state.'
    ]
  },
  'v1.1.5': {
    summary: 'In-app updater argument serialization fix, cross-version payload compatibility, and S3 SigV4 base64 signer.',
    highlights: [
      'Resolved updater serialization error: supported both camelCase and snake_case for downloadUrl and totalBytes.',
      'Smooth 1-Click in-app upgrade pipeline directly from the Updates & Releases interface.',
      'Hardened remote S3 connection and backup engine against shell quoting issues.'
    ],
    features: [
      'Universal Updater Serialization: In-app installer accepts camelCase (TypeScript) and snake_case (Rust) payloads interchangeably.',
      'Progress Synchronization: Live percentage and downloaded megabytes display during asset acquisition.'
    ],
    fixes: [
      'Fixed `invalid args payload for command download_and_install_update: missing field download_url` error.'
    ],
    performance: [
      'Fast curl-based parallel asset retrieval with redirect resolution.'
    ]
  },
  'v1.1.4': {
    summary: 'S3 Connection Engine SigV4 fix, Base64 Python runner, and built-in terminal clipboard shortcuts.',
    highlights: [
      'Fixed S3 test connection and backup upload: replaced shell heredocs with immune Base64 Python execution.',
      'Resolved Python strftime syntax error (`invalid syntax at %Y%m%dT%H%M%SZ`) caused by shell quote nesting.',
      'Native Terminal Clipboard: Full support for Ctrl+C (smart copy/SIGINT), Ctrl+V (paste), toolbar buttons, and sleek context menu.'
    ],
    features: [
      'Base64 Pure-Python Runner: Cloud connectors now execute via Base64 decoding, completely preventing shell quote stripping.',
      'Enhanced Terminal UX: Smart Ctrl+C copies highlighted text without cancelling active remote processes.'
    ],
    fixes: [
      'Fixed S3 connection failure: eliminated `SyntaxError: invalid syntax` in AWS SigV4 signer on remote hosts without aws-cli.',
      'Fixed Dropbox large archive upload chunking script quotation over SSH.'
    ],
    performance: [
      'Instant connection validation and zero-dependency cloud backups across all Linux server distributions.'
    ]
  },
  'v1.1.3': {
    summary: '1-Click In-App Seamless Updater, Documented Release Changelogs, and Developer Diagnostics cleanup.',
    highlights: [
      '1-Click automated in-app updater: updates Server Command Center directly in-place without manual uninstall/reinstall.',
      'Comprehensive documented release changelogs integrated directly into the Update Center.',
      'Cleaned up developer build pipeline cards from user view for a refined production experience.',
      'Verified universal S3-compatible path-style storage (Cloudflare R2, MinIO) and 1 GB+ SSH streaming upload engine.'
    ],
    features: [
      'Seamless In-Place Upgrade Engine: Downloads setup installer to temp directory with real-time progress and launches installer in background before restarting.',
      'Documented Changelogs UI: Visual cards categorizing Highlights, New Features, Bug Fixes, and Performance metrics for every version.',
      'Refined Settings Experience: Streamlined user interface focusing on update management and version switching.'
    ],
    fixes: [
      'Removed developer pipeline cards from user view in the Update Center as requested.',
      'Preserves all user configuration, encrypted credentials, and server profiles across updates without uninstall.'
    ],
    performance: [
      'Fast background download with progress streaming and lightweight asset caching.'
    ]
  },
  'v1.1.2': {
    summary: 'High-speed chunked 1 GB+ file upload over SSH, universal S3 path-style support for Cloudflare R2 / MinIO, and 1-Click in-app updater.',
    highlights: [
      'Chunked streaming file upload in File Manager (1 MB slices, zero memory overflow, 1 GB+ supported).',
      'Universal S3-compatible path-style storage & ListObjectsV2 probing for Cloudflare R2, MinIO, Wasabi.',
      '1-Click automated in-app update installer: upgrade instantly without uninstalling or manual downloads.',
      'Cloud backup upload parameter resolution fix for saved target profiles.'
    ],
    features: [
      'File Manager Chunked Streaming: 1 MB binary chunks streamed into SSH channel STDIN with atomic rename.',
      'Real-time Transfer Progress: Live percentage, upload speed in MB/s, ETA, and cancellation button.',
      '1-Click Automated In-App Updater: Downloads and applies upgrades in-place, restarting into the new version.',
      'Universal S3 Path-Style: Seamless support for custom endpoints (Cloudflare R2, MinIO, Wasabi, Ceph).'
    ],
    fixes: [
      'Resolved invalid args `provider` error when uploading existing backups to cloud storage.',
      'Fixed S3 DNS getaddrinfo error by avoiding virtual-host prefixing on custom endpoints.',
      'Replaced GetBucketLocation with universally supported ListObjectsV2 probe.',
      'Fixed Dropbox large file upload by implementing upload session chunking for files > 140 MB.',
      'Eliminated ARG_MAX command line overflows by streaming binary data directly over SSH STDIN.'
    ],
    performance: [
      'Zero server RAM ballooning during multi-gigabyte uploads (streams directly from STDIN to disk).',
      'Extended cloud storage socket timeouts to 1800s to support large multi-gigabyte archive backups.'
    ]
  },
  'v1.1.1': {
    summary: 'Hotfix release for S3 backup credential validation and update tracking center.',
    highlights: [
      'Fixed S3 credential field mapping (`access_key` vs `access_key_id`).',
      'Integrated dedicated Software Updates & Release Tracker in Settings.'
    ],
    features: [
      'Added Update Tracker with GitHub Releases synchronization and asset inspection.',
      'Added automated release publication pipeline with cross-platform artifact builds.'
    ],
    fixes: [
      'Fixed S3 credential validation error where Access Key ID and Secret Access Key were flagged missing.'
    ]
  },
  'v1.1.0': {
    summary: 'Major release introducing Remote File Manager, Nginx Site Configurator, Cloud Backups, and Security Center.',
    highlights: [
      'Full-featured Remote File Manager with Zero-RAM remote browser and Monaco code editor.',
      'Nginx Site Manager with syntax validation, SSL certbot renewal, and live reload.',
      'Automated backup scheduler with Cron synchronization and offsite S3 / Dropbox uploading.',
      'UFW Firewall & Port Tunnel management.'
    ],
    features: [
      'Remote File Explorer with file edit, permissions (chmod), rename, deletion, and download.',
      'Nginx reverse proxy site manager and SSL certificate renewal.',
      'Automated backup cron synchronization and cloud storage target profiles.',
      'SSH port forwarding and tunneling manager.'
    ]
  },
  'v1.0.0': {
    summary: 'Initial production release of Server Command Center.',
    highlights: [
      'Multi-server inventory management with hardware health analytics (CPU, RAM, Disk).',
      'Direct PM2 process management with live log streaming.',
      'Encrypted local vault with optional Windows Hello biometric authentication.',
      'Zero-downtime rebuild engine for fullstack applications.'
    ]
  }
};

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  htmlUrl: string;
  exeInstallerUrl?: string;
  exePortableUrl?: string;
  apkUrl?: string;
}

/**
 * Compare two semver strings (e.g., "1.0.1" vs "1.0.0" or "v1.0.1" vs "v1.0.0")
 */
export function isNewerVersion(remoteTag: string, localVersion: string): boolean {
  const cleanRemote = remoteTag.replace(/^v/i, '').trim();
  const cleanLocal = localVersion.replace(/^v/i, '').trim();

  const remoteParts = cleanRemote.split('.').map(p => parseInt(p, 10) || 0);
  const localParts = cleanLocal.split('.').map(p => parseInt(p, 10) || 0);

  const length = Math.max(remoteParts.length, localParts.length);
  for (let i = 0; i < length; i++) {
    const r = remoteParts[i] || 0;
    const l = localParts[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

/**
 * Check GitHub Releases for the latest application version
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // No releases published yet on GitHub
        return {
          hasUpdate: false,
          currentVersion: APP_VERSION,
          latestVersion: APP_VERSION,
          releaseName: 'Initial Release',
          releaseNotes: 'No remote releases found. You are running the baseline build.',
          publishedAt: new Date().toISOString(),
          htmlUrl: `https://github.com/${GITHUB_REPO}/releases`,
        };
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const latestTag: string = data.tag_name || APP_VERSION;
    const hasUpdate = isNewerVersion(latestTag, APP_VERSION);

    let exeInstallerUrl: string | undefined;
    let exePortableUrl: string | undefined;
    let apkUrl: string | undefined;

    if (Array.isArray(data.assets)) {
      for (const asset of data.assets as ReleaseAsset[]) {
        const nameLower = asset.name.toLowerCase();
        if (nameLower.endsWith('-setup.exe') || (nameLower.includes('setup') && nameLower.endsWith('.exe'))) {
          exeInstallerUrl = asset.browser_download_url;
        } else if (nameLower.endsWith('.exe') && !exeInstallerUrl) {
          exePortableUrl = asset.browser_download_url;
        } else if (nameLower.endsWith('.apk')) {
          apkUrl = asset.browser_download_url;
        }
      }
    }

    return {
      hasUpdate,
      currentVersion: APP_VERSION,
      latestVersion: latestTag.replace(/^v/i, ''),
      releaseName: data.name || latestTag,
      releaseNotes: data.body || 'No release notes provided.',
      publishedAt: data.published_at || new Date().toISOString(),
      htmlUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
      exeInstallerUrl,
      exePortableUrl,
      apkUrl,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to check for updates. Please verify your internet connection.';
    throw new Error(msg, { cause: err });
  }
}

export interface ReleaseAssetInfo {
  name: string;
  downloadUrl: string;
  size: number;
  downloadCount: number;
  type: 'installer' | 'portable' | 'apk' | 'checksums' | 'other';
}

export interface ReleaseHistoryItem {
  id: number;
  tagName: string;
  cleanVersion: string;
  name: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  isPrerelease: boolean;
  isCurrent: boolean;
  isNewer: boolean;
  assets: ReleaseAssetInfo[];
}

/**
 * Fetch all recent releases from GitHub for detailed changelog and update tracking
 */
export async function fetchReleaseHistory(): Promise<ReleaseHistoryItem[]> {
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    return data.map((item: any) => {
      const tagName: string = item.tag_name || '';
      const cleanVersion = tagName.replace(/^v/i, '');
      const isCurrent = cleanVersion === APP_VERSION || tagName === `v${APP_VERSION}`;
      const isNewer = isNewerVersion(tagName, APP_VERSION);

      const assets: ReleaseAssetInfo[] = Array.isArray(item.assets)
        ? item.assets.map((a: any) => {
            const nameLower = (a.name || '').toLowerCase();
            let type: ReleaseAssetInfo['type'] = 'other';
            if (nameLower.endsWith('-setup.exe') || (nameLower.includes('setup') && nameLower.endsWith('.exe'))) {
              type = 'installer';
            } else if (nameLower.endsWith('.exe')) {
              type = 'portable';
            } else if (nameLower.endsWith('.apk')) {
              type = 'apk';
            } else if (nameLower.includes('checksum') || nameLower.endsWith('.sha256') || nameLower.endsWith('.txt')) {
              type = 'checksums';
            }

            return {
              name: a.name || 'unnamed',
              downloadUrl: a.browser_download_url || '',
              size: a.size || 0,
              downloadCount: a.download_count || 0,
              type,
            };
          })
        : [];

      return {
        id: item.id,
        tagName,
        cleanVersion,
        name: item.name || tagName,
        body: item.body || 'No release notes provided.',
        publishedAt: item.published_at || new Date().toISOString(),
        htmlUrl: item.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/${tagName}`,
        isPrerelease: Boolean(item.prerelease),
        isCurrent,
        isNewer,
        assets,
      };
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch release history.';
    throw new Error(msg, { cause: err });
  }
}
