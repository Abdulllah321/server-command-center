import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, 
  Plus, 
  Lock, 
  Unlock, 
  Sun, 
  Moon, 
  Fingerprint, 
  Loader2, 
  Menu,
  Server
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/use-ui-store';
import { useVaultStore } from '@/stores/use-vault-store';
import { useUiStore } from '@/stores/ui-store';
import { useTheme } from 'next-themes';
import { checkWindowsHello, unlockVaultWithWindowsHello } from '@/lib/tauri-client';
import { toast } from 'sonner';

interface TopBarProps {
  onSearchClick?: () => void;
}

export const TopBar = ({ onSearchClick }: TopBarProps) => {
  const navigate = useNavigate();
  const { setServerModalOpen } = useUIStore();
  const { toggleMobileMenu } = useUiStore();
  const { isUnlocked, sessionTimeout, lastActivity, lock, unlock } = useVaultStore();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [isBiometricUnlocking, setIsBiometricUnlocking] = useState(false);

  useEffect(() => {
    setMounted(true);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    checkWindowsHello()
      .then((st) => setBiometricsEnabled(st.enabled))
      .catch(() => setBiometricsEnabled(false));
  }, [isUnlocked]);

  const handleBiometricUnlock = async () => {
    try {
      setIsBiometricUnlocking(true);
      const pw = await unlockVaultWithWindowsHello();
      unlock(pw);
      toast.success('Vault unlocked with biometric verification');
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Biometric verification failed';
      toast.error(msg);
    } finally {
      setIsBiometricUnlocking(false);
    }
  };

  const calculateRemaining = () => {
    if (!isUnlocked || sessionTimeout === 0 || lastActivity === 0) return null;
    const timeoutMs = sessionTimeout * 60 * 1000;
    const remainingMs = Math.max(0, timeoutMs - (now - lastActivity));
    const totalSec = Math.floor(remainingMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const remaining = calculateRemaining();

  return (
    <header className="border-b border-border bg-card/75 backdrop-blur-md shrink-0 transition-all select-none pt-[max(env(safe-area-inset-top,0px),0.625rem)] md:pt-0">
      <div className="h-13 md:h-14 px-3 sm:px-6 flex items-center justify-between gap-2">
        {/* Mobile View: Brand + Menu */}
        <div className="flex md:hidden items-center gap-2 min-w-0">
          <button
            onClick={toggleMobileMenu}
            title="Open Server Groups"
            className="p-1.5 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all shrink-0 cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-1.5 min-w-0">
            <div className="p-1 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
              <Server className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="font-bold text-sm tracking-tight text-foreground truncate">
              Command Center
            </span>
          </div>
        </div>

        {/* Desktop View: Search Input */}
        <div className="hidden md:flex flex-1 items-center min-w-0">
          <button
            className="relative w-full max-w-sm lg:max-w-md text-left truncate cursor-pointer"
            onClick={onSearchClick}
          >
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <div className="w-full bg-background/80 border border-input rounded-xl pl-9 pr-4 py-1.5 text-xs text-muted-foreground hover:border-primary/50 transition-colors truncate flex items-center justify-between">
              <span>Search servers, apps, commands...</span>
              <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                ⌘K
              </kbd>
            </div>
          </button>
        </div>
        
        {/* Right Action Cluster */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Mobile Search Button */}
          <button
            onClick={onSearchClick}
            title="Search (⌘K)"
            className="md:hidden flex items-center justify-center w-8 h-8 rounded-xl border border-border bg-card/60 hover:bg-muted active:scale-95 text-muted-foreground hover:text-foreground transition-all cursor-pointer shrink-0"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Theme Toggle */}
          {mounted && (
            <button
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              title={`Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} mode`}
              className="flex items-center justify-center w-8 h-8 rounded-xl border border-border bg-card/60 hover:bg-muted active:scale-95 text-muted-foreground hover:text-foreground transition-all cursor-pointer shrink-0"
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-indigo-500" />
              )}
            </button>
          )}

          {/* Vault Status Indicator */}
          <div className="flex items-center shrink-0">
            {isUnlocked ? (
              <div className="flex items-center bg-emerald-500/10 border border-emerald-500/25 text-emerald-500 dark:text-emerald-400 rounded-xl px-2 sm:px-2.5 py-1 text-xs gap-1.5 shadow-xs">
                <Unlock className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline font-medium">Vault Unlocked</span>
                {remaining && (
                  <span className="font-mono text-[10px] text-emerald-500/90 dark:text-emerald-400/90 bg-emerald-500/15 px-1.5 py-0.2 rounded">
                    {remaining}
                  </span>
                )}
                <button
                  onClick={() => lock(false)}
                  title="Lock Vault Session"
                  className="text-[11px] text-emerald-600 dark:text-emerald-300 hover:underline font-semibold ml-0.5 cursor-pointer"
                >
                  Lock
                </button>
              </div>
            ) : biometricsEnabled ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleBiometricUnlock}
                  disabled={isBiometricUnlocking}
                  title="Unlock Vault with Device Biometrics"
                  className="flex items-center bg-primary/10 hover:bg-primary/20 border border-primary/25 text-primary rounded-xl px-2 sm:px-2.5 py-1 text-xs gap-1.5 transition-all active:scale-95 cursor-pointer font-medium"
                >
                  {isBiometricUnlocking ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Fingerprint className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden sm:inline">Unlock Vault</span>
                  <span className="sm:hidden text-[11px]">Unlock</span>
                </button>
                <button
                  onClick={() => navigate('/settings?tab=vault')}
                  title="Vault Locked. Open Vault Settings"
                  className="flex items-center bg-muted/60 hover:bg-muted border border-border text-muted-foreground hover:text-foreground rounded-xl p-1.5 text-xs transition-colors cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => navigate('/settings?tab=vault')}
                title="Vault Locked. Open Vault Settings"
                className="flex items-center bg-muted/60 hover:bg-muted border border-border text-muted-foreground hover:text-foreground rounded-xl px-2 sm:px-2.5 py-1 text-xs gap-1.5 transition-colors cursor-pointer active:scale-95"
              >
                <Lock className="w-3.5 h-3.5 text-amber-500" />
                <span className="hidden sm:inline">Vault Locked</span>
              </button>
            )}
          </div>

          {/* Primary Add Server Button */}
          <Button 
            size="sm" 
            className="gap-1.5 h-8 px-2.5 sm:px-3 text-xs shrink-0 rounded-xl font-semibold shadow-xs" 
            onClick={() => setServerModalOpen(true)}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Server</span>
          </Button>
        </div>
      </div>
    </header>
  );
};
