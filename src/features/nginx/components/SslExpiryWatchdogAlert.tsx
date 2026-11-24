import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSslOverview } from '@/lib/tauri-client';
import { AlertTriangle, ShieldAlert, ArrowRight, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SslExpiryWatchdogAlertProps {
  serverId: string;
  onNavigateToSsl?: () => void;
  className?: string;
}

export const SslExpiryWatchdogAlert: React.FC<SslExpiryWatchdogAlertProps> = ({
  serverId,
  onNavigateToSsl,
  className,
}) => {
  const { data: overview } = useQuery({
    queryKey: ['ssl-overview', serverId],
    queryFn: () => getSslOverview(serverId),
    staleTime: 60000,
    refetchInterval: 60000,
  });

  if (!overview) return null;

  const expiredCount = overview.expired_count;
  const expiringSoonCount = overview.expiring_soon_count;

  if (expiredCount === 0 && expiringSoonCount === 0) {
    return null;
  }

  const isSevere = expiredCount > 0;

  // Find the certificate closest to expiring
  const closestCert = overview.certificates
    .filter((c) => c.status_level === 'expired' || c.status_level === 'critical' || c.status_level === 'expiring_soon')
    .sort((a, b) => (a.days_remaining ?? 999) - (b.days_remaining ?? 999))[0];

  return (
    <div
      className={cn(
        "p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs transition-all",
        isSevere
          ? "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
          : "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "p-2 rounded-xl shrink-0",
            isSevere ? "bg-rose-500/20 text-rose-500" : "bg-amber-500/20 text-amber-500"
          )}
        >
          {isSevere ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </div>
        <div className="text-xs">
          <div className="font-semibold flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            <span>
              {isSevere
                ? `${expiredCount} SSL Certificate(s) Expired or Invalid!`
                : `${expiringSoonCount} SSL Certificate(s) Expiring Soon!`}
            </span>
          </div>
          <p className="text-[11px] opacity-90 mt-0.5">
            {closestCert
              ? `"${closestCert.cert_name}" expires in ${closestCert.days_remaining ?? 0} days (${closestCert.domain}). Dispatch renewal to avoid HTTPS downtime.`
              : 'Review your Let\'s Encrypt and Nginx certificate renewals.'}
          </p>
        </div>
      </div>

      {onNavigateToSsl && (
        <Button
          size="sm"
          variant="outline"
          onClick={onNavigateToSsl}
          className={cn(
            "h-8 text-xs font-semibold shrink-0 gap-1",
            isSevere
              ? "border-rose-500/30 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400"
              : "border-amber-500/30 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400"
          )}
        >
          <span>Open SSL Cockpit</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
};
