import { invoke } from '@tauri-apps/api/core';
import type { Server, AuthMethod, RebuildProfile, CreateCredentialPayload, CredentialMetadataExtended } from '../types';

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
export const getPm2Processes = async (serverId: string): Promise<any[]> => {
  return await invoke('get_pm2_processes', { serverId });
};

export const actionPm2Process = async (serverId: string, processName: string, action: 'start' | 'stop' | 'restart' | 'reload' | 'delete'): Promise<void> => {
  return await invoke('action_pm2_process', { serverId, processName, action });
};

// Rebuild & Deploy
export const listRebuildProfiles = async (): Promise<RebuildProfile[]> => {
  return await invoke('list_rebuild_profiles');
};

export const triggerRebuild = async (applicationId: string, profileId: string): Promise<string> => {
  // Returns a deployment/pipeline ID
  return await invoke('trigger_rebuild', { applicationId, profileId });
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
export const openLogStream = async (applicationId: string): Promise<string> => {
  return await invoke('open_log_stream', { applicationId });
};

// Confirmation Chokepoint
export const confirmAction = async (token: string): Promise<void> => {
  return await invoke('confirm_action', { token });
};
