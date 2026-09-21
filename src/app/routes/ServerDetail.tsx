import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TerminalTabManager } from '@/features/terminal/components/TerminalTabManager';
import { HealthWidget } from '@/features/health/components/HealthWidget';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { RebuildWizard } from '@/features/rebuild/components/RebuildWizard';

import { Pm2Table } from '@/features/pm2/components/Pm2Table';

export const ServerDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');

  if (!id) return null;

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden p-6 gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Server Overview</h1>
        </div>
        <RebuildWizard serverId={id} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="pm2">PM2 Apps</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="flex-1 mt-6 overflow-y-auto pr-2">
          <div className="space-y-6">
            <h2 className="text-lg font-semibold tracking-tight border-b pb-2">System Health</h2>
            {/* Poll interval 10s for active overview tab */}
            <HealthWidget serverId={id} variant="full" pollInterval={activeTab === 'overview' ? 10000 : 0} />
          </div>
        </TabsContent>

        <TabsContent value="pm2" className="flex-1 mt-6 overflow-y-auto pr-2">
          <Pm2Table serverId={id} />
        </TabsContent>
        
        <TabsContent value="terminal" keepMounted className="flex-1 min-h-0 h-full mt-6 data-[state=inactive]:hidden">
          {/* We use hidden and keepMounted so the terminal connections don't drop on tab switch */}
          <TerminalTabManager serverId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
};
