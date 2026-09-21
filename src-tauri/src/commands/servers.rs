use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::models::{Server, ServerPayload, ServerUpdatePayload};
use crate::db::{log_activity, ActivityEntry};
use uuid::Uuid;
use std::time::Instant;

#[tauri::command]
pub async fn list_servers(state: tauri::State<'_, AppState>) -> CommandResult<Vec<Server>> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
    
    // 1. Fetch servers
    let mut stmt = conn.prepare("SELECT id, name, hostname, ssh_port, username, os, provider, environment, description, status, last_checked_at, created_at, updated_at FROM servers")?;
    
    let mut servers: Vec<Server> = stmt.query_map([], |row| {
        Ok(Server {
            id: row.get(0)?,
            name: row.get(1)?,
            hostname: row.get(2)?,
            ssh_port: row.get(3)?,
            username: row.get(4)?,
            os: row.get(5)?,
            provider: row.get(6)?,
            environment: row.get(7)?,
            description: row.get(8)?,
            status: row.get(9)?,
            last_checked_at: row.get(10)?,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
            tags: Some(Vec::new()),
        })
    })?.filter_map(Result::ok).collect();

    // 2. Fetch tags in one roundtrip
    let mut tag_stmt = conn.prepare("SELECT server_id, tag FROM server_tags")?;
    let tags_iter = tag_stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    for tag_res in tags_iter {
        if let Ok((server_id, tag)) = tag_res {
            if let Some(server) = servers.iter_mut().find(|s| s.id == server_id) {
                if let Some(tags) = &mut server.tags {
                    tags.push(tag);
                }
            }
        }
    }

    Ok(servers)
}

#[tauri::command]
pub async fn get_server(state: tauri::State<'_, AppState>, id: String) -> CommandResult<Server> {
    if id.is_empty() {
        return Err(CommandError::Validation("Server ID cannot be empty".into()));
    }

    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
    
    let mut stmt = conn.prepare("SELECT id, name, hostname, ssh_port, username, os, provider, environment, description, status, last_checked_at, created_at, updated_at FROM servers WHERE id = ?1")?;
    
    let mut server = stmt.query_row([&id], |row| {
        Ok(Server {
            id: row.get(0)?,
            name: row.get(1)?,
            hostname: row.get(2)?,
            ssh_port: row.get(3)?,
            username: row.get(4)?,
            os: row.get(5)?,
            provider: row.get(6)?,
            environment: row.get(7)?,
            description: row.get(8)?,
            status: row.get(9)?,
            last_checked_at: row.get(10)?,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
            tags: Some(Vec::new()),
        })
    }).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => CommandError::NotFound(format!("Server {} not found", id)),
        _ => CommandError::Database(e.to_string())
    })?;

    let mut tag_stmt = conn.prepare("SELECT tag FROM server_tags WHERE server_id = ?1")?;
    let tags: Vec<String> = tag_stmt.query_map([&id], |row| row.get(0))?
        .filter_map(Result::ok)
        .collect();

    server.tags = Some(tags);

    Ok(server)
}

#[tauri::command]
pub async fn create_server(state: tauri::State<'_, AppState>, server: ServerPayload) -> CommandResult<Server> {
    // 1. Validate
    if server.name.is_empty() {
        return Err(CommandError::Validation("Server name cannot be empty".into()));
    }
    if server.hostname.is_empty() {
        return Err(CommandError::Validation("Hostname cannot be empty".into()));
    }

    let start = Instant::now();
    let id = Uuid::new_v4().to_string();

    let mut conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
    
    let tx = conn.transaction()?;

    let res = (|| -> Result<(), rusqlite::Error> {
        tx.execute(
            "INSERT INTO servers (id, name, hostname, ssh_port, username, os, provider, environment, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'), datetime('now'))",
            rusqlite::params![
                &id,
                &server.name,
                &server.hostname,
                &server.ssh_port,
                &server.username,
                &server.os,
                &server.provider,
                &server.environment,
                &server.description
            ],
        )?;

        for tag in &server.tags {
            tx.execute(
                "INSERT INTO server_tags (server_id, tag) VALUES (?1, ?2)",
                rusqlite::params![&id, tag],
            )?;
        }
        
        Ok(())
    })();

    let status = if res.is_ok() { "success" } else { "failed" };
    let detail = res.as_ref().err().map(|e| e.to_string());

    if res.is_ok() {
        tx.commit()?;
    } else {
        let _ = tx.rollback();
    }
    
    // Audit log
    log_activity(&conn, ActivityEntry {
        server_id: Some(id.clone()),
        action: "create_server".into(),
        target: Some(server.name.clone()),
        status: status.into(),
        detail,
        duration_ms: Some(start.elapsed().as_millis() as i64),
    });

    if status == "failed" {
        return Err(CommandError::Database("Failed to create server".into()));
    }
    
    // Drop the lock so get_server can re-acquire it
    drop(conn);

    get_server(state, id).await
}

#[tauri::command]
pub async fn update_server(state: tauri::State<'_, AppState>, id: String, updates: ServerUpdatePayload) -> CommandResult<Server> {
    if id.is_empty() {
        return Err(CommandError::Validation("Server ID cannot be empty".into()));
    }

    let start = Instant::now();
    let mut conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
    
    let tx = conn.transaction()?;

    let res = (|| -> Result<(), rusqlite::Error> {
        if let Some(name) = &updates.name {
            tx.execute("UPDATE servers SET name = ?1, updated_at = datetime('now') WHERE id = ?2", [&name, &id])?;
        }
        if let Some(hostname) = &updates.hostname {
            tx.execute("UPDATE servers SET hostname = ?1, updated_at = datetime('now') WHERE id = ?2", [&hostname, &id])?;
        }
        if let Some(ssh_port) = updates.ssh_port {
            tx.execute("UPDATE servers SET ssh_port = ?1, updated_at = datetime('now') WHERE id = ?2", rusqlite::params![ssh_port, &id])?;
        }
        if let Some(username) = &updates.username {
            tx.execute("UPDATE servers SET username = ?1, updated_at = datetime('now') WHERE id = ?2", [&username, &id])?;
        }
        if let Some(os) = &updates.os {
            tx.execute("UPDATE servers SET os = ?1, updated_at = datetime('now') WHERE id = ?2", [&os, &id])?;
        }
        if let Some(provider) = &updates.provider {
            tx.execute("UPDATE servers SET provider = ?1, updated_at = datetime('now') WHERE id = ?2", [&provider, &id])?;
        }
        if let Some(env) = &updates.environment {
            tx.execute("UPDATE servers SET environment = ?1, updated_at = datetime('now') WHERE id = ?2", [&env, &id])?;
        }
        if let Some(desc) = &updates.description {
            tx.execute("UPDATE servers SET description = ?1, updated_at = datetime('now') WHERE id = ?2", [&desc, &id])?;
        }

        if let Some(tags) = &updates.tags {
            tx.execute("DELETE FROM server_tags WHERE server_id = ?1", [&id])?;
            for tag in tags {
                tx.execute("INSERT INTO server_tags (server_id, tag) VALUES (?1, ?2)", rusqlite::params![&id, tag])?;
            }
        }
        
        Ok(())
    })();

    let status = if res.is_ok() { "success" } else { "failed" };
    let detail = res.as_ref().err().map(|e| e.to_string());

    if res.is_ok() {
        tx.commit()?;
    } else {
        let _ = tx.rollback();
    }
    
    // Audit log
    log_activity(&conn, ActivityEntry {
        server_id: Some(id.clone()),
        action: "update_server".into(),
        target: None,
        status: status.into(),
        detail,
        duration_ms: Some(start.elapsed().as_millis() as i64),
    });

    if status == "failed" {
        return Err(CommandError::Database("Failed to update server".into()));
    }
    
    drop(conn);

    get_server(state, id).await
}

#[tauri::command]
pub async fn delete_server(state: tauri::State<'_, AppState>, id: String) -> CommandResult<()> {
    if id.is_empty() {
        return Err(CommandError::Validation("Server ID cannot be empty".into()));
    }
    
    // TODO: Phase 2 - Authorize against confirm_gate

    let start = Instant::now();
    let conn = state.db.lock().map_err(|_| CommandError::Internal("Lock poisoned".into()))?;
    
    let res = conn.execute("DELETE FROM servers WHERE id = ?1", [&id]);
    
    let status = if res.is_ok() { "success" } else { "failed" };
    let detail = res.as_ref().err().map(|e| e.to_string());
    
    // Audit log
    log_activity(&conn, ActivityEntry {
        server_id: Some(id.clone()),
        action: "delete_server".into(),
        target: None,
        status: status.into(),
        detail,
        duration_ms: Some(start.elapsed().as_millis() as i64),
    });

    res?;
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::sync::Mutex;
    use tauri::State;

    fn setup_in_memory_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        // create tables
        let init_sql = include_str!("../db/migrations/0001_init.sql");
        conn.execute_batch(init_sql).unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        
        conn.execute(
            "CREATE TABLE IF NOT EXISTS activity_log (
                id TEXT PRIMARY KEY,
                server_id TEXT,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                target TEXT,
                status TEXT NOT NULL,
                detail TEXT,
                duration_ms INTEGER,
                created_at TEXT NOT NULL
            )",
            []
        ).unwrap();
        
        conn
    }
    
    // Tauri states are tricky to mock fully since state isn't easily constructable in tests without a real app builder, 
    // but we can test the DB interactions directly by wrapping them in the logic above if we refactored slightly.
    // For now we'll do raw DB tests matching the command logic.

    #[test]
    fn test_crud_server() {
        let conn = setup_in_memory_db();
        // Since we can't easily mock tauri::State without spinning up the tauri builder in a test context,
        // we can test the SQLite behavior matches expectations for the CRUD operations.
        
        // Create server
        let id = "test-id-123";
        conn.execute(
            "INSERT INTO servers (id, name, hostname, ssh_port, username, environment, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), datetime('now'))",
            rusqlite::params![id, "Test Server", "localhost", 22, "root", "dev"],
        ).unwrap();
        
        conn.execute("INSERT INTO server_tags (server_id, tag) VALUES (?1, ?2)", [id, "web"]).unwrap();
        
        // List servers
        let mut stmt = conn.prepare("SELECT name FROM servers WHERE id = ?1").unwrap();
        let name: String = stmt.query_row([id], |row| row.get(0)).unwrap();
        assert_eq!(name, "Test Server");
        
        // Cascade delete
        conn.execute("DELETE FROM servers WHERE id = ?1", [id]).unwrap();
        let tag_count: i64 = conn.query_row("SELECT COUNT(*) FROM server_tags WHERE server_id = ?1", [id], |row| row.get(0)).unwrap();
        assert_eq!(tag_count, 0); // Validates cascade works!
    }
}
