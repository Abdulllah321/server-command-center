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
  Menu 
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
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [helloEnabled, setHelloEnabled] = useState(false);
  const [isHelloUnlocking, setIsHelloUnlocking] = useState(false);

  useEffect(() => {
    setMounted(true);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    checkWindowsHello()
      .then((st) => setHelloEnabled(st.enabled))
      .catch(() => setHelloEnabled(false));
  }, [isUnlocked]);

  const handleHelloUnlock = async () => {
    try {
      setIsHelloUnlocking(true);
      const pw = await unlockVaultWithWindowsHello();
      unlock(pw);
      toast.success('Vault unlocked with Windows Hello biometric verification');
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Windows Hello verification failed';
      toast.error(msg);
    } finally {
      setIsHelloUnlocking(false);
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
    <header className="h-14 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between px-3 sm:px-6 shrink-0 gap-2">
      {/* Mobile Drawer Hamburger & Search */}
      <div className="flex-1 flex items-center min-w-0">
        <button
          onClick={toggleMobileMenu}
          title="Open Navigation"
          className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mr-2 shrink-0 cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>

        <button
          className="relative w-full max-w-xs sm:max-w-sm md:max-w-md text-left truncate"
          onClick={onSearchClick}
        >
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <div className="w-full bg-background border border-input rounded-xl pl-9 pr-3 sm:pr-4 py-1.5 text-xs sm:text-sm text-muted-foreground hover:border-primary/50 transition-colors truncate">
            <span className="hidden sm:inline">Search servers, apps, commands...</span>
            <span className="sm:hidden">Search...</span>
            <kbd className="ml-2 pointer-events-none hidden md:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </div>
        </button>
      </div>
      
      {/* Action buttons (Theme, Vault, New Server) */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {/* Quick Theme Toggle */}
        {mounted && (
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            title={`Current theme: ${theme}. Click to switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} mode.`}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-card/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-indigo-500" />
            )}
          </button>
        )}

        {/* Vault Status Pill */}
        <div className="flex items-center shrink-0">
          {isUnlocked ? (
            <div className="flex items-center bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg px-2 sm:px-2.5 py-1 text-xs gap-1.5 sm:gap-2">
              <span className="flex items-center gap-1 font-medium">
                <Unlock className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Vault Unlocked</span>
              </span>
              {remaining && (
                <span className="font-mono text-[10px] sm:text-[11px] text-emerald-400/80 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                  {remaining}
                </span>
              )}
              <button
                onClick={() => lock(false)}
                title="Lock Vault Now"
                className="text-[10px] sm:text-[11px] text-emerald-300 hover:text-white underline ml-0.5 cursor-pointer"
              >
                Lock
              </button>
            </div>
          ) : helloEnabled ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleHelloUnlock}
                disabled={isHelloUnlocking}
                title="Click to unlock Vault instantly with Windows Hello Biometrics"
                className="flex items-center bg-primary/15 hover:bg-primary/25 border border-primary/30 text-primary rounded-lg px-2 sm:px-2.5 py-1 text-xs gap-1 sm:gap-1.5 transition-colors cursor-pointer font-medium"
              >
                {isHelloUnlocking ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Fingerprint className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">Unlock Vault</span>
                <span className="sm:hidden">Unlock</span>
              </button>
              <button
                onClick={() => navigate('/settings')}
                title="Vault is locked. View Settings & Vault."
                className="flex items-center bg-muted/60 hover:bg-muted border border-border text-muted-foreground hover:text-foreground rounded-lg p-1.5 text-xs transition-colors cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => navigate('/settings')}
              title="Vault is locked. Click to view Settings & Vault."
              className="flex items-center bg-muted/60 hover:bg-muted border border-border text-muted-foreground hover:text-foreground rounded-lg px-2 sm:px-2.5 py-1 text-xs gap-1.5 transition-colors cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="hidden sm:inline">Vault Locked</span>
            </button>
          )}
        </div>

        {/* Add Server Button */}
        <Button 
          size="sm" 
          className="gap-1.5 h-8 px-2.5 sm:px-3 text-xs shrink-0" 
          onClick={() => setServerModalOpen(true)}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Server</span>
        </Button>
      </div>
    </header>
  );
};
