import React from 'react';
import { Search, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/use-ui-store';

export const TopBar = () => {
  const { setServerModalOpen } = useUIStore();

  return (
    <header className="h-14 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between px-6 shrink-0">
      <div className="flex-1 flex items-center">
        <div className="relative w-96">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search servers, apps, commands... (Cmd+K)"
            className="w-full bg-background border border-input rounded-md pl-9 pr-4 py-1.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        <Button size="sm" className="gap-2" onClick={() => setServerModalOpen(true)}>
          <Plus className="h-4 w-4" />
          New Server
        </Button>
      </div>
    </header>
  );
};
