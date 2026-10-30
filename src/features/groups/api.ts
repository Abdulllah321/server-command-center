import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  listGroups, getGroup, createGroup, updateGroup, deleteGroup, 
  addServerToGroup, removeServerFromGroup 
} from '@/lib/tauri-client';
import type { UpdateGroupPayload } from '@/lib/tauri-client';

export const groupsKeys = {
  all: ['groups'] as const,
  detail: (id: string) => [...groupsKeys.all, id] as const,
};

export function useGroups() {
  return useQuery({
    queryKey: groupsKeys.all,
    queryFn: listGroups,
  });
}

export function useGroup(id: string) {
  return useQuery({
    queryKey: groupsKeys.detail(id),
    queryFn: () => getGroup(id),
    enabled: !!id,
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { name: string; parentId?: string | null }) => 
      createGroup(params.name, params.parentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsKeys.all });
    },
  });
}

export function useUpdateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; updates: UpdateGroupPayload }) => 
      updateGroup(params.id, params.updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: groupsKeys.all });
      queryClient.invalidateQueries({ queryKey: groupsKeys.detail(variables.id) });
    },
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsKeys.all });
    },
  });
}

export function useAddServerToGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { groupId: string; serverId: string }) => 
      addServerToGroup(params.groupId, params.serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsKeys.all });
    },
  });
}

export function useRemoveServerFromGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { groupId: string; serverId: string }) => 
      removeServerFromGroup(params.groupId, params.serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsKeys.all });
    },
  });
}
