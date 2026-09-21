import { useQuery, useMutation } from '@tanstack/react-query';
import { listCredentialsMetadata, revealCredential } from '@/lib/tauri-client';

export const useCredentials = () => {
  return useQuery({
    queryKey: ['credentials'],
    queryFn: () => listCredentialsMetadata(),
  });
};

export const useRevealCredential = () => {
  return useMutation({
    mutationFn: async ({ id, masterPassword }: { id: string; masterPassword?: string }) => {
      return await revealCredential(id, masterPassword);
    }
  });
};
