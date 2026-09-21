import { invoke } from '@tauri-apps/api/core';
import type { Server, AuthMethod, RebuildProfile, CreateCredentialPayload, CredentialMetadataExtended, Application, CreateApplicationOptions } from '../types';

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

export const deleteServer = async (id: string): Promise<void> => {
  return await invoke('delete_server', { id });
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
  // Returns a deployment/pipeline ID
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
  // Returns a session ID to subscribe to
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

// Confirmation Chokepoint
export const confirmAction = async (token: string): Promise<void> => {
  return await invoke('confirm_action', { token });
};
