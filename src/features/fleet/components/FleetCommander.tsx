import React, { useState, useEffect, useMemo } from 'react';
import { 
  Radio, 
  Terminal, 
  Play, 
  RotateCw, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Server as ServerIcon, 
  Layers, 
  Copy, 
  Download, 
  Search, 
  Zap, 
  HardDrive, 
  Cpu, 
  ShieldCheck, 
  Loader2, 
  CheckSquare,
  Square
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  listServers, 
  executeFleetCommand, 
  requestConfirmation,
  type Server, 
  type FleetExecutionSummary 
} from '@/lib/tauri-client';
import { toast } from 'sonner';

interface RunbookSnippet {
  id: string;
  name: string;
  command: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  destructive?: boolean;
}

const FLEET_RUNBOOKS: RunbookSnippet[] = [
  {
    id: 'uptime',
    name: 'Fleet Uptime & Kernel',
    command: 'uptime; uname -r',
    icon: Clock,
    description: 'Check load averages, system uptime, and Linux kernel release.',
  },
  {
    id: 'disk',
    name: 'Root Disk Usage Audit',
    command: 'df -h /',
    icon: HardDrive,
    description: 'Inspect free space and percentage used on the root filesystem.',
  },
  {
    id: 'memory',
    name: 'RAM & Swap Audit',
    command: 'free -h',
    icon: Cpu,
    description: 'Check available physical memory and swap allocation.',
  },
  {
    id: 'apt-check',
    name: 'Pending Security Upgrades',
    command: 'apt-get -s upgrade 2>/dev/null | grep -E "upgraded|newly installed" || echo "System up to date"',
    icon: ShieldCheck,
    description: 'Dry-run package upgrade check without changing server state.',
  },
  {
    id: 'ports',
    name: 'Listening Ports',
    command: 'ss -tulpn | head -n 30',
    icon: Zap,
    description: 'Audit open TCP and UDP listening sockets across the fleet.',
  },
  {
    id: 'pm2-status',
    name: 'PM2 Cluster Status',
    command: 'pm2 list',
    icon: Layers,
    description: 'List status and CPU/RAM of running PM2 cluster processes.',
  },
  {
    id: 'pm2-reload',
    name: 'PM2 Zero-Downtime Reload',
    command: 'pm2 reload all',
    icon: RotateCw,
    description: 'Gracefully reload all cluster workloads with zero downtime.',
    destructive: true,
  },
  {
    id: 'drop-caches',
    name: 'Free PageCache & Memory',
    command: 'sync; echo 3 > /proc/sys/vm/drop_caches; free -h',
    icon: RotateCw,
    description: 'Flush pagecache and inode buffer caches to free memory.',
    destructive: true,
  },
];

export const FleetCommander: React.FC = () => {
  const [servers, setServers] = useState<Server[]>([]);
  const [isLoadingServers, setIsLoadingServers] = useState(false);
  const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(new Set());

  // Filters & Input
  const [environmentFilter, setEnvironmentFilter] = useState<'all' | 'production' | 'staging' | 'dev'>('all');
  const [serverSearch, setServerSearch] = useState('');
  const [commandInput, setCommandInput] = useState('uptime');
  const [timeoutSec, setTimeoutSec] = useState<number>(30);

  // Execution State
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionSummary, setExecutionSummary] = useState<FleetExecutionSummary | null>(null);
  const [resultFilter, setResultFilter] = useState<'all' | 'success' | 'failed'>('all');

  // Load server inventory
  const fetchServers = async () => {
    try {
      setIsLoadingServers(true);
      const data = await listServers();
      setServers(data);
      // Select all servers by default if nothing selected yet
      if (selectedServerIds.size === 0 && data.length > 0) {
        setSelectedServerIds(new Set(data.map(s => s.id)));
      }
    } catch (err: any) {
      toast.error(`Failed to load server inventory: ${err?.message || err}`);
    } finally {
      setIsLoadingServers(false);
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  // Filtered servers based on environment and search query
  const filteredServers = useMemo(() => {
    return servers.filter(s => {
      const matchesEnv = environmentFilter === 'all' || s.environment === environmentFilter;
      const matchesSearch = !serverSearch || 
        s.name.toLowerCase().includes(serverSearch.toLowerCase()) ||
        s.hostname.toLowerCase().includes(serverSearch.toLowerCase());
      return matchesEnv && matchesSearch;
    });
  }, [servers, environmentFilter, serverSearch]);

  // Selection helpers
  const toggleSelectServer = (id: string) => {
    setSelectedServerIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    const next = new Set(selectedServerIds);
    filteredServers.forEach(s => next.add(s.id));
    setSelectedServerIds(next);
  };

  const deselectAllFiltered = () => {
    const next = new Set(selectedServerIds);
    filteredServers.forEach(s => next.delete(s.id));
    setSelectedServerIds(next);
  };

  const selectOnlyEnvironment = (env: 'production' | 'staging' | 'dev') => {
    const match = servers.filter(s => s.environment === env).map(s => s.id);
    setSelectedServerIds(new Set(match));
    setEnvironmentFilter(env);
  };

  // Execute Fleet Command
  const handleLaunchExecution = async () => {
    const targets = Array.from(selectedServerIds);
    if (targets.length === 0) {
      toast.warning('Please select at least one server to target');
      return;
    }
    const cmd = commandInput.trim();
    if (!cmd) {
      toast.warning('Command cannot be empty');
      return;
    }

    try {
      setIsExecuting(true);
      toast.info(`Dispatching command across ${targets.length} servers in parallel...`);

      // If running a destructive action across production servers, gate through confirmation
      let confirmationToken: string | undefined = undefined;
      const targetsContainProd = servers.some(s => targets.includes(s.id) && s.environment === 'production');
      const isPotentiallyDestructive = cmd.includes('rm ') || cmd.includes('reboot') || cmd.includes('drop_caches') || cmd.includes('kill');

      if (targetsContainProd && isPotentiallyDestructive) {
        confirmationToken = await requestConfirmation(
          `Execute potentially destructive command on ${targets.length} servers:\n"${cmd}"`,
          targets
        );
      }

      const summary = await executeFleetCommand(targets, cmd, timeoutSec, confirmationToken);
      setExecutionSummary(summary);

      if (summary.failed === 0) {
        toast.success(`Fleet execution completed: ${summary.successful}/${summary.total_servers} successful (${summary.total_duration_ms}ms)`);
      } else {
        toast.warning(`Fleet execution completed with issues: ${summary.successful} succeeded, ${summary.failed} failed`);
      }
    } catch (err: any) {
      toast.error(`Fleet execution failed: ${err?.message || err}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // Copy single output to clipboard
  const handleCopyOutput = (text: string, serverName: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied output for ${serverName}`);
  };

  // Export Results
  const handleExportResults = () => {
    if (!executionSummary) return;
    const lines: string[] = [
      `# Fleet Command Execution Report`,
      `**Command**: \`${executionSummary.command}\``,
      `**Timestamp**: ${new Date().toISOString()}`,
      `**Total Targets**: ${executionSummary.total_servers}`,
      `**Successful**: ${executionSummary.successful}`,
      `**Failed**: ${executionSummary.failed}`,
      `**Total Wall Time**: ${executionSummary.total_duration_ms}ms\n`,
      `---`,
    ];

    executionSummary.results.forEach(r => {
      lines.push(`\n## [${r.status.toUpperCase()}] ${r.server_name} (${r.hostname})`);
      lines.push(`- **Environment**: ${r.environment}`);
      lines.push(`- **Duration**: ${r.duration_ms}ms`);
      lines.push(`- **Exit Code**: ${r.exit_code !== null ? r.exit_code : 'N/A'}`);
      lines.push(`\n\`\`\`\n${r.stdout || r.stderr || '(no output)'}\n\`\`\``);
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fleet_run_${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Exported execution summary as Markdown report');
  };

  // Filtered results
  const displayedResults = useMemo(() => {
    if (!executionSummary) return [];
    return executionSummary.results.filter(r => {
      if (resultFilter === 'success') return r.status === 'success';
      if (resultFilter === 'failed') return r.status !== 'success';
      return true;
    });
  }, [executionSummary, resultFilter]);

  return (
    <div className="flex flex-col flex-1 h-full w-full bg-background overflow-hidden p-3 sm:p-5 lg:p-6 gap-4 sm:gap-6">
      {/* Top Cockpit Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-2 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 shrink-0 shadow-xs">
            <Radio className="h-6 w-6 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                Fleet Commander
              </h1>
              <Badge variant="outline" className="text-[11px] font-mono border-cyan-500/30 text-cyan-400 bg-cyan-500/10">
                Parallel Execution Engine
              </Badge>
              <Badge variant="outline" className="text-[11px] font-mono border-border bg-muted">
                {selectedServerIds.size} / {servers.length} Targeted
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              Execute diagnostics, runbooks, and cluster commands across multiple remote servers in parallel.
            </p>
          </div>
        </div>

        {/* Global Action Row */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchServers}
            disabled={isLoadingServers}
            className="h-8 text-xs border-border bg-card text-foreground hover:bg-accent gap-1.5 cursor-pointer"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoadingServers ? 'animate-spin' : ''}`} />
            Refresh Fleet
          </Button>
          {executionSummary && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportResults}
              className="h-8 text-xs border-border bg-card text-foreground hover:bg-accent gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-primary" />
              Export Report
            </Button>
          )}
        </div>
      </div>

      {/* Main Grid: Left Panel (Targets + Console) & Right Panel (Live Results) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 min-h-0 overflow-hidden">
        {/* Left Column: Target Selector & Command Deck (5 cols on lg) */}
        <div className="lg:col-span-5 flex flex-col gap-4 min-h-0 overflow-y-auto pr-1">
          {/* Target Servers Selector Card */}
          <div className="bg-card/70 border border-border/80 rounded-2xl p-4 shadow-md flex flex-col gap-3 shrink-0 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <ServerIcon className="w-4 h-4 text-primary" /> Target Selection
              </span>
              <div className="flex items-center gap-1 text-[11px]">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="px-2 py-0.5 rounded-md hover:bg-muted text-primary font-medium cursor-pointer"
                >
                  All
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => selectOnlyEnvironment('production')}
                  className="px-2 py-0.5 rounded-md hover:bg-muted text-rose-400 font-medium cursor-pointer"
                >
                  Prod
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => selectOnlyEnvironment('staging')}
                  className="px-2 py-0.5 rounded-md hover:bg-muted text-amber-400 font-medium cursor-pointer"
                >
                  Staging
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={deselectAllFiltered}
                  className="px-2 py-0.5 rounded-md hover:bg-muted text-muted-foreground cursor-pointer"
                >
                  None
                </button>
              </div>
            </div>

            {/* Filter controls */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  value={serverSearch}
                  onChange={(e) => setServerSearch(e.target.value)}
                  placeholder="Filter targets..."
                  className="h-8 text-xs pl-8 bg-background border-input"
                />
              </div>

              {/* Environment Filter Pills */}
              <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border/60 shrink-0">
                {(['all', 'production', 'staging'] as const).map(env => (
                  <button
                    key={env}
                    type="button"
                    onClick={() => setEnvironmentFilter(env)}
                    className={`h-7 px-2 rounded-md text-[10px] font-semibold capitalize cursor-pointer transition-all ${
                      environmentFilter === env ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {env === 'production' ? 'Prod' : env === 'staging' ? 'Stage' : 'All'}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Server Targets List */}
            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 font-mono text-xs">
              {filteredServers.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-xs font-sans">
                  No servers match current filter.
                </div>
              ) : (
                filteredServers.map((s) => {
                  const isSelected = selectedServerIds.has(s.id);
                  const isProd = s.environment === 'production';
                  return (
                    <div
                      key={s.id}
                      onClick={() => toggleSelectServer(s.id)}
                      className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer select-none ${
                        isSelected
                          ? 'bg-primary/15 border-primary/40 shadow-xs'
                          : 'bg-background/80 border-border/60 hover:bg-muted/50 text-muted-foreground'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-muted-foreground/60 shrink-0" />
                        )}
                        <span className={`font-semibold text-xs truncate ${isSelected ? 'text-foreground' : ''}`}>
                          {s.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
                          {s.hostname}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1 py-0 h-4 capitalize ${
                            isProd 
                              ? 'border-rose-500/30 text-rose-400 bg-rose-500/10' 
                              : 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                          }`}
                        >
                          {s.environment}
                        </Badge>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Quick Runbooks Palette */}
          <div className="bg-card/70 border border-border/80 rounded-2xl p-4 shadow-md flex flex-col gap-2.5 shrink-0 backdrop-blur-sm">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-400" /> Curated Fleet Runbooks
            </span>
            <div className="grid grid-cols-2 gap-2">
              {FLEET_RUNBOOKS.map((rb) => {
                const Icon = rb.icon;
                return (
                  <button
                    key={rb.id}
                    type="button"
                    onClick={() => setCommandInput(rb.command)}
                    className="flex items-start gap-2 p-2.5 rounded-xl border border-border/70 bg-background/70 hover:bg-muted/60 text-left transition-all cursor-pointer group"
                  >
                    <Icon className="w-4 h-4 text-primary shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate">{rb.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{rb.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Command Console & Launch Pad */}
          <div className="bg-card/70 border border-border/80 rounded-2xl p-4 shadow-md flex flex-col gap-3 shrink-0 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-cyan-400" /> Command Payload
              </span>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="text-[11px]">Timeout:</span>
                <select
                  value={timeoutSec}
                  onChange={(e) => setTimeoutSec(Number(e.target.value))}
                  className="h-6 px-1.5 rounded-md text-xs font-mono bg-background border border-input text-foreground"
                >
                  <option value={15}>15s</option>
                  <option value={30}>30s</option>
                  <option value={60}>60s</option>
                  <option value={120}>120s</option>
                </select>
              </div>
            </div>

            <textarea
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="e.g. uptime; df -h /; free -h"
              rows={3}
              spellCheck={false}
              className="w-full p-3 bg-black/80 border border-border rounded-xl font-mono text-xs text-cyan-400 focus:outline-hidden focus:ring-1 focus:ring-primary leading-relaxed resize-none"
            />

            <Button
              onClick={handleLaunchExecution}
              disabled={isExecuting || selectedServerIds.size === 0}
              className="h-10 bg-primary text-primary-foreground hover:opacity-90 font-bold text-xs gap-2 shadow-lg cursor-pointer transition-all"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Executing Parallel Batch...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  Launch Fleet Command ({selectedServerIds.size} Servers)
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Right Column: Execution Matrix & Output Grid (7 cols on lg) */}
        <div className="lg:col-span-7 flex flex-col min-h-0 bg-card/60 border border-border/80 rounded-2xl shadow-xl overflow-hidden backdrop-blur-sm">
          {/* Output Header & Metrics */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 border-b border-border/60 bg-muted/20 shrink-0 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-foreground">Fleet Execution Matrix</span>
              {executionSummary && (
                <>
                  <Badge variant="outline" className="text-[11px] font-mono border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                    {executionSummary.successful} Passed
                  </Badge>
                  {executionSummary.failed > 0 && (
                    <Badge variant="outline" className="text-[11px] font-mono border-rose-500/30 text-rose-400 bg-rose-500/10">
                      {executionSummary.failed} Failed
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[11px] font-mono border-border bg-muted">
                    {executionSummary.total_duration_ms} ms total
                  </Badge>
                </>
              )}
            </div>

            {/* Result Filter Tabs */}
            {executionSummary && (
              <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border/60 shrink-0">
                {(['all', 'success', 'failed'] as const).map(rf => (
                  <button
                    key={rf}
                    type="button"
                    onClick={() => setResultFilter(rf)}
                    className={`h-6 px-2 rounded-md text-[10px] font-semibold capitalize cursor-pointer transition-all ${
                      resultFilter === rf ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {rf}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Results Scroll Area */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {!executionSummary ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-16 gap-3">
                <Radio className="w-12 h-12 text-muted-foreground/30 animate-pulse" />
                <p className="text-sm font-semibold text-foreground">Fleet Commander Standing By</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Select target servers and dispatch a command or runbook. Results from each node will stream here in real time.
                </p>
              </div>
            ) : displayedResults.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-xs">
                No server outputs match the "{resultFilter}" filter.
              </div>
            ) : (
              displayedResults.map((result) => {
                const isSuccess = result.status === 'success';
                const output = result.stdout || result.stderr || '(no output received)';

                return (
                  <div
                    key={result.server_id}
                    className="border border-border/80 rounded-xl overflow-hidden bg-background shadow-xs flex flex-col font-mono text-xs"
                  >
                    {/* Node Header */}
                    <div className="flex items-center justify-between p-2.5 px-3 bg-muted/40 border-b border-border/60">
                      <div className="flex items-center gap-2 min-w-0">
                        {isSuccess ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                        )}
                        <span className="font-bold text-foreground text-xs truncate">
                          {result.server_name}
                        </span>
                        <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">
                          ({result.hostname})
                        </span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 capitalize">
                          {result.environment}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-muted-foreground">
                          {result.duration_ms}ms
                        </span>
                        {result.exit_code !== null && (
                          <Badge
                            variant="outline"
                            className={`text-[9px] px-1 py-0 h-4 font-mono ${
                              result.exit_code === 0 
                                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' 
                                : 'border-rose-500/30 text-rose-400 bg-rose-500/10'
                            }`}
                          >
                            exit {result.exit_code}
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopyOutput(output, result.server_name)}
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                          title="Copy output"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Console Output Screen */}
                    <pre className="p-3 bg-black/90 text-foreground/90 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-60 select-text">
                      {output}
                    </pre>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

