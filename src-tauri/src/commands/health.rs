use crate::AppState;
use crate::error::CommandResult;
use crate::health_poller::{fetch_health_snapshot, HealthSnapshot};
use rusqlite::Connection;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

const PING_INTERVAL: Duration = Duration::from_secs(60);
const PING_TIMEOUT: Duration = Duration::from_secs(3);

#[tauri::command]
pub async fn get_health(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
) -> CommandResult<HealthSnapshot> {
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;
    
    let res = {
        let mut session_handle = session_arc.lock().await;
        fetch_health_snapshot(&mut session_handle).await
    };

    match res {
        Ok(snapshot) => Ok(snapshot),
        Err(e) => {
            let err_str = e.to_string();
            if err_str.contains("ConnectFailed") || err_str.contains("Failed to open SSH channel") || err_str.contains("closed") {
                log::warn!("SSH channel for server {} failed ({}), evicting dead session and reconnecting...", server_id, err_str);
                state.session_manager.evict_session(&server_id).await;
                
                let new_session_arc = state.session_manager
                    .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
                    .await?;
                let mut new_handle = new_session_arc.lock().await;
                fetch_health_snapshot(&mut new_handle).await
            } else {
                Err(e)
            }
        }
    }
}

pub fn start_ping_loop(db_arc: Arc<std::sync::Mutex<Connection>>) {
    tauri::async_runtime::spawn(async move {
        loop {
            // 1. Fetch all servers
            let servers: Vec<(String, String, u16)> = {
                if let Ok(conn) = db_arc.lock() {
                    if let Ok(mut stmt) = conn.prepare("SELECT id, hostname, ssh_port FROM servers") {
                        stmt.query_map([], |row| {
                            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                        }).map(|iter| iter.filter_map(Result::ok).collect()).unwrap_or_default()
                    } else {
                        Vec::new()
                    }
                } else {
                    Vec::new()
                }
            };

            // 2. Ping all servers concurrently
            for (id, hostname, port) in servers {
                let db_clone = db_arc.clone();
                tauri::async_runtime::spawn(async move {
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
