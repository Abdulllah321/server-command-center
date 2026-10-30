import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { TerminalTabManager } from '@/features/terminal/components/TerminalTabManager';
import { HealthWidget } from '@/features/health/components/HealthWidget';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { 
  ArrowLeft, 
  Globe, 
  HardDrive, 
  Bell, 
  Terminal, 
  TerminalSquare,
  Activity, 
  Layers, 
  Edit, 
  Trash, 
  Loader2, 
  KeyRound,
  Rocket,
  RotateCw,
  RefreshCw,
  Copy,
  Check
} from 'lucide-react';
import { cn } from 'cn';
import { QuickActionsGrid } from '@/features/quick-actions/components/QuickActionsGrid';
import { Pm2Table } from '@/features/pm2/components/Pm2Table';
import { NginxManager } from '@/features/nginx/components/NginxManager';
import { BackupsManager } from '@/features/backups/components/BackupsManager';
import { AlertsManager } from '@/features/alerts/components/AlertsManager';
import { ServerModal } from '@/features/servers/components/ServerModal';
import { ServerConnectionBanner } from '@/features/servers/components/ServerConnectionBanner';
import { QuickConnectModal } from '@/features/servers/components/QuickConnectModal';
import { LogViewer } from '@/features/logs/components/LogViewer';
import { ServerRebuildDeck } from '@/features/rebuild/components/ServerRebuildDeck';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getServer, deleteServer, requestConfirmation, restartPm2Process, reloadPm2Process } from '@/lib/tauri-client';
import { usePm2Processes } from '@/features/pm2/api';
import { showIpcError } from '@/lib/error-handler';
import { toast } from 'sonner';

export const ServerDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const tabParam = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(tabParam);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isQuickConnectOpen, setIsQuickConnectOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [copiedHost, setCopiedHost] = useState(false);

  // Keep active tab synced if URL query parameter changes
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    setSearchParams({ tab: newTab });
  };

  const { data: server } = useQuery({
    queryKey: ['server', id],
    queryFn: () => getServer(id!),
    enabled: !!id,
  });

  const { data: pm2Processes } = usePm2Processes(id || '', 15000);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!id || !server) return;
      const token = await requestConfirmation(`Delete server ${server.name}`, [id]);
      await deleteServer(id, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      toast.success(`Server "${server?.name}" deleted successfully`);
      navigate('/');
    },
    onError: (err: any) => {
      showIpcError(err, { action: 'Delete Server', serverName: server?.name });
    }
  });

  const handleCopyHost = () => {
    if (!server) return;
    navigator.clipboard.writeText(`${server.username}@${server.hostname}:${server.ssh_port}`);
    setCopiedHost(true);
    setTimeout(() => setCopiedHost(false), 2000);
    toast.success('SSH connection string copied');
  };

  const handleRestartAll = async () => {
    if (!id) return;
    try {
      await restartPm2Process(id, 'all');
      queryClient.invalidateQueries({ queryKey: ['pm2', id] });
      toast.success('Restart command dispatched for all PM2 processes');
    } catch (err: any) {
      toast.error(err.message || 'Failed to restart PM2 processes');
    }
  };

  const handleReloadAll = async () => {
    if (!id) return;
    try {
      await reloadPm2Process(id, 'all');
      queryClient.invalidateQueries({ queryKey: ['pm2', id] });
      toast.success('Zero-downtime reload triggered for all PM2 processes');
    } catch (err: any) {
      toast.error(err.message || 'Failed to reload PM2 processes');
    }
  };

  if (!id) return null;

  const isOnline = server?.status === 'online';
  const onlinePm2 = pm2Processes?.filter(p => p.status === 'online').length || 0;
  const totalPm2 = pm2Processes?.length || 0;

  const NAV_TABS = [
    { 
      id: 'overview', 
      label: 'Overview', 
      icon: Activity, 
      accentColor: 'text-emerald-400', 
      accentBg: 'bg-emerald-400' 
    },
    { 
      id: 'pm2', 
      label: 'PM2 Apps', 
      icon: Layers, 
      badge: totalPm2 > 0 ? totalPm2 : undefined, 
      accentColor: 'text-amber-400', 
      accentBg: 'bg-amber-400' 
    },
    { 
      id: 'logs', 
      label: 'Real-time Logs', 
      icon: Terminal, 
      accentColor: 'text-sky-400', 
      accentBg: 'bg-sky-400' 
    },
    { 
      id: 'rebuild', 
      label: 'Rebuild & Deploy', 
      icon: Rocket, 
      accentColor: 'text-primary', 
      accentBg: 'bg-primary' 
    },
    { 
      id: 'terminal', 
      label: 'Terminal', 
      icon: TerminalSquare, 
      accentColor: 'text-purple-400', 
      accentBg: 'bg-purple-400' 
    },
    { 
      id: 'nginx', 
      label: 'Nginx Proxy', 
      icon: Globe, 
      accentColor: 'text-cyan-400', 
      accentBg: 'bg-cyan-400' 
    },
    { 
      id: 'backups', 
      label: 'Backups', 
      icon: HardDrive, 
      accentColor: 'text-indigo-400', 
      accentBg: 'bg-indigo-400' 
    },
    { 
      id: 'alerts', 
      label: 'Alerts', 
      icon: Bell, 
      accentColor: 'text-rose-400', 
      accentBg: 'bg-rose-400' 
    },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden p-6 gap-6">
      {/* Top Cockpit Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{server?.name || 'Server Management'}</h1>
              {server && (
                <Badge variant="outline" className="capitalize text-xs font-medium bg-zinc-900 border-white/10 text-zinc-300">
                  {server.environment}
                </Badge>
              )}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                isOnline ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-zinc-800 text-zinc-400 border-zinc-700'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-500'}`} />
                {isOnline ? 'Online • SSH Channel Active' : 'Offline / Standby'}
              </span>
            </div>

            {server && (
              <div 
                className="text-xs text-muted-foreground font-mono flex items-center gap-2 mt-1 hover:text-foreground transition-colors cursor-pointer w-fit"
                onClick={handleCopyHost}
                title="Click to copy SSH string"
              >
                <span>{server.username}@{server.hostname}:{server.ssh_port}</span>
                {copiedHost ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 opacity-60 hover:opacity-100" />}
                {totalPm2 > 0 && (
                  <>
                    <span className="text-zinc-600">•</span>
                    <span className="text-emerald-400 font-sans font-medium">{onlinePm2}/{totalPm2} Workloads Active</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {server && (
            <>
              <Button 
                variant="default" 
                size="sm" 
                className="bg-primary/90 hover:bg-primary text-primary-foreground shadow-sm h-8 text-xs font-medium"
                onClick={() => setIsQuickConnectOpen(true)}
              >
                <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                Quick Connect
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 text-xs border-white/10" 
                onClick={() => setActiveTab('rebuild')}
              >
                <Rocket className="h-3.5 w-3.5 mr-1.5 text-primary" />
                Rebuild Deck
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 text-xs border-white/10" 
                onClick={() => setIsEditOpen(true)}
              >
                <Edit className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 text-xs border-white/10 text-destructive hover:text-destructive hover:bg-destructive/10" 
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                <Trash className="h-3.5 w-3.5 mr-1.5" />
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col flex-1 min-h-0">
        <TabsList className="w-fit flex flex-wrap items-center bg-zinc-950/90 border border-white/10 p-1.5 rounded-2xl gap-1.5 shadow-xl backdrop-blur-md">
          {NAV_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={cn(
                  "relative flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all duration-200 select-none cursor-pointer",
                  isActive
                    ? "bg-zinc-800 text-white font-semibold shadow-md border border-white/20 ring-1 ring-white/10"
                    : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5 border border-transparent"
                )}
              >
                {/* Active Indicator Pulse Dot */}
                {isActive && (
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0 shadow-[0_0_8px_currentColor] animate-pulse", tab.accentBg)} />
                )}
                
                <Icon className={cn("h-3.5 w-3.5 transition-colors", isActive ? tab.accentColor : "text-zinc-400")} />
                <span>{tab.label}</span>

                {tab.badge !== undefined && (
                  <span className={cn(
                    "ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-mono transition-colors",
                    isActive 
                      ? "bg-primary/20 text-primary border border-primary/30 font-bold" 
                      : "bg-zinc-800 text-zinc-400 border border-white/5"
                  )}>
                    {tab.badge}
                  </span>
                )}

                {/* Bottom Active Accent Glow Bar */}
                {isActive && (
                  <span className={cn("absolute bottom-0 inset-x-2.5 h-[2px] rounded-full shadow-[0_0_8px_currentColor]", tab.accentBg)} />
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
        
        {/* Tab 1: Overview */}
        <TabsContent value="overview" className="flex-1 mt-6 overflow-y-auto pr-2 space-y-6">
          {server && (
            <ServerConnectionBanner
              server={server}
              onRefreshHealth={() => queryClient.invalidateQueries({ queryKey: ['health', id] })}
            />
          )}

          {/* Quick Cockpit Action Strip (PM2 Bulk + Fast Rebuild) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Quick PM2 Reload */}
            <div className="p-4 rounded-2xl bg-zinc-950/70 border border-white/10 flex flex-col justify-between gap-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">PM2 Workloads</span>
                <span className="text-xs font-mono text-emerald-400">{onlinePm2}/{totalPm2} Active</span>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="flex-1 h-8 text-xs border-white/10 hover:border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-300"
                  onClick={handleReloadAll}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  Reload All
                </Button>
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="h-8 text-xs border-white/10 hover:border-amber-500/30 hover:bg-amber-500/10 text-amber-300"
                  onClick={handleRestartAll}
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Quick Frontend Rebuild */}
            <div className="p-4 rounded-2xl bg-zinc-950/70 border border-white/10 flex flex-col justify-between gap-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Frontend App</span>
                <span className="text-[10px] text-zinc-500 font-mono">bun build</span>
              </div>
              <Button 
                size="sm" 
                variant="outline" 
                className="w-full h-8 text-xs border-white/10 hover:border-primary/40 hover:bg-primary/10 text-foreground"
                onClick={() => setActiveTab('rebuild')}
              >
                <Rocket className="h-3.5 w-3.5 mr-1.5 text-primary" />
                Rebuild Frontend
              </Button>
            </div>

            {/* Quick Backend Rebuild */}
            <div className="p-4 rounded-2xl bg-zinc-950/70 border border-white/10 flex flex-col justify-between gap-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Backend App</span>
                <span className="text-[10px] text-zinc-500 font-mono">pm2 restart</span>
              </div>
              <Button 
                size="sm" 
                variant="outline" 
                className="w-full h-8 text-xs border-white/10 hover:border-primary/40 hover:bg-primary/10 text-foreground"
                onClick={() => setActiveTab('rebuild')}
              >
                <Rocket className="h-3.5 w-3.5 mr-1.5 text-primary" />
                Rebuild Backend
              </Button>
            </div>

            {/* Real-time Logs Shortcut */}
            <div className="p-4 rounded-2xl bg-zinc-950/70 border border-white/10 flex flex-col justify-between gap-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Log Stream</span>
                <span className="text-[10px] text-blue-400 font-mono">Live</span>
              </div>
              <Button 
                size="sm" 
                variant="outline" 
                className="w-full h-8 text-xs border-white/10 hover:border-blue-500/40 hover:bg-blue-500/10 text-blue-300"
                onClick={() => setActiveTab('logs')}
              >
                <Terminal className="h-3.5 w-3.5 mr-1.5 text-blue-400" />
                Open Live Logs
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <h2 className="text-base font-semibold tracking-tight text-foreground">System Telemetry & Resource Monitor</h2>
          </div>
          
          <HealthWidget serverId={id} variant="full" pollInterval={activeTab === 'overview' ? 10000 : 0} />
          
          <QuickActionsGrid serverId={id} />
        </TabsContent>

        {/* Tab 2: PM2 Apps */}
        <TabsContent value="pm2" className="flex-1 mt-6 overflow-y-auto pr-2">
          <Pm2Table serverId={id} />
        </TabsContent>

        {/* Tab 3: Real-time Live Logs ("prelocks" / streaming) */}
        <TabsContent value="logs" className="flex-1 mt-6 overflow-hidden">
          <LogViewer 
            serverId={id} 
            pm2Name="all" 
            isEmbedded={true}
          />
        </TabsContent>

        {/* Tab 4: Rebuild & Deploy Center (Frontend & Backend Directories) */}
        <TabsContent value="rebuild" className="flex-1 mt-6 overflow-y-auto pr-2">
          <ServerRebuildDeck serverId={id} />
        </TabsContent>

        {/* Tab 5: Terminal */}
        <TabsContent value="terminal" keepMounted className="flex-1 min-h-0 h-full mt-6 data-[state=inactive]:hidden">
          <TerminalTabManager serverId={id} />
        </TabsContent>

        {/* Tab 6: Nginx Proxy */}
        <TabsContent value="nginx" className="flex-1 mt-6 overflow-y-auto pr-2">
          <NginxManager serverId={id} />
        </TabsContent>

        {/* Tab 7: Backups */}
        <TabsContent value="backups" className="flex-1 mt-6 overflow-y-auto pr-2">
          <BackupsManager serverId={id} />
        </TabsContent>

        {/* Tab 8: Alerts */}
        <TabsContent value="alerts" className="flex-1 mt-6 overflow-y-auto pr-2">
          <AlertsManager serverId={id} />
        </TabsContent>
      </Tabs>

      {/* Delete Server Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="bg-zinc-950 border-white/10 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-xs">
              This action cannot be undone. This will permanently delete <strong>{server?.name}</strong> and remove all associated credentials from your Windows vault.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-900 border-white/10">Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Server
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {server && (
        <>
          <ServerModal
            open={isEditOpen}
            onOpenChange={setIsEditOpen}
            serverToEdit={server}
          />
          <QuickConnectModal
            open={isQuickConnectOpen}
            onOpenChange={setIsQuickConnectOpen}
            server={server}
            onConnected={() => {
              queryClient.invalidateQueries({ queryKey: ['health', id] });
              queryClient.invalidateQueries({ queryKey: ['server', id] });
              queryClient.invalidateQueries({ queryKey: ['pm2', id] });
            }}
          />
        </>
      )}
    </div>
  );
};
