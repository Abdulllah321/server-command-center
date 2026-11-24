-- ── Backup Cloud Storage Metadata ────────────────────────────
ALTER TABLE backups ADD COLUMN cloud_uploaded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE backups ADD COLUMN cloud_provider TEXT;
ALTER TABLE backups ADD COLUMN cloud_remote_path TEXT;
ALTER TABLE backups ADD COLUMN cloud_uploaded_at TEXT;

