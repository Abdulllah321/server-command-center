use std::collections::HashMap;
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DatabaseCredentials {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, serde_json::Value>>,
    pub row_count: usize,
    pub execution_time_ms: u64,
    pub affected_rows: Option<u64>,
    pub raw_output: String,
    pub is_truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConnectionItem {
    pub id: String,
    pub database: String,
    pub user: String,
    pub client_addr: String,
    pub state: String,
    pub query: String,
    pub duration_seconds: f64,
    pub wait_event: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConnectionStats {
    pub total_connections: usize,
    pub active_connections: usize,
    pub idle_connections: usize,
    pub max_connections_limit: Option<usize>,
    pub connections: Vec<DatabaseConnectionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseTableInfo {
    pub name: String,
    pub schema: String,
    pub row_estimate: i64,
    pub total_size_pretty: String,
    pub table_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseSchemaSummary {
    pub database: String,
    pub engine: String,
    pub tables: Vec<DatabaseTableInfo>,
    pub total_tables: usize,
    pub keyspaces: Option<Vec<String>>,
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
                return Err(CommandError::Internal("Database query command timed out on remote server".into()));
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

fn escape_bash_single_quote(s: &str) -> String {
    s.replace('\'', "'\\''")
}

pub fn is_query_destructive(query: &str) -> bool {
    let normalized = query.trim().to_uppercase();
    let destructive_tokens = [
        "DROP ", "TRUNCATE ", "DELETE ", "UPDATE ", "ALTER ", 
        "GRANT ", "REVOKE ", "FLUSHALL", "FLUSHDB", "SHUTDOWN"
    ];
    destructive_tokens.iter().any(|&token| normalized.starts_with(token) || normalized.contains(&format!(" {}", token)))
}

#[tauri::command]
pub async fn execute_database_query(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    engine: String,
    database: String,
    query: String,
    credentials: Option<DatabaseCredentials>,
    safe_mode: Option<bool>,
    confirmation_token: Option<String>,
) -> CommandResult<DatabaseQueryResult> {
    if query.trim().is_empty() {
        return Err(CommandError::Validation("Query cannot be empty".into()));
    }

    let is_safe = safe_mode.unwrap_or(true);
    let destructive = is_query_destructive(&query);

    if is_safe && destructive {
        return Err(CommandError::Validation(
            "Read-Only Safe Mode is active: mutation or destructive query (DROP/DELETE/UPDATE/ALTER/TRUNCATE/FLUSH) blocked. Disable Safe Mode or verify confirmation before running.".into()
        ));
    }

    if destructive {
        if let Some(token) = &confirmation_token {
            consume_token(Some(token)).await?;
        }
    }

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let creds = credentials.unwrap_or_default();
    let host = creds.host.as_deref().unwrap_or("").trim();
    let user = creds.user.as_deref().unwrap_or("").trim();
    let pass = creds.password.as_deref().unwrap_or("").trim();
    let port = creds.port;

    let escaped_query = escape_bash_single_quote(&query);
    let start_time = Instant::now();

    let script = match engine.as_str() {
        "mysql" => {
            let port_num = port.unwrap_or(3306);
            format!(
                r#"bash -c '
USER="{user}"
PASS="{pass}"
HOST="{host}"
PORT="{port_num}"
DB="{database}"
QUERY='\'System_SCC_Query_Start_Token\''
QUERY='{escaped_query}'

run_query() {{
    if [ -n "$PASS" ]; then
        MYSQL_PWD="$PASS" mysql -u "${{USER:-root}}" ${{HOST:+-h "$HOST"}} -P "$PORT" -D "$DB" --batch --raw -e "$QUERY" 2>&1 && return 0
    fi

    if [ -f /etc/mysql/debian.cnf ]; then
        mysql --defaults-file=/etc/mysql/debian.cnf -D "$DB" --batch --raw -e "$QUERY" 2>&1 && return 0
    fi

    if [ "$(id -u)" -eq 0 ]; then
        if sudo mysql -D "$DB" --batch --raw -e "$QUERY" 2>&1; then
            return 0
        fi
    fi

    if command -v docker >/dev/null 2>&1; then
        DOCKER_MYSQL=$(docker ps --format "{{{{.Names}}}} {{{{.Image}}}}" 2>/dev/null | grep -iE "mysql|mariadb" | awk "{{print \$1}}" | head -n 1)
        if [ -n "$DOCKER_MYSQL" ]; then
            docker exec "$DOCKER_MYSQL" mysql -u "${{USER:-root}}" -D "$DB" --batch --raw -e "$QUERY" 2>&1 && return 0
        fi
    fi

    mysql -u "${{USER:-root}}" ${{HOST:+-h "$HOST"}} -P "$PORT" -D "$DB" --batch --raw -e "$QUERY" 2>&1
}}

run_query
'
"#
            )
        },
        "redis" => {
            let port_num = port.unwrap_or(6379);
            format!(
                r#"bash -c '
HOST="{host}"
PORT="{port_num}"
PASS="{pass}"
DB="{database}"
CMD='{escaped_query}'

DB_NUM="0"
if [[ "$DB" =~ ^db([0-9]+)$ ]]; then
    DB_NUM="${{BASH_REMATCH[1]}}"
fi

H_ARG=""
[ -n "$HOST" ] && H_ARG="-h $HOST"
A_ARG=""
[ -n "$PASS" ] && A_ARG="-a $PASS"

run_redis() {{
    if command -v redis-cli >/dev/null 2>&1; then
        redis-cli $H_ARG -p "$PORT" $A_ARG -n "$DB_NUM" $CMD 2>&1 && return 0
    fi

    if command -v docker >/dev/null 2>&1; then
        DOCKER_REDIS=$(docker ps --format "{{{{.Names}}}} {{{{.Image}}}}" 2>/dev/null | grep -iE "redis" | awk "{{print \$1}}" | head -n 1)
        if [ -n "$DOCKER_REDIS" ]; then
            docker exec "$DOCKER_REDIS" redis-cli $H_ARG -p "$PORT" $A_ARG -n "$DB_NUM" $CMD 2>&1 && return 0
        fi
    fi

    redis-cli $H_ARG -p "$PORT" $A_ARG -n "$DB_NUM" $CMD 2>&1
}}

run_redis
'
"#
            )
        },
        _ => {
            // PostgreSQL default
            let port_num = port.unwrap_or(5432);
            format!(
                r#"bash -c '
USER="{user}"
PASS="{pass}"
HOST="{host}"
PORT="{port_num}"
DB="{database}"
QUERY='{escaped_query}'

run_pg() {{
    if [ -n "$PASS" ] || [ -n "$HOST" ]; then
        export PGPASSWORD="$PASS"
        H_ARG=""
        [ -n "$HOST" ] && H_ARG="-h $HOST"
        U_ARG=""
        [ -n "$USER" ] && U_ARG="-U $USER"
        psql $H_ARG -p "$PORT" $U_ARG -d "$DB" -X -A -F $'\t' -c "$QUERY" 2>&1
        return $?
    fi

    if [ "$(id -u)" -eq 0 ]; then
        if id -u postgres >/dev/null 2>&1; then
            sudo -u postgres psql -d "$DB" -X -A -F $'\t' -c "$QUERY" 2>&1
            return $?
        elif su - postgres -c "psql -d '$DB' -X -A -F \$'\t' -c \"\$QUERY\"" 2>&1; then
            return $?
        fi
    fi

    if command -v docker >/dev/null 2>&1; then
        DOCKER_PG=$(docker ps --format "{{{{.Names}}}} {{{{.Image}}}}" 2>/dev/null | grep -iE "postgres|timescale" | awk "{{print \$1}}" | head -n 1)
        if [ -n "$DOCKER_PG" ]; then
            U_NAME="${{USER:-postgres}}"
            docker exec "$DOCKER_PG" psql -U "$U_NAME" -d "$DB" -X -A -F $'\t' -c "$QUERY" 2>&1
            return $?
        fi
    fi

    psql -U "${{USER:-postgres}}" -d "$DB" -X -A -F $'\t' -c "$QUERY" 2>&1
}}

run_pg
'
"#
            )
        }
    };

    let out = exec_ssh_command_full(&mut session, &script, Duration::from_secs(60)).await?;
    let duration_ms = start_time.elapsed().as_millis() as u64;

    let combined_output = if !out.stdout.is_empty() {
        out.stdout.clone()
    } else {
        out.stderr.clone()
    };

    // Check for explicit SQL error message indicators
    let has_error = out.exit_status != Some(0) || 
        combined_output.contains("ERROR:") || 
        combined_output.contains("FATAL:") || 
        combined_output.contains("ERROR ") || 
        combined_output.contains("syntax error at or near") ||
        combined_output.contains("Table '") && combined_output.contains("doesn't exist");

    if has_error && !combined_output.contains("rows)") && !combined_output.contains("\t") {
        return Err(CommandError::Internal(format!("Database query failed: {}", combined_output.trim())));
    }

    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<HashMap<String, serde_json::Value>> = Vec::new();
    let mut affected_rows: Option<u64> = None;
    let mut is_truncated = false;

    let lines: Vec<&str> = combined_output.lines().collect();

    if engine == "redis" {
        columns = vec!["Result".to_string()];
        for line in lines.iter().take(500) {
            let mut map = HashMap::new();
            map.insert("Result".to_string(), serde_json::Value::String(line.to_string()));
            rows.push(map);
        }
    } else if !lines.is_empty() {
        // Tabular parsing (PostgreSQL and MySQL tab-separated)
        let first_line = lines[0].trim_end();

        // Check if output is a mutation tag like "UPDATE 5" or "DELETE 3"
        if lines.len() <= 2 && (first_line.starts_with("UPDATE ") || first_line.starts_with("DELETE ") || first_line.starts_with("INSERT ")) {
            let parts: Vec<&str> = first_line.split_whitespace().collect();
            if let Some(num_str) = parts.last() {
                if let Ok(n) = num_str.parse::<u64>() {
                    affected_rows = Some(n);
                }
            }
            columns = vec!["Command Result".to_string()];
            let mut map = HashMap::new();
            map.insert("Command Result".to_string(), serde_json::Value::String(first_line.to_string()));
            rows.push(map);
        } else {
            // First row represents column headers
            columns = first_line.split('\t').map(|s| s.trim().to_string()).collect();

            for line in lines.iter().skip(1) {
                let trimmed = line.trim_end();
                // Skip PG row count summary (e.g. "(5 rows)")
                if trimmed.starts_with('(') && trimmed.ends_with("rows)") || (trimmed.starts_with('(') && trimmed.ends_with("row)")) {
                    continue;
                }
                if trimmed.is_empty() {
                    continue;
                }

                if rows.len() >= 1000 {
                    is_truncated = true;
                    break;
                }

                let values: Vec<&str> = trimmed.split('\t').collect();
                let mut row_map = HashMap::new();

                for (idx, col_name) in columns.iter().enumerate() {
                    let val_str = values.get(idx).copied().unwrap_or("");
                    if val_str.is_empty() {
                        row_map.insert(col_name.clone(), serde_json::Value::Null);
                    } else if let Ok(int_val) = val_str.parse::<i64>() {
                        row_map.insert(col_name.clone(), serde_json::json!(int_val));
                    } else if let Ok(float_val) = val_str.parse::<f64>() {
                        row_map.insert(col_name.clone(), serde_json::json!(float_val));
                    } else if val_str == "t" || val_str.eq_ignore_ascii_case("true") {
                        row_map.insert(col_name.clone(), serde_json::json!(true));
                    } else if val_str == "f" || val_str.eq_ignore_ascii_case("false") {
                        row_map.insert(col_name.clone(), serde_json::json!(false));
                    } else {
                        row_map.insert(col_name.clone(), serde_json::Value::String(val_str.to_string()));
                    }
                }
                rows.push(row_map);
            }
        }
    }

    let row_count = rows.len();

    // Log destructive or write queries into activity log
    if destructive {
        if let Ok(conn) = state.db.lock() {
            log_activity(&conn, ActivityEntry {
                server_id: Some(server_id.clone()),
                action: actions::DATABASE_QUERY.into(),
                target: Some(format!("{}/{}", engine, database)),
                status: "success".into(),
                detail: Some(format!("Executed query on {}: {} (rows: {}, time: {}ms)", database, query.chars().take(80).collect::<String>(), row_count, duration_ms)),
                duration_ms: Some(duration_ms as i64),
            });
        }
    }

    Ok(DatabaseQueryResult {
        columns,
        rows,
        row_count,
        execution_time_ms: duration_ms,
        affected_rows,
        raw_output: combined_output,
        is_truncated,
    })
}

#[tauri::command]
pub async fn get_database_connections(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    engine: String,
    database: Option<String>,
    credentials: Option<DatabaseCredentials>,
) -> CommandResult<DatabaseConnectionStats> {
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let creds = credentials.unwrap_or_default();
    let host = creds.host.as_deref().unwrap_or("").trim();
    let user = creds.user.as_deref().unwrap_or("").trim();
    let pass = creds.password.as_deref().unwrap_or("").trim();
    let port = creds.port;
    let target_db = database.unwrap_or_else(|| match engine.as_str() {
        "mysql" => "mysql".to_string(),
        "redis" => "db0".to_string(),
        _ => "postgres".to_string(),
    });

    let script = match engine.as_str() {
        "mysql" => {
            let port_num = port.unwrap_or(3306);
            format!(
                r#"bash -c '
USER="{user}"
PASS="{pass}"
HOST="{host}"
PORT="{port_num}"

QUERY="SELECT ID, IFNULL(DB, '\'''\''), IFNULL(USER, '\'''\''), IFNULL(HOST, '\'''\''), IFNULL(COMMAND, '\'''\''), IFNULL(REPLACE(REPLACE(INFO, '\n', ' '), '\t', ' '), '\'''\''), IFNULL(TIME, 0), IFNULL(STATE, '\'''\'') FROM information_schema.processlist ORDER BY TIME DESC LIMIT 100;"
LIMIT_QUERY="SHOW VARIABLES LIKE '\''max_connections\'';"

run_mysql() {{
    if [ -n "$PASS" ]; then
        MYSQL_PWD="$PASS" mysql -u "${{USER:-root}}" ${{HOST:+-h "$HOST"}} -P "$PORT" --batch --raw -e "$QUERY" 2>/dev/null
        echo "===LIMIT==="
        MYSQL_PWD="$PASS" mysql -u "${{USER:-root}}" ${{HOST:+-h "$HOST"}} -P "$PORT" --batch --raw -e "$LIMIT_QUERY" 2>/dev/null
        return 0
    fi

    if [ -f /etc/mysql/debian.cnf ]; then
        mysql --defaults-file=/etc/mysql/debian.cnf --batch --raw -e "$QUERY" 2>/dev/null
        echo "===LIMIT==="
        mysql --defaults-file=/etc/mysql/debian.cnf --batch --raw -e "$LIMIT_QUERY" 2>/dev/null
        return 0
    fi

    if [ "$(id -u)" -eq 0 ]; then
        sudo mysql --batch --raw -e "$QUERY" 2>/dev/null
        echo "===LIMIT==="
        sudo mysql --batch --raw -e "$LIMIT_QUERY" 2>/dev/null
        return 0
    fi

    mysql -u "${{USER:-root}}" --batch --raw -e "$QUERY" 2>/dev/null
    echo "===LIMIT==="
    mysql -u "${{USER:-root}}" --batch --raw -e "$LIMIT_QUERY" 2>/dev/null
}}

run_mysql
'
"#
            )
        },
        "redis" => {
            let port_num = port.unwrap_or(6379);
            format!(
                r#"bash -c '
HOST="{host}"
PORT="{port_num}"
PASS="{pass}"

H_ARG=""
[ -n "$HOST" ] && H_ARG="-h $HOST"
A_ARG=""
[ -n "$PASS" ] && A_ARG="-a $PASS"

run_redis() {{
    redis-cli $H_ARG -p "$port_num" $A_ARG CLIENT LIST 2>/dev/null
    echo "===LIMIT==="
    redis-cli $H_ARG -p "$port_num" $A_ARG CONFIG GET maxclients 2>/dev/null
}}

run_redis
'
"#
            )
        },
        _ => {
            // PostgreSQL default
            let port_num = port.unwrap_or(5432);
            format!(
                r#"bash -c '
USER="{user}"
PASS="{pass}"
HOST="{host}"
PORT="{port_num}"
DB="{target_db}"

QUERY="SELECT pid::text, COALESCE(datname, '\'''\''), COALESCE(usename, '\'''\''), COALESCE(client_addr::text, '\''local'\''), COALESCE(state, '\''unknown'\''), COALESCE(REPLACE(REPLACE(query, E'\''\n'\'', '\'' '\''), E'\''\t'\'', '\'' '\''), '\'''\''), ROUND(COALESCE(EXTRACT(EPOCH FROM (now() - query_start)), 0)::numeric, 1), COALESCE(wait_event_type || '\'': '\'' || wait_event, '\'''\'') FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY duration_seconds DESC LIMIT 100;"
LIMIT_QUERY="SHOW max_connections;"

run_pg() {{
    if [ -n "$PASS" ] || [ -n "$HOST" ]; then
        export PGPASSWORD="$PASS"
        H_ARG=""
        [ -n "$HOST" ] && H_ARG="-h $HOST"
        U_ARG=""
        [ -n "$USER" ] && U_ARG="-U $USER"
        psql $H_ARG -p "$PORT" $U_ARG -d "$DB" -X -A -F $'\t' -c "$QUERY" 2>/dev/null
        echo "===LIMIT==="
        psql $H_ARG -p "$PORT" $U_ARG -d "$DB" -X -A -F $'\t' -t -c "$LIMIT_QUERY" 2>/dev/null
        return 0
    fi

    if [ "$(id -u)" -eq 0 ]; then
        if id -u postgres >/dev/null 2>&1; then
            sudo -u postgres psql -d "$DB" -X -A -F $'\t' -c "$QUERY" 2>/dev/null
            echo "===LIMIT==="
            sudo -u postgres psql -d "$DB" -X -A -F $'\t' -t -c "$LIMIT_QUERY" 2>/dev/null
            return 0
        fi
    fi

    psql -U "${{USER:-postgres}}" -d "$DB" -X -A -F $'\t' -c "$QUERY" 2>/dev/null
    echo "===LIMIT==="
    psql -U "${{USER:-postgres}}" -d "$DB" -X -A -F $'\t' -t -c "$LIMIT_QUERY" 2>/dev/null
}}

run_pg
'
"#
            )
        }
    };

    let out = exec_ssh_command_full(&mut session, &script, Duration::from_secs(15)).await?;
    let parts: Vec<&str> = out.stdout.split("===LIMIT===").collect();

    let conn_section = parts.first().copied().unwrap_or("");
    let limit_section = parts.get(1).copied().unwrap_or("");

    let mut connections: Vec<DatabaseConnectionItem> = Vec::new();
    let mut max_connections_limit: Option<usize> = None;

    if engine == "redis" {
        for line in conn_section.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || !trimmed.contains("id=") {
                continue;
            }
            let mut id = String::new();
            let mut addr = String::new();
            let mut db = "db0".to_string();
            let mut user = "default".to_string();
            let mut cmd = String::new();
            let mut idle = 0.0;
            let mut flags = "normal".to_string();

            for token in trimmed.split_whitespace() {
                if let Some((k, v)) = token.split_once('=') {
                    match k {
                        "id" => id = v.to_string(),
                        "addr" => addr = v.to_string(),
                        "db" => db = format!("db{}", v),
                        "user" | "name" => if !v.is_empty() { user = v.to_string(); },
                        "cmd" => cmd = v.to_string(),
                        "idle" => idle = v.parse::<f64>().unwrap_or(0.0),
                        "flags" => flags = v.to_string(),
                        _ => {}
                    }
                }
            }

            if !id.is_empty() {
                connections.push(DatabaseConnectionItem {
                    id,
                    database: db,
                    user,
                    client_addr: addr,
                    state: flags,
                    query: cmd,
                    duration_seconds: idle,
                    wait_event: None,
                });
            }
        }

        // Parse redis maxclients
        for line in limit_section.lines() {
            let trimmed = line.trim();
            if let Ok(limit) = trimmed.parse::<usize>() {
                max_connections_limit = Some(limit);
                break;
            }
        }
    } else {
        // Tab-separated connection lines for PG & MySQL
        let lines: Vec<&str> = conn_section.lines().collect();
        for line in lines.iter().skip(1) {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('(') {
                continue;
            }
            let cols: Vec<&str> = trimmed.split('\t').collect();
            if cols.len() >= 6 {
                let id = cols[0].trim().to_string();
                let db = cols.get(1).copied().unwrap_or("").trim().to_string();
                let user_name = cols.get(2).copied().unwrap_or("").trim().to_string();
                let addr = cols.get(3).copied().unwrap_or("").trim().to_string();
                let state_str = cols.get(4).copied().unwrap_or("").trim().to_string();
                let query_str = cols.get(5).copied().unwrap_or("").trim().to_string();
                let dur = cols.get(6).and_then(|v| v.trim().parse::<f64>().ok()).unwrap_or(0.0);
                let wait = cols.get(7).map(|v| v.trim().to_string()).filter(|s| !s.is_empty());

                connections.push(DatabaseConnectionItem {
                    id,
                    database: db,
                    user: user_name,
                    client_addr: addr,
                    state: state_str,
                    query: query_str,
                    duration_seconds: dur,
                    wait_event: wait,
                });
            }
        }

        for line in limit_section.lines() {
            let trimmed = line.trim();
            // In MySQL, "max_connections 151" or in PG "100"
            for token in trimmed.split_whitespace() {
                if let Ok(limit) = token.parse::<usize>() {
                    max_connections_limit = Some(limit);
                    break;
                }
            }
            if max_connections_limit.is_some() {
                break;
            }
        }
    }

    let total_connections = connections.len();
    let active_connections = connections.iter().filter(|c| {
        let s = c.state.to_lowercase();
        s.contains("active") || s.contains("query") || s.contains("running") || (engine == "redis" && !c.query.is_empty())
    }).count();
    let idle_connections = total_connections.saturating_sub(active_connections);

    Ok(DatabaseConnectionStats {
        total_connections,
        active_connections,
        idle_connections,
        max_connections_limit,
        connections,
    })
}

#[tauri::command]
pub async fn terminate_database_connection(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    engine: String,
    connection_id: String,
    credentials: Option<DatabaseCredentials>,
    confirmation_token: Option<String>,
) -> CommandResult<String> {
    if let Some(token) = &confirmation_token {
        consume_token(Some(token)).await?;
    }

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let creds = credentials.unwrap_or_default();
    let host = creds.host.as_deref().unwrap_or("").trim();
    let user = creds.user.as_deref().unwrap_or("").trim();
    let pass = creds.password.as_deref().unwrap_or("").trim();
    let port = creds.port;

    let escaped_id = escape_bash_single_quote(&connection_id);

    let script = match engine.as_str() {
        "mysql" => {
            let port_num = port.unwrap_or(3306);
            format!(
                r#"bash -c '
USER="{user}"
PASS="{pass}"
HOST="{host}"
PORT="{port_num}"
ID="{escaped_id}"

run_kill() {{
    if [ -n "$PASS" ]; then
        MYSQL_PWD="$PASS" mysql -u "${{USER:-root}}" ${{HOST:+-h "$HOST"}} -P "$PORT" -e "KILL $ID;" 2>&1 && return 0
    fi
    if [ -f /etc/mysql/debian.cnf ]; then
        mysql --defaults-file=/etc/mysql/debian.cnf -e "KILL $ID;" 2>&1 && return 0
    fi
    if [ "$(id -u)" -eq 0 ]; then
        sudo mysql -e "KILL $ID;" 2>&1 && return 0
    fi
    mysql -u "${{USER:-root}}" -e "KILL $ID;" 2>&1
}}
run_kill
'
"#
            )
        },
        "redis" => {
            let port_num = port.unwrap_or(6379);
            format!(
                r#"bash -c '
HOST="{host}"
PORT="{port_num}"
PASS="{pass}"
ID="{escaped_id}"

H_ARG=""
[ -n "$HOST" ] && H_ARG="-h $HOST"
A_ARG=""
[ -n "$PASS" ] && A_ARG="-a $PASS"

redis-cli $H_ARG -p "$PORT" $A_ARG CLIENT KILL ID "$ID" 2>&1
'
"#
            )
        },
        _ => {
            // PostgreSQL default
            let port_num = port.unwrap_or(5432);
            format!(
                r#"bash -c '
USER="{user}"
PASS="{pass}"
HOST="{host}"
PORT="{port_num}"
PID="{escaped_id}"

run_kill() {{
    if [ -n "$PASS" ] || [ -n "$HOST" ]; then
        export PGPASSWORD="$PASS"
        H_ARG=""
        [ -n "$HOST" ] && H_ARG="-h $HOST"
        U_ARG=""
        [ -n "$USER" ] && U_ARG="-U $USER"
        psql $H_ARG -p "$PORT" $U_ARG -d postgres -t -A -c "SELECT pg_terminate_backend($PID);" 2>&1
        return $?
    fi
    if [ "$(id -u)" -eq 0 ]; then
        if id -u postgres >/dev/null 2>&1; then
            sudo -u postgres psql -d postgres -t -A -c "SELECT pg_terminate_backend($PID);" 2>&1
            return $?
        fi
    fi
    psql -U "${{USER:-postgres}}" -d postgres -t -A -c "SELECT pg_terminate_backend($PID);" 2>&1
}}
run_kill
'
"#
            )
        }
    };

    let out = exec_ssh_command_full(&mut session, &script, Duration::from_secs(10)).await?;
    let output = if !out.stdout.is_empty() { out.stdout.trim().to_string() } else { out.stderr.trim().to_string() };

    if let Ok(conn) = state.db.lock() {
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id.clone()),
            action: actions::TERMINATE_DATABASE_CONNECTION.into(),
            target: Some(format!("{}/{}", engine, connection_id)),
            status: "success".into(),
            detail: Some(format!("Terminated database connection: {} ({})", connection_id, output)),
            duration_ms: None,
        });
    }

    Ok(format!("Connection {} terminated successfully", connection_id))
}

#[tauri::command]
pub async fn get_database_schema_tables(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    engine: String,
    database: String,
    credentials: Option<DatabaseCredentials>,
) -> CommandResult<DatabaseSchemaSummary> {
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let creds = credentials.unwrap_or_default();
    let host = creds.host.as_deref().unwrap_or("").trim();
    let user = creds.user.as_deref().unwrap_or("").trim();
    let pass = creds.password.as_deref().unwrap_or("").trim();
    let port = creds.port;

    let script = match engine.as_str() {
        "mysql" => {
            let port_num = port.unwrap_or(3306);
            format!(
                r#"bash -c '
USER="{user}"
PASS="{pass}"
HOST="{host}"
PORT="{port_num}"
DB="{database}"

QUERY="SELECT TABLE_NAME, TABLE_SCHEMA, IFNULL(TABLE_ROWS, 0), CONCAT(ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2), '\'' MB'\''), TABLE_TYPE FROM information_schema.tables WHERE TABLE_SCHEMA = '\''$DB'\'' OR TABLE_SCHEMA = DATABASE() ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC LIMIT 200;"

run_mysql() {{
    if [ -n "$PASS" ]; then
        MYSQL_PWD="$PASS" mysql -u "${{USER:-root}}" ${{HOST:+-h "$HOST"}} -P "$PORT" -D "$DB" --batch --raw -e "$QUERY" 2>/dev/null && return 0
    fi
    if [ -f /etc/mysql/debian.cnf ]; then
        mysql --defaults-file=/etc/mysql/debian.cnf -D "$DB" --batch --raw -e "$QUERY" 2>/dev/null && return 0
    fi
    if [ "$(id -u)" -eq 0 ]; then
        sudo mysql -D "$DB" --batch --raw -e "$QUERY" 2>/dev/null && return 0
    fi
    mysql -u "${{USER:-root}}" -D "$DB" --batch --raw -e "$QUERY" 2>/dev/null
}}
run_mysql
'
"#
            )
        },
        "redis" => {
            let port_num = port.unwrap_or(6379);
            format!(
                r#"bash -c '
HOST="{host}"
PORT="{port_num}"
PASS="{pass}"

H_ARG=""
[ -n "$HOST" ] && H_ARG="-h $HOST"
A_ARG=""
[ -n "$PASS" ] && A_ARG="-a $PASS"

redis-cli $H_ARG -p "$PORT" $A_ARG INFO keyspace 2>/dev/null
echo "===MEMORY==="
redis-cli $H_ARG -p "$PORT" $A_ARG INFO memory 2>/dev/null | grep "used_memory_human:" || true
'
"#
            )
        },
        _ => {
            // PostgreSQL default
            let port_num = port.unwrap_or(5432);
            format!(
                r#"bash -c '
USER="{user}"
PASS="{pass}"
HOST="{host}"
PORT="{port_num}"
DB="{database}"

QUERY="SELECT t.table_name, t.table_schema, COALESCE(c.reltuples, 0)::bigint, pg_size_pretty(pg_total_relation_size(quote_ident(t.table_schema) || '\''.'\'' || quote_ident(t.table_name))), t.table_type FROM information_schema.tables t LEFT JOIN pg_class c ON c.relname = t.table_name WHERE t.table_schema NOT IN ('\''information_schema'\'', '\''pg_catalog'\'') ORDER BY pg_total_relation_size(quote_ident(t.table_schema) || '\''.'\'' || quote_ident(t.table_name)) DESC LIMIT 200;"

run_pg() {{
    if [ -n "$PASS" ] || [ -n "$HOST" ]; then
        export PGPASSWORD="$PASS"
        H_ARG=""
        [ -n "$HOST" ] && H_ARG="-h $HOST"
        U_ARG=""
        [ -n "$USER" ] && U_ARG="-U $USER"
        psql $H_ARG -p "$PORT" $U_ARG -d "$DB" -X -A -F $'\t' -c "$QUERY" 2>/dev/null && return 0
    fi
    if [ "$(id -u)" -eq 0 ]; then
        if id -u postgres >/dev/null 2>&1; then
            sudo -u postgres psql -d "$DB" -X -A -F $'\t' -c "$QUERY" 2>/dev/null && return 0
        fi
    fi
    psql -U "${{USER:-postgres}}" -d "$DB" -X -A -F $'\t' -c "$QUERY" 2>/dev/null
}}
run_pg
'
"#
            )
        }
    };

    let out = exec_ssh_command_full(&mut session, &script, Duration::from_secs(15)).await?;
    let mut tables: Vec<DatabaseTableInfo> = Vec::new();
    let mut keyspaces: Option<Vec<String>> = None;

    if engine == "redis" {
        let mut ks_vec = Vec::new();
        for line in out.stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("db") && trimmed.contains(':') {
                ks_vec.push(trimmed.to_string());
            }
        }
        keyspaces = Some(ks_vec);
    } else {
        let lines: Vec<&str> = out.stdout.lines().collect();
        for line in lines.iter().skip(1) {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('(') {
                continue;
            }
            let cols: Vec<&str> = trimmed.split('\t').collect();
            if cols.len() >= 4 {
                let name = cols[0].trim().to_string();
                let schema = cols.get(1).copied().unwrap_or("public").trim().to_string();
                let rows = cols.get(2).and_then(|v| v.trim().parse::<i64>().ok()).unwrap_or(0);
                let size = cols.get(3).copied().unwrap_or("0 kB").trim().to_string();
                let t_type = cols.get(4).copied().unwrap_or("BASE TABLE").trim().to_string();

                tables.push(DatabaseTableInfo {
                    name,
                    schema,
                    row_estimate: rows,
                    total_size_pretty: size,
                    table_type: t_type,
                });
            }
        }
    }

    let total_tables = tables.len();

    Ok(DatabaseSchemaSummary {
        database,
        engine,
        tables,
        total_tables,
        keyspaces,
    })
}

