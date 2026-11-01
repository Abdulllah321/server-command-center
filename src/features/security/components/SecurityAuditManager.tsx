import React, { useState, useEffect } from 'react';
import { 
  getSecurityAudit, 
  toggleUfw, 
  addUfwRule, 
  deleteUfwRule, 
  type SecurityAuditReport
} from '@/lib/tauri-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { 
  ShieldCheck, 
  AlertTriangle, 
  Radio, 
  RefreshCw, 
  Loader2, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Flame, 
  KeyRound, 
  PackageCheck
} from 'lucide-react';
import { toast } from 'sonner';

interface SecurityAuditManagerProps {
  serverId: string;
}

export const SecurityAuditManager: React.FC<SecurityAuditManagerProps> = ({ serverId }) => {
  const [data, setData] = useState<SecurityAuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Add UFW rule dialog state
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [newPort, setNewPort] = useState('');
  const [newAction, setNewAction] = useState<'allow' | 'deny'>('allow');
  const [newProto, setNewProto] = useState<string>('tcp');

  // Filter for listening ports
  const [portFilter, setPortFilter] = useState<'all' | 'public' | 'high_risk' | 'localhost'>('all');

  const loadAudit = async () => {
    setLoading(true);
    try {
      const res = await getSecurityAudit(serverId);
      setData(res);
    } catch (err: any) {
      toast.error('Failed to run security audit', { description: err.message || String(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAudit();
  }, [serverId]);

  const handleToggleUfw = async (enable: boolean) => {
    try {
      setActionLoading(true);
      const out = await toggleUfw(serverId, enable);
      toast.success(enable ? 'UFW Firewall Enabled' : 'UFW Firewall Disabled', { description: out });
      await loadAudit();
    } catch (err: any) {
      toast.error('Failed to toggle UFW firewall', { description: err.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPort.trim()) return;

    try {
      setActionLoading(true);
      const out = await addUfwRule(
        serverId, 
        newPort.trim(), 
        newAction === 'allow', 
        newProto === 'any' ? undefined : newProto
      );
      toast.success(`Rule added: ${newAction.toUpperCase()} ${newPort}/${newProto}`, { description: out });
      setAddRuleOpen(false);
      setNewPort('');
      await loadAudit();
    } catch (err: any) {
      toast.error('Failed to add firewall rule', { description: err.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteRule = async (ruleNumber: number) => {
    try {
      setActionLoading(true);
      const out = await deleteUfwRule(serverId, ruleNumber);
      toast.success(`Firewall rule #${ruleNumber} removed`, { description: out });
      await loadAudit();
    } catch (err: any) {
      toast.error('Failed to delete rule', { description: err.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  };

  const filteredPorts = data?.ports.filter(p => {
    if (portFilter === 'public') return p.is_public;
    if (portFilter === 'high_risk') return p.risk_level === 'high';
    if (portFilter === 'localhost') return !p.is_public;
    return true;
  }) || [];

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/40 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Security Audit & Firewall Deck
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Live Hardening Telemetry
            </span>
          </div>
          <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">
            Inspect listening network sockets, manage UFW firewall rules, and verify SSH daemon hardening
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadAudit} disabled={loading || actionLoading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh Audit
          </Button>
        </div>
      </div>

      {/* Top 4 Posture Score Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: SSH Hardening Score */}
        <Card className="bg-card border-border shadow-xs">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">SSH Hardening</span>
            <KeyRound className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent className="p-4 pt-1 space-y-1">
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold tracking-tight ${
                (data?.overview.ssh_score || 0) >= 80 
                  ? 'text-emerald-500' 
                  : (data?.overview.ssh_score || 0) >= 60 
                  ? 'text-amber-500' 
                  : 'text-rose-500'
              }`}>
                {data ? `${data.overview.ssh_score}/100` : '—'}
              </span>
              <span className="text-xs text-muted-foreground">
                {(data?.overview.ssh_score || 0) >= 80 ? 'Solid Posture' : 'Hardening Advised'}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Port: {data?.ssh.port || 22} • Root: {data?.ssh.permit_root_login || '—'}
            </p>
          </CardContent>
        </Card>

        {/* Card 2: UFW Firewall Status */}
        <Card className="bg-card border-border shadow-xs">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">UFW Firewall</span>
            <Flame className="w-4 h-4 text-orange-500" />
          </CardHeader>
          <CardContent className="p-4 pt-1 space-y-2">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className={`text-xs font-semibold ${
                data?.ufw.is_active 
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' 
                  : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
              }`}>
                {data?.ufw.is_active ? 'Active & Enforcing' : 'Disabled / Standby'}
              </Badge>
              {data && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={actionLoading}
                  onClick={() => handleToggleUfw(!data.ufw.is_active)}
                  className="h-6 px-2 text-[11px] text-primary hover:bg-primary/10"
                >
                  {data.ufw.is_active ? 'Turn Off' : 'Enable UFW'}
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {data?.ufw.rules.length || 0} active packet filtering rules
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Exposed Ports */}
        <Card className="bg-card border-border shadow-xs">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Open Sockets</span>
            <Radio className="w-4 h-4 text-sky-500" />
          </CardHeader>
          <CardContent className="p-4 pt-1 space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {data?.overview.total_listening_ports ?? '—'}
              </span>
              <span className="text-xs text-muted-foreground">
                ({data?.overview.public_ports_count ?? 0} public)
              </span>
            </div>
            {data && data.overview.high_risk_ports_count > 0 ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-500">
                <AlertTriangle className="w-3 h-3" />
                {data.overview.high_risk_ports_count} exposed database/cache!
              </span>
            ) : (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                No high-risk database ports publicly bound
              </p>
            )}
          </CardContent>
        </Card>

        {/* Card 4: Fail2ban & Patches */}
        <Card className="bg-card border-border shadow-xs">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Intrusion & Patches</span>
            <PackageCheck className="w-4 h-4 text-teal-500" />
          </CardHeader>
          <CardContent className="p-4 pt-1 space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`text-[10px] ${
                data?.overview.fail2ban_active 
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' 
                  : 'bg-muted text-muted-foreground border-border'
              }`}>
                Fail2ban: {data?.overview.fail2ban_active ? 'Active' : 'Not Running'}
              </Badge>
              {data && data.overview.banned_ips_count > 0 && (
                <span className="text-xs text-rose-500 font-mono font-medium">
                  {data.overview.banned_ips_count} banned
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {data?.overview.pending_security_updates ? (
                <span className="text-amber-500 font-medium">
                  {data.overview.pending_security_updates} security updates available
                </span>
              ) : (
                'System packages up to date'
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid: Listening Ports & UFW Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left 2 Cols: Active Listening Ports Scanner */}
        <Card className="lg:col-span-2 bg-card border-border shadow-xs flex flex-col">
          <CardHeader className="p-4 sm:p-5 pb-3 border-b border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Radio className="w-4 h-4 text-primary" />
                Active Listening Sockets & Ports
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Real-time output from socket inspector (<code>ss -tulpn</code>)
              </CardDescription>
            </div>

            {/* Filter buttons */}
            <div className="flex items-center gap-1.5 bg-muted/50 p-1 rounded-lg border border-border/60">
              <button
                type="button"
                onClick={() => setPortFilter('all')}
                className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors ${
                  portFilter === 'all' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                All ({data?.ports.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setPortFilter('public')}
                className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors ${
                  portFilter === 'public' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Public ({data?.overview.public_ports_count || 0})
              </button>
              <button
                type="button"
                onClick={() => setPortFilter('high_risk')}
                className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors ${
                  portFilter === 'high_risk' ? 'bg-destructive/15 text-destructive font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                High Risk ({data?.overview.high_risk_ports_count || 0})
              </button>
              <button
                type="button"
                onClick={() => setPortFilter('localhost')}
                className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors ${
                  portFilter === 'localhost' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Localhost
              </button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loading && !data ? (
              <div className="flex flex-col items-center justify-center p-12 text-muted-foreground gap-3">
                <Loader2 className="w-7 h-7 animate-spin text-primary" />
                <p className="text-xs font-mono">Auditing server network sockets...</p>
              </div>
            ) : filteredPorts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs">
                No listening ports match the selected filter.
              </div>
            ) : (
              <div className="divide-y divide-border/40 text-xs max-h-[460px] overflow-y-auto">
                {filteredPorts.map((p, idx) => (
                  <div key={`${p.protocol}-${p.local_port}-${idx}`} className="p-3.5 hover:bg-muted/30 transition-colors flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="font-mono font-bold text-sm text-foreground bg-muted/60 px-2.5 py-1 rounded-md border border-border/60 shrink-0">
                        {p.local_port}
                        <span className="text-[10px] text-muted-foreground uppercase ml-1 font-normal">{p.protocol}</span>
                      </div>

                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground truncate font-mono">
                            {p.process_name}
                          </span>
                          {p.pid && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              PID: {p.pid}
                            </span>
                          )}
                          <span className="text-muted-foreground">•</span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {p.bind_address}:{p.local_port}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-normal">
                          {p.risk_description}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      {p.risk_level === 'high' ? (
                        <Badge variant="outline" className="text-[10px] bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 font-semibold gap-1">
                          <AlertTriangle className="w-3 h-3" /> Public Risk
                        </Badge>
                      ) : p.is_public ? (
                        <Badge variant="outline" className="text-[10px] bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20 font-medium">
                          Public Internet
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-medium">
                          Localhost Safe
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right 1 Col: UFW Rules & Actions */}
        <div className="space-y-6 flex flex-col">
          {/* UFW Rules Card */}
          <Card className="bg-card border-border shadow-xs flex flex-col">
            <CardHeader className="p-4 sm:p-5 pb-3 border-b border-border/50 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-500" />
                  UFW Firewall Rules
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  Default: {data?.ufw.default_incoming || 'deny'} incoming
                </CardDescription>
              </div>

              <Button 
                size="sm" 
                onClick={() => setAddRuleOpen(true)}
                className="h-7 text-xs bg-primary text-primary-foreground gap-1 px-2.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Rule
              </Button>
            </CardHeader>

            <CardContent className="p-0">
              {!data?.ufw.is_installed ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  UFW is not installed on this server. Install with <code>sudo apt install ufw</code>.
                </div>
              ) : !data?.ufw.is_active ? (
                <div className="p-6 text-center space-y-2">
                  <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto opacity-70" />
                  <p className="text-xs font-medium text-foreground">Firewall Inactive</p>
                  <p className="text-[11px] text-muted-foreground">
                    All incoming traffic reaches your open ports directly without firewall filtering.
                  </p>
                  <Button 
                    size="sm" 
                    onClick={() => handleToggleUfw(true)} 
                    disabled={actionLoading}
                    className="h-7 text-xs mt-2"
                  >
                    Enable UFW Firewall
                  </Button>
                </div>
              ) : data.ufw.rules.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No custom numbered rules defined in UFW yet.
                </div>
              ) : (
                <div className="divide-y divide-border/40 text-xs max-h-[460px] overflow-y-auto">
                  {data.ufw.rules.map(r => (
                    <div key={r.number} className="p-3 hover:bg-muted/30 transition-colors flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="font-mono text-[11px] text-muted-foreground w-4 text-right">
                          {r.number}
                        </span>
                        <div className="font-mono font-semibold text-foreground truncate">
                          {r.to_port}
                        </div>
                        <Badge variant="outline" className={`text-[10px] font-bold ${
                          r.action === 'ALLOW' 
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' 
                            : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
                        }`}>
                          {r.action}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground font-mono hidden sm:inline">
                          {r.from_ip}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={actionLoading}
                          onClick={() => handleDeleteRule(r.number)}
                          className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Delete this rule"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom Section: SSH Hardening Recommendations */}
      <Card className="bg-card border-border shadow-xs">
        <CardHeader className="p-4 sm:p-5 pb-3 border-b border-border/50">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            SSH Hardening Checklist & Recommendations
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Automated configuration inspection of <code>/etc/ssh/sshd_config</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {data?.ssh.recommendations.map((rec, i) => (
            <div 
              key={i} 
              className={`p-3.5 rounded-xl border space-y-1.5 ${
                rec.severity === 'critical'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                  : rec.severity === 'warning'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                  : rec.severity === 'good'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                  : 'bg-muted/40 border-border text-foreground'
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold text-xs">
                {rec.severity === 'good' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                ) : rec.severity === 'critical' ? (
                  <XCircle className="w-3.5 h-3.5 text-rose-500" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                )}
                <span>{rec.title}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {rec.description}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Add UFW Rule Dialog */}
      <Dialog open={addRuleOpen} onOpenChange={setAddRuleOpen}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Plus className="w-4 h-4 text-primary" />
              Add UFW Firewall Rule
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Define a port or port range to allow or deny in the Linux kernel firewall.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddRule} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Port or Service</label>
              <Input
                placeholder="e.g. 443, 80, 22, 3000"
                value={newPort}
                onChange={e => setNewPort(e.target.value)}
                autoFocus
                className="h-8 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">You can enter a single port (80) or range (8000:8080)</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Action</label>
                <Select value={newAction} onValueChange={(v) => { if (v) setNewAction(v as 'allow' | 'deny'); }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allow">ALLOW (Permit Traffic)</SelectItem>
                    <SelectItem value="deny">DENY (Block Traffic)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Protocol</label>
                <Select value={newProto} onValueChange={(v) => { if (v) setNewProto(v); }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="udp">UDP</SelectItem>
                    <SelectItem value="any">Both (Any)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAddRuleOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={actionLoading || !newPort.trim()}>
                {actionLoading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                Add Rule
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

