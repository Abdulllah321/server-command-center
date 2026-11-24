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
pub const CREATE_BACKUP_SCHEDULE: &str = "create_backup_schedule";
pub const UPDATE_BACKUP_SCHEDULE: &str = "update_backup_schedule";
pub const DELETE_BACKUP_SCHEDULE: &str = "delete_backup_schedule";
pub const RUN_BACKUP_SCHEDULE: &str = "run_backup_schedule";
pub const UPLOAD_BACKUP_CLOUD: &str = "upload_backup_cloud";

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
pub const MOVE_REMOTE_PATH: &str = "move_remote_path";
pub const COPY_REMOTE_PATH: &str = "copy_remote_path";
pub const DUPLICATE_REMOTE_PATH: &str = "duplicate_remote_path";
pub const COMPRESS_REMOTE_PATH: &str = "compress_remote_path";
pub const EXTRACT_REMOTE_PATH: &str = "extract_remote_path";
pub const SAVE_ENV_FILE: &str = "save_env_file";
pub const RESTORE_ENV_FILE: &str = "restore_env_file";
pub const FLEET_COMMAND: &str = "fleet_command";
pub const DATABASE_QUERY: &str = "database_query";
pub const TERMINATE_DATABASE_CONNECTION: &str = "terminate_database_connection";

pub const CREATE_CRON_JOB: &str = "create_cron_job";
pub const UPDATE_CRON_JOB: &str = "update_cron_job";
pub const DELETE_CRON_JOB: &str = "delete_cron_job";
pub const TOGGLE_CRON_JOB: &str = "toggle_cron_job";
pub const RUN_CRON_JOB_NOW: &str = "run_cron_job_now";
pub const KILL_PROCESS: &str = "kill_process";
pub const ISSUE_SSL_CERTIFICATE: &str = "issue_ssl_certificate";
pub const RENEW_SSL_CERTIFICATES: &str = "renew_ssl_certificates";
pub const DELETE_SSL_CERTIFICATE: &str = "delete_ssl_certificate";
pub const TOGGLE_SSL_AUTO_RENEWAL: &str = "toggle_ssl_auto_renewal";

