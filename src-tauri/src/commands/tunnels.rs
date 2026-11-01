use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};
use tokio::net::TcpListener;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::error::{CommandError, CommandResult};
use crate::db::{log_activity, ActivityEntry, actions};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortTunnelInfo {
    pub id: String,
    pub server_id: String,
    pub server_name: Option<String>,
    pub name: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub status: String, // "active", "stopped", "error"
    pub created_at: String,
}

#[derive(Clone)]
pub struct TunnelManager {
    active_tunnels: Arc<Mutex<HashMap<String, (PortTunnelInfo, oneshot::Sender<()>)>>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            active_tunnels: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for TunnelManager {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn start_port_tunnel(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    server_id: String,
    name: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> CommandResult<PortTunnelInfo> {
    // 1. Validation
    if local_port == 0 {
        return Err(CommandError::Validation("Local port must be greater than 0".into()));
    }
    if remote_port == 0 {
        return Err(CommandError::Validation("Remote port must be greater than 0".into()));
    }
    let r_host = if remote_host.trim().is_empty() {
        "127.0.0.1".to_string()
    } else {
        remote_host.trim().to_string()
    };

    // Check if local_port is already forwarded by an active tunnel in this manager
    {
        let map = state.tunnel_manager.active_tunnels.lock().await;
        for (existing_info, _) in map.values() {
            if existing_info.local_port == local_port {
                let s_name = existing_info.server_name.as_deref().unwrap_or("another server");
                return Err(CommandError::Validation(format!(
                    "Local port {} is already in use by active tunnel '{}' ({})",
                    local_port, existing_info.name, s_name
                )));
            }
        }
    }

    // Check if local socket can be bound
    let bind_addr = format!("127.0.0.1:{}", local_port);
    let listener = TcpListener::bind(&bind_addr).await
        .map_err(|e| CommandError::Validation(format!("Local port {} cannot be bound (already in use on your PC): {}", local_port, e)))?;

    // 2. Acquire SSH Session
    let session_arc = state.session_manager
        .get_or_connect(server_id.clone(), state.db.clone(), app_handle.clone())
        .await?;

    let server_name: Option<String> = {
        let conn = state.db.lock().ok();
        conn.and_then(|c| {
            c.query_row("SELECT name FROM servers WHERE id = ?1", [&server_id], |row| row.get(0)).ok()
        })
    };

    let tunnel_id = Uuid::new_v4().to_string();
    let (stop_tx, mut stop_rx) = oneshot::channel::<()>();

    let info = PortTunnelInfo {
        id: tunnel_id.clone(),
        server_id: server_id.clone(),
        server_name,
        name: if name.trim().is_empty() { format!("Port {}", remote_port) } else { name.trim().to_string() },
        local_port,
        remote_host: r_host.clone(),
        remote_port,
        status: "active".into(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    // 3. Spawn listener & forwarding loop
    let session_arc_task = session_arc.clone();
    let r_host_task = r_host.clone();
    let tunnel_id_task = tunnel_id.clone();

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    break;
                }
                accepted = listener.accept() => {
                    match accepted {
                        Ok((mut client_stream, _peer_addr)) => {
                            let session_arc_conn = session_arc_task.clone();
                            let host_conn = r_host_task.clone();
                            tauri::async_runtime::spawn(async move {
                                let channel_res = {
                                    let session = session_arc_conn.lock().await;
                                    session.channel_open_direct_tcpip(host_conn, remote_port as u32, "127.0.0.1", local_port as u32).await
                                };

                                match channel_res {
                                    Ok(channel) => {
                                        let mut ssh_stream = channel.into_stream();
                                        let _ = tokio::io::copy_bidirectional(&mut client_stream, &mut ssh_stream).await;
                                    }
                                    Err(err) => {
                                        eprintln!("Failed to open direct-tcpip channel: {}", err);
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            eprintln!("Tunnel {} listener accept failed: {}", tunnel_id_task, e);
                            break;
                        }
                    }
                }
            }
        }
    });

    // 4. Store active tunnel
    {
        let mut map = state.tunnel_manager.active_tunnels.lock().await;
        map.insert(tunnel_id.clone(), (info.clone(), stop_tx));
    }

    // 5. Audit
    {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        log_activity(&conn, ActivityEntry {
            server_id: Some(server_id),
            action: actions::START_TUNNEL.into(),
            target: Some(format!("127.0.0.1:{} -> {}:{}", local_port, r_host, remote_port)),
            status: "success".into(),
            detail: Some(format!("Started local port forward for {}", info.name)),
            duration_ms: None,
        });
    }

    Ok(info)
}

#[tauri::command]
pub async fn stop_port_tunnel(
    state: tauri::State<'_, AppState>,
    tunnel_id: String,
) -> CommandResult<()> {
    let removed = {
        let mut map = state.tunnel_manager.active_tunnels.lock().await;
        map.remove(&tunnel_id)
    };

    if let Some((info, stop_tx)) = removed {
        let _ = stop_tx.send(());

        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        log_activity(&conn, ActivityEntry {
            server_id: Some(info.server_id),
            action: actions::STOP_TUNNEL.into(),
            target: Some(format!("127.0.0.1:{} -> {}:{}", info.local_port, info.remote_host, info.remote_port)),
            status: "success".into(),
            detail: Some(format!("Stopped local port forward for {}", info.name)),
            duration_ms: None,
        });
        Ok(())
    } else {
        Err(CommandError::NotFound(format!("Tunnel {} not found or already stopped", tunnel_id)))
    }
}

#[tauri::command]
pub async fn list_active_tunnels(
    state: tauri::State<'_, AppState>,
    server_id: Option<String>,
) -> CommandResult<Vec<PortTunnelInfo>> {
    let map = state.tunnel_manager.active_tunnels.lock().await;
    let list: Vec<PortTunnelInfo> = map.values()
        .filter(|(info, _)| {
            if let Some(ref sid) = server_id {
                &info.server_id == sid
            } else {
                true
            }
        })
        .map(|(info, _)| info.clone())
        .collect();

    Ok(list)
}

#[tauri::command]
pub async fn get_tunnel_cli_command(
    state: tauri::State<'_, AppState>,
    server_id: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> CommandResult<String> {
    let r_host = if remote_host.trim().is_empty() { "127.0.0.1" } else { remote_host.trim() };

    let (hostname, port, username): (String, u16, String) = {
        let conn = state.db.lock().map_err(|e| CommandError::Database(e.to_string()))?;
        conn.query_row(
            "SELECT hostname, ssh_port, username FROM servers WHERE id = ?1",
            [&server_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(|_| CommandError::NotFound("Server not found".into()))?
    };

    let cmd = if port == 22 {
        format!("ssh -N -f -L {}:{}:{} {}@{}", local_port, r_host, remote_port, username, hostname)
    } else {
        format!("ssh -N -f -p {} -L {}:{}:{} {}@{}", port, local_port, r_host, remote_port, username, hostname)
    };

    Ok(cmd)
}
