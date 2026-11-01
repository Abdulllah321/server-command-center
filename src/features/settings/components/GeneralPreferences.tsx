import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { 
  Terminal, 
  Cpu, 
  Laptop,
  Sun,
  Moon,
  Monitor,
  Palette,
  Check
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { cn } from 'cn';

export const GeneralPreferences = () => {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [terminalPreference, setTerminalPreference] = useState<string>('windows_terminal');
  const [pollInterval, setPollInterval] = useState<string>('30');

  useEffect(() => {
    setMounted(true);
    const savedTerminal = localStorage.getItem('terminal_preference') || 'windows_terminal';
    const savedPoll = localStorage.getItem('telemetry_poll_interval') || '30';
    setTerminalPreference(savedTerminal);
    setPollInterval(savedPoll);
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
                Both emulators automatically receive saved credentials via Veyra's secure askpass bridge.
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
              <p className="font-semibold text-xs text-foreground">Veyra Command Center</p>
              <span className="text-[10px] text-muted-foreground">v1.0.0 (Tauri v2 Desktop)</span>
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
