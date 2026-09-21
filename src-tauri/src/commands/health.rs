use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::health_poller::{fetch_health_snapshot, HealthSnapshot};
use rusqlite::Connection;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

const PING_INTERVAL: Duration = Duration::from_secs(60);
const PING_TIMEOUT: Duration = Duration::from_secs(3);

#[tauri::command]
pub async fn get_health(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<HealthSnapshot> {
    let session_manager = {
        let sm_guard = state.session_manager.lock().await;
        sm_guard.clone()
    };

    let mut session_handle = session_manager
        .get_or_connect(server_id, state.clone(), app_handle.clone())
        .await?;

    fetch_health_snapshot(&mut session_handle).await
}

pub fn start_ping_loop(db_arc: Arc<std::sync::Mutex<Connection>>) {
    tokio::spawn(async move {
        loop {
            // 1. Fetch all servers
            let servers: Vec<(String, String, u16)> = {
                let conn = match db_arc.lock() {
                    Ok(c) => c,
                    Err(_) => {
                        eprintln!("Failed to acquire DB lock in ping loop.");
                        tokio::time::sleep(PING_INTERVAL).await;
                        continue;
                    }
                };
                
                let mut stmt = match conn.prepare("SELECT id, hostname, ssh_port FROM servers") {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("Failed to prepare ping query: {}", e);
                        tokio::time::sleep(PING_INTERVAL).await;
                        continue;
                    }
                };

                let rows = stmt.query_map([], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                });

                match rows {
                    Ok(iter) => iter.filter_map(Result::ok).collect(),
                    Err(e) => {
                        eprintln!("Failed to execute ping query: {}", e);
                        Vec::new()
                    }
                }
            };

            // 2. Ping all servers concurrently
            for (id, hostname, port) in servers {
                let db_clone = db_arc.clone();
                tokio::spawn(async move {
                    let addr = format!("{}:{}", hostname, port);
                    let is_online = match timeout(PING_TIMEOUT, TcpStream::connect(&addr)).await {
                        Ok(Ok(_)) => true,
                        _ => false,
                    };

                    let status_str = if is_online { "online" } else { "offline" };

                    // 3. Update DB
                    if let Ok(conn) = db_clone.lock() {
                        let _ = conn.execute(
                            "UPDATE servers SET status = ?1, last_checked_at = CURRENT_TIMESTAMP WHERE id = ?2",
                            [status_str, &id],
                        );
                    }
                });
            }

            // Sleep until next interval
            tokio::time::sleep(PING_INTERVAL).await;
        }
    });
}
