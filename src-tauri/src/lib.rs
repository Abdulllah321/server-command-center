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
            
            // Seed builtin rebuild profiles
            commands::rebuild::seed_builtin_profiles(&conn).expect("failed to seed builtin profiles");
            
            let db_arc = std::sync::Arc::new(std::sync::Mutex::new(conn));

            // Start background ping loop for server statuses
            commands::health::start_ping_loop(db_arc.clone());

            let session_manager = ssh::session_manager::SessionManager::new();
            let pty_manager = ssh::pty::PtyManager::new();
            
            app.manage(AppState { 
                db: db_arc,
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
        commands::health::get_health,
        commands::pm2::list_processes,
        commands::pm2::start_process,
        commands::pm2::stop_process,
        commands::pm2::restart_process,
        commands::pm2::reload_process,
        commands::pm2::delete_process,
        commands::pm2::save_processes,
        commands::pm2::tail_process_log,
        commands::logs::open_log_stream,
        commands::logs::close_log_stream,
        commands::logs::get_log_session_file,
        commands::logs::read_log_session_file,
        commands::rebuild::list_profiles,
        commands::rebuild::get_profile,
        commands::rebuild::create_profile,
        commands::rebuild::update_profile,
        commands::rebuild::delete_profile,
        commands::applications::list_applications,
        commands::applications::create_application,
        commands::applications::delete_application,
        pipelines::rebuild_engine::trigger_rebuild,
        pipelines::rebuild_engine::abort_pipeline,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
