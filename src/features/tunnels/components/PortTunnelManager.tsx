import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  startPortTunnel, 
  stopPortTunnel, 
  listActiveTunnels, 
  getTunnelCliCommand, 
  type PortTunnelInfo 
} from '@/lib/tauri-client';
import { 
  Network, 
  Database, 
  Radio, 
  Plus, 
  Copy, 
  Check, 
  Terminal, 
  Square, 
  RefreshCw, 
  Loader2, 
  ShieldCheck,
  Cpu
} from 'lucide-react';
import { toast } from 'sonner';

interface PortTunnelManagerProps {
  serverId: string;
}

interface TunnelPreset {
  name: string;
  type: string;
  icon: string;
  defaultLocalPort: number;
  remotePort: number;
  dbClientHint: string;
  color: string;
}

const PRESETS: TunnelPreset[] = [
  {
    name: 'PostgreSQL',
    type: 'postgres',
    icon: '🐘',
    defaultLocalPort: 5435,
    remotePort: 5432,
    dbClientHint: 'DbGate / DBeaver / pgAdmin / TablePlus',
    color: 'border-blue-500/20 hover:border-blue-500/50 bg-blue-500/5 dark:bg-blue-950/20',
  },
  {
    name: 'MySQL / MariaDB',
    type: 'mysql',
    icon: '🐬',
    defaultLocalPort: 3307,
    remotePort: 3306,
    dbClientHint: 'DbGate / MySQL Workbench / HeidiSQL',
    color: 'border-amber-500/20 hover:border-amber-500/50 bg-amber-500/5 dark:bg-amber-950/20',
  },
  {
    name: 'Redis Cache',
    type: 'redis',
    icon: '⚡',
    defaultLocalPort: 6380,
    remotePort: 6379,
    dbClientHint: 'RedisInsight / Medis / Another Redis Desktop',
    color: 'border-rose-500/20 hover:border-rose-500/50 bg-rose-500/5 dark:bg-rose-950/20',
  },
  {
    name: 'MongoDB',
    type: 'mongo',
    icon: '🍃',
    defaultLocalPort: 27018,
    remotePort: 27017,
    dbClientHint: 'MongoDB Compass / Studio 3T / DbGate',
    color: 'border-emerald-500/20 hover:border-emerald-500/50 bg-emerald-500/5 dark:bg-emerald-950/20',
  },
];

export const PortTunnelManager: React.FC<PortTunnelManagerProps> = ({ serverId }) => {
  const [tunnels, setTunnels] = useState<PortTunnelInfo[]>([]);
  const [allTunnels, setAllTunnels] = useState<PortTunnelInfo[]>([]);
  const [viewScope, setViewScope] = useState<'this_server' | 'all_servers'>('this_server');
  const [loading, setLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Custom local listening ports per preset (allows manual modification)
  const [presetPorts, setPresetPorts] = useState<Record<string, number>>({
    postgres: 5435,
    mysql: 3307,
    redis: 6380,
    mongo: 27018,
  });

  // Custom modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customLocalPort, setCustomLocalPort] = useState('5435');
  const [customRemoteHost, setCustomRemoteHost] = useState('127.0.0.1');
  const [customRemotePort, setCustomRemotePort] = useState('5432');

  // Copy feedback tracking
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fetchTunnels = async () => {
    setLoading(true);
    try {
      const [activeThis, activeAll] = await Promise.all([
        listActiveTunnels(serverId),
        listActiveTunnels(),
      ]);
      setTunnels(activeThis);
      setAllTunnels(activeAll);
    } catch (err: any) {
      console.error('Failed to list tunnels:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTunnels();
    const interval = setInterval(fetchTunnels, 5000);
    return () => clearInterval(interval);
  }, [serverId]);

  // Check if a local port is already in use by an active tunnel across ANY server
  const getPortInUseInfo = (port: number) => {
    return allTunnels.find(t => t.local_port === port);
  };

  // Find next available free port starting from basePort
  const getNextFreePort = (basePort: number): number => {
    let p = basePort;
    const taken = new Set(allTunnels.map(t => t.local_port));
    while (taken.has(p)) {
      p++;
    }
    return p;
  };

  const handleSetPresetPort = (type: string, port: number) => {
    setPresetPorts(prev => ({ ...prev, [type]: port }));
  };

  const handleAutoAssignFreePort = (type: string, currentPort: number) => {
    const nextPort = getNextFreePort(currentPort);
    setPresetPorts(prev => ({ ...prev, [type]: nextPort }));
    toast.info(`Assigned free port ${nextPort} for ${type}`);
  };

  const handleStartTunnel = async (name: string, localPort: number, remoteHost: string, remotePort: number) => {
    const actionKey = `start-${remotePort}-${localPort}`;
    setActionInProgress(actionKey);
    try {
      const tunnel = await startPortTunnel(serverId, name, localPort, remoteHost, remotePort);
      toast.success(`Port forward started!`, {
        description: `Local port ${tunnel.local_port} is routing to ${tunnel.remote_host}:${tunnel.remote_port} in background`,
      });
      await fetchTunnels();
    } catch (err: any) {
      toast.error('Failed to start port tunnel', {
        description: err.message || String(err),
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleStopTunnel = async (tunnelId: string, tunnelName: string) => {
    setActionInProgress(tunnelId);
    try {
      await stopPortTunnel(tunnelId);
      toast.info(`Port forward stopped`, {
        description: `Tunnel '${tunnelName}' has been shut down.`,
      });
      await fetchTunnels();
    } catch (err: any) {
      toast.error('Failed to stop tunnel', {
        description: err.message || String(err),
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleCopyCliCommand = async (tunnel: PortTunnelInfo) => {
    try {
      const cmd = await getTunnelCliCommand(tunnel.server_id, tunnel.local_port, tunnel.remote_host, tunnel.remote_port);
      await navigator.clipboard.writeText(cmd);
      setCopiedKey(`cli-${tunnel.id}`);
      setTimeout(() => setCopiedKey(null), 2500);
      toast.success('SSH tunnel command copied to clipboard!');
    } catch (err: any) {
      toast.error('Failed to generate CLI command', { description: err.message || String(err) });
    }
  };

  const handleCopyPresetCliCommand = async (preset: TunnelPreset) => {
    const chosenPort = presetPorts[preset.type] ?? preset.defaultLocalPort;
    try {
      const cmd = await getTunnelCliCommand(serverId, chosenPort, '127.0.0.1', preset.remotePort);
      await navigator.clipboard.writeText(cmd);
      setCopiedKey(`preset-cli-${preset.type}`);
      setTimeout(() => setCopiedKey(null), 2500);
      toast.success(`SSH CLI command for ${preset.name} copied! (Local port: ${chosenPort})`);
    } catch (err: any) {
      toast.error('Failed to generate CLI command', { description: err.message || String(err) });
    }
  };

  const handleCopyLocalAddress = async (tunnel: PortTunnelInfo) => {
    const text = `127.0.0.1:${tunnel.local_port}`;
    await navigator.clipboard.writeText(text);
    setCopiedKey(`addr-${tunnel.id}`);
    setTimeout(() => setCopiedKey(null), 2500);
    toast.success(`Copied '${text}' for DbGate / local client!`);
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const lPort = parseInt(customLocalPort, 10);
    const rPort = parseInt(customRemotePort, 10);
    if (isNaN(lPort) || lPort <= 0 || lPort > 65535) {
      toast.error('Invalid local port (must be between 1 and 65535)');
      return;
    }
    if (isNaN(rPort) || rPort <= 0 || rPort > 65535) {
      toast.error('Invalid remote port (must be between 1 and 65535)');
      return;
    }

    setModalOpen(false);
    await handleStartTunnel(
      customName.trim() || `Port ${rPort}`,
      lPort,
      customRemoteHost.trim() || '127.0.0.1',
      rPort
    );
  };

  return (
    <div className="space-y-6">
      {/* Header Deck */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border border-border bg-card shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">
              <Network className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">SSH Port Tunnels & Local Forwarding</h2>
            <Badge variant="outline" className="text-xs bg-teal-500/10 text-teal-600 dark:text-teal-300 border-teal-500/30">
              Direct-TCPIP Engine
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Securely forward remote database ports (Postgres, MySQL, Redis, Mongo) to your local PC.
            Connect directly in local GUI clients like <span className="text-teal-600 dark:text-teal-300 font-semibold">DbGate</span>, <span className="text-teal-600 dark:text-teal-300 font-semibold">DBeaver</span>, or <span className="text-teal-600 dark:text-teal-300 font-semibold">TablePlus</span> using <code className="text-xs px-1.5 py-0.5 bg-muted rounded text-teal-700 dark:text-teal-300 font-mono border border-border">127.0.0.1:&lt;port&gt;</code> without exposing ports publicly.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          <Button 
            variant="outline" 
            size="sm" 
            className="border-border text-foreground hover:bg-accent"
            onClick={fetchTunnels}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button 
            size="sm" 
            className="bg-teal-600 hover:bg-teal-500 text-white font-medium shadow-sm"
            onClick={() => {
              setCustomName('');
              setCustomLocalPort('5435');
              setCustomRemoteHost('127.0.0.1');
              setCustomRemotePort('5432');
              setModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Custom Forward
          </Button>
        </div>
      </div>

      {/* Background Engine Status Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-emerald-500/5 dark:bg-emerald-950/20 border border-emerald-500/20 text-xs shadow-xs">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">Background Tunnel Engine Active</span>
          <span className="text-muted-foreground/50 hidden sm:inline">•</span>
          <span className="text-foreground">
            {allTunnels.length} active background tunnel{allTunnels.length !== 1 ? 's' : ''} across servers (maintains background forwarding)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {allTunnels.filter(t => t.server_id !== serverId).length > 0 && (
            <Badge variant="outline" className="text-[11px] border-indigo-500/30 text-indigo-600 dark:text-indigo-300 bg-indigo-500/10 font-mono">
              +{allTunnels.filter(t => t.server_id !== serverId).length} on other servers
            </Badge>
          )}
          <span className="text-[11px] text-muted-foreground font-mono">Direct-TCPIP PTY</span>
        </div>
      </div>

      {/* Database Quick Presets */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            Instant Database Presets
          </h3>
          <span className="text-xs text-muted-foreground">
            Edit local port manually or click to connect
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {PRESETS.map(preset => {
            const activeTunnel = tunnels.find(t => t.remote_port === preset.remotePort);
            const chosenPort = presetPorts[preset.type] ?? preset.defaultLocalPort;
            const inUseInfo = !activeTunnel ? getPortInUseInfo(chosenPort) : null;
            const isStarting = actionInProgress === `start-${preset.remotePort}-${chosenPort}`;
            const isStopping = activeTunnel && actionInProgress === activeTunnel.id;

            return (
              <Card 
                key={preset.type} 
                className={`transition-all duration-200 border ${preset.color} ${
                  activeTunnel ? 'ring-1 ring-teal-500/50 shadow-md shadow-teal-950/20' : ''
                }`}
              >
                <CardContent className="p-4 flex flex-col justify-between h-full space-y-3.5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl select-none" role="img" aria-label={preset.name}>
                        {preset.icon}
                      </span>
                      <div>
                        <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                          {preset.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Remote: <code className="text-foreground font-mono">127.0.0.1:{preset.remotePort}</code>
                        </div>
                      </div>
                    </div>

                    {activeTunnel ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Live
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                        Idle
                      </span>
                    )}
                  </div>

                  {/* Local Listen Port (Fully Editable by User) */}
                  <div className="p-2.5 rounded-xl bg-muted/50 border border-border space-y-2">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="text-muted-foreground shrink-0">Local Port:</span>
                      {activeTunnel ? (
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          127.0.0.1:{activeTunnel.local_port}
                        </span>
                      ) : (
                        <div className="flex items-center gap-1 font-mono">
                          <span className="text-muted-foreground text-[11px]">127.0.0.1 :</span>
                          <input
                            type="number"
                            min="1"
                            max="65535"
                            value={chosenPort}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              handleSetPresetPort(preset.type, isNaN(val) ? 0 : val);
                            }}
                            className={`w-18 h-6 px-1.5 py-0.5 rounded text-xs text-center font-bold font-mono transition-colors focus:outline-none focus:ring-1 ${
                              inUseInfo
                                ? 'bg-amber-500/10 border border-amber-500/50 text-amber-600 dark:text-amber-300 focus:ring-amber-400'
                                : 'bg-background border border-input text-teal-600 dark:text-teal-300 hover:border-teal-500/40 focus:ring-teal-400 focus:border-teal-400'
                            }`}
                            title="Click to type custom local port (e.g. 5435, 5436, 5437)"
                          />
                        </div>
                      )}
                    </div>

                    {/* Conflict warning & 1-click Auto Next Port if in use */}
                    {!activeTunnel && inUseInfo && (
                      <div className="flex items-center justify-between gap-1 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/40 font-mono">
                        <span className="truncate" title={`Port ${chosenPort} is already forwarding for ${inUseInfo.server_name || inUseInfo.name}`}>
                          ⚠️ In use ({inUseInfo.server_name || 'other server'})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAutoAssignFreePort(preset.type, chosenPort)}
                          className="text-teal-600 dark:text-teal-300 underline hover:text-foreground font-sans font-medium shrink-0 ml-1.5"
                          title="Switch to next available free port"
                        >
                          Auto Next Free
                        </button>
                      </div>
                    )}

                    <div className="text-[11px] text-muted-foreground truncate" title={preset.dbClientHint}>
                      {preset.dbClientHint}
                    </div>
                  </div>

                  <div className="pt-1 flex items-center gap-2">
                    {activeTunnel ? (
                      <>
                        <Button 
                          size="sm" 
                          variant="destructive" 
                          className="flex-1 text-xs h-8 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30"
                          onClick={() => handleStopTunnel(activeTunnel.id, activeTunnel.name)}
                          disabled={isStopping}
                        >
                          {isStopping ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <Square className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          Stop Tunnel
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2 border-border hover:bg-accent text-foreground"
                          title="Copy Local Address"
                          onClick={() => handleCopyLocalAddress(activeTunnel)}
                        >
                          {copiedKey === `addr-${activeTunnel.id}` ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button 
                          size="sm" 
                          className="flex-1 text-xs h-8 bg-teal-600 hover:bg-teal-500 text-white font-medium transition-colors"
                          onClick={() => handleStartTunnel(
                            preset.name,
                            chosenPort,
                            '127.0.0.1',
                            preset.remotePort
                          )}
                          disabled={isStarting}
                        >
                          {isStarting ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <Radio className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          Start Tunnel ({chosenPort})
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2 border-border hover:bg-accent text-muted-foreground hover:text-foreground"
                          title="Copy Terminal CLI Command"
                          onClick={() => handleCopyPresetCliCommand(preset)}
                        >
                          {copiedKey === `preset-cli-${preset.type}` ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Terminal className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Active Tunnels Table / Deck */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
              Active Local Port Forwards ({viewScope === 'all_servers' ? allTunnels.length : tunnels.length})
            </h3>
            {(viewScope === 'all_servers' ? allTunnels.length : tunnels.length) > 0 && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-mono">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                Live in background
              </span>
            )}
          </div>

          {/* View Scope Toggle: This Server vs All Servers */}
          <div className="flex items-center p-0.5 rounded-lg bg-muted border border-border text-xs self-start sm:self-center">
            <button
              onClick={() => setViewScope('this_server')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                viewScope === 'this_server' 
                  ? 'bg-background text-foreground font-semibold shadow-xs' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              This Server ({tunnels.length})
            </button>
            <button
              onClick={() => setViewScope('all_servers')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
                viewScope === 'all_servers' 
                  ? 'bg-teal-600 text-white font-semibold shadow-xs' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>All Servers ({allTunnels.length})</span>
              {allTunnels.filter(t => t.server_id !== serverId).length > 0 && (
                <span className="text-[10px] bg-teal-900 text-teal-200 px-1.5 py-0.2 rounded-full font-mono">
                  +{allTunnels.filter(t => t.server_id !== serverId).length} bg
                </span>
              )}
            </button>
          </div>
        </div>

        {(viewScope === 'all_servers' ? allTunnels : tunnels).length === 0 ? (
          <Card className="border-dashed border-border bg-card/40">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <div className="p-3 rounded-full bg-muted border border-border mb-3 text-muted-foreground">
                <Radio className="h-7 w-7" />
              </div>
              <h4 className="font-semibold text-base text-foreground">No active port forwards</h4>
              <p className="text-xs text-muted-foreground max-w-md mt-1 mb-4">
                Click any database preset above or create a custom forward to expose your remote databases and services to localhost.
              </p>
              <div className="flex items-center gap-2">
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="border-border text-foreground hover:bg-accent"
                  onClick={() => {
                    const port = presetPorts['postgres'] ?? 5435;
                    handleStartTunnel('PostgreSQL', port, '127.0.0.1', 5432);
                  }}
                >
                  Forward Postgres ({presetPorts['postgres'] ?? 5435})
                </Button>
                <Button 
                  size="sm" 
                  className="bg-teal-600 hover:bg-teal-500 text-white"
                  onClick={() => setModalOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-1" /> Custom Forward
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {(viewScope === 'all_servers' ? allTunnels : tunnels).map(tunnel => {
              const isStopping = actionInProgress === tunnel.id;
              const isOtherServer = tunnel.server_id !== serverId;

              return (
                <Card 
                  key={tunnel.id} 
                  className={`overflow-hidden border transition-all shadow-sm ${
                    isOtherServer 
                      ? 'border-indigo-500/30 bg-card hover:border-indigo-500/50' 
                      : 'border-emerald-500/30 bg-card hover:border-emerald-500/50'
                  }`}
                >
                  <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Tunnel Meta */}
                    <div className="flex items-start md:items-center gap-3.5">
                      <div className={`p-2.5 rounded-lg border shrink-0 ${
                        isOtherServer 
                          ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' 
                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                      }`}>
                        <Database className="h-5 w-5" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-base text-foreground">{tunnel.name}</span>
                          {tunnel.server_name && (
                            <Badge variant="outline" className={`text-[10px] font-medium ${
                              isOtherServer 
                                ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30' 
                                : 'bg-muted text-muted-foreground border-border'
                            }`}>
                              Server: {tunnel.server_name}
                            </Badge>
                          )}
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            {isOtherServer ? 'Active on other server' : 'Active'}
                          </span>
                        </div>

                        {/* Visual Route */}
                        <div className="flex items-center gap-2 text-xs font-mono flex-wrap">
                          <span className="px-2 py-0.5 rounded bg-teal-500/10 text-teal-700 dark:text-teal-300 font-semibold border border-teal-500/20">
                            127.0.0.1:{tunnel.local_port}
                          </span>
                          <span className="text-muted-foreground select-none">➔</span>
                          <span className="px-2 py-0.5 rounded bg-muted text-foreground border border-border">
                            {tunnel.remote_host}:{tunnel.remote_port}
                          </span>
                          <span className="text-muted-foreground/50 hidden sm:inline">•</span>
                          <span className="text-muted-foreground text-[11px] hidden sm:inline font-sans">
                            Started {new Date(tunnel.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center flex-wrap gap-2 self-end md:self-center">
                      {/* Copy Address */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs border-teal-500/30 bg-teal-500/5 dark:bg-teal-950/20 text-teal-700 dark:text-teal-300 hover:bg-teal-500/15"
                        onClick={() => handleCopyLocalAddress(tunnel)}
                      >
                        {copiedKey === `addr-${tunnel.id}` ? (
                          <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Copy DbGate Host
                      </Button>

                      {/* Copy CLI */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs border-border bg-background text-foreground hover:bg-accent"
                        onClick={() => handleCopyCliCommand(tunnel)}
                        title="Copy terminal command (ssh -N -f -L ...)"
                      >
                        {copiedKey === `cli-${tunnel.id}` ? (
                          <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-500" />
                        ) : (
                          <Terminal className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Copy CLI Command
                      </Button>

                      {/* Stop */}
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-8 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-600 dark:text-red-300 border border-red-500/30"
                        onClick={() => handleStopTunnel(tunnel.id, tunnel.name)}
                        disabled={isStopping}
                      >
                        {isStopping ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <Square className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Stop
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Helper Callout */}
      <div className="p-4 rounded-xl border border-border bg-card text-xs text-muted-foreground space-y-2">
        <div className="font-semibold text-foreground flex items-center gap-1.5">
          <Cpu className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          How to connect in DbGate, DBeaver, or pgAdmin:
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          <div className="p-2.5 rounded-lg bg-muted/50 border border-border space-y-1">
            <span className="font-semibold text-foreground">1. Host & Port</span>
            <p className="text-muted-foreground">
              Host: <code className="text-teal-600 dark:text-teal-300 font-mono">127.0.0.1</code> or <code className="text-teal-600 dark:text-teal-300 font-mono">localhost</code><br />
              Port: <code className="text-teal-600 dark:text-teal-300 font-mono">5435</code> (or whatever local port is configured)
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/50 border border-border space-y-1">
            <span className="font-semibold text-foreground">2. Credentials</span>
            <p className="text-muted-foreground">
              Enter your live database username, password, and database name as usual.
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/50 border border-border space-y-1">
            <span className="font-semibold text-foreground">3. SSH Tunnel in Client?</span>
            <p className="text-muted-foreground">
              Leave SSH tunnel <strong className="text-foreground">disabled</strong> in DbGate/DBeaver. This app already tunnels the connection seamlessly!
            </p>
          </div>
        </div>
      </div>

      {/* Custom Tunnel Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Network className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              Create Custom Port Forward
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              Forward any TCP port from your remote server to a local listening port on this machine.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCustomSubmit} className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium text-foreground">Tunnel Name / Label</label>
              <Input
                placeholder="e.g. Staging Postgres, ElasticSearch, RabbitMQ"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                className="mt-1 bg-background border-input text-foreground text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground">Local Port (Your PC)</label>
                <Input
                  type="number"
                  placeholder="5435"
                  value={customLocalPort}
                  onChange={e => setCustomLocalPort(e.target.value)}
                  required
                  min={1}
                  max={65535}
                  className="mt-1 font-mono text-xs bg-background border-input text-teal-600 dark:text-teal-300"
                />
                <span className="text-[10px] text-muted-foreground mt-0.5 block">e.g. 5435, 3307, 8080</span>
              </div>

              <div>
                <label className="text-xs font-medium text-foreground">Remote Port (Server)</label>
                <Input
                  type="number"
                  placeholder="5432"
                  value={customRemotePort}
                  onChange={e => setCustomRemotePort(e.target.value)}
                  required
                  min={1}
                  max={65535}
                  className="mt-1 font-mono text-xs bg-background border-input text-foreground"
                />
                <span className="text-[10px] text-muted-foreground mt-0.5 block">e.g. 5432, 3306, 6379</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-foreground">Remote Target Host</label>
              <Input
                placeholder="127.0.0.1"
                value={customRemoteHost}
                onChange={e => setCustomRemoteHost(e.target.value)}
                required
                className="mt-1 font-mono text-xs bg-background border-input text-foreground"
              />
              <span className="text-[10px] text-muted-foreground mt-0.5 block">
                Usually <code className="text-foreground">127.0.0.1</code> to connect to a localhost DB on the server.
              </span>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                Cancel
              </Button>
              <Button type="submit" className="bg-teal-600 hover:bg-teal-500 text-white font-medium">
                <Radio className="h-4 w-4 mr-1.5" />
                Start Port Forward
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
