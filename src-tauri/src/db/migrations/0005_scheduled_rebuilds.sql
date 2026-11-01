-- ── Scheduled Deployments & Nightly Rebuilds ──────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_rebuilds (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,
    app_name TEXT NOT NULL,
    service_type TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'zero_downtime',
    profile_id TEXT,
    scheduled_for TEXT NOT NULL,
    recurring TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_run_at TEXT,
    last_log TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_rebuilds_server ON scheduled_rebuilds(server_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_rebuilds_status ON scheduled_rebuilds(status, scheduled_for);

