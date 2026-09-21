import { invoke } from '@tauri-apps/api/core';
import { useQuery } from '@tanstack/react-query';

export interface HealthSnapshot {
  cpu_pct: number;
  ram_pct: number;
  ram_used_mb: number;
  ram_total_mb: number;
  swap_pct: number;
  disk_pct: number;
  disk_used_gb: number;
  disk_total_gb: number;
  load_avg: [number, number, number];
  uptime_seconds: number;
}

export const useHealth = (serverId: string, pollInterval: number = 0) => {
  return useQuery({
    queryKey: ['health', serverId],
    queryFn: async () => {
      return await invoke<HealthSnapshot>('get_health', { serverId });
    },
    refetchInterval: pollInterval > 0 ? pollInterval : false,
    retry: false,
    staleTime: 10000,
  });
};
