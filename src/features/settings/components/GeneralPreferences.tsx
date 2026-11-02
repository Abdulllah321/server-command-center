import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Terminal, 
  Cpu, 
  Laptop,
  Sun,
  Moon,
  Monitor,
  Palette,
  Check,
  RefreshCw,
  DownloadCloud,
  ExternalLink,
  Loader2,
  Sparkles,
  ShieldCheck,
  Smartphone
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { cn } from 'cn';
import { checkForUpdates, APP_VERSION, GITHUB_REPO, type UpdateCheckResult } from '@/lib/update-checker';

export const GeneralPreferences = () => {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [terminalPreference, setTerminalPreference] = useState<string>('windows_terminal');
  const [pollInterval, setPollInterval] = useState<string>('30');
  
  // Update state
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [autoCheckUpdate, setAutoCheckUpdate] = useState<boolean>(true);

  useEffect(() => {
    setMounted(true);
    const savedTerminal = localStorage.getItem('terminal_preference') || 'windows_terminal';
    const savedPoll = localStorage.getItem('telemetry_poll_interval') || '30';
    const savedAutoCheck = localStorage.getItem('auto_check_updates') !== 'false';
    setTerminalPreference(savedTerminal);
    setPollInterval(savedPoll);
    setAutoCheckUpdate(savedAutoCheck);
  }, []);

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    const label = newTheme === 'system' ? 'System Theme (Auto Sync)' : newTheme === 'light' ? 'Light Theme' : 'Dark Cockpit Theme';
    toast.success(`Appearance changed to ${label}`);
  };

  const handleTerminalChange = (val: string) => {
    setTerminalPreference(val);
    localStorage.setItem('terminal_preference', val);
    toast.success(`External terminal preference set to ${val === 'windows_terminal' ? 'Windows Terminal' : 'PowerShell'}`);
  };

  const handlePollChange = (val: string) => {
    setPollInterval(val);
    localStorage.setItem('telemetry_poll_interval', val);
    toast.success(`Telemetry refresh interval updated to ${val}s`);
  };

  const handleAutoCheckToggle = () => {
    const next = !autoCheckUpdate;
    setAutoCheckUpdate(next);
    localStorage.setItem('auto_check_updates', String(next));
    toast.success(next ? 'Automatic update checks enabled' : 'Automatic update checks disabled');
  };

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const res = await checkForUpdates();
      setUpdateResult(res);
      if (res.hasUpdate) {
        toast.info(`New version available: v${res.latestVersion}!`, {
          description: 'Click below to download the latest setup installer or APK.',
        });
      } else {
        toast.success('You are on the latest version of Server Command Center!');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to check for updates';
      toast.error(msg);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const currentTheme = mounted ? theme : 'dark';

  return (
    <div className="space-y-6">
      {/* Theme & Visual Appearance Preference */}
      <Card className="bg-card/80 border border-border shadow-xl rounded-2xl">
        <CardHeader className="p-6 pb-4 border-b border-border/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Palette className="w-4 h-4 text-primary" /> Visual Appearance & Theme
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Customize the UI theme for daylight readability, low-light cockpit contrast, or automatic OS matching.
              </CardDescription>
            </div>
            {mounted && (
              <Badge variant="outline" className="text-[11px] font-mono border-border bg-muted/60 self-start sm:self-auto capitalize">
                Current: {currentTheme} {currentTheme === 'system' ? `(${resolvedTheme})` : ''}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-6 pt-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Light Mode Option */}
            <button
              type="button"
              onClick={() => handleThemeChange('light')}
              className={cn(
                "relative flex flex-col items-center justify-between p-5 rounded-xl border text-left transition-all duration-200 cursor-pointer group text-left",
                currentTheme === 'light'
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-md"
                  : "border-border bg-card/60 hover:border-primary/40 hover:bg-muted/40"
              )}
            >
              <div className="w-full flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
                  <Sun className="w-4 h-4" />
                </div>
                {currentTheme === 'light' && (
                  <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_currentColor]" />
                )}
              </div>
              <div className="w-full space-y-1">
                <p className="font-semibold text-xs text-foreground flex items-center justify-between">
                  Light Theme
                  {currentTheme === 'light' && <Check className="w-3.5 h-3.5 text-primary" />}
                </p>
                <p className="text-[11px] text-muted-foreground leading-normal">
                  Crisp daylight interface with slate contrast and high-visibility typography.
                </p>
              </div>
            </button>

            {/* Dark Mode Option */}
            <button
              type="button"
              onClick={() => handleThemeChange('dark')}
              className={cn(
                "relative flex flex-col items-center justify-between p-5 rounded-xl border text-left transition-all duration-200 cursor-pointer group text-left",
                currentTheme === 'dark'
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-md"
                  : "border-border bg-card/60 hover:border-primary/40 hover:bg-muted/40"
              )}
            >
              <div className="w-full flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
                  <Moon className="w-4 h-4" />
                </div>
                {currentTheme === 'dark' && (
                  <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_currentColor]" />
                )}
              </div>
              <div className="w-full space-y-1">
                <p className="font-semibold text-xs text-foreground flex items-center justify-between">
                  Dark Cockpit
                  {currentTheme === 'dark' && <Check className="w-3.5 h-3.5 text-primary" />}
                </p>
                <p className="text-[11px] text-muted-foreground leading-normal">
                  Deep charcoal and obsidian cockpit aesthetic optimized for server operations.
                </p>
              </div>
            </button>

            {/* System Option */}
            <button
              type="button"
              onClick={() => handleThemeChange('system')}
              className={cn(
                "relative flex flex-col items-center justify-between p-5 rounded-xl border text-left transition-all duration-200 cursor-pointer group text-left",
                currentTheme === 'system'
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-md"
                  : "border-border bg-card/60 hover:border-primary/40 hover:bg-muted/40"
              )}
            >
              <div className="w-full flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center border border-sky-500/20">
                  <Monitor className="w-4 h-4" />
                </div>
                {currentTheme === 'system' && (
                  <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_currentColor]" />
                )}
              </div>
              <div className="w-full space-y-1">
                <p className="font-semibold text-xs text-foreground flex items-center justify-between">
                  System Theme
                  {currentTheme === 'system' && <Check className="w-3.5 h-3.5 text-primary" />}
                </p>
                <p className="text-[11px] text-muted-foreground leading-normal">
                  Automatically adapts to your Windows / macOS desktop dark/light mode preference.
                </p>
              </div>
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Terminal Configuration */}
        <Card className="bg-card/80 border border-border shadow-xl rounded-2xl">
          <CardHeader className="p-6 pb-4 border-b border-border/50">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Terminal className="w-4 h-4 text-primary" /> External SSH Terminal
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Choose which host terminal emulator launches when clicking External SSH.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-5 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Default Terminal Application</label>
              <Select 
                value={terminalPreference} 
                onValueChange={(val) => { if (val) handleTerminalChange(val); }}
              >
                <SelectTrigger className="h-9 text-xs bg-background border-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-xs">
                  <SelectItem value="windows_terminal">
                    Windows Terminal (wt.exe) — Recommended
                  </SelectItem>
                  <SelectItem value="powershell">
                    Windows PowerShell (powershell.exe)
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Both emulators automatically receive saved credentials via Server Command Center's secure askpass bridge.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Telemetry Polling */}
        <Card className="bg-card/80 border border-border shadow-xl rounded-2xl">
          <CardHeader className="p-6 pb-4 border-b border-border/50">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-500 dark:text-emerald-400" /> Live Telemetry Polling
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Control the background sampling frequency for CPU, RAM, and Disk metrics.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-5 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Sampling Rate</label>
              <Select 
                value={pollInterval} 
                onValueChange={(val) => { if (val) handlePollChange(val); }}
              >
                <SelectTrigger className="h-9 text-xs bg-background border-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-xs">
                  <SelectItem value="10">10 Seconds — High Precision</SelectItem>
                  <SelectItem value="30">30 Seconds — Balanced (Recommended)</SelectItem>
                  <SelectItem value="60">60 Seconds — Low Bandwidth</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Background metrics are paused automatically when the server tab is not actively focused.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Software Updates & Release Channel (Powered by Falah Tech) */}
      <Card className="bg-card/80 border border-border shadow-xl rounded-2xl">
        <CardHeader className="p-6 pb-4 border-b border-border/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <RefreshCw className={cn("w-4 h-4 text-primary", isCheckingUpdate && "animate-spin")} />
                Software Updates & Releases
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Check for official updates, new feature releases, and mobile APK builds from GitHub.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[11px] font-mono border-primary/30 bg-primary/10 text-primary">
                v{APP_VERSION} Stable
              </Badge>
              <Badge variant="outline" className="text-[10px] text-muted-foreground border-border bg-muted/60">
                Falah Tech Channel
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 pt-5 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border/70 bg-muted/30">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Release Stream: Production
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Targeting <code className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono text-foreground">{GITHUB_REPO}</code>
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAutoCheckToggle}
                className={cn(
                  "text-xs h-8 cursor-pointer",
                  autoCheckUpdate ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                )}
                title="Toggle automatic update checks on launch"
              >
                {autoCheckUpdate ? (
                  <span className="flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Auto-check ON
                  </span>
                ) : (
                  <span>Auto-check OFF</span>
                )}
              </Button>

              <Button
                size="sm"
                onClick={handleCheckUpdate}
                disabled={isCheckingUpdate}
                className="text-xs h-8 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer shadow-xs"
              >
                {isCheckingUpdate ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Checking...
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

          {/* Update Result Display */}
          {updateResult && (
            <div className="space-y-3 animate-in fade-in duration-200">
              {updateResult.hasUpdate ? (
                <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-black">
                          NEW UPDATE AVAILABLE
                        </span>
                        <span className="text-xs font-bold text-foreground">
                          v{updateResult.latestVersion} ({updateResult.releaseName})
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Published on {new Date(updateResult.publishedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <a
                      href={updateResult.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0"
                    >
                      Release Notes <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  {updateResult.releaseNotes && (
                    <div className="p-3 rounded-lg bg-background/80 border border-border text-[11px] text-muted-foreground max-h-36 overflow-y-auto whitespace-pre-line font-mono">
                      {updateResult.releaseNotes}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {updateResult.exeInstallerUrl && (
                      <a
                        href={updateResult.exeInstallerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs"
                      >
                        <DownloadCloud className="w-3.5 h-3.5" />
                        Download Windows Setup (.exe)
                      </a>
                    )}
                    {updateResult.exePortableUrl && (
                      <a
                        href={updateResult.exePortableUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card hover:bg-muted text-foreground transition-colors"
                      >
                        <DownloadCloud className="w-3.5 h-3.5" />
                        Download Portable (.exe)
                      </a>
                    )}
                    {updateResult.apkUrl && (
                      <a
                        href={updateResult.apkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        Download Android APK (.apk)
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>Your application is completely up to date (version {APP_VERSION}).</span>
                  </div>
                  <a
                    href={updateResult.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    View Releases <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* System Diagnostics & Platform Overview */}
      <Card className="bg-card/80 border border-border shadow-xl rounded-2xl">
        <CardHeader className="p-6 pb-4 border-b border-border/50">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Laptop className="w-4 h-4 text-muted-foreground" /> Platform & Engine Architecture
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            Underlying runtime dependencies, local databases, and cryptographic engines.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 pt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-border bg-muted/40 space-y-1">
              <span className="text-[11px] text-muted-foreground uppercase font-mono">Application</span>
              <p className="font-semibold text-xs text-foreground">Server Command Center</p>
              <span className="text-[10px] text-muted-foreground">v1.0.0 (Falah Tech)</span>
            </div>

            <div className="p-4 rounded-xl border border-border bg-muted/40 space-y-1">
              <span className="text-[11px] text-muted-foreground uppercase font-mono">SSH Subsystem</span>
              <p className="font-semibold text-xs text-foreground">russh 0.45 (Async)</p>
              <span className="text-[10px] text-muted-foreground">Pure Rust SSH2 Client</span>
            </div>

            <div className="p-4 rounded-xl border border-border bg-muted/40 space-y-1">
              <span className="text-[11px] text-muted-foreground uppercase font-mono">Local Database</span>
              <p className="font-semibold text-xs text-foreground">SQLite 3 (WAL Mode)</p>
              <span className="text-[10px] text-muted-foreground">Foreign Keys & Cascades ON</span>
            </div>

            <div className="p-4 rounded-xl border border-border bg-muted/40 space-y-1">
              <span className="text-[11px] text-muted-foreground uppercase font-mono">Credential Security</span>
              <p className="font-semibold text-xs text-foreground">Windows Credential Mgr</p>
              <span className="text-[10px] text-muted-foreground">+ Argon2id / AES-256 Vault</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
