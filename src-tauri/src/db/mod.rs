use rusqlite::{Connection, Result};
use std::fs;
use tauri::{AppHandle, Manager};
use log::info;

pub fn init(app: &AppHandle) -> Result<Connection> {
    // Locate the app's local data directory
    let app_dir = app.path().app_data_dir().expect("Failed to get app data dir");
    
    // Create the directory if it doesn't exist
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
    }

    let db_path = app_dir.join("server-command-center.db");
    let mut conn = Connection::open(db_path)?;
    
    // Create migrations table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )",
        [],
    )?;

    // Run migrations
    run_migrations(&mut conn)?;

    Ok(conn)
}

fn run_migrations(conn: &mut Connection) -> Result<()> {
    // Define pending migrations
    let migration_id = "0001_init";
    
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM _migrations WHERE id = ?1")?;
    let count: i64 = stmt.query_row([migration_id], |row| row.get(0))?;
    
    if count == 0 {
        info!("Running migration: {}", migration_id);
        let init_sql = include_str!("migrations/0001_init.sql");
        
        // Execute batch for multiple statements
        conn.execute_batch(init_sql)?;
        
        // Record migration
        conn.execute(
            "INSERT INTO _migrations (id, applied_at) VALUES (?1, datetime('now'))",
            [migration_id],
        )?;

        // Log table names on first run as requested
        let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'")?;
        let table_names: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(Result::ok)
            .collect();
            
        info!("First run complete. Created tables: {:?}", table_names);
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
    
    let res = conn.execute(
        "INSERT INTO activity_log (id, server_id, actor, action, target, status, detail, duration_ms, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))",
        rusqlite::params![
            id,
            entry.server_id,
            actor,
            entry.action,
            entry.target,
            entry.status,
            entry.detail,
            entry.duration_ms
        ],
    );
    
    if let Err(e) = res {
        log::error!("Failed to write to activity_log: {}", e);
    }
}
