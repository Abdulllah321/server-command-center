import React, { useState } from 'react';
import { 
  usePm2Processes, 
  useStartPm2Process, 
  useStopPm2Process, 
  useRestartPm2Process, 
  useReloadPm2Process, 
  useDeletePm2Process, 
  useSavePm2Processes 
} from '../api';
import { Play, Square, RotateCw, RefreshCw, Trash2, Save, MoreHorizontal, Activity, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { ProcessDetailDrawer } from './ProcessDetailDrawer';
import { Pm2Process } from '@/lib/tauri-client';
import { LogViewer } from '../../logs/components/LogViewer';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export const Pm2Table = ({ serverId }: { serverId: string }) => {
  const { data: processes, isLoading, isError, error } = usePm2Processes(serverId);
  
  const startProcess = useStartPm2Process(serverId);
  const stopProcess = useStopPm2Process(serverId);
  const restartProcess = useRestartPm2Process(serverId);
  const reloadProcess = useReloadPm2Process(serverId);
  const deleteProcess = useDeletePm2Process(serverId);
  const saveProcesses = useSavePm2Processes(serverId);

  const [deleteTarget, setDeleteTarget] = useState<{ id: string, name: string } | null>(null);
  const [selectedProcess, setSelectedProcess] = useState<Pm2Process | null>(null);
  const [activeLogProcess, setActiveLogProcess] = useState<string | null>(null);

  const formatUptime = (seconds: number) => {
    if (!seconds) return '--';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor(seconds % (3600 * 24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    return `${d}d ${h}h ${m}m`;
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'online': return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'stopped': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      case 'errored': return 'bg-red-500/10 text-red-500 border-red-500/20';
      default: return 'bg-secondary text-secondary-foreground';
    }
  };

  if (isLoading && !processes) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  if (isError && !processes) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center border rounded-xl bg-card border-destructive/20 text-destructive">
        <AlertCircle className="h-8 w-8 mb-4 opacity-80" />
        <h3 className="font-semibold text-lg">Failed to load PM2 processes</h3>
        <p className="text-sm opacity-80 mt-1">{(error as any)?.message || 'Ensure PM2 is installed on the server.'}</p>
      </div>
    );
  }

  const appsCount = processes?.length || 0;
  const onlineCount = processes?.filter(p => p.status === 'online').length || 0;
  const stoppedCount = processes?.filter(p => p.status === 'stopped').length || 0;
  const erroredCount = processes?.filter(p => p.status === 'errored').length || 0;

  return (
    <div className="space-y-6">
      {/* Summary Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 border rounded-xl bg-card">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground font-medium">Total Apps</span>
          <span className="text-2xl font-bold">{appsCount}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground font-medium">Online</span>
          <span className="text-2xl font-bold text-green-500">{onlineCount}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground font-medium">Stopped</span>
          <span className="text-2xl font-bold text-yellow-500">{stoppedCount}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground font-medium">Errored</span>
          <span className="text-2xl font-bold text-red-500">{erroredCount}</span>
        </div>
      </div>

      {/* Table Area */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b bg-muted/40">
          <h3 className="font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" /> 
            Processes
          </h3>
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2"
            onClick={() => saveProcesses.mutate()}
            disabled={saveProcesses.isPending}
          >
            <Save className="h-4 w-4" /> Save State
          </Button>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/20 border-b">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">CPU</th>
                <th className="px-4 py-3 font-medium">RAM</th>
                <th className="px-4 py-3 font-medium">Restarts</th>
                <th className="px-4 py-3 font-medium">Uptime</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {processes?.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    No PM2 processes found on this server.
                  </td>
                </tr>
              ) : (
                processes?.map((proc) => (
                  <tr 
                    key={proc.pm_id} 
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={(e) => {
                      // Don't trigger row click if clicking the dropdown menu
                      if ((e.target as HTMLElement).closest('[data-radix-popper-content-wrapper]') || (e.target as HTMLElement).closest('button')) {
                        return;
                      }
                      setSelectedProcess(proc);
                    }}
                  >
                    <td className="px-4 py-3 font-medium">{proc.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{proc.pm_id}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={getStatusColor(proc.status)}>
                        {proc.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{proc.cpu.toFixed(1)}%</td>
                    <td className="px-4 py-3">{(proc.memory / 1024 / 1024).toFixed(1)} MB</td>
                    <td className="px-4 py-3">{proc.restarts}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatUptime(proc.uptime)}</td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => setActiveLogProcess(proc.name)}>
                            <Activity className="h-4 w-4 mr-2" /> Live Logs
                          </DropdownMenuItem>
                          <div className="h-px bg-border my-1" />
                          <DropdownMenuItem onClick={() => startProcess.mutate(proc.name)}>
                            <Play className="h-4 w-4 mr-2" /> Start
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => stopProcess.mutate(proc.name)}>
                            <Square className="h-4 w-4 mr-2" /> Stop
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => restartProcess.mutate(proc.name)}>
                            <RotateCw className="h-4 w-4 mr-2" /> Restart
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => reloadProcess.mutate(proc.name)}>
                            <RefreshCw className="h-4 w-4 mr-2" /> Reload
                          </DropdownMenuItem>
                          <div className="h-px bg-border my-1" />
                          <DropdownMenuItem 
                            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                            onClick={() => setDeleteTarget({ id: proc.pm_id.toString(), name: proc.name })}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDeleteDialog 
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          processName={deleteTarget.name}
          onConfirm={async (token) => {
            await deleteProcess.mutateAsync({ processId: deleteTarget.name, confirmationToken: token });
          }}
        />
      )}

      {selectedProcess && (
        <ProcessDetailDrawer 
          serverId={serverId}
          process={selectedProcess}
          onClose={() => setSelectedProcess(null)}
          onDeleteRequest={() => setDeleteTarget({ id: selectedProcess.pm_id.toString(), name: selectedProcess.name })}
          onViewLogs={() => setActiveLogProcess(selectedProcess.name)}
        />
      )}

      <Dialog open={!!activeLogProcess} onOpenChange={(open) => !open && setActiveLogProcess(null)}>
        <DialogContent className="max-w-5xl w-[90vw] p-0 border-none bg-transparent shadow-none">
          {activeLogProcess && (
            <LogViewer 
              serverId={serverId} 
              pm2Name={activeLogProcess} 
              onClose={() => setActiveLogProcess(null)} 
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
