CREATE TABLE known_hosts (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);
 