import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast } from 'sonner';

interface VaultState {
  isUnlocked: boolean;
  masterPassword?: string;
  sessionTimeout: number; // in minutes: 0 (never), 1, 5, 15, 30, 60, 240
  lastActivity: number; // timestamp in ms
  autoLockedAt: number | null; // timestamp when auto-lock occurred
  
  unlock: (password: string) => void;
  lock: (isAutoLock?: boolean) => void;
  clearAutoLockNotice: () => void;
  setSessionTimeout: (minutes: number) => void;
  pingVaultActivity: () => void;
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      isUnlocked: false,
      masterPassword: undefined,
      sessionTimeout: 30, // default 30 minutes
      lastActivity: 0,
      autoLockedAt: null,
      
      unlock: (password: string) => {
        set({
          isUnlocked: true,
          masterPassword: password,
          lastActivity: Date.now(),
          autoLockedAt: null,
        });
      },

      lock: (isAutoLock = false) => {
        const wasUnlocked = get().isUnlocked;
        set({
          isUnlocked: false,
          masterPassword: undefined,
          lastActivity: 0,
          autoLockedAt: isAutoLock ? Date.now() : null,
        });

        if (isAutoLock && wasUnlocked) {
          toast.info('Vault auto-locked due to inactivity', {
            description: 'Master password will be required for secure vault operations.',
          });
        }
      },

      clearAutoLockNotice: () => set({ autoLockedAt: null }),

      setSessionTimeout: (minutes: number) => {
        set({ sessionTimeout: minutes });
        if (get().isUnlocked) {
          set({ lastActivity: Date.now() });
        }
      },

      pingVaultActivity: () => {
        if (get().isUnlocked) {
          set({ lastActivity: Date.now() });
        }
      },
    }),
    {
      name: 'scc_vault_preferences',
      // SECURITY CONSTRAINT: Only persist the sessionTimeout setting.
      // Master password and unlock state MUST NEVER be saved to persistent storage.
      partialize: (state) => ({
        sessionTimeout: state.sessionTimeout,
      }),
    }
  )
);

// High-resolution background auto-lock ticker (runs every 1 second)
if (typeof window !== 'undefined') {
  setInterval(() => {
    const state = useVaultStore.getState();
    if (state.isUnlocked && state.sessionTimeout > 0 && state.lastActivity > 0) {
      const timeoutMs = state.sessionTimeout * 60 * 1000;
      const elapsed = Date.now() - state.lastActivity;
      if (elapsed >= timeoutMs) {
        state.lock(true);
      }
    }
  }, 1000);
}

