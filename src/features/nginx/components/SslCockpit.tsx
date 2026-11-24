import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  getSslOverview, 
  renewSslCertificates, 
  issueSslCertificate, 
  toggleSslAutoRenewal, 
  deleteSslCertificate,
  requestConfirmation,
  type SslCertificate,
  type IssueCertPayload
} from '@/lib/tauri-client';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Clock, 
  AlertTriangle, 
  RefreshCw, 
  Sparkles, 
  Plus, 
  Lock, 
  Trash2, 
  Search, 
  CheckCircle2, 
  XCircle,
  Timer
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SslCockpitProps {
  serverId: string;
  className?: string;
}

export const SslCockpit: React.FC<SslCockpitProps> = ({ serverId, className }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLevel, setFilterLevel] = useState<'all' | 'healthy' | 'expiring' | 'expired'>('all');
  
  // Issue Modal State
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [issueDomain, setIssueDomain] = useState('');
  const [issueEmail, setIssueEmail] = useState('');
  const [issueStaging, setIssueStaging] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);

  // Renewal / Output Modal State
  const [outputModalOpen, setOutputModalOpen] = useState(false);
  const [outputModalTitle, setOutputModalTitle] = useState('');
  const [outputModalContent, setOutputModalContent] = useState('');
  const [isOutputSuccess, setIsOutputSuccess] = useState(true);

  // Per-action loading indicators
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Delete State
  const [certToDelete, setCertToDelete] = useState<SslCertificate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: overview, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['ssl-overview', serverId],
    queryFn: () => getSslOverview(serverId),
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const certs = overview?.certificates || [];

  const filteredCerts = certs.filter(c => {
    // Search query
    const lower = searchQuery.toLowerCase();
    const matchesSearch = 
      c.cert_name.toLowerCase().includes(lower) || 
      c.domain.toLowerCase().includes(lower) || 
      (c.issuer && c.issuer.toLowerCase().includes(lower));
    
    if (!matchesSearch) return false;

    // Status filter
    if (filterLevel === 'healthy') return c.status_level === 'healthy';
    if (filterLevel === 'expiring') return c.status_level === 'expiring_soon' || c.status_level === 'critical';
    if (filterLevel === 'expired') return c.status_level === 'expired';
    return true;
  });

  // Bulk Renewal
  const handleRenewAll = async (dryRun: boolean) => {
    setActionInProgress(dryRun ? 'renew-dry-all' : 'renew-real-all');
    try {
      const res = await renewSslCertificates(serverId, dryRun);
      setOutputModalTitle(dryRun ? 'Simulated Renewal Test (Dry-Run)' : 'Certificate Renewal Complete');
      setOutputModalContent(res.output);
      setIsOutputSuccess(res.success);
      setOutputModalOpen(true);

      if (res.success) {
        toast.success(dryRun ? 'All renewals validated successfully' : 'Certificates renewed and Nginx reloaded');
      } else {
        toast.error('Renewal encountered issues. Check details.');
      }
      refetch();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to dispatch renewal');
    } finally {
      setActionInProgress(null);
    }
  };

  // Single Certificate Renewal
  const handleRenewSingle = async (certName: string, dryRun: boolean) => {
    setActionInProgress(`renew-${certName}`);
    try {
      const res = await renewSslCertificates(serverId, dryRun, certName);
      setOutputModalTitle(`${dryRun ? 'Dry-Run Test' : 'Renewal'}: ${certName}`);
      setOutputModalContent(res.output);
      setIsOutputSuccess(res.success);
      setOutputModalOpen(true);

      if (res.success) {
        toast.success(`Certificate "${certName}" processed successfully`);
      } else {
        toast.error(`Renewal failed for "${certName}"`);
      }
      refetch();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to dispatch renewal');
    } finally {
      setActionInProgress(null);
    }
  };

  // Toggle Auto-Renewal Systemd Timer
  const handleToggleTimer = async () => {
    if (!overview) return;
    const targetState = !overview.is_auto_renew_timer_active;
    setActionInProgress('toggle-timer');
    try {
      await toggleSslAutoRenewal(serverId, targetState);
      toast.success(targetState ? 'Auto-renewal timer activated (certbot.timer)' : 'Auto-renewal timer disabled');
      refetch();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to toggle auto-renewal timer');
    } finally {
      setActionInProgress(null);
    }
  };

  // Issue New Certificate
  const handleIssueCertificate = async () => {
    if (!issueDomain.trim()) {
      toast.error('Domain name is required');
      return;
    }

    setIsIssuing(true);
    try {
      const payload: IssueCertPayload = {
        domain: issueDomain.trim(),
        email: issueEmail.trim(),
        staging_test: issueStaging,
      };

      const res = await issueSslCertificate(serverId, payload);
      setIsIssueModalOpen(false);
      setOutputModalTitle(`SSL Provisioning: ${issueDomain}`);
      setOutputModalContent(res.output);
      setIsOutputSuccess(res.success);
      setOutputModalOpen(true);

      if (res.success) {
        toast.success(issueStaging ? 'Staging test succeeded!' : `SSL Certificate issued for ${issueDomain}`);
        setIssueDomain('');
        setIssueEmail('');
        setIssueStaging(false);
      } else {
        toast.error('Certbot failed to provision certificate');
      }
      refetch();
    } catch (err: any) {
      toast.error(err?.message || 'Certificate issuance failed');
    } finally {
      setIsIssuing(false);
    }
  };

  // Delete / Revoke Certificate
  const handleConfirmDelete = async () => {
    if (!certToDelete) return;

    setIsDeleting(true);
    try {
      const token = await requestConfirmation(
        `Delete SSL certificate "${certToDelete.cert_name}" and all associated keys`,
        [serverId, certToDelete.cert_name]
      );

      const msg = await deleteSslCertificate(serverId, certToDelete.cert_name, token);
      toast.success(msg || `Deleted certificate "${certToDelete.cert_name}"`);
      setCertToDelete(null);
      refetch();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete certificate');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {/* Top Header & Actions Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            SSL Certificate Expiry Watchdog & Renewal Cockpit
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Automated multi-domain expiration monitoring, 1-click Let's Encrypt issuance, and renewal scheduler
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleRenewAll(true)}
            disabled={actionInProgress !== null || isLoading}
            className="h-8 text-xs border-border hover:bg-muted text-foreground"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5 text-sky-400" />
            Test All (Dry-Run)
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => handleRenewAll(false)}
            disabled={actionInProgress !== null || isLoading}
            className="h-8 text-xs border-border hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />
            Renew All Now
          </Button>

          <Button
            size="sm"
            onClick={() => setIsIssueModalOpen(true)}
            className="h-8 text-xs bg-primary text-primary-foreground font-semibold shadow-xs"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Issue Free SSL
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => refetch()}
            disabled={isLoading || isRefetching}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            title="Refresh certificates"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", (isRefetching || isLoading) && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* KPI Overview Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        {/* Total Managed */}
        <Card className="bg-card border-border shadow-xs">
          <CardHeader className="p-3.5 pb-1 flex flex-row items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Total Certificates
            </span>
            <ShieldCheck className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent className="p-3.5 pt-0">
            <div className="text-2xl font-bold font-mono text-foreground">
              {overview?.total_certs ?? certs.length}
            </div>
            <p className="text-[10px] text-muted-foreground">Let's Encrypt & Custom SSL</p>
          </CardContent>
        </Card>

        {/* Healthy Active */}
        <Card className="bg-card border-border shadow-xs">
          <CardHeader className="p-3.5 pb-1 flex flex-row items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Healthy Active
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent className="p-3.5 pt-0">
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {overview?.healthy_count ?? 0}
            </div>
            <p className="text-[10px] text-muted-foreground">&gt; 30 days remaining</p>
          </CardContent>
        </Card>

        {/* Expiring Soon */}
        <Card className="bg-card border-border shadow-xs">
          <CardHeader className="p-3.5 pb-1 flex flex-row items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Expiring Soon
            </span>
            <Clock className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent className="p-3.5 pt-0">
            <div className={cn(
              "text-2xl font-bold font-mono",
              (overview?.expiring_soon_count || 0) > 0 ? "text-amber-500" : "text-muted-foreground"
            )}>
              {overview?.expiring_soon_count ?? 0}
            </div>
            <p className="text-[10px] text-muted-foreground">Within 15 to 30 days</p>
          </CardContent>
        </Card>

        {/* Auto-Renewal Status */}
        <Card className="bg-card border-border shadow-xs">
          <CardHeader className="p-3.5 pb-1 flex flex-row items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Auto-Renewal Watchdog
            </span>
            <Timer className={cn("w-4 h-4", overview?.is_auto_renew_timer_active ? "text-emerald-500" : "text-muted-foreground")} />
          </CardHeader>
          <CardContent className="p-3.5 pt-0 flex items-center justify-between">
            <div>
              <div className={cn(
                "text-sm font-bold flex items-center gap-1.5",
                overview?.is_auto_renew_timer_active ? "text-emerald-600 dark:text-emerald-400" : "text-amber-500"
              )}>
                <span className={cn("w-2 h-2 rounded-full", overview?.is_auto_renew_timer_active ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
                {overview?.is_auto_renew_timer_active ? "Systemd Active" : "Inactive / Manual"}
              </div>
              <p className="text-[10px] text-muted-foreground">certbot.timer daemon</p>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={handleToggleTimer}
              disabled={actionInProgress === 'toggle-timer'}
              className="h-7 px-2 text-[10px] border-border"
            >
              {overview?.is_auto_renew_timer_active ? 'Disable' : 'Enable'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Critical Expiry Banner if any cert < 15 days or expired */}
      {overview && (overview.expired_count > 0 || overview.expiring_soon_count > 0) && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <strong>Watchdog Alert:</strong> {overview.expired_count + overview.expiring_soon_count} certificate(s) require renewal attention. Run a simulated dry-run or dispatch live renewal.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleRenewAll(false)}
            className="h-7 text-xs border-amber-500/30 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0 font-medium"
          >
            Renew Now
          </Button>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by domain, cert name, or issuer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs bg-muted/40 border-border"
          />
        </div>

        <div className="flex items-center bg-muted/60 p-0.5 rounded-xl border border-border self-start sm:self-auto">
          {(['all', 'healthy', 'expiring', 'expired'] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setFilterLevel(lvl)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-lg transition-all capitalize",
                filterLevel === lvl
                  ? "bg-card text-foreground font-semibold shadow-xs border border-border"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {lvl === 'all' ? `All (${certs.length})` : lvl}
            </button>
          ))}
        </div>
      </div>

      {/* Certificate Cards List */}
      <div className="space-y-3">
        {isLoading && certs.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
            Scanning server for Let's Encrypt and Nginx SSL certificates...
          </div>
        ) : filteredCerts.length === 0 ? (
          <Card className="bg-card/40 border-dashed">
            <CardContent className="p-8 text-center space-y-2">
              <ShieldAlert className="w-8 h-8 text-muted-foreground mx-auto opacity-50" />
              <p className="text-sm font-semibold text-foreground">No SSL Certificates Found</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                No active certificates matching your query were discovered in Certbot or Nginx configurations. Click <strong>Issue Free SSL</strong> above to provision one.
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredCerts.map((c, idx) => {
            const days = c.days_remaining;
            const isExpired = c.status_level === 'expired';
            const isCritical = c.status_level === 'critical';
            const isExpiring = c.status_level === 'expiring_soon';

            return (
              <Card key={idx} className="bg-card border-border shadow-xs hover:border-primary/40 transition-all">
                <CardContent className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Left: Certificate Details */}
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className={cn(
                      "p-2.5 rounded-xl border shrink-0 mt-0.5",
                      isExpired
                        ? "bg-rose-500/10 border-rose-500/30 text-rose-500"
                        : isCritical || isExpiring
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-500"
                        : "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
                    )}>
                      <ShieldCheck className="h-5 w-5" />
                    </div>

                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-foreground truncate font-mono">
                          {c.cert_name}
                        </span>

                        {/* Status Badge */}
                        {isExpired ? (
                          <Badge variant="outline" className="text-[10px] bg-rose-500/15 text-rose-500 border-rose-500/30 font-bold">
                            Expired / Invalid
                          </Badge>
                        ) : isCritical ? (
                          <Badge variant="outline" className="text-[10px] bg-rose-500/15 text-rose-500 border-rose-500/30 font-bold animate-pulse">
                            Critical ({days} days left)
                          </Badge>
                        ) : isExpiring ? (
                          <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-500 border-amber-500/30 font-bold">
                            Expiring in {days} days
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-500 border-emerald-500/30 font-semibold">
                            Valid ({days !== null ? `${days} days left` : 'Active'})
                          </Badge>
                        )}

                        {/* Issuer Badge */}
                        <span className="px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-mono text-[10px] border border-border">
                          {c.issuer || "Let's Encrypt"}
                        </span>
                      </div>

                      {/* SAN Domains */}
                      <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                        <span className="text-muted-foreground text-[11px]">Domains:</span>
                        {c.domain ? (
                          c.domain.split(/\s+/).map((d, i) => (
                            <span key={i} className="bg-muted/70 px-2 py-0.5 rounded text-foreground border border-border/60 text-[11px]">
                              {d}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground italic text-[11px]">None listed</span>
                        )}
                      </div>

                      {/* Expiry Date & Path */}
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground pt-0.5">
                        {c.expiry_date && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-muted-foreground/70" />
                            Expiry: <span className="font-mono">{c.expiry_date}</span>
                          </span>
                        )}
                        {c.cert_path && (
                          <span className="font-mono text-muted-foreground/80 truncate max-w-xs sm:max-w-md">
                            Path: {c.cert_path}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="shrink-0 flex items-center gap-2 self-end md:self-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRenewSingle(c.cert_name, true)}
                      disabled={actionInProgress !== null}
                      className="h-8 text-xs border-border hover:bg-muted text-foreground"
                      title="Test certificate renewal without modifying live certificate"
                    >
                      <Sparkles className="w-3.5 h-3.5 mr-1 text-sky-400" />
                      Dry Run
                    </Button>

                    <Button
                      size="sm"
                      onClick={() => handleRenewSingle(c.cert_name, false)}
                      disabled={actionInProgress !== null}
                      className="h-8 text-xs bg-primary text-primary-foreground font-semibold shadow-xs"
                      title="Renew certificate now and reload web server"
                    >
                      <RefreshCw className={cn("w-3.5 h-3.5 mr-1", actionInProgress === `renew-${c.cert_name}` && "animate-spin")} />
                      Renew Now
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCertToDelete(c)}
                      disabled={actionInProgress !== null}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
                      title="Delete / Revoke Certificate"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Issue Free SSL Modal */}
      <Dialog open={isIssueModalOpen} onOpenChange={setIsIssueModalOpen}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base text-foreground">
              <Lock className="w-4 h-4 text-primary" />
              Issue Free Let's Encrypt SSL
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Provision a valid SSL/TLS certificate via Certbot and automatically configure HTTPS for Nginx.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-xs">
            <div className="space-y-1">
              <label className="font-medium text-foreground">Domain Name(s):</label>
              <Input
                placeholder="e.g. api.domain.com or domain.com,www.domain.com"
                value={issueDomain}
                onChange={(e) => setIssueDomain(e.target.value)}
                className="h-8 text-xs bg-muted/40 border-border font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Ensure this domain's DNS A/CNAME record points directly to this server's IP address.
              </p>
            </div>

            <div className="space-y-1">
              <label className="font-medium text-foreground">Contact Email (for renewal notices):</label>
              <Input
                placeholder="admin@domain.com (optional)"
                type="email"
                value={issueEmail}
                onChange={(e) => setIssueEmail(e.target.value)}
                className="h-8 text-xs bg-muted/40 border-border"
              />
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/40 border border-border">
              <div className="space-y-0.5">
                <span className="font-medium text-foreground">Staging Dry-Run Test</span>
                <p className="text-[10px] text-muted-foreground">
                  Verify DNS and routing with Let's Encrypt staging environment without rate-limits.
                </p>
              </div>
              <input
                type="checkbox"
                checked={issueStaging}
                onChange={(e) => setIssueStaging(e.target.checked)}
                className="h-4 w-4 rounded-sm border-border accent-primary cursor-pointer"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsIssueModalOpen(false)}
              disabled={isIssuing}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleIssueCertificate}
              disabled={isIssuing}
              className="gap-1.5"
            >
              {isIssuing ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Requesting Certificate...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {issueStaging ? 'Test Staging Issuance' : 'Issue Production Certificate'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renewal / Operation Output Modal */}
      <Dialog open={outputModalOpen} onOpenChange={setOutputModalOpen}>
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className={cn(
              "flex items-center gap-2 text-base",
              isOutputSuccess ? "text-emerald-500" : "text-rose-500"
            )}>
              {isOutputSuccess ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
              {outputModalTitle}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Command execution log and Certbot response report:
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 bg-muted/80 rounded-xl border border-border max-h-64 overflow-y-auto font-mono text-[11px] text-foreground whitespace-pre-wrap select-text leading-relaxed">
            {outputModalContent || "No output returned."}
          </div>

          <DialogFooter>
            <Button size="sm" onClick={() => setOutputModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete / Revoke Confirmation Modal */}
      {certToDelete && (
        <Dialog open={true} onOpenChange={(open) => !open && setCertToDelete(null)}>
          <DialogContent className="max-w-md bg-card border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-rose-500 text-base">
                <Trash2 className="h-5 w-5" />
                Delete Certificate
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Permanently purge certificate files and keys for <strong>{certToDelete.cert_name}</strong> from Certbot.
              </DialogDescription>
            </DialogHeader>

            <div className="p-3 rounded-xl bg-muted/40 border border-border text-xs space-y-1 font-mono">
              <div>Certificate Name: <span className="font-semibold text-foreground">{certToDelete.cert_name}</span></div>
              <div>Associated Domains: <span className="text-primary">{certToDelete.domain}</span></div>
              {certToDelete.cert_path && <div>Path: <span className="text-muted-foreground">{certToDelete.cert_path}</span></div>}
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCertToDelete(null)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Certificate'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
