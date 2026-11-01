import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useGroup } from '../api';
import { listServers, testConnection, type Server } from '@/lib/tauri-client';
import { useQuery } from '@tanstack/react-query';
import { ServerCard } from '@/features/servers/components/ServerCard';
import { Folder, RefreshCw, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirmAction } from '@/components/shared/ConfirmationModal';

export const GroupDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { data: group, isLoading: isGroupLoading } = useGroup(id || '');
  const { data: servers, isLoading: isServersLoading } = useQuery({ queryKey: ['servers'], queryFn: listServers });

  if (isGroupLoading || isServersLoading) {
    return <div className="p-6 text-muted-foreground animate-pulse">Loading group details...</div>;
  }

  if (!group || !servers) {
    return <div className="p-6 text-destructive">Group not found.</div>;
  }

  return <GroupDetailInner id={id!} servers={servers} />;
};

const GroupDetailInner = ({ id, servers }: { id: string, servers: Server[] }) => {
  const { data: groups } = useQuery({ queryKey: ['groups'], queryFn: () => import('@/lib/tauri-client').then(m => m.listGroups()) });
  const { requestConfirmation } = useConfirmAction();
  const [bulkResults, setBulkResults] = useState<{serverName: string, success: boolean, message: string}[] | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  // Find the group in the tree
  const findGroup = (nodes: any[], targetId: string): any => {
    for (const node of nodes) {
      if (node.id === targetId) return node;
      const found = findGroup(node.children, targetId);
      if (found) return found;
    }
    return null;
  };

  const group = groups ? findGroup(groups, id) : null;

  if (!group) return <div className="p-6 text-destructive">Group not found in tree.</div>;

  const groupServers = group.server_ids
    .map((sid: string) => servers.find(s => s.id === sid))
    .filter((s: Server | undefined): s is Server => s !== undefined);

  const handleBulkRestartPM2 = async () => {
    if (groupServers.length === 0) return;
    
    const serverNames = groupServers.map((s: Server) => s.name);
    try {
      await requestConfirmation("Bulk Restart PM2 (all processes)", serverNames);
      
      setIsExecuting(true);
      setBulkResults([]);
      
      const results = [];
      for (const server of groupServers) {
        try {
          await testConnection(server.id, "password");
          results.push({ serverName: server.name, success: true, message: 'Connection successful' });
        } catch (err: any) {
          results.push({ serverName: server.name, success: false, message: err.message || 'Failed' });
        }
        setBulkResults([...results]);
      }
      setIsExecuting(false);
      
    } catch (err) {
      console.log("Confirmation cancelled or failed", err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background p-6 gap-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-3">
          <Folder className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{group.name}</h1>
            <p className="text-muted-foreground text-sm">{groupServers.length} Servers</p>
          </div>
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleBulkRestartPM2} disabled={isExecuting || groupServers.length === 0}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isExecuting ? 'animate-spin' : ''}`} />
            Bulk Restart PM2
          </Button>
          <Button variant="destructive" disabled={isExecuting || groupServers.length === 0} onClick={async () => {
             try {
               await requestConfirmation("Delete All Servers in Group", groupServers.map((s: Server) => s.name));
             } catch {
               // User cancelled confirmation dialog
             }
          }}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Servers
          </Button>
        </div>
      </div>

      {bulkResults && (
        <div className="bg-card border rounded-md p-4 mb-2 shadow-sm">
          <h3 className="font-semibold mb-3">Bulk Action Results</h3>
          <div className="space-y-2">
            {bulkResults.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {r.success ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-destructive" />}
                <span className="font-medium">{r.serverName}:</span>
                <span className={r.success ? "text-muted-foreground" : "text-destructive"}>{r.message}</span>
              </div>
            ))}
            {isExecuting && <div className="text-sm text-muted-foreground animate-pulse mt-2">Executing...</div>}
          </div>
        </div>
      )}

      {groupServers.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg">
          <Folder className="w-12 h-12 mb-4 opacity-20" />
          <p>No servers in this group.</p>
          <p className="text-sm">Drag servers from the dashboard to add them.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {groupServers.map((server: Server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      )}
    </div>
  );
};
