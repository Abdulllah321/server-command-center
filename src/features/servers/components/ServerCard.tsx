import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Server } from '@/types';
import { Server as ServerIcon, Activity, Cpu, HardDrive, MoreVertical, Trash, Edit, TerminalSquare, Terminal as TerminalIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HealthWidget } from '@/features/health/components/HealthWidget';
import { usePm2Processes } from '@/features/pm2/api';
import { deleteServer } from '@/lib/tauri-client';
import { Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface ServerCardProps {
  server: Server;
  onDeleted?: () => void;
}

export const ServerCard = ({ server, onDeleted }: ServerCardProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { data: pm2Processes, isLoading: isLoadingPm2 } = usePm2Processes(server.id, 60000); // 60s poll interval for Dashboard cards

  const getPm2Badge = () => {
    if (isLoadingPm2) return <Badge variant="outline" className="text-muted-foreground"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> PM2</Badge>;
    if (!pm2Processes) return <Badge variant="outline" className="text-muted-foreground">PM2 Error</Badge>;
    if (pm2Processes.length === 0) return <Badge variant="outline" className="text-muted-foreground">0 Apps</Badge>;
    
    const online = pm2Processes.filter(p => p.status === 'online').length;
    const total = pm2Processes.length;
    
    if (online === total) {
      return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">{online}/{total} Online</Badge>;
    } else {
      return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">{online}/{total} Online</Badge>;
    }
  };

  const deleteMutation = useMutation({
    mutationFn: () => deleteServer(server.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setIsDeleteDialogOpen(false);
      onDeleted?.();
    }
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'degraded': return 'bg-yellow-500';
      case 'offline': return 'bg-red-500';
      default: return 'bg-slate-500';
    }
  };

  return (
    <>
      <Card 
        className="hover:border-primary/50 cursor-pointer transition-colors bg-card/50 backdrop-blur group"
        onClick={() => navigate(`/server/${server.id}`)}
      >
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <ServerIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <CardTitle className="text-lg font-medium">{server.name}</CardTitle>
                {getPm2Badge()}
              </div>
              <div className="text-sm text-muted-foreground flex items-center mt-1">
                <span className={`w-2 h-2 rounded-full mr-2 ${getStatusColor(server.status)}`} />
                {server.hostname}
              </div>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/server/${server.id}`); }}>
                <Edit className="mr-2 h-4 w-4" />
                <span>Edit Details</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); setIsDeleteDialogOpen(true); }}>
                <Trash className="mr-2 h-4 w-4" />
                <span>Delete Server</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

        </CardHeader>
        <CardContent>
          <HealthWidget serverId={server.id} variant="compact" pollInterval={30000} />
          {server.tags && server.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {server.tags.map(tag => (
                <Badge key={tag} variant="secondary" className="text-xs font-normal">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
        <div className="px-6 pb-6 pt-2 flex items-center gap-3">
          <Button 
            className="w-full" 
            variant="default"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/server/${server.id}`);
            }}
          >
            <TerminalSquare className="mr-2 h-4 w-4" />
            Terminal
          </Button>
          <Button 
            className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/80" 
            variant="secondary"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                // Determine terminal preference (mocking to "windows_terminal" for now, or read from settings later)
                const preference = localStorage.getItem('terminal_preference') || 'windows_terminal';
                
                if (preference === 'integrated') {
                  navigate(`/server/${server.id}`);
                } else {
                  await invoke('open_external_ssh', {
                    serverId: server.id,
                    terminalPreference: preference,
                    masterPasswordIfNeeded: null // If a password is required, they'd ideally be prompted, but for now we pass null
                  });
                }
              } catch (err) {
                console.error("Failed to open external SSH", err);
              }
            }}
          >
            <TerminalIcon className="mr-2 h-4 w-4" />
            SSH
          </Button>
        </div>
      </Card>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
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
    </>
  );
};
