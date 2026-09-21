use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::error::{CommandResult, CommandError};
use crate::db::{log_activity, ActivityEntry};
use rusqlite::OptionalExtension;
use uuid::Uuid;
use std::time::Instant;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RebuildStep {
    pub label: String,
    pub command: String,
    pub continue_on_error: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RebuildProfile {
    pub id: String,
    pub name: String,
    pub steps: Vec<RebuildStep>,
    pub is_builtin: bool,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct CreateProfileOptions {
    pub name: String,
    pub steps: Vec<RebuildStep>,
}

#[derive(Deserialize)]
pub struct UpdateProfileOptions {
    pub name: String,
    pub steps: Vec<RebuildStep>,
}

pub fn seed_builtin_profiles(conn: &rusqlite::Connection) -> CommandResult<()> {
    let builtins = vec![
        (
            "Next.js + Bun",
            vec![
                RebuildStep { label: "Pull Latest".into(), command: "git pull".into(), continue_on_error: false },
                RebuildStep { label: "Install Dependencies".into(), command: "bun install".into(), continue_on_error: false },
                RebuildStep { label: "Build".into(), command: "bun run build".into(), continue_on_error: false },
                RebuildStep { label: "Restart PM2".into(), command: "pm2 restart {{pm2_name}}".into(), continue_on_error: false },
            ],
        ),
        (
            "NestJS + Bun",
            vec![
                RebuildStep { label: "Pull Latest".into(), command: "git pull".into(), continue_on_error: false },
                RebuildStep { label: "Install Dependencies".into(), command: "bun install".into(), continue_on_error: false },
                RebuildStep { label: "Build".into(), command: "bun run build".into(), continue_on_error: false },
                RebuildStep { label: "Restart PM2".into(), command: "pm2 restart {{pm2_name}}".into(), continue_on_error: false },
            ],
        ),
        (
            "Node + npm",
            vec![
                RebuildStep { label: "Pull Latest".into(), command: "git pull".into(), continue_on_error: false },
                RebuildStep { label: "Install Dependencies".into(), command: "npm install".into(), continue_on_error: false },
                RebuildStep { label: "Build".into(), command: "npm run build".into(), continue_on_error: false },
                RebuildStep { label: "Restart PM2".into(), command: "pm2 restart {{pm2_name}}".into(), continue_on_error: false },
            ],
        ),
    ];

    for (name, steps) in builtins {
        let steps_json = serde_json::to_string(&steps)
            .map_err(|e| CommandError::Internal(format!("Failed to serialize builtin steps: {}", e)))?;
        
        conn.execute(
            "INSERT INTO rebuild_profiles (id, name, steps_json, is_builtin, created_at) 
             VALUES (?1, ?2, ?3, 1, datetime('now'))
             ON CONFLICT(name) DO UPDATE SET steps_json = ?3",
            rusqlite::params![Uuid::new_v4().to_string(), name, steps_json]
        ).map_err(|e| CommandError::Internal(format!("Failed to seed {}: {}", name, e)))?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn list_profiles(state: tauri::State<'_, AppState>) -> CommandResult<Vec<RebuildProfile>> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    let mut stmt = conn.prepare("SELECT id, name, steps_json, is_builtin, created_at FROM rebuild_profiles ORDER BY name ASC")
        .map_err(|e| CommandError::Internal(e.to_string()))?;
        
    let rows = stmt.query_map([], |row| {
        let steps_str: String = row.get(2)?;
        // We do parsing in the map closure, but if it fails we just return empty vec or handle it safely.
        // Returning rusqlite::Result from map closure means we can't easily bubble up serde errors as CommandError inside it
        // so we'll parse it after collecting.
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            steps_str,
            row.get::<_, i32>(3)? == 1,
            row.get::<_, String>(4)?,
        ))
    }).map_err(|e| CommandError::Internal(e.to_string()))?;

    let mut profiles = Vec::new();
    for row_res in rows {
        let (id, name, steps_str, is_builtin, created_at) = row_res.map_err(|e| CommandError::Internal(e.to_string()))?;
        let steps = serde_json::from_str(&steps_str).unwrap_or_else(|_| vec![]);
        profiles.push(RebuildProfile {
            id,
            name,
            steps,
            is_builtin,
            created_at,
        });
    }

    Ok(profiles)
}

#[tauri::command]
pub async fn get_profile(state: tauri::State<'_, AppState>, id: String) -> CommandResult<RebuildProfile> {
    if id.trim().is_empty() {
        return Err(CommandError::InvalidInput("Profile ID cannot be empty".into()));
    }

    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    
    let mut stmt = conn.prepare("SELECT id, name, steps_json, is_builtin, created_at FROM rebuild_profiles WHERE id = ?1")
        .map_err(|e| CommandError::Internal(e.to_string()))?;
        
    let row = stmt.query_row(rusqlite::params![id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i32>(3)? == 1,
            row.get::<_, String>(4)?,
        ))
    }).optional().map_err(|e| CommandError::Internal(e.to_string()))?;

    if let Some((id, name, steps_str, is_builtin, created_at)) = row {
        let steps = serde_json::from_str(&steps_str).unwrap_or_else(|_| vec![]);
        Ok(RebuildProfile { id, name, steps, is_builtin, created_at })
    } else {
        Err(CommandError::NotFound("Profile not found".into()))
    }
}

#[tauri::command]
pub async fn create_profile(
    state: tauri::State<'_, AppState>,
    opts: CreateProfileOptions,
) -> CommandResult<RebuildProfile> {
    if opts.name.trim().is_empty() {
        return Err(CommandError::InvalidInput("Profile name cannot be empty".into()));
    }

    let steps_json = serde_json::to_string(&opts.steps)
        .map_err(|e| CommandError::Internal(format!("Failed to serialize steps: {}", e)))?;
        
    let id = Uuid::new_v4().to_string();
    
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    
    let start = Instant::now();
    let res = conn.execute(
        "INSERT INTO rebuild_profiles (id, name, steps_json, is_builtin, created_at) VALUES (?1, ?2, ?3, 0, datetime('now'))",
        rusqlite::params![id, opts.name, steps_json]
    );
    
    let status = if res.is_ok() { "success" } else { "failed" };
    let detail = res.as_ref().err().map(|e| e.to_string());
    
    log_activity(&conn, ActivityEntry {
        server_id: None,
        action: "create_rebuild_profile".into(),
        target: Some(opts.name.clone()),
        status: status.into(),
        detail,
        duration_ms: Some(start.elapsed().as_millis() as i64),
    });
    
    res.map_err(|e| CommandError::Internal(e.to_string()))?;
    
    // Fetch the inserted record to return it with correct created_at
    drop(conn);
    get_profile(state, id).await
}

#[tauri::command]
pub async fn update_profile(
    state: tauri::State<'_, AppState>,
    id: String,
    opts: UpdateProfileOptions,
) -> CommandResult<RebuildProfile> {
    if id.trim().is_empty() || opts.name.trim().is_empty() {
        return Err(CommandError::InvalidInput("ID and Name cannot be empty".into()));
    }

    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    
    // Check if it's builtin
    let is_builtin: i32 = conn.query_row(
        "SELECT is_builtin FROM rebuild_profiles WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get(0)
    ).optional().map_err(|e| CommandError::Internal(e.to_string()))?
    .ok_or_else(|| CommandError::NotFound("Profile not found".into()))?;
    
    if is_builtin == 1 {
        return Err(CommandError::Forbidden("Cannot modify built-in profiles".into()));
    }
    
    let steps_json = serde_json::to_string(&opts.steps)
        .map_err(|e| CommandError::Internal(format!("Failed to serialize steps: {}", e)))?;

    let start = Instant::now();
    let res = conn.execute(
        "UPDATE rebuild_profiles SET name = ?1, steps_json = ?2 WHERE id = ?3",
        rusqlite::params![opts.name, steps_json, id]
    );

    let status = if res.is_ok() { "success" } else { "failed" };
    let detail = res.as_ref().err().map(|e| e.to_string());
    
    log_activity(&conn, ActivityEntry {
        server_id: None,
        action: "update_rebuild_profile".into(),
        target: Some(opts.name.clone()),
        status: status.into(),
        detail,
        duration_ms: Some(start.elapsed().as_millis() as i64),
    });

    res.map_err(|e| CommandError::Internal(e.to_string()))?;

    drop(conn);
    get_profile(state, id).await
}

#[tauri::command]
pub async fn delete_profile(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    if id.trim().is_empty() {
        return Err(CommandError::InvalidInput("Profile ID cannot be empty".into()));
    }

    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    
    // Check if builtin
    let is_builtin: i32 = conn.query_row(
        "SELECT is_builtin FROM rebuild_profiles WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get(0)
    ).optional().map_err(|e| CommandError::Internal(e.to_string()))?
    .ok_or_else(|| CommandError::NotFound("Profile not found".into()))?;
    
    if is_builtin == 1 {
        return Err(CommandError::Forbidden("Cannot delete built-in profiles".into()));
    }
    
    // Check for references in applications table
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM applications WHERE rebuild_profile_id = ?1",
        rusqlite::params![id],
        |row| row.get(0)
    ).map_err(|e| CommandError::Internal(e.to_string()))?;
    
    if count > 0 {
        return Err(CommandError::Forbidden(format!(
            "Cannot delete this profile because it is currently assigned to {} application(s).",
            count
        )));
    }
    
    let start = Instant::now();
    let res = conn.execute(
        "DELETE FROM rebuild_profiles WHERE id = ?1",
        rusqlite::params![id]
    );
    
    let status = if res.is_ok() { "success" } else { "failed" };
    let detail = res.as_ref().err().map(|e| e.to_string());
    
    log_activity(&conn, ActivityEntry {
        server_id: None,
        action: "delete_rebuild_profile".into(),
        target: Some(id.clone()),
        status: status.into(),
        detail,
        duration_ms: Some(start.elapsed().as_millis() as i64),
    });

    res.map_err(|e| CommandError::Internal(e.to_string()))?;
    
    Ok(())
}
