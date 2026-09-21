import React, { useState } from 'react';
import { ServerList } from '@/features/servers/components/ServerList';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { ServerModal } from '@/features/servers/components/ServerModal';
import { useUIStore } from '@/stores/use-ui-store';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export const Dashboard = () => {
  const { isServerModalOpen, setServerModalOpen } = useUIStore();
  const [environmentFilter, setEnvironmentFilter] = useState('all');

  return (
    <div className="flex-1 p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Manage and monitor your infrastructure</p>
        </div>
        <div className="flex items-center space-x-4">
          <Tabs defaultValue="all" value={environmentFilter} onValueChange={setEnvironmentFilter} className="w-[400px]">
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="production">Production</TabsTrigger>
              <TabsTrigger value="staging">Staging</TabsTrigger>
              <TabsTrigger value="development">Dev</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={() => setServerModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Server
          </Button>
        </div>
      </div>
      <ServerList environmentFilter={environmentFilter} />
      <ServerModal open={isServerModalOpen} onOpenChange={setServerModalOpen} />
    </div>
  );
};
