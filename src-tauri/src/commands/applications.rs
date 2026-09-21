use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::error::{CommandResult, CommandError};
use rusqlite::OptionalExtension;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Application {
    pub id: String,
    pub server_id: String,
    pub name: String,
    pub repo_path: Option<String>,
    pub pm2_name: Option<String>,
    pub branch: String,
    pub package_mgr: String,
    pub rebuild_profile_id: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct CreateApplicationOptions {
    pub server_id: String,
    pub name: String,
    pub repo_path: Option<String>,
    pub pm2_name: Option<String>,
    pub branch: String,
    pub package_mgr: String,
    pub rebuild_profile_id: Option<String>,
}

#[tauri::command]
pub async fn list_applications(
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> CommandResult<Vec<Application>> {
    if server_id.trim().is_empty() {
        return Err(CommandError::InvalidInput("Server ID cannot be empty".into()));
    }

    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    let mut stmt = conn.prepare("SELECT id, server_id, name, repo_path, pm2_name, branch, package_mgr, rebuild_profile_id, created_at FROM applications WHERE server_id = ?1 ORDER BY name ASC")
        .map_err(|e| CommandError::Internal(e.to_string()))?;
        
    let rows = stmt.query_map(rusqlite::params![server_id], |row| {
        Ok(Application {
            id: row.get(0)?,
            server_id: row.get(1)?,
            name: row.get(2)?,
            repo_path: row.get(3)?,
            pm2_name: row.get(4)?,
            branch: row.get(5)?,
            package_mgr: row.get(6)?,
            rebuild_profile_id: row.get(7)?,
            created_at: row.get(8)?,
        })
    }).map_err(|e| CommandError::Internal(e.to_string()))?;

    let mut apps = Vec::new();
    for row_res in rows {
        apps.push(row_res.map_err(|e| CommandError::Internal(e.to_string()))?);
    }

    Ok(apps)
}

#[tauri::command]
pub async fn create_application(
    state: tauri::State<'_, AppState>,
    opts: CreateApplicationOptions,
) -> CommandResult<Application> {
    if opts.name.trim().is_empty() || opts.server_id.trim().is_empty() {
        return Err(CommandError::InvalidInput("Server ID and Name cannot be empty".into()));
    }

    let id = Uuid::new_v4().to_string();
    
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    conn.execute(
        "INSERT INTO applications (id, server_id, name, repo_path, pm2_name, branch, package_mgr, rebuild_profile_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))",
        rusqlite::params![id, opts.server_id, opts.name, opts.repo_path, opts.pm2_name, opts.branch, opts.package_mgr, opts.rebuild_profile_id]
    ).map_err(|e| CommandError::Internal(e.to_string()))?;
    
    // Fetch inserted record
    let mut stmt = conn.prepare("SELECT id, server_id, name, repo_path, pm2_name, branch, package_mgr, rebuild_profile_id, created_at FROM applications WHERE id = ?1")
        .map_err(|e| CommandError::Internal(e.to_string()))?;
        
    let app = stmt.query_row(rusqlite::params![id], |row| {
        Ok(Application {
            id: row.get(0)?,
            server_id: row.get(1)?,
            name: row.get(2)?,
            repo_path: row.get(3)?,
            pm2_name: row.get(4)?,
            branch: row.get(5)?,
            package_mgr: row.get(6)?,
            rebuild_profile_id: row.get(7)?,
            created_at: row.get(8)?,
        })
    }).optional().map_err(|e| CommandError::Internal(e.to_string()))?
    .ok_or_else(|| CommandError::Internal("Failed to retrieve created application".into()))?;
    
    Ok(app)
}

#[tauri::command]
pub async fn delete_application(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    if id.trim().is_empty() {
        return Err(CommandError::InvalidInput("Application ID cannot be empty".into()));
    }

    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    conn.execute(
        "DELETE FROM applications WHERE id = ?1",
        rusqlite::params![id]
    ).map_err(|e| CommandError::Internal(e.to_string()))?;
    
    Ok(())
}
