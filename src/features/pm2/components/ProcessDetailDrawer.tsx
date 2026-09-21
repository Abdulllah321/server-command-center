import React, { useRef, useEffect } from 'react';
import { Pm2Process } from '@/lib/tauri-client';
import { X, Play, Square, RotateCw, RefreshCw, Trash2, Terminal, FolderOpen, Loader2, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  useStartPm2Process, 
  useStopPm2Process, 
  useRestartPm2Process, 
  useReloadPm2Process,
  useProcessLogTail
} from '../api';

interface ProcessDetailDrawerProps {
  serverId: string;
  process: Pm2Process | null;
  onClose: () => void;
  onDeleteRequest: () => void;
  onViewLogs?: () => void;
}

export const ProcessDetailDrawer: React.FC<ProcessDetailDrawerProps> = ({ serverId, process, onClose, onDeleteRequest, onViewLogs }) => {
  const drawerRef = useRef<HTMLDivElement>(null);

  const startProcess = useStartPm2Process(serverId);
  const stopProcess = useStopPm2Process(serverId);
  const restartProcess = useRestartPm2Process(serverId);
  const reloadProcess = useReloadPm2Process(serverId);

  const { data: logTail, isLoading: isLoadingLog } = useProcessLogTail(serverId, process?.pm_err_log_path, 50, 5000);
  const logContainerRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  // Auto scroll to bottom of logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logTail]);

  if (!process) return null;

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'online': return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'stopped': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      case 'errored': return 'bg-red-500/10 text-red-500 border-red-500/20';
      default: return 'bg-secondary text-secondary-foreground';
    }
  };

  const renderEnvVars = () => {
    if (!process.env || typeof process.env !== 'object') return null;
    
    // Sort keys alphabetically
    const keys = Object.keys(process.env).sort();
    
    return (
      <div className="bg-muted/30 rounded-lg border overflow-hidden">
        <table className="w-full text-sm text-left">
          <tbody className="divide-y">
            {keys.map(key => (
              <tr key={key} className="hover:bg-muted/50">
                <td className="py-2 px-3 font-medium text-muted-foreground w-1/3 break-all">{key}</td>
                <td className="py-2 px-3 font-mono text-xs break-all">••••••••</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <div 
        className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />
      
      <div 
        ref={drawerRef}
        className="fixed inset-y-0 right-0 w-full sm:w-[500px] md:w-[600px] bg-background border-l shadow-2xl z-50 flex flex-col transition-transform transform duration-300 ease-in-out"
      >
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold tracking-tight">{process.name}</h2>
            <Badge variant="outline" className={getStatusColor(process.status)}>
              {process.status}
            </Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-4 border-b bg-muted/20 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => startProcess.mutate(process.name)}>
            <Play className="h-4 w-4" /> Start
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => stopProcess.mutate(process.name)}>
            <Square className="h-4 w-4" /> Stop
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => restartProcess.mutate(process.name)}>
            <RotateCw className="h-4 w-4" /> Restart
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => reloadProcess.mutate(process.name)}>
            <RefreshCw className="h-4 w-4" /> Reload
          </Button>
          <div className="flex-1" />
          <Button variant="destructive" size="sm" className="gap-2" onClick={onDeleteRequest}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground flex items-center gap-2">
              <FolderOpen className="h-4 w-4" /> Configuration
            </h3>
            <div className="grid grid-cols-[120px_1fr] gap-2 text-sm bg-muted/20 p-3 rounded-lg border">
              <span className="text-muted-foreground font-medium">PM2 ID</span>
              <span className="font-mono">{process.pm_id}</span>
              
              <span className="text-muted-foreground font-medium">Script Path</span>
              <span className="font-mono break-all">{process.script_path || 'N/A'}</span>
              
              <span className="text-muted-foreground font-medium">Working Dir</span>
              <span className="font-mono break-all">{process.pm_cwd || 'N/A'}</span>
              
              <span className="text-muted-foreground font-medium">Restarts</span>
              <span>{process.restarts}</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-muted-foreground flex items-center gap-2">
                <Terminal className="h-4 w-4" /> Error Log Tail
              </h3>
              {onViewLogs && (
                <Button variant="outline" size="sm" onClick={onViewLogs} className="h-7 text-xs">
                  <Activity className="h-3 w-3 mr-1" /> Full Live Logs
                </Button>
              )}
            </div>
            {process.pm_err_log_path ? (
              <div className="relative rounded-lg overflow-hidden bg-black/90 border">
                <div className="text-[10px] text-zinc-500 bg-zinc-900/50 px-3 py-1 font-mono border-b border-zinc-800 break-all flex justify-between">
                  {process.pm_err_log_path}
                  {isLoadingLog && <Loader2 className="h-3 w-3 animate-spin" />}
                </div>
                <pre 
                  ref={logContainerRef}
                  className="p-3 text-xs font-mono text-zinc-300 h-[250px] overflow-y-auto whitespace-pre-wrap break-words"
                >
                  {logTail || 'No error log output available.'}
                </pre>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground p-3 bg-muted/20 rounded-lg border">
                No error log path available for this process.
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground">Environment Variables</h3>
            {renderEnvVars()}
          </div>

        </div>
      </div>
    </>
  );
};
