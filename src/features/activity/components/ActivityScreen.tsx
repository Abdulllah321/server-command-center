import { useState, useEffect, useCallback } from 'react';
import { 
  getActivityLog, getActivityActionTypes, 
  type ActivityLogEntry, type ActivityFilters,
  listServers, type Server
} from '@/lib/tauri-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from '@/components/ui/select';
import { showIpcError } from '@/lib/error-handler';
import { ChevronDown, ChevronRight, RefreshCw, CheckCircle, XCircle, Clock, FilterX, Loader2, Activity } from 'lucide-react';

const ACTION_LABEL_MAP: Record<string, string> = {
  create_server: 'Create Server', update_server: 'Update Server', delete_server: 'Delete Server',
  create_credential: 'Add Credential', delete_credential: 'Delete Credential',
  open_terminal: 'Open Terminal', open_external_ssh: 'Open SSH',
  pm2_start: 'PM2 Start', pm2_stop: 'PM2 Stop', pm2_restart: 'PM2 Restart',
  pm2_reload: 'PM2 Reload', pm2_delete: 'PM2 Delete', pm2_save: 'PM2 Save',
  open_log_stream: 'Open Log Stream',
  create_rebuild_profile: 'Create Profile', update_rebuild_profile: 'Update Profile', delete_rebuild_profile: 'Delete Profile',
  rebuild: 'Rebuild',
  run_command: 'Run Command',
  create_port_tunnel: 'Create Tunnel', start_port_tunnel: 'Start Tunnel', stop_port_tunnel: 'Stop Tunnel',
  create_backup: 'Create Backup', restore_backup: 'Restore Backup', delete_backup: 'Delete Backup',
  unlock_vault: 'Unlock Vault', lock_vault: 'Lock Vault', reset_vault: 'Reset Vault',
  create_scheduled_rebuild: 'Schedule Rebuild', cancel_scheduled_rebuild: 'Cancel Rebuild',
  file_upload: 'File Upload', file_download: 'File Download', file_delete: 'File Delete', file_edit: 'File Edit',
  service_start: 'Service Start', service_stop: 'Service Stop', service_restart: 'Service Restart',
};

function formatDuration(ms: number | null) {
  if (ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

function ActivityRow({ entry }: { entry: ActivityLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!entry.detail;

  return (
    <div className={`transition-colors ${entry.status === 'failed' ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/40'}`}>
      <div 
        className={`flex items-center gap-3 px-4 py-3.5 ${hasDetail ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        {/* Status Icon */}
        <div className="shrink-0">
          {entry.status === 'success'
            ? <CheckCircle className="w-4 h-4 text-emerald-500" />
            : <XCircle className="w-4 h-4 text-destructive" />
          }
        </div>
        
        {/* Action Badge */}
        <Badge variant={entry.status === 'failed' ? 'destructive' : 'secondary'} className="shrink-0 text-xs font-mono font-medium">
          {ACTION_LABEL_MAP[entry.action] ?? entry.action}
        </Badge>

        {/* Target */}
        <span className="text-sm font-medium text-foreground truncate flex-1">
          {entry.target ?? '—'}
        </span>

        {/* Server */}
        {entry.server_name && (
          <span className="text-xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded border border-border/50 shrink-0 hidden sm:inline-flex items-center">
            {entry.server_name}
          </span>
        )}

        {/* Duration */}
        {entry.duration_ms !== null && (
          <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1 font-mono">
            <Clock className="w-3 h-3 text-muted-foreground/70" />
            {formatDuration(entry.duration_ms)}
          </span>
        )}

        {/* Timestamp */}
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums" title={entry.created_at}>
          {formatRelativeTime(entry.created_at)}
        </span>

        {/* Expand arrow for entries with detail */}
        {hasDetail && (
          <div className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && hasDetail && (
        <div className="mx-4 mb-3.5 px-3.5 py-2.5 bg-muted/60 dark:bg-muted/30 border border-border/60 rounded-md text-xs font-mono text-foreground/90 whitespace-pre-wrap break-all shadow-sm">
          {entry.detail}
        </div>
      )}
    </div>
  );
}

export const ActivityScreen = () => {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [actionTypes, setActionTypes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const PAGE_SIZE = 50;

  // Filters
  const [filterServer, setFilterServer] = useState('all');
  const [filterAction, setFilterAction] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const hasActiveFilters = filterServer !== 'all' || filterAction !== 'all' || filterStatus !== 'all' || !!filterDateFrom || !!filterDateTo;

  const clearFilters = () => {
    setFilterServer('all');
    setFilterAction('all');
    setFilterStatus('all');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const loadMeta = async () => {
    try {
      const [svrs, acts] = await Promise.all([listServers(), getActivityActionTypes()]);
      setServers(svrs);
      setActionTypes(acts);
    } catch (e: any) {
      showIpcError(e, { action: 'Load Filter Metadata' });
    }
  };

  const fetchEntries = useCallback(async (targetOffset: number, append = false) => {
    setIsLoading(true);
    
    const filters: ActivityFilters = {
      limit: PAGE_SIZE,
      offset: targetOffset,
    };
    if (filterServer !== 'all') filters.server_id = filterServer;
    if (filterAction !== 'all') filters.action = filterAction;
    if (filterStatus !== 'all') filters.status = filterStatus;
    if (filterDateFrom) filters.date_from = filterDateFrom;
    if (filterDateTo) filters.date_to = filterDateTo;

    try {
      const data = await getActivityLog(filters);
      if (append) {
        setEntries(prev => [...prev, ...data]);
      } else {
        setEntries(data);
      }
      setHasMore(data.length >= PAGE_SIZE);
    } catch (e: any) {
      showIpcError(e, { action: 'Load Activity Log' });
    } finally {
      setIsLoading(false);
    }
  }, [filterServer, filterAction, filterStatus, filterDateFrom, filterDateTo]);

  useEffect(() => { 
    loadMeta(); 
  }, []);

  useEffect(() => { 
    setOffset(0);
    fetchEntries(0, false); 
  }, [fetchEntries]);

  const handleLoadMore = () => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    fetchEntries(nextOffset, true);
  };

  return (
    <div className="flex flex-col h-full w-full bg-background p-4 sm:p-6 lg:p-8 gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/40">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Activity History
            </h1>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
              Audit Trail
            </span>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Complete cryptographic and operational audit log across all managed servers
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground">
              <FilterX className="w-3.5 h-3.5 mr-1.5" />
              Reset Filters
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => fetchEntries(0, false)} disabled={isLoading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-2.5 bg-card/60 border border-border/60 p-3 rounded-lg shadow-sm">
        <Select value={filterServer} onValueChange={(val) => setFilterServer(val || 'all')}>
          <SelectTrigger className="w-full sm:w-44 bg-background">
            <SelectValue placeholder="All Servers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Servers</SelectItem>
            {servers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterAction} onValueChange={(val) => setFilterAction(val || 'all')}>
          <SelectTrigger className="w-full sm:w-48 bg-background">
            <SelectValue placeholder="All Actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            {actionTypes.map(a => <SelectItem key={a} value={a}>{ACTION_LABEL_MAP[a] ?? a}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={(val) => setFilterStatus(val || 'all')}>
          <SelectTrigger className="w-full sm:w-36 bg-background">
            <SelectValue placeholder="Any Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any Status</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Input 
            type="date" 
            className="w-full sm:w-38 bg-background" 
            value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)}
            placeholder="From date"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input 
            type="date" 
            className="w-full sm:w-38 bg-background" 
            value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)}
            placeholder="To date"
          />
        </div>
      </div>

      {/* Timeline container */}
      <div className="flex-1 min-h-[300px] border border-border rounded-lg overflow-y-auto bg-card shadow-sm flex flex-col">
        {isLoading && entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 py-20 text-muted-foreground gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary opacity-80" />
            <p className="text-sm font-medium">Loading audit history...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 py-20 text-muted-foreground">
            <Activity className="w-10 h-10 mb-3 opacity-30 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground/80">No activity logged yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm text-center">
              {hasActiveFilters 
                ? "No entries matched your filter criteria. Try adjusting or clearing your filters."
                : "Operations like server actions, credential management, rebuilds, and terminal sessions will appear here automatically."
              }
            </p>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="mt-4">
                Clear Filters
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="divide-y divide-border/40">
              {entries.map(entry => <ActivityRow key={entry.id} entry={entry} />)}
            </div>
            {hasMore && (
              <div className="flex justify-center py-4 border-t border-border/40 bg-muted/20">
                <Button variant="ghost" size="sm" onClick={handleLoadMore} disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Load more records'
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
