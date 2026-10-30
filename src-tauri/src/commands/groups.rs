use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::error::{CommandResult, CommandError};
use crate::db::{log_activity, ActivityEntry, actions};
use std::time::Instant;
use uuid::Uuid;
use rusqlite::OptionalExtension;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServerGroup {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServerGroupTree {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub children: Vec<ServerGroupTree>,
    pub server_ids: Vec<String>, // member servers
}

/// Helper to recursively build the tree
fn build_tree(groups: &[ServerGroup], memberships: &[(String, String)], parent_id: Option<&String>) -> Vec<ServerGroupTree> {
    let mut result = Vec::new();
    for group in groups {
        if group.parent_id.as_ref() == parent_id {
            // Find children
            let children = build_tree(groups, memberships, Some(&group.id));
            
            // Find server members
            let server_ids: Vec<String> = memberships.iter()
                .filter(|(g_id, _)| g_id == &group.id)
                .map(|(_, s_id)| s_id.clone())
                .collect();
                
            result.push(ServerGroupTree {
                id: group.id.clone(),
                name: group.name.clone(),
                parent_id: group.parent_id.clone(),
                children,
                server_ids,
            });
        }
    }
    result
}

#[tauri::command]
pub async fn list_groups(state: tauri::State<'_, AppState>) -> CommandResult<Vec<ServerGroupTree>> {
    let mut conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    
    // Seed groups if empty
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM server_groups", [], |r| r.get(0))
        .map_err(|e| CommandError::Database(e.to_string()))?;
        
    if count == 0 {
        let tx = conn.transaction()?;
        for name in &["Production", "Development", "Clients"] {
            tx.execute(
                "INSERT INTO server_groups (id, name, parent_id) VALUES (?1, ?2, NULL)",
                rusqlite::params![Uuid::new_v4().to_string(), name]
            )?;
        }
        tx.commit()?;
    }

    // Fetch all groups
    let mut stmt = conn.prepare("SELECT id, name, parent_id FROM server_groups ORDER BY name ASC")
        .map_err(|e| CommandError::Database(e.to_string()))?;
        
    let groups: Vec<ServerGroup> = stmt.query_map([], |row| {
        Ok(ServerGroup {
            id: row.get(0)?,
            name: row.get(1)?,
            parent_id: row.get(2)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    // Fetch all memberships
    let mut stmt = conn.prepare("SELECT group_id, server_id FROM server_group_members")
        .map_err(|e| CommandError::Database(e.to_string()))?;
        
    let memberships: Vec<(String, String)> = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })?.filter_map(|r| r.ok()).collect();

    // Build the tree (top-level nodes have parent_id == None)
    let tree = build_tree(&groups, &memberships, None);
    
    Ok(tree)
}

#[tauri::command]
pub async fn get_group(state: tauri::State<'_, AppState>, id: String) -> CommandResult<ServerGroup> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    let group = conn.query_row(
        "SELECT id, name, parent_id FROM server_groups WHERE id = ?1",
        [&id],
        |row| {
            Ok(ServerGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
            })
        }
    ).optional()
     .map_err(|e| CommandError::Database(e.to_string()))?
     .ok_or_else(|| CommandError::NotFound("Group not found".into()))?;
     
    Ok(group)
}

#[tauri::command]
pub async fn create_group(
    state: tauri::State<'_, AppState>,
    name: String,
    parent_id: Option<String>
) -> CommandResult<ServerGroup> {
    if name.trim().is_empty() {
        return Err(CommandError::Validation("Group name cannot be empty".into()));
    }
    let start = Instant::now();
    let id = Uuid::new_v4().to_string();
    
    {
        let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
        
        // Verify parent exists if provided
        if let Some(pid) = &parent_id {
            let parent_exists: bool = conn.query_row("SELECT 1 FROM server_groups WHERE id = ?1", [pid], |_| Ok(true))
                .unwrap_or(false);
            if !parent_exists {
                return Err(CommandError::Validation("Parent group not found".into()));
            }
        }

        let res = conn.execute(
            "INSERT INTO server_groups (id, name, parent_id) VALUES (?1, ?2, ?3)",
            rusqlite::params![id, name.trim(), parent_id]
        );

        let status = if res.is_ok() { "success" } else { "failed" };
        log_activity(&conn, ActivityEntry {
            server_id: None,
            action: actions::CREATE_GROUP.into(),
            target: Some(name.trim().to_string()),
            status: status.into(),
            detail: res.as_ref().err().map(|e| e.to_string()),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
        
        res.map_err(|e| CommandError::Database(e.to_string()))?;
    }

    get_group(state, id).await
}

#[derive(Deserialize)]
pub struct UpdateGroupPayload {
    pub name: Option<String>,
    /// We use Option<Option<String>> because we might want to update parent_id to NULL (Some(None)), 
    /// keep it unchanged (None), or set it to a new parent (Some(Some(id)))
    pub parent_id: Option<Option<String>>,
}

#[tauri::command]
pub async fn update_group(
    state: tauri::State<'_, AppState>,
    id: String,
    updates: UpdateGroupPayload
) -> CommandResult<ServerGroup> {
    let start = Instant::now();
    
    {
        let mut conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
        
        let tx = conn.transaction()?;
        
        // Ensure group exists
        let existing_name: String = tx.query_row("SELECT name FROM server_groups WHERE id = ?1", [&id], |row| row.get(0))
            .optional()
            .map_err(|e| CommandError::Database(e.to_string()))?
            .ok_or_else(|| CommandError::NotFound("Group not found".into()))?;

        if let Some(name) = &updates.name {
            if name.trim().is_empty() {
                return Err(CommandError::Validation("Group name cannot be empty".into()));
            }
        }
        
        if let Some(Some(pid)) = &updates.parent_id {
            if pid == &id {
                return Err(CommandError::Validation("Group cannot be its own parent".into()));
            }
        }

        let res = (|| -> Result<(), rusqlite::Error> {
            if let Some(name) = &updates.name {
                tx.execute("UPDATE server_groups SET name = ?1 WHERE id = ?2", [&name.trim(), &id.as_str()])?;
            }
            
            if let Some(parent_opt) = &updates.parent_id {
                if let Some(pid) = parent_opt {
                    // Verify parent exists
                    let parent_exists: bool = tx.query_row("SELECT 1 FROM server_groups WHERE id = ?1", [pid], |_| Ok(true))
                        .unwrap_or(false);
                    if !parent_exists {
                        return Err(rusqlite::Error::QueryReturnedNoRows);
                    }
                    
                    tx.execute("UPDATE server_groups SET parent_id = ?1 WHERE id = ?2", [pid, &id])?;
                } else {
                    tx.execute("UPDATE server_groups SET parent_id = NULL WHERE id = ?1", [&id])?;
                }
            }
            Ok(())
        })();

        let status = if res.is_ok() { "success" } else { "failed" };
        
        if res.is_ok() {
            tx.commit()?;
        } else {
            let _ = tx.rollback();
        }
        
        log_activity(&conn, ActivityEntry {
            server_id: None,
            action: actions::UPDATE_GROUP.into(),
            target: Some(existing_name),
            status: status.into(),
            detail: res.as_ref().err().map(|e| e.to_string()),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
        
        res.map_err(|e| CommandError::Database(e.to_string()))?;
    }

    get_group(state, id).await
}

#[tauri::command]
pub async fn delete_group(
    state: tauri::State<'_, AppState>,
    id: String
) -> CommandResult<()> {
    let start = Instant::now();
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    
    let existing_name: String = conn.query_row("SELECT name FROM server_groups WHERE id = ?1", [&id], |row| row.get(0))
        .optional()
        .map_err(|e| CommandError::Database(e.to_string()))?
        .ok_or_else(|| CommandError::NotFound("Group not found".into()))?;
        
    // Check for children groups
    let child_count: i64 = conn.query_row("SELECT COUNT(*) FROM server_groups WHERE parent_id = ?1", [&id], |r| r.get(0))
        .map_err(|e| CommandError::Database(e.to_string()))?;
        
    if child_count > 0 {
        return Err(CommandError::Validation(format!("Cannot delete group '{}' because it has {} child group(s). Remove or reassign them first.", existing_name, child_count)));
    }
    
    // Check for members
    let member_count: i64 = conn.query_row("SELECT COUNT(*) FROM server_group_members WHERE group_id = ?1", [&id], |r| r.get(0))
        .map_err(|e| CommandError::Database(e.to_string()))?;
        
    if member_count > 0 {
        return Err(CommandError::Validation(format!("Cannot delete group '{}' because it contains {} server(s). Remove them first.", existing_name, member_count)));
    }

    let res = conn.execute("DELETE FROM server_groups WHERE id = ?1", [&id]);
    
    let status = if res.is_ok() { "success" } else { "failed" };
    
    log_activity(&conn, ActivityEntry {
        server_id: None,
        action: actions::DELETE_GROUP.into(),
        target: Some(existing_name),
        status: status.into(),
        detail: res.as_ref().err().map(|e| e.to_string()),
        duration_ms: Some(start.elapsed().as_millis() as i64),
    });
    
    res.map_err(|e| CommandError::Database(e.to_string()))?;
    
    Ok(())
}

#[tauri::command]
pub async fn add_server_to_group(
    state: tauri::State<'_, AppState>,
    group_id: String,
    server_id: String
) -> CommandResult<()> {
    let start = Instant::now();
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    
    // Check if it's already there
    let exists: bool = conn.query_row(
        "SELECT 1 FROM server_group_members WHERE group_id = ?1 AND server_id = ?2",
        [&group_id, &server_id],
        |_| Ok(true)
    ).unwrap_or(false);
    
    if exists {
        return Ok(());
    }
    
    let res = conn.execute(
        "INSERT INTO server_group_members (group_id, server_id) VALUES (?1, ?2)",
        [&group_id, &server_id]
    );
    
    let status = if res.is_ok() { "success" } else { "failed" };
    
    log_activity(&conn, ActivityEntry {
        server_id: Some(server_id.clone()),
        action: actions::ADD_SERVER_TO_GROUP.into(),
        target: Some(format!("Group ID: {}", group_id)),
        status: status.into(),
        detail: res.as_ref().err().map(|e| e.to_string()),
        duration_ms: Some(start.elapsed().as_millis() as i64),
    });
    
    res.map_err(|e| CommandError::Database(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn remove_server_from_group(
    state: tauri::State<'_, AppState>,
    group_id: String,
    server_id: String
) -> CommandResult<()> {
    let start = Instant::now();
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    
    let res = conn.execute(
        "DELETE FROM server_group_members WHERE group_id = ?1 AND server_id = ?2",
        [&group_id, &server_id]
    );
    
    let status = if res.is_ok() { "success" } else { "failed" };
    
    log_activity(&conn, ActivityEntry {
        server_id: Some(server_id.clone()),
        action: actions::REMOVE_SERVER_FROM_GROUP.into(),
        target: Some(format!("Group ID: {}", group_id)),
        status: status.into(),
        detail: res.as_ref().err().map(|e| e.to_string()),
        duration_ms: Some(start.elapsed().as_millis() as i64),
    });
    
    res.map_err(|e| CommandError::Database(e.to_string()))?;
    Ok(())
}
