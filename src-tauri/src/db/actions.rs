/// Canonical action names for the activity_log table.
/// Using constants ensures the Activity History screen can filter reliably.
pub const CREATE_SERVER: &str = "create_server";
pub const UPDATE_SERVER: &str = "update_server";
pub const DELETE_SERVER: &str = "delete_server";

pub const CREATE_CREDENTIAL: &str = "create_credential";
pub const DELETE_CREDENTIAL: &str = "delete_credential";

pub const OPEN_TERMINAL: &str = "open_terminal";
pub const OPEN_EXTERNAL_SSH: &str = "open_external_ssh";

pub const PM2_START: &str = "pm2_start";
pub const PM2_STOP: &str = "pm2_stop";
pub const PM2_RESTART: &str = "pm2_restart";
pub const PM2_RELOAD: &str = "pm2_reload";
pub const PM2_DELETE: &str = "pm2_delete";
pub const PM2_SAVE: &str = "pm2_save";

pub const OPEN_LOG_STREAM: &str = "open_log_stream";

pub const CREATE_REBUILD_PROFILE: &str = "create_rebuild_profile";
pub const UPDATE_REBUILD_PROFILE: &str = "update_rebuild_profile";
pub const DELETE_REBUILD_PROFILE: &str = "delete_rebuild_profile";
pub const REBUILD: &str = "rebuild";

pub const RUN_COMMAND: &str = "run_command";

pub const CREATE_GROUP: &str = "create_group";
pub const UPDATE_GROUP: &str = "update_group";
pub const DELETE_GROUP: &str = "delete_group";
pub const ADD_SERVER_TO_GROUP: &str = "add_server_to_group";
pub const REMOVE_SERVER_FROM_GROUP: &str = "remove_server_from_group";

pub const CREATE_BACKUP: &str = "create_backup";
pub const RESTORE_BACKUP: &str = "restore_backup";
pub const DELETE_BACKUP: &str = "delete_backup";
pub const DOWNLOAD_BACKUP: &str = "download_backup";

pub const START_TUNNEL: &str = "start_tunnel";
pub const STOP_TUNNEL: &str = "stop_tunnel";

pub const SAVE_NGINX_CONFIG: &str = "save_nginx_config";
pub const TOGGLE_NGINX_SITE: &str = "toggle_nginx_site";
pub const RELOAD_NGINX: &str = "reload_nginx";

pub const CREATE_ALERT_RULE: &str = "create_alert_rule";
pub const DELETE_ALERT_RULE: &str = "delete_alert_rule";

pub const CREATE_REMOTE_FILE: &str = "create_remote_file";
pub const CREATE_REMOTE_DIRECTORY: &str = "create_remote_directory";
pub const WRITE_REMOTE_FILE: &str = "write_remote_file";
pub const RENAME_REMOTE_PATH: &str = "rename_remote_path";
pub const DELETE_REMOTE_PATH: &str = "delete_remote_path";
pub const UPLOAD_REMOTE_FILE: &str = "upload_remote_file";
pub const DOWNLOAD_REMOTE_FILE: &str = "download_remote_file";
pub const CHMOD_REMOTE_PATH: &str = "chmod_remote_path";

