use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::error::{CommandResult, CommandError};
use crate::db::{log_activity, ActivityEntry};
use rusqlite::OptionalExtension;
use uuid::Uuid;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScheduledRebuild {
    pub id: String,
    pub server_id: String,
    pub application_id: Option<String>,
    pub app_name: String,
    pub service_type: String, // "frontend", "backend", "both", "custom"
    pub mode: String,         // "zero_downtime", "direct"
    pub profile_id: Option<String>,
    pub scheduled_for: String, // ISO 8601 string
    pub recurring: Option<String>, // NULL, "nightly_3am", "daily", etc.
    pub status: String,       // "pending", "running", "completed", "failed", "cancelled"
    pub last_run_at: Option<String>,
    pub last_log: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize, Debug)]
pub struct ScheduleRebuildOptions {
    pub server_id: String,
    pub application_id: Option<String>,
    pub app_name: String,
    pub service_type: String, // "frontend", "backend", "both", "custom"
    pub mode: String,         // "zero_downtime", "direct"
    pub profile_id: Option<String>,
    pub scheduled_for: String, // ISO 8601 string (e.g. 2026-11-01T03:00:00)
    pub recurring: Option<String>, // "nightly_3am", "daily", or None
}

#[derive(Clone, Serialize)]
pub struct ScheduledRebuildEvent {
    pub id: String,
    pub server_id: String,
    pub app_name: String,
    pub status: String,
    pub log: Option<String>,
}

#[tauri::command]
pub async fn schedule_rebuild(
    state: tauri::State<'_, AppState>,
    opts: ScheduleRebuildOptions,
) -> CommandResult<ScheduledRebuild> {
    if opts.server_id.trim().is_empty() {
        return Err(CommandError::InvalidInput("Server ID cannot be empty".into()));
    }
    if opts.scheduled_for.trim().is_empty() {
        return Err(CommandError::InvalidInput("Scheduled time cannot be empty".into()));
    }

    let id = Uuid::new_v4().to_string();
    let start = Instant::now();

    {
        let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
        conn.execute(
            "INSERT INTO scheduled_rebuilds (
                id, server_id, application_id, app_name, service_type, mode, 
                profile_id, scheduled_for, recurring, status, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', datetime('now'))",
            rusqlite::params![
                id,
                opts.server_id,
                opts.application_id,
                opts.app_name,
                opts.service_type,
                opts.mode,
                opts.profile_id,
                opts.scheduled_for,
                opts.recurring,
            ]
        ).map_err(|e| CommandError::Internal(format!("Failed to schedule rebuild: {}", e)))?;

        log_activity(&conn, ActivityEntry {
            server_id: Some(opts.server_id.clone()),
            action: "schedule_rebuild".into(),
            target: Some(format!("{} (at {})", opts.app_name, opts.scheduled_for)),
            status: "success".into(),
            detail: Some(format!("Mode: {}, Service: {}, Recurring: {:?}", opts.mode, opts.service_type, opts.recurring)),
            duration_ms: Some(start.elapsed().as_millis() as i64),
        });
    }

    get_scheduled_rebuild(state, id).await
}

#[tauri::command]
pub async fn get_scheduled_rebuild(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<ScheduledRebuild> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    let mut stmt = conn.prepare(
        "SELECT id, server_id, application_id, app_name, service_type, mode, profile_id, scheduled_for, recurring, status, last_run_at, last_log, created_at 
         FROM scheduled_rebuilds WHERE id = ?1"
    ).map_err(|e| CommandError::Internal(e.to_string()))?;

    let item = stmt.query_row(rusqlite::params![id], |row| {
        Ok(ScheduledRebuild {
            id: row.get(0)?,
            server_id: row.get(1)?,
            application_id: row.get(2)?,
            app_name: row.get(3)?,
            service_type: row.get(4)?,
            mode: row.get(5)?,
            profile_id: row.get(6)?,
            scheduled_for: row.get(7)?,
            recurring: row.get(8)?,
            status: row.get(9)?,
            last_run_at: row.get(10)?,
            last_log: row.get(11)?,
            created_at: row.get(12)?,
        })
    }).optional().map_err(|e| CommandError::Internal(e.to_string()))?
    .ok_or_else(|| CommandError::NotFound("Scheduled rebuild not found".into()))?;

    Ok(item)
}

#[tauri::command]
pub async fn list_scheduled_rebuilds(
    state: tauri::State<'_, AppState>,
    server_id: Option<String>,
) -> CommandResult<Vec<ScheduledRebuild>> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    
    let query = match server_id {
        Some(_) => "SELECT id, server_id, application_id, app_name, service_type, mode, profile_id, scheduled_for, recurring, status, last_run_at, last_log, created_at 
                    FROM scheduled_rebuilds 
                    WHERE server_id = ?1 AND status != 'cancelled' 
                    ORDER BY datetime(scheduled_for) ASC",
        None => "SELECT id, server_id, application_id, app_name, service_type, mode, profile_id, scheduled_for, recurring, status, last_run_at, last_log, created_at 
                 FROM scheduled_rebuilds 
                 WHERE status != 'cancelled' 
                 ORDER BY datetime(scheduled_for) ASC",
    };

    let mut stmt = conn.prepare(query).map_err(|e| CommandError::Internal(e.to_string()))?;
    
    let params: Vec<&dyn rusqlite::ToSql> = match server_id {
        Some(ref sid) => vec![sid],
        None => vec![],
    };

    let rows = stmt.query_map(rusqlite::params_from_iter(params), |row| {
        Ok(ScheduledRebuild {
            id: row.get(0)?,
            server_id: row.get(1)?,
            application_id: row.get(2)?,
            app_name: row.get(3)?,
            service_type: row.get(4)?,
            mode: row.get(5)?,
            profile_id: row.get(6)?,
            scheduled_for: row.get(7)?,
            recurring: row.get(8)?,
            status: row.get(9)?,
            last_run_at: row.get(10)?,
            last_log: row.get(11)?,
            created_at: row.get(12)?,
        })
    }).map_err(|e| CommandError::Internal(e.to_string()))?;

    let mut items = Vec::new();
    for r in rows {
        if let Ok(item) = r {
            items.push(item);
        }
    }

    Ok(items)
}

#[tauri::command]
pub async fn cancel_scheduled_rebuild(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    conn.execute(
        "UPDATE scheduled_rebuilds SET status = 'cancelled' WHERE id = ?1",
        rusqlite::params![id],
    ).map_err(|e| CommandError::Internal(e.to_string()))?;

    log_activity(&conn, ActivityEntry {
        server_id: None,
        action: "cancel_scheduled_rebuild".into(),
        target: Some(id),
        status: "success".into(),
        detail: Some("User cancelled scheduled deployment".into()),
        duration_ms: Some(0),
    });

    Ok(())
}

#[tauri::command]
pub async fn run_scheduled_rebuild_now(
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
    id: String,
) -> CommandResult<String> {
    let item = get_scheduled_rebuild(state.clone(), id.clone()).await?;

    let application_id = item.application_id.clone().ok_or_else(|| {
        CommandError::InvalidInput("No application linked to this scheduled rebuild".into())
    })?;

    let profile_id = item.profile_id.clone().unwrap_or_default();

    {
        let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
        conn.execute(
            "UPDATE scheduled_rebuilds SET status = 'running', last_run_at = datetime('now') WHERE id = ?1",
            rusqlite::params![id],
        ).ok();
    }

    let pid = crate::pipelines::rebuild_engine::trigger_rebuild(
        state.clone(),
        app_handle,
        application_id,
        profile_id,
        None,
    ).await?;

    Ok(pid)
}

/// Starts the background scheduler loop that evaluates pending rebuilds every 30 seconds
pub fn start_rebuild_scheduler(
    db_arc: Arc<std::sync::Mutex<rusqlite::Connection>>,
    app_handle: AppHandle,
    session_manager: crate::ssh::session_manager::SessionManager,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;

            // Check for jobs that are due
            let due_jobs: Vec<ScheduledRebuild> = {
                if let Ok(conn) = db_arc.lock() {
                    let mut stmt = match conn.prepare(
                        "SELECT id, server_id, application_id, app_name, service_type, mode, profile_id, scheduled_for, recurring, status, last_run_at, last_log, created_at 
                         FROM scheduled_rebuilds 
                         WHERE status = 'pending' AND datetime(scheduled_for) <= datetime('now')"
                    ) {
                        Ok(s) => s,
                        Err(_) => continue,
                    };

                    let rows = stmt.query_map([], |row| {
                        Ok(ScheduledRebuild {
                            id: row.get(0)?,
                            server_id: row.get(1)?,
                            application_id: row.get(2)?,
                            app_name: row.get(3)?,
                            service_type: row.get(4)?,
                            mode: row.get(5)?,
                            profile_id: row.get(6)?,
                            scheduled_for: row.get(7)?,
                            recurring: row.get(8)?,
                            status: row.get(9)?,
                            last_run_at: row.get(10)?,
                            last_log: row.get(11)?,
                            created_at: row.get(12)?,
                        })
                    });

                    if let Ok(mapped) = rows {
                        mapped.filter_map(|r| r.ok()).collect()
                    } else {
                        vec![]
                    }
                } else {
                    vec![]
                }
            };

            for job in due_jobs {
                log::info!("Executing scheduled rebuild '{}' (id: {}) for server {}", job.app_name, job.id, job.server_id);

                // Mark running
                if let Ok(conn) = db_arc.lock() {
                    let _ = conn.execute(
                        "UPDATE scheduled_rebuilds SET status = 'running', last_run_at = datetime('now') WHERE id = ?1",
                        rusqlite::params![job.id],
                    );
                    log_activity(&conn, ActivityEntry {
                        server_id: Some(job.server_id.clone()),
                        action: "scheduled_rebuild_executed".into(),
                        target: Some(job.app_name.clone()),
                        status: "running".into(),
                        detail: Some(format!("Mode: {}, Service: {}", job.mode, job.service_type)),
                        duration_ms: None,
                    });
                }

                app_handle.emit("rebuild://scheduled-update", ScheduledRebuildEvent {
                    id: job.id.clone(),
                    server_id: job.server_id.clone(),
                    app_name: job.app_name.clone(),
                    status: "running".into(),
                    log: Some("Scheduler triggered rebuild execution".into()),
                }).ok();

                // If application_id is provided, execute the pipeline
                let db_inner = db_arc.clone();
                let app_handle_inner = app_handle.clone();
                let session_mgr_inner = session_manager.clone();
                let job_clone = job.clone();

                tauri::async_runtime::spawn(async move {
                    let mut exec_success = true;
                    let mut summary_log = String::new();

                    // If linked application exists, run pipeline
                    if let Some(ref app_id) = job_clone.application_id {
                        // Connect to SSH to verify connectivity
                        let session_res = session_mgr_inner.get_or_connect(
                            job_clone.server_id.clone(), 
                            db_inner.clone(), 
                            app_handle_inner.clone()
                        ).await;

                        match session_res {
                            Ok(session_arc) => {
                                let session = session_arc.lock().await;
                                summary_log.push_str("Connected to server successfully.\n");

                                // Fetch application details
                                let app_meta = {
                                    if let Ok(conn) = db_inner.lock() {
                                        conn.query_row(
                                            "SELECT repo_path, pm2_name FROM applications WHERE id = ?1",
                                            rusqlite::params![app_id],
                                            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?))
                                        ).ok()
                                    } else {
                                        None
                                    }
                                };

                                if let Some((Some(repo_path), pm2_name)) = app_meta {
                                    let pm2 = pm2_name.unwrap_or_else(|| job_clone.app_name.clone());
                                    
                                    // Generate execution commands based on mode
                                    let script = if job_clone.mode == "zero_downtime" {
                                        // Zero downtime parallel build with atomic swap
                                        format!(
                                            "cd \"{repo}\" && export NODE_OPTIONS=\"--max-old-space-size=3072\" && \
                                             git fetch origin -q && git pull origin main -q && \
                                             rm -rf _build_tmp && mkdir -p _build_tmp && \
                                             rsync -a --exclude='node_modules' --exclude='.next' --exclude='dist' ./ _build_tmp/ && \
                                             (cd _build_tmp && (bun install --silent || npm install --silent) && (bun run build || npm run build)) && \
                                             (rm -rf .next.bak && [ -d .next ] && mv .next .next.bak || true) && \
                                             mv _build_tmp/.next .next && rm -rf _build_tmp && \
                                             (pm2 reload \"{pm2}\" --update-env || pm2 restart \"{pm2}\" --update-env)",
                                            repo = repo_path,
                                            pm2 = pm2
                                        )
                                    } else {
                                        // Direct in-place rebuild with downtime
                                        format!(
                                            "cd \"{repo}\" && git fetch origin -q && git pull origin main -q && \
                                             (bun install --silent || npm install --silent) && \
                                             (bun run build || npm run build) && \
                                             pm2 restart \"{pm2}\"",
                                            repo = repo_path,
                                            pm2 = pm2
                                        )
                                    };

                                    if let Ok(ch) = session.channel_open_session().await {
                                        if ch.exec(true, script.as_str()).await.is_ok() {
                                            summary_log.push_str("Executed build pipeline over SSH.\n");
                                        } else {
                                            exec_success = false;
                                            summary_log.push_str("Failed to execute command over SSH channel.\n");
                                        }
                                    } else {
                                        exec_success = false;
                                        summary_log.push_str("Failed to open SSH session channel.\n");
                                    }
                                } else {
                                    exec_success = false;
                                    summary_log.push_str("Application repo path not configured.\n");
                                }
                            }
                            Err(e) => {
                                exec_success = false;
                                summary_log.push_str(&format!("SSH connection failed: {}\n", e));
                            }
                        }
                    } else {
                        exec_success = false;
                        summary_log.push_str("No application ID attached to scheduled rebuild.\n");
                    }

                    let final_status = if exec_success { "completed" } else { "failed" };

                    // Update job status in DB
                    if let Ok(conn) = db_inner.lock() {
                        let _ = conn.execute(
                            "UPDATE scheduled_rebuilds SET status = ?1, last_log = ?2 WHERE id = ?3",
                            rusqlite::params![final_status, summary_log, job_clone.id],
                        );

                        log_activity(&conn, ActivityEntry {
                            server_id: Some(job_clone.server_id.clone()),
                            action: "scheduled_rebuild_finish".into(),
                            target: Some(job_clone.app_name.clone()),
                            status: final_status.into(),
                            detail: Some(summary_log.clone()),
                            duration_ms: None,
                        });

                        // If recurring nightly, schedule for tomorrow at 3:00 AM!
                        if job_clone.recurring.as_deref() == Some("nightly_3am") {
                            let next_id = Uuid::new_v4().to_string();
                            let _ = conn.execute(
                                "INSERT INTO scheduled_rebuilds (
                                    id, server_id, application_id, app_name, service_type, mode, 
                                    profile_id, scheduled_for, recurring, status, created_at
                                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now', '+1 day', 'start of day', '+3 hours'), 'nightly_3am', 'pending', datetime('now'))",
                                rusqlite::params![
                                    next_id,
                                    job_clone.server_id,
                                    job_clone.application_id,
                                    job_clone.app_name,
                                    job_clone.service_type,
                                    job_clone.mode,
                                    job_clone.profile_id,
                                ]
                            );
                        }
                    }

                    app_handle_inner.emit("rebuild://scheduled-update", ScheduledRebuildEvent {
                        id: job_clone.id.clone(),
                        server_id: job_clone.server_id.clone(),
                        app_name: job_clone.app_name.clone(),
                        status: final_status.into(),
                        log: Some(summary_log),
                    }).ok();
                });
            }
        }
    });
}

