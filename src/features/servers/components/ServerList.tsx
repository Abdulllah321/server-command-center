import React, { useState } from 'react';
import { useServers } from '../api/use-servers';
import { ServerCard } from './ServerCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Plus, ServerIcon } from 'lucide-react';
import { ServerModal } from './ServerModal';

interface ServerListProps {
  environmentFilter?: string;
}

export const ServerList = ({ environmentFilter = 'all' }: ServerListProps) => {
  const { data: servers, isLoading, error } = useServers();
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="border rounded-xl p-6 bg-card/50">
            <div className="flex items-center space-x-4 mb-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center border border-destructive/50 rounded-xl bg-destructive/10 text-destructive">
        <p>Failed to load servers. Ensure the backend is running.</p>
      </div>
    );
  }

  if (!servers || servers.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center justify-center py-20 border border-dashed rounded-xl bg-card/30">
          <div className="p-4 bg-primary/10 rounded-full mb-4">
            <ServerIcon className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-xl font-medium tracking-tight mb-2">No servers found</h3>
          <p className="text-muted-foreground text-center max-w-sm mb-6">
            You haven't added any servers to your command center yet.
          </p>
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add your first server
          </Button>
        </div>
        <ServerModal open={isModalOpen} onOpenChange={setIsModalOpen} />
      </>
    );
  }

  const filteredServers = servers?.filter(s => 
    environmentFilter === 'all' || s.environment === environmentFilter
  ) || [];

  if (filteredServers.length === 0 && servers && servers.length > 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        No servers found in the {environmentFilter} environment.
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredServers.map(server => (
          <ServerCard key={server.id} server={server} />
        ))}
      </div>
      <ServerModal open={isModalOpen} onOpenChange={setIsModalOpen} />
    </>
  );
};
