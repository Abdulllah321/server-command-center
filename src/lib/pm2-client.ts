import { invoke } from '@tauri-apps/api/core';

// ... existing code ...

export interface Pm2Process {
  pm_id: number;
  name: string;
  status: string;
  cpu: number;
  memory: number;
  restarts: number;
  uptime: number; // in seconds
  script_path: string;
  env?: any;
}

export async function listPm2Processes(serverId: string): Promise<Pm2Process[]> {
  return invoke('list_processes', { serverId });
}

export async function startPm2Process(serverId: string, processId: string): Promise<void> {
  return invoke('start_process', { serverId, processId });
}

export async function stopPm2Process(serverId: string, processId: string): Promise<void> {
  return invoke('stop_process', { serverId, processId });
}

export async function restartPm2Process(serverId: string, processId: string): Promise<void> {
  return invoke('restart_process', { serverId, processId });
}

export async function reloadPm2Process(serverId: string, processId: string): Promise<void> {
  return invoke('reload_process', { serverId, processId });
}

export async function deletePm2Process(serverId: string, processId: string, confirmationToken: string): Promise<void> {
  return invoke('delete_process', { serverId, processId, confirmationToken });
}

export async function savePm2Processes(serverId: string): Promise<void> {
  return invoke('save_processes', { serverId });
}
