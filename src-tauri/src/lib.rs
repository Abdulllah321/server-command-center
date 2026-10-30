pub mod commands;
pub mod ssh;
pub mod secrets;
pub mod db;
pub mod pipelines;
pub mod models;
pub mod health_poller;
pub mod error;

use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub session_manager: ssh::session_manager::SessionManager,
    pub pty_manager: ssh::pty::PtyManager,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|info| {
        let payload = info.payload();
        let message = if let Some(s) = payload.downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = payload.downcast_ref::<String>() {
            s.clone()
        } else {
            "Box<dyn Any>".to_string()
        };

        let location = info.location().map(|loc| format!("{}:{}", loc.file(), loc.line())).unwrap_or_else(|| "unknown".to_string());
        
        let redacted_message = crate::secrets::redact::redact_secrets(&message);
        
        eprintln!("thread panicked at '{}', {}", redacted_message, location);
    }));

  tauri::Builder::default()
        .setup(|app| {
            // Run database migrations
            let app_dir = app.path().app_data_dir().expect("failed to get app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
            
            let db_path = app_dir.join("command_center.sqlite");
            let conn = db::init_db(&db_path).expect("failed to init database");
            
            // Seed builtin rebuild profiles
            commands::rebuild::seed_builtin_profiles(&conn).expect("failed to seed builtin profiles");
            
            let db_arc = Arc::new(Mutex::new(conn));

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
        commands::credentials::unlock_vault,
        commands::credentials::setup_vault,
        commands::ssh::test_connection,
        commands::ssh::test_direct_connection,
        commands::ssh::resolve_host_key_verification,
        commands::ssh::reconnect_server,
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
        commands::commands::list_commands,
        commands::commands::reset_default_commands,
        commands::commands::get_command,
        commands::commands::create_command,
        commands::commands::update_command,
        commands::commands::delete_command,
        commands::commands::run_server_command,
        commands::confirmation::request_confirmation,
        commands::activity::get_activity_log,
        commands::activity::get_activity_action_types,
        commands::search::global_search,
        commands::groups::list_groups,
        commands::groups::get_group,
        commands::groups::create_group,
        commands::groups::update_group,
        commands::groups::delete_group,
        commands::groups::add_server_to_group,
        commands::known_hosts::list_known_hosts,
        commands::known_hosts::delete_known_host,
        commands::backups::list_backups,
        commands::backups::create_backup,
        commands::backups::restore_backup,
        commands::backups::delete_backup,
        commands::nginx::list_nginx_sites,
        commands::nginx::get_nginx_config,
        commands::nginx::save_nginx_config,
        commands::nginx::toggle_nginx_site,
        commands::nginx::test_nginx_config,
        commands::nginx::reload_nginx,
        commands::nginx::get_ssl_certificates,
        commands::alerts::get_alert_rules,
        commands::alerts::save_alert_rule,
        commands::alerts::delete_alert_rule,
        commands::alerts::get_alert_history,
        commands::alerts::evaluate_health_alerts,
        pipelines::rebuild_engine::trigger_rebuild,
        pipelines::rebuild_engine::abort_pipeline,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
