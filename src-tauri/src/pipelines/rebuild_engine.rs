use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use tauri::{AppHandle, Manager, Emitter};
use crate::AppState;
use crate::error::{CommandResult, CommandError};
use crate::commands::rebuild::RebuildProfile;
use rusqlite::OptionalExtension;
use tokio::time::{timeout, Duration};
use russh::ChannelMsg;
use crate::db::{log_activity, ActivityEntry};
use std::time::Instant;

lazy_static::lazy_static! {
    static ref ACTIVE_PIPELINES: Arc<Mutex<HashMap<String, mpsc::Sender<()>>>> = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Clone, Serialize)]
pub struct StepUpdatePayload {
    pub step_index: usize,
    pub status: String, // pending, running, success, failed, skipped
    pub output: Option<String>,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Serialize)]
pub struct CompletePayload {
    pub status: String, // success, failed, aborted
}

// TODO(security): Implement regex scrubbing for known secrets in output (like NPM_TOKEN)
// before saving to DB and Activity Log, as build scripts can be verbose and leak env vars on error.
fn scrub_output(raw: &str) -> String {
    // For now, return as-is. In a real scenario, run regex replacements.
    raw.to_string()
}

pub async fn run_pipeline(
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
    server_id: String,
    application_id: String,
    profile: RebuildProfile,
    retry_from_step: Option<usize>,
) -> CommandResult<String> {
    use crate::commands::rebuild::RebuildStep;
    
    let mut all_steps = vec![
        RebuildStep {
            label: "Check SSH connection".into(),
            command: "echo 'SSH Connection Alive'".into(),
            continue_on_error: false,
        },
        RebuildStep {
            label: "Check disk space".into(),
            command: "df -m / | awk 'NR==2 {if ($4 < 500) {print \"Insufficient disk space: \" $4 \" MB available. Need at least 500 MB.\"; exit 1} else {print \"Disk space OK: \" $4 \" MB available\"}}'".into(),
            continue_on_error: false,
        }
    ];
    all_steps.extend(profile.steps);
    
    let pipeline_id = Uuid::new_v4().to_string();
    
    // Create DB entry for deployment
    let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
    
    let app_name: String = conn.query_row(
        "SELECT name FROM applications WHERE id = ?1",
        rusqlite::params![application_id],
        |row| row.get(0)
    ).unwrap_or_else(|_| application_id.clone());
    
    conn.execute(
        "INSERT INTO deployments (id, application_id, status, started_at) VALUES (?1, ?2, 'running', datetime('now'))",
        rusqlite::params![pipeline_id, application_id]
    ).map_err(|e| CommandError::Internal(e.to_string()))?;
    
    for (idx, step) in all_steps.iter().enumerate() {
        let step_id = Uuid::new_v4().to_string();
        
        let initial_status = if let Some(retry_idx) = retry_from_step {
            if idx < retry_idx { "success" } else { "pending" }
        } else {
            "pending"
        };
        
        let initial_output = if let Some(retry_idx) = retry_from_step {
            if idx < retry_idx { Some("Skipped (Prior step succeeded in previous run)".to_string()) } else { None }
        } else {
            None
        };
        
        conn.execute(
            "INSERT INTO deployment_steps (id, deployment_id, step_order, label, command, status, output) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![step_id, pipeline_id, idx, step.label, step.command, initial_status, initial_output]
        ).map_err(|e| CommandError::Internal(e.to_string()))?;
        
        if let Some(retry_idx) = retry_from_step {
            if idx < retry_idx {
                app_handle.emit(&format!("pipeline://step-update:{}", pipeline_id), StepUpdatePayload {
                    step_index: idx,
                    status: "success".into(),
                    output: Some("Skipped (Prior step succeeded in previous run)".into()),
                    exit_code: Some(0),
                }).ok();
            }
        }
    }
    
    drop(conn);

    let (cancel_tx, mut cancel_rx) = mpsc::channel(1);
    
    {
        let mut map = ACTIVE_PIPELINES.lock().await;
        map.insert(pipeline_id.clone(), cancel_tx);
    }
    
    let pipeline_id_clone = pipeline_id.clone();
    let app_handle_clone = app_handle.clone();
    let state_clone = state.inner().clone();
    
    tokio::spawn(async move {
        let mut overall_success = true;
        let mut failed_step_info: Option<(String, Option<i32>)> = None;
        let mut all_logs = String::new();
        let pipeline_start = Instant::now();
        
        let session_manager = {
            let sm_guard = state_clone.session_manager.lock().await;
            sm_guard.clone()
        };

        // Try getting session
        let session_result = session_manager.get_or_connect(server_id.clone(), tauri::State::new(state_clone.clone()), app_handle_clone.clone()).await;
        
        if let Ok(mut session) = session_result {
            for (idx, step) in all_steps.iter().enumerate() {
                // If we're retrying and this step is before retry point, skip execution
                if let Some(retry_idx) = retry_from_step {
                    if idx < retry_idx {
                        continue;
                    }
                }
                
                // Check if aborted
                if cancel_rx.try_recv().is_ok() {
                    overall_success = false;
                    failed_step_info = Some((step.label.clone(), None));
                    app_handle_clone.emit(&format!("pipeline://complete:{}", pipeline_id_clone), CompletePayload { status: "aborted".into() }).ok();
                    break;
                }
                
                // Update DB to running
                if let Ok(conn) = state_clone.db.lock() {
                    let _ = conn.execute("UPDATE deployment_steps SET status = 'running', started_at = datetime('now') WHERE deployment_id = ?1 AND step_order = ?2", rusqlite::params![pipeline_id_clone, idx]);
                }
                
                app_handle_clone.emit(&format!("pipeline://step-update:{}", pipeline_id_clone), StepUpdatePayload {
                    step_index: idx,
                    status: "running".into(),
                    output: None,
                    exit_code: None,
                }).ok();
                
                // Execute Step
                // A note on cancellation (abort_pipeline):
                // True, immediate remote process interruption (e.g. sending SIGINT) over raw SSH exec channels is unreliable without a PTY.
                // When we cancel, we drop the channel locally which severs the connection. Some processes handle this (SIGHUP) and die,
                // but detached processes may continue unsupervised.
                
                let mut channel_res = session.channel_open_session().await;
                let mut step_success = false;
                let mut step_output = String::new();
                let mut exit_code: Option<i32> = None;
                
                if let Ok(mut channel) = channel_res {
                    if channel.exec(true, &step.command).await.is_ok() {
                        let timeout_duration = Duration::from_secs(60 * 10); // 10 min timeout per step max
                        
                        loop {
                            tokio::select! {
                                _ = cancel_rx.recv() => {
                                    // Aborted mid-step
                                    overall_success = false;
                                    failed_step_info = Some((step.label.clone(), None));
                                    break;
                                }
                                msg_future = channel.wait() => {
                                    let msg_opt = timeout(timeout_duration, msg_future).await.unwrap_or(Some(ChannelMsg::Close));
                                    match msg_opt {
                                        Some(ChannelMsg::Data { ref data }) => {
                                            step_output.push_str(&String::from_utf8_lossy(data));
                                        }
                                        Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                                            step_output.push_str(&String::from_utf8_lossy(data));
                                        }
                                        Some(ChannelMsg::ExitStatus { exit_status }) => {
                                            exit_code = Some(exit_status as i32);
                                            step_success = exit_status == 0;
                                        }
                                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                                            break;
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                    } else {
                        step_output.push_str("Failed to execute command on SSH channel.\n");
                    }
                } else {
                    step_output.push_str("Failed to open SSH channel.\n");
                }
                
                if !overall_success {
                    // It means we aborted
                    break;
                }
                
                let scrubbed = scrub_output(&step_output);
                all_logs.push_str(&format!("--- STEP: {} ---\n{}\n", step.label, scrubbed));
                
                let final_status = if step_success { "success" } else { "failed" };
                
                if let Ok(conn) = state_clone.db.lock() {
                    let _ = conn.execute(
                        "UPDATE deployment_steps SET status = ?1, output = ?2, exit_code = ?3, finished_at = datetime('now') WHERE deployment_id = ?4 AND step_order = ?5",
                        rusqlite::params![final_status, scrubbed, exit_code, pipeline_id_clone, idx]
                    );
                }
                
                app_handle_clone.emit(&format!("pipeline://step-update:{}", pipeline_id_clone), StepUpdatePayload {
                    step_index: idx,
                    status: final_status.into(),
                    output: Some(scrubbed),
                    exit_code,
                }).ok();
                
                if !step_success && !step.continue_on_error {
                    overall_success = false;
                    failed_step_info = Some((step.label.clone(), exit_code));
                    // Mark remaining as skipped
                    if let Ok(conn) = state_clone.db.lock() {
                        let _ = conn.execute(
                            "UPDATE deployment_steps SET status = 'skipped' WHERE deployment_id = ?1 AND status = 'pending'",
                            rusqlite::params![pipeline_id_clone]
                        );
                    }
                    break;
                }
            }
        } else {
            overall_success = false;
            failed_step_info = Some(("Acquire SSH Session".to_string(), None));
            all_logs.push_str("Failed to acquire SSH session.\n");
        }
        
        // Remove from registry
        {
            let mut map = ACTIVE_PIPELINES.lock().await;
            map.remove(&pipeline_id_clone);
        }
        
        // Finalize deployment
        let final_deploy_status = if overall_success { "success" } else { "failed" };
        
        if let Ok(conn) = state_clone.db.lock() {
            let _ = conn.execute(
                "UPDATE deployments SET status = ?1, log_blob = ?2, finished_at = datetime('now'), duration_ms = ?3 WHERE id = ?4",
                rusqlite::params![final_deploy_status, all_logs, pipeline_start.elapsed().as_millis() as i64, pipeline_id_clone]
            );
            
            let detail = if overall_success {
                format!("Rebuild completed successfully in {} ms.", pipeline_start.elapsed().as_millis())
            } else if let Some((label, code)) = failed_step_info {
                if let Some(c) = code {
                    format!("Pipeline failed at step '{}' with exit code {}.", label, c)
                } else {
                    format!("Pipeline failed or aborted at step '{}'.", label)
                }
            } else {
                "Pipeline failed.".to_string()
            };
            
            log_activity(&conn, ActivityEntry {
                server_id: Some(server_id),
                action: "rebuild".into(),
                target: Some(app_name),
                status: final_deploy_status.into(),
                detail: Some(detail),
                duration_ms: Some(pipeline_start.elapsed().as_millis() as i64),
            });
        }
        
        app_handle_clone.emit(&format!("pipeline://complete:{}", pipeline_id_clone), CompletePayload {
            status: final_deploy_status.into(),
        }).ok();
    });
    
    Ok(pipeline_id)
}

#[tauri::command]
pub async fn trigger_rebuild(
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
    application_id: String,
    profile_id: String,
    retry_from_step: Option<usize>,
) -> CommandResult<String> {
    let (server_id, profile) = {
        let conn = state.db.lock().map_err(|_| CommandError::Internal("DB lock failed".into()))?;
        
        let server_id: String = conn.query_row(
            "SELECT server_id FROM applications WHERE id = ?1",
            rusqlite::params![application_id],
            |row| row.get(0)
        ).optional().map_err(|e| CommandError::Internal(e.to_string()))?
        .ok_or_else(|| CommandError::NotFound("Application not found".into()))?;
        
        let mut stmt = conn.prepare("SELECT id, name, steps_json, is_builtin, created_at FROM rebuild_profiles WHERE id = ?1")
            .map_err(|e| CommandError::Internal(e.to_string()))?;
            
        let row = stmt.query_row(rusqlite::params![profile_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i32>(3)? == 1,
                row.get::<_, String>(4)?,
            ))
        }).optional().map_err(|e| CommandError::Internal(e.to_string()))?;
        
        let profile = if let Some((id, name, steps_str, is_builtin, created_at)) = row {
            let steps = serde_json::from_str(&steps_str).unwrap_or_else(|_| vec![]);
            RebuildProfile { id, name, steps, is_builtin, created_at }
        } else {
            return Err(CommandError::NotFound("Profile not found".into()));
        };
        
        (server_id, profile)
    };
    
    run_pipeline(state, app_handle, server_id, application_id, profile, retry_from_step).await
}

#[tauri::command]
pub async fn abort_pipeline(
    pipeline_id: String,
) -> CommandResult<()> {
    let mut map = ACTIVE_PIPELINES.lock().await;
    if let Some(tx) = map.remove(&pipeline_id) {
        let _ = tx.send(()).await;
        Ok(())
    } else {
        Err(CommandError::NotFound("Pipeline not found or already finished".into()))
    }
}
