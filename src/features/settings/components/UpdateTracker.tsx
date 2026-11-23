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
  Copy
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from 'cn';
import { listen } from '@tauri-apps/api/event';
import { downloadAndInstallUpdate, openExternalUrl, type DownloadUpdateProgressPayload } from '@/lib/tauri-client';
import { 
  checkForUpdates, 
  fetchReleaseHistory, 
  APP_VERSION, 
  GITHUB_REPO, 
  DOCUMENTED_CHANGELOGS,
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
  const [installingUpdate, setInstallingUpdate] = useState<{
    isInstalling: boolean;
    tagName: string;
    percent: number;
    downloadedBytes: number;
    totalBytes: number;
    status: 'downloading' | 'launching' | 'error';
    errorMessage?: string;
  } | null>(null);

  const handleInstallUpdate = async (release: ReleaseHistoryItem) => {
    const installerAsset = release.assets.find(a => a.type === 'installer')
      || release.assets.find(a => a.name.toLowerCase().endsWith('-setup.exe'))
      || release.assets.find(a => a.name.toLowerCase().endsWith('.exe'));

    if (!installerAsset) {
      toast.error('No Windows installer found for this release. Opening GitHub release page...', {
        action: {
          label: 'Open',
          onClick: () => window.open(release.htmlUrl, '_blank'),
        },
      });
      return;
    }

    setInstallingUpdate({
      isInstalling: true,
      tagName: release.tagName,
      percent: 0,
      downloadedBytes: 0,
      totalBytes: installerAsset.size,
      status: 'downloading',
    });

    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen<DownloadUpdateProgressPayload>('update-download-progress', (event) => {
        setInstallingUpdate(prev => prev ? {
          ...prev,
          percent: event.payload.percent,
          downloadedBytes: event.payload.downloaded_bytes,
          totalBytes: event.payload.total_bytes,
        } : null);
      });

      toast.info(`Downloading ${installerAsset.name}...`);

      await downloadAndInstallUpdate({
        downloadUrl: installerAsset.downloadUrl,
        filename: installerAsset.name,
        totalBytes: installerAsset.size,
      });

      setInstallingUpdate(prev => prev ? { ...prev, status: 'launching', percent: 100 } : null);
      toast.success('Download complete! Launching updated version in-place...');
    } catch (err: any) {
      console.error('Update install error:', err);
      toast.error('Update installation failed', {
        description: err?.message || String(err),
      });
      setInstallingUpdate(prev => prev ? {
        ...prev,
        status: 'error',
        errorMessage: err?.message || String(err),
      } : null);
    } finally {
      if (unlisten) unlisten();
    }
  };

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
                    Server Command Center • Powered by Falah Tech (<button type="button" onClick={() => openExternalUrl("https://falah-tech.com")} className="text-primary hover:underline font-medium inline">falah-tech.com</button>)
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
                onClick={() => openExternalUrl(`https://github.com/${GITHUB_REPO}/releases`)}
                className="text-xs h-9 border-border hover:bg-accent text-foreground cursor-pointer"
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

                  <button
                    type="button"
                    onClick={() => openExternalUrl(updateResult.htmlUrl)}
                    className="text-xs text-primary hover:underline flex items-center gap-1 font-medium cursor-pointer"
                  >
                    View Full Release Notes <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>

                {updateResult.releaseNotes && (
                  <div className="p-3.5 rounded-xl bg-background/80 border border-border text-xs text-muted-foreground max-h-44 overflow-y-auto whitespace-pre-line font-mono leading-relaxed">
                    {updateResult.releaseNotes}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  {updateResult.exeInstallerUrl && (
                    <Button
                      onClick={() => {
                        const targetRel = releases.find(r => r.cleanVersion === updateResult.latestVersion || r.tagName === `v${updateResult.latestVersion}`);
                        if (targetRel) {
                          handleInstallUpdate(targetRel);
                        } else {
                          const fakeRel: ReleaseHistoryItem = {
                            id: 0,
                            tagName: `v${updateResult.latestVersion}`,
                            cleanVersion: updateResult.latestVersion,
                            name: updateResult.releaseName,
                            body: updateResult.releaseNotes,
                            publishedAt: updateResult.publishedAt,
                            htmlUrl: updateResult.htmlUrl,
                            isPrerelease: false,
                            isCurrent: false,
                            isNewer: true,
                            assets: [{
                              name: `Server.Command.Center_${updateResult.latestVersion}_x64-setup.exe`,
                              downloadUrl: updateResult.exeInstallerUrl || updateResult.htmlUrl,
                              size: 0,
                              downloadCount: 0,
                              type: 'installer',
                            }],
                          };
                          handleInstallUpdate(fakeRel);
                        }
                      }}
                      disabled={installingUpdate?.isInstalling}
                      className="h-9 px-4 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-black gap-2 shadow-md cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4" />
                      1-Click Upgrade to v{updateResult.latestVersion} (In-Place)
                    </Button>
                  )}

                  {updateResult.exeInstallerUrl && (
                    <button
                      type="button"
                      onClick={() => openExternalUrl(updateResult.exeInstallerUrl!)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-border bg-card hover:bg-muted text-foreground transition-all cursor-pointer"
                    >
                      <DownloadCloud className="w-3.5 h-3.5" />
                      Download Setup Manually
                    </button>
                  )}

                  {updateResult.exePortableUrl && (
                    <button
                      type="button"
                      onClick={() => openExternalUrl(updateResult.exePortableUrl!)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-border bg-card hover:bg-muted text-foreground transition-all cursor-pointer"
                    >
                      <DownloadCloud className="w-3.5 h-3.5" />
                      Portable EXE
                    </button>
                  )}
                  {updateResult.apkUrl && (
                    <button
                      type="button"
                      onClick={() => openExternalUrl(updateResult.apkUrl!)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-all cursor-pointer"
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      Download Android APK
                    </button>
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

                      <div className="flex items-center gap-2 self-end sm:self-center flex-wrap">
                        {rel.isNewer && (
                          <Button
                            size="sm"
                            onClick={() => handleInstallUpdate(rel)}
                            disabled={installingUpdate?.isInstalling}
                            className="h-8 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-black gap-1.5 shadow-xs cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            1-Click Update
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleExpand(rel.tagName)}
                          className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1"
                        >
                          <span>{isExpanded ? 'Hide Changelog' : 'Changelog'}</span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </Button>

                        <button
                          type="button"
                          onClick={() => openExternalUrl(rel.htmlUrl)}
                          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                          title="Open release on GitHub"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expandable Documented Changelog & Assets */}
                    {isExpanded && (
                      <div className="p-4 pt-0 border-t border-border/40 space-y-4 animate-in fade-in duration-150">
                        {/* Documented Rich Changelog */}
                        {(() => {
                          const doc = DOCUMENTED_CHANGELOGS[rel.tagName]
                            || DOCUMENTED_CHANGELOGS[rel.cleanVersion]
                            || DOCUMENTED_CHANGELOGS[`v${rel.cleanVersion}`];

                          if (doc) {
                            return (
                              <div className="space-y-3 p-4 rounded-xl bg-card border border-border">
                                {/* Release Summary */}
                                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-foreground font-medium flex items-start gap-2.5">
                                  <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                                  <div>
                                    <span className="font-semibold text-primary">Overview: </span>
                                    <span>{doc.summary}</span>
                                  </div>
                                </div>

                                {/* Highlights */}
                                {doc.highlights && doc.highlights.length > 0 && (
                                  <div className="space-y-1.5">
                                    <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider font-mono flex items-center gap-1.5">
                                      <Check className="w-3.5 h-3.5 text-emerald-500" /> Key Highlights
                                    </span>
                                    <div className="grid grid-cols-1 gap-1.5">
                                      {doc.highlights.map((h, i) => (
                                        <div key={i} className="flex items-start gap-2 bg-muted/40 p-2.5 rounded-lg border border-border/50 text-xs text-foreground">
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                                          <span>{h}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Features & Fixes Columns */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                  {doc.features && doc.features.length > 0 && (
                                    <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-2">
                                      <span className="text-[11px] font-semibold text-emerald-500 uppercase tracking-wider flex items-center gap-1.5">
                                        🚀 New Features & Enhancements
                                      </span>
                                      <ul className="space-y-1.5 text-xs text-muted-foreground">
                                        {doc.features.map((f, i) => (
                                          <li key={i} className="flex items-start gap-2">
                                            <span className="text-emerald-500 font-bold">•</span>
                                            <span>{f}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {doc.fixes && doc.fixes.length > 0 && (
                                    <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-2">
                                      <span className="text-[11px] font-semibold text-sky-500 uppercase tracking-wider flex items-center gap-1.5">
                                        🛠️ Fixes & Improvements
                                      </span>
                                      <ul className="space-y-1.5 text-xs text-muted-foreground">
                                        {doc.fixes.map((f, i) => (
                                          <li key={i} className="flex items-start gap-2">
                                            <span className="text-sky-500 font-bold">•</span>
                                            <span>{f}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>

                                {/* Performance Notes */}
                                {doc.performance && doc.performance.length > 0 && (
                                  <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-2">
                                    <span className="text-[11px] font-semibold text-purple-500 uppercase tracking-wider flex items-center gap-1.5">
                                      ⚡ Performance & Resilience
                                    </span>
                                    <ul className="space-y-1.5 text-xs text-muted-foreground">
                                      {doc.performance.map((p, i) => (
                                        <li key={i} className="flex items-start gap-2">
                                          <span className="text-purple-500 font-bold">•</span>
                                          <span>{p}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            );
                          }

                          // Fallback to raw markdown body if no structured document
                          return rel.body ? (
                            <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60 text-xs text-muted-foreground font-mono whitespace-pre-line leading-relaxed max-h-56 overflow-y-auto">
                              {rel.body}
                            </div>
                          ) : null;
                        })()}

                        {/* Downloadable Assets */}
                        {rel.assets.length > 0 && (
                          <div className="space-y-1.5 pt-1">
                            <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider font-mono">
                              Compiled Binaries & Checksums
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {rel.assets.map((asset, idx) => {
                                const isInstaller = asset.type === 'installer';
                                return (
                                  <div
                                    key={idx}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      if (isInstaller && rel.isNewer) {
                                        handleInstallUpdate(rel);
                                      } else {
                                        openExternalUrl(asset.downloadUrl);
                                      }
                                    }}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      navigator.clipboard.writeText(asset.downloadUrl);
                                      toast.success(`Copied download URL for ${asset.name}`);
                                    }}
                                    className="p-2.5 rounded-lg border border-border bg-card/80 hover:border-primary/40 hover:bg-primary/5 transition-all flex items-center justify-between group cursor-pointer"
                                    title={isInstaller && rel.isNewer ? `Click to 1-Click Update to ${rel.tagName}` : `Click to download ${asset.name} (Right-click to copy link)`}
                                  >
                                    <div className="flex items-center gap-2 truncate pr-2">
                                      <DownloadCloud className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                                      <div className="truncate text-left">
                                        <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
                                          {asset.name}
                                        </p>
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] text-muted-foreground font-mono">
                                            {formatFileSize(asset.size)}
                                          </span>
                                          {isInstaller && rel.isNewer && (
                                            <span className="text-[10px] text-amber-500 font-semibold flex items-center gap-0.5">
                                              <Sparkles className="w-3 h-3 inline" /> 1-Click Update
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(asset.downloadUrl);
                                          toast.success(`Copied download URL for ${asset.name}`);
                                        }}
                                        title="Copy download URL"
                                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                      >
                                        <Copy className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          openExternalUrl(asset.downloadUrl);
                                        }}
                                        title="Download in external browser"
                                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                      </button>
                                      {getAssetBadge(asset.type)}
                                    </div>
                                  </div>
                                );
                              })}
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

      {/* In-App Installation Progress Modal */}
      {installingUpdate && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md border-primary/40 bg-card shadow-2xl rounded-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                <DownloadCloud className="w-5 h-5 text-primary animate-bounce" />
                Updating Server Command Center
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Upgrading to {installingUpdate.tagName} without uninstalling.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-2 space-y-4">
              {installingUpdate.status === 'downloading' && (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground font-medium">Downloading update package...</span>
                    <span className="font-mono font-bold text-primary">{installingUpdate.percent}%</span>
                  </div>

                  <div className="w-full bg-muted h-2.5 rounded-full overflow-hidden border border-border">
                    <div 
                      className="bg-primary h-full rounded-full transition-all duration-150 ease-out"
                      style={{ width: `${installingUpdate.percent}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                    <span>{formatFileSize(installingUpdate.downloadedBytes)} of {formatFileSize(installingUpdate.totalBytes)}</span>
                    <span className="text-emerald-500 font-medium">In-Place Upgrade</span>
                  </div>
                </>
              )}

              {installingUpdate.status === 'launching' && (
                <div className="flex flex-col items-center justify-center py-4 gap-2 text-center">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <p className="text-xs font-semibold text-foreground">Applying update and launching...</p>
                  <p className="text-[11px] text-muted-foreground">The application will restart into {installingUpdate.tagName} in a moment.</p>
                </div>
              )}

              {installingUpdate.status === 'error' && (
                <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-xs text-destructive space-y-2">
                  <p className="font-semibold">Update encountered an issue:</p>
                  <p className="font-mono text-[11px]">{installingUpdate.errorMessage}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setInstallingUpdate(null)}
                    className="mt-2 h-7 text-xs border-destructive/40"
                  >
                    Close
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
