import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  FileKey, 
  Search, 
  RotateCw, 
  Save, 
  Plus, 
  Trash2, 
  Eye, 
  EyeOff, 
  Copy, 
  History, 
  GitCompare, 
  FolderSearch, 
  FileCode, 
  FileText, 
  Database, 
  KeyRound, 
  Globe, 
  Settings2, 
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  listServerEnvFiles,
  readEnvFile,
  saveEnvFile,
  restoreEnvBackup,
  listServers,
  type EnvFileEntry,
  type EnvVariableItem,
  type EnvBackupEntry,
  type EnvFileDetails,
  type Server
} from '@/lib/tauri-client';
import { toast } from 'sonner';

interface EnvManagerProps {
  serverId: string;
}

const isSensitiveKey = (key: string): boolean => {
  const k = key.toUpperCase();
  return (
    k.includes('SECRET') ||
    k.includes('PASSWORD') ||
    k.includes('PASSWD') ||
    k.includes('TOKEN') ||
    k.includes('API_KEY') ||
    k.includes('APIKEY') ||
    k.includes('AUTH') ||
    k.includes('PRIVATE') ||
    k.includes('CERT') ||
    k.includes('CREDENTIAL') ||
    k.includes('DATABASE_URL') ||
    k.includes('DB_PASS') ||
    k.includes('JWT') ||
    k.includes('ENCRYPTION') ||
    k.includes('SIGNING') ||
    k.includes('HASH') ||
    k.includes('ACCESS_KEY')
  );
};

const getCategoryBadge = (key: string) => {
  const k = key.toUpperCase();
  if (k.includes('DB_') || k.includes('DATABASE') || k.includes('POSTGRES') || k.includes('MYSQL') || k.includes('REDIS') || k.includes('MONGO')) {
    return { label: 'Database', icon: Database, color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
  }
  if (isSensitiveKey(key)) {
    return { label: 'Secret', icon: KeyRound, color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' };
  }
  if (k.includes('URL') || k.includes('HOST') || k.includes('PORT') || k.includes('DOMAIN') || k.includes('ORIGIN') || k.includes('CORS')) {
    return { label: 'Network', icon: Globe, color: 'text-sky-400 bg-sky-500/10 border-sky-500/30' };
  }
  return { label: 'Config', icon: Settings2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
};

export const EnvManager: React.FC<EnvManagerProps> = ({ serverId }) => {
  // Discovery & Selected file state
  const [envFiles, setEnvFiles] = useState<EnvFileEntry[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [customPathInput, setCustomPathInput] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isLoadingFile, setIsLoadingFile] = useState<boolean>(false);

  // File Content State
  const [fileDetails, setFileDetails] = useState<EnvFileDetails | null>(null);
  const [items, setItems] = useState<EnvVariableItem[]>([]);
  const [rawText, setRawText] = useState<string>('');
  const [viewMode, setViewMode] = useState<'table' | 'raw'>('table');
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [autoBackup, setAutoBackup] = useState<boolean>(true);

  // Security & Filter State
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [revealAll, setRevealAll] = useState<boolean>(false);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Backups & Rollback Dialog State
  const [isBackupDialogOpen, setIsBackupDialogOpen] = useState<boolean>(false);
  const [backupsList, setBackupsList] = useState<EnvBackupEntry[]>([]);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);

  // Compare & Diff Dialog State
  const [isDiffDialogOpen, setIsDiffDialogOpen] = useState<boolean>(false);
  const [diffTargetFilePath, setDiffTargetFilePath] = useState<string>('');
  const [targetServerId, setTargetServerId] = useState<string>(serverId);
  const [allServers, setAllServers] = useState<Server[]>([]);
  const [targetEnvFiles, setTargetEnvFiles] = useState<EnvFileEntry[]>([]);
  const [diffDetails, setDiffDetails] = useState<EnvFileDetails | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState<boolean>(false);

  // 1. Discover all .env files on this server
  const scanEnvFiles = useCallback(async (preferredPath?: string) => {
    try {
      setIsScanning(true);
      const files = await listServerEnvFiles(serverId);
      setEnvFiles(files);

      if (preferredPath && files.some(f => f.path === preferredPath)) {
        setSelectedFilePath(preferredPath);
      } else if (files.length > 0 && !selectedFilePath) {
        setSelectedFilePath(files[0].path);
      }
    } catch (err: any) {
      toast.error(`Failed to discover .env files: ${err?.message || err}`);
    } finally {
      setIsScanning(false);
    }
  }, [serverId, selectedFilePath]);

  useEffect(() => {
    scanEnvFiles();
    listServers().then(setAllServers).catch(() => {});
  }, [serverId]);

  // 2. Load file contents when selectedFilePath changes
  const loadFileContent = useCallback(async (path: string) => {
    if (!path) return;
    try {
      setIsLoadingFile(true);
      const details = await readEnvFile(serverId, path);
      setFileDetails(details);
      setItems(details.items);
      setRawText(details.raw_content);
      setBackupsList(details.backups);
      setIsDirty(false);
      setRevealedKeys(new Set());
      setRevealAll(false);
    } catch (err: any) {
      toast.error(`Failed to load ${path}: ${err?.message || err}`);
    } finally {
      setIsLoadingFile(false);
    }
  }, [serverId]);

  useEffect(() => {
    if (selectedFilePath) {
      loadFileContent(selectedFilePath);
    }
  }, [selectedFilePath, loadFileContent]);

  // Synchronize items -> rawText
  const syncItemsToRaw = (newItems: EnvVariableItem[]) => {
    setItems(newItems);
    setIsDirty(true);
    const generated = newItems.map(item => {
      const comment = item.comment ? `# ${item.comment}\n` : '';
      const quote = item.value.includes(' ') || item.value.includes('#') ? `"${item.value}"` : item.value;
      return `${comment}${item.key}=${quote}`;
    }).join('\n');
    setRawText(generated);
  };

  // Synchronize rawText -> items
  const syncRawToItems = (raw: string) => {
    setRawText(raw);
    setIsDirty(true);
    const parsed: EnvVariableItem[] = [];
    let curComment: string | null = null;
    let lineNo = 1;

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        curComment = null;
        lineNo++;
        continue;
      }
      if (trimmed.startsWith('#')) {
        curComment = trimmed.replace(/^#+\s*/, '');
        lineNo++;
        continue;
      }
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        parsed.push({
          key,
          value: val,
          raw_line: line,
          comment: curComment,
          is_secret: isSensitiveKey(key),
          line_number: lineNo,
        });
        curComment = null;
      }
      lineNo++;
    }
    setItems(parsed);
  };

  // 3. Save .env changes
  const handleSave = async () => {
    if (!selectedFilePath) return;
    try {
      setIsSaving(true);
      const backupCreated = await saveEnvFile(serverId, selectedFilePath, rawText, autoBackup);
      if (backupCreated) {
        toast.success(`Saved! Backup created at ${backupCreated.split('/').pop()}`);
      } else {
        toast.success('Saved environment file successfully');
      }
      setIsDirty(false);
      loadFileContent(selectedFilePath);
    } catch (err: any) {
      toast.error(`Failed to save: ${err?.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Item manipulations
  const handleItemChange = (index: number, field: 'key' | 'value' | 'comment', value: string) => {
    const updated = [...items];
    const current = updated[index];
    if (field === 'key') {
      current.key = value;
      current.is_secret = isSensitiveKey(value);
    } else if (field === 'value') {
      current.value = value;
    } else if (field === 'comment') {
      current.comment = value || null;
    }
    syncItemsToRaw(updated);
  };

  const handleAddItem = () => {
    const updated: EnvVariableItem[] = [
      ...items,
      {
        key: 'NEW_VARIABLE',
        value: '',
        raw_line: 'NEW_VARIABLE=',
        comment: null,
        is_secret: false,
        line_number: items.length + 1,
      }
    ];
    syncItemsToRaw(updated);
  };

  const handleDeleteItem = (index: number) => {
    const updated = items.filter((_, idx) => idx !== index);
    syncItemsToRaw(updated);
  };

  const toggleRevealKey = (key: string) => {
    setRevealedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleCopyValue = (val: string) => {
    navigator.clipboard.writeText(val);
    toast.success('Copied value to clipboard');
  };

  // 4. Rollback handler
  const handleRestoreBackup = async (backup: EnvBackupEntry) => {
    try {
      setIsRestoring(true);
      await restoreEnvBackup(serverId, selectedFilePath, backup.backup_path);
      toast.success(`Restored from backup: ${backup.filename}`);
      setIsBackupDialogOpen(false);
      loadFileContent(selectedFilePath);
    } catch (err: any) {
      toast.error(`Rollback failed: ${err?.message || err}`);
    } finally {
      setIsRestoring(false);
    }
  };

  // 5. Diff & Compare handler
  const openDiffModal = async () => {
    setIsDiffDialogOpen(true);
    setTargetServerId(serverId);
    try {
      const files = await listServerEnvFiles(serverId);
      setTargetEnvFiles(files);
      // Default to another .env file if available (e.g. .env.example or .env.staging)
      const other = files.find(f => f.path !== selectedFilePath);
      if (other) {
        setDiffTargetFilePath(other.path);
        loadDiffTarget(serverId, other.path);
      }
    } catch {
      // ignore
    }
  };

  const loadDiffTarget = async (tgtServer: string, tgtPath: string) => {
    if (!tgtPath) return;
    try {
      setIsLoadingDiff(true);
      const details = await readEnvFile(tgtServer, tgtPath);
      setDiffDetails(details);
    } catch (err: any) {
      toast.error(`Failed to load target file: ${err?.message || err}`);
    } finally {
      setIsLoadingDiff(false);
    }
  };

  // Calculate Comparison Rows
  const diffRows = useMemo(() => {
    if (!fileDetails || !diffDetails) return [];
    const sourceMap = new Map<string, string>();
    items.forEach(i => sourceMap.set(i.key, i.value));

    const targetMap = new Map<string, string>();
    diffDetails.items.forEach(i => targetMap.set(i.key, i.value));

    const allKeys = Array.from(new Set([...sourceMap.keys(), ...targetMap.keys()])).sort();

    return allKeys.map(key => {
      const sourceVal = sourceMap.get(key);
      const targetVal = targetMap.get(key);
      let status: 'identical' | 'different' | 'missing_in_target' | 'only_in_target' = 'identical';

      if (sourceVal !== undefined && targetVal === undefined) {
        status = 'missing_in_target';
      } else if (sourceVal === undefined && targetVal !== undefined) {
        status = 'only_in_target';
      } else if (sourceVal !== targetVal) {
        status = 'different';
      }

      return {
        key,
        sourceVal,
        targetVal,
        status,
        isSecret: isSensitiveKey(key),
      };
    });
  }, [fileDetails, diffDetails, items]);

  const copyMissingKeyFromTarget = (key: string, val: string) => {
    if (items.some(i => i.key === key)) return;
    const updated = [
      ...items,
      {
        key,
        value: val,
        raw_line: `${key}=${val}`,
        comment: 'Imported from comparison',
        is_secret: isSensitiveKey(key),
        line_number: items.length + 1,
      }
    ];
    syncItemsToRaw(updated);
    toast.success(`Imported ${key}`);
  };

  // Filtered Items for Main Table
  const filteredItems = items.filter(item => {
    const matchesSearch = !searchFilter || 
      item.key.toLowerCase().includes(searchFilter.toLowerCase()) ||
      item.value.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (item.comment && item.comment.toLowerCase().includes(searchFilter.toLowerCase()));

    if (!matchesSearch) return false;

    if (categoryFilter === 'secrets') return item.is_secret;
    if (categoryFilter === 'database') return getCategoryBadge(item.key).label === 'Database';
    if (categoryFilter === 'network') return getCategoryBadge(item.key).label === 'Network';
    return true;
  });

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatDate = (timestamp: number) => {
    if (!timestamp) return '—';
    return new Date(timestamp * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-card/60 border border-border/80 rounded-2xl shadow-xl overflow-hidden backdrop-blur-sm relative">
      {/* Top Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 border-b border-border/60 bg-muted/20 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shrink-0 shadow-xs">
            <FileKey className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm sm:text-base font-bold text-foreground tracking-tight">
                Environment Variables & Secrets Deck
              </h2>
              <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                Encrypted Stream
              </Badge>
              {isDirty && (
                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400 bg-amber-500/10 animate-pulse">
                  Unsaved Changes
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              Direct remote .env management, sensitive credential masking, versioned auto-backups, and cross-env diffing.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={openDiffModal}
            disabled={!selectedFilePath}
            className="h-8 text-xs border-border bg-card text-foreground hover:bg-accent gap-1.5 shadow-xs cursor-pointer"
            title="Compare with another .env file or server"
          >
            <GitCompare className="w-3.5 h-3.5 text-primary" /> Compare / Diff
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsBackupDialogOpen(true)}
            disabled={!fileDetails || backupsList.length === 0}
            className="h-8 text-xs border-border bg-card text-foreground hover:bg-accent gap-1.5 shadow-xs cursor-pointer"
            title="View backup history and rollback"
          >
            <History className="w-3.5 h-3.5 text-indigo-400" />
            <span>History</span>
            {backupsList.length > 0 && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-0.5 bg-muted">
                {backupsList.length}
              </Badge>
            )}
          </Button>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !selectedFilePath}
            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold gap-1.5 shadow-sm cursor-pointer"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save & Sync
          </Button>
        </div>
      </div>

      {/* File Selector & Location Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 border-b border-border/60 bg-muted/30 text-xs shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0 flex items-center gap-1.5">
            <FolderSearch className="w-3.5 h-3.5 text-emerald-400" /> Remote File:
          </span>

          <select
            value={selectedFilePath}
            onChange={(e) => setSelectedFilePath(e.target.value)}
            disabled={isScanning || isLoadingFile}
            className="h-8 px-2.5 rounded-lg text-xs font-mono bg-background border border-input text-foreground flex-1 min-w-0 max-w-md focus:outline-hidden focus:ring-1 focus:ring-primary"
          >
            {envFiles.map((f) => (
              <option key={f.path} value={f.path}>
                {f.path} ({formatSize(f.size)}) {f.app_name ? `[${f.app_name}]` : ''}
              </option>
            ))}
            {envFiles.length === 0 && <option value="">No .env files found (Type path below)</option>}
          </select>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => scanEnvFiles(selectedFilePath)}
            disabled={isScanning}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
            title="Rescan server for .env files"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Custom Path Direct Opener */}
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            if (customPathInput.trim()) {
              setSelectedFilePath(customPathInput.trim());
              setCustomPathInput('');
            }
          }}
          className="flex items-center gap-1.5 shrink-0"
        >
          <Input
            value={customPathInput}
            onChange={(e) => setCustomPathInput(e.target.value)}
            placeholder="Manual path (/var/www/.../.env)"
            className="h-8 text-xs font-mono bg-background border-input w-48 sm:w-60"
          />
          <Button type="submit" size="sm" variant="secondary" className="h-8 text-xs px-2.5 cursor-pointer">
            Open
          </Button>
        </form>
      </div>

      {/* Toolbar & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 border-b border-border/60 bg-card/40 shrink-0 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border/60">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`h-7 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'table' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileText className="w-3.5 h-3.5" /> Structured Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode('raw')}
              className={`h-7 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'raw' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" /> Raw Code
            </button>
          </div>

          {viewMode === 'table' && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddItem}
                className="h-7 px-2.5 text-xs border-border bg-background text-foreground hover:bg-muted gap-1 font-medium cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" /> Add Variable
              </Button>

              {/* Reveal All Toggle */}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRevealAll(!revealAll)}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1.5 cursor-pointer"
                title={revealAll ? 'Mask all secret values' : 'Reveal all secret values'}
              >
                {revealAll ? <EyeOff className="w-3.5 h-3.5 text-rose-400" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{revealAll ? 'Mask All' : 'Reveal All'}</span>
              </Button>

              {/* Category Pills */}
              <div className="hidden sm:flex items-center gap-1 pl-2 border-l border-border/60">
                {(['all', 'secrets', 'database', 'network'] as const).map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`h-6 px-2 rounded-md text-[11px] capitalize cursor-pointer transition-colors ${
                      categoryFilter === cat
                        ? 'bg-primary/15 text-primary font-semibold border border-primary/30'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search Filter */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-muted-foreground" />
            <Input
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search keys & values..."
              className="h-7 text-xs pl-8 bg-background border-input w-44"
            />
          </div>

          {/* Auto-backup toggle */}
          <label className="flex items-center gap-1.5 pl-2 border-l border-border/60 text-[11px] text-muted-foreground select-none cursor-pointer">
            <Switch
              checked={autoBackup}
              onCheckedChange={setAutoBackup}
              className="scale-75"
            />
            <span>Auto-backup (.bak)</span>
          </label>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto relative">
        {isLoadingFile ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
            <p className="text-xs">Reading environment variables over secure SSH channel...</p>
          </div>
        ) : !selectedFilePath ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-muted-foreground">
            <FileKey className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-xs font-medium text-foreground">No .env file selected</p>
            <p className="text-[11px] text-muted-foreground">Choose a detected file above or enter a path.</p>
          </div>
        ) : viewMode === 'raw' ? (
          /* Raw Monospace Text Editor */
          <div className="h-full flex flex-col p-4 bg-muted/10 font-mono text-xs">
            <textarea
              value={rawText}
              onChange={(e) => syncRawToItems(e.target.value)}
              placeholder="# KEY=VALUE"
              spellCheck={false}
              className="w-full h-full min-h-[400px] p-4 bg-background/80 border border-border/80 rounded-xl font-mono text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary resize-none leading-relaxed"
            />
          </div>
        ) : (
          /* Structured Table View */
          <table className="w-full text-xs text-left border-collapse table-fixed select-none">
            <colgroup>
              <col style={{ width: '130px' }} /> {/* Category Badge */}
              <col style={{ width: '260px' }} /> {/* Variable Key */}
              <col /> {/* Value */}
              <col style={{ width: '90px' }} /> {/* Actions */}
            </colgroup>
            <thead>
              <tr className="border-b border-border/60 bg-muted/40 text-[11px] font-semibold text-muted-foreground sticky top-0 z-10 backdrop-blur-md">
                <th className="py-2.5 px-4">Type</th>
                <th className="py-2.5 px-3">Variable Key</th>
                <th className="py-2.5 px-3">Value</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-mono">
              {filteredItems.map((item, idx) => {
                const category = getCategoryBadge(item.key);
                const CategoryIcon = category.icon;
                const isMasked = item.is_secret && !revealAll && !revealedKeys.has(item.key);

                return (
                  <tr key={idx} className="hover:bg-muted/40 transition-colors group">
                    {/* Category Type */}
                    <td className="py-2 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium border ${category.color}`}>
                        <CategoryIcon className="w-3 h-3" />
                        <span>{category.label}</span>
                      </span>
                    </td>

                    {/* Variable Key */}
                    <td className="py-2 px-3 overflow-hidden">
                      <input
                        type="text"
                        value={item.key}
                        onChange={(e) => handleItemChange(idx, 'key', e.target.value)}
                        className="w-full bg-transparent border-0 font-semibold text-foreground focus:outline-hidden focus:bg-background/80 px-1 py-0.5 rounded-sm"
                      />
                      {item.comment && (
                        <div className="text-[10px] text-muted-foreground/80 font-sans italic px-1 truncate">
                          # {item.comment}
                        </div>
                      )}
                    </td>

                    {/* Variable Value */}
                    <td className="py-2 px-3 overflow-hidden">
                      <div className="flex items-center gap-1.5 w-full">
                        <input
                          type={isMasked ? 'password' : 'text'}
                          value={item.value}
                          onChange={(e) => handleItemChange(idx, 'value', e.target.value)}
                          placeholder="empty"
                          className="flex-1 bg-transparent border-0 text-foreground/90 focus:outline-hidden focus:bg-background/80 px-1.5 py-0.5 rounded-sm text-xs"
                        />

                        {/* Individual Eye Toggle for Secrets */}
                        {item.is_secret && !revealAll && (
                          <button
                            type="button"
                            onClick={() => toggleRevealKey(item.key)}
                            className="p-1 rounded-sm text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                            title={isMasked ? 'Reveal secret' : 'Mask secret'}
                          >
                            {isMasked ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-rose-400" />}
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Quick Row Actions */}
                    <td className="py-2 px-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopyValue(item.value)}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                          title="Copy value"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteItem(idx)}
                          className="h-7 w-7 p-0 text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                          title="Delete variable"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-muted-foreground">
                    {searchFilter ? `No variables matching "${searchFilter}"` : 'No variables in this file.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Backup & Rollback History Dialog */}
      <Dialog open={isBackupDialogOpen} onOpenChange={setIsBackupDialogOpen}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-400" /> .env Backup History & Rollback
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Timestamped backup snapshots stored on the server for <span className="font-mono text-foreground">{selectedFilePath}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-80 overflow-y-auto space-y-2 py-2">
            {backupsList.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No previous backups recorded for this file.</p>
            ) : (
              backupsList.map((bak) => (
                <div
                  key={bak.backup_path}
                  className="flex items-center justify-between p-3 rounded-xl border border-border/70 bg-muted/20 hover:bg-muted/40 transition-colors text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-mono font-semibold text-foreground truncate">{bak.filename}</div>
                    <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                      {formatDate(bak.modified)} • {formatSize(bak.size)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRestoreBackup(bak)}
                    disabled={isRestoring}
                    className="h-7 px-2.5 text-xs border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10 shrink-0 font-medium cursor-pointer"
                  >
                    {isRestoring ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Rollback'}
                  </Button>
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setIsBackupDialogOpen(false)} className="text-xs cursor-pointer">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cross-Environment Diff Modal */}
      <Dialog open={isDiffDialogOpen} onOpenChange={setIsDiffDialogOpen}>
        <DialogContent className="max-w-4xl bg-card border-border max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-primary" /> Cross-Environment Diff & Comparison
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Compare <span className="font-mono text-foreground">{selectedFilePath}</span> side-by-side with another file or server.
            </DialogDescription>
          </DialogHeader>

          {/* Comparison Target Selector */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-3 bg-muted/30 rounded-xl border border-border/60 text-xs shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">Server:</span>
              <select
                value={targetServerId}
                onChange={async (e) => {
                  const newSid = e.target.value;
                  setTargetServerId(newSid);
                  setDiffTargetFilePath('');
                  setDiffDetails(null);
                  try {
                    const files = await listServerEnvFiles(newSid);
                    setTargetEnvFiles(files);
                  } catch {}
                }}
                className="h-8 px-2.5 rounded-lg text-xs bg-background border border-input text-foreground font-medium"
              >
                {allServers.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.environment})</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 flex-1">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">Target File:</span>
              <select
                value={diffTargetFilePath}
                onChange={(e) => {
                  setDiffTargetFilePath(e.target.value);
                  loadDiffTarget(targetServerId, e.target.value);
                }}
                className="h-8 px-2.5 rounded-lg text-xs font-mono bg-background border border-input text-foreground flex-1 min-w-0"
              >
                <option value="">Select comparison target...</option>
                {targetEnvFiles.map(f => (
                  <option key={f.path} value={f.path}>{f.path}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Diff Table */}
          <div className="flex-1 min-h-0 overflow-y-auto border border-border/60 rounded-xl mt-2 font-mono text-xs">
            {isLoadingDiff ? (
              <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span>Loading target file...</span>
              </div>
            ) : !diffDetails ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                Select a target environment file to compare.
              </div>
            ) : (
              <table className="w-full text-left border-collapse table-fixed">
                <colgroup>
                  <col style={{ width: '220px' }} />
                  <col />
                  <col />
                  <col style={{ width: '80px' }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-border/60 bg-muted/50 text-[11px] font-semibold text-muted-foreground sticky top-0 z-10 backdrop-blur-md">
                    <th className="py-2 px-3">Variable Key</th>
                    <th className="py-2 px-3">Current File</th>
                    <th className="py-2 px-3">Target File</th>
                    <th className="py-2 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {diffRows.map((row) => (
                    <tr 
                      key={row.key} 
                      className={`transition-colors ${
                        row.status === 'missing_in_target' ? 'bg-amber-500/5' :
                        row.status === 'only_in_target' ? 'bg-sky-500/5' :
                        row.status === 'different' ? 'bg-rose-500/5' : 'hover:bg-muted/30'
                      }`}
                    >
                      <td className="py-2 px-3 font-semibold text-foreground truncate">
                        {row.key}
                      </td>
                      <td className="py-2 px-3 truncate text-muted-foreground">
                        {row.sourceVal !== undefined ? (
                          row.isSecret ? '••••••••' : row.sourceVal
                        ) : (
                          <span className="text-rose-400 font-sans italic text-[11px]">Missing</span>
                        )}
                      </td>
                      <td className="py-2 px-3 truncate text-muted-foreground">
                        {row.targetVal !== undefined ? (
                          row.isSecret ? '••••••••' : row.targetVal
                        ) : (
                          <span className="text-amber-400 font-sans italic text-[11px]">Missing in target</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {row.status === 'only_in_target' && row.targetVal !== undefined && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyMissingKeyFromTarget(row.key, row.targetVal!)}
                            className="h-6 px-2 text-[10px] text-primary hover:bg-primary/10 font-semibold cursor-pointer"
                          >
                            + Import
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button size="sm" variant="ghost" onClick={() => setIsDiffDialogOpen(false)} className="text-xs cursor-pointer">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

