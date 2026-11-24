import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  listNginxSites, 
  getNginxConfig, 
  saveNginxConfig, 
  toggleNginxSite, 
  testNginxConfig, 
  reloadNginx, 
  type NginxSite
} from '@/lib/tauri-client';
import { 
  Globe, 
  ShieldCheck, 
  FileCode2, 
  RefreshCw, 
  CheckCircle2, 
  Play, 
  Loader2, 
  Save
} from 'lucide-react';
import { toast } from 'sonner';

import { SslCockpit } from './SslCockpit';

interface NginxManagerProps {
  serverId: string;
}

export const NginxManager: React.FC<NginxManagerProps> = ({ serverId }) => {
  const [activeTab, setActiveTab] = useState<'sites' | 'ssl'>('sites');
  const [sites, setSites] = useState<NginxSite[]>([]);
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
      const sitesData = await listNginxSites(serverId);
      setSites(sitesData);
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
      {/* Top Header & Navigation Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/40 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              Nginx Proxy & SSL Center
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
              Web Routing
            </span>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Manage virtual hosts, reverse proxies, and monitor Let's Encrypt SSL certificate expirations
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {activeTab === 'sites' && (
            <>
              <Button variant="outline" size="sm" onClick={handleTestSyntax} disabled={actionLoading || loading}>
                <CheckCircle2 className="h-4 w-4 mr-1.5 text-emerald-500" />
                Test Syntax
              </Button>
              <Button variant="outline" size="sm" onClick={handleReload} disabled={actionLoading || loading}>
                <Play className="h-4 w-4 mr-1.5 text-primary" />
                Reload Nginx
              </Button>
              <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Sub-Tabs Selector */}
      <div className="flex items-center gap-2 border-b border-border/60 pb-1">
        <button
          type="button"
          onClick={() => setActiveTab('sites')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all select-none border cursor-pointer ${
            activeTab === 'sites'
              ? 'bg-primary/15 text-primary border-primary/30 shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/60 border-transparent'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Virtual Host Sites ({sites.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ssl')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all select-none border cursor-pointer ${
            activeTab === 'ssl'
              ? 'bg-primary/15 text-primary border-primary/30 shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/60 border-transparent'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>SSL Watchdog & Certificates</span>
        </button>
      </div>

      {/* Tab View 1: Sites */}
      {activeTab === 'sites' && (
        <div className="grid grid-cols-1 gap-4">
          {loading && sites.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-muted-foreground gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm font-mono">Querying Nginx configurations...</p>
            </div>
          ) : sites.length === 0 ? (
            <Card className="bg-card/40 border-dashed">
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                No virtual host files found in <code>/etc/nginx/sites-available/</code> or <code>/etc/nginx/conf.d/</code>.
              </CardContent>
            </Card>
          ) : (
            sites.map(s => (
              <Card key={s.name} className="bg-card/80 border-border hover:border-primary/30 transition-all shadow-xs">
                <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0 mt-0.5">
                      <Globe className="h-5 w-5" />
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-foreground truncate">{s.name}</span>
                        <Badge variant="outline" className={`text-[10px] font-semibold ${
                          s.is_enabled 
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' 
                            : 'bg-muted text-muted-foreground border-border'
                        }`}>
                          {s.is_enabled ? 'Enabled (Active)' : 'Disabled'}
                        </Badge>
                        {s.ssl_enabled && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 font-medium flex items-center gap-1 border border-blue-500/20">
                            <ShieldCheck className="h-3 w-3" /> SSL Active
                          </span>
                        )}
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {s.domains.length > 0 ? (
                          s.domains.map((d, i) => (
                            <span key={i} className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-foreground border border-border/50">
                              {d}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Default / Catch-all</span>
                        )}
                      </div>

                      {s.proxy_pass && (
                        <div className="text-xs text-muted-foreground font-mono mt-1">
                          Proxy Pass: <span className="text-foreground font-medium">{s.proxy_pass}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => handleEdit(s)} className="h-8 text-xs">
                      <FileCode2 className="h-3.5 w-3.5 mr-1.5" />
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
      )}

      {/* Tab View 2: SSL Certificate Expiry Watchdog & Renewal Cockpit */}
      {activeTab === 'ssl' && (
        <SslCockpit serverId={serverId} />
      )}


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
