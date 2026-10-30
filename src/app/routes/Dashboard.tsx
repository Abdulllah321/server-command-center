import { useState, useMemo } from 'react';
import { ServerList } from '@/features/servers/components/ServerList';
import { Button } from '@/components/ui/button';
import { 
  Plus, 
  Server as ServerIcon, 
  ShieldCheck, 
  Activity, 
  Search, 
  X,
  Layers,
  Sparkles
} from 'lucide-react';
import { ServerModal } from '@/features/servers/components/ServerModal';
import { useUIStore } from '@/stores/use-ui-store';
import { useServers } from '@/features/servers/api/use-servers';

export const Dashboard = () => {
  const { isServerModalOpen, setServerModalOpen } = useUIStore();
  const [environmentFilter, setEnvironmentFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: servers } = useServers();

  const totalServers = servers?.length || 0;
  const onlineServers = useMemo(() => {
    return servers?.filter(s => s.status === 'online').length || 0;
  }, [servers]);

  const envCounts = useMemo(() => {
    if (!servers) return { all: 0, production: 0, staging: 0, dev: 0 };
    return {
      all: servers.length,
      production: servers.filter(s => s.environment === 'production').length,
      staging: servers.filter(s => s.environment === 'staging').length,
      dev: servers.filter(s => s.environment === 'dev').length,
    };
  }, [servers]);

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto bg-background">
      <div className="w-full max-w-7xl mx-auto p-6 md:p-8 space-y-8">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-white/5">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
                Infrastructure Cockpit
              </h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
                <Sparkles className="h-3 w-3 mr-1" /> Live
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Unified command center for SSH instances, real-time health telemetry, and PM2 orchestration.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Button 
              onClick={() => setServerModalOpen(true)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-lg shadow-primary/20 flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Server
            </Button>
          </div>
        </div>

        {/* Fleet Overview Metrics Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Card 1: Total Nodes */}
          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-white/10 flex items-center justify-between shadow-sm">
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Fleet Nodes</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground font-mono">{totalServers}</span>
                <span className="text-xs text-muted-foreground">registered</span>
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <ServerIcon className="h-5 w-5" />
            </div>
          </div>

          {/* Card 2: Online Status */}
          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-white/10 flex items-center justify-between shadow-sm">
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Node Status</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground font-mono">
                  {totalServers > 0 ? `${onlineServers}/${totalServers}` : '0/0'}
                </span>
                <span className="text-xs text-emerald-400 font-medium">Online</span>
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Activity className="h-5 w-5" />
            </div>
          </div>

          {/* Card 3: Security & Vault */}
          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-white/10 flex items-center justify-between shadow-sm">
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">SSH Vault</span>
              <div className="flex items-center gap-1.5 pt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-sm font-semibold tracking-tight text-foreground">Creds Secured</span>
              </div>
              <p className="text-[11px] text-muted-foreground">Windows Credential Manager</p>
            </div>
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </div>

          {/* Card 4: Environments */}
          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-white/10 flex items-center justify-between shadow-sm">
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Environments</span>
              <div className="flex items-center gap-2 pt-0.5 text-xs">
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/10 text-zinc-300">
                  {envCounts.production} Prod
                </span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/10 text-zinc-300">
                  {envCounts.staging} Stg
                </span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/10 text-zinc-300">
                  {envCounts.dev} Dev
                </span>
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Layers className="h-5 w-5" />
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Environment Filter Pills */}
          <div className="flex items-center p-1 rounded-xl bg-zinc-950/80 border border-white/10 w-fit">
            {[
              { id: 'all', label: 'All Hosts', count: envCounts.all },
              { id: 'production', label: 'Production', count: envCounts.production },
              { id: 'staging', label: 'Staging', count: envCounts.staging },
              { id: 'dev', label: 'Dev', count: envCounts.dev },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setEnvironmentFilter(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  environmentFilter === tab.id
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  environmentFilter === tab.id 
                    ? 'bg-primary-foreground/20 text-primary-foreground font-semibold' 
                    : 'bg-zinc-800 text-zinc-400'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name, IP, or tag..."
              className="w-full pl-9 pr-8 py-1.5 text-xs rounded-xl bg-zinc-950/80 border border-white/10 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Main Server Cards Grid */}
        <ServerList 
          environmentFilter={environmentFilter}
          searchQuery={searchQuery}
          onClearSearch={() => {
            setSearchQuery('');
            setEnvironmentFilter('all');
          }}
        />
      </div>

      <ServerModal open={isServerModalOpen} onOpenChange={setServerModalOpen} />
    </div>
  );
};
