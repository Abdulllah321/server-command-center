-- ── Historical Server Metrics & Telemetry ─────────────────────
CREATE TABLE IF NOT EXISTS server_metrics_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL,
    cpu_pct REAL NOT NULL,
    ram_pct REAL NOT NULL,
    disk_pct REAL NOT NULL,
    load_1m REAL NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_metrics_server_recorded 
ON server_metrics_history(server_id, recorded_at);

