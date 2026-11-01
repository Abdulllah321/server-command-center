import React from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';

interface MobileTerminalToolbarProps {
  onSendKey: (key: string) => void;
  className?: string;
}

export const MobileTerminalToolbar: React.FC<MobileTerminalToolbarProps> = ({ onSendKey, className = '' }) => {
  const keys = [
    { label: 'ESC', key: '\x1b', title: 'Escape' },
    { label: 'TAB', key: '\t', title: 'Tab Autocomplete' },
    { label: '^C', key: '\x03', title: 'SIGINT Interrupt (Ctrl+C)', highlight: true },
    { label: '^D', key: '\x04', title: 'EOF / Exit (Ctrl+D)' },
    { label: '↑', key: '\x1b[A', title: 'Previous Command (Up Arrow)' },
    { label: '↓', key: '\x1b[B', title: 'Next Command (Down Arrow)' },
    { label: '←', key: '\x1b[D', title: 'Cursor Left' },
    { label: '→', key: '\x1b[C', title: 'Cursor Right' },
    { label: '|', key: '|', title: 'Pipe' },
    { label: '~', key: '~', title: 'Home directory' },
    { label: '/', key: '/', title: 'Slash' },
    { label: '-', key: '-', title: 'Dash' },
    { label: 'Enter', key: '\r', title: 'Return' },
  ];

  return (
    <div 
      className={`w-full bg-zinc-900/95 border-t border-zinc-800/80 px-1.5 py-1 flex items-center gap-1 overflow-x-auto no-scrollbar shadow-inner select-none shrink-0 ${className}`}
    >
      <div className="flex items-center gap-1 shrink-0 text-zinc-400 pl-1 pr-1.5 border-r border-zinc-800 text-[10px] font-mono">
        <TerminalIcon className="w-3 h-3 text-emerald-400" />
        <span className="hidden xs:inline">KEYS</span>
      </div>

      {keys.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => onSendKey(item.key)}
          title={item.title}
          className={`h-7 min-w-[34px] px-2 rounded font-mono text-xs font-semibold flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0 ${
            item.highlight
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30'
              : 'bg-zinc-800 text-zinc-200 border border-zinc-700/60 hover:bg-zinc-700/80 hover:text-white'
          }`}
        >
          {item.label}
        </button>
      ))}

      {/* Quick Common Commands */}
      <button
        type="button"
        onClick={() => onSendKey('clear\r')}
        title="Clear screen"
        className="h-7 px-2 rounded font-mono text-xs bg-zinc-800 text-zinc-400 border border-zinc-700/60 hover:text-white shrink-0"
      >
        clear
      </button>
      <button
        type="button"
        onClick={() => onSendKey('ls -la\r')}
        title="List files"
        className="h-7 px-2 rounded font-mono text-xs bg-zinc-800 text-zinc-400 border border-zinc-700/60 hover:text-white shrink-0"
      >
        ls -la
      </button>
    </div>
  );
};
