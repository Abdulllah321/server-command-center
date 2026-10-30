use crate::AppState;
use crate::error::{CommandError, CommandResult};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct KnownHostInfo {
    pub server_id: String,
    pub server_name: String,
    pub hostname: String,
    pub fingerprint: String,
    pub created_at: String,
}

#[tauri::command]
pub async fn list_known_hosts(
    state: tauri::State<'_, AppState>,
) -> CommandResult<Vec<KnownHostInfo>> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;

    let mut stmt = conn.prepare(
        "SELECT k.server_id, s.name, s.hostname, k.fingerprint, k.created_at
         FROM known_hosts k
         LEFT JOIN servers s ON k.server_id = s.id
         ORDER BY s.name ASC"
    )?;

    let iter = stmt.query_map([], |row| {
        Ok(KnownHostInfo {
            server_id: row.get(0)?,
            server_name: row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "Unknown".to_string()),
            hostname: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "Unknown".to_string()),
            fingerprint: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;

    let mut hosts = Vec::new();
    for host in iter {
        hosts.push(host?);
    }

    Ok(hosts)
}

#[tauri::command]
pub async fn delete_known_host(
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> CommandResult<()> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;

    conn.execute(
        "DELETE FROM known_hosts WHERE server_id = ?1",
        rusqlite::params![server_id],
    )?;

    Ok(())
}
