import { useState } from 'react';
import { 
  usePm2Processes, 
  useStartPm2Process, 
  useStopPm2Process, 
  useRestartPm2Process, 
  useReloadPm2Process, 
  useDeletePm2Process, 
  useSavePm2Processes 
} from '../api';
import { 
  Play, 
  Square, 
  RotateCw, 
  RefreshCw, 
  Trash2, 
  Save, 
  MoreHorizontal, 
  Activity, 
  AlertCircle,
  Terminal
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { ProcessDetailDrawer } from './ProcessDetailDrawer';
import type { Pm2Process } from '@/lib/tauri-client';
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
    return `${d > 0 ? `${d}d ` : ''}${h}h ${m}m`;
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'online': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
      case 'stopped': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
      case 'errored': return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  if (isLoading && !processes) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-2xl bg-muted" />
        <Skeleton className="h-[400px] w-full rounded-2xl bg-muted" />
      </div>
    );
  }

  if (isError && !processes) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center border rounded-2xl bg-card border-destructive/20 text-destructive">
        <AlertCircle className="h-8 w-8 mb-4 opacity-80" />
        <h3 className="font-semibold text-lg">Failed to load PM2 processes</h3>
        <p className="text-sm opacity-80 mt-1 max-w-md">
          {(error as any)?.message || 'Ensure PM2 is installed on the server and accessible in the system PATH.'}
        </p>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl border border-border bg-card flex flex-col gap-1 shadow-xs">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total Workloads</span>
          <span className="text-2xl font-bold font-mono text-foreground">{appsCount}</span>
        </div>
        <div className="p-4 rounded-2xl border border-border bg-card flex flex-col gap-1 shadow-xs">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Online</span>
          <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">{onlineCount}</span>
        </div>
        <div className="p-4 rounded-2xl border border-border bg-card flex flex-col gap-1 shadow-xs">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Stopped</span>
          <span className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">{stoppedCount}</span>
        </div>
        <div className="p-4 rounded-2xl border border-border bg-card flex flex-col gap-1 shadow-xs">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Errored</span>
          <span className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400">{erroredCount}</span>
        </div>
      </div>

      {/* Table Area */}
      <div className="border border-border rounded-2xl bg-card overflow-hidden shadow-xs">
        <div className="flex flex-wrap justify-between items-center p-4 border-b border-border bg-muted/40 gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> 
            <h3 className="font-semibold text-sm">PM2 Process Fleet</h3>
            <span className="text-xs text-muted-foreground font-mono">({onlineCount}/{appsCount} active)</span>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <Button 
              variant="outline" 
              size="sm" 
              className="h-8 gap-1.5 text-xs border-border hover:border-amber-500/30 hover:bg-amber-500/10 text-amber-600 dark:text-amber-400"
              onClick={() => restartProcess.mutate('all')}
              disabled={restartProcess.isPending}
            >
              <RotateCw className={`h-3.5 w-3.5 ${restartProcess.isPending ? 'animate-spin' : ''}`} />
              Restart All
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="h-8 gap-1.5 text-xs border-border hover:border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              onClick={() => reloadProcess.mutate('all')}
              disabled={reloadProcess.isPending}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${reloadProcess.isPending ? 'animate-spin' : ''}`} />
              Reload All (Zero-Downtime)
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="h-8 gap-1.5 text-xs border-border hover:bg-accent"
              onClick={() => saveProcesses.mutate()}
              disabled={saveProcesses.isPending}
            >
              <Save className="h-3.5 w-3.5" /> Save State
            </Button>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/30 border-b border-border">
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
            <tbody className="divide-y divide-white/5">
              {processes?.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    No PM2 processes found running on this server.
                  </td>
                </tr>
              ) : (
                processes?.map((proc) => (
                  <tr 
                    key={proc.pm_id} 
                    className="hover:bg-white/[0.02] transition-colors cursor-pointer group"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('[data-radix-popper-content-wrapper]') || (e.target as HTMLElement).closest('button')) {
                        return;
                      }
                      setSelectedProcess(proc);
                    }}
                  >
                    <td className="px-4 py-3 font-medium text-foreground group-hover:text-primary transition-colors">
                      {proc.name}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{proc.pm_id}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={`text-[11px] capitalize font-medium ${getStatusColor(proc.status)}`}>
                        {proc.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{proc.cpu.toFixed(1)}%</td>
                    <td className="px-4 py-3 font-mono text-xs">{(proc.memory / 1024 / 1024).toFixed(1)} MB</td>
                    <td className="px-4 py-3 font-mono text-xs">{proc.restarts}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{formatUptime(proc.uptime)}</td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-white/10"
                          title="Stream live logs"
                          onClick={() => setActiveLogProcess(proc.name)}
                        >
                          <Terminal className="h-3.5 w-3.5 mr-1 text-blue-400" />
                          Logs
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs border-border hover:border-amber-500/30 hover:bg-amber-500/10 text-amber-600 dark:text-amber-300"
                          title="Restart process"
                          onClick={() => restartProcess.mutate(proc.name)}
                          disabled={restartProcess.isPending}
                        >
                          <RotateCw className={`h-3 w-3 mr-1 ${restartProcess.isPending ? 'animate-spin' : ''}`} />
                          Restart
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs border-border hover:border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                          title="Zero-downtime reload"
                          onClick={() => reloadProcess.mutate(proc.name)}
                          disabled={reloadProcess.isPending}
                        >
                          <RefreshCw className={`h-3 w-3 mr-1 ${reloadProcess.isPending ? 'animate-spin' : ''}`} />
                          Reload
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40 bg-card border-border text-foreground text-xs">
                            {proc.status === 'online' ? (
                              <DropdownMenuItem onClick={() => stopProcess.mutate(proc.name)}>
                                <Square className="h-3.5 w-3.5 mr-2 text-amber-400" /> Stop
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => startProcess.mutate(proc.name)}>
                                <Play className="h-3.5 w-3.5 mr-2 text-emerald-400" /> Start
                              </DropdownMenuItem>
                            )}
                            <div className="h-px bg-white/10 my-1" />
                            <DropdownMenuItem 
                              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                              onClick={() => setDeleteTarget({ id: proc.pm_id.toString(), name: proc.name })}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
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
        <DialogContent showCloseButton={false} className="max-w-6xl w-[92vw] h-[85vh] max-h-[850px] p-0 border-none bg-transparent shadow-2xl">
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
