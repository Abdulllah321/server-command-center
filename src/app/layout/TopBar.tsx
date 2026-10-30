import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/use-ui-store';
import { useVaultStore } from '@/stores/use-vault-store';

interface TopBarProps {
  onSearchClick?: () => void;
}

export const TopBar = ({ onSearchClick }: TopBarProps) => {
  const navigate = useNavigate();
  const { setServerModalOpen } = useUIStore();
  const { isUnlocked, sessionTimeout, lastActivity, lock } = useVaultStore();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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
    <header className="h-14 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between px-6 shrink-0">
      <div className="flex-1 flex items-center">
        <button
          className="relative w-96 text-left"
          onClick={onSearchClick}
        >
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <div className="w-full bg-background border border-input rounded-md pl-9 pr-4 py-1.5 text-sm text-muted-foreground hover:border-primary/50 transition-colors">
            Search servers, apps, commands...{' '}
            <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </div>
        </button>
      </div>
      
      <div className="flex items-center gap-3">
        {/* Vault Status Pill */}
        <div className="flex items-center">
          {isUnlocked ? (
            <div className="flex items-center bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg px-2.5 py-1 text-xs gap-2">
              <span className="flex items-center gap-1.5 font-medium">
                <Unlock className="w-3.5 h-3.5" />
                Vault Unlocked
              </span>
              {remaining && (
                <span className="font-mono text-[11px] text-emerald-400/80 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                  {remaining}
                </span>
              )}
              <button
                onClick={() => lock(false)}
                title="Lock Vault Now"
                className="text-[11px] text-emerald-300 hover:text-white underline ml-1 cursor-pointer"
              >
                Lock
              </button>
            </div>
          ) : (
            <button
              onClick={() => navigate('/settings')}
              title="Vault is locked. Click to view Settings & Vault."
              className="flex items-center bg-muted/60 hover:bg-muted border border-border text-muted-foreground hover:text-foreground rounded-lg px-2.5 py-1 text-xs gap-1.5 transition-colors cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Vault Locked</span>
            </button>
          )}
        </div>

        <Button size="sm" className="gap-2" onClick={() => setServerModalOpen(true)}>
          <Plus className="h-4 w-4" />
          New Server
        </Button>
      </div>
    </header>
  );
};

