import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  globalSearch, 
  type SearchResults, 
  type SearchServer, 
  type SearchApplication, 
  type SearchRebuildProfile, 
  type SearchCommand 
} from '@/lib/tauri-client';
import { 
  Dialog, DialogContent
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Server, AppWindow, RefreshCw, Zap, Search, ShieldAlert } from 'lucide-react';

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

type ResultItem =
  | { kind: 'server'; data: SearchServer }
  | { kind: 'application'; data: SearchApplication }
  | { kind: 'profile'; data: SearchRebuildProfile }
  | { kind: 'command'; data: SearchCommand };

interface ResultGroupProps {
  label: string;
  icon: React.ReactNode;
  items: ResultItem[];
  selectedIndex: number;
  globalBase: number;
  onSelect: (item: ResultItem) => void;
}

function ResultGroup({ label, icon, items, selectedIndex, globalBase, onSelect }: ResultGroupProps) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {icon}
        {label}
      </div>
      {items.map((item, i) => {
        const idx = globalBase + i;
        const isSelected = idx === selectedIndex;
        return (
          <button
            key={item.kind + '_' + (item.data as any).id}
            id={`search-result-${idx}`}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors rounded-md mx-1 ${
              isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'
            }`}
            onClick={() => onSelect(item)}
          >
            {item.kind === 'server' && (
              <>
                <Server className="w-4 h-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{(item.data as SearchServer).name}</div>
                  <div className={`text-xs truncate ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {(item.data as SearchServer).hostname} · {(item.data as SearchServer).environment}
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 text-xs">{(item.data as SearchServer).status}</Badge>
              </>
            )}
            {item.kind === 'application' && (
              <>
                <AppWindow className="w-4 h-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{(item.data as SearchApplication).name}</div>
                  <div className={`text-xs truncate ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {(item.data as SearchApplication).server_name ?? 'Unknown server'} · {(item.data as SearchApplication).branch}
                  </div>
                </div>
              </>
            )}
            {item.kind === 'profile' && (
              <>
                <RefreshCw className="w-4 h-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{(item.data as SearchRebuildProfile).name}</div>
                  <div className={`text-xs ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {(item.data as SearchRebuildProfile).step_count} steps{(item.data as SearchRebuildProfile).is_builtin ? ' · built-in' : ''}
                  </div>
                </div>
              </>
            )}
            {item.kind === 'command' && (
              <>
                <Zap className="w-4 h-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate flex items-center gap-1.5">
                    {(item.data as SearchCommand).name}
                    {(item.data as SearchCommand).is_destructive && <ShieldAlert className="w-3 h-3 text-destructive" />}
                  </div>
                  <div className={`text-xs font-mono truncate ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {(item.data as SearchCommand).command}
                  </div>
                </div>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
}

export const SearchPalette = ({ open, onClose }: SearchPaletteProps) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(
    debounce(async (q: string) => {
      if (q.trim().length < 2) { setResults(null); setIsLoading(false); return; }
      try {
        const res = await globalSearch(q);
        setResults(res);
        setSelectedIndex(0);
      } catch { setResults(null); } finally { setIsLoading(false); }
    }, 200),
    []
  );

  useEffect(() => {
    if (open) { setQuery(''); setResults(null); setSelectedIndex(0); }
  }, [open]);

  useEffect(() => {
    if (query.trim().length >= 2) { setIsLoading(true); }
    doSearch(query);
  }, [query]);

  // Flatten results for keyboard nav
  const allItems: ResultItem[] = results ? [
    ...results.servers.map(d => ({ kind: 'server' as const, data: d })),
    ...results.applications.map(d => ({ kind: 'application' as const, data: d })),
    ...results.rebuild_profiles.map(d => ({ kind: 'profile' as const, data: d })),
    ...results.commands.map(d => ({ kind: 'command' as const, data: d })),
  ] : [];

  const serverBase = 0;
  const appBase = results?.servers.length ?? 0;
  const profileBase = appBase + (results?.applications.length ?? 0);
  const commandBase = profileBase + (results?.rebuild_profiles.length ?? 0);

  const handleSelect = (item: ResultItem) => {
    // Navigation decisions per spec:
    // - Server: go to /server/:id (Server Detail)
    // - Application: go to the server that owns it (Server Detail, best we can do without app detail route)
    // - Rebuild Profile: go to /settings/rebuild (profile editor)
    // - Command: navigate to the server owning it, or /settings/commands for global library
    onClose();
    if (item.kind === 'server') {
      navigate(`/server/${item.data.id}`);
    } else if (item.kind === 'application') {
      navigate(`/server/${item.data.server_id}`);
    } else if (item.kind === 'profile') {
      navigate('/settings/rebuild');
    } else if (item.kind === 'command') {
      if (item.data.server_id) {
        navigate(`/server/${item.data.server_id}`);
      } else {
        navigate('/settings/commands');
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (allItems[selectedIndex]) handleSelect(allItems[selectedIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const hasResults = results && (
    results.servers.length + results.applications.length +
    results.rebuild_profiles.length + results.commands.length > 0
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent 
        className="max-w-2xl p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Search className={`w-4 h-4 shrink-0 ${isLoading ? 'animate-pulse text-primary' : 'text-muted-foreground'}`} />
          <Input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search servers, apps, profiles, commands..."
            className="border-0 shadow-none focus-visible:ring-0 p-0 h-auto text-base"
          />
          <Badge variant="outline" className="shrink-0 text-xs text-muted-foreground">ESC to close</Badge>
        </div>

        {/* Results */}
        <div className="max-h-[420px] overflow-y-auto py-2 space-y-1">
          {query.trim().length < 2 && (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Search className="w-8 h-8 mb-3 opacity-30" />
              <p className="text-sm">Type at least 2 characters to search</p>
            </div>
          )}

          {query.trim().length >= 2 && !isLoading && !hasResults && (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Search className="w-8 h-8 mb-3 opacity-30" />
              <p className="text-sm">No results found for &ldquo;{query}&rdquo;</p>
            </div>
          )}

          {results && (
            <>
              <ResultGroup label="Servers" icon={<Server className="w-3 h-3" />}
                items={results.servers.map(d => ({ kind: 'server', data: d }))}
                selectedIndex={selectedIndex} globalBase={serverBase} onSelect={handleSelect} />
              <ResultGroup label="Applications" icon={<AppWindow className="w-3 h-3" />}
                items={results.applications.map(d => ({ kind: 'application', data: d }))}
                selectedIndex={selectedIndex} globalBase={appBase} onSelect={handleSelect} />
              <ResultGroup label="Rebuild Profiles" icon={<RefreshCw className="w-3 h-3" />}
                items={results.rebuild_profiles.map(d => ({ kind: 'profile', data: d }))}
                selectedIndex={selectedIndex} globalBase={profileBase} onSelect={handleSelect} />
              <ResultGroup label="Commands" icon={<Zap className="w-3 h-3" />}
                items={results.commands.map(d => ({ kind: 'command', data: d }))}
                selectedIndex={selectedIndex} globalBase={commandBase} onSelect={handleSelect} />
            </>
          )}
        </div>

        {/* Footer hint */}
        {hasResults && (
          <div className="border-t px-4 py-2 flex gap-4 text-xs text-muted-foreground">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
