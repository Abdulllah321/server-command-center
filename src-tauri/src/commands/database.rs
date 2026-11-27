use std::collections::HashMap;
use std::fmt;
use std::time::Instant;
use base64::engine::general_purpose::STANDARD as b64;
use base64::Engine as _;
use russh::ChannelMsg;
use russh::client::Handle;
use serde::{Deserialize, Serialize};
use tokio::time::{timeout, Duration};
use zeroize::Zeroize;

use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::ssh::client::SshClientHandler;
use crate::db::{log_activity, ActivityEntry, actions};
use crate::commands::confirmation::consume_token;
use crate::secrets::redact::redact_secrets;

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct DatabaseCredentials {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub password: Option<String>,
}

impl fmt::Debug for DatabaseCredentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DatabaseCredentials")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("user", &self.user)
            .field("password", &self.password.as_ref().map(|_| "[REDACTED]"))
            .finish()
    }
}

impl Drop for DatabaseCredentials {
    fn drop(&mut self) {
        self.password.zeroize();
    }
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

pub(crate) struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_status: Option<u32>,
}

fn sanitize_error_text(raw: &str, password: &str) -> String {
    let mut cleaned = redact_secrets(raw);
    if !password.is_empty() {
        cleaned = cleaned.replace(password, "***REDACTED***");
    }
    cleaned.trim().to_string()
}

fn combine_error_output(out: &SshOutput) -> String {
    match (out.stdout.trim().is_empty(), out.stderr.trim().is_empty()) {
        (false, false) => format!("{}\n{}", out.stdout.trim(), out.stderr.trim()),
        (false, true) => out.stdout.trim().to_string(),
        (true, false) => out.stderr.trim().to_string(),
        (true, true) => String::new(),
    }
}

async fn exec_ssh_command_full(
    session: &mut Handle<SshClientHandler>,
    cmd: &str,
    timeout_duration: Duration,
) -> Result<SshOutput, CommandError> {
    let mut channel = session.channel_open_session().await
        .map_err(|e| CommandError::Internal(format!("Failed to open SSH channel: {}", e)))?;

    channel.exec(true, cmd).await
        .map_err(|e| CommandError::Internal(format!("Failed to execute remote database command: {}", e)))?;

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut exit_code = None;

    loop {
        let msg_future = channel.wait();
        let msg_opt = match timeout(timeout_duration, msg_future).await {
            Ok(opt) => opt,
            Err(_) => {
                let _ = channel.close().await;
                return Err(CommandError::Internal("Database command timed out on remote server".into()));
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

/// Runs a full bash script safely by base64-encoding it over stdin so nested single quotes,
/// `$'\t'`, dollar-quoted SQL, and special characters in passwords/queries never collide with shells.
pub(crate) async fn exec_bash_script(
    session: &mut Handle<SshClientHandler>,
    script: &str,
    timeout_duration: Duration,
) -> Result<SshOutput, CommandError> {
    let encoded = b64.encode(script.as_bytes());
    let cmd = format!("printf '%s' '{}' | base64 -d | bash", encoded);
    exec_ssh_command_full(session, &cmd, timeout_duration).await
}

/// Generates shared bash setup & multi-tier auth runner helpers (`__scc_run_pg`, `__scc_run_mysql`, `__scc_run_redis`).
/// Each field is base64-decoded inside bash so arbitrary SQL, identifiers, and passwords pass cleanly.
pub(crate) fn build_db_script(
    creds: &DatabaseCredentials,
    default_port: u16,
    database: &str,
    query: &str,
    body: &str,
) -> String {
    let user_b64 = b64.encode(creds.user.as_deref().unwrap_or("").trim().as_bytes());
    let pass_b64 = b64.encode(creds.password.as_deref().unwrap_or("").trim().as_bytes());
    let host_b64 = b64.encode(creds.host.as_deref().unwrap_or("").trim().as_bytes());
    let db_b64 = b64.encode(database.trim().as_bytes());
    let query_b64 = b64.encode(query.as_bytes());
    let port_num = creds.port.unwrap_or(default_port);

    format!(
        r#"export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
SCC_USER=$(printf '%s' '{user_b64}' | base64 -d)
SCC_PASS=$(printf '%s' '{pass_b64}' | base64 -d)
SCC_HOST=$(printf '%s' '{host_b64}' | base64 -d)
SCC_PORT='{port_num}'
SCC_DB=$(printf '%s' '{db_b64}' | base64 -d)
SCC_QUERY=$(printf '%s' '{query_b64}' | base64 -d)

__scc_run_pg_tsv() {{
    local SQL="$1"
    local LAST_ERR=""
    local OUT=""

    if [ -n "$SCC_PASS" ] || [ -n "$SCC_HOST" ]; then
        export PGPASSWORD="$SCC_PASS"
        local H_ARG="${{SCC_HOST:-127.0.0.1}}"
        local U_ARG="${{SCC_USER:-postgres}}"
        local TRY_DBS=("$SCC_DB")
        if [ -z "$SCC_DB" ]; then
            TRY_DBS=("postgres" "template1" "$U_ARG")
        fi
        if command -v psql >/dev/null 2>&1; then
            for DB_CAND in "${{TRY_DBS[@]}}"; do
                if OUT=$(psql -h "$H_ARG" -p "$SCC_PORT" -U "$U_ARG" ${{DB_CAND:+-d "$DB_CAND"}} -X -A -F $'\t' -v ON_ERROR_STOP=1 -c "$SQL" 2>&1); then
                    printf '%s\n' "$OUT"
                    return 0
                fi
                LAST_ERR="$OUT"
                if [ -z "$SCC_HOST" ]; then
                    if OUT=$(psql -p "$SCC_PORT" -U "$U_ARG" ${{DB_CAND:+-d "$DB_CAND"}} -X -A -F $'\t' -v ON_ERROR_STOP=1 -c "$SQL" 2>&1); then
                        printf '%s\n' "$OUT"
                        return 0
                    fi
                fi
            done
        fi
        if [ -z "$SCC_HOST" ] && command -v docker >/dev/null 2>&1; then
            local DOCKER_PG
            DOCKER_PG=$(docker ps --format '{{{{.Names}}}}\t{{{{.Image}}}}' 2>/dev/null | grep -iE 'postgres|timescale|supabase|pgvector|postgis' | cut -f1 | head -n 1)
            if [ -n "$DOCKER_PG" ]; then
                for DB_CAND in "${{TRY_DBS[@]}}"; do
                    if OUT=$(docker exec -e PGPASSWORD="$SCC_PASS" "$DOCKER_PG" psql -U "$U_ARG" ${{DB_CAND:+-d "$DB_CAND"}} -X -A -F $'\t' -v ON_ERROR_STOP=1 -c "$SQL" 2>&1); then
                        printf '%s\n' "$OUT"
                        return 0
                    fi
                    LAST_ERR="$OUT"
                done
            fi
        fi
        printf '%s\n' "$LAST_ERR" >&2
        return 1
    fi

    if command -v psql >/dev/null 2>&1; then
        if [ -n "$SCC_USER" ]; then
            if [ "$(id -u)" -eq 0 ] && id -u "$SCC_USER" >/dev/null 2>&1; then
                export SCC_DB SCC_PORT SCC_SQL_INNER="$SQL"
                if command -v sudo >/dev/null 2>&1; then
                    if OUT=$(cd /tmp && sudo -n -u "$SCC_USER" psql -p "$SCC_PORT" ${{SCC_DB:+-d "$SCC_DB"}} -X -A -F $'\t' -v ON_ERROR_STOP=1 -c "$SQL" 2>&1); then
                        printf '%s\n' "$OUT"
                        return 0
                    fi
                    LAST_ERR="$OUT"
                fi
                if OUT=$(cd /tmp && su -s /bin/bash "$SCC_USER" -c 'psql -p "$SCC_PORT" ${{SCC_DB:+-d "$SCC_DB"}} -X -A -F $'\''\t'\'' -v ON_ERROR_STOP=1 -c "$SCC_SQL_INNER"' 2>&1); then
                    printf '%s\n' "$OUT"
                    return 0
                fi
                LAST_ERR="$OUT"
            fi
            if OUT=$(psql -U "$SCC_USER" -p "$SCC_PORT" ${{SCC_DB:+-d "$SCC_DB"}} -X -A -F $'\t' -v ON_ERROR_STOP=1 -c "$SQL" 2>&1); then
                printf '%s\n' "$OUT"
                return 0
            fi
            LAST_ERR="$OUT"
        fi

        if [ "$(id -u)" -eq 0 ] && id -u postgres >/dev/null 2>&1; then
            export SCC_DB SCC_PORT SCC_SQL_INNER="$SQL"
            if command -v sudo >/dev/null 2>&1; then
                if OUT=$(cd /tmp && sudo -n -u postgres psql -p "$SCC_PORT" ${{SCC_DB:+-d "$SCC_DB"}} -X -A -F $'\t' -v ON_ERROR_STOP=1 -c "$SQL" 2>&1); then
                    printf '%s\n' "$OUT"
                    return 0
                fi
                LAST_ERR="$OUT"
                if [ "$SCC_PORT" = "5432" ]; then
                    if OUT=$(cd /tmp && sudo -n -u postgres psql ${{SCC_DB:+-d "$SCC_DB"}} -X -A -F $'\t' -v ON_ERROR_STOP=1 -c "$SQL" 2>&1); then
                        printf '%s\n' "$OUT"
                        return 0
                    fi
                fi
            fi
            if OUT=$(cd /tmp && su -s /bin/bash postgres -c 'psql -p "$SCC_PORT" ${{SCC_DB:+-d "$SCC_DB"}} -X -A -F $'\''\t'\'' -v ON_ERROR_STOP=1 -c "$SCC_SQL_INNER"' 2>&1); then
                printf '%s\n' "$OUT"
                return 0
            fi
            LAST_ERR="$OUT"
        fi

        if OUT=$(psql -p "$SCC_PORT" ${{SCC_DB:+-d "$SCC_DB"}} -X -A -F $'\t' -v ON_ERROR_STOP=1 -c "$SQL" 2>&1); then
            printf '%s\n' "$OUT"
            return 0
        fi
        [ -z "$LAST_ERR" ] && LAST_ERR="$OUT"

        if OUT=$(psql -U "${{SCC_USER:-postgres}}" -p "$SCC_PORT" ${{SCC_DB:+-d "$SCC_DB"}} -X -A -F $'\t' -v ON_ERROR_STOP=1 -c "$SQL" 2>&1); then
            printf '%s\n' "$OUT"
            return 0
        fi
        if OUT=$(psql -h 127.0.0.1 -p "$SCC_PORT" -U "${{SCC_USER:-postgres}}" ${{SCC_DB:+-d "$SCC_DB"}} -X -A -F $'\t' -v ON_ERROR_STOP=1 -c "$SQL" 2>&1); then
            printf '%s\n' "$OUT"
            return 0
        fi
    fi

    if command -v docker >/dev/null 2>&1; then
        local DOCKER_PG
        DOCKER_PG=$(docker ps --format '{{{{.Names}}}}\t{{{{.Image}}}}' 2>/dev/null | grep -iE 'postgres|timescale|supabase|pgvector|postgis' | cut -f1 | head -n 1)
        if [ -n "$DOCKER_PG" ]; then
            local DK_ENV
            DK_ENV=$(docker inspect -f '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' "$DOCKER_PG" 2>/dev/null || true)
            local DK_USER="${{SCC_USER:-$(printf '%s\n' "$DK_ENV" | sed -n 's/^POSTGRES_USER=//p' | head -n1)}}"
            local DK_PASS
            DK_PASS=$(printf '%s\n' "$DK_ENV" | sed -n 's/^POSTGRES_PASSWORD=//p' | head -n1)
            local DK_DB="${{SCC_DB:-$(printf '%s\n' "$DK_ENV" | sed -n 's/^POSTGRES_DB=//p' | head -n1)}}"
            [ -z "$DK_USER" ] && DK_USER="postgres"
            if OUT=$(docker exec -e PGPASSWORD="$DK_PASS" "$DOCKER_PG" psql -U "$DK_USER" ${{DK_DB:+-d "$DK_DB"}} -X -A -F $'\t' -v ON_ERROR_STOP=1 -c "$SQL" 2>&1); then
                printf '%s\n' "$OUT"
                return 0
            fi
            if [ -z "$SCC_DB" ]; then
                if OUT=$(docker exec -e PGPASSWORD="$DK_PASS" "$DOCKER_PG" psql -U "$DK_USER" -d template1 -X -A -F $'\t' -v ON_ERROR_STOP=1 -c "$SQL" 2>&1); then
                    printf '%s\n' "$OUT"
                    return 0
                fi
            fi
            LAST_ERR="$OUT"
        fi
    fi

    if [ -n "$LAST_ERR" ]; then
        printf '%s\n' "$LAST_ERR" >&2
    elif ! command -v psql >/dev/null 2>&1; then
        printf '%s\n' "psql client is not installed and no running PostgreSQL Docker container was found." >&2
    else
        printf '%s\n' "Could not authenticate to PostgreSQL via socket or local auth. Provide credentials in Custom Auth." >&2
    fi
    return 1
}}

__scc_run_mysql_tsv() {{
    local SQL="$1"
    local MYSQL_BIN
    MYSQL_BIN=$(command -v mysql || command -v mariadb || true)
    local LAST_ERR=""
    local OUT=""

    if [ -n "$SCC_PASS" ] || [ -n "$SCC_HOST" ]; then
        export MYSQL_PWD="$SCC_PASS"
        local U_ARG="${{SCC_USER:-root}}"
        if [ -n "$MYSQL_BIN" ]; then
            if OUT=$("$MYSQL_BIN" -u "$U_ARG" ${{SCC_HOST:+-h "$SCC_HOST"}} -P "$SCC_PORT" ${{SCC_DB:+-D "$SCC_DB"}} --batch --raw -e "$SQL" 2>&1); then
                printf '%s\n' "$OUT"
                return 0
            fi
            LAST_ERR="$OUT"
            if [ -z "$SCC_HOST" ]; then
                if OUT=$("$MYSQL_BIN" -u "$U_ARG" -h 127.0.0.1 -P "$SCC_PORT" ${{SCC_DB:+-D "$SCC_DB"}} --batch --raw -e "$SQL" 2>&1); then
                    printf '%s\n' "$OUT"
                    return 0
                fi
            fi
        fi
        if [ -z "$SCC_HOST" ] && command -v docker >/dev/null 2>&1; then
            local DOCKER_MY
            DOCKER_MY=$(docker ps --format '{{{{.Names}}}}\t{{{{.Image}}}}' 2>/dev/null | grep -iE 'mysql|mariadb' | cut -f1 | head -n 1)
            if [ -n "$DOCKER_MY" ]; then
                if OUT=$(docker exec -e MYSQL_PWD="$SCC_PASS" "$DOCKER_MY" sh -c 'BIN=$(command -v mysql || command -v mariadb); "$BIN" -u "$1" ${{2:+-D "$2"}} --batch --raw -e "$3"' _ "$U_ARG" "$SCC_DB" "$SQL" 2>&1); then
                    printf '%s\n' "$OUT"
                    return 0
                fi
                LAST_ERR="$OUT"
            fi
        fi
        printf '%s\n' "$LAST_ERR" >&2
        return 1
    fi

    if [ -n "$MYSQL_BIN" ]; then
        if [ -f /etc/mysql/debian.cnf ]; then
            if OUT=$("$MYSQL_BIN" --defaults-file=/etc/mysql/debian.cnf ${{SCC_DB:+-D "$SCC_DB"}} --batch --raw -e "$SQL" 2>&1); then
                printf '%s\n' "$OUT"
                return 0
            fi
            LAST_ERR="$OUT"
        fi
        if OUT=$("$MYSQL_BIN" -u "${{SCC_USER:-root}}" -P "$SCC_PORT" ${{SCC_DB:+-D "$SCC_DB"}} --batch --raw -e "$SQL" 2>&1); then
            printf '%s\n' "$OUT"
            return 0
        fi
        [ -z "$LAST_ERR" ] && LAST_ERR="$OUT"

        if [ "$(id -u)" -eq 0 ] && command -v sudo >/dev/null 2>&1; then
            if OUT=$(sudo -n "$MYSQL_BIN" -P "$SCC_PORT" ${{SCC_DB:+-D "$SCC_DB"}} --batch --raw -e "$SQL" 2>&1); then
                printf '%s\n' "$OUT"
                return 0
            fi
        fi
    fi

    if command -v docker >/dev/null 2>&1; then
        local DOCKER_MY
        DOCKER_MY=$(docker ps --format '{{{{.Names}}}}\t{{{{.Image}}}}' 2>/dev/null | grep -iE 'mysql|mariadb' | cut -f1 | head -n 1)
        if [ -n "$DOCKER_MY" ]; then
            local DK_ENV
            DK_ENV=$(docker inspect -f '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' "$DOCKER_MY" 2>/dev/null || true)
            local DK_PASS
            DK_PASS=$(printf '%s\n' "$DK_ENV" | sed -n -e 's/^MYSQL_ROOT_PASSWORD=//p' -e 's/^MARIADB_ROOT_PASSWORD=//p' | head -n1)
            local DK_USER="root"
            if [ -z "$DK_PASS" ]; then
                DK_PASS=$(printf '%s\n' "$DK_ENV" | sed -n -e 's/^MYSQL_PASSWORD=//p' -e 's/^MARIADB_PASSWORD=//p' | head -n1)
                local ALT_U
                ALT_U=$(printf '%s\n' "$DK_ENV" | sed -n -e 's/^MYSQL_USER=//p' -e 's/^MARIADB_USER=//p' | head -n1)
                [ -n "$ALT_U" ] && DK_USER="$ALT_U"
            fi
            [ -n "$SCC_USER" ] && DK_USER="$SCC_USER"
            if OUT=$(docker exec -e MYSQL_PWD="$DK_PASS" "$DOCKER_MY" sh -c 'BIN=$(command -v mysql || command -v mariadb); "$BIN" -u "$1" ${{2:+-D "$2"}} --batch --raw -e "$3"' _ "$DK_USER" "$SCC_DB" "$SQL" 2>&1); then
                printf '%s\n' "$OUT"
                return 0
            fi
            LAST_ERR="$OUT"
        fi
    fi

    if [ -n "$LAST_ERR" ]; then
        printf '%s\n' "$LAST_ERR" >&2
    elif [ -z "$MYSQL_BIN" ]; then
        printf '%s\n' "mysql / mariadb client is not installed and no running MySQL/MariaDB Docker container was found." >&2
    else
        printf '%s\n' "Could not connect to MySQL / MariaDB. Provide credentials in Custom Auth." >&2
    fi
    return 1
}}

__scc_run_redis() {{
    local CMD_STR="$1"
    local DB_NUM="0"
    if [[ "$SCC_DB" =~ ^db([0-9]+)$ ]]; then
        DB_NUM="${{BASH_REMATCH[1]}}"
    fi
    local H_ARG=""
    [ -n "$SCC_HOST" ] && H_ARG="-h $SCC_HOST"
    local LAST_ERR=""
    local OUT=""

    if [ -n "$SCC_PASS" ]; then
        export REDISCLI_AUTH="$SCC_PASS"
    elif [ -z "$SCC_HOST" ] && [ "$(id -u)" -eq 0 ]; then
        local CONF_PASS=""
        for CF in /etc/redis/redis.conf /etc/redis.conf /etc/valkey/valkey.conf /etc/redis/valkey.conf; do
            if [ -r "$CF" ]; then
                CONF_PASS=$(grep -E '^[[:space:]]*requirepass[[:space:]]+' "$CF" 2>/dev/null | head -n1 | awk '{{print $2}}' | tr -d '"' | tr -d "'")
                [ -n "$CONF_PASS" ] && break
            fi
        done
        [ -n "$CONF_PASS" ] && export REDISCLI_AUTH="$CONF_PASS"
    fi

    local REDIS_BIN
    REDIS_BIN=$(command -v redis-cli || command -v valkey-cli || true)

    local -a CMD_ARGS=()
    if command -v xargs >/dev/null 2>&1; then
        while IFS= read -r -d '' tok; do
            CMD_ARGS+=("$tok")
        done < <(printf '%s' "$CMD_STR" | xargs printf '%s\0' 2>/dev/null) || read -ra CMD_ARGS <<< "$CMD_STR"
    else
        read -ra CMD_ARGS <<< "$CMD_STR"
    fi

    if [ -n "$REDIS_BIN" ]; then
        if OUT=$("$REDIS_BIN" $H_ARG -p "$SCC_PORT" -n "$DB_NUM" --no-auth-warning "${{CMD_ARGS[@]}}" 2>&1); then
            if ! printf '%s' "$OUT" | grep -qiE '^(NOAUTH|Could not connect|Connection refused)'; then
                printf '%s\n' "$OUT"
                return 0
            fi
        fi
        LAST_ERR="$OUT"
    fi

    if [ -z "$SCC_HOST" ] && command -v docker >/dev/null 2>&1; then
        local DOCKER_RD
        DOCKER_RD=$(docker ps --format '{{{{.Names}}}}\t{{{{.Image}}}}' 2>/dev/null | grep -iE 'redis|valkey|keydb' | cut -f1 | head -n 1)
        if [ -n "$DOCKER_RD" ]; then
            local DK_PASS="$SCC_PASS"
            if [ -z "$DK_PASS" ]; then
                DK_PASS=$(docker inspect -f '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' "$DOCKER_RD" 2>/dev/null | sed -n 's/^REDIS_PASSWORD=//p' | head -n1)
            fi
            if OUT=$(docker exec -e REDISCLI_AUTH="$DK_PASS" "$DOCKER_RD" sh -c 'BIN=$(command -v redis-cli || command -v valkey-cli); DBN="$1"; shift; "$BIN" -n "$DBN" --no-auth-warning "$@"' _ "$DB_NUM" "${{CMD_ARGS[@]}}" 2>&1); then
                printf '%s\n' "$OUT"
                return 0
            fi
            LAST_ERR="$OUT"
        fi
    fi

    if [ -n "$LAST_ERR" ]; then
        printf '%s\n' "$LAST_ERR" >&2
    elif [ -z "$REDIS_BIN" ]; then
        printf '%s\n' "redis-cli is not installed and no running Redis Docker container was found." >&2
    else
        printf '%s\n' "Could not connect to Redis. Verify host, port, and password in Custom Auth." >&2
    fi
    return 1
}}

{body}
"#
    )
}

pub fn is_query_destructive(query: &str) -> bool {
    let normalized = query.split_whitespace().collect::<Vec<_>>().join(" ").to_uppercase();
    let destructive_tokens = [
        "DROP ", "TRUNCATE ", "DELETE ", "UPDATE ", "ALTER ",
        "GRANT ", "REVOKE ", "FLUSHALL", "FLUSHDB", "SHUTDOWN",
    ];
    destructive_tokens.iter().any(|&token| {
        normalized.starts_with(token) || normalized.contains(&format!(" {}", token))
    })
}

fn strip_noise_lines(text: &str) -> String {
    text.lines()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.starts_with("could not change directory to ")
        })
        .collect::<Vec<_>>()
        .join("\n")
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
    if server_id.trim().is_empty() {
        return Err(CommandError::Validation("Server ID cannot be empty".into()));
    }
    if query.trim().is_empty() {
        return Err(CommandError::Validation("Query cannot be empty".into()));
    }

    let is_safe = safe_mode.unwrap_or(true);
    let destructive = is_query_destructive(&query);

    if is_safe && destructive {
        return Err(CommandError::Validation(
            "Read-Only Safe Mode is active: mutation or destructive query (DROP/DELETE/UPDATE/ALTER/TRUNCATE/FLUSH) blocked. Disable Safe Mode before running.".into(),
        ));
    }

    if destructive {
        consume_token(confirmation_token.as_deref()).await?;
    }

    let creds = credentials.unwrap_or_default();
    let mut pass_for_redact = creds.password.clone().unwrap_or_default();

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let default_port = match engine.as_str() {
        "mysql" => 3306,
        "redis" => 6379,
        _ => 5432,
    };
    let target_db = if database.trim().is_empty() {
        match engine.as_str() {
            "mysql" => "mysql",
            "redis" => "db0",
            _ => "postgres",
        }
    } else {
        database.trim()
    };

    let body = match engine.as_str() {
        "mysql" => "__scc_run_mysql_tsv \"$SCC_QUERY\"",
        "redis" => "__scc_run_redis \"$SCC_QUERY\"",
        _ => "__scc_run_pg_tsv \"$SCC_QUERY\"",
    };

    let script = build_db_script(&creds, default_port, target_db, &query, body);
    let start_time = Instant::now();
    let out_res = exec_bash_script(&mut session, &script, Duration::from_secs(60)).await;
    drop(session);

    let duration_ms = start_time.elapsed().as_millis() as u64;

    let out = match out_res {
        Ok(o) => o,
        Err(e) => {
            let safe_err = sanitize_error_text(&e.to_string(), &pass_for_redact);
            if destructive {
                if let Ok(conn) = state.db.lock() {
                    log_activity(&conn, ActivityEntry {
                        server_id: Some(server_id.clone()),
                        action: actions::DATABASE_QUERY.into(),
                        target: Some(format!("{}/{}", engine, target_db)),
                        status: "failed".into(),
                        detail: Some(safe_err.clone()),
                        duration_ms: Some(duration_ms as i64),
                    });
                }
            }
            pass_for_redact.zeroize();
            return Err(CommandError::Internal(safe_err));
        }
    };

    let raw_combined = strip_noise_lines(&combine_error_output(&out));
    let sanitized_output = sanitize_error_text(&raw_combined, &pass_for_redact);

    let lower_out = sanitized_output.to_lowercase();
    let is_redis_err = engine == "redis" && (
        sanitized_output.trim_start().starts_with("(error)")
            || sanitized_output.trim_start().starts_with("ERR ")
            || sanitized_output.trim_start().starts_with("NOAUTH ")
            || sanitized_output.trim_start().starts_with("WRONGTYPE ")
    );
    let is_cli_or_sql_err = out.exit_status != Some(0)
        || is_redis_err
        || (!sanitized_output.contains('\t') && (
            lower_out.starts_with("error:")
                || lower_out.starts_with("fatal:")
                || lower_out.contains("psql: error:")
                || lower_out.contains("error 10")
                || lower_out.contains("error 20")
                || lower_out.contains("access denied for user")
                || lower_out.contains("syntax error at or near")
                || (lower_out.contains("table '") && lower_out.contains("doesn't exist"))
        ));

    if is_cli_or_sql_err {
        if destructive {
            if let Ok(conn) = state.db.lock() {
                log_activity(&conn, ActivityEntry {
                    server_id: Some(server_id.clone()),
                    action: actions::DATABASE_QUERY.into(),
                    target: Some(format!("{}/{}", engine, target_db)),
                    status: "failed".into(),
                    detail: Some(format!(
                        "Failed query on {}: {}",
                        target_db,
                        sanitized_output.chars().take(180).collect::<String>()
                    )),
                    duration_ms: Some(duration_ms as i64),
                });
            }
        }
        pass_for_redact.zeroize();
        let msg = if sanitized_output.is_empty() {
            "Remote database command failed with non-zero exit status".to_string()
        } else {
            sanitized_output
        };
        return Err(CommandError::Internal(format!("Database query failed: {}", msg)));
    }

    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<HashMap<String, serde_json::Value>> = Vec::new();
    let mut affected_rows: Option<u64> = None;
    let mut is_truncated = false;

    let lines: Vec<&str> = sanitized_output.lines().collect();

    if engine == "redis" {
        columns = vec!["Result".to_string()];
        for line in lines.iter().take(500) {
            let mut map = HashMap::new();
            map.insert("Result".to_string(), serde_json::Value::String(line.to_string()));
            rows.push(map);
        }
        if lines.len() > 500 {
            is_truncated = true;
        }
    } else if !lines.is_empty() {
        let first_line = lines[0].trim_end();
        let command_tags = ["UPDATE ", "DELETE ", "INSERT ", "CREATE ", "ALTER ", "DROP ", "TRUNCATE ", "GRANT ", "REVOKE "];
        let is_tag = lines.len() <= 2 && !first_line.contains('\t') && command_tags.iter().any(|t| first_line.starts_with(t));

        if is_tag {
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
            columns = first_line.split('\t').map(|s| s.trim().to_string()).collect();

            for line in lines.iter().skip(1) {
                let trimmed = line.trim_end();
                if (trimmed.starts_with('(') && (trimmed.ends_with("rows)") || trimmed.ends_with("row)")))
                    || trimmed.is_empty()
                {
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

    if destructive {
        if let Ok(conn) = state.db.lock() {
            let safe_preview = redact_secrets(query.trim()).chars().take(80).collect::<String>();
            log_activity(&conn, ActivityEntry {
                server_id: Some(server_id.clone()),
                action: actions::DATABASE_QUERY.into(),
                target: Some(format!("{}/{}", engine, target_db)),
                status: "success".into(),
                detail: Some(format!("Executed query on {}: {} (rows: {}, time: {}ms)", target_db, safe_preview, row_count, duration_ms)),
                duration_ms: Some(duration_ms as i64),
            });
        }
    }

    pass_for_redact.zeroize();

    Ok(DatabaseQueryResult {
        columns,
        rows,
        row_count,
        execution_time_ms: duration_ms,
        affected_rows,
        raw_output: sanitized_output,
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
    if server_id.trim().is_empty() {
        return Err(CommandError::Validation("Server ID cannot be empty".into()));
    }

    let creds = credentials.unwrap_or_default();
    let mut pass_for_redact = creds.password.clone().unwrap_or_default();

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let target_db = database
        .filter(|d| !d.trim().is_empty())
        .unwrap_or_else(|| match engine.as_str() {
            "mysql" => "mysql".to_string(),
            "redis" => "db0".to_string(),
            _ => "postgres".to_string(),
        });

    let (default_port, body) = match engine.as_str() {
        "mysql" => (
            3306,
            r#"
CONNS_Q="SELECT ID, IFNULL(DB, ''), IFNULL(USER, ''), IFNULL(HOST, ''), IFNULL(COMMAND, ''), IFNULL(REPLACE(REPLACE(REPLACE(INFO, '\r', ' '), '\n', ' '), '\t', ' '), ''), IFNULL(TIME, 0), IFNULL(STATE, '') FROM information_schema.processlist ORDER BY TIME DESC LIMIT 100;"
LIMIT_Q="SHOW VARIABLES LIKE 'max_connections';"
__scc_run_mysql_tsv "$CONNS_Q"
RC=$?
[ $RC -ne 0 ] && exit $RC
echo "===LIMIT==="
__scc_run_mysql_tsv "$LIMIT_Q" || true
"#,
        ),
        "redis" => (
            6379,
            r#"
__scc_run_redis "CLIENT LIST"
RC=$?
[ $RC -ne 0 ] && exit $RC
echo "===LIMIT==="
__scc_run_redis "CONFIG GET maxclients" || true
"#,
        ),
        _ => (
            5432,
            r#"
CONNS_Q="SELECT pid::text, COALESCE(datname, ''), COALESCE(usename, ''), COALESCE(client_addr::text, 'local'), COALESCE(state, 'unknown'), REGEXP_REPLACE(COALESCE(query, ''), E'[\\r\\n\\t]+', ' ', 'g'), ROUND(COALESCE(EXTRACT(EPOCH FROM (now() - query_start)), 0)::numeric, 1) AS duration_seconds, COALESCE(NULLIF(COALESCE(wait_event_type, '') || ': ' || COALESCE(wait_event, ''), ': '), '') FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY duration_seconds DESC LIMIT 100;"
LIMIT_Q="SELECT current_setting('max_connections');"
__scc_run_pg_tsv "$CONNS_Q"
RC=$?
[ $RC -ne 0 ] && exit $RC
echo "===LIMIT==="
__scc_run_pg_tsv "$LIMIT_Q" || true
"#,
        ),
    };

    let script = build_db_script(&creds, default_port, &target_db, "", body);
    let out_res = exec_bash_script(&mut session, &script, Duration::from_secs(15)).await;
    drop(session);

    let out = match out_res {
        Ok(o) => o,
        Err(e) => {
            let safe_err = sanitize_error_text(&e.to_string(), &pass_for_redact);
            pass_for_redact.zeroize();
            return Err(CommandError::Internal(safe_err));
        }
    };

    if out.exit_status != Some(0) {
        let err_msg = sanitize_error_text(&strip_noise_lines(&combine_error_output(&out)), &pass_for_redact);
        pass_for_redact.zeroize();
        return Err(CommandError::Internal(if err_msg.is_empty() {
            format!("Failed to fetch {} connections", engine)
        } else {
            err_msg
        }));
    }

    pass_for_redact.zeroize();

    let clean_stdout = strip_noise_lines(&out.stdout);
    let parts: Vec<&str> = clean_stdout.split("===LIMIT===").collect();
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

        for line in limit_section.lines() {
            if let Ok(limit) = line.trim().parse::<usize>() {
                max_connections_limit = Some(limit);
                break;
            }
        }
    } else {
        for line in conn_section.lines().skip(1) {
            let trimmed = line.trim_end();
            if trimmed.is_empty() || (trimmed.starts_with('(') && (trimmed.ends_with("rows)") || trimmed.ends_with("row)"))) {
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
            if trimmed == "current_setting" || trimmed == "Variable_name\tValue" {
                continue;
            }
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
    if server_id.trim().is_empty() {
        return Err(CommandError::Validation("Server ID cannot be empty".into()));
    }
    if connection_id.trim().is_empty() {
        return Err(CommandError::Validation("Connection ID cannot be empty".into()));
    }

    // Validate numeric/safe connection identifier to prevent SQL/command injection
    let conn_id_trimmed = connection_id.trim();
    if !conn_id_trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err(CommandError::Validation("Connection ID must be a numeric PID / client ID".into()));
    }

    consume_token(confirmation_token.as_deref()).await?;

    let creds = credentials.unwrap_or_default();
    let mut pass_for_redact = creds.password.clone().unwrap_or_default();

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let started = Instant::now();
    let (default_port, target_db, body) = match engine.as_str() {
        "mysql" => (
            3306,
            "mysql",
            r#"__scc_run_mysql_tsv "KILL $SCC_QUERY;""#,
        ),
        "redis" => (
            6379,
            "db0",
            r#"__scc_run_redis "CLIENT KILL ID $SCC_QUERY""#,
        ),
        _ => (
            5432,
            "postgres",
            r#"__scc_run_pg_tsv "SELECT pg_terminate_backend($SCC_QUERY);""#,
        ),
    };

    let script = build_db_script(&creds, default_port, target_db, conn_id_trimmed, body);
    let out_res = exec_bash_script(&mut session, &script, Duration::from_secs(10)).await;
    drop(session);

    let duration_ms = started.elapsed().as_millis() as i64;

    match out_res {
        Ok(out) if out.exit_status == Some(0) => {
            let output = sanitize_error_text(&strip_noise_lines(&combine_error_output(&out)), &pass_for_redact);
            pass_for_redact.zeroize();
            if let Ok(conn) = state.db.lock() {
                log_activity(&conn, ActivityEntry {
                    server_id: Some(server_id.clone()),
                    action: actions::TERMINATE_DATABASE_CONNECTION.into(),
                    target: Some(format!("{}/{}", engine, conn_id_trimmed)),
                    status: "success".into(),
                    detail: Some(format!("Terminated database connection {}: {}", conn_id_trimmed, output)),
                    duration_ms: Some(duration_ms),
                });
            }
            Ok(format!("Connection {} terminated successfully", conn_id_trimmed))
        }
        Ok(out) => {
            let err_msg = sanitize_error_text(&strip_noise_lines(&combine_error_output(&out)), &pass_for_redact);
            pass_for_redact.zeroize();
            if let Ok(conn) = state.db.lock() {
                log_activity(&conn, ActivityEntry {
                    server_id: Some(server_id.clone()),
                    action: actions::TERMINATE_DATABASE_CONNECTION.into(),
                    target: Some(format!("{}/{}", engine, conn_id_trimmed)),
                    status: "failed".into(),
                    detail: Some(err_msg.clone()),
                    duration_ms: Some(duration_ms),
                });
            }
            Err(CommandError::Internal(if err_msg.is_empty() {
                format!("Failed to terminate connection {}", conn_id_trimmed)
            } else {
                err_msg
            }))
        }
        Err(e) => {
            let err_msg = sanitize_error_text(&e.to_string(), &pass_for_redact);
            pass_for_redact.zeroize();
            if let Ok(conn) = state.db.lock() {
                log_activity(&conn, ActivityEntry {
                    server_id: Some(server_id.clone()),
                    action: actions::TERMINATE_DATABASE_CONNECTION.into(),
                    target: Some(format!("{}/{}", engine, conn_id_trimmed)),
                    status: "failed".into(),
                    detail: Some(err_msg.clone()),
                    duration_ms: Some(duration_ms),
                });
            }
            Err(CommandError::Internal(err_msg))
        }
    }
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
    if server_id.trim().is_empty() {
        return Err(CommandError::Validation("Server ID cannot be empty".into()));
    }

    let creds = credentials.unwrap_or_default();
    let mut pass_for_redact = creds.password.clone().unwrap_or_default();

    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    let mut session = session_arc.lock().await;

    let target_db = if database.trim().is_empty() {
        match engine.as_str() {
            "mysql" => "mysql".to_string(),
            "redis" => "db0".to_string(),
            _ => "postgres".to_string(),
        }
    } else {
        database.trim().to_string()
    };

    let (default_port, body) = match engine.as_str() {
        "mysql" => (
            3306,
            r#"
SCHEMA_Q="SELECT TABLE_NAME, TABLE_SCHEMA, IFNULL(TABLE_ROWS, 0), CONCAT(ROUND(IFNULL(DATA_LENGTH + INDEX_LENGTH, 0) / 1024 / 1024, 2), ' MB'), TABLE_TYPE FROM information_schema.tables WHERE TABLE_SCHEMA = COALESCE(NULLIF(DATABASE(), ''), TABLE_SCHEMA) ORDER BY IFNULL(DATA_LENGTH + INDEX_LENGTH, 0) DESC, TABLE_NAME LIMIT 300;"
__scc_run_mysql_tsv "$SCHEMA_Q"
"#,
        ),
        "redis" => (
            6379,
            r#"
__scc_run_redis "INFO keyspace"
RC=$?
[ $RC -ne 0 ] && exit $RC
echo "===MEMORY==="
__scc_run_redis "INFO memory" | grep "used_memory_human:" || true
"#,
        ),
        _ => (
            5432,
            r#"
SCHEMA_Q="SELECT t.table_name, t.table_schema, COALESCE(NULLIF(c.reltuples, -1), 0)::bigint, CASE WHEN c.oid IS NOT NULL AND c.relkind IN ('r', 'p', 'm', 't') THEN pg_size_pretty(pg_total_relation_size(c.oid)) ELSE '0 bytes' END, t.table_type FROM information_schema.tables t LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = t.table_schema LEFT JOIN pg_catalog.pg_class c ON c.relname = t.table_name AND c.relnamespace = n.oid WHERE t.table_schema NOT IN ('information_schema', 'pg_catalog') AND t.table_schema NOT LIKE 'pg_toast%' ORDER BY (CASE WHEN c.oid IS NOT NULL AND c.relkind IN ('r', 'p', 'm', 't') THEN pg_total_relation_size(c.oid) ELSE 0 END) DESC, t.table_schema, t.table_name LIMIT 300;"
__scc_run_pg_tsv "$SCHEMA_Q"
"#,
        ),
    };

    let script = build_db_script(&creds, default_port, &target_db, "", body);
    let out_res = exec_bash_script(&mut session, &script, Duration::from_secs(15)).await;
    drop(session);

    let out = match out_res {
        Ok(o) => o,
        Err(e) => {
            let safe_err = sanitize_error_text(&e.to_string(), &pass_for_redact);
            pass_for_redact.zeroize();
            return Err(CommandError::Internal(safe_err));
        }
    };

    if out.exit_status != Some(0) {
        let err_msg = sanitize_error_text(&strip_noise_lines(&combine_error_output(&out)), &pass_for_redact);
        pass_for_redact.zeroize();
        return Err(CommandError::Internal(if err_msg.is_empty() {
            format!("Failed to load {} tables for '{}'", engine, target_db)
        } else {
            err_msg
        }));
    }

    pass_for_redact.zeroize();

    let clean_stdout = strip_noise_lines(&out.stdout);
    let mut tables: Vec<DatabaseTableInfo> = Vec::new();
    let mut keyspaces: Option<Vec<String>> = None;

    if engine == "redis" {
        let mut ks_vec = Vec::new();
        for line in clean_stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("db") && trimmed.contains(':') {
                ks_vec.push(trimmed.to_string());
            }
        }
        keyspaces = Some(ks_vec);
    } else {
        for line in clean_stdout.lines().skip(1) {
            let trimmed = line.trim_end();
            if trimmed.is_empty() || (trimmed.starts_with('(') && (trimmed.ends_with("rows)") || trimmed.ends_with("row)"))) {
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
        database: target_db,
        engine,
        tables,
        total_tables,
        keyspaces,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_credentials_debug_redacts_password() {
        let creds = DatabaseCredentials {
            host: Some("127.0.0.1".into()),
            port: Some(5432),
            user: Some("dbuser".into()),
            password: Some("super_secret_pw_999".into()),
        };
        let dbg = format!("{:?}", creds);
        assert!(!dbg.contains("super_secret_pw_999"));
        assert!(dbg.contains("[REDACTED]"));
        assert!(dbg.contains("dbuser"));
    }

    #[test]
    fn test_destructive_query_detection_normalizes_whitespace() {
        assert!(is_query_destructive("DROP TABLE users;"));
        assert!(is_query_destructive("  delete\nfrom users where id = 1;"));
        assert!(is_query_destructive("GRANT ALL ON DATABASE app TO public;"));
        assert!(is_query_destructive("FLUSHALL"));
        assert!(!is_query_destructive("SELECT * FROM users WHERE name = 'update';"));
    }

    #[test]
    fn test_build_db_script_avoids_bash_c_quote_breakage_and_hides_raw_secrets() {
        let creds = DatabaseCredentials {
            host: None,
            port: Some(5432),
            user: Some("app_user".into()),
            password: Some("p'a$s\"w0rd!".into()),
        };
        let query = "SELECT 'ok' AS status, E'\\t' AS tab FROM logs WHERE msg <> $$bad$$;";
        let script = build_db_script(&creds, 5432, "app_db", query, "__scc_run_pg_tsv \"$SCC_QUERY\"");
        assert!(!script.contains("p'a$s\"w0rd!"));
        assert!(!script.contains("SELECT 'ok'"));
        assert!(script.contains("-F $'\\t'"));
        assert!(script.contains("ORDER_PROTECTED") || script.contains("base64 -d"));
    }
}

