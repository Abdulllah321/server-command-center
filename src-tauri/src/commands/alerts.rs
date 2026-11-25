use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::db::{log_activity, ActivityEntry, actions};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRule {
    pub id: String,
    pub server_id: String,
    pub metric: String, // "cpu", "memory", "disk", "pm2_crash", "load"
    pub threshold: f64,
    pub operator: String, // "gt", "lt"
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertHistoryEntry {
    pub id: String,
    pub server_id: String,
    pub server_name: Option<String>,
    pub metric: String,
    pub value: f64,
    pub message: String,
    pub triggered_at: String,
}

#[derive(Debug, Deserialize)]
pub struct SaveAlertRuleOptions {
    pub id: Option<String>,
    pub server_id: String,
    pub metric: String,
    pub threshold: f64,
    pub operator: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct EvaluateAlertsPayload {
    pub server_id: String,
    pub cpu_percent: f64,
    pub memory_percent: f64,
    pub disk_percent: f64,
    pub errored_pm2_count: u32,
}

#[tauri::command]
pub async fn get_alert_rules(
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> CommandResult<Vec<AlertRule>> {
    let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, server_id, metric, threshold, operator, enabled, created_at
         FROM alert_rules
         WHERE server_id = ?1
         ORDER BY metric ASC"
    ).map_err(|e| CommandError::Database(e.to_string()))?;

    let rows = stmt.query_map([&server_id], |r| {
        Ok(AlertRule {
            id: r.get(0)?,
            server_id: r.get(1)?,
            metric: r.get(2)?,
            threshold: r.get(3)?,
            operator: r.get(4)?,
            enabled: r.get::<_, i64>(5)? != 0,
            created_at: r.get(6)?,
        })
    }).map_err(|e| CommandError::Database(e.to_string()))?;

    let mut rules = Vec::new();
    for r in rows {
        if let Ok(rule) = r {
            rules.push(rule);
        }
    }

    // Auto-seed default production alert rules if none exist for this server
    if rules.is_empty() && !server_id.is_empty() {
        let defaults = vec![
            ("cpu", 85.0, "gt"),
            ("memory", 90.0, "gt"),
            ("disk", 90.0, "gt"),
            ("pm2_crash", 1.0, "gt"),
        ];
        let now = chrono::Utc::now().to_rfc3339();
        for (metric, threshold, operator) in defaults {
            let id = Uuid::new_v4().to_string();
            let _ = conn.execute(
                "INSERT INTO alert_rules (id, server_id, metric, threshold, operator, enabled, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
                rusqlite::params![&id, &server_id, metric, threshold, operator, &now],
            );
            rules.push(AlertRule {
                id,
                server_id: server_id.clone(),
                metric: metric.to_string(),
                threshold,
                operator: operator.to_string(),
                enabled: true,
                created_at: now.clone(),
            });
        }
    }

    Ok(rules)
}

#[tauri::command]
pub async fn save_alert_rule(
    state: tauri::State<'_, AppState>,
    rule: SaveAlertRuleOptions,
) -> CommandResult<AlertRule> {
    let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
    let rule_id = rule.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO alert_rules (id, server_id, metric, threshold, operator, enabled, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            threshold = excluded.threshold,
            operator = excluded.operator,
            enabled = excluded.enabled",
        rusqlite::params![
            rule_id,
            rule.server_id,
            rule.metric,
            rule.threshold,
            rule.operator,
            if rule.enabled { 1 } else { 0 },
            now
        ],
    ).map_err(|e| CommandError::Database(e.to_string()))?;

    log_activity(&conn, ActivityEntry {
        server_id: Some(rule.server_id.clone()),
        action: actions::CREATE_ALERT_RULE.into(),
        target: Some(rule.metric.clone()),
        status: "success".into(),
        detail: Some(format!("Alert rule set for {}: {} {}", rule.metric, rule.operator, rule.threshold)),
        duration_ms: Some(5),
    });

    Ok(AlertRule {
        id: rule_id,
        server_id: rule.server_id,
        metric: rule.metric,
        threshold: rule.threshold,
        operator: rule.operator,
        enabled: rule.enabled,
        created_at: now,
    })
}

#[tauri::command]
pub async fn delete_alert_rule(
    state: tauri::State<'_, AppState>,
    rule_id: String,
) -> CommandResult<()> {
    let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
    conn.execute("DELETE FROM alert_rules WHERE id = ?1", rusqlite::params![rule_id])
        .map_err(|e| CommandError::Database(e.to_string()))?;

    log_activity(&conn, ActivityEntry {
        server_id: None,
        action: actions::DELETE_ALERT_RULE.into(),
        target: Some(rule_id),
        status: "success".into(),
        detail: Some("Deleted alert rule".into()),
        duration_ms: Some(2),
    });

    Ok(())
}

#[tauri::command]
pub async fn get_alert_history(
    state: tauri::State<'_, AppState>,
    server_id: String,
    limit: Option<i64>,
) -> CommandResult<Vec<AlertHistoryEntry>> {
    let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
    let limit_val = limit.unwrap_or(50);

    let server_name: Option<String> = conn.query_row(
        "SELECT name FROM servers WHERE id = ?1",
        [&server_id],
        |r| r.get(0),
    ).ok();

    let mut stmt = conn.prepare(
        "SELECT id, server_id, metric, value, message, triggered_at
         FROM alert_history
         WHERE server_id = ?1
         ORDER BY triggered_at DESC
         LIMIT ?2"
    ).map_err(|e| CommandError::Database(e.to_string()))?;

    let rows = stmt.query_map(rusqlite::params![&server_id, limit_val], |r| {
        Ok(AlertHistoryEntry {
            id: r.get(0)?,
            server_id: r.get(1)?,
            server_name: server_name.clone(),
            metric: r.get(2)?,
            value: r.get(3)?,
            message: r.get(4)?,
            triggered_at: r.get(5)?,
        })
    }).map_err(|e| CommandError::Database(e.to_string()))?;

    let mut history = Vec::new();
    for r in rows.flatten() {
        history.push(r);
    }

    Ok(history)
}

/// Global query for all recent alerts across all servers in the fleet (for TopBar Notification Center).
#[tauri::command]
pub async fn get_all_recent_alerts(
    state: tauri::State<'_, AppState>,
    limit: Option<i64>,
) -> CommandResult<Vec<AlertHistoryEntry>> {
    let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
    let limit_val = limit.unwrap_or(30);

    let mut stmt = conn.prepare(
        "SELECT h.id, h.server_id, s.name, h.metric, h.value, h.message, h.triggered_at
         FROM alert_history h
         LEFT JOIN servers s ON h.server_id = s.id
         ORDER BY h.triggered_at DESC
         LIMIT ?1"
    ).map_err(|e| CommandError::Database(e.to_string()))?;

    let rows = stmt.query_map(rusqlite::params![limit_val], |r| {
        Ok(AlertHistoryEntry {
            id: r.get(0)?,
            server_id: r.get(1)?,
            server_name: r.get(2)?,
            metric: r.get(3)?,
            value: r.get(4)?,
            message: r.get(5)?,
            triggered_at: r.get(6)?,
        })
    }).map_err(|e| CommandError::Database(e.to_string()))?;

    let mut list = Vec::new();
    for r in rows.flatten() {
        list.push(r);
    }

    Ok(list)
}

/// Clears alert history for a specific server or fleet-wide.
#[tauri::command]
pub async fn clear_alert_history(
    state: tauri::State<'_, AppState>,
    server_id: Option<String>,
) -> CommandResult<()> {
    let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
    if let Some(sid) = server_id {
        conn.execute("DELETE FROM alert_history WHERE server_id = ?1", [&sid])
            .map_err(|e| CommandError::Database(e.to_string()))?;
    } else {
        conn.execute("DELETE FROM alert_history", [])
            .map_err(|e| CommandError::Database(e.to_string()))?;
    }
    Ok(())
}

/// Helper called automatically on every telemetry poll (get_health) with smart 5-minute debounce.
pub async fn evaluate_snapshot_alerts(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: &str,
    cpu_percent: f64,
    memory_percent: f64,
    disk_percent: f64,
    _load_1m: f64,
) -> CommandResult<Vec<AlertHistoryEntry>> {
    let server_name = {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        conn.query_row("SELECT name FROM servers WHERE id = ?1", [server_id], |r| r.get(0))
            .unwrap_or_else(|_| "Managed Server".to_string())
    };

    let rules = get_alert_rules(state.clone(), server_id.to_string()).await?;
    let mut triggered = Vec::new();

    for rule in rules {
        if !rule.enabled {
            continue;
        }

        let (value, breached, msg) = match rule.metric.as_str() {
            "cpu" => {
                let breached = if rule.operator == "gt" { cpu_percent > rule.threshold } else { cpu_percent < rule.threshold };
                (cpu_percent, breached, format!("[{}] CPU usage ({:.1}%) {} threshold ({:.1}%)", server_name, cpu_percent, rule.operator, rule.threshold))
            },
            "memory" => {
                let breached = if rule.operator == "gt" { memory_percent > rule.threshold } else { memory_percent < rule.threshold };
                (memory_percent, breached, format!("[{}] Memory usage ({:.1}%) {} threshold ({:.1}%)", server_name, memory_percent, rule.operator, rule.threshold))
            },
            "disk" => {
                let breached = if rule.operator == "gt" { disk_percent > rule.threshold } else { disk_percent < rule.threshold };
                (disk_percent, breached, format!("[{}] Disk storage ({:.1}%) {} threshold ({:.1}%)", server_name, disk_percent, rule.operator, rule.threshold))
            },
            _ => (0.0, false, String::new()),
        };

        if breached {
            // Intelligent 5-minute debouncing to prevent alert spamming on consecutive polls
            let should_fire = {
                let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM alert_history 
                     WHERE server_id = ?1 AND metric = ?2 
                     AND triggered_at > datetime('now', '-5 minutes')",
                    rusqlite::params![server_id, rule.metric],
                    |row| row.get(0),
                ).unwrap_or(0);
                count == 0
            };

            if should_fire {
                let entry_id = Uuid::new_v4().to_string();
                let now = chrono::Utc::now().to_rfc3339();
                let entry = AlertHistoryEntry {
                    id: entry_id.clone(),
                    server_id: server_id.to_string(),
                    server_name: Some(server_name.clone()),
                    metric: rule.metric.clone(),
                    value,
                    message: msg.clone(),
                    triggered_at: now.clone(),
                };

                // Store alert in DB
                if let Ok(conn) = state.db.lock() {
                    let _ = conn.execute(
                        "INSERT INTO alert_history (id, server_id, metric, value, message, triggered_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        rusqlite::params![entry_id, server_id, rule.metric, value, msg, now],
                    );
                }

                // Global event emission across entire application
                let _ = app_handle.emit("alert://triggered", &entry);
                triggered.push(entry);
            }
        }
    }

    Ok(triggered)
}

#[tauri::command]
pub async fn evaluate_health_alerts(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    payload: EvaluateAlertsPayload,
) -> CommandResult<Vec<AlertHistoryEntry>> {
    let server_name = {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        conn.query_row("SELECT name FROM servers WHERE id = ?1", [&payload.server_id], |r| r.get(0))
            .unwrap_or_else(|_| "Managed Server".to_string())
    };

    let rules = get_alert_rules(state.clone(), payload.server_id.clone()).await?;
    let mut triggered = Vec::new();

    for rule in rules {
        if !rule.enabled {
            continue;
        }

        let (value, breached, msg) = match rule.metric.as_str() {
            "cpu" => {
                let breached = if rule.operator == "gt" { payload.cpu_percent > rule.threshold } else { payload.cpu_percent < rule.threshold };
                (payload.cpu_percent, breached, format!("[{}] CPU usage ({:.1}%) {} threshold ({:.1}%)", server_name, payload.cpu_percent, rule.operator, rule.threshold))
            },
            "memory" => {
                let breached = if rule.operator == "gt" { payload.memory_percent > rule.threshold } else { payload.memory_percent < rule.threshold };
                (payload.memory_percent, breached, format!("[{}] Memory usage ({:.1}%) {} threshold ({:.1}%)", server_name, payload.memory_percent, rule.operator, rule.threshold))
            },
            "disk" => {
                let breached = if rule.operator == "gt" { payload.disk_percent > rule.threshold } else { payload.disk_percent < rule.threshold };
                (payload.disk_percent, breached, format!("[{}] Disk storage ({:.1}%) {} threshold ({:.1}%)", server_name, payload.disk_percent, rule.operator, rule.threshold))
            },
            "pm2_crash" => {
                let count = payload.errored_pm2_count as f64;
                let breached = count >= rule.threshold;
                (count, breached, format!("[{}] {} PM2 process(es) in errored/crashed state", server_name, payload.errored_pm2_count))
            },
            _ => (0.0, false, String::new()),
        };

        if breached {
            let should_fire = {
                let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM alert_history 
                     WHERE server_id = ?1 AND metric = ?2 
                     AND triggered_at > datetime('now', '-5 minutes')",
                    rusqlite::params![&payload.server_id, rule.metric],
                    |row| row.get(0),
                ).unwrap_or(0);
                count == 0
            };

            if should_fire {
                let entry_id = Uuid::new_v4().to_string();
                let now = chrono::Utc::now().to_rfc3339();
                let entry = AlertHistoryEntry {
                    id: entry_id.clone(),
                    server_id: payload.server_id.clone(),
                    server_name: Some(server_name.clone()),
                    metric: rule.metric.clone(),
                    value,
                    message: msg.clone(),
                    triggered_at: now.clone(),
                };

                // Store alert in DB
                if let Ok(conn) = state.db.lock() {
                    let _ = conn.execute(
                        "INSERT INTO alert_history (id, server_id, metric, value, message, triggered_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        rusqlite::params![entry_id, payload.server_id, rule.metric, value, msg, now],
                    );
                }

                // Emit event to frontend
                let _ = app_handle.emit("alert://triggered", &entry);
                triggered.push(entry);
            }
        }
    }

    Ok(triggered)
}
