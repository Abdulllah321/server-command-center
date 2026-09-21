import { create } from 'zustand';

interface VaultState {
  isUnlocked: boolean;
  masterPassword?: string;
  sessionTimeout: number; // in minutes
  
  unlock: (password: string) => void;
  lock: () => void;
  setSessionTimeout: (minutes: number) => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  isUnlocked: false,
  masterPassword: undefined,
  sessionTimeout: 30, // default 30 minutes
  
  unlock: (password) => set({ isUnlocked: true, masterPassword: password }),
  lock: () => set({ isUnlocked: false, masterPassword: undefined }),
  setSessionTimeout: (minutes) => set({ sessionTimeout: minutes }),
}));
