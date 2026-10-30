import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  type Pm2Process, 
  listPm2Processes, 
  startPm2Process, 
  stopPm2Process, 
  restartPm2Process, 
  reloadPm2Process, 
  deletePm2Process, 
  savePm2Processes,
  tailProcessLog
} from '@/lib/tauri-client';

export const usePm2Processes = (serverId: string, pollInterval: number = 10000) => {
  return useQuery({
    queryKey: ['pm2', serverId],
    queryFn: async () => await listPm2Processes(serverId),
    refetchInterval: pollInterval,
    retry: false,
    staleTime: 5000,
  });
};

export const useStartPm2Process = (serverId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (processId: string) => await startPm2Process(serverId, processId),
    onMutate: async (processId) => {
      await queryClient.cancelQueries({ queryKey: ['pm2', serverId] });
      const previous = queryClient.getQueryData<Pm2Process[]>(['pm2', serverId]);
      if (previous) {
        queryClient.setQueryData<Pm2Process[]>(['pm2', serverId], old => 
          old?.map(p => p.name === processId || p.pm_id.toString() === processId ? { ...p, status: 'online' } : p)
        );
      }
      return { previous };
    },
    onError: (_err, _newTodo, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['pm2', serverId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['pm2', serverId] });
    },
  });
};

export const useStopPm2Process = (serverId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (processId: string) => await stopPm2Process(serverId, processId),
    onMutate: async (processId) => {
      await queryClient.cancelQueries({ queryKey: ['pm2', serverId] });
      const previous = queryClient.getQueryData<Pm2Process[]>(['pm2', serverId]);
      if (previous) {
        queryClient.setQueryData<Pm2Process[]>(['pm2', serverId], old => 
          old?.map(p => p.name === processId || p.pm_id.toString() === processId ? { ...p, status: 'stopped' } : p)
        );
      }
      return { previous };
    },
    onError: (_err, _newTodo, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['pm2', serverId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['pm2', serverId] });
    },
  });
};

export const useRestartPm2Process = (serverId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (processId: string) => await restartPm2Process(serverId, processId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['pm2', serverId] });
    },
  });
};

export const useReloadPm2Process = (serverId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (processId: string) => await reloadPm2Process(serverId, processId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['pm2', serverId] });
    },
  });
};

export const useDeletePm2Process = (serverId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ processId, confirmationToken }: { processId: string, confirmationToken: string }) => 
      await deletePm2Process(serverId, processId, confirmationToken),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['pm2', serverId] });
    },
  });
};

export const useSavePm2Processes = (serverId: string) => {
  return useMutation({
    mutationFn: async () => await savePm2Processes(serverId),
  });
};

export const useProcessLogTail = (serverId: string, logPath: string | undefined, lines: number = 50, pollInterval: number = 5000) => {
  return useQuery({
    queryKey: ['pm2-log', serverId, logPath],
    queryFn: async () => {
      if (!logPath) return '';
      return await tailProcessLog(serverId, logPath, lines);
    },
    enabled: !!logPath,
    refetchInterval: pollInterval,
    retry: false,
  });
};
