import { useQuery } from '@tanstack/react-query';
import { listServers } from '@/lib/tauri-client';
import type { Server } from '@/types';

export const useServers = () => {
  return useQuery<Server[]>({
    queryKey: ['servers'],
    queryFn: () => listServers(),
  });
};
