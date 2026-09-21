import { create } from 'zustand';

interface UiState {
  activeServerId: string | null;
  sidebarCollapsed: boolean;
  setActiveServerId: (id: string | null) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeServerId: null,
  sidebarCollapsed: false,
  setActiveServerId: (id) => set({ activeServerId: id }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
}));
