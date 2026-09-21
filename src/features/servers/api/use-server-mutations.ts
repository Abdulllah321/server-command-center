import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createServer, createCredential, deleteServer, type CreateCredentialPayload, type Server } from '@/lib/tauri-client';

interface CreateServerFlowParams {
  server: Omit<Server, 'id' | 'status' | 'last_checked_at' | 'created_at' | 'updated_at'>;
  credential: Omit<CreateCredentialPayload, 'server_id'>;
}

export const useCreateServerFlow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ server, credential }: CreateServerFlowParams) => {
      // 1. Create Server
      const newServer = await createServer(server);
      
      try {
        // 2. Create Credential
        await createCredential({
          ...credential,
          server_id: newServer.id,
        });
        
        return newServer;
      } catch (error) {
        // Rollback: Delete the server if credential creation fails
        console.error('Credential creation failed, rolling back server creation...', error);
        await deleteServer(newServer.id);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });
};
