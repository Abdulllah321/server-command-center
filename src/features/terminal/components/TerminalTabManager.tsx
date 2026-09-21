import React, { useState, useEffect } from 'react';
import { Terminal } from './Terminal';
import { Plus, X, TerminalSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Tab {
  id: string;
  title: string;
  status: 'connected' | 'reconnecting' | 'disconnected';
}

interface TerminalTabManagerProps {
  serverId: string;
}

export const TerminalTabManager: React.FC<TerminalTabManagerProps> = ({ serverId }) => {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Initialize first tab automatically
  useEffect(() => {
    if (tabs.length === 0) {
      addTab();
    }
  }, [serverId]);

  const addTab = () => {
    const newId = crypto.randomUUID();
    const newTitle = `Terminal ${tabs.length + 1}`;
    setTabs(prev => [...prev, { id: newId, title: newTitle, status: 'reconnecting' }]);
    setActiveTabId(newId);
  };

  const updateTabStatus = (id: string, status: 'connected' | 'reconnecting' | 'disconnected') => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // prevent clicking tab itself
    
    setTabs(prev => {
      const filtered = prev.filter(t => t.id !== id);
      if (filtered.length > 0 && activeTabId === id) {
        // If we closed the active tab, fallback to the last tab
        setActiveTabId(filtered[filtered.length - 1].id);
      }
      return filtered;
    });
  };

  return (
    <div className="flex flex-col w-full h-full bg-background border-l border-border">
      {/* Tab Bar */}
      <div className="flex items-center border-b border-border bg-muted/50 overflow-x-auto no-scrollbar">
        {tabs.map(tab => (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`
              group flex items-center gap-2 px-4 py-2 border-r border-border cursor-pointer select-none
              transition-colors hover:bg-muted min-w-[140px]
              ${activeTabId === tab.id ? 'bg-background border-b-2 border-b-primary font-medium' : 'text-muted-foreground'}
            `}
          >
            <div className={`w-2 h-2 rounded-full ${
              tab.status === 'connected' ? 'bg-green-500' :
              tab.status === 'reconnecting' ? 'bg-yellow-500 animate-pulse' :
              'bg-red-500'
            }`} />
            <TerminalSquare className="w-4 h-4" />
            <span className="flex-1 text-sm truncate">{tab.title}</span>
            <button
              onClick={(e) => closeTab(tab.id, e)}
              className={`p-0.5 rounded-md hover:bg-muted-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity ${activeTabId === tab.id ? 'opacity-100' : ''}`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        
        <div className="px-2">
          <Button variant="ghost" size="icon" onClick={addTab} className="h-8 w-8 text-muted-foreground">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Terminal Viewports */}
      <div className="flex-1 relative bg-[#0a0a0a]">
        {tabs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
            <TerminalSquare className="w-12 h-12 opacity-20" />
            <p>No terminal sessions open.</p>
            <Button variant="secondary" onClick={addTab}>Open Terminal</Button>
          </div>
        ) : (
          tabs.map(tab => (
            <div
              key={tab.id}
              className={`absolute inset-0 p-2 ${activeTabId === tab.id ? 'block' : 'hidden'}`}
            >
              <Terminal 
                serverId={serverId} 
                isActive={activeTabId === tab.id}
                onStatusChange={(status) => updateTabStatus(tab.id, status)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
};
