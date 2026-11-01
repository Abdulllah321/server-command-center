pub mod actions;
pub use actions::*;
use rusqlite::{Connection, Result};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager};
use log::info;

pub fn init_db(db_path: &Path) -> Result<Connection> {
    if let Some(parent) = db_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).expect("Failed to create app data dir");
        }
    }
    let mut conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )",
        [],
    )?;
    run_migrations(&mut conn)?;
    Ok(conn)
}

pub fn init(app: &AppHandle) -> Result<Connection> {
    // Locate the app's local data directory
    let app_dir = app.path().app_data_dir().expect("Failed to get app data dir");
    
    // Create the directory if it doesn't exist
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
    }

    let db_path = app_dir.join("command_center.sqlite");
    init_db(&db_path)
}

fn run_migrations(conn: &mut Connection) -> Result<()> {
    let migrations: &[(&str, &str)] = &[
        ("0001_init", include_str!("migrations/0001_init.sql")),
        ("0002_known_hosts", include_str!("migrations/0002_known_hosts.sql")),
        ("0003_alerts", include_str!("migrations/0003_alerts.sql")),
        ("0004_default_commands", include_str!("migrations/0004_default_commands.sql")),
        ("0005_scheduled_rebuilds", include_str!("migrations/0005_scheduled_rebuilds.sql")),
    ];

    for (migration_id, migration_sql) in migrations {
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM _migrations WHERE id = ?1")?;
        let count: i64 = stmt.query_row([*migration_id], |row| row.get(0))?;

        if count == 0 {
            info!("Running migration: {}", migration_id);
            conn.execute_batch(migration_sql)?;
            conn.execute(
                "INSERT INTO _migrations (id, applied_at) VALUES (?1, datetime('now'))",
                [*migration_id],
            )?;
        }
    }

    // Enable foreign keys for ON DELETE CASCADE
    conn.execute("PRAGMA foreign_keys = ON", [])?;

    Ok(())
}

pub struct ActivityEntry {
    pub server_id: Option<String>,
    pub action: String,
    pub target: Option<String>,
    pub status: String,
    pub detail: Option<String>,
    pub duration_ms: Option<i64>,
}

pub fn log_activity(conn: &Connection, entry: ActivityEntry) {
    let id = uuid::Uuid::new_v4().to_string();
    // In a real app we might get the actor from state/auth context
    let actor = "local_user";
    
    let redacted_detail = entry.detail.map(|d| crate::secrets::redact::redact_secrets(&d));
    let redacted_target = entry.target.map(|t| crate::secrets::redact::redact_secrets(&t));
    
    let res = conn.execute(
        "INSERT INTO activity_log (id, server_id, actor, action, target, status, detail, duration_ms, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))",
        rusqlite::params![
            id,
            entry.server_id,
            actor,
            entry.action,
            redacted_target,
            entry.status,
            redacted_detail,
            entry.duration_ms
        ],
    );
    
    if let Err(e) = res {
        log::error!("Failed to write to activity_log: {}", e);
    }
}
