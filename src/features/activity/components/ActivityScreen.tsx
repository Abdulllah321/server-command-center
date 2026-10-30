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
import { ChevronDown, ChevronRight, RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react';

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
  const hasDetail = entry.status === 'failed' && !!entry.detail;

  return (
    <div className={`border-b last:border-b-0 transition-colors ${entry.status === 'failed' ? 'bg-destructive/5' : ''}`}>
      <div 
        className={`flex items-center gap-3 px-4 py-3 ${hasDetail ? 'cursor-pointer hover:bg-muted/30' : ''}`}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        {/* Status Icon */}
        <div className="shrink-0">
          {entry.status === 'success'
            ? <CheckCircle className="w-4 h-4 text-green-500" />
            : <XCircle className="w-4 h-4 text-destructive" />
          }
        </div>
        
        {/* Action Badge */}
        <Badge variant="outline" className="shrink-0 text-xs font-mono">
          {ACTION_LABEL_MAP[entry.action] ?? entry.action}
        </Badge>

        {/* Target */}
        <span className="text-sm font-medium truncate flex-1">
          {entry.target ?? '—'}
        </span>

        {/* Server */}
        {entry.server_name && (
          <span className="text-xs text-muted-foreground shrink-0 hidden md:block">
            {entry.server_name}
          </span>
        )}

        {/* Duration */}
        {entry.duration_ms !== null && (
          <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDuration(entry.duration_ms)}
          </span>
        )}

        {/* Timestamp */}
        <span className="text-xs text-muted-foreground shrink-0" title={entry.created_at}>
          {formatRelativeTime(entry.created_at)}
        </span>

        {/* Expand arrow for failed entries */}
        {hasDetail && (
          <div className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
        )}
      </div>

      {/* Expanded failure detail */}
      {expanded && hasDetail && (
        <div className="mx-4 mb-3 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded text-xs font-mono text-destructive whitespace-pre-wrap">
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
  const PAGE_SIZE = 50;

  // Filters
  const [filterServer, setFilterServer] = useState('all');
  const [filterAction, setFilterAction] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const loadMeta = async () => {
    const [svrs, acts] = await Promise.all([listServers(), getActivityActionTypes()]);
    setServers(svrs);
    setActionTypes(acts);
  };

  const load = useCallback(async (reset = false) => {
    setIsLoading(true);
    const currentOffset = reset ? 0 : offset;
    if (reset) setOffset(0);
    
    const filters: ActivityFilters = {
      limit: PAGE_SIZE,
      offset: currentOffset,
    };
    if (filterServer !== 'all') filters.server_id = filterServer;
    if (filterAction !== 'all') filters.action = filterAction;
    if (filterStatus !== 'all') filters.status = filterStatus;
    if (filterDateFrom) filters.date_from = filterDateFrom;
    if (filterDateTo) filters.date_to = filterDateTo;

    try {
      const data = await getActivityLog(filters);
      if (reset) {
        setEntries(data);
      } else {
        setEntries(prev => [...prev, ...data]);
      }
    } catch (e: any) {
      showIpcError(e, { action: 'Load Activity Log' });
    } finally {
      setIsLoading(false);
    }
  }, [offset, filterServer, filterAction, filterStatus, filterDateFrom, filterDateTo]);

  useEffect(() => { loadMeta(); }, []);
  useEffect(() => { load(true); }, [filterServer, filterAction, filterStatus, filterDateFrom, filterDateTo]);

  const handleLoadMore = () => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    load(false);
  };

  return (
    <div className="flex flex-col h-full w-full bg-background p-6 gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Activity History</h1>
          <p className="text-muted-foreground text-sm mt-1">Audit trail across all servers and operations</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={filterServer} onValueChange={(val) => setFilterServer(val || 'all')}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Servers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Servers</SelectItem>
            {servers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterAction} onValueChange={(val) => setFilterAction(val || 'all')}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            {actionTypes.map(a => <SelectItem key={a} value={a}>{ACTION_LABEL_MAP[a] ?? a}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={(val) => setFilterStatus(val || 'all')}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Any Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any Status</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        <Input 
          type="date" 
          className="w-40" 
          value={filterDateFrom}
          onChange={e => setFilterDateFrom(e.target.value)}
          placeholder="From date"
        />
        <Input 
          type="date" 
          className="w-40" 
          value={filterDateTo}
          onChange={e => setFilterDateTo(e.target.value)}
          placeholder="To date"
        />
      </div>

      {/* Timeline */}
      <div className="flex-1 border rounded-lg overflow-y-auto bg-card">
        {entries.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center h-full py-20 text-muted-foreground">
            <CheckCircle className="w-10 h-10 mb-4 opacity-30" />
            <p className="text-sm">No activity found matching your filters.</p>
          </div>
        ) : (
          <>
            {entries.map(entry => <ActivityRow key={entry.id} entry={entry} />)}
            {entries.length >= PAGE_SIZE && (
              <div className="flex justify-center py-4 border-t">
                <Button variant="ghost" size="sm" onClick={handleLoadMore} disabled={isLoading}>
                  {isLoading ? 'Loading...' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
