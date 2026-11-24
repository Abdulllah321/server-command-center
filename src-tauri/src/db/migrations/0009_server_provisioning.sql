-- Migration 0009: Server Provisioning Engine Logs
CREATE TABLE IF NOT EXISTS server_provisioning_logs (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    status TEXT NOT NULL, -- 'running', 'success', 'failed', 'aborted'
    logs TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provision_server_id ON server_provisioning_logs(server_id);
CREATE INDEX IF NOT EXISTS idx_provision_started_at ON server_provisioning_logs(started_at DESC);

