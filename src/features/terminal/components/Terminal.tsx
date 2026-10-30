import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { RefreshCw, Trash2, Search, Copy, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { showIpcError, formatErrorMessage } from '@/lib/error-handler';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  serverId: string;
  onClose?: () => void;
  isActive?: boolean;
  onStatusChange?: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
}

interface TerminalDataEvent {
  pty_id: string;
  data_base64: string;
}

interface TerminalStatusEvent {
  pty_id: string;
}

export const Terminal: React.FC<TerminalProps> = ({ serverId, onClose: _onClose, isActive = true, onStatusChange }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const unlistenDataRef = useRef<UnlistenFn | null>(null);
  const unlistenClosedRef = useRef<UnlistenFn | null>(null);
  const unlistenDisconnectedRef = useRef<UnlistenFn | null>(null);

  const [fontSize, setFontSize] = useState<number>(14);
  const [searchQuery, setSearchQuery] = useState('');

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current) return;

    // 1. Create XTerm instance
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      theme: {
        background: '#0a0a0a',
        foreground: '#f8f8f2',
      },
    });
    xtermRef.current = term;

    // 2. Load Addons
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

    // 3. Open terminal in DOM container
    term.open(terminalRef.current);
    
    // Initial fit
    // Use a small timeout to ensure DOM has rendered its actual dimensions
    setTimeout(() => {
      if (xtermRef.current && fitAddonRef.current) {
        fitAddonRef.current.fit();
        startSession();
      }
    }, 10);

    const startSession = async () => {
      onStatusChange?.('reconnecting');
      try {
        const cols = term.cols || 80;
        const rows = term.rows || 24;

        // 4. Connect to backend PTY
        const ptyId = await invoke<string>('open_terminal', {
          serverId,
          cols,
          rows,
        });
        ptyIdRef.current = ptyId;
        onStatusChange?.('connected');

        // 5. Setup Event Listeners
        unlistenDataRef.current = await listen<TerminalDataEvent>(
          `terminal://data:${ptyId}`,
          (event) => {
            // Decode base64 to Uint8Array and write to terminal
            const binaryString = atob(event.payload.data_base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            term.write(bytes);
          }
        );

        const handleTeardown = () => {
          onStatusChange?.('disconnected');
          term.write('\r\n\x1b[31m[Session Closed]\x1b[0m\r\n');
          // We let the user see the disconnected state instead of auto-closing
        };

        unlistenClosedRef.current = await listen<TerminalStatusEvent>(
          `terminal://closed:${ptyId}`,
          handleTeardown
        );

        unlistenDisconnectedRef.current = await listen<TerminalStatusEvent>(
          `terminal://disconnected:${ptyId}`,
          handleTeardown
        );

        // 6. Pipe user input to backend
        term.onData(async (data) => {
          if (!ptyIdRef.current) return;
          // Encode string to utf-8 bytes
          const encoder = new TextEncoder();
          const bytes = encoder.encode(data);
          // Tauri IPC can pass byte arrays (Vec<u8> maps to numeric array in JS)
          await invoke('write_terminal', {
            sessionId: ptyIdRef.current,
            data: Array.from(bytes), 
          });
        });

      } catch (err) {
        showIpcError(err, { action: 'Start Terminal Session' });
        term.write(`\r\n\x1b[31mError starting session: ${formatErrorMessage(err)}\x1b[0m\r\n`);
      }
    };

    // Cleanup on unmount
    return () => {
      const ptyId = ptyIdRef.current;
      if (ptyId) {
        invoke('close_terminal', { sessionId: ptyId }).catch(() => {});
      }
      
      unlistenDataRef.current?.();
      unlistenClosedRef.current?.();
      unlistenDisconnectedRef.current?.();
      
      term.dispose();
    };
  }, [serverId]); // Only run once per serverId mount

  const doReconnect = useCallback(() => {
    if (!xtermRef.current) return;
    
    // Close old session
    if (ptyIdRef.current) {
      invoke('close_terminal', { sessionId: ptyIdRef.current }).catch(() => {});
    }
    unlistenDataRef.current?.();
    unlistenClosedRef.current?.();
    unlistenDisconnectedRef.current?.();
    ptyIdRef.current = null;

    // Reset terminal state
    xtermRef.current.clear();
    xtermRef.current.write('\x1b[2J\x1b[0;0H'); // full ANSI clear and cursor home
    onStatusChange?.('reconnecting');

    // Start fresh
    const startSession = async () => {
      try {
        const term = xtermRef.current!;
        const cols = term.cols || 80;
        const rows = term.rows || 24;

        const ptyId = await invoke<string>('open_terminal', { serverId, cols, rows });
        ptyIdRef.current = ptyId;
        onStatusChange?.('connected');

        unlistenDataRef.current = await listen<TerminalDataEvent>(
          `terminal://data:${ptyId}`,
          (event) => {
            const binaryString = atob(event.payload.data_base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            term.write(bytes);
          }
        );

        const handleTeardown = () => {
          onStatusChange?.('disconnected');
          term.write('\r\n\x1b[31m[Session Closed]\x1b[0m\r\n');
        };

        unlistenClosedRef.current = await listen<TerminalStatusEvent>(`terminal://closed:${ptyId}`, handleTeardown);
        unlistenDisconnectedRef.current = await listen<TerminalStatusEvent>(`terminal://disconnected:${ptyId}`, handleTeardown);

      } catch (err) {
        showIpcError(err, { action: 'Reconnect Terminal Session' });
        xtermRef.current?.write(`\r\n\x1b[31mError starting session: ${formatErrorMessage(err)}\x1b[0m\r\n`);
        onStatusChange?.('disconnected');
      }
    };
    startSession();
  }, [serverId, onStatusChange]);

  const doClear = useCallback(() => {
    xtermRef.current?.clear();
  }, []);

  const doCopy = useCallback(() => {
    if (xtermRef.current) {
      const selection = xtermRef.current.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
    }
  }, []);

  const changeFontSize = useCallback((delta: number) => {
    setFontSize(prev => {
      const next = Math.max(8, Math.min(32, prev + delta));
      if (xtermRef.current) {
        xtermRef.current.options.fontSize = next;
        // Trigger a fit timeout to let DOM settle
        setTimeout(() => fitAddonRef.current?.fit(), 10);
      }
      return next;
    });
  }, []);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery && searchAddonRef.current) {
      searchAddonRef.current.findNext(searchQuery);
    }
  }, [searchQuery]);

  // Handle Resize
  useEffect(() => {
    if (!isActive) return; // Don't try to fit hidden terminals

    const handleResize = () => {
      if (!fitAddonRef.current || !xtermRef.current || !ptyIdRef.current) return;
      try {
        fitAddonRef.current.fit();
        const term = xtermRef.current;
        invoke('resize_terminal', {
          sessionId: ptyIdRef.current,
          cols: term.cols || 80,
          rows: term.rows || 24,
        }).catch(() => {});
      } catch (e) {
        // fit() can throw if container is hidden/0px
      }
    };

    window.addEventListener('resize', handleResize);
    
    // Also trigger a fit when it becomes active again
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [isActive]);

  return (
    <div className="flex flex-col w-full h-full overflow-hidden bg-[#0a0a0a]">
      {/* Terminal Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-white/10 bg-black/40 text-muted-foreground text-xs">
        <Button variant="ghost" size="icon" onClick={doReconnect} title="Reconnect" className="h-7 w-7 text-muted-foreground hover:text-foreground">
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={doClear} title="Clear Terminal" className="h-7 w-7 text-muted-foreground hover:text-foreground">
          <Trash2 className="h-4 w-4" />
        </Button>
        
        <div className="w-px h-4 bg-white/10 mx-1" />
        
        <Button variant="ghost" size="icon" onClick={doCopy} title="Copy Selection" className="h-7 w-7 text-muted-foreground hover:text-foreground">
          <Copy className="h-4 w-4" />
        </Button>
        
        <div className="w-px h-4 bg-white/10 mx-1" />

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => changeFontSize(-1)} title="Decrease Font Size" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Type className="h-3 w-3" />
          </Button>
          <span className="min-w-[20px] text-center select-none">{fontSize}</span>
          <Button variant="ghost" size="icon" onClick={() => changeFontSize(1)} title="Increase Font Size" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Type className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1" />

        <form onSubmit={handleSearch} className="flex items-center relative">
          <Search className="h-3.5 w-3.5 absolute left-2 text-muted-foreground" />
          <Input 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search output..." 
            className="h-7 w-48 pl-7 text-xs bg-black/50 border-white/10"
          />
        </form>
      </div>

      {/* Terminal Viewport */}
      <div 
        className="flex-1 w-full relative overflow-hidden" 
        ref={terminalRef}
      />
    </div>
  );
};
