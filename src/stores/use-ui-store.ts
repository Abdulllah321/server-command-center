import { create } from 'zustand';

interface UIState {
  isServerModalOpen: boolean;
  setServerModalOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isServerModalOpen: false,
  setServerModalOpen: (open) => set({ isServerModalOpen: open }),
}));
