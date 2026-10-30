CREATE TABLE IF NOT EXISTS alert_rules (
  id          TEXT PRIMARY KEY,
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  metric      TEXT NOT NULL CHECK(metric IN ('cpu', 'memory', 'disk', 'pm2_crash')),
  threshold   REAL NOT NULL,
  operator    TEXT NOT NULL CHECK(operator IN ('gt', 'lt')),
  enabled     INTEGER DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_history (
  id          TEXT PRIMARY KEY,
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  metric      TEXT NOT NULL,
  value       REAL NOT NULL,
  message     TEXT NOT NULL,
  triggered_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_server ON alert_rules(server_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_server ON alert_history(server_id, triggered_at);
