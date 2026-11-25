import React, { useState, useEffect } from 'react';
import { ExternalLink, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getAlertHistory } from '@/lib/tauri-client';
import type { AlertHistoryEntry } from '@/types';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

interface ServerAlertBannerProps {
  serverId: string;
  onNavigateToAlerts: () => void;
}

export const ServerAlertBanner: React.FC<ServerAlertBannerProps> = ({
  serverId,
  onNavigateToAlerts,
}) => {
  const [activeAlert, setActiveAlert] = useState<AlertHistoryEntry | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const checkRecentAlerts = async () => {
    try {
      const history = await getAlertHistory(serverId, 3);
      if (history.length > 0) {
        const latest = history[0];
        // Check if alert was triggered within the last 2 hours
        const triggeredTime = new Date(latest.triggered_at).getTime();
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        if (triggeredTime > twoHoursAgo) {
          setActiveAlert(latest);
          setDismissed(false);
          return;
        }
      }
      setActiveAlert(null);
    } catch {
      // Ignore initial silent fetch
    }
  };

  useEffect(() => {
    checkRecentAlerts();
    const interval = setInterval(checkRecentAlerts, 20000);

    let unlisten: UnlistenFn | null = null;
    listen<AlertHistoryEntry>('alert://triggered', (event) => {
      if (event.payload.server_id === serverId) {
        setActiveAlert(event.payload);
        setDismissed(false);
      }
    }).then(u => { unlisten = u; });

    return () => {
      clearInterval(interval);
      if (unlisten) unlisten();
    };
  }, [serverId]);

  if (!activeAlert || dismissed) {
    return null;
  }

  const isCritical = activeAlert.value >= 90 || activeAlert.metric === 'pm2_crash';

  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-all animate-in fade-in slide-in-from-top-2 duration-200 ${
        isCritical
          ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
          : 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
      }`}
    >
      <div className="flex items-start sm:items-center gap-3 min-w-0">
        <div
          className={`p-2 rounded-xl shrink-0 ${
            isCritical
              ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30'
              : 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30'
          }`}
        >
          <ShieldAlert className="h-5 w-5 animate-pulse" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider">
              {isCritical ? 'Critical Health Alert' : 'Resource Watchdog Warning'}
            </span>
            <span className="text-[10px] opacity-75 font-mono">
              {activeAlert.triggered_at ? new Date(activeAlert.triggered_at).toLocaleTimeString() : ''}
            </span>
          </div>
          <p className="text-xs mt-0.5 opacity-90 leading-snug">
            {activeAlert.message}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
        <Button
          size="sm"
          onClick={onNavigateToAlerts}
          className={`h-7 px-2.5 text-xs font-semibold gap-1.5 shadow-xs ${
            isCritical
              ? 'bg-rose-600 hover:bg-rose-700 text-white'
              : 'bg-amber-600 hover:bg-amber-700 text-white'
          }`}
        >
          <ExternalLink className="h-3 w-3" />
          Alerts Deck
        </Button>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded-lg opacity-60 hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
          title="Dismiss banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
