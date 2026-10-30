use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::error::{CommandResult, CommandError};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ActivityLogEntry {
    pub id: String,
    pub server_id: Option<String>,
    pub server_name: Option<String>,
    pub actor: String,
    pub action: String,
    pub target: Option<String>,
    pub status: String,
    pub detail: Option<String>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct ActivityFilters {
    pub server_id: Option<String>,
    pub action: Option<String>,
    pub status: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Returns a filtered, paginated list of recent activity log entries.
/// Server-side filtering to avoid loading unbounded history into the frontend.
#[tauri::command]
pub async fn get_activity_log(
    state: tauri::State<'_, AppState>,
    filters: ActivityFilters,
) -> CommandResult<Vec<ActivityLogEntry>> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;

    let limit = filters.limit.unwrap_or(200).min(500);
    let offset = filters.offset.unwrap_or(0);

    // Build a dynamic WHERE clause from optional filters
    let mut conditions = Vec::new();
    if filters.server_id.is_some() {
        conditions.push("al.server_id = :server_id");
    }
    if filters.action.is_some() {
        conditions.push("al.action = :action");
    }
    if filters.status.is_some() {
        conditions.push("al.status = :status");
    }
    if filters.date_from.is_some() {
        conditions.push("al.created_at >= :date_from");
    }
    if filters.date_to.is_some() {
        conditions.push("al.created_at <= :date_to");
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT al.id, al.server_id, s.name as server_name, al.actor, al.action,
                al.target, al.status, al.detail, al.duration_ms, al.created_at
         FROM activity_log al
         LEFT JOIN servers s ON al.server_id = s.id
         {}
         ORDER BY al.created_at DESC
         LIMIT :limit OFFSET :offset",
        where_clause
    );

    let mut stmt = conn.prepare(&sql)
        .map_err(|e| CommandError::Internal(e.to_string()))?;

    let entries = stmt.query_map(
        rusqlite::named_params! {
            ":server_id": filters.server_id,
            ":action": filters.action,
            ":status": filters.status,
            ":date_from": filters.date_from,
            ":date_to": filters.date_to,
            ":limit": limit,
            ":offset": offset,
        },
        |row| {
            let raw_detail: Option<String> = row.get(7)?;
            let detail = raw_detail.map(|d| crate::secrets::redact::redact_secrets(&d));
            Ok(ActivityLogEntry {
                id: row.get(0)?,
                server_id: row.get(1)?,
                server_name: row.get(2)?,
                actor: row.get(3)?,
                action: row.get(4)?,
                target: row.get(5)?,
                status: row.get(6)?,
                detail,
                duration_ms: row.get(8)?,
                created_at: row.get(9)?,
            })
        }
    ).map_err(|e| CommandError::Internal(e.to_string()))?;

    let mut result = Vec::new();
    for entry in entries {
        result.push(entry.map_err(|e| CommandError::Internal(e.to_string()))?);
    }

    Ok(result)
}

/// Returns the list of distinct action types seen in the activity_log,
/// so the frontend filter dropdown doesn't need a hardcoded list.
#[tauri::command]
pub async fn get_activity_action_types(
    state: tauri::State<'_, AppState>,
) -> CommandResult<Vec<String>> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;

    let mut stmt = conn.prepare("SELECT DISTINCT action FROM activity_log ORDER BY action ASC")
        .map_err(|e| CommandError::Internal(e.to_string()))?;

    let actions: Vec<String> = stmt.query_map([], |row| row.get(0))
        .map_err(|e| CommandError::Internal(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(actions)
}
