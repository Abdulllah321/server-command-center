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
    pub metric: String, // "cpu", "memory", "disk", "pm2_crash"
    pub threshold: f64,
    pub operator: String, // "gt", "lt"
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertHistoryEntry {
    pub id: String,
    pub server_id: String,
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
            metric: r.get(2)?,
            value: r.get(3)?,
            message: r.get(4)?,
            triggered_at: r.get(5)?,
        })
    }).map_err(|e| CommandError::Database(e.to_string()))?;

    let mut history = Vec::new();
    for r in rows {
        if let Ok(entry) = r {
            history.push(entry);
        }
    }

    Ok(history)
}

#[tauri::command]
pub async fn evaluate_health_alerts(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    payload: EvaluateAlertsPayload,
) -> CommandResult<Vec<AlertHistoryEntry>> {
    let rules = get_alert_rules(state.clone(), payload.server_id.clone()).await?;
    let mut triggered = Vec::new();

    for rule in rules {
        if !rule.enabled {
            continue;
        }

        let (value, breached, msg) = match rule.metric.as_str() {
            "cpu" => {
                let breached = if rule.operator == "gt" { payload.cpu_percent > rule.threshold } else { payload.cpu_percent < rule.threshold };
                (payload.cpu_percent, breached, format!("CPU usage ({:.1}%) {} threshold ({:.1}%)", payload.cpu_percent, rule.operator, rule.threshold))
            },
            "memory" => {
                let breached = if rule.operator == "gt" { payload.memory_percent > rule.threshold } else { payload.memory_percent < rule.threshold };
                (payload.memory_percent, breached, format!("Memory usage ({:.1}%) {} threshold ({:.1}%)", payload.memory_percent, rule.operator, rule.threshold))
            },
            "disk" => {
                let breached = if rule.operator == "gt" { payload.disk_percent > rule.threshold } else { payload.disk_percent < rule.threshold };
                (payload.disk_percent, breached, format!("Disk usage ({:.1}%) {} threshold ({:.1}%)", payload.disk_percent, rule.operator, rule.threshold))
            },
            "pm2_crash" => {
                let count = payload.errored_pm2_count as f64;
                let breached = count >= rule.threshold;
                (count, breached, format!("{} PM2 process(es) in errored/crashed state", payload.errored_pm2_count))
            },
            _ => (0.0, false, String::new()),
        };

        if breached {
            let entry_id = Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let entry = AlertHistoryEntry {
                id: entry_id.clone(),
                server_id: payload.server_id.clone(),
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

    Ok(triggered)
}
