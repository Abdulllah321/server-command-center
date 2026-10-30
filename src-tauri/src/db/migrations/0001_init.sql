-- ── Servers ────────────────────────────────────────────────
CREATE TABLE servers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  hostname        TEXT NOT NULL,
  ssh_port        INTEGER NOT NULL DEFAULT 22,
  username        TEXT NOT NULL,
  os              TEXT,                 -- e.g. "Ubuntu 24.04"
  provider        TEXT,                 -- e.g. "DigitalOcean"
  environment     TEXT CHECK(environment IN ('production','staging','dev')) NOT NULL,
  description     TEXT,
  status          TEXT CHECK(status IN ('online','degraded','offline','unknown')) DEFAULT 'unknown',
  last_checked_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE server_tags (
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  PRIMARY KEY (server_id, tag)
);

CREATE TABLE server_groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,           -- "Production", "Clients", etc.
  parent_id  TEXT REFERENCES server_groups(id)
);

CREATE TABLE server_group_members (
  group_id   TEXT NOT NULL REFERENCES server_groups(id) ON DELETE CASCADE,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, server_id)
);

-- ── Credentials (references only — secrets live in OS keychain/vault) ──
CREATE TABLE credentials (
  id              TEXT PRIMARY KEY,
  server_id       TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  auth_method     TEXT CHECK(auth_method IN ('password','private_key','ssh_agent','password_key')) NOT NULL,
  keychain_ref    TEXT NOT NULL,      -- opaque ID into OS keychain / vault entry
  key_fingerprint TEXT,               -- for private_key methods, for display only
  created_at      TEXT NOT NULL
);

-- ── Applications / PM2 ─────────────────────────────────────
CREATE TABLE applications (
  id           TEXT PRIMARY KEY,
  server_id    TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,          -- "ivar-backend"
  repo_path    TEXT,                   -- "/var/www/ivar-backend"
  pm2_name     TEXT,                   -- process name in pm2
  branch       TEXT DEFAULT 'main',
  package_mgr  TEXT DEFAULT 'bun',     -- bun | npm | yarn | pnpm
  rebuild_profile_id TEXT REFERENCES rebuild_profiles(id),
  created_at   TEXT NOT NULL
);

CREATE TABLE rebuild_profiles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,    -- "Next.js + Bun"
  steps_json  TEXT NOT NULL,           -- ordered JSON array of {label, command}
  is_builtin  INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- ── Deployments / Rollback ─────────────────────────────────
CREATE TABLE deployments (
  id            TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  commit_hash   TEXT,
  branch        TEXT,
  status        TEXT CHECK(status IN ('running','success','failed','rolled_back')) NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  duration_ms   INTEGER,
  triggered_by  TEXT,                  -- user/agent identifier
  log_blob      TEXT                   -- full captured output (or path to log file)
);

CREATE TABLE deployment_steps (
  id            TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  step_order    INTEGER NOT NULL,
  label         TEXT NOT NULL,
  command       TEXT NOT NULL,
  status        TEXT CHECK(status IN ('pending','running','success','failed','skipped')) NOT NULL,
  exit_code     INTEGER,
  output        TEXT,
  started_at    TEXT,
  finished_at   TEXT
);

-- ── Services (systemd) ─────────────────────────────────────
CREATE TABLE services (
  id          TEXT PRIMARY KEY,
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  unit_name   TEXT NOT NULL,           -- "nginx", "postgresql"
  is_enabled  INTEGER,
  last_status TEXT,
  last_checked_at TEXT
);

-- ── Saved commands / Quick Actions ─────────────────────────
CREATE TABLE commands (
  id          TEXT PRIMARY KEY,
  server_id   TEXT REFERENCES servers(id) ON DELETE CASCADE,  -- NULL = global/library command
  name        TEXT NOT NULL,
  command     TEXT NOT NULL,
  category    TEXT,                   -- "Server", "PM2", "Nginx", "Git", "Custom"
  icon        TEXT,
  is_destructive INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- ── Environment variables (values encrypted at rest) ───────
CREATE TABLE env_vars (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  key            TEXT NOT NULL,
  value_encrypted BLOB NOT NULL,       -- AES-256-GCM, key from vault
  updated_at     TEXT NOT NULL
);

-- ── Backups ─────────────────────────────────────────────────
CREATE TABLE backups (
  id          TEXT PRIMARY KEY,
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  target      TEXT NOT NULL,           -- db name / path backed up
  destination TEXT NOT NULL,           -- local path or remote target
  size_bytes  INTEGER,
  status      TEXT CHECK(status IN ('running','success','failed')) NOT NULL,
  created_at  TEXT NOT NULL
);

-- ── Activity / Audit log ────────────────────────────────────
CREATE TABLE activity_log (
  id          TEXT PRIMARY KEY,
  server_id   TEXT REFERENCES servers(id) ON DELETE SET NULL,
  actor       TEXT NOT NULL,           -- local user identity
  action      TEXT NOT NULL,           -- "rebuild", "restart_pm2", "flush_redis", ...
  target      TEXT,                    -- app/service name
  status      TEXT CHECK(status IN ('success','failed')) NOT NULL,
  detail      TEXT,                    -- error message / exit code / step that failed
  duration_ms INTEGER,
  created_at  TEXT NOT NULL
);

-- ── Log sessions (PM2 live log capture, for "download logs") ─
CREATE TABLE log_sessions (
  id            TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  file_path     TEXT                   -- local cache of captured log lines
);

CREATE INDEX idx_activity_server ON activity_log(server_id, created_at);
CREATE INDEX idx_deployments_app ON deployments(application_id, started_at);
