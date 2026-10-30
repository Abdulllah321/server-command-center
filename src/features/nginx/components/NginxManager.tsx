import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { listNginxSites, getNginxConfig, saveNginxConfig, toggleNginxSite, testNginxConfig, reloadNginx, getSslCertificates, type NginxSite, type SslCertificate } from '@/lib/tauri-client';
import { Globe, ShieldCheck, FileCode2, RefreshCw, CheckCircle2, Play, Shield, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

interface NginxManagerProps {
  serverId: string;
}

export const NginxManager: React.FC<NginxManagerProps> = ({ serverId }) => {
  const [sites, setSites] = useState<NginxSite[]>([]);
  const [certs, setCerts] = useState<SslCertificate[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Editor Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [activeSiteName, setActiveSiteName] = useState('');
  const [configContent, setConfigContent] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);

  // Syntax Test Modal
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testOutput, setTestOutput] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [sitesData, certsData] = await Promise.all([
        listNginxSites(serverId),
        getSslCertificates(serverId).catch(() => []),
      ]);
      setSites(sitesData);
      setCerts(certsData);
    } catch (err: any) {
      toast.error('Failed to load Nginx sites', { description: err.message || String(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [serverId]);

  const handleToggle = async (site: NginxSite, nextEnabled: boolean) => {
    try {
      await toggleNginxSite(serverId, site.name, nextEnabled);
      toast.success(`Site ${site.name} ${nextEnabled ? 'enabled' : 'disabled'} and Nginx reloaded`);
      setSites(prev => prev.map(s => s.name === site.name ? { ...s, is_enabled: nextEnabled } : s));
    } catch (err: any) {
      toast.error('Failed to toggle site', { description: err.message || String(err) });
    }
  };

  const handleEdit = async (site: NginxSite) => {
    setActiveSiteName(site.name);
    try {
      const content = await getNginxConfig(serverId, site.name);
      setConfigContent(content);
      setEditModalOpen(true);
    } catch (err: any) {
      toast.error('Failed to read config', { description: err.message || String(err) });
    }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      await saveNginxConfig(serverId, activeSiteName, configContent);
      toast.success('Configuration saved & validated successfully');
      setEditModalOpen(false);
      loadData();
    } catch (err: any) {
      toast.error('Failed to save config (syntax check failed)', { description: err.message || String(err) });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTestSyntax = async () => {
    setActionLoading(true);
    try {
      const out = await testNginxConfig(serverId);
      setTestOutput(out);
      setTestModalOpen(true);
    } catch (err: any) {
      setTestOutput(err.message || String(err));
      setTestModalOpen(true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReload = async () => {
    setActionLoading(true);
    try {
      await reloadNginx(serverId);
      toast.success('Nginx reloaded successfully');
    } catch (err: any) {
      toast.error('Failed to reload Nginx', { description: err.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Nginx Reverse Proxy</h2>
          <p className="text-sm text-muted-foreground">
            Manage virtual host sites, proxy passes, configuration files, and SSL certificates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleTestSyntax} disabled={actionLoading || loading}>
            <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-500" />
            Test Config
          </Button>
          <Button variant="outline" size="sm" onClick={handleReload} disabled={actionLoading || loading}>
            <Play className="h-4 w-4 mr-2 text-primary" />
            Reload Nginx
          </Button>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* SSL Certificates Banner if any */}
      {certs.length > 0 && (
        <Card className="bg-card/50 border-primary/20">
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-medium">SSL / Let's Encrypt Certificates</CardTitle>
            </div>
            <span className="text-xs text-muted-foreground">{certs.length} Active Certificate(s)</span>
          </CardHeader>
          <CardContent className="py-2 px-4 divide-y divide-border/40">
            {certs.map((c, i) => (
              <div key={i} className="py-2 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  <span className="font-semibold text-foreground">{c.cert_name}</span>
                  <span className="text-muted-foreground font-mono">({c.domain || 'All subdomains'})</span>
                </div>
                <div className="flex items-center gap-2">
                  {c.days_remaining !== null && (
                    <span className={`px-2 py-0.5 rounded-full font-medium ${c.days_remaining < 30 ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                      {c.days_remaining} days left
                    </span>
                  )}
                  <span className="text-muted-foreground">{c.expiry_date}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Sites List */}
      <div className="space-y-4">
        {sites.length === 0 && !loading ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Globe className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="font-semibold text-lg">No Nginx sites found</h3>
              <p className="text-sm text-muted-foreground max-w-md mt-1">
                No configurations discovered in <code>/etc/nginx/sites-available</code> or <code>/etc/nginx/conf.d</code>.
              </p>
            </CardContent>
          </Card>
        ) : (
          sites.map(s => (
            <Card key={s.name} className={`overflow-hidden transition-all ${s.is_enabled ? 'border-border' : 'border-border/40 opacity-75'}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-lg ${s.is_enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    <Globe className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-semibold text-base">{s.name}</span>
                      {s.is_enabled ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
                          Enabled
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                          Disabled
                        </span>
                      )}
                      {s.ssl_enabled && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-medium flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" /> SSL Active
                        </span>
                      )}
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      {s.domains.length > 0 ? (
                        s.domains.map((d, i) => (
                          <span key={i} className="text-xs font-mono bg-secondary/80 px-2 py-0.5 rounded text-secondary-foreground">
                            {d}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Default / Catch-all</span>
                      )}
                    </div>

                    {s.proxy_pass && (
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        Proxy Pass: <span className="text-foreground">{s.proxy_pass}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <Button variant="outline" size="sm" onClick={() => handleEdit(s)}>
                    <FileCode2 className="h-4 w-4 mr-1.5" />
                    Edit Config
                  </Button>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={s.is_enabled}
                      onCheckedChange={checked => handleToggle(s, checked)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Edit Config Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode2 className="h-5 w-5 text-primary" />
              <span>Edit Nginx Configuration: {activeSiteName}</span>
            </DialogTitle>
            <DialogDescription>
              Changes are validated with <code>nginx -t</code> before being applied.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-[350px] my-2">
            <textarea
              className="w-full h-full min-h-[350px] p-3 font-mono text-xs bg-background/80 border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              value={configContent}
              onChange={e => setConfigContent(e.target.value)}
              spellCheck={false}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveConfig} disabled={savingConfig}>
              {savingConfig ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save & Test Syntax
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Syntax Test Output Modal */}
      <Dialog open={testModalOpen} onOpenChange={setTestModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <span>Nginx Syntax Test Result</span>
            </DialogTitle>
          </DialogHeader>
          <pre className="p-3 bg-secondary/50 rounded text-xs font-mono whitespace-pre-wrap overflow-x-auto text-foreground">
            {testOutput || 'No output received.'}
          </pre>
          <DialogFooter>
            <Button onClick={() => setTestModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
