import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { 
  Sparkles, 
  RefreshCw, 
  DownloadCloud, 
  ExternalLink, 
  Loader2, 
  ShieldCheck, 
  Smartphone,
  Check,
  FileText,
  Calendar,
  Layers,
  GitCommit,
  GitBranch,
  ChevronDown,
  ChevronUp,
  Cpu,
  Laptop
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from 'cn';
import { 
  checkForUpdates, 
  fetchReleaseHistory, 
  APP_VERSION, 
  GITHUB_REPO, 
  type UpdateCheckResult, 
  type ReleaseHistoryItem,
  type ReleaseAssetInfo
} from '@/lib/update-checker';

export const UpdateTracker = () => {
  const [checking, setChecking] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [releases, setReleases] = useState<ReleaseHistoryItem[]>([]);
  const [autoCheck, setAutoCheck] = useState<boolean>(true);
  const [notifyOnUpdate, setNotifyOnUpdate] = useState<boolean>(true);
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const savedAutoCheck = localStorage.getItem('auto_check_updates') !== 'false';
    const savedNotify = localStorage.getItem('notify_on_update') !== 'false';
    setAutoCheck(savedAutoCheck);
    setNotifyOnUpdate(savedNotify);

    loadReleases();
  }, []);

  const loadReleases = async () => {
    setLoadingHistory(true);
    try {
      const history = await fetchReleaseHistory();
      setReleases(history);
      // Auto-expand the latest release
      if (history.length > 0) {
        setExpandedNotes(prev => ({ ...prev, [history[0].tagName]: true }));
      }
    } catch (err: any) {
      console.error('Failed to load release history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      const result = await checkForUpdates();
      setUpdateResult(result);
      await loadReleases();

      if (result.hasUpdate) {
        toast.info(`New update available: v${result.latestVersion}`, {
          description: result.releaseName,
          action: {
            label: 'View',
            onClick: () => window.open(result.htmlUrl, '_blank'),
          },
        });
      } else {
        toast.success(`Server Command Center is up to date (v${APP_VERSION})`);
      }
    } catch (err: any) {
      toast.error('Update check failed', {
        description: err.message || 'Could not connect to GitHub API.',
      });
    } finally {
      setChecking(false);
    }
  };

  const handleToggleAutoCheck = (checked: boolean) => {
    setAutoCheck(checked);
    localStorage.setItem('auto_check_updates', checked ? 'true' : 'false');
    toast.success(checked ? 'Automatic update check enabled on launch' : 'Automatic update check disabled');
  };

  const handleToggleNotify = (checked: boolean) => {
    setNotifyOnUpdate(checked);
    localStorage.setItem('notify_on_update', checked ? 'true' : 'false');
    toast.success(checked ? 'Update desktop notifications enabled' : 'Update notifications disabled');
  };

  const toggleExpand = (tagName: string) => {
    setExpandedNotes(prev => ({ ...prev, [tagName]: !prev[tagName] }));
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(0)} KB`;
  };

  const formatDate = (isoString: string): string => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  const getAssetBadge = (type: ReleaseAssetInfo['type']) => {
    switch (type) {
      case 'installer':
        return <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded font-medium">Windows Setup</span>;
      case 'portable':
        return <span className="text-[10px] bg-sky-500/10 text-sky-500 border border-sky-500/20 px-1.5 py-0.5 rounded font-medium">Portable EXE</span>;
      case 'apk':
        return <span className="text-[10px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-1.5 py-0.5 rounded font-medium">Android APK</span>;
      case 'checksums':
        return <span className="text-[10px] bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded font-mono">SHA-256</span>;
      default:
        return <span className="text-[10px] bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded">Asset</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <Card className="bg-card/90 border border-border shadow-lg rounded-2xl overflow-hidden relative">
        <div className="absolute top-0 right-0 w-80 h-80 bg-primary/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <CardContent className="p-6 sm:p-7 relative">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      Software Updates & Release Tracker
                    </h2>
                    <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-mono font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1.5" />
                      v{APP_VERSION} Active
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Server Command Center • Powered by Falah Tech (<a href="https://falah-tech.com" target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium">falah-tech.com</a>)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground font-mono">
                <span className="text-foreground font-semibold">Stream:</span>
                <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">Production Stable</span>
                <span>•</span>
                <span className="truncate max-w-[280px]" title={GITHUB_REPO}>github.com/{GITHUB_REPO}</span>
              </div>
            </div>

            {/* Quick Action Deck */}
            <div className="flex items-center gap-2.5 flex-wrap self-start md:self-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`https://github.com/${GITHUB_REPO}/releases`, '_blank')}
                className="text-xs h-9 border-border hover:bg-accent text-foreground"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                View on GitHub
              </Button>

              <Button
                size="sm"
                onClick={handleCheckUpdate}
                disabled={checking}
                className="text-xs h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm font-semibold"
              >
                {checking ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Checking GitHub...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Check for Updates
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live Status Alert */}
      {updateResult && (
        <div className="animate-in fade-in duration-200">
          {updateResult.hasUpdate ? (
            <Card className="border-amber-500/40 bg-amber-500/10 shadow-md">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-black">
                        NEW UPDATE AVAILABLE
                      </span>
                      <span className="text-sm font-bold text-foreground">
                        v{updateResult.latestVersion} ({updateResult.releaseName})
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Published on {formatDate(updateResult.publishedAt)}
                    </p>
                  </div>

                  <a
                    href={updateResult.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
                  >
                    View Full Release Notes <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {updateResult.releaseNotes && (
                  <div className="p-3.5 rounded-xl bg-background/80 border border-border text-xs text-muted-foreground max-h-44 overflow-y-auto whitespace-pre-line font-mono leading-relaxed">
                    {updateResult.releaseNotes}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  {updateResult.exeInstallerUrl && (
                    <a
                      href={updateResult.exeInstallerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-xs"
                    >
                      <DownloadCloud className="w-4 h-4" />
                      Download Windows Setup (.exe)
                    </a>
                  )}
                  {updateResult.exePortableUrl && (
                    <a
                      href={updateResult.exePortableUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-border bg-card hover:bg-muted text-foreground transition-all"
                    >
                      <DownloadCloud className="w-4 h-4" />
                      Download Portable Binary (.exe)
                    </a>
                  )}
                  {updateResult.apkUrl && (
                    <a
                      href={updateResult.apkUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-all"
                    >
                      <Smartphone className="w-4 h-4" />
                      Download Android APK
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-emerald-500/30 bg-emerald-500/5 shadow-xs">
              <CardContent className="p-4 flex items-center justify-between text-xs flex-wrap gap-2">
                <div className="flex items-center gap-2.5 text-emerald-600 dark:text-emerald-400 font-medium">
                  <ShieldCheck className="w-5 h-5 shrink-0" />
                  <span>You are running the latest version (v{APP_VERSION}). Your system is completely up to date.</span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Checked on {new Date().toLocaleTimeString()}
                </span>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Auto-Update Preferences Deck */}
      <Card className="bg-card border border-border shadow-xs rounded-2xl">
        <CardHeader className="p-5 pb-3 border-b border-border/50">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" /> Update Checking & Notification Preferences
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Configure how Server Command Center monitors and notifies you of new software builds.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-border bg-muted/30">
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-foreground">Automatic Update Checks</p>
              <p className="text-[11px] text-muted-foreground">
                Silently query the GitHub release feed whenever Server Command Center is launched.
              </p>
            </div>
            <Switch
              checked={autoCheck}
              onCheckedChange={handleToggleAutoCheck}
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-border bg-muted/30">
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-foreground">Desktop Notifications</p>
              <p className="text-[11px] text-muted-foreground">
                Display an in-app banner toast when a new installer or mobile APK is detected.
              </p>
            </div>
            <Switch
              checked={notifyOnUpdate}
              onCheckedChange={handleToggleNotify}
            />
          </div>
        </CardContent>
      </Card>

      {/* Release Timeline & Changelog History */}
      <Card className="bg-card border border-border shadow-xs rounded-2xl">
        <CardHeader className="p-5 pb-3 border-b border-border/50 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-indigo-500" /> Releases & Changelog Timeline
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              History of all production releases, installers, and compiled binaries for Server Command Center.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadReleases}
            disabled={loadingHistory}
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loadingHistory && "animate-spin")} />
            Reload Feed
          </Button>
        </CardHeader>
        <CardContent className="p-5 space-y-4">
          {releases.length === 0 && !loadingHistory ? (
            <div className="p-8 text-center border border-dashed border-border rounded-xl space-y-2">
              <FileText className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-xs text-muted-foreground">No release records retrieved from GitHub.</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {releases.map((rel) => {
                const isExpanded = expandedNotes[rel.tagName] || false;

                return (
                  <div
                    key={rel.id}
                    className={cn(
                      "rounded-xl border transition-all overflow-hidden",
                      rel.isCurrent
                        ? "border-emerald-500/40 bg-emerald-500/5 shadow-xs"
                        : rel.isNewer
                        ? "border-amber-500/40 bg-amber-500/5 shadow-xs"
                        : "border-border bg-card/60 hover:border-border/80"
                    )}
                  >
                    {/* Header Row */}
                    <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "p-2.5 rounded-xl border text-sm shrink-0",
                          rel.isCurrent
                            ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                            : rel.isNewer
                            ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                            : "bg-muted text-muted-foreground border-border"
                        )}>
                          <GitCommit className="w-4 h-4" />
                        </div>

                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-foreground">{rel.tagName}</span>
                            <span className="text-xs text-muted-foreground font-medium">• {rel.name}</span>
                            {rel.isCurrent && (
                              <Badge className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-semibold">
                                <Check className="w-3 h-3 mr-1" /> Installed Version
                              </Badge>
                            )}
                            {rel.isNewer && (
                              <Badge className="text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold">
                                Newer Release
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                            <Calendar className="w-3 h-3" />
                            <span>Released {formatDate(rel.publishedAt)}</span>
                            <span>•</span>
                            <span>{rel.assets.length} binary assets</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleExpand(rel.tagName)}
                          className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1"
                        >
                          <span>{isExpanded ? 'Hide Notes' : 'Changelog'}</span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </Button>

                        <a
                          href={rel.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="Open release on GitHub"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>

                    {/* Expandable Release Notes & Assets */}
                    {isExpanded && (
                      <div className="p-4 pt-0 border-t border-border/40 space-y-3.5 animate-in fade-in duration-150">
                        {/* Release Notes */}
                        {rel.body && (
                          <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60 text-xs text-muted-foreground font-mono whitespace-pre-line leading-relaxed max-h-56 overflow-y-auto">
                            {rel.body}
                          </div>
                        )}

                        {/* Downloadable Assets */}
                        {rel.assets.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider font-mono">
                              Compiled Binaries & Checksums
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {rel.assets.map((asset, idx) => (
                                <a
                                  key={idx}
                                  href={asset.downloadUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-2.5 rounded-lg border border-border bg-card/80 hover:border-primary/40 hover:bg-primary/5 transition-all flex items-center justify-between group"
                                >
                                  <div className="flex items-center gap-2 truncate pr-2">
                                    <DownloadCloud className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                                    <div className="truncate text-left">
                                      <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
                                        {asset.name}
                                      </p>
                                      <span className="text-[10px] text-muted-foreground font-mono">
                                        {formatFileSize(asset.size)}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="shrink-0">
                                    {getAssetBadge(asset.type)}
                                  </div>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* CI/CD Pipeline Architecture Card */}
      <Card className="bg-card border border-border shadow-xs rounded-2xl">
        <CardHeader className="p-5 pb-3 border-b border-border/50">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Cpu className="w-4 h-4 text-muted-foreground" /> Automated Release Build Pipeline
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Multi-target compilation orchestrated via GitHub Actions runners.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase font-mono">Runner: windows-latest</span>
              <p className="font-semibold text-xs text-foreground">Windows x64 Installer</p>
              <span className="text-[10px] text-muted-foreground">Tauri NSIS (*-setup.exe)</span>
            </div>

            <div className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase font-mono">Runner: windows-latest</span>
              <p className="font-semibold text-xs text-foreground">Portable Executable</p>
              <span className="text-[10px] text-muted-foreground">server-command-center.exe</span>
            </div>

            <div className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase font-mono">Runner: ubuntu-latest</span>
              <p className="font-semibold text-xs text-foreground">Android ARM64 Package</p>
              <span className="text-[10px] text-muted-foreground">Rust aarch64 + APK Bundle</span>
            </div>

            <div className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase font-mono">Security Checksums</span>
              <p className="font-semibold text-xs text-foreground">SHA-256 Manifest</p>
              <span className="text-[10px] text-muted-foreground">checksums-windows-x64.txt</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 mt-3 border-t border-border/50 text-xs">
            <span className="text-muted-foreground">
              Monitor active runner compilation and workflow executions:
            </span>
            <a
              href={`https://github.com/${GITHUB_REPO}/actions`}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline flex items-center gap-1 font-medium text-xs"
            >
              GitHub Actions Logs <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Platform & Engine Architecture */}
      <Card className="bg-card border border-border shadow-xs rounded-2xl">
        <CardHeader className="p-5 pb-3 border-b border-border/50">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Laptop className="w-4 h-4 text-muted-foreground" /> Platform & Engine Architecture
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Runtime dependencies, local encrypted vault, and asynchronous networking core.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase font-mono">Application</span>
              <p className="font-semibold text-xs text-foreground">Server Command Center</p>
              <span className="text-[10px] text-muted-foreground">v{APP_VERSION} (Falah Tech)</span>
            </div>

            <div className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase font-mono">SSH Core</span>
              <p className="font-semibold text-xs text-foreground">russh 0.45</p>
              <span className="text-[10px] text-muted-foreground">Pure Rust Async Engine</span>
            </div>

            <div className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase font-mono">Storage Engine</span>
              <p className="font-semibold text-xs text-foreground">SQLite 3 (WAL Mode)</p>
              <span className="text-[10px] text-muted-foreground">Local Encrypted Store</span>
            </div>

            <div className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase font-mono">Vault Encryption</span>
              <p className="font-semibold text-xs text-foreground">Argon2id + AES-256</p>
              <span className="text-[10px] text-muted-foreground">Hardware Keychain Support</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
