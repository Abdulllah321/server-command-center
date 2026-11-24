import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getTopProcesses,
  killServerProcess,
  requestConfirmation,
  type ProcessItem,
  type ProcessSortBy,
} from '@/lib/tauri-client';
import {
  Activity,
  Search,
  RefreshCw,
  SlidersHorizontal,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Terminal,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ProcessConsumersTableProps {
  serverId: string;
  className?: string;
}

export const ProcessConsumersTable: React.FC<ProcessConsumersTableProps> = ({
  serverId,
  className,
}) => {
  const [sortBy, setSortBy] = useState<ProcessSortBy>('cpu');
  const [limit, setLimit] = useState<number>(35);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(10000); // 10s default
  const [expandedPids, setExpandedPids] = useState<Set<number>>(new Set());
  const [copiedPid, setCopiedPid] = useState<number | null>(null);

  // Terminate Modal State
  const [processToKill, setProcessToKill] = useState<ProcessItem | null>(null);
  const [killSignal, setKillSignal] = useState<'SIGTERM' | 'SIGKILL'>('SIGTERM');
  const [isTerminating, setIsTerminating] = useState<boolean>(false);

  const {
    data: rawProcesses,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['top-processes', serverId, sortBy, limit],
    queryFn: () => getTopProcesses(serverId, sortBy, limit),
    refetchInterval: autoRefreshInterval > 0 ? autoRefreshInterval : false,
    staleTime: 4000,
  });

  const processes = rawProcesses || [];

  const filteredProcesses = useMemo(() => {
    if (!searchQuery.trim()) return processes;
    const lower = searchQuery.toLowerCase();
    return processes.filter(
      (p) =>
        p.pid.toString().includes(lower) ||
        p.user.toLowerCase().includes(lower) ||
        p.command.toLowerCase().includes(lower) ||
        p.args.toLowerCase().includes(lower)
    );
  }, [processes, searchQuery]);

  const toggleExpand = (pid: number) => {
    setExpandedPids((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) {
        next.delete(pid);
      } else {
        next.add(pid);
      }
      return next;
    });
  };

  const handleCopyArgs = (pid: number, args: string) => {
    navigator.clipboard.writeText(args);
    setCopiedPid(pid);
    setTimeout(() => setCopiedPid(null), 2000);
    toast.success('Command arguments copied to clipboard');
  };

  const formatMemory = (kb: number) => {
    if (kb < 1024) return `${kb} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  };

  const getCpuBadgeColor = (pct: number) => {
    if (pct > 75) return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
    if (pct > 35) return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
    return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
  };

  const getMemBadgeColor = (pct: number) => {
    if (pct > 75) return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
    if (pct > 35) return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
    return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
  };

  const handleConfirmKill = async () => {
    if (!processToKill) return;

    if (processToKill.pid <= 1) {
      toast.error('Refused: Cannot terminate system init process (PID 1)');
      return;
    }

    setIsTerminating(true);
    try {
      const token = await requestConfirmation(
        `Terminate process "${processToKill.command}" (PID ${processToKill.pid}) with ${killSignal}`,
        [serverId, String(processToKill.pid)]
      );

      const res = await killServerProcess(serverId, processToKill.pid, killSignal, token);
      toast.success(res || `Terminated PID ${processToKill.pid}`);
      setProcessToKill(null);
      refetch();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to terminate process');
    } finally {
      setIsTerminating(false);
    }
  };

  return (
    <div className={cn("p-5 rounded-2xl bg-card border border-border flex flex-col gap-4 shadow-xs", className)}>
      {/* Top Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              Top Process Consumers
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                {filteredProcesses.length} active
              </span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Live OS-level process resource inspection with instant termination
            </p>
          </div>
        </div>

        {/* Controls: Search, Sort, Limit, Auto-Refresh */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Filter */}
          <div className="relative w-44 sm:w-56">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Filter processes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-muted/40 border-border"
            />
          </div>

          {/* Sort By Toggle */}
          <div className="flex items-center bg-muted/60 p-0.5 rounded-xl border border-border">
            <button
              type="button"
              onClick={() => setSortBy('cpu')}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-lg transition-all",
                sortBy === 'cpu'
                  ? "bg-card text-foreground font-semibold shadow-xs border border-border"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              % CPU
            </button>
            <button
              type="button"
              onClick={() => setSortBy('mem')}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-lg transition-all",
                sortBy === 'mem'
                  ? "bg-card text-foreground font-semibold shadow-xs border border-border"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              % MEM
            </button>
          </div>

          {/* Auto Refresh Interval */}
          <select
            value={autoRefreshInterval}
            onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
            className="h-8 px-2 text-xs bg-muted/60 text-muted-foreground rounded-xl border border-border focus:outline-hidden"
          >
            <option value={0}>Pause Refresh</option>
            <option value={5000}>Poll 5s</option>
            <option value={10000}>Poll 10s</option>
            <option value={30000}>Poll 30s</option>
          </select>

          {/* Limit Selector */}
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="h-8 px-2 text-xs bg-muted/60 text-muted-foreground rounded-xl border border-border focus:outline-hidden"
          >
            <option value={20}>Top 20</option>
            <option value={35}>Top 35</option>
            <option value={50}>Top 50</option>
            <option value={100}>Top 100</option>
          </select>

          {/* Manual Refresh */}
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2.5 text-xs border-border hover:bg-muted text-muted-foreground hover:text-foreground"
            onClick={() => refetch()}
            disabled={isLoading || isRefetching}
            title="Refresh processes"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Process Table View */}
      <div className="border border-border rounded-xl overflow-hidden bg-muted/10">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                <th className="py-2.5 px-3 w-16">PID</th>
                <th className="py-2.5 px-3 min-w-[200px]">Process / Command</th>
                <th className="py-2.5 px-3 w-24">User</th>
                <th className="py-2.5 px-3 w-28">CPU Usage</th>
                <th className="py-2.5 px-3 w-28">Memory Usage</th>
                <th className="py-2.5 px-3 w-24">RSS</th>
                <th className="py-2.5 px-3 w-16">Stat</th>
                <th className="py-2.5 px-3 w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {isLoading && processes.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={8} className="py-3 px-3">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))
              ) : filteredProcesses.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    <Activity className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
                    <p className="font-medium text-foreground text-xs">No matching processes found</p>
                    <p className="text-[11px] mt-0.5">Try adjusting your search query or sort order.</p>
                  </td>
                </tr>
              ) : (
                filteredProcesses.map((proc) => {
                  const isExpanded = expandedPids.has(proc.pid);
                  return (
                    <React.Fragment key={proc.pid}>
                      <tr className="hover:bg-muted/40 transition-colors group">
                        {/* PID */}
                        <td className="py-2 px-3 font-mono text-muted-foreground text-[11px]">
                          {proc.pid}
                        </td>

                        {/* Process / Command */}
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggleExpand(proc.pid)}
                              className="text-muted-foreground hover:text-foreground shrink-0"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <Terminal className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                            <span className="font-mono font-medium text-foreground truncate max-w-[220px] sm:max-w-[320px]">
                              {proc.command}
                            </span>
                          </div>
                        </td>

                        {/* User */}
                        <td className="py-2 px-3">
                          <span className="px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-mono text-[10px] border border-border">
                            {proc.user}
                          </span>
                        </td>

                        {/* % CPU */}
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded-md font-mono text-[11px] font-semibold border",
                                getCpuBadgeColor(proc.cpu_pct)
                              )}
                            >
                              {proc.cpu_pct.toFixed(1)}%
                            </span>
                            <div className="w-12 bg-secondary/50 rounded-full h-1 overflow-hidden shrink-0">
                              <div
                                className={cn(
                                  "h-full",
                                  proc.cpu_pct > 75
                                    ? "bg-rose-500"
                                    : proc.cpu_pct > 35
                                    ? "bg-amber-500"
                                    : "bg-blue-500"
                                )}
                                style={{ width: `${Math.min(proc.cpu_pct, 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* % MEM */}
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded-md font-mono text-[11px] font-semibold border",
                                getMemBadgeColor(proc.mem_pct)
                              )}
                            >
                              {proc.mem_pct.toFixed(1)}%
                            </span>
                            <div className="w-12 bg-secondary/50 rounded-full h-1 overflow-hidden shrink-0">
                              <div
                                className={cn(
                                  "h-full",
                                  proc.mem_pct > 75
                                    ? "bg-rose-500"
                                    : proc.mem_pct > 35
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                                )}
                                style={{ width: `${Math.min(proc.mem_pct, 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* RSS */}
                        <td className="py-2 px-3 font-mono text-muted-foreground text-[11px]">
                          {formatMemory(proc.rss_kb)}
                        </td>

                        {/* Stat */}
                        <td className="py-2 px-3">
                          <span
                            className={cn(
                              "px-1 py-0.5 rounded-sm font-mono text-[10px] uppercase font-bold",
                              proc.stat.includes('R')
                                ? "bg-emerald-500/10 text-emerald-500"
                                : proc.stat.includes('Z')
                                ? "bg-rose-500/10 text-rose-500"
                                : "bg-muted text-muted-foreground"
                            )}
                            title={`Status flag: ${proc.stat}`}
                          >
                            {proc.stat.slice(0, 3)}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-2 px-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[11px] text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20"
                            onClick={() => {
                              setProcessToKill(proc);
                              setKillSignal('SIGTERM');
                            }}
                            disabled={proc.pid <= 1}
                            title={proc.pid <= 1 ? "Cannot terminate system init" : "Terminate process"}
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            Kill
                          </Button>
                        </td>
                      </tr>

                      {/* Expandable Command Arguments View */}
                      {isExpanded && (
                        <tr className="bg-muted/20 border-b border-border/80">
                          <td colSpan={8} className="p-3 pl-8">
                            <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-background/80 border border-border font-mono text-[11px]">
                              <div className="flex items-center justify-between text-muted-foreground text-[10px]">
                                <span>Full Command Line & Arguments</span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyArgs(proc.pid, proc.args)}
                                  className="flex items-center gap-1 hover:text-foreground text-primary"
                                >
                                  {copiedPid === proc.pid ? (
                                    <>
                                      <Check className="h-3 w-3 text-emerald-500" />
                                      <span>Copied</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" />
                                      <span>Copy Command</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              <div className="break-all text-foreground select-text font-mono leading-relaxed">
                                {proc.args}
                              </div>
                              <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                                <span>Parent PID (PPID): {proc.ppid}</span>
                                <span>Virtual Size (VSZ): {formatMemory(proc.vsz_kb)}</span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Process Termination Confirmation Modal */}
      {processToKill && (
        <Dialog open={true} onOpenChange={(open) => !open && setProcessToKill(null)}>
          <DialogContent className="max-w-md bg-card border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-rose-500 text-base">
                <ShieldAlert className="h-5 w-5" />
                Terminate Remote Process
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Dispatch an OS termination signal to halt execution of this remote process.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              {/* Process Summary Box */}
              <div className="p-3 rounded-xl bg-muted/40 border border-border flex flex-col gap-1 font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Binary Name:</span>
                  <span className="font-semibold text-foreground">{processToKill.command}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Process ID (PID):</span>
                  <span className="font-bold text-primary">{processToKill.pid}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">User:</span>
                  <span>{processToKill.user}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Current Usage:</span>
                  <span>
                    CPU: {processToKill.cpu_pct.toFixed(1)}% | RAM: {processToKill.mem_pct.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Signal Selection */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Select Signal:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setKillSignal('SIGTERM')}
                    className={cn(
                      "p-2.5 rounded-xl border text-left flex flex-col gap-0.5 transition-all",
                      killSignal === 'SIGTERM'
                        ? "bg-primary/10 border-primary text-foreground font-semibold"
                        : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    <span className="text-xs font-bold text-foreground">SIGTERM (15)</span>
                    <span className="text-[10px] text-muted-foreground">Graceful shutdown</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setKillSignal('SIGKILL')}
                    className={cn(
                      "p-2.5 rounded-xl border text-left flex flex-col gap-0.5 transition-all",
                      killSignal === 'SIGKILL'
                        ? "bg-rose-500/10 border-rose-500 text-rose-500 font-semibold"
                        : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    <span className="text-xs font-bold text-rose-500">SIGKILL (9)</span>
                    <span className="text-[10px] text-muted-foreground">Immediate force kill</span>
                  </button>
                </div>
              </div>

              {/* Security Warning */}
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[11px] flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Killing critical server services or parent daemons can disrupt active applications. This
                  action will be audited in the local activity log.
                </span>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setProcessToKill(null)}
                disabled={isTerminating}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmKill}
                disabled={isTerminating}
                className="gap-1.5"
              >
                {isTerminating ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Terminating...
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5" />
                    Terminate PID {processToKill.pid}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
