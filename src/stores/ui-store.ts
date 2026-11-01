import { create } from 'zustand';

interface UiState {
  activeServerId: string | null;
  sidebarCollapsed: boolean;
  mobileMenuOpen: boolean;
  setActiveServerId: (id: string | null) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleMobileMenu: () => void;
  setMobileMenuOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeServerId: null,
  sidebarCollapsed: false,
  mobileMenuOpen: false,
  setActiveServerId: (id) => set({ activeServerId: id }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleMobileMenu: () => set((state) => ({ mobileMenuOpen: !state.mobileMenuOpen })),
  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
}));
