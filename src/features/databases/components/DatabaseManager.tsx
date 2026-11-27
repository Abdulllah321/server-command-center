import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Database, 
  Play, 
  Terminal, 
  Activity, 
  TableProperties, 
  RotateCw, 
  ShieldCheck, 
  ShieldAlert, 
  Download, 
  Copy, 
  Search, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Layers, 
  X, 
  History, 
  SlidersHorizontal,
  Eye,
  EyeOff,
  Zap,
  Trash2,
  AlertTriangle,
  Pencil,
  Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  executeDatabaseQuery, 
  getDatabaseConnections, 
  terminateDatabaseConnection, 
  getDatabaseSchemaTables,
  listServerDatabases,
  requestConfirmation,
} from '@/lib/tauri-client';
import type {
  DatabaseEngine,
  DatabaseQueryResult,
  DatabaseConnectionStats,
  DatabaseSchemaSummary,
  DatabaseTableInfo
} from '@/types';
import { toast } from 'sonner';

interface DatabaseManagerProps {
  serverId: string;
  isOnline: boolean;
}

interface SavedQueryHistory {
  id: string;
  engine: DatabaseEngine;
  database: string;
  query: string;
  timestamp: number;
  durationMs: number;
  rowCount: number;
}

interface QuerySnippet {
  name: string;
  engine: DatabaseEngine;
  description: string;
  query: string;
}

const ENGINE_SNIPPETS: Record<DatabaseEngine, QuerySnippet[]> = {
  postgres: [
    {
      name: 'Active Connections & Queries',
      engine: 'postgres',
      description: 'List current active queries with execution durations',
      query: `SELECT pid, usename, client_addr, state, \n       ROUND(EXTRACT(EPOCH FROM (now() - query_start))::numeric, 2) AS duration_sec, \n       query \nFROM pg_stat_activity \nWHERE pid <> pg_backend_pid() AND state = 'active' \nORDER BY duration_sec DESC \nLIMIT 50;`
    },
    {
      name: 'Top 10 Largest Tables',
      engine: 'postgres',
      description: 'Tables sorted by disk size including indexes',
      query: `SELECT t.table_schema, t.table_name, \n       pg_size_pretty(pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))) AS total_size, \n       COALESCE(c.reltuples, 0)::bigint AS estimated_rows \nFROM information_schema.tables t \nLEFT JOIN pg_class c ON c.relname = t.table_name \nWHERE t.table_schema NOT IN ('information_schema', 'pg_catalog') \nORDER BY pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name)) DESC \nLIMIT 10;`
    },
    {
      name: 'Database Disk Sizes',
      engine: 'postgres',
      description: 'Total disk space consumed by each PostgreSQL database',
      query: `SELECT datname, pg_size_pretty(pg_database_size(datname)) AS db_size \nFROM pg_database \nWHERE datistemplate = false \nORDER BY pg_database_size(datname) DESC;`
    },
    {
      name: 'Index Cache Hit Ratio',
      engine: 'postgres',
      description: 'Percentage of database reads served from RAM cache (ideal > 99%)',
      query: `SELECT ROUND(sum(blks_hit) * 100.0 / NULLIF(sum(blks_hit + blks_read), 0), 2) AS cache_hit_ratio_percent \nFROM pg_stat_database;`
    },
    {
      name: 'Dead Tuples & Vacuum Needed',
      engine: 'postgres',
      description: 'Detect bloat and tables with high dead tuple counts',
      query: `SELECT schemaname, relname, n_live_tup, n_dead_tup, \n       ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_tuple_percent, \n       last_autovacuum \nFROM pg_stat_user_tables \nORDER BY n_dead_tup DESC \nLIMIT 20;`
    }
  ],
  mysql: [
    {
      name: 'Show Processlist',
      engine: 'mysql',
      description: 'Show active client connections and running queries',
      query: `SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO \nFROM information_schema.processlist \nORDER BY TIME DESC \nLIMIT 50;`
    },
    {
      name: 'Table Sizes & Row Counts',
      engine: 'mysql',
      description: 'List tables ordered by combined data and index disk size',
      query: `SELECT TABLE_NAME, TABLE_ROWS, \n       CONCAT(ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2), ' MB') AS total_size \nFROM information_schema.tables \nWHERE TABLE_SCHEMA = DATABASE() \nORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC \nLIMIT 20;`
    },
    {
      name: 'InnoDB Buffer Pool Hit Rate',
      engine: 'mysql',
      description: 'Read efficiency from memory buffer pool',
      query: `SHOW STATUS LIKE 'Innodb_buffer_pool_read%';`
    },
    {
      name: 'Slow Queries & Connections Status',
      engine: 'mysql',
      description: 'Inspect global uptime, thread cache, and slow queries count',
      query: `SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected', 'Threads_running', 'Slow_queries', 'Uptime');`
    }
  ],
  redis: [
    {
      name: 'Server Info Summary',
      engine: 'redis',
      description: 'Complete Redis system, memory, and version information',
      query: `INFO all`
    },
    {
      name: 'Memory Statistics',
      engine: 'redis',
      description: 'Current RAM usage, peak memory, and fragmentation ratio',
      query: `INFO memory`
    },
    {
      name: 'Database Keys Count',
      engine: 'redis',
      description: 'Total number of stored keys in current keyspace',
      query: `DBSIZE`
    },
    {
      name: 'Connected Clients',
      engine: 'redis',
      description: 'Audit connected client IPs, ports, and idle times',
      query: `CLIENT LIST`
    },
    {
      name: 'Scan First 50 Keys',
      engine: 'redis',
      description: 'Safe cursor scan without blocking production server',
      query: `SCAN 0 COUNT 50`
    }
  ]
};

export const DatabaseManager: React.FC<DatabaseManagerProps> = ({ serverId, isOnline }) => {
  const [activeTab, setActiveTab] = useState<'query' | 'connections' | 'schema'>('query');
  const [engine, setEngine] = useState<DatabaseEngine>('postgres');
  const [selectedDb, setSelectedDb] = useState<string>('postgres');
  const [availableDbs, setAvailableDbs] = useState<string[]>(['postgres']);
  const [isLoadingDbs, setIsLoadingDbs] = useState<boolean>(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [editingCustomDb, setEditingCustomDb] = useState<boolean>(false);
  const [customDbDraft, setCustomDbDraft] = useState<string>('');

  // Credentials drawer
  const [showCreds, setShowCreds] = useState<boolean>(false);
  const [dbHost, setDbHost] = useState<string>('');
  const [dbPort, setDbPort] = useState<string>('');
  const [dbUser, setDbUser] = useState<string>('');
  const [dbPass, setDbPass] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // Safe mode
  const [safeMode, setSafeMode] = useState<boolean>(true);

  // Query state
  const [queryInput, setQueryInput] = useState<string>('SELECT * FROM information_schema.tables LIMIT 20;');
  const [isExecutingQuery, setIsExecutingQuery] = useState<boolean>(false);
  const [queryResult, setQueryResult] = useState<DatabaseQueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 25;

  // History
  const [queryHistory, setQueryHistory] = useState<SavedQueryHistory[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);

  // Connections state
  const [connectionStats, setConnectionStats] = useState<DatabaseConnectionStats | null>(null);
  const [isLoadingConnections, setIsLoadingConnections] = useState<boolean>(false);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(0); // 0 = off, 5 = 5s
  const [connectionFilter, setConnectionFilter] = useState<string>('');
  const [killingConnId, setKillingConnId] = useState<string | null>(null);

  // Schema state
  const [schemaSummary, setSchemaSummary] = useState<DatabaseSchemaSummary | null>(null);
  const [isLoadingSchema, setIsLoadingSchema] = useState<boolean>(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [schemaFilter, setSchemaFilter] = useState<string>('');

  // Load history from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`scc_db_history_${serverId}`);
      if (stored) {
        setQueryHistory(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, [serverId]);

  const saveHistoryEntry = (entry: SavedQueryHistory) => {
    setQueryHistory((prev) => {
      const updated = [entry, ...prev.filter(h => h.query !== entry.query)].slice(0, 30);
      try {
        localStorage.setItem(`scc_db_history_${serverId}`, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const getDefaultDbForEngine = (eng: DatabaseEngine): string =>
    eng === 'mysql' ? 'mysql' : eng === 'redis' ? 'db0' : 'postgres';

  const handleEngineSwitch = (nextEngine: DatabaseEngine) => {
    const defDb = getDefaultDbForEngine(nextEngine);
    setEngine(nextEngine);
    setSelectedDb(defDb);
    setAvailableDbs([defDb]);
    setEditingCustomDb(false);
    setDbError(null);
    setSchemaSummary(null);
    setSchemaError(null);
    setConnectionStats(null);
    setConnectionsError(null);
    setQueryResult(null);
    setQueryError(null);
  };

  // Fetch databases list
  const fetchDatabases = useCallback(async (forceAttempt = false) => {
    if (!isOnline && !forceAttempt) return;
    setIsLoadingDbs(true);
    setDbError(null);
    const fallback = getDefaultDbForEngine(engine);
    try {
      const portNum = dbPort ? parseInt(dbPort, 10) : undefined;
      const rawDbs = await listServerDatabases(serverId, {
        target_type: engine,
        db_host: dbHost.trim() || undefined,
        db_port: portNum && !Number.isNaN(portNum) ? portNum : undefined,
        db_user: dbUser.trim() || undefined,
        db_password: dbPass || undefined,
      });

      const dbs = engine === 'redis'
        ? (rawDbs || []).filter((d) => d !== 'dump.rdb')
        : (rawDbs || []);

      if (dbs.length > 0) {
        const merged = [...dbs];
        if (selectedDb && !merged.includes(selectedDb) && selectedDb !== fallback) {
          merged.push(selectedDb);
        }
        setAvailableDbs(merged);
        if (!dbs.includes(selectedDb)) {
          setSelectedDb(dbs[0]);
        }
      } else {
        setAvailableDbs((prev) => (prev.length > 0 && prev.includes(selectedDb) ? prev : [fallback]));
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      setDbError(msg);
      setAvailableDbs((prev) => (prev.includes(selectedDb) ? prev : [selectedDb || fallback]));
    } finally {
      setIsLoadingDbs(false);
    }
  }, [serverId, isOnline, engine, dbHost, dbPort, dbUser, dbPass, selectedDb]);

  useEffect(() => {
    fetchDatabases();
  }, [serverId, isOnline, engine]);

  // Adjust default query when engine changes
  useEffect(() => {
    if (engine === 'postgres') {
      setQueryInput('SELECT * FROM information_schema.tables LIMIT 20;');
    } else if (engine === 'mysql') {
      setQueryInput('SHOW TABLES;');
    } else if (engine === 'redis') {
      setQueryInput('INFO all');
    }
    setQueryResult(null);
    setQueryError(null);
  }, [engine]);

  // Execute query handler
  const handleRunQuery = async (queryToRun?: string) => {
    const q = (queryToRun || queryInput).trim();
    if (!q) {
      toast.error('Query cannot be empty');
      return;
    }

    setIsExecutingQuery(true);
    setQueryError(null);

    try {
      const portNum = dbPort ? parseInt(dbPort, 10) : undefined;
      const creds = (dbHost.trim() || dbPort.trim() || dbUser.trim() || dbPass) ? {
        host: dbHost.trim() || undefined,
        port: portNum && !Number.isNaN(portNum) ? portNum : undefined,
        user: dbUser.trim() || undefined,
        password: dbPass || undefined,
      } : undefined;

      let confirmationToken: string | undefined = undefined;

      // Destructive check (normalized whitespace synced with backend)
      const upper = q.replace(/\s+/g, ' ').trim().toUpperCase();
      const isDestructive = ['DROP ', 'TRUNCATE ', 'DELETE ', 'UPDATE ', 'ALTER ', 'GRANT ', 'REVOKE ', 'FLUSHDB', 'FLUSHALL', 'SHUTDOWN'].some(
        tok => upper.startsWith(tok) || upper.includes(` ${tok}`)
      );

      if (isDestructive) {
        if (safeMode) {
          toast.error('Read-Only Safe Mode is active! Mutation or destructive queries are blocked.');
          setIsExecutingQuery(false);
          return;
        }
        confirmationToken = await requestConfirmation(
          `Execute destructive query on ${engine} database "${selectedDb}"`,
          [serverId, selectedDb, q.slice(0, 60)]
        );
      }

      const res = await executeDatabaseQuery({
        serverId,
        engine,
        database: selectedDb,
        query: q,
        credentials: creds,
        safeMode,
        confirmationToken,
      });

      setQueryResult(res);
      setCurrentPage(1);

      saveHistoryEntry({
        id: Math.random().toString(36).substring(7),
        engine,
        database: selectedDb,
        query: q,
        timestamp: Date.now(),
        durationMs: res.execution_time_ms,
        rowCount: res.row_count,
      });

      if (res.affected_rows !== null && res.affected_rows !== undefined) {
        toast.success(`Query executed: ${res.affected_rows} rows affected (${res.execution_time_ms}ms)`);
      } else {
        toast.success(`Query finished: ${res.row_count} rows in ${res.execution_time_ms}ms`);
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setQueryError(errMsg);
      toast.error(errMsg);
    } finally {
      setIsExecutingQuery(false);
    }
  };

  // Keyboard shortcut Ctrl+Enter to run query
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRunQuery();
    }
  };

  const buildCreds = useCallback(() => {
    const portNum = dbPort ? parseInt(dbPort, 10) : undefined;
    if (!dbHost.trim() && !dbPort.trim() && !dbUser.trim() && !dbPass) {
      return undefined;
    }
    return {
      host: dbHost.trim() || undefined,
      port: portNum && !Number.isNaN(portNum) ? portNum : undefined,
      user: dbUser.trim() || undefined,
      password: dbPass || undefined,
    };
  }, [dbHost, dbPort, dbUser, dbPass]);

  // Connections loader
  const fetchConnections = useCallback(async (forceAttempt = false) => {
    if (!isOnline && !forceAttempt) return;
    setIsLoadingConnections(true);
    setConnectionsError(null);
    try {
      const stats = await getDatabaseConnections(serverId, engine, selectedDb, buildCreds());
      setConnectionStats(stats);
    } catch (err: any) {
      const msg = err?.message || String(err);
      setConnectionsError(msg);
      toast.error(msg || 'Failed to fetch database connections');
    } finally {
      setIsLoadingConnections(false);
    }
  }, [serverId, isOnline, engine, selectedDb, buildCreds]);

  useEffect(() => {
    if (activeTab === 'connections') {
      fetchConnections();
    }
  }, [activeTab, fetchConnections]);

  // Auto-refresh connections
  useEffect(() => {
    if (activeTab !== 'connections' || autoRefreshInterval <= 0) return;
    const timer = setInterval(() => {
      fetchConnections();
    }, autoRefreshInterval * 1000);
    return () => clearInterval(timer);
  }, [activeTab, autoRefreshInterval, fetchConnections]);

  // Kill connection
  const handleKillConnection = async (connId: string) => {
    if (!connId) return;
    setKillingConnId(connId);
    try {
      const token = await requestConfirmation(
        `Terminate ${engine} database connection #${connId}`,
        [serverId, connId]
      );

      await terminateDatabaseConnection(serverId, engine, connId, buildCreds(), token);
      toast.success(`Connection #${connId} terminated successfully`);
      fetchConnections(true);
    } catch (err: any) {
      toast.error(err?.message || `Failed to kill connection #${connId}`);
    } finally {
      setKillingConnId(null);
    }
  };

  // Schema tables loader
  const fetchSchemaTables = useCallback(async (forceAttempt = false) => {
    if (!isOnline && !forceAttempt) return;
    setIsLoadingSchema(true);
    setSchemaError(null);
    try {
      const schema = await getDatabaseSchemaTables(serverId, engine, selectedDb, buildCreds());
      setSchemaSummary(schema);
    } catch (err: any) {
      const msg = err?.message || String(err);
      setSchemaError(msg);
      toast.error(msg || 'Failed to load database tables');
    } finally {
      setIsLoadingSchema(false);
    }
  }, [serverId, isOnline, engine, selectedDb, buildCreds]);

  useEffect(() => {
    if (activeTab === 'schema') {
      fetchSchemaTables();
    }
  }, [activeTab, fetchSchemaTables]);

  const handleApplyCustomDb = () => {
    const trimmed = customDbDraft.trim();
    if (trimmed) {
      setAvailableDbs((prev) => (prev.includes(trimmed) ? prev : [trimmed, ...prev]));
      setSelectedDb(trimmed);
    }
    setEditingCustomDb(false);
  };

  const handleApplyAuthAndReconnect = async () => {
    await fetchDatabases(true);
    if (activeTab === 'schema') {
      await fetchSchemaTables(true);
    } else if (activeTab === 'connections') {
      await fetchConnections(true);
    }
  };

  // Export Results
  const exportCsv = () => {
    if (!queryResult || queryResult.rows.length === 0) return;
    const cols = queryResult.columns;
    const headerRow = cols.join(',');
    const bodyRows = queryResult.rows.map((row: Record<string, any>) => {
      return cols.map((c: string) => {
        const val = row[c];
        if (val === null || val === undefined) return '';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      }).join(',');
    });
    const csvContent = [headerRow, ...bodyRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${selectedDb}_query_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Query results exported to CSV');
  };

  const exportJson = () => {
    if (!queryResult || queryResult.rows.length === 0) return;
    const jsonContent = JSON.stringify(queryResult.rows, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${selectedDb}_query_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Query results exported to JSON');
  };

  const copyResults = () => {
    if (!queryResult || queryResult.rows.length === 0) return;
    const cols = queryResult.columns;
    const headerRow = cols.join('\t');
    const bodyRows = queryResult.rows.map((row: Record<string, any>) => cols.map((c: string) => String(row[c] ?? '')).join('\t'));
    navigator.clipboard.writeText([headerRow, ...bodyRows].join('\n'));
    toast.success('Results copied to clipboard (TSV format)');
  };

  // Filtered rows for query grid
  const filteredRows = useMemo(() => {
    if (!queryResult) return [];
    if (!resultFilter.trim()) return queryResult.rows;
    const lower = resultFilter.toLowerCase();
    return queryResult.rows.filter((row: Record<string, any>) => {
      return Object.values(row).some((v: any) => String(v ?? '').toLowerCase().includes(lower));
    });
  }, [queryResult, resultFilter]);

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, currentPage, pageSize]);

  // Filtered connections
  const filteredConnections = useMemo(() => {
    if (!connectionStats) return [];
    if (!connectionFilter.trim()) return connectionStats.connections;
    const lower = connectionFilter.toLowerCase();
    return connectionStats.connections.filter((c) => {
      return (
        c.id.toLowerCase().includes(lower) ||
        c.user.toLowerCase().includes(lower) ||
        c.database.toLowerCase().includes(lower) ||
        c.client_addr.toLowerCase().includes(lower) ||
        c.state.toLowerCase().includes(lower) ||
        c.query.toLowerCase().includes(lower)
      );
    });
  }, [connectionStats, connectionFilter]);

  // Filtered tables
  const filteredTables = useMemo(() => {
    if (!schemaSummary) return [];
    if (!schemaFilter.trim()) return schemaSummary.tables;
    const lower = schemaFilter.toLowerCase();
    return schemaSummary.tables.filter((t: DatabaseTableInfo) => t.name.toLowerCase().includes(lower) || t.schema.toLowerCase().includes(lower));
  }, [schemaSummary, schemaFilter]);

  const handleSelectSnippet = (snippet: QuerySnippet) => {
    setQueryInput(snippet.query);
    toast.info(`Loaded snippet: "${snippet.name}"`);
  };

  const handleQuickSelectTable = (table: DatabaseTableInfo) => {
    const qualifiedName = table.schema && table.schema !== 'public' ? `"${table.schema}"."${table.name}"` : `"${table.name}"`;
    const q = engine === 'mysql' ? `SELECT * FROM \`${table.name}\` LIMIT 50;` : `SELECT * FROM ${qualifiedName} LIMIT 50;`;
    setQueryInput(q);
    setActiveTab('query');
    handleRunQuery(q);
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Top Controls Header */}
      <div className="border-b border-border/60 bg-card/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Engine Selector */}
          <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-lg border border-border/50">
            <button
              onClick={() => handleEngineSwitch('postgres')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                engine === 'postgres'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              }`}
            >
              <span>🐘</span>
              <span>PostgreSQL</span>
            </button>
            <button
              onClick={() => handleEngineSwitch('mysql')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                engine === 'mysql'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              }`}
            >
              <span>🐬</span>
              <span>MySQL / MariaDB</span>
            </button>
            <button
              onClick={() => handleEngineSwitch('redis')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                engine === 'redis'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              }`}
            >
              <span>🔴</span>
              <span>Redis</span>
            </button>
          </div>

          {/* Database Selector & Credentials Drawer Toggle */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 bg-background border border-border/70 rounded-md px-2.5 py-1">
              <Database className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground font-mono">DB:</span>
              {editingCustomDb ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={customDbDraft}
                    onChange={(e) => setCustomDbDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleApplyCustomDb();
                      if (e.key === 'Escape') setEditingCustomDb(false);
                    }}
                    placeholder="database name..."
                    autoFocus
                    className="bg-muted/50 border border-border rounded px-1.5 py-0.5 text-xs font-mono w-32 focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={handleApplyCustomDb}
                    title="Use entered database name"
                    className="text-emerald-500 hover:text-emerald-400 p-0.5 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingCustomDb(false)}
                    title="Cancel"
                    className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <select
                    value={selectedDb}
                    onChange={(e) => setSelectedDb(e.target.value)}
                    className="bg-transparent text-xs font-medium focus:outline-none cursor-pointer max-w-[160px] truncate"
                  >
                    {availableDbs.map((db) => (
                      <option key={db} value={db} className="bg-popover text-popover-foreground">
                        {db}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomDbDraft(selectedDb);
                      setEditingCustomDb(true);
                    }}
                    title="Type database name manually"
                    className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => fetchDatabases(true)}
                disabled={isLoadingDbs}
                title="Refresh available databases"
                className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
              >
                <RotateCw className={`w-3 h-3 ${isLoadingDbs ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Credentials Toggle */}
            <Button
              variant={dbHost || dbUser || dbPass ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setShowCreds(!showCreds)}
              className="text-xs h-8 gap-1.5"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{dbHost || dbUser || dbPass ? 'Custom Auth' : 'Socket Auth'}</span>
            </Button>

            {/* Safe Mode Toggle */}
            <div className="flex items-center gap-2 bg-muted/40 border border-border/50 rounded-lg px-2.5 py-1">
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                {safeMode ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                )}
                <span>Safe Mode</span>
                <Switch
                  checked={safeMode}
                  onCheckedChange={setSafeMode}
                  className="data-[state=checked]:bg-emerald-600 scale-75 origin-right"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Credentials Drawer (collapsible) */}
        {showCreds && (
          <div className="bg-muted/30 border border-border/70 rounded-lg p-3 space-y-2.5 animate-in fade-in duration-200">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-center">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase font-semibold">Host / Socket</label>
                <Input
                  placeholder="127.0.0.1 (if password set)"
                  value={dbHost}
                  onChange={(e) => setDbHost(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleApplyAuthAndReconnect(); }}
                  className="h-7 text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase font-semibold">Port</label>
                <Input
                  placeholder={engine === 'mysql' ? '3306' : engine === 'redis' ? '6379' : '5432'}
                  value={dbPort}
                  onChange={(e) => setDbPort(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleApplyAuthAndReconnect(); }}
                  className="h-7 text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase font-semibold">Username</label>
                <Input
                  placeholder={engine === 'mysql' ? 'root' : 'postgres'}
                  value={dbUser}
                  onChange={(e) => setDbUser(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleApplyAuthAndReconnect(); }}
                  className="h-7 text-xs font-mono"
                />
              </div>
              <div className="relative">
                <label className="text-[10px] text-muted-foreground uppercase font-semibold">Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Socket / Docker env if blank"
                    value={dbPass}
                    onChange={(e) => setDbPass(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleApplyAuthAndReconnect(); }}
                    className="h-7 text-xs font-mono pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-border/50 text-[11px] text-muted-foreground">
              <span>Leave blank for automatic OS socket / sudo / Docker credential detection.</span>
              <div className="flex items-center gap-2">
                {(dbHost || dbPort || dbUser || dbPass) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDbHost('');
                      setDbPort('');
                      setDbUser('');
                      setDbPass('');
                    }}
                    className="h-6 text-[11px] px-2"
                  >
                    Reset to Socket Auth
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={handleApplyAuthAndReconnect}
                  disabled={isLoadingDbs}
                  className="h-6 text-[11px] px-3 gap-1"
                >
                  <RotateCw className={`w-3 h-3 ${isLoadingDbs ? 'animate-spin' : ''}`} />
                  <span>Apply & Load DBs</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Database Discovery Diagnostic Banner */}
        {dbError && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-lg px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <div className="min-w-0">
                <span className="font-semibold">Database discovery note: </span>
                <span className="font-mono text-[11px] break-all text-amber-200/90">{dbError}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {!showCreds && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreds(true)}
                  className="h-6 text-[11px] px-2 border-amber-500/40 hover:bg-amber-500/20"
                >
                  Configure Auth
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fetchDatabases(true)}
                className="h-6 text-[11px] px-2 border-amber-500/40 hover:bg-amber-500/20"
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Sub-view Navigation Tabs */}
        <div className="flex items-center gap-2 border-t border-border/40 pt-2">
          <Button
            variant={activeTab === 'query' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('query')}
            className="text-xs h-7 gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Query Runner</span>
          </Button>

          <Button
            variant={activeTab === 'connections' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('connections')}
            className="text-xs h-7 gap-1.5"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Active Connections</span>
            {connectionStats && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] ml-1">
                {connectionStats.total_connections}
              </Badge>
            )}
          </Button>

          <Button
            variant={activeTab === 'schema' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('schema')}
            className="text-xs h-7 gap-1.5"
          >
            <TableProperties className="w-3.5 h-3.5" />
            <span>Tables & Schema</span>
            {schemaSummary && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] ml-1">
                {schemaSummary.total_tables}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {/* Main Body Viewport */}
      <div className="flex-1 overflow-hidden p-4 min-h-0">
        {/* ======================================================== */}
        {/* TAB 1: QUERY RUNNER                                       */}
        {/* ======================================================== */}
        {activeTab === 'query' && (
          <div className="flex flex-col h-full gap-3 overflow-hidden">
            {/* Query Editor Box */}
            <div className="border border-border rounded-lg bg-card overflow-hidden flex flex-col shadow-sm">
              <div className="flex items-center justify-between bg-muted/40 px-3 py-1.5 border-b border-border/60 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground font-mono">
                  <Terminal className="w-3.5 h-3.5 text-primary" />
                  <span>SQL / Command Editor</span>
                  <span className="text-[11px] text-muted-foreground/70 hidden sm:inline">(Press Ctrl+Enter to execute)</span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Snippets Dropdown */}
                  <div className="relative group">
                    <Button variant="outline" size="sm" className="h-6 text-[11px] gap-1 px-2">
                      <Zap className="w-3 h-3 text-amber-400" />
                      <span>Snippets</span>
                    </Button>
                    <div className="absolute right-0 top-full mt-1 w-64 bg-popover border border-border rounded-md shadow-xl py-1 z-30 hidden group-hover:block">
                      <div className="px-3 py-1 text-[10px] uppercase font-semibold text-muted-foreground border-b border-border/50">
                        {engine.toUpperCase()} Quick Snippets
                      </div>
                      {ENGINE_SNIPPETS[engine]?.map((snippet) => (
                        <button
                          key={snippet.name}
                          onClick={() => handleSelectSnippet(snippet)}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex flex-col"
                        >
                          <span className="font-medium text-foreground">{snippet.name}</span>
                          <span className="text-[10px] text-muted-foreground truncate">{snippet.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* History Toggle */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowHistory(!showHistory)}
                    className="h-6 text-[11px] gap-1 px-2"
                  >
                    <History className="w-3 h-3 text-sky-400" />
                    <span>History</span>
                  </Button>

                  {/* Clear Button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setQueryInput('')}
                    className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </Button>

                  {/* Run Button */}
                  <Button
                    size="sm"
                    onClick={() => handleRunQuery()}
                    disabled={isExecutingQuery || !isOnline}
                    className="h-6 text-xs gap-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                  >
                    {isExecutingQuery ? (
                      <RotateCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3 fill-current" />
                    )}
                    <span>Run Query</span>
                  </Button>
                </div>
              </div>

              {/* Code Textarea */}
              <div className="relative">
                <textarea
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    engine === 'redis'
                      ? 'Enter Redis command (e.g. INFO, DBSIZE, KEYS *, CLIENT LIST)...'
                      : 'Enter SQL query (e.g. SELECT * FROM users LIMIT 10)...'
                  }
                  rows={4}
                  className="w-full bg-background p-3 text-xs font-mono text-foreground focus:outline-none resize-y min-h-[90px] border-none"
                />
              </div>

              {/* Collapsible History Shelf */}
              {showHistory && (
                <div className="border-t border-border bg-muted/20 p-2 max-h-40 overflow-y-auto">
                  <div className="flex items-center justify-between mb-1.5 px-1">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase">Recent Queries</span>
                    <button
                      onClick={() => setShowHistory(false)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {queryHistory.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-2 text-center">No recent queries recorded.</div>
                  ) : (
                    <div className="space-y-1">
                      {queryHistory.map((item) => (
                        <div
                          key={item.id}
                          onClick={() => {
                            setQueryInput(item.query);
                            setShowHistory(false);
                          }}
                          className="flex items-center justify-between p-1.5 text-xs font-mono bg-card hover:bg-muted/60 border border-border/40 rounded cursor-pointer transition-colors"
                        >
                          <span className="truncate max-w-[70%] text-foreground">{item.query}</span>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span>{item.durationMs}ms</span>
                            <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Error Banner */}
            {queryError && (
              <div className="bg-destructive/15 border border-destructive/40 text-destructive rounded-lg p-3 text-xs flex items-start gap-2.5 font-mono">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1 overflow-x-auto whitespace-pre-wrap">{queryError}</div>
              </div>
            )}

            {/* Results Grid Deck */}
            <div className="flex-1 border border-border rounded-lg bg-card overflow-hidden flex flex-col min-h-0">
              {/* Results Top Toolbar */}
              <div className="flex flex-wrap items-center justify-between px-3 py-2 border-b border-border bg-muted/20 gap-2">
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-semibold text-foreground">Results</span>
                  {queryResult && (
                    <>
                      <Badge variant="outline" className="font-mono text-[11px] text-emerald-400 border-emerald-500/30">
                        {queryResult.execution_time_ms} ms
                      </Badge>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {queryResult.row_count} rows
                      </Badge>
                      {queryResult.affected_rows !== null && (
                        <Badge variant="outline" className="font-mono text-[11px] text-amber-400">
                          {queryResult.affected_rows} affected
                        </Badge>
                      )}
                      {queryResult.is_truncated && (
                        <Badge variant="destructive" className="text-[10px]">
                          Truncated to 1000 rows
                        </Badge>
                      )}
                    </>
                  )}
                </div>

                {queryResult && queryResult.rows.length > 0 && (
                  <div className="flex items-center gap-2">
                    {/* Live Row Filter */}
                    <div className="relative">
                      <Search className="w-3 h-3 absolute left-2 top-2 text-muted-foreground" />
                      <Input
                        placeholder="Filter rows..."
                        value={resultFilter}
                        onChange={(e) => {
                          setResultFilter(e.target.value);
                          setCurrentPage(1);
                        }}
                        className="h-7 text-xs pl-7 w-36 sm:w-48 font-mono"
                      />
                    </div>

                    <Button variant="outline" size="sm" onClick={copyResults} className="h-7 text-xs gap-1 px-2.5">
                      <Copy className="w-3 h-3" />
                      <span className="hidden sm:inline">Copy</span>
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportCsv} className="h-7 text-xs gap-1 px-2.5">
                      <Download className="w-3 h-3" />
                      <span>CSV</span>
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportJson} className="h-7 text-xs gap-1 px-2.5">
                      <Download className="w-3 h-3" />
                      <span>JSON</span>
                    </Button>
                  </div>
                )}
              </div>

              {/* Data Table */}
              <div className="flex-1 overflow-auto min-h-0 bg-background/50">
                {!queryResult && !isExecutingQuery && (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-6 text-center">
                    <Database className="w-10 h-10 mb-2 opacity-30 text-primary" />
                    <p className="text-sm font-medium">Ready to execute query</p>
                    <p className="text-xs text-muted-foreground/70 max-w-sm mt-1">
                      Type your SQL query or select an engine snippet above and click <strong>Run Query</strong> (or press Ctrl+Enter).
                    </p>
                  </div>
                )}

                {isExecutingQuery && (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-6">
                    <RotateCw className="w-8 h-8 animate-spin text-primary mb-3" />
                    <p className="text-xs font-mono">Executing query on remote server...</p>
                  </div>
                )}

                {queryResult && queryResult.rows.length === 0 && !isExecutingQuery && (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-6 text-center">
                    <CheckCircle2 className="w-8 h-8 mb-2 text-emerald-400 opacity-60" />
                    <p className="text-xs font-mono">Query executed successfully (0 rows returned)</p>
                  </div>
                )}

                {queryResult && queryResult.rows.length > 0 && !isExecutingQuery && (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-muted/80 sticky top-0 z-10 border-b border-border">
                      <tr>
                        <th className="py-2 px-3 text-[10px] text-muted-foreground font-mono w-12 border-r border-border/50 text-right">#</th>
                        {queryResult.columns.map((col: string) => (
                          <th key={col} className="py-2 px-3 font-semibold text-foreground border-r border-border/50 whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 font-mono text-[11px]">
                      {paginatedRows.map((row: Record<string, any>, idx: number) => {
                        const rowNum = (currentPage - 1) * pageSize + idx + 1;
                        return (
                          <tr key={idx} className="hover:bg-muted/40 transition-colors">
                            <td className="py-1.5 px-3 text-[10px] text-muted-foreground/70 border-r border-border/40 text-right select-none">
                              {rowNum}
                            </td>
                            {queryResult.columns.map((col: string) => {
                              const cellVal = row[col];
                              const isNull = cellVal === null || cellVal === undefined;
                              return (
                                <td key={col} className="py-1.5 px-3 border-r border-border/40 max-w-xs truncate whitespace-nowrap">
                                  {isNull ? (
                                    <span className="text-muted-foreground/40 italic">NULL</span>
                                  ) : typeof cellVal === 'boolean' ? (
                                    <span className={cellVal ? 'text-emerald-400' : 'text-rose-400'}>
                                      {cellVal ? 'TRUE' : 'FALSE'}
                                    </span>
                                  ) : (
                                    <span>{String(cellVal)}</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination Footer */}
              {queryResult && filteredRows.length > pageSize && (
                <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-card text-xs">
                  <span className="text-muted-foreground text-[11px]">
                    Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length} rows
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p: number) => Math.max(1, p - 1))}
                      disabled={currentPage <= 1}
                      className="h-6 text-xs px-2"
                    >
                      Previous
                    </Button>
                    <span className="text-[11px] px-2 font-mono">{currentPage} / {totalPages}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p: number) => Math.min(totalPages, p + 1))}
                      disabled={currentPage >= totalPages}
                      className="h-6 text-xs px-2"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: ACTIVE CONNECTIONS                                 */}
        {/* ======================================================== */}
        {activeTab === 'connections' && (
          <div className="flex flex-col h-full gap-3 overflow-hidden">
            {/* Top Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-card border border-border p-3 rounded-lg flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-muted-foreground font-medium">Total Connections</span>
                  <div className="text-xl font-bold font-mono text-foreground mt-0.5">
                    {connectionStats?.total_connections ?? 0}
                  </div>
                </div>
                <Layers className="w-6 h-6 text-primary opacity-60" />
              </div>

              <div className="bg-card border border-border p-3 rounded-lg flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-muted-foreground font-medium">Active Running</span>
                  <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
                    {connectionStats?.active_connections ?? 0}
                  </div>
                </div>
                <Activity className="w-6 h-6 text-emerald-400 opacity-60" />
              </div>

              <div className="bg-card border border-border p-3 rounded-lg flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-muted-foreground font-medium">Idle / Sleeping</span>
                  <div className="text-xl font-bold font-mono text-muted-foreground mt-0.5">
                    {connectionStats?.idle_connections ?? 0}
                  </div>
                </div>
                <Clock className="w-6 h-6 text-muted-foreground opacity-60" />
              </div>

              <div className="bg-card border border-border p-3 rounded-lg flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground font-medium">Max Limit</span>
                  <span className="text-xs font-mono font-bold text-foreground">
                    {connectionStats?.max_connections_limit ? `${connectionStats.max_connections_limit}` : 'Unlimited'}
                  </span>
                </div>
                {connectionStats?.max_connections_limit && (
                  <div className="w-full bg-muted rounded-full h-1.5 mt-2 overflow-hidden">
                    <div 
                      className="bg-primary h-1.5 rounded-full"
                      style={{ width: `${Math.min(100, ((connectionStats.total_connections / connectionStats.max_connections_limit) * 100))}%` }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Filter & Refresh Controls */}
            <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Filter by PID, user, client IP, or query..."
                  value={connectionFilter}
                  onChange={(e) => setConnectionFilter(e.target.value)}
                  className="h-8 text-xs pl-8 font-mono"
                />
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-md border border-border/50">
                  <span>Auto-Refresh:</span>
                  <select
                    value={autoRefreshInterval}
                    onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                    className="bg-transparent font-medium text-foreground cursor-pointer focus:outline-none"
                  >
                    <option value={0} className="bg-popover">Off</option>
                    <option value={3} className="bg-popover">3s</option>
                    <option value={5} className="bg-popover">5s</option>
                    <option value={10} className="bg-popover">10s</option>
                  </select>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchConnections(true)}
                  disabled={isLoadingConnections}
                  className="h-8 text-xs gap-1.5"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isLoadingConnections ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </Button>
              </div>
            </div>

            {connectionsError && (
              <div className="bg-destructive/15 border border-destructive/40 text-destructive rounded-lg p-3 text-xs flex flex-wrap items-center justify-between gap-2 font-mono">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="whitespace-pre-wrap break-all">{connectionsError}</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreds(true)}
                  className="h-6 text-[11px] px-2 font-sans shrink-0"
                >
                  Configure Auth
                </Button>
              </div>
            )}

            {/* Connections Table */}
            <div className="flex-1 border border-border rounded-lg bg-card overflow-auto min-h-0">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-muted/80 sticky top-0 z-10 border-b border-border">
                  <tr>
                    <th className="py-2 px-3 font-semibold text-foreground w-20">ID / PID</th>
                    <th className="py-2 px-3 font-semibold text-foreground w-28">Database</th>
                    <th className="py-2 px-3 font-semibold text-foreground w-24">User</th>
                    <th className="py-2 px-3 font-semibold text-foreground w-36">Client Addr</th>
                    <th className="py-2 px-3 font-semibold text-foreground w-24">State</th>
                    <th className="py-2 px-3 font-semibold text-foreground w-20">Duration</th>
                    <th className="py-2 px-3 font-semibold text-foreground">Current Query / Command</th>
                    <th className="py-2 px-3 font-semibold text-foreground w-20 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 font-mono text-[11px]">
                  {filteredConnections.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted-foreground">
                        No active connections matching current criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredConnections.map((conn) => {
                      const isActive = conn.state.toLowerCase().includes('active') || conn.state.toLowerCase().includes('query');
                      return (
                        <tr key={conn.id} className="hover:bg-muted/40 transition-colors">
                          <td className="py-2 px-3 font-bold text-foreground">{conn.id}</td>
                          <td className="py-2 px-3 text-muted-foreground">{conn.database || '-'}</td>
                          <td className="py-2 px-3 text-foreground">{conn.user || '-'}</td>
                          <td className="py-2 px-3 text-muted-foreground truncate max-w-[120px]">{conn.client_addr}</td>
                          <td className="py-2 px-3">
                            <Badge
                              variant="outline"
                              className={`text-[10px] uppercase font-mono ${
                                isActive
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : 'bg-muted text-muted-foreground border-border/50'
                              }`}
                            >
                              {conn.state || 'idle'}
                            </Badge>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">{conn.duration_seconds}s</td>
                          <td className="py-2 px-3 text-foreground/90 max-w-md truncate" title={conn.query}>
                            {conn.query || <span className="text-muted-foreground/40 italic">idle</span>}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleKillConnection(conn.id)}
                              disabled={killingConnId === conn.id}
                              className="h-6 px-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 text-xs"
                            >
                              <Trash2 className="w-3 h-3 mr-1" />
                              Kill
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: TABLES & SCHEMA EXPLORER                           */}
        {/* ======================================================== */}
        {activeTab === 'schema' && (
          <div className="flex flex-col h-full gap-3 overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Filter tables by name or schema..."
                  value={schemaFilter}
                  onChange={(e) => setSchemaFilter(e.target.value)}
                  className="h-8 text-xs pl-8 font-mono"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchSchemaTables(true)}
                  disabled={isLoadingSchema}
                  className="h-8 text-xs gap-1.5"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isLoadingSchema ? 'animate-spin' : ''}`} />
                  <span>Refresh Tables</span>
                </Button>
              </div>
            </div>

            {schemaError && (
              <div className="bg-destructive/15 border border-destructive/40 text-destructive rounded-lg p-3 text-xs flex flex-wrap items-center justify-between gap-2 font-mono">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="whitespace-pre-wrap break-all">{schemaError}</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreds(true)}
                  className="h-6 text-[11px] px-2 font-sans shrink-0"
                >
                  Configure Auth
                </Button>
              </div>
            )}

            {/* Keyspaces Banner for Redis */}
            {schemaSummary?.keyspaces && schemaSummary.keyspaces.length > 0 && (
              <div className="bg-muted/30 border border-border p-3 rounded-lg">
                <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Redis Keyspaces</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {schemaSummary.keyspaces.map((ks: string) => (
                    <Badge key={ks} variant="secondary" className="font-mono text-xs py-1 px-2.5">
                      {ks}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Tables Grid */}
            <div className="flex-1 border border-border rounded-lg bg-card overflow-auto min-h-0">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-muted/80 sticky top-0 z-10 border-b border-border">
                  <tr>
                    <th className="py-2 px-3 font-semibold text-foreground">Table Name</th>
                    <th className="py-2 px-3 font-semibold text-foreground w-28">Schema</th>
                    <th className="py-2 px-3 font-semibold text-foreground w-28">Total Disk Size</th>
                    <th className="py-2 px-3 font-semibold text-foreground w-32">Est. Rows</th>
                    <th className="py-2 px-3 font-semibold text-foreground w-28">Type</th>
                    <th className="py-2 px-3 font-semibold text-foreground w-28 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 font-mono text-[11px]">
                  {filteredTables.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
                        {isLoadingSchema ? 'Loading database schema tables...' : 'No tables found in this database.'}
                      </td>
                    </tr>
                  ) : (
                    filteredTables.map((tbl: DatabaseTableInfo) => (
                      <tr key={`${tbl.schema}.${tbl.name}`} className="hover:bg-muted/40 transition-colors">
                        <td className="py-2 px-3 font-semibold text-foreground flex items-center gap-2">
                          <TableProperties className="w-3.5 h-3.5 text-primary opacity-70 shrink-0" />
                          <span>{tbl.name}</span>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{tbl.schema}</td>
                        <td className="py-2 px-3 font-medium text-emerald-400">{tbl.total_size_pretty}</td>
                        <td className="py-2 px-3 text-muted-foreground">{tbl.row_estimate.toLocaleString()}</td>
                        <td className="py-2 px-3">
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {tbl.table_type}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleQuickSelectTable(tbl)}
                            className="h-6 text-[11px] px-2 gap-1"
                          >
                            <Play className="w-2.5 h-2.5 fill-current text-primary" />
                            <span>SELECT</span>
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
