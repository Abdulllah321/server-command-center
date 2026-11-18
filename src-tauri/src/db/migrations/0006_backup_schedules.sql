-- ── Backup Schedules & Remote Server Cron Jobs ──────────────────────────────
CREATE TABLE IF NOT EXISTS backup_schedules (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target_type TEXT NOT NULL,               -- 'postgres', 'mysql', 'redis', 'directory', 'custom'
    target_name TEXT NOT NULL,               -- db name or directory path
    cron_expression TEXT NOT NULL,           -- e.g. '0 2,14 * * *' (twice daily)
    destination_dir TEXT NOT NULL DEFAULT '/var/backups',
    retention_count INTEGER NOT NULL DEFAULT 7,
    db_user TEXT,
    db_password TEXT,
    db_host TEXT,
    db_port INTEGER,
    custom_command TEXT,
    storage_provider TEXT NOT NULL DEFAULT 'none', -- 'none', 's3', 'dropbox'
    storage_config TEXT,                     -- JSON holding bucket, region, token, etc.
    is_active INTEGER NOT NULL DEFAULT 1,
    remote_script_path TEXT,
    last_run_at TEXT,
    last_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backup_schedules_server ON backup_schedules(server_id);

CREATE TABLE IF NOT EXISTS cloud_storage_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,                  -- 's3' or 'dropbox'
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

