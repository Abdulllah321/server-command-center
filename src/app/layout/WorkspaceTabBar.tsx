import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Home, 
  Server, 
  FolderTree, 
  History, 
  Settings, 
  X, 
  Plus, 
  ChevronRight,
  Layers
} from 'lucide-react';
import { useWorkspaceTabsStore, type WorkspaceTab } from '@/stores/use-workspace-tabs-store';
import { cn } from 'cn';

interface ContextMenuState {
  x: number;
  y: number;
  tab: WorkspaceTab;
}

export const WorkspaceTabBar: React.FC = () => {
  const navigate = useNavigate();
  const tabs = useWorkspaceTabsStore((s) => s.tabs);
  const activeTabId = useWorkspaceTabsStore((s) => s.activeTabId);
  const setActiveTab = useWorkspaceTabsStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceTabsStore((s) => s.closeTab);
  const closeOtherTabs = useWorkspaceTabsStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useWorkspaceTabsStore((s) => s.closeTabsToRight);
  const openTab = useWorkspaceTabsStore((s) => s.openTab);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click or escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  // Keyboard navigation: Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1..9, Ctrl+W
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (!isCtrlOrMeta) return;

      const target = e.target as HTMLElement | null;
      const isInput = target && (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable ||
        target.closest('.xterm') !== null
      );

      // Ctrl + W: Close active tab (skip if inside terminal or text input)
      if (e.key === 'w' || e.key === 'W') {
        if (!isInput) {
          e.preventDefault();
          const activeTab = tabs.find(t => t.id === activeTabId);
          if (activeTab && activeTab.closable) {
            handleCloseTab(activeTab.id);
          }
        }
      }

      // Ctrl + Tab / Ctrl + Shift + Tab: Cycle tabs
      if (e.key === 'Tab') {
        e.preventDefault();
        if (tabs.length <= 1) return;
        const currentIndex = tabs.findIndex(t => t.id === activeTabId);
        if (currentIndex === -1) return;

        const nextIndex = e.shiftKey
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : (currentIndex + 1) % tabs.length;

        const targetTab = tabs[nextIndex];
        if (targetTab) {
          handleSelectTab(targetTab);
        }
      }

      // Ctrl + 1..8: Switch to tab by index; Ctrl + 9: Switch to last tab
      if (!e.shiftKey && !e.altKey && !isInput && /^[1-9]$/.test(e.key)) {
        const num = parseInt(e.key, 10);
        let targetIndex = -1;
        if (num === 9) {
          targetIndex = tabs.length - 1;
        } else {
          targetIndex = num - 1;
        }

        if (targetIndex >= 0 && targetIndex < tabs.length) {
          e.preventDefault();
          const targetTab = tabs[targetIndex];
          if (targetTab) {
            handleSelectTab(targetTab);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId]);

  const handleSelectTab = (tab: WorkspaceTab) => {
    setActiveTab(tab.id);
    navigate(tab.path);
  };

  const handleCloseTab = (tabId: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const currentActive = activeTabId;
    const nextActiveId = closeTab(tabId);
    if (nextActiveId && nextActiveId !== currentActive) {
      const nextTab = useWorkspaceTabsStore.getState().tabs.find(t => t.id === nextActiveId);
      if (nextTab) {
        navigate(nextTab.path);
      }
    }
    setContextMenu(null);
  };

  const handleMiddleClick = (tab: WorkspaceTab, e: React.MouseEvent) => {
    if (e.button === 1 && tab.closable) {
      e.preventDefault();
      handleCloseTab(tab.id, e);
    }
  };

  const handleContextMenu = (tab: WorkspaceTab, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      tab,
    });
  };

  const handleNewTab = () => {
    const dashId = openTab({
      id: 'tab-dashboard',
      title: 'Dashboard',
      type: 'dashboard',
      path: '/',
      closable: false,
      isPinned: true,
    });
    setActiveTab(dashId);
    navigate('/');
  };

  const renderTabIcon = (tab: WorkspaceTab) => {
    switch (tab.type) {
      case 'dashboard':
        return <Home className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />;
      case 'server':
        return (
          <div className="relative shrink-0 flex items-center justify-center">
            <Server className="w-3.5 h-3.5 text-primary" />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 ring-1 ring-background" />
          </div>
        );
      case 'group':
        return <FolderTree className="w-3.5 h-3.5 shrink-0 text-amber-500" />;
      case 'activity':
        return <History className="w-3.5 h-3.5 shrink-0 text-sky-500" />;
      case 'settings':
        return <Settings className="w-3.5 h-3.5 shrink-0 text-slate-400" />;
      default:
        return <Layers className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />;
    }
  };

  return (
    <div className="relative z-20 flex items-center h-10 px-2 bg-muted/40 border-b border-border/80 select-none backdrop-blur-xs">
      {/* Scrollable Tabs Track */}
      <div 
        ref={tabListRef}
        className="flex-1 flex items-center h-full gap-1 overflow-x-auto no-scrollbar scroll-smooth"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => handleSelectTab(tab)}
              onAuxClick={(e) => handleMiddleClick(tab, e)}
              onContextMenu={(e) => handleContextMenu(tab, e)}
              title={`${tab.title} (${tab.path})`}
              className={cn(
                "group relative flex items-center gap-2 h-[34px] px-3.5 rounded-t-lg cursor-pointer transition-all duration-150 border-t border-x text-xs max-w-[200px] min-w-[110px]",
                isActive
                  ? "bg-card text-foreground font-medium shadow-xs border-border/80 border-t-2 border-t-primary border-b-transparent -mb-[1px] z-10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/70 border-transparent"
              )}
            >
              {renderTabIcon(tab)}
              <span className="flex-1 truncate tracking-tight font-medium">
                {tab.title}
              </span>

              {tab.closable && (
                <button
                  type="button"
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  title="Close tab (Middle click or Ctrl+W)"
                  className={cn(
                    "p-0.5 rounded-md hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground transition-opacity shrink-0",
                    isActive ? "opacity-70 group-hover:opacity-100" : "opacity-0 group-hover:opacity-80"
                  )}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}

        {/* Plus / New Tab button */}
        <button
          type="button"
          onClick={handleNewTab}
          title="Open Dashboard / Switcher"
          className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors ml-1 cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Edge/Chrome Right-Click Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            top: `${Math.min(contextMenu.y, window.innerHeight - 150)}px`,
            left: `${Math.min(contextMenu.x, window.innerWidth - 180)}px`,
          }}
          className="z-50 min-w-[170px] bg-popover/95 text-popover-foreground border border-border rounded-lg shadow-lg p-1 text-xs backdrop-blur-md animate-in fade-in-50 zoom-in-95 duration-100 select-none"
        >
          {contextMenu.tab.closable && (
            <button
              onClick={(e) => handleCloseTab(contextMenu.tab.id, e)}
              className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-muted flex items-center justify-between text-destructive hover:text-destructive transition-colors cursor-pointer"
            >
              <span>Close Tab</span>
              <span className="text-[10px] text-muted-foreground">Ctrl+W</span>
            </button>
          )}

          <button
            onClick={() => {
              closeOtherTabs(contextMenu.tab.id);
              handleSelectTab(contextMenu.tab);
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-muted flex items-center justify-between transition-colors cursor-pointer"
          >
            <span>Close Other Tabs</span>
          </button>

          <button
            onClick={() => {
              closeTabsToRight(contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-muted flex items-center justify-between transition-colors cursor-pointer"
          >
            <span>Close Tabs to Right</span>
          </button>

          <div className="h-px bg-border my-1" />

          <button
            onClick={() => {
              handleSelectTab(contextMenu.tab);
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-muted flex items-center justify-between transition-colors cursor-pointer"
          >
            <span>Activate Tab</span>
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          </button>
        </div>
      )}
    </div>
  );
};

