import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useHealth } from '@/features/health/api';
import type { Server } from '@/types';
import { reconnectServer } from '@/lib/tauri-client';
import { toast } from 'sonner';
import { 
  KeyRound, 
  WifiOff, 
  ShieldAlert, 
  RefreshCw, 
  CheckCircle2, 
  Clock, 
  Activity,
  Loader2,
  Lock
} from 'lucide-react';
import { QuickConnectModal } from './QuickConnectModal';

interface ServerConnectionBannerProps {
  server: Server;
  onRefreshHealth?: () => void;
}

export const ServerConnectionBanner = ({ server, onRefreshHealth }: ServerConnectionBannerProps) => {
  const { data: health, isError, error, isLoading, refetch } = useHealth(server.id, 10000);
  const [isQuickConnectOpen, setIsQuickConnectOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const errorMessage = error instanceof Error ? error.message : String(error || '');

  const isCredentialMissing = errorMessage.includes('No saved password found in Keychain') ||
    errorMessage.includes('Credential not found') ||
    errorMessage.includes('No credentials found');

  const isNetworkError = errorMessage.includes('Failed to connect to host') ||
    errorMessage.includes('connection refused') ||
    errorMessage.includes('timed out');

  const handleTestAndReconnect = async () => {
    setIsTesting(true);
    try {
      await reconnectServer(server.id);
      await refetch();
      onRefreshHealth?.();
      toast.success('Connection re-established successfully!');
    } catch (err: any) {
      toast.error(err.message || 'Connection reconnect failed');
      await refetch();
    } finally {
      setIsTesting(false);
    }
  };

  const formatUptime = (seconds?: number) => {
    if (!seconds) return '--';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d > 0 ? `${d}d ` : ''}${h}h ${m}m`;
  };

  if (isError) {
    if (isCredentialMissing) {
      return (
        <>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 mt-0.5 sm:mt-0">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-semibold text-sm text-amber-300">Authentication Required</h4>
                <p className="text-xs text-amber-200/80 mt-0.5">
                  No saved password found for <code className="px-1.5 py-0.5 rounded bg-black/30 font-mono">{server.username}@{server.hostname}</code>. Enter your password once to store it securely in your hardware keychain.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="bg-amber-500 text-black hover:bg-amber-400 font-medium whitespace-nowrap shadow-sm"
              onClick={() => setIsQuickConnectOpen(true)}
            >
              <Lock className="h-3.5 w-3.5 mr-1.5" />
              Enter Password & Connect
            </Button>
          </div>
          <QuickConnectModal
            open={isQuickConnectOpen}
            onOpenChange={setIsQuickConnectOpen}
            server={server}
            onConnected={() => refetch()}
          />
        </>
      );
    }

    if (isNetworkError) {
      return (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive-foreground">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-destructive/20 text-destructive mt-0.5 sm:mt-0">
              <WifiOff className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-semibold text-sm text-destructive">Server Unreachable</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cannot reach <code className="px-1.5 py-0.5 rounded bg-black/30 font-mono">{server.hostname}:{server.ssh_port}</code>. Check that the server is online and SSH port is open.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/40 hover:bg-destructive/15 whitespace-nowrap"
            onClick={handleTestAndReconnect}
            disabled={isTesting}
          >
            {isTesting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Retry Connection
          </Button>
        </div>
      );
    }

    // Generic error
    return (
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive-foreground">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-destructive/20 text-destructive mt-0.5 sm:mt-0">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h4 className="font-semibold text-sm text-destructive">Connection Error</h4>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono break-all">{errorMessage}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsQuickConnectOpen(true)}
          >
            Update Credentials
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleTestAndReconnect}
            disabled={isTesting}
          >
            {isTesting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Connected state
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm text-xs text-muted-foreground">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1.5 text-foreground font-medium">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          <span>Active Connection</span>
        </div>
        <div className="h-3 w-px bg-border" />
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          <span>Uptime: <strong className="text-foreground">{formatUptime(health?.uptime_seconds)}</strong></span>
        </div>
        <div className="h-3 w-px bg-border" />
        <div className="flex items-center gap-1.5">
          <Activity className="h-3 w-3" />
          <span>Load: <strong className="text-foreground">{health ? health.load_avg.map(n => n.toFixed(2)).join(', ') : '--'}</strong></span>
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => refetch()}
        disabled={isLoading}
      >
        <RefreshCw className={`h-3 w-3 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
        Refresh
      </Button>
    </div>
  );
};

