import { create } from 'zustand';

export type WorkspaceTabType = 'dashboard' | 'server' | 'group' | 'activity' | 'settings' | 'fleet';

export interface WorkspaceTab {
  id: string;
  title: string;
  type: WorkspaceTabType;
  path: string;
  serverId?: string;
  groupId?: string;
  closable: boolean;
  isPinned?: boolean;
  status?: 'online' | 'offline' | 'busy';
}

export type OpenTabInput = {
  id?: string;
  title: string;
  type: WorkspaceTabType;
  path: string;
  serverId?: string;
  groupId?: string;
  closable?: boolean;
  isPinned?: boolean;
  status?: 'online' | 'offline' | 'busy';
};

interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activeTabId: string;
  openTab: (tab: OpenTabInput) => string;
  closeTab: (tabId: string) => string | null;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  updateTabStatus: (tabId: string, status: 'online' | 'offline' | 'busy') => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

const DASHBOARD_TAB: WorkspaceTab = {
  id: 'tab-dashboard',
  title: 'Dashboard',
  type: 'dashboard',
  path: '/',
  closable: false,
  isPinned: true,
};

export const useWorkspaceTabsStore = create<WorkspaceTabsState>((set, get) => ({
  tabs: [DASHBOARD_TAB],
  activeTabId: DASHBOARD_TAB.id,

  openTab: (input) => {
    const { tabs } = get();
    // Resolve deterministic tab ID:
    // Servers use `server-${serverId}`
    // Groups use `group-${groupId}`
    // Dashboard uses `tab-dashboard`
    // Others use `tab-${type}`
    const tabId = input.id || (
      input.type === 'server' && input.serverId ? `server-${input.serverId}` :
      input.type === 'group' && input.groupId ? `group-${input.groupId}` :
      input.type === 'dashboard' ? 'tab-dashboard' :
      `tab-${input.type}`
    );

    const existingIndex = tabs.findIndex(t => t.id === tabId);

    if (existingIndex !== -1) {
      // Tab is already open: update title if better title provided, and activate it
      set((state) => {
        const updatedTabs = [...state.tabs];
        if (input.title && input.title !== updatedTabs[existingIndex].title) {
          updatedTabs[existingIndex] = {
            ...updatedTabs[existingIndex],
            title: input.title,
            path: input.path || updatedTabs[existingIndex].path,
          };
        }
        return {
          tabs: updatedTabs,
          activeTabId: tabId,
        };
      });
      return tabId;
    }

    // New tab
    const newTab: WorkspaceTab = {
      id: tabId,
      title: input.title || 'Tab',
      type: input.type,
      path: input.path || '/',
      serverId: input.serverId,
      groupId: input.groupId,
      closable: input.closable !== undefined ? input.closable : (input.type !== 'dashboard'),
      isPinned: input.isPinned || false,
      status: input.status,
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
    }));

    return tabId;
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const tabToClose = tabs.find(t => t.id === tabId);
    if (!tabToClose || !tabToClose.closable) return null;

    const index = tabs.findIndex(t => t.id === tabId);
    const newTabs = tabs.filter(t => t.id !== tabId);

    let nextActiveId = activeTabId;
    if (activeTabId === tabId) {
      // Pick adjacent tab to the left, or to the right, or fallback to first
      const nextIndex = Math.max(0, index - 1);
      nextActiveId = newTabs[nextIndex]?.id || DASHBOARD_TAB.id;
    }

    set({
      tabs: newTabs.length > 0 ? newTabs : [DASHBOARD_TAB],
      activeTabId: nextActiveId,
    });

    return nextActiveId;
  },

  closeOtherTabs: (tabId) => {
    set((state) => ({
      tabs: state.tabs.filter(t => t.id === tabId || !t.closable),
      activeTabId: tabId,
    }));
  },

  closeTabsToRight: (tabId) => {
    set((state) => {
      const index = state.tabs.findIndex(t => t.id === tabId);
      if (index === -1) return state;

      const remainingTabs = state.tabs.filter((t, i) => i <= index || !t.closable);
      const isCurrentActiveClosed = !remainingTabs.some(t => t.id === state.activeTabId);

      return {
        tabs: remainingTabs,
        activeTabId: isCurrentActiveClosed ? tabId : state.activeTabId,
      };
    });
  },

  setActiveTab: (tabId) => {
    const { tabs } = get();
    if (tabs.some(t => t.id === tabId)) {
      set({ activeTabId: tabId });
    }
  },

  updateTabTitle: (tabId, title) => {
    if (!title) return;
    set((state) => ({
      tabs: state.tabs.map(t => t.id === tabId ? { ...t, title } : t),
    }));
  },

  updateTabStatus: (tabId, status) => {
    set((state) => ({
      tabs: state.tabs.map(t => t.id === tabId ? { ...t, status } : t),
    }));
  },

  reorderTabs: (fromIndex, toIndex) => {
    set((state) => {
      if (
        fromIndex < 0 || 
        fromIndex >= state.tabs.length || 
        toIndex < 0 || 
        toIndex >= state.tabs.length
      ) {
        return state;
      }
      const newTabs = [...state.tabs];
      const [moved] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, moved);
      return { tabs: newTabs };
    });
  },
}));

