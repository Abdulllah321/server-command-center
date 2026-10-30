import { QueryClient, QueryClientProvider as Provider, MutationCache } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { showIpcError } from '@/lib/error-handler';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // If the mutation has a custom onError handler, let it handle or complement
      if (!mutation.options.onError) {
        showIpcError(error, { action: 'Perform Action' });
      }
    },
  }),
});

export const QueryProvider = ({ children }: { children: ReactNode }) => {
  return (
    <Provider client={queryClient}>
      {children}
    </Provider>
  );
};
