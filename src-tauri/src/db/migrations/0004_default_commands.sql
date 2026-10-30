-- ── Default Quick Actions Library ───────────────────────────
-- Seed essential sysadmin & developer shortcuts (server_id = NULL means available to all servers)

INSERT OR IGNORE INTO commands (id, server_id, name, command, category, icon, is_destructive, created_at)
VALUES
  ('cmd-diag-memory', NULL, 'Top Memory Apps', 'ps aux --sort=-%mem | head -n 12', 'Diagnostics', '🧠', 0, datetime('now')),
  ('cmd-diag-cpu', NULL, 'Top CPU Apps', 'ps aux --sort=-%cpu | head -n 12', 'Diagnostics', '⚡', 0, datetime('now')),
  ('cmd-diag-disk', NULL, 'Disk & Inodes Space', 'df -h && echo "" && echo "=== INODES ===" && df -ih', 'Diagnostics', '💾', 0, datetime('now')),
  ('cmd-diag-ports', NULL, 'Listening Ports', 'ss -tulpn 2>/dev/null || netstat -tulnp 2>/dev/null', 'Network', '🔌', 0, datetime('now')),
  ('cmd-diag-failed', NULL, 'Check Failed Services', 'systemctl --failed --all', 'Diagnostics', '🩺', 0, datetime('now')),
  ('cmd-nginx-reload', NULL, 'Reload Nginx', 'sudo nginx -t && sudo systemctl reload nginx', 'Web Server', '🌐', 0, datetime('now')),
  ('cmd-nginx-restart', NULL, 'Restart Nginx', 'sudo systemctl restart nginx', 'Web Server', '🔄', 0, datetime('now')),
  ('cmd-pm2-flush', NULL, 'Flush PM2 Logs', 'pm2 flush', 'PM2', '🧹', 0, datetime('now')),
  ('cmd-pm2-status', NULL, 'PM2 Status Table', 'pm2 status', 'PM2', '📊', 0, datetime('now')),
  ('cmd-maint-journal', NULL, 'Clean System Journal', 'sudo journalctl --vacuum-time=3d', 'Maintenance', '🗑️', 0, datetime('now')),
  ('cmd-maint-dropcache', NULL, 'Reclaim RAM Caches', 'sync && echo 3 | sudo tee /proc/sys/vm/drop_caches', 'Maintenance', '🚀', 0, datetime('now')),
  ('cmd-sys-reboot', NULL, 'Reboot Server', 'sudo reboot', 'System', '⚠️', 1, datetime('now'));

