pub mod commands;
pub mod ssh;
pub mod secrets;
pub mod db;
pub mod pipelines;
pub mod models;
pub mod health_poller;

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
      let _conn = db::init(app.handle()).expect("Failed to initialize database");
      
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
