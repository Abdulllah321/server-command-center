import { QueryClient, QueryClientProvider as Provider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

export const QueryProvider = ({ children }: { children: ReactNode }) => {
  return (
    <Provider client={queryClient}>
      {children}
    </Provider>
  );
};
