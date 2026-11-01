import { useState } from 'react';
import { useServers } from '../api/use-servers';
import { ServerCard } from './ServerCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Plus, ServerIcon, SearchX } from 'lucide-react';
import { ServerModal } from './ServerModal';

interface ServerListProps {
  environmentFilter?: string;
  searchQuery?: string;
  onClearSearch?: () => void;
}

export const ServerList = ({ 
  environmentFilter = 'all', 
  searchQuery = '', 
  onClearSearch 
}: ServerListProps) => {
  const { data: servers, isLoading, error } = useServers();
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-6 w-full">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="border border-border rounded-2xl p-6 bg-card space-y-4">
            <div className="flex items-center space-x-4">
              <Skeleton className="h-11 w-11 rounded-xl bg-muted" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-36 bg-muted" />
                <Skeleton className="h-3.5 w-24 bg-muted" />
              </div>
            </div>
            <Skeleton className="h-24 w-full rounded-xl bg-muted" />
            <div className="flex justify-between pt-2">
              <Skeleton className="h-8 w-24 rounded-lg bg-muted" />
              <Skeleton className="h-8 w-16 rounded-lg bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center border border-destructive/40 rounded-2xl bg-destructive/10 text-destructive">
        <p className="font-medium">Failed to load servers</p>
        <p className="text-xs text-destructive/80 mt-1">Ensure the Tauri backend is running and the SQLite database is reachable.</p>
      </div>
    );
  }

  if (!servers || servers.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center justify-center py-20 px-4 border border-dashed border-border rounded-2xl bg-card/40 w-full text-center">
          <div className="p-4 bg-primary/10 rounded-2xl mb-4 border border-primary/20">
            <ServerIcon className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-xl font-semibold tracking-tight text-foreground mb-2">No servers registered yet</h3>
          <p className="text-muted-foreground text-sm max-w-md mb-6">
            Add your first remote host to monitor live CPU/RAM health, manage PM2 processes, and open instant SSH terminal sessions.
          </p>
          <Button onClick={() => setIsModalOpen(true)} className="shadow-lg shadow-primary/20">
            <Plus className="h-4 w-4 mr-2" />
            Add Server
          </Button>
        </div>
        <ServerModal open={isModalOpen} onOpenChange={setIsModalOpen} />
      </>
    );
  }

  const query = searchQuery.trim().toLowerCase();

  const filteredServers = servers.filter(s => {
    const matchesEnv = environmentFilter === 'all' || s.environment === environmentFilter;
    if (!matchesEnv) return false;

    if (!query) return true;

    return (
      s.name.toLowerCase().includes(query) ||
      s.hostname.toLowerCase().includes(query) ||
      s.username.toLowerCase().includes(query) ||
      (s.tags && s.tags.some(t => t.toLowerCase().includes(query)))
    );
  });

  if (filteredServers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 border border-border rounded-2xl bg-card/40 text-center w-full">
        <SearchX className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <h3 className="text-base font-semibold text-foreground mb-1">No matching servers found</h3>
        <p className="text-xs text-muted-foreground max-w-sm mb-4">
          No servers match your current filter{environmentFilter !== 'all' ? ` for "${environmentFilter}"` : ''}
          {query ? ` matching "${searchQuery}"` : ''}.
        </p>
        {onClearSearch && (
          <Button variant="outline" size="sm" onClick={onClearSearch}>
            Clear filters
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-6 w-full">
        {filteredServers.map(server => (
          <ServerCard key={server.id} server={server} />
        ))}
      </div>
      <ServerModal open={isModalOpen} onOpenChange={setIsModalOpen} />
    </>
  );
};
