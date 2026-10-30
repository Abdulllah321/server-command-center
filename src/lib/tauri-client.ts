import { invoke } from '@tauri-apps/api/core';
import type { Server, AuthMethod, RebuildProfile, RebuildStep, CreateCredentialPayload, CredentialMetadataExtended, Application, CreateApplicationOptions, Command, ServerGroupTree, ServerGroup, UpdateGroupPayload } from '../types';
export type { Server, AuthMethod, RebuildProfile, RebuildStep, CreateCredentialPayload, CredentialMetadataExtended, Application, CreateApplicationOptions, Command, ServerGroupTree, ServerGroup, UpdateGroupPayload };

// Servers
export const listServers = async (): Promise<Server[]> => {
  return await invoke('list_servers');
};

export const getServer = async (id: string): Promise<Server> => {
  return await invoke('get_server', { id });
};

export const createServer = async (server: Omit<Server, 'id' | 'status' | 'last_checked_at' | 'created_at' | 'updated_at'>): Promise<Server> => {
  return await invoke('create_server', { server });
};

export const updateServer = async (id: string, updates: Partial<Server>): Promise<Server> => {
  return await invoke('update_server', { id, updates });
};

export const requestConfirmation = async (actionDescription: string, targets?: string[]): Promise<string> => {
  const res = await invoke<{ token: string }>('request_confirmation', { payload: { action_description: actionDescription, targets: targets ?? null } });
  return res.token;
};

export const deleteServer = async (id: string, confirmationToken?: string): Promise<void> => {
  const token = confirmationToken || (await requestConfirmation(`Delete server ${id}`, [id]));
  return await invoke('delete_server', { id, confirmationToken: token });
};

export const createCredential = async (payload: CreateCredentialPayload): Promise<any> => {
  return await invoke('create_credential', { payload });
};

export const listCredentialsMetadata = async (): Promise<CredentialMetadataExtended[]> => {
  return await invoke('list_credentials_metadata');
};

export const revealCredential = async (id: string, masterPasswordIfNeeded?: string): Promise<string> => {
  return await invoke('reveal_credential', { id, masterPasswordIfNeeded });
};

export const testConnection = async (serverId: string, authMethod: AuthMethod, masterPasswordIfNeeded?: string): Promise<{ success: boolean; error?: string }> => {
  return await invoke('test_connection', { serverId, authMethod, masterPasswordIfNeeded });
};

export const reconnectServer = async (serverId: string): Promise<void> => {
  return await invoke('reconnect_server', { serverId });
};

export interface DirectTestConnectionPayload {
  server_id?: string;
  server_name?: string;
  hostname: string;
  ssh_port: number;
  username: string;
  auth_method: string;
  secret_payload: string;
}

export const testDirectConnection = async (payload: DirectTestConnectionPayload): Promise<void> => {
  return await invoke('test_direct_connection', { payload });
};

// Credentials Vault
export const unlockVault = async (password: string): Promise<boolean> => {
  return await invoke('unlock_vault', { password });
};

export const setupVault = async (password: string): Promise<void> => {
  return await invoke('setup_vault', { password });
};

// PM2 & Applications
export interface Pm2Process {
  pm_id: number;
  name: string;
  status: string;
  cpu: number;
  memory: number;
  restarts: number;
  uptime: number; // in seconds
  script_path: string;
  pm_cwd?: string;
  pm_err_log_path?: string;
  env?: any;
}

export const listPm2Processes = async (serverId: string): Promise<Pm2Process[]> => {
  return await invoke('list_processes', { serverId });
};

export const startPm2Process = async (serverId: string, processId: string): Promise<void> => {
  return await invoke('start_process', { serverId, processId });
};

export const stopPm2Process = async (serverId: string, processId: string): Promise<void> => {
  return await invoke('stop_process', { serverId, processId });
};

export const restartPm2Process = async (serverId: string, processId: string): Promise<void> => {
  return await invoke('restart_process', { serverId, processId });
};

export const reloadPm2Process = async (serverId: string, processId: string): Promise<void> => {
  return await invoke('reload_process', { serverId, processId });
};

export const deletePm2Process = async (serverId: string, processId: string, confirmationToken: string): Promise<void> => {
  return await invoke('delete_process', { serverId, processId, confirmationToken });
};

export const savePm2Processes = async (serverId: string): Promise<void> => {
  return await invoke('save_processes', { serverId });
};

export const tailProcessLog = async (serverId: string, logPath: string, lines: number): Promise<string> => {
  return await invoke('tail_process_log', { serverId, logPath, lines });
};

// Applications
export const listApplications = async (serverId: string): Promise<Application[]> => {
  return await invoke('list_applications', { serverId });
};

export const createApplication = async (opts: CreateApplicationOptions): Promise<Application> => {
  return await invoke('create_application', { opts });
};

export const deleteApplication = async (id: string): Promise<void> => {
  return await invoke('delete_application', { id });
};

// Rebuild Profiles
export const listProfiles = async (): Promise<RebuildProfile[]> => {
  return await invoke('list_profiles');
};

export const getProfile = async (id: string): Promise<RebuildProfile> => {
  return await invoke('get_profile', { id });
};

export const createProfile = async (opts: { name: string, steps: any[] }): Promise<RebuildProfile> => {
  return await invoke('create_profile', { opts });
};

export const updateProfile = async (id: string, opts: { name: string, steps: any[] }): Promise<RebuildProfile> => {
  return await invoke('update_profile', { id, opts });
};

export const deleteProfile = async (id: string): Promise<void> => {
  return await invoke('delete_profile', { id });
};

export const triggerRebuild = async (applicationId: string, profileId: string, retryFromStep?: number): Promise<string> => {
  return await invoke('trigger_rebuild', { applicationId, profileId, retryFromStep });
};

export const abortPipeline = async (pipelineId: string): Promise<void> => {
  return await invoke('abort_pipeline', { pipelineId });
};

// Health
export const getHealthSnapshot = async (serverId: string): Promise<any> => {
  return await invoke('get_health_snapshot', { serverId });
};

// Terminal
export const openTerminalSession = async (serverId: string): Promise<string> => {
  return await invoke('open_terminal_session', { serverId });
};

export const writeTerminal = async (sessionId: string, data: string): Promise<void> => {
  return await invoke('write_terminal', { sessionId, data });
};

export const closeTerminalSession = async (sessionId: string): Promise<void> => {
  return await invoke('close_terminal_session', { sessionId });
};

// Logs
export const openLogStream = async (serverId: string, pm2Name: string): Promise<string> => {
  return await invoke('open_log_stream', { serverId, pm2Name });
};

export const closeLogStream = async (sessionId: string): Promise<void> => {
  return await invoke('close_log_stream', { sessionId });
};

export const getLogSessionFile = async (sessionId: string): Promise<string> => {
  return await invoke('get_log_session_file', { sessionId });
};

export const readLogSessionFile = async (sessionId: string): Promise<string> => {
  return await invoke('read_log_session_file', { sessionId });
};

// Commands
export const listCommands = async (serverId?: string): Promise<Command[]> => {
  return await invoke('list_commands', { serverId });
};

export const getCommand = async (id: string): Promise<Command> => {
  return await invoke('get_command', { id });
};

export const createCommand = async (opts: { server_id?: string; name: string; command: string; category?: string; icon?: string; is_destructive: boolean }): Promise<Command> => {
  return await invoke('create_command', { opts });
};

export const updateCommand = async (id: string, opts: { name?: string; command?: string; category?: string; icon?: string; is_destructive?: boolean }): Promise<Command> => {
  return await invoke('update_command', { id, opts });
};

export const deleteCommand = async (id: string): Promise<void> => {
  return await invoke('delete_command', { id });
};

export const resetDefaultCommands = async (): Promise<void> => {
  return await invoke('reset_default_commands');
};

export interface CommandOutput {
  output: string;
  exit_code: number | null;
  duration_ms: number;
}

export const runServerCommand = async (
  serverId: string, 
  commandText: string, 
  commandName?: string,
  confirmationToken?: string
): Promise<CommandOutput> => {
  return await invoke('run_server_command', { serverId, commandText, commandName, confirmationToken });
};

// Confirmation Chokepoint
export const confirmAction = async (token: string): Promise<void> => {
  return await invoke('confirm_action', { token });
};

// Activity Log
export interface ActivityLogEntry {
  id: string;
  server_id: string | null;
  server_name: string | null;
  actor: string;
  action: string;
  target: string | null;
  status: 'success' | 'failed';
  detail: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface ActivityFilters {
  server_id?: string;
  action?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

export const getActivityLog = async (filters: ActivityFilters = {}): Promise<ActivityLogEntry[]> => {
  return await invoke('get_activity_log', { filters });
};

export const getActivityActionTypes = async (): Promise<string[]> => {
  return await invoke('get_activity_action_types');
};

// Global Search
export interface SearchServer { id: string; name: string; hostname: string; environment: string; status: string; }
export interface SearchApplication { id: string; name: string; server_id: string; server_name: string | null; branch: string; }
export interface SearchRebuildProfile { id: string; name: string; is_builtin: boolean; step_count: number; }
export interface SearchCommand { id: string; name: string; command: string; is_destructive: boolean; server_id: string | null; server_name: string | null; }
export interface SearchResults {
  servers: SearchServer[];
  applications: SearchApplication[];
  rebuild_profiles: SearchRebuildProfile[];
  commands: SearchCommand[];
}

export const globalSearch = async (query: string): Promise<SearchResults> => {
  return await invoke('global_search', { query });
};

// Groups
export const listGroups = async (): Promise<ServerGroupTree[]> => await invoke('list_groups');
export const getGroup = async (id: string): Promise<ServerGroup> => await invoke('get_group', { id });
export const createGroup = async (name: string, parentId?: string | null): Promise<ServerGroup> => await invoke('create_group', { name, parentId });
export const updateGroup = async (id: string, updates: UpdateGroupPayload): Promise<ServerGroup> => await invoke('update_group', { id, updates });
export const deleteGroup = async (id: string): Promise<void> => await invoke('delete_group', { id });
export const addServerToGroup = async (groupId: string, serverId: string): Promise<void> => await invoke('add_server_to_group', { groupId, serverId });
export const removeServerFromGroup = async (groupId: string, serverId: string): Promise<void> => await invoke('remove_server_from_group', { groupId, serverId });

// Backups
export interface BackupRecord {
  id: string;
  server_id: string;
  target: string;
  destination: string;
  size_bytes: number | null;
  status: string;
  created_at: string;
}

export interface CreateBackupOptions {
  target_type: string;
  target_name: string;
  destination_dir?: string;
  custom_command?: string;
}

export const listBackups = async (serverId: string): Promise<BackupRecord[]> => {
  return await invoke('list_backups', { serverId });
};

export const createBackup = async (serverId: string, options: CreateBackupOptions): Promise<BackupRecord> => {
  return await invoke('create_backup', { serverId, options });
};

export const restoreBackup = async (serverId: string, backupId: string, confirmationToken?: string): Promise<void> => {
  return await invoke('restore_backup', { serverId, backupId, confirmationToken: confirmationToken ?? null });
};

export const deleteBackup = async (serverId: string, backupId: string): Promise<void> => {
  return await invoke('delete_backup', { serverId, backupId });
};

// Nginx & Reverse Proxy
export interface NginxSite {
  name: string;
  domains: string[];
  proxy_pass: string | null;
  ssl_enabled: boolean;
  ssl_certificate: string | null;
  is_enabled: boolean;
  file_path: string;
}

export interface SslCertificate {
  domain: string;
  cert_name: string;
  expiry_date: string | null;
  days_remaining: number | null;
  is_valid: boolean;
}

export const listNginxSites = async (serverId: string): Promise<NginxSite[]> => {
  return await invoke('list_nginx_sites', { serverId });
};

export const getNginxConfig = async (serverId: string, siteName: string): Promise<string> => {
  return await invoke('get_nginx_config', { serverId, siteName });
};

export const saveNginxConfig = async (serverId: string, siteName: string, content: string): Promise<string> => {
  return await invoke('save_nginx_config', { serverId, siteName, content });
};

export const toggleNginxSite = async (serverId: string, siteName: string, enable: boolean): Promise<void> => {
  return await invoke('toggle_nginx_site', { serverId, siteName, enable });
};

export const testNginxConfig = async (serverId: string): Promise<string> => {
  return await invoke('test_nginx_config', { serverId });
};

export const reloadNginx = async (serverId: string): Promise<void> => {
  return await invoke('reload_nginx', { serverId });
};

export const getSslCertificates = async (serverId: string): Promise<SslCertificate[]> => {
  return await invoke('get_ssl_certificates', { serverId });
};

// Threshold Alerts
export interface AlertRule {
  id: string;
  server_id: string;
  metric: string;
  threshold: number;
  operator: string;
  enabled: boolean;
  created_at: string;
}

export interface AlertHistoryEntry {
  id: string;
  server_id: string;
  metric: string;
  value: number;
  message: string;
  triggered_at: string;
}

export interface SaveAlertRuleOptions {
  id?: string;
  server_id: string;
  metric: string;
  threshold: number;
  operator: string;
  enabled: boolean;
}

export const getAlertRules = async (serverId: string): Promise<AlertRule[]> => {
  return await invoke('get_alert_rules', { serverId });
};

export const saveAlertRule = async (rule: SaveAlertRuleOptions): Promise<AlertRule> => {
  return await invoke('save_alert_rule', { rule });
};

export const deleteAlertRule = async (ruleId: string): Promise<void> => {
  return await invoke('delete_alert_rule', { ruleId });
};

export const getAlertHistory = async (serverId: string, limit?: number): Promise<AlertHistoryEntry[]> => {
  return await invoke('get_alert_history', { serverId, limit: limit ?? null });
};

export const evaluateHealthAlerts = async (payload: {
  serverId: string;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  erroredPm2Count: number;
}): Promise<AlertHistoryEntry[]> => {
  return await invoke('evaluate_health_alerts', {
    payload: {
      server_id: payload.serverId,
      cpu_percent: payload.cpuPercent,
      memory_percent: payload.memoryPercent,
      disk_percent: payload.diskPercent,
      errored_pm2_count: payload.erroredPm2Count,
    },
  });
};