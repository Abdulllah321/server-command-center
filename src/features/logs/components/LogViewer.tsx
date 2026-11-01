import { useEffect, useRef, useState, useMemo } from 'react';
import { 
  Play, 
  Pause, 
  Download, 
  Copy, 
  Trash2, 
  Search, 
  X, 
  Loader2, 
  Terminal, 
  Layers,
  Sparkles,
  WrapText,
  Hash,
  Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { openLogStream, closeLogStream, readLogSessionFile } from '@/lib/tauri-client';
import { listen } from '@tauri-apps/api/event';
import { usePm2Processes } from '@/features/pm2/api';
import { BeautifiedLogLine, ansiToHtml, stripAnsi } from '../utils/log-beautifier';
import { toast } from 'sonner';

interface LogLineEvent {
  session_id: string;
  level: string;
  content: string;
}

interface LogViewerProps {
  serverId: string;
  pm2Name?: string;
  onClose?: () => void;
  isEmbedded?: boolean;
}

const LEVEL_COLORS: Record<string, string> = {
  ALL: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  INFO: 'bg-blue-500/15 text-blue-400 border-blue-500/30 font-semibold',
  WARN: 'bg-amber-500/15 text-amber-400 border-amber-500/30 font-semibold',
  ERROR: 'bg-rose-500/15 text-rose-400 border-rose-500/30 font-semibold',
  DEBUG: 'bg-purple-500/15 text-purple-400 border-purple-500/30 font-semibold',
};

export const LogViewer: React.FC<LogViewerProps> = ({ 
  serverId, 
  pm2Name = 'all', 
  onClose,
  isEmbedded = false
}) => {
  const [currentPm2Name, setCurrentPm2Name] = useState(pm2Name || 'all');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Display Options
  const [viewMode, setViewMode] = useState<'beautified' | 'raw'>('beautified');
  const [wrapLines, setWrapLines] = useState(true);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [copiedBuffer, setCopiedBuffer] = useState(false);

  const { data: processes } = usePm2Processes(serverId);

  // React state for rendering
  const [visibleLines, setVisibleLines] = useState<LogLineEvent[]>([]);
  
  // Mutable ref for the master line buffer to avoid closure capture issues
  const masterLinesRef = useRef<LogLineEvent[]>([]);
  const isPausedRef = useRef(isPaused);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Sync ref with state
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Keep internal state synced if prop changes
  useEffect(() => {
    if (pm2Name) {
      setCurrentPm2Name(pm2Name);
    }
  }, [pm2Name]);

  // Handle stream initialization and teardown
  useEffect(() => {
    let currentSessionId: string | null = null;
    let unlisten: (() => void) | null = null;

    masterLinesRef.current = [];
    setVisibleLines([]);
    setSessionId(null);

    const initStream = async () => {
      try {
        const id = await openLogStream(serverId, currentPm2Name);
        currentSessionId = id;
        setSessionId(id);

        unlisten = await listen<LogLineEvent>(`logs://data:${id}`, (event) => {
          masterLinesRef.current.push(event.payload);
          
          if (!isPausedRef.current) {
            // Cap at 5000 lines in memory for React performance
            if (masterLinesRef.current.length > 5000) {
              masterLinesRef.current = masterLinesRef.current.slice(-5000);
            }
            // Trigger render
            setVisibleLines([...masterLinesRef.current]);
          }
        });

      } catch (err) {
        console.error("Failed to open log stream:", err);
      }
    };

    initStream();

    return () => {
      if (unlisten) unlisten();
      if (currentSessionId) {
        closeLogStream(currentSessionId).catch(console.error);
      }
    };
  }, [serverId, currentPm2Name]);

  // When unpausing, immediately catch up the view
  useEffect(() => {
    if (!isPaused) {
      setVisibleLines([...masterLinesRef.current]);
    }
  }, [isPaused]);

  // Auto-scroll logic
  useEffect(() => {
    if (isAtBottom && containerRef.current && !isPaused) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines, isAtBottom, isPaused]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 25;
    setIsAtBottom(atBottom);
  };

  const jumpToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setIsAtBottom(true);
    }
  };

  const handleClear = () => {
    masterLinesRef.current = [];
    setVisibleLines([]);
    toast.info('Log display buffer cleared');
  };

  // Compute live level statistics
  const levelCounts = useMemo(() => {
    const counts = { ALL: visibleLines.length, INFO: 0, WARN: 0, ERROR: 0, DEBUG: 0 };
    for (const l of visibleLines) {
      const lvl = l.level.toUpperCase();
      if (lvl === 'WARN') counts.WARN++;
      else if (lvl === 'ERROR') counts.ERROR++;
      else if (lvl === 'DEBUG') counts.DEBUG++;
      else counts.INFO++;
    }
    return counts;
  }, [visibleLines]);

  const filteredLines = useMemo(() => {
    return visibleLines.filter(line => {
      if (levelFilter !== 'ALL' && line.level.toUpperCase() !== levelFilter) return false;
      if (searchQuery) {
        const clean = stripAnsi(line.content).toLowerCase();
        if (!clean.includes(searchQuery.toLowerCase())) return false;
      }
      return true;
    });
  }, [visibleLines, levelFilter, searchQuery]);

  const handleCopy = () => {
    const text = filteredLines.map(l => stripAnsi(l.content)).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedBuffer(true);
    setTimeout(() => setCopiedBuffer(false), 2000);
    toast.success('Log buffer copied to clipboard');
  };

  const handleDownload = async () => {
    if (!sessionId) return;
    try {
      const content = await readLogSessionFile(sessionId);
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentPm2Name}_${new Date().toISOString().slice(0, 10)}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Log file downloaded');
    } catch (err) {
      console.error("Failed to download logs:", err);
      toast.error('Failed to download log file');
    }
  };

  return (
    <div className={`flex flex-col w-full bg-card border border-border rounded-2xl shadow-xl overflow-hidden ${
      isEmbedded ? 'h-[calc(100vh-280px)] min-h-[520px]' : 'h-[80vh]'
    }`}>
      {/* Top Header & Target Bar */}
      <div className="flex flex-wrap items-center justify-between p-3.5 border-b border-border bg-card gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <span className="font-semibold text-xs md:text-sm text-foreground">Live Telemetry Logs</span>
              <span className="hidden sm:inline-block ml-2 text-[10px] text-muted-foreground font-mono">Real-time PTY</span>
            </div>
          </div>

          {/* PM2 Process Target Selector */}
          <div className="flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-xl border border-border text-xs">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={currentPm2Name}
              onChange={(e) => setCurrentPm2Name(e.target.value)}
              className="bg-transparent text-foreground text-xs font-mono focus:outline-none cursor-pointer pr-1"
            >
              <option value="all" className="bg-card text-foreground">All Applications (pm2 logs --raw)</option>
              {processes?.map((proc) => (
                <option key={proc.pm_id} value={proc.name} className="bg-card text-foreground">
                  {proc.name} (PID: {proc.pm_id})
                </option>
              ))}
            </select>
          </div>
          
          {/* Pause / Resume Button */}
          <Button
            variant={isPaused ? "default" : "outline"}
            size="sm"
            onClick={() => setIsPaused(!isPaused)}
            className={`h-7 px-2.5 gap-1.5 text-xs border-border ${isPaused ? 'bg-amber-500 text-black hover:bg-amber-400' : ''}`}
          >
            {isPaused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5" />}
            {isPaused ? "Resume" : "Pause"}
          </Button>

          {/* View Mode Switcher (Beautified vs Raw) */}
          <div className="flex items-center p-0.5 rounded-lg bg-muted border border-border text-xs">
            <button
              onClick={() => setViewMode('beautified')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                viewMode === 'beautified' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Beautified view with syntax tokens, method badges, and structured layout"
            >
              <Sparkles className="h-3 w-3" />
              Beautified
            </button>
            <button
              onClick={() => setViewMode('raw')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                viewMode === 'raw' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Raw ANSI terminal view"
            >
              <Terminal className="h-3 w-3" />
              Terminal ANSI
            </button>
          </div>
        </div>

        {/* Search & Extra Controls */}
        <div className="flex items-center gap-2">
          {/* Quick Line Wrap and Line Number Toggles */}
          <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg border border-border">
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 text-xs ${wrapLines ? 'text-primary bg-background' : 'text-muted-foreground'}`}
              onClick={() => setWrapLines(!wrapLines)}
              title="Toggle line wrapping"
            >
              <WrapText className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 text-xs ${showLineNumbers ? 'text-primary bg-background' : 'text-muted-foreground'}`}
              onClick={() => setShowLineNumbers(!showLineNumbers)}
              title="Toggle line numbers"
            >
              <Hash className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="relative w-40 sm:w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search stream..."
              className="pl-8 h-7 text-xs bg-background border-input placeholder:text-muted-foreground text-foreground focus:border-primary"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {onClose && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Level Filters Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30 text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground uppercase font-mono mr-1">Filter:</span>
          {(['ALL', 'INFO', 'WARN', 'ERROR', 'DEBUG'] as const).map(lvl => (
            <Badge
              key={lvl}
              variant="outline"
              className={`cursor-pointer transition-all text-[11px] px-2.5 py-0.5 rounded-md ${
                levelFilter === lvl ? LEVEL_COLORS[lvl] : 'opacity-50 hover:opacity-100 border-border bg-card text-foreground'
              }`}
              onClick={() => setLevelFilter(lvl)}
            >
              {lvl} <span className="ml-1 text-[10px] opacity-70">({levelCounts[lvl]})</span>
            </Badge>
          ))}
        </div>

        <div className="text-[11px] text-muted-foreground font-mono hidden md:block">
          {filteredLines.length} / {visibleLines.length} lines shown
        </div>
      </div>

      {/* Body / Streaming Pane */}
      <div className="relative flex-1 min-h-0 bg-[#07090e]">
        {!sessionId && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground gap-2.5 z-10 bg-black/60 backdrop-blur-sm">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-xs font-mono">Attaching PTY stream channel...</span>
          </div>
        )}
        
        <div 
          ref={containerRef}
          onScroll={handleScroll}
          className={`h-full w-full overflow-y-auto ${wrapLines ? 'overflow-x-hidden' : 'overflow-x-auto'} p-3 sm:p-4 font-mono select-text`}
        >
          {filteredLines.length === 0 && sessionId && (
            <div className="text-zinc-600 text-xs py-16 text-center italic font-mono">
              {searchQuery ? `No log lines matching "${searchQuery}"` : `Awaiting live log output from ${currentPm2Name}...`}
            </div>
          )}

          {viewMode === 'beautified' ? (
            filteredLines.map((line, idx) => (
              <BeautifiedLogLine
                key={idx}
                raw={line.content}
                index={idx}
                searchQuery={searchQuery}
                wrapLines={wrapLines}
                showLineNumbers={showLineNumbers}
              />
            ))
          ) : (
            filteredLines.map((line, idx) => {
              const html = ansiToHtml(line.content);
              return (
                <div 
                  key={idx} 
                  className={`py-0.5 px-2 -mx-2 rounded hover:bg-white/[0.04] text-xs font-mono text-zinc-300 ${
                    wrapLines ? 'break-words whitespace-pre-wrap' : 'whitespace-nowrap'
                  }`}
                >
                  {showLineNumbers && (
                    <span className="text-[11px] text-zinc-600 select-none mr-3 inline-block w-8 text-right font-mono">
                      {idx + 1}
                    </span>
                  )}
                  {html ? (
                    <span dangerouslySetInnerHTML={{ __html: html }} />
                  ) : (
                    <span>{stripAnsi(line.content)}</span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {!isAtBottom && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
            <Button 
              size="sm" 
              variant="secondary" 
              className="shadow-2xl text-xs rounded-full h-7 px-3.5 bg-card border border-border text-foreground hover:bg-accent font-medium"
              onClick={jumpToBottom}
            >
              ↓ Jump to bottom
            </Button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between p-2.5 px-4 border-t border-border bg-card text-xs">
        <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Stream Active</span>
          {isPaused && <span className="text-amber-500 font-semibold">(PAUSED)</span>}
          <span className="text-muted-foreground/60">•</span>
          <span>{filteredLines.length} lines loaded</span>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1.5" onClick={handleClear}>
            <Trash2 className="h-3 w-3" /> Clear
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs border-border gap-1.5 text-foreground hover:bg-accent" onClick={handleCopy}>
            {copiedBuffer ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            {copiedBuffer ? "Copied" : "Copy Buffer"}
          </Button>
          <Button variant="default" size="sm" className="h-7 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-xs" onClick={handleDownload}>
            <Download className="h-3 w-3" /> Download
          </Button>
        </div>
      </div>
    </div>
  );
};
