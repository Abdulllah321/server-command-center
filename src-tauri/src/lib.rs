pub mod commands;
pub mod ssh;
pub mod secrets;
pub mod db;
pub mod pipelines;
pub mod models;
pub mod health_poller;

use std::sync::Mutex;
use rusqlite::Connection;

pub struct AppState {
    pub db: std::sync::Mutex<rusqlite::Connection>,
    pub session_manager: ssh::session_manager::SessionManager,
    pub pty_manager: ssh::pty::PtyManager,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
        .setup(|app| {
            // Run database migrations
            let app_dir = app.path().app_data_dir().expect("failed to get app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
            
            let db_path = app_dir.join("command_center.sqlite");
            let conn = db::init_db(&db_path).expect("failed to init database");

            let session_manager = ssh::session_manager::SessionManager::new();
            let pty_manager = ssh::pty::PtyManager::new();
            
            app.manage(AppState { 
                db: std::sync::Mutex::new(conn),
                session_manager,
                pty_manager,
            });
      
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        commands::servers::list_servers,
        commands::servers::get_server,
        commands::servers::create_server,
        commands::servers::update_server,
        commands::servers::delete_server,
        commands::credentials::create_credential,
        commands::credentials::get_credential_metadata,
        commands::credentials::list_credentials_metadata,
        commands::credentials::reveal_credential,
        commands::credentials::delete_credential,
        commands::ssh::test_connection,
        commands::ssh::resolve_host_key_verification,
        commands::terminal::open_terminal,
        commands::terminal::write_terminal,
        commands::terminal::resize_terminal,
        commands::terminal::close_terminal,
        commands::external_ssh::open_external_ssh,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
