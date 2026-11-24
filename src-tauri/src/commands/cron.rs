use std::time::Instant;
use russh::ChannelMsg;
use russh::client::Handle;
use serde::{Deserialize, Serialize};
use tokio::time::{timeout, Duration};

use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::ssh::client::SshClientHandler;
use crate::db::{log_activity, ActivityEntry, actions};
use crate::commands::confirmation::consume_token;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronJobItem {
    pub id: String,
    pub schedule: String,
    pub command: String,
    pub comment: Option<String>,
    pub enabled: bool,
    pub is_system: bool,
    pub human_readable: String,
    pub raw_line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveCronJobPayload {
    pub id: Option<String>,
    pub schedule: String,
    pub command: String,
    pub comment: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronRunResult {
    pub exit_code: Option<u32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub success: bool,
}

struct SshOutput {
    stdout: String,
    stderr: String,
    exit_status: Option<u32>,
}

async fn exec_ssh_command_full(
    session: &mut Handle<SshClientHandler>,
    cmd: &str,
    timeout_duration: Duration,
) -> Result<SshOutput, CommandError> {
    let mut channel = session.channel_open_session().await
        .map_err(|e| CommandError::Internal(format!("Failed to open SSH channel: {}", e)))?;

    channel.exec(true, cmd).await
        .map_err(|e| CommandError::Internal(format!("Failed to exec command '{}': {}", cmd, e)))?;

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut exit_code = None;

    loop {
        let msg_future = channel.wait();
        let msg_opt = match timeout(timeout_duration, msg_future).await {
            Ok(opt) => opt,
            Err(_) => {
                let _ = channel.close().await;
                return Err(CommandError::Internal("Cron command timed out on remote server".into()));
            }
        };

        match msg_opt {
            Some(ChannelMsg::Data { ref data }) => {
                stdout.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                stderr.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = Some(exit_status);
            }
            Some(ChannelMsg::Eof) => {}
            Some(ChannelMsg::Close) | None => {
                break;
            }
            _ => {}
        }
    }

    let _ = channel.close().await;
    if exit_code.is_none() {
        exit_code = Some(0);
    }
    Ok(SshOutput { stdout, stderr, exit_status: exit_code })
}

/// Converts a 5-field cron expression or shorthand into a human-readable English string
pub fn cron_to_human(cron: &str) -> String {
    let trimmed = cron.trim();
    if trimmed.is_empty() {
        return "Invalid schedule".to_string();
    }

    match trimmed {
        "@reboot" => return "At system startup / reboot".to_string(),
        "@yearly" | "@annually" => return "Once a year on January 1st at midnight".to_string(),
        "@monthly" => return "Once a month on the 1st at midnight".to_string(),
        "@weekly" => return "Once a week on Sunday at midnight".to_string(),
        "@daily" | "@midnight" => return "Every day at midnight (00:00)".to_string(),
        "@hourly" => return "Every hour at minute 0".to_string(),
        _ => {}
    }

    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.len() < 5 {
        return format!("Custom ({})", trimmed);
    }

    let (minute, hour, dom, month, dow) = (parts[0], parts[1], parts[2], parts[3], parts[4]);

    if minute == "*" && hour == "*" && dom == "*" && month == "*" && dow == "*" {
        return "Every minute".to_string();
    }

    if minute.starts_with("*/") && hour == "*" && dom == "*" && month == "*" && dow == "*" {
        let mins = &minute[2..];
        return format!("Every {} minutes", mins);
    }

    if minute == "0" && hour == "*" && dom == "*" && month == "*" && dow == "*" {
        return "Every hour at minute 0".to_string();
    }

    if minute.starts_with("*/") && hour.starts_with("*/") {
        return format!("Every {} mins, every {} hrs", &minute[2..], &hour[2..]);
    }

    if dom == "*" && month == "*" && dow == "*" {
        if let (Ok(h), Ok(m)) = (hour.parse::<u32>(), minute.parse::<u32>()) {
            return format!("Daily at {:02}:{:02}", h, m);
        }
    }

    if dom == "*" && month == "*" {
        let dow_name = match dow {
            "0" | "7" => "Sunday",
            "1" => "Monday",
            "2" => "Tuesday",
            "3" => "Wednesday",
            "4" => "Thursday",
            "5" => "Friday",
            "6" => "Saturday",
            "1-5" => "Monday through Friday",
            "6,0" | "0,6" => "Weekends",
            _ => dow,
        };
        if let (Ok(h), Ok(m)) = (hour.parse::<u32>(), minute.parse::<u32>()) {
            return format!("Every {} at {:02}:{:02}", dow_name, h, m);
        }
        return format!("Every {} at minute {}", dow_name, minute);
    }

    if month == "*" && dow == "*" {
        if let (Ok(h), Ok(m)) = (hour.parse::<u32>(), minute.parse::<u32>()) {
            return format!("Day {} of every month at {:02}:{:02}", dom, h, m);
        }
    }

    format!("At schedule: {}", trimmed)
}

fn generate_deterministic_id(line: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    line.trim().hash(&mut hasher);
    format!("cron_{:x}", hasher.finish())
}

fn parse_crontab_content(raw: &str) -> Vec<CronJobItem> {
    let mut jobs = Vec::new();
    let mut last_comment: Option<String> = None;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            last_comment = None;
            continue;
        }

        // Variable assignment like PATH=... or MAILTO=...
        if (trimmed.starts_with("PATH=") || trimmed.starts_with("MAILTO=") || trimmed.starts_with("SHELL=")) 
            && !trimmed.contains(" * ") {
            continue;
        }

        // Check if line is a comment
        if trimmed.starts_with('#') {
            let without_hash = trimmed.trim_start_matches('#').trim();
            // Check if it's a commented-out cron job
            let parts: Vec<&str> = without_hash.split_whitespace().collect();
            let is_commented_cron = (parts.len() >= 6 && parts[..5].iter().all(|p| {
                p.starts_with('*') || p.starts_with('@') || p.parse::<u32>().is_ok() || p.contains('/') || p.contains(',') || p.contains('-')
            })) || without_hash.starts_with("@reboot") || without_hash.starts_with("@daily") || without_hash.starts_with("@hourly");

            if is_commented_cron {
                let (schedule, cmd) = if without_hash.starts_with('@') {
                    let mut split = without_hash.splitn(2, ' ');
                    (split.next().unwrap_or("").to_string(), split.next().unwrap_or("").to_string())
                } else {
                    let sched = parts[..5].join(" ");
                    let cmd_part = without_hash.splitn(6, ' ').nth(5).unwrap_or("").to_string();
                    (sched, cmd_part)
                };

                let job_id = generate_deterministic_id(line);
                jobs.push(CronJobItem {
                    id: job_id,
                    schedule: schedule.clone(),
                    command: cmd,
                    comment: last_comment.take(),
                    enabled: false,
                    is_system: false,
                    human_readable: cron_to_human(&schedule),
                    raw_line: line.to_string(),
                });
            } else {
                last_comment = Some(without_hash.to_string());
            }
            continue;
        }

        // Active cron job
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        let is_cron = (parts.len() >= 6 && parts[..5].iter().all(|p| {
            p.starts_with('*') || p.starts_with('@') || p.parse::<u32>().is_ok() || p.contains('/') || p.contains(',') || p.contains('-')
        })) || trimmed.starts_with('@');

        if is_cron {
            let (schedule, cmd) = if trimmed.starts_with('@') {
                let mut split = trimmed.splitn(2, ' ');
                (split.next().unwrap_or("").to_string(), split.next().unwrap_or("").to_string())
            } else {
                let sched = parts[..5].join(" ");
                let cmd_part = trimmed.splitn(6, ' ').nth(5).unwrap_or("").to_string();
                (sched, cmd_part)
            };

            let job_id = generate_deterministic_id(line);
            jobs.push(CronJobItem {
                id: job_id,
                schedule: schedule.clone(),
                command: cmd,
                comment: last_comment.take(),
                enabled: true,
                is_system: false,
                human_readable: cron_to_human(&schedule),
                raw_line: line.to_string(),
            });
        } else {
            last_comment = None;
        }
    }

    jobs
}

#[tauri::command]
pub async fn list_server_cron_jobs(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<Vec<CronJobItem>> {
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let script = r#"bash -c 'crontab -l 2>/dev/null || true'"#;
    let out = exec_ssh_command_full(&mut session, script, Duration::from_secs(10)).await?;

    let jobs = parse_crontab_content(&out.stdout);
    Ok(jobs)
}

#[tauri::command]
pub async fn save_server_cron_job(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    job: SaveCronJobPayload,
    confirmation_token: Option<String>,
) -> CommandResult<CronJobItem> {
    if job.schedule.trim().is_empty() {
        return Err(CommandError::Validation("Cron schedule expression cannot be empty".into()));
    }
    if job.command.trim().is_empty() {
        return Err(CommandError::Validation("Command cannot be empty".into()));
    }

    if let Some(token) = &confirmation_token {
        consume_token(Some(token)).await?;
    }

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    // Read existing crontab
    let out = exec_ssh_command_full(&mut session, "bash -c 'crontab -l 2>/dev/null || true'", Duration::from_secs(10)).await?;
    let existing_raw = out.stdout;

    let target_id = job.id.clone();
    let mut new_lines = Vec::new();
    let mut replaced = false;

    let clean_sched = job.schedule.trim();
    let clean_cmd = job.command.trim();
    let line_str = if job.enabled {
        format!("{} {}", clean_sched, clean_cmd)
    } else {
        format!("# {} {}", clean_sched, clean_cmd)
    };

    if let Some(id_to_replace) = &target_id {
        for line in existing_raw.lines() {
            let line_id = generate_deterministic_id(line);
            if line_id == *id_to_replace {
                if let Some(c) = &job.comment {
                    if !c.trim().is_empty() {
                        new_lines.push(format!("# {}", c.trim()));
                    }
                }
                new_lines.push(line_str.clone());
                replaced = true;
            } else {
                new_lines.push(line.to_string());
            }
        }
    }

    if !replaced {
        for line in existing_raw.lines() {
            if !line.trim().is_empty() {
                new_lines.push(line.to_string());
            }
        }
        if let Some(c) = &job.comment {
            if !c.trim().is_empty() {
                new_lines.push(format!("# {}", c.trim()));
            }
        }
        new_lines.push(line_str.clone());
    }

    let final_crontab = new_lines.join("\n") + "\n";
    let encoded_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, final_crontab.as_bytes());

    let apply_script = format!(
        r#"bash -c '
echo "{encoded_b64}" | base64 -d | crontab -
crontab -l >/dev/null
'
"#
    );

    let apply_out = exec_ssh_command_full(&mut session, &apply_script, Duration::from_secs(10)).await?;
    if apply_out.exit_status != Some(0) && !apply_out.stderr.is_empty() {
        return Err(CommandError::Internal(format!("Failed to install crontab: {}", apply_out.stderr.trim())));
    }

    let created_id = generate_deterministic_id(&line_str);
    let human = cron_to_human(clean_sched);

    if let Ok(conn) = state.db.lock() {
        let action_name = if target_id.is_some() { actions::UPDATE_CRON_JOB } else { actions::CREATE_CRON_JOB };
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id.clone()),
            action: action_name.into(),
            target: Some(clean_cmd.chars().take(40).collect()),
            status: "success".into(),
            detail: Some(format!("{} cron task: {} ({})", if target_id.is_some() { "Updated" } else { "Created" }, clean_cmd, human)),
            duration_ms: None,
        });
    }

    Ok(CronJobItem {
        id: created_id,
        schedule: clean_sched.to_string(),
        command: clean_cmd.to_string(),
        comment: job.comment,
        enabled: job.enabled,
        is_system: false,
        human_readable: human,
        raw_line: line_str,
    })
}

#[tauri::command]
pub async fn toggle_server_cron_job(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    job_id: String,
    enabled: bool,
) -> CommandResult<bool> {
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let out = exec_ssh_command_full(&mut session, "bash -c 'crontab -l 2>/dev/null || true'", Duration::from_secs(10)).await?;
    let mut new_lines = Vec::new();
    let mut found = false;

    for line in out.stdout.lines() {
        let current_id = generate_deterministic_id(line);
        if current_id == job_id {
            found = true;
            let trimmed = line.trim();
            if enabled {
                // Uncomment
                let uncommented = trimmed.trim_start_matches('#').trim();
                new_lines.push(uncommented.to_string());
            } else {
                // Comment out
                if !trimmed.starts_with('#') {
                    new_lines.push(format!("# {}", trimmed));
                } else {
                    new_lines.push(trimmed.to_string());
                }
            }
        } else {
            new_lines.push(line.to_string());
        }
    }

    if !found {
        return Err(CommandError::NotFound(format!("Cron job {} not found in crontab", job_id)));
    }

    let final_crontab = new_lines.join("\n") + "\n";
    let encoded_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, final_crontab.as_bytes());

    let apply_script = format!(
        r#"bash -c '
echo "{encoded_b64}" | base64 -d | crontab -
'
"#
    );

    let apply_out = exec_ssh_command_full(&mut session, &apply_script, Duration::from_secs(10)).await?;
    if apply_out.exit_status != Some(0) && !apply_out.stderr.is_empty() {
        return Err(CommandError::Internal(format!("Failed to update crontab: {}", apply_out.stderr.trim())));
    }

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id.clone()),
            action: actions::TOGGLE_CRON_JOB.into(),
            target: Some(job_id.clone()),
            status: "success".into(),
            detail: Some(format!("Toggled cron job {} to {}", job_id, if enabled { "enabled" } else { "disabled" })),
            duration_ms: None,
        });
    }

    Ok(enabled)
}

#[tauri::command]
pub async fn delete_server_cron_job(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    job_id: String,
    confirmation_token: Option<String>,
) -> CommandResult<bool> {
    if let Some(token) = &confirmation_token {
        consume_token(Some(token)).await?;
    }

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let out = exec_ssh_command_full(&mut session, "bash -c 'crontab -l 2>/dev/null || true'", Duration::from_secs(10)).await?;
    let mut new_lines = Vec::new();
    let mut found = false;

    for line in out.stdout.lines() {
        let current_id = generate_deterministic_id(line);
        if current_id == job_id {
            found = true;
            continue; // Skip the line
        }
        new_lines.push(line.to_string());
    }

    if !found {
        return Err(CommandError::NotFound(format!("Cron job {} not found in crontab", job_id)));
    }

    let final_crontab = new_lines.join("\n") + "\n";
    let encoded_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, final_crontab.as_bytes());

    let apply_script = format!(
        r#"bash -c '
echo "{encoded_b64}" | base64 -d | crontab -
'
"#
    );

    let apply_out = exec_ssh_command_full(&mut session, &apply_script, Duration::from_secs(10)).await?;
    if apply_out.exit_status != Some(0) && !apply_out.stderr.is_empty() {
        return Err(CommandError::Internal(format!("Failed to update crontab: {}", apply_out.stderr.trim())));
    }

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id.clone()),
            action: actions::DELETE_CRON_JOB.into(),
            target: Some(job_id.clone()),
            status: "success".into(),
            detail: Some(format!("Deleted cron job: {}", job_id)),
            duration_ms: None,
        });
    }

    Ok(true)
}

#[tauri::command]
pub async fn run_cron_job_now(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    command: String,
) -> CommandResult<CronRunResult> {
    if command.trim().is_empty() {
        return Err(CommandError::Validation("Command cannot be empty".into()));
    }

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let escaped_command = command.replace('\'', "'\\''");
    let script = format!("bash -c '{}'", escaped_command);

    let start_time = Instant::now();
    let out = exec_ssh_command_full(&mut session, &script, Duration::from_secs(60)).await?;
    let duration_ms = start_time.elapsed().as_millis() as u64;

    let success = out.exit_status == Some(0);

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id.clone()),
            action: actions::RUN_CRON_JOB_NOW.into(),
            target: Some(command.chars().take(40).collect()),
            status: if success { "success".into() } else { "failed".into() },
            detail: Some(format!("Executed cron task ad-hoc in {}ms (exit: {:?})", duration_ms, out.exit_status)),
            duration_ms: Some(duration_ms as i64),
        });
    }

    Ok(CronRunResult {
        exit_code: out.exit_status,
        stdout: out.stdout,
        stderr: out.stderr,
        duration_ms,
        success,
    })
}

