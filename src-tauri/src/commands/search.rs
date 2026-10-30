use serde::Serialize;
use crate::AppState;
use crate::error::{CommandResult, CommandError};

const MAX_PER_GROUP: i64 = 8;

#[derive(Serialize, Clone, Debug)]
pub struct SearchServer {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub environment: String,
    pub status: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct SearchApplication {
    pub id: String,
    pub name: String,
    pub server_id: String,
    pub server_name: Option<String>,
    pub branch: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct SearchRebuildProfile {
    pub id: String,
    pub name: String,
    pub is_builtin: bool,
    pub step_count: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct SearchCommand {
    pub id: String,
    pub name: String,
    pub command: String,
    pub is_destructive: bool,
    pub server_id: Option<String>,
    pub server_name: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct SearchResults {
    pub servers: Vec<SearchServer>,
    pub applications: Vec<SearchApplication>,
    pub rebuild_profiles: Vec<SearchRebuildProfile>,
    pub commands: Vec<SearchCommand>,
}

/// Global search across servers, applications, rebuild profiles, and commands.
/// Returns at most MAX_PER_GROUP results per group.
/// Returns empty results for queries shorter than 2 characters.
#[tauri::command]
pub async fn global_search(
    state: tauri::State<'_, AppState>,
    query: String,
) -> CommandResult<SearchResults> {
    if query.trim().len() < 2 {
        return Ok(SearchResults {
            servers: vec![],
            applications: vec![],
            rebuild_profiles: vec![],
            commands: vec![],
        });
    }

    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    let pattern = format!("%{}%", query.trim().to_lowercase());

    // Search servers: name, hostname, tags (via join)
    let mut stmt = conn.prepare(
        "SELECT DISTINCT s.id, s.name, s.hostname, s.environment, COALESCE(s.status, 'unknown')
         FROM servers s
         LEFT JOIN server_tags st ON s.id = st.server_id
         WHERE lower(s.name) LIKE ?1 OR lower(s.hostname) LIKE ?1 OR lower(COALESCE(st.tag, '')) LIKE ?1
         ORDER BY s.name ASC
         LIMIT ?2"
    ).map_err(|e| CommandError::Internal(e.to_string()))?;

    let servers: Vec<SearchServer> = stmt.query_map(
        rusqlite::params![pattern, MAX_PER_GROUP],
        |row| Ok(SearchServer {
            id: row.get(0)?,
            name: row.get(1)?,
            hostname: row.get(2)?,
            environment: row.get(3)?,
            status: row.get(4)?,
        })
    ).map_err(|e| CommandError::Internal(e.to_string()))?
    .filter_map(|r| r.ok())
    .collect();

    // Search applications: name
    let mut stmt = conn.prepare(
        "SELECT a.id, a.name, a.server_id, s.name as server_name, a.branch
         FROM applications a
         LEFT JOIN servers s ON a.server_id = s.id
         WHERE lower(a.name) LIKE ?1
         ORDER BY a.name ASC
         LIMIT ?2"
    ).map_err(|e| CommandError::Internal(e.to_string()))?;

    let applications: Vec<SearchApplication> = stmt.query_map(
        rusqlite::params![pattern, MAX_PER_GROUP],
        |row| Ok(SearchApplication {
            id: row.get(0)?,
            name: row.get(1)?,
            server_id: row.get(2)?,
            server_name: row.get(3)?,
            branch: row.get(4)?,
        })
    ).map_err(|e| CommandError::Internal(e.to_string()))?
    .filter_map(|r| r.ok())
    .collect();

    // Search rebuild profiles: name
    let mut stmt = conn.prepare(
        "SELECT id, name, is_builtin,
         (SELECT COUNT(*) FROM json_each(steps_json)) as step_count
         FROM rebuild_profiles
         WHERE lower(name) LIKE ?1
         ORDER BY name ASC
         LIMIT ?2"
    ).map_err(|e| CommandError::Internal(e.to_string()))?;

    let rebuild_profiles: Vec<SearchRebuildProfile> = stmt.query_map(
        rusqlite::params![pattern, MAX_PER_GROUP],
        |row| Ok(SearchRebuildProfile {
            id: row.get(0)?,
            name: row.get(1)?,
            is_builtin: row.get::<_, i32>(2)? == 1,
            step_count: row.get(3)?,
        })
    ).map_err(|e| CommandError::Internal(e.to_string()))?
    .filter_map(|r| r.ok())
    .collect();

    // Search commands: name (both global library and server-specific)
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.command, c.is_destructive, c.server_id, s.name as server_name
         FROM commands c
         LEFT JOIN servers s ON c.server_id = s.id
         WHERE lower(c.name) LIKE ?1
         ORDER BY c.name ASC
         LIMIT ?2"
    ).map_err(|e| CommandError::Internal(e.to_string()))?;

    let commands: Vec<SearchCommand> = stmt.query_map(
        rusqlite::params![pattern, MAX_PER_GROUP],
        |row| Ok(SearchCommand {
            id: row.get(0)?,
            name: row.get(1)?,
            command: row.get(2)?,
            is_destructive: row.get::<_, i32>(3)? == 1,
            server_id: row.get(4)?,
            server_name: row.get(5)?,
        })
    ).map_err(|e| CommandError::Internal(e.to_string()))?
    .filter_map(|r| r.ok())
    .collect();

    Ok(SearchResults {
        servers,
        applications,
        rebuild_profiles,
        commands,
    })
}
