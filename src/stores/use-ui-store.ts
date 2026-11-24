import { create } from 'zustand';

interface UIState {
  isServerModalOpen: boolean;
  setServerModalOpen: (open: boolean) => void;
  isProvisionModalOpen: boolean;
  setProvisionModalOpen: (open: boolean) => void;
  provisionTargetServerId: string | null;
  openProvisionModal: (serverId?: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isServerModalOpen: false,
  setServerModalOpen: (open) => set({ isServerModalOpen: open }),
  isProvisionModalOpen: false,
  setProvisionModalOpen: (open) => set({ isProvisionModalOpen: open }),
  provisionTargetServerId: null,
  openProvisionModal: (serverId) => set({ isProvisionModalOpen: true, provisionTargetServerId: serverId || null }),
}));
