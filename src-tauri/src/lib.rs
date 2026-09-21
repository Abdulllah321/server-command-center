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
    pub db: Mutex<Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      
      // Initialize the database
      let conn = db::init(app.handle()).expect("Failed to initialize database");
      
      // Manage state
      app.manage(AppState {
          db: Mutex::new(conn),
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
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
