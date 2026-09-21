import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Server } from '@/types';
import { Server as ServerIcon, Activity, Cpu, HardDrive, MoreVertical, Trash, Edit } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteServer } from '@/lib/tauri-client';
import { Loader2 } from 'lucide-react';

interface ServerCardProps {
  server: Server;
}

export const ServerCard = ({ server }: ServerCardProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteServer(server.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setIsDeleteDialogOpen(false);
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
              <CardTitle className="text-lg font-medium">{server.name}</CardTitle>
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
          <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div className="flex flex-col space-y-1">
              <span className="text-muted-foreground flex items-center"><HardDrive className="h-3 w-3 mr-1"/> OS</span>
              <span className="font-medium truncate">{server.os || 'Unknown'}</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="text-muted-foreground flex items-center"><Cpu className="h-3 w-3 mr-1"/> CPU</span>
              <span className="font-medium">—</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="text-muted-foreground flex items-center"><Activity className="h-3 w-3 mr-1"/> PM2</span>
              <span className="font-medium">—</span>
            </div>
          </div>
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
