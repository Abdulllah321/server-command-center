import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { Server } from '@/types';
import { 
  Server as ServerIcon, 
  MoreVertical, 
  Trash, 
  Edit, 
  TerminalSquare, 
  Terminal as TerminalIcon, 
  Loader2, 
  ArrowRight,
  Copy,
  Check
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HealthWidget } from '@/features/health/components/HealthWidget';
import { usePm2Processes } from '@/features/pm2/api';
import { deleteServer, requestConfirmation } from '@/lib/tauri-client';
import { showIpcError } from '@/lib/error-handler';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { ServerModal } from './ServerModal';

interface ServerCardProps {
  server: Server;
  onDeleted?: () => void;
}

export const ServerCard = ({ server, onDeleted }: ServerCardProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { data: pm2Processes, isLoading: isLoadingPm2 } = usePm2Processes(server.id, 60000);

  const handleCopyHost = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`${server.username}@${server.hostname}:${server.ssh_port}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('SSH address copied to clipboard');
  };

  const getPm2Badge = () => {
    if (isLoadingPm2) return <span className="text-[11px] text-muted-foreground flex items-center"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> PM2</span>;
    if (!pm2Processes) return null;
    if (pm2Processes.length === 0) return null;
    
    const online = pm2Processes.filter(p => p.status === 'online').length;
    const total = pm2Processes.length;
    const isAllOnline = online === total;
    
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${
        isAllOnline 
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      }`}>
        {online}/{total} Apps Active
      </span>
    );
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const token = await requestConfirmation(`Delete server ${server.name}`, [server.id]);
      await deleteServer(server.id, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setIsDeleteDialogOpen(false);
      toast.success(`Server "${server.name}" deleted`);
      onDeleted?.();
    },
    onError: (err: any) => {
      showIpcError(err, { action: 'Delete Server', serverName: server.name });
    }
  });

  const isOnline = server.status === 'online';

  return (
    <>
      <div 
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/json', JSON.stringify({ type: 'server', id: server.id }));
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        className="group relative rounded-2xl border border-border bg-card/90 hover:bg-card hover:border-primary/40 transition-all duration-300 shadow-sm hover:shadow-md cursor-pointer p-6 space-y-5"
        onClick={() => navigate(`/server/${server.id}`)}
      >
        {/* Card Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center text-primary shadow-inner shrink-0 mt-0.5">
              <ServerIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-foreground tracking-tight truncate group-hover:text-primary transition-colors">
                  {server.name}
                </h3>
                {getPm2Badge()}
              </div>

              <div 
                className="text-xs text-muted-foreground font-mono flex items-center gap-1.5 mt-1 hover:text-foreground transition-colors cursor-pointer"
                onClick={handleCopyHost}
                title="Click to copy SSH address"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-muted-foreground/60'}`} />
                <span className="truncate">{server.username}@{server.hostname}:{server.ssh_port}</span>
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 opacity-0 group-hover:opacity-70" />}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
            <Badge variant="outline" className="text-[11px] font-medium bg-muted/80 border-border capitalize text-muted-foreground">
              {server.environment}
            </Badge>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover border-border text-xs">
                <DropdownMenuItem onClick={() => setIsEditOpen(true)}>
                  <Edit className="mr-2 h-3.5 w-3.5" />
                  <span>Edit Server</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setIsDeleteDialogOpen(true)}>
                  <Trash className="mr-2 h-3.5 w-3.5" />
                  <span>Delete Server</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Telemetry Section */}
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground flex items-center justify-between">
            <span>System Telemetry</span>
            <span className="text-[10px] text-muted-foreground/70">Live 30s Poll</span>
          </div>
          <HealthWidget serverId={server.id} variant="compact" pollInterval={30000} />
        </div>

        {/* Tags */}
        {server.tags && server.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {server.tags.map(tag => (
              <span key={tag} className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-muted text-muted-foreground border border-border/60">
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Footer Action Strip */}
        <div className="border-t border-border/60 pt-4 flex items-center justify-between gap-2" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <Button 
              size="sm"
              variant="default"
              className="h-8 px-3 text-xs flex items-center gap-1.5"
              onClick={() => navigate(`/server/${server.id}?tab=terminal`)}
              title="Open Integrated Terminal in Server Command Center"
            >
              <TerminalSquare className="h-3.5 w-3.5" />
              Terminal
            </Button>
            <Button 
              size="sm"
              variant="outline" 
              className="h-8 px-2.5 text-xs border-border hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Launch External SSH Terminal"
              onClick={async () => {
                try {
                  const preference = localStorage.getItem('terminal_preference') || 'windows_terminal';
                  if (preference === 'integrated') {
                    navigate(`/server/${server.id}?tab=terminal`);
                  } else {
                    await invoke('open_external_ssh', {
                      serverId: server.id,
                      terminalPreference: preference,
                      masterPasswordIfNeeded: null
                    });
                  }
                } catch (err: any) {
                  showIpcError(err, { action: 'Launch External SSH', serverName: server.name });
                }
              }}
            >
              <TerminalIcon className="h-3.5 w-3.5 mr-1" />
              External SSH
            </Button>
          </div>

          <div 
            className="text-xs text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-1 font-medium cursor-pointer"
            onClick={() => navigate(`/server/${server.id}`)}
          >
            <span>Manage</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
      </div>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent onClick={e => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete <strong>{server.name}</strong> and remove all associated credentials from your vault.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Server
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ServerModal
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        serverToEdit={server}
      />
    </>
  );
};
