import { useState, useEffect } from 'react';
import { 
  Rocket, 
  FolderGit2, 
  Settings2, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  AlertCircle,
  FolderCode,
  Server as ServerIcon,
  ChevronDown,
  ChevronUp,
  Folder,
  Clock,
  Calendar,
  Play,
  Trash2,
  Zap,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { 
  type Application, 
  type RebuildProfile, 
  type ScheduledRebuild,
  listApplications, 
  createApplication, 
  listProfiles, 
  triggerRebuild, 
  abortPipeline,
  scheduleRebuild,
  listScheduledRebuilds,
  cancelScheduledRebuild,
  runScheduledRebuildNow
} from '@/lib/tauri-client';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { cn } from 'cn';

interface ServerRebuildDeckProps {
  serverId: string;
}

interface StepStatus {
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  output: string | null;
  exit_code: number | null;
}

export const ServerRebuildDeck = ({ serverId }: ServerRebuildDeckProps) => {
  const [applications, setApplications] = useState<Application[]>([]);
  const [profiles, setProfiles] = useState<RebuildProfile[]>([]);
  const [scheduledRebuilds, setScheduledRebuilds] = useState<ScheduledRebuild[]>([]);
  const [rebuildMode, setRebuildMode] = useState<'zero_downtime' | 'direct'>('zero_downtime');

  // Schedule Modal State
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<'frontend' | 'backend' | 'both'>('frontend');
  const [scheduledTime, setScheduledTime] = useState('');
  const [isRecurringNightly, setIsRecurringNightly] = useState(true);

  // Configuration Modal state
  const [configApp, setConfigApp] = useState<{
    id?: string;
    type: 'frontend' | 'backend' | 'custom';
    name: string;
    repo_path: string;
    pm2_name: string;
    branch: string;
    package_mgr: string;
    profile_id?: string;
  } | null>(null);

  // Active Execution Pipeline State
  const [activePipeline, setActivePipeline] = useState<{
    pipelineId: string;
    appName: string;
    targetPath: string;
    status: 'running' | 'success' | 'failed' | 'aborted';
  } | null>(null);
  const [stepStatuses, setStepStatuses] = useState<Record<number, StepStatus>>({});
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  useEffect(() => {
    loadData();
    // Default scheduled time to tonight at 3:00 AM
    setScheduledTime(getTonightAt3AM());
  }, [serverId]);

  const loadData = async () => {
    try {
      const [apps, profs, scheduled] = await Promise.all([
        listApplications(serverId),
        listProfiles(),
        listScheduledRebuilds(serverId),
      ]);
      setApplications(apps);
      setProfiles(profs);
      setScheduledRebuilds(scheduled);
    } catch (e: any) {
      console.error('Failed to load apps/profiles:', e);
    }
  };

  // Helper date presets
  function getTonightAt3AM(): string {
    const d = new Date();
    if (d.getHours() >= 3) {
      d.setDate(d.getDate() + 1);
    }
    d.setHours(3, 0, 0, 0);
    return formatForDateTimeLocal(d);
  }

  function getTonightAt4AM(): string {
    const d = new Date();
    if (d.getHours() >= 4) {
      d.setDate(d.getDate() + 1);
    }
    d.setHours(4, 0, 0, 0);
    return formatForDateTimeLocal(d);
  }

  function getInHours(hours: number): string {
    const d = new Date(Date.now() + hours * 3600 * 1000);
    return formatForDateTimeLocal(d);
  }

  function formatForDateTimeLocal(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatTimeRemaining(scheduledIso: string): string {
    const diffMs = new Date(scheduledIso).getTime() - Date.now();
    if (diffMs <= 0) return 'Due now';
    const totalMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `in ${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
      return `in ${hours}h ${mins}m`;
    }
    return `in ${mins}m`;
  }

  function formatPrettyDate(isoString: string): string {
    try {
      const d = new Date(isoString);
      return d.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  }

  // Find frontend and backend applications from DB, or use sensible defaults
  const frontendApp = applications.find(a => 
    a.name.toLowerCase().includes('front') || 
    (a.repo_path && a.repo_path.toLowerCase().includes('front')) ||
    (a.pm2_name && a.pm2_name.toLowerCase().includes('front'))
  );

  const backendApp = applications.find(a => 
    a.name.toLowerCase().includes('back') || 
    (a.repo_path && a.repo_path.toLowerCase().includes('back')) ||
    (a.pm2_name && a.pm2_name.toLowerCase().includes('back'))
  );

  // Listen to active pipeline events
  useEffect(() => {
    let unlistenUpdate: UnlistenFn;
    let unlistenComplete: UnlistenFn;
    let unlistenScheduled: UnlistenFn;

    if (activePipeline?.pipelineId) {
      const pid = activePipeline.pipelineId;
      listen<any>(`pipeline://step-update:${pid}`, (event) => {
        const payload = event.payload;
        setStepStatuses(prev => ({
          ...prev,
          [payload.step_index]: {
            status: payload.status,
            output: payload.output,
            exit_code: payload.exit_code,
          }
        }));
      }).then(fn => unlistenUpdate = fn);

      listen<any>(`pipeline://complete:${pid}`, (event) => {
        const completeStatus = event.payload.status;
        setActivePipeline(prev => prev ? { ...prev, status: completeStatus } : null);
        if (completeStatus === 'success') {
          toast.success(`Rebuild completed successfully for ${activePipeline.appName}!`);
        } else if (completeStatus === 'failed') {
          toast.error(`Rebuild failed for ${activePipeline.appName}`);
        }
      }).then(fn => unlistenComplete = fn);
    }

    // Listen to scheduler events
    listen<any>('rebuild://scheduled-update', () => {
      loadData();
    }).then(fn => unlistenScheduled = fn);

    return () => {
      if (unlistenUpdate) unlistenUpdate();
      if (unlistenComplete) unlistenComplete();
      if (unlistenScheduled) unlistenScheduled();
    };
  }, [activePipeline?.pipelineId]);

  const handleStartRebuild = async (type: 'frontend' | 'backend', targetApp?: Application) => {
    try {
      let app = targetApp;

      // If app doesn't exist in DB, create it first
      if (!app) {
        const defaultName = type === 'frontend' ? 'Frontend App' : 'Backend App';
        const defaultPath = type === 'frontend' ? '/var/www/frontend' : '/var/www/backend';
        const defaultPm2 = type === 'frontend' ? 'frontend' : 'backend';
        
        const matchingProfile = profiles.find(p => {
          if (rebuildMode === 'zero_downtime') {
            return type === 'frontend' ? p.name.includes('Zero-Downtime') && p.name.includes('Next') : p.name.includes('Zero-Downtime') && p.name.includes('Nest');
          } else {
            return p.name.includes('Direct') || (type === 'frontend' ? p.name.includes('Next') : p.name.includes('Nest'));
          }
        }) || profiles[0];

        app = await createApplication({
          server_id: serverId,
          name: defaultName,
          repo_path: defaultPath,
          pm2_name: defaultPm2,
          branch: 'main',
          package_mgr: 'bun',
          rebuild_profile_id: matchingProfile?.id
        });
        await loadData();
      }

      // Pick profile according to current mode
      let profileId = app.rebuild_profile_id;
      if (rebuildMode === 'zero_downtime') {
        const zdProfile = profiles.find(p => 
          type === 'frontend' 
            ? p.name.includes('Zero-Downtime') && p.name.includes('Next')
            : p.name.includes('Zero-Downtime') && p.name.includes('Nest')
        );
        if (zdProfile) profileId = zdProfile.id;
      } else {
        const directProfile = profiles.find(p => p.name.includes('Direct'));
        if (directProfile) profileId = directProfile.id;
      }

      if (!profileId && profiles.length > 0) {
        profileId = profiles[0].id;
      }

      if (!profileId) {
        toast.error('No rebuild profile available');
        return;
      }

      setStepStatuses({});
      setExpandedStep(null);
      
      const pid = await triggerRebuild(app.id, profileId);
      setActivePipeline({
        pipelineId: pid,
        appName: `${app.name} (${rebuildMode === 'zero_downtime' ? 'Zero-Downtime' : 'Direct Build'})`,
        targetPath: app.repo_path || 'Default Working Directory',
        status: 'running'
      });
      toast.info(`Starting ${rebuildMode === 'zero_downtime' ? 'Zero-Downtime' : 'Direct'} pipeline for ${app.name}...`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to trigger rebuild');
    }
  };

  const handleCreateSchedule = async () => {
    if (!scheduledTime) {
      toast.error('Please specify a scheduled time');
      return;
    }

    try {
      const targetApp = scheduleTarget === 'frontend' ? frontendApp : backendApp;
      let appName = scheduleTarget === 'frontend' ? (frontendApp?.name || 'Frontend App') : (backendApp?.name || 'Backend App');
      
      if (scheduleTarget === 'both') {
        appName = 'Full Stack (Frontend + Backend)';
      }

      await scheduleRebuild({
        server_id: serverId,
        application_id: targetApp?.id,
        app_name: appName,
        service_type: scheduleTarget,
        mode: rebuildMode,
        profile_id: targetApp?.rebuild_profile_id ?? undefined,
        scheduled_for: new Date(scheduledTime).toISOString(),
        recurring: isRecurringNightly ? 'nightly_3am' : undefined,
      });

      await loadData();
      setScheduleModalOpen(false);
      toast.success(`Rebuild scheduled for ${formatPrettyDate(scheduledTime)}!`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to schedule rebuild');
    }
  };

  const handleCancelSchedule = async (id: string) => {
    try {
      await cancelScheduledRebuild(id);
      await loadData();
      toast.info('Scheduled deployment cancelled');
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel schedule');
    }
  };

  const handleRunScheduledNow = async (id: string) => {
    try {
      toast.info('Triggering scheduled deployment immediately...');
      await runScheduledRebuildNow(id);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to run deployment');
    }
  };

  const handleSaveConfig = async () => {
    if (!configApp) return;
    try {
      await createApplication({
        server_id: serverId,
        name: configApp.name,
        repo_path: configApp.repo_path,
        pm2_name: configApp.pm2_name,
        branch: configApp.branch || 'main',
        package_mgr: configApp.package_mgr || 'bun',
        rebuild_profile_id: configApp.profile_id || profiles[0]?.id
      });
      await loadData();
      setConfigApp(null);
      toast.success(`Application "${configApp.name}" saved!`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save application');
    }
  };

  const handleAbort = async () => {
    if (!activePipeline) return;
    try {
      await abortPipeline(activePipeline.pipelineId);
      toast.warning('Rebuild pipeline aborted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to abort');
    }
  };

  const defaultFrontendProfile = profiles.find(p => p.name.includes('Next') || p.name.includes('Bun')) || profiles[0];
  const defaultBackendProfile = profiles.find(p => p.name.includes('Nest') || p.name.includes('Node')) || profiles[0];

  return (
    <div className="space-y-6">
      {/* Header Deck Description with Mode Switcher & Schedule Action */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl border border-border bg-card/80 shadow-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Rocket className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-base text-foreground">Directory Rebuilder & Deploy Center</h3>
            
            {/* Mode Indicator Badge */}
            <Badge 
              variant="outline" 
              className={cn(
                "text-[11px] font-mono px-2.5 py-0.5 rounded-full flex items-center gap-1",
                rebuildMode === 'zero_downtime'
                  ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20"
              )}
            >
              {rebuildMode === 'zero_downtime' ? (
                <>
                  <Zap className="w-3 h-3 text-emerald-500" /> Zero-Downtime Parallel Swap
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3 h-3 text-amber-500" /> Direct In-Place Build (Maintenance)
                </>
              )}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Automate remote git pull, dependencies, memory-safe compiling, and PM2 process reloads with zero customer interruption.
          </p>
        </div>

        {/* Controls: Mode Toggle + Schedule + Add Target */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {/* Mode Selector Pill */}
          <div className="flex items-center p-1 rounded-xl bg-muted/60 border border-border text-xs">
            <button
              type="button"
              onClick={() => setRebuildMode('zero_downtime')}
              className={cn(
                "flex items-center gap-1 px-3 py-1 rounded-lg font-medium transition-all cursor-pointer text-xs",
                rebuildMode === 'zero_downtime'
                  ? "bg-background text-foreground shadow-sm border border-border font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Zap className="w-3.5 h-3.5 text-emerald-500" />
              <span>Zero-Downtime</span>
            </button>
            <button
              type="button"
              onClick={() => setRebuildMode('direct')}
              className={cn(
                "flex items-center gap-1 px-3 py-1 rounded-lg font-medium transition-all cursor-pointer text-xs",
                rebuildMode === 'direct'
                  ? "bg-background text-foreground shadow-sm border border-border font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span>Direct Build</span>
            </button>
          </div>

          {/* Schedule Deployment Button */}
          <Button
            variant="outline"
            size="sm"
            className="border-border text-xs gap-1.5 bg-card/60 hover:bg-muted"
            onClick={() => {
              setScheduleTarget('frontend');
              setScheduledTime(getTonightAt3AM());
              setScheduleModalOpen(true);
            }}
          >
            <Clock className="h-3.5 w-3.5 text-primary" />
            Schedule Nightly Deploy
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="border-border text-xs shrink-0"
            onClick={() => setConfigApp({
              type: 'custom',
              name: 'Custom Service',
              repo_path: '/var/www/',
              pm2_name: 'app',
              branch: 'main',
              package_mgr: 'bun',
              profile_id: profiles[0]?.id
            })}
          >
            <FolderCode className="h-3.5 w-3.5 mr-1.5" />
            Add Target
          </Button>
        </div>
      </div>

      {/* Scheduled Deployments Queue Banner (if any) */}
      {scheduledRebuilds.length > 0 && (
        <div className="p-4 rounded-2xl border border-sky-500/20 bg-sky-500/5 dark:bg-sky-950/20 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400">
              <Calendar className="w-4 h-4" />
              <span className="font-semibold text-xs tracking-wide uppercase">
                Scheduled Deployments Queue ({scheduledRebuilds.filter(s => s.status === 'pending').length} Pending)
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground font-mono">
              Background Scheduler Active
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {scheduledRebuilds.map((job) => {
              const isPending = job.status === 'pending';

              return (
                <div 
                  key={job.id} 
                  className="p-3.5 rounded-xl border border-border bg-card/90 shadow-sm flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-xs text-foreground truncate">
                        {job.app_name}
                      </span>
                      <Badge variant="outline" className="text-[9px] uppercase font-mono px-1.5 py-0 border-border bg-muted/60">
                        {job.mode === 'zero_downtime' ? '⚡ 0-Downtime' : '⚠️ Direct'}
                      </Badge>
                      {job.recurring && (
                        <Badge variant="outline" className="text-[9px] bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 font-mono">
                          <RotateCcw className="w-2.5 h-2.5 mr-1 inline" /> Every Night 3 AM
                        </Badge>
                      )}
                    </div>

                    <div className="text-[11px] text-muted-foreground flex items-center gap-2 font-mono">
                      <Clock className="w-3 h-3 text-primary shrink-0" />
                      <span>{formatPrettyDate(job.scheduled_for)}</span>
                      <span>•</span>
                      <span className="text-primary font-semibold">
                        {isPending ? formatTimeRemaining(job.scheduled_for) : job.status}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isPending && (
                      <Button
                        size="sm"
                        variant="outline"
                        title="Run this deployment immediately"
                        onClick={() => handleRunScheduledNow(job.id)}
                        className="h-7 px-2 text-[11px] border-border hover:bg-muted text-foreground gap-1"
                      >
                        <Play className="w-3 h-3 text-emerald-500" />
                        Run Now
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Cancel scheduled run"
                      onClick={() => handleCancelSchedule(job.id)}
                      className="h-7 w-7 text-muted-foreground hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Target Directory Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Frontend App */}
        <div className="p-6 rounded-2xl border border-border bg-card/90 hover:border-border/80 transition-all duration-300 shadow-xl flex flex-col justify-between gap-5 relative overflow-hidden group">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500 dark:text-blue-400">
                  <FolderGit2 className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-foreground flex items-center gap-2">
                    {frontendApp?.name || 'Main Frontend Directory'}
                    <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-500 dark:text-blue-400 border-blue-500/20 font-medium">
                      Frontend
                    </Badge>
                  </h4>
                  <div className="text-xs text-muted-foreground font-mono flex items-center gap-1.5 mt-0.5">
                    <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{frontendApp?.repo_path || '/var/www/frontend'}</span>
                  </div>
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                title="Configure Frontend Directory"
                onClick={() => setConfigApp({
                  id: frontendApp?.id,
                  type: 'frontend',
                  name: frontendApp?.name || 'Frontend App',
                  repo_path: frontendApp?.repo_path || '/var/www/frontend',
                  pm2_name: frontendApp?.pm2_name || 'frontend',
                  branch: frontendApp?.branch || 'main',
                  package_mgr: frontendApp?.package_mgr || 'bun',
                  profile_id: frontendApp?.rebuild_profile_id || defaultFrontendProfile?.id
                })}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>

            {/* Spec metadata chips */}
            <div className="grid grid-cols-3 gap-2 p-3.5 rounded-xl bg-muted/40 border border-border text-xs">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-mono">Branch</span>
                <p className="font-mono text-foreground font-medium">{frontendApp?.branch || 'main'}</p>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-mono">Package Mgr</span>
                <p className="font-mono text-foreground font-medium uppercase">{frontendApp?.package_mgr || 'bun'}</p>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-mono">PM2 Process</span>
                <p className="font-mono text-foreground font-medium">{frontendApp?.pm2_name || 'frontend'}</p>
              </div>
            </div>

            {/* Steps Preview based on Mode */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                Automated Pipeline ({rebuildMode === 'zero_downtime' ? 'Zero-Downtime Parallel Staging' : 'Direct In-Place'}):
              </span>
              {rebuildMode === 'zero_downtime' ? (
                <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono text-muted-foreground">
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">1. git pull</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">2. isolate tmp sync</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">3. cached deps</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">4. staged build</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">5. atomic .next swap</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20">6. pm2 reload</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono text-muted-foreground">
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">1. git pull</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">2. bun install</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">3. bun run build</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20">4. pm2 restart</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button
              size="default"
              className="flex-1 bg-primary text-primary-foreground font-semibold shadow-md border border-border flex items-center justify-center gap-2"
              onClick={() => handleStartRebuild('frontend', frontendApp)}
            >
              <Rocket className="h-4 w-4" />
              Rebuild Frontend Now
            </Button>
            <Button
              size="default"
              variant="outline"
              title="Schedule frontend rebuild for tonight"
              className="border-border text-xs px-3"
              onClick={() => {
                setScheduleTarget('frontend');
                setScheduledTime(getTonightAt3AM());
                setScheduleModalOpen(true);
              }}
            >
              <Clock className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Card 2: Backend Directory */}
        <div className="p-6 rounded-2xl border border-border bg-card/90 hover:border-border/80 transition-all duration-300 shadow-xl flex flex-col justify-between gap-5 relative overflow-hidden group">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-500 dark:text-purple-400">
                  <ServerIcon className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-foreground flex items-center gap-2">
                    {backendApp?.name || 'Backend Directory'}
                    <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-500 dark:text-purple-400 border-purple-500/20 font-medium">
                      Backend
                    </Badge>
                  </h4>
                  <div className="text-xs text-muted-foreground font-mono flex items-center gap-1.5 mt-0.5">
                    <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{backendApp?.repo_path || '/var/www/backend'}</span>
                  </div>
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                title="Configure Backend Directory"
                onClick={() => setConfigApp({
                  id: backendApp?.id,
                  type: 'backend',
                  name: backendApp?.name || 'Backend App',
                  repo_path: backendApp?.repo_path || '/var/www/backend',
                  pm2_name: backendApp?.pm2_name || 'backend',
                  branch: backendApp?.branch || 'main',
                  package_mgr: backendApp?.package_mgr || 'bun',
                  profile_id: backendApp?.rebuild_profile_id || defaultBackendProfile?.id
                })}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>

            {/* Spec metadata chips */}
            <div className="grid grid-cols-3 gap-2 p-3.5 rounded-xl bg-muted/40 border border-border text-xs">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-mono">Branch</span>
                <p className="font-mono text-foreground font-medium">{backendApp?.branch || 'main'}</p>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-mono">Package Mgr</span>
                <p className="font-mono text-foreground font-medium uppercase">{backendApp?.package_mgr || 'bun'}</p>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-mono">PM2 Process</span>
                <p className="font-mono text-foreground font-medium">{backendApp?.pm2_name || 'backend'}</p>
              </div>
            </div>

            {/* Steps Preview based on Mode */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                Automated Pipeline ({rebuildMode === 'zero_downtime' ? 'Prisma Sync & Cluster Reload' : 'Direct In-Place'}):
              </span>
              {rebuildMode === 'zero_downtime' ? (
                <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono text-muted-foreground">
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">1. git pull</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">2. 3GB heap deps</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">3. prisma sync</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">4. nest build</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20">5. pm2 cluster reload</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono text-muted-foreground">
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">1. git pull</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">2. bun install</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">3. prisma sync</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground">4. bun run build</span>
                  <span>→</span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20">5. pm2 restart</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button
              size="default"
              className="flex-1 bg-primary text-primary-foreground font-semibold shadow-md border border-border flex items-center justify-center gap-2"
              onClick={() => handleStartRebuild('backend', backendApp)}
            >
              <Rocket className="h-4 w-4" />
              Rebuild Backend Now
            </Button>
            <Button
              size="default"
              variant="outline"
              title="Schedule backend rebuild for tonight"
              className="border-border text-xs px-3"
              onClick={() => {
                setScheduleTarget('backend');
                setScheduledTime(getTonightAt3AM());
                setScheduleModalOpen(true);
              }}
            >
              <Clock className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Schedule Nightly / Custom Rebuild Modal */}
      <Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
        <DialogContent className="max-w-md bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" />
              Schedule Nightly / Off-Peak Deployment
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Run builds automatically while customer traffic is at its lowest (e.g. 3:00 AM) without staying up late.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            {/* Target Service Selection */}
            <div className="space-y-1.5">
              <label className="text-foreground font-medium">Target Service</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleTarget('frontend')}
                  className={cn(
                    "p-2.5 rounded-xl border text-center transition-all cursor-pointer font-medium",
                    scheduleTarget === 'frontend'
                      ? "border-primary bg-primary/10 text-primary font-semibold ring-1 ring-primary/20"
                      : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                  )}
                >
                  Frontend App
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleTarget('backend')}
                  className={cn(
                    "p-2.5 rounded-xl border text-center transition-all cursor-pointer font-medium",
                    scheduleTarget === 'backend'
                      ? "border-primary bg-primary/10 text-primary font-semibold ring-1 ring-primary/20"
                      : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                  )}
                >
                  Backend App
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleTarget('both')}
                  className={cn(
                    "p-2.5 rounded-xl border text-center transition-all cursor-pointer font-medium",
                    scheduleTarget === 'both'
                      ? "border-primary bg-primary/10 text-primary font-semibold ring-1 ring-primary/20"
                      : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                  )}
                >
                  Both Services
                </button>
              </div>
            </div>

            {/* Mode selection badge */}
            <div className="p-3 rounded-xl bg-muted/40 border border-border flex items-center justify-between">
              <span className="text-muted-foreground font-medium">Selected Mode</span>
              <Badge 
                variant="outline"
                className={cn(
                  "font-mono text-[10px]",
                  rebuildMode === 'zero_downtime'
                    ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20"
                )}
              >
                {rebuildMode === 'zero_downtime' ? '⚡ Zero-Downtime Swap' : '⚠️ Direct Build'}
              </Badge>
            </div>

            {/* Quick 1-Click Time Presets */}
            <div className="space-y-1.5">
              <label className="text-foreground font-medium">Quick Time Presets</label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setScheduledTime(getTonightAt3AM())}
                  className="h-8 text-xs border-border bg-card/60 hover:bg-muted justify-start gap-1.5"
                >
                  <span>🌙</span> Tonight @ 03:00 AM
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setScheduledTime(getTonightAt4AM())}
                  className="h-8 text-xs border-border bg-card/60 hover:bg-muted justify-start gap-1.5"
                >
                  <span>🌙</span> Tonight @ 04:00 AM
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setScheduledTime(getInHours(2))}
                  className="h-8 text-xs border-border bg-card/60 hover:bg-muted justify-start gap-1.5"
                >
                  <span>⏱️</span> In 2 Hours
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setScheduledTime(getInHours(4))}
                  className="h-8 text-xs border-border bg-card/60 hover:bg-muted justify-start gap-1.5"
                >
                  <span>⏱️</span> In 4 Hours
                </Button>
              </div>
            </div>

            {/* Custom DateTime Input */}
            <div className="space-y-1.5">
              <label className="text-foreground font-medium">Scheduled Run Time</label>
              <Input
                type="datetime-local"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="bg-background border-input text-xs"
              />
              <p className="text-[11px] text-muted-foreground font-mono">
                Will run: {scheduledTime ? formatPrettyDate(scheduledTime) : 'Not specified'} ({scheduledTime ? formatTimeRemaining(scheduledTime) : ''})
              </p>
            </div>

            {/* Recurring Nightly Checkbox */}
            <label className="flex items-center gap-2 p-3 rounded-xl bg-muted/30 border border-border cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isRecurringNightly}
                onChange={(e) => setIsRecurringNightly(e.target.checked)}
                className="rounded border-input text-primary focus:ring-primary w-4 h-4"
              />
              <div className="text-xs">
                <span className="font-medium text-foreground block">Repeat Every Night at 03:00 AM</span>
                <span className="text-[11px] text-muted-foreground">Automatically schedules the next night after each successful run</span>
              </div>
            </label>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setScheduleModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateSchedule} className="bg-primary text-primary-foreground font-semibold">
              Confirm & Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Directory Configuration Modal */}
      {configApp && (
        <Dialog open={!!configApp} onOpenChange={(open) => !open && setConfigApp(null)}>
          <DialogContent className="max-w-md bg-card border-border text-foreground">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-primary" />
                Configure Directory Target
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Set the exact working directory path on the remote server and the matching PM2 process name.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              <div className="space-y-1.5">
                <label className="text-foreground font-medium">Application Name</label>
                <Input
                  value={configApp.name}
                  onChange={(e) => setConfigApp({ ...configApp, name: e.target.value })}
                  placeholder="e.g. Frontend App"
                  className="bg-background border-input text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-foreground font-medium">Target Working Directory (repo_path)</label>
                <Input
                  value={configApp.repo_path}
                  onChange={(e) => setConfigApp({ ...configApp, repo_path: e.target.value })}
                  placeholder="/var/www/frontend or /var/www/backend"
                  className="bg-background border-input font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Build steps (<code>git pull</code>, <code>bun install</code>, etc.) will execute inside this directory.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-foreground font-medium">PM2 Process Name</label>
                  <Input
                    value={configApp.pm2_name}
                    onChange={(e) => setConfigApp({ ...configApp, pm2_name: e.target.value })}
                    placeholder="e.g. frontend"
                    className="bg-background border-input font-mono text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-foreground font-medium">Git Branch</label>
                  <Input
                    value={configApp.branch}
                    onChange={(e) => setConfigApp({ ...configApp, branch: e.target.value })}
                    placeholder="main"
                    className="bg-background border-input font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-foreground font-medium">Package Manager</label>
                  <select
                    value={configApp.package_mgr}
                    onChange={(e) => setConfigApp({ ...configApp, package_mgr: e.target.value })}
                    className="w-full h-9 rounded-md bg-background border border-input px-3 text-xs text-foreground focus:outline-none"
                  >
                    <option value="bun">bun</option>
                    <option value="npm">npm</option>
                    <option value="pnpm">pnpm</option>
                    <option value="yarn">yarn</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-foreground font-medium">Build Profile</label>
                  <select
                    value={configApp.profile_id}
                    onChange={(e) => setConfigApp({ ...configApp, profile_id: e.target.value })}
                    className="w-full h-9 rounded-md bg-background border border-input px-3 text-xs text-foreground focus:outline-none"
                  >
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfigApp(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveConfig} className="bg-primary text-primary-foreground font-semibold">
                Save Target
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Live Rebuild Pipeline Execution Dialog */}
      {activePipeline && (
        <Dialog open={!!activePipeline} onOpenChange={(open) => !open && activePipeline.status !== 'running' && setActivePipeline(null)}>
          <DialogContent className="max-w-2xl bg-card border-border text-foreground max-h-[85vh] flex flex-col p-6 shadow-2xl">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {activePipeline.status === 'running' && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                  {activePipeline.status === 'success' && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                  {activePipeline.status === 'failed' && <XCircle className="h-5 w-5 text-rose-500" />}
                  {activePipeline.status === 'aborted' && <AlertCircle className="h-5 w-5 text-amber-500" />}
                  <DialogTitle className="text-base font-semibold">
                    Rebuilding: {activePipeline.appName}
                  </DialogTitle>
                </div>

                <Badge variant="outline" className={`capitalize text-xs ${
                  activePipeline.status === 'running' ? 'bg-primary/10 text-primary border-primary/20' :
                  activePipeline.status === 'success' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                  activePipeline.status === 'failed' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {activePipeline.status}
                </Badge>
              </div>
              <DialogDescription className="text-xs font-mono text-muted-foreground mt-1">
                Target Directory: {activePipeline.targetPath}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto space-y-3 py-4 pr-1">
              {/* Step Checklist */}
              {Object.keys(stepStatuses).length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span>Connecting to SSH channel and preparing pipeline execution...</span>
                </div>
              ) : (
                Object.entries(stepStatuses).map(([idxStr, step]) => {
                  const idx = parseInt(idxStr, 10);
                  const isExpanded = expandedStep === idx;
                  return (
                    <div key={idx} className="border border-border rounded-xl bg-muted/30 overflow-hidden">
                      <div 
                        className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-muted/60 transition-colors"
                        onClick={() => setExpandedStep(isExpanded ? null : idx)}
                      >
                        <div className="flex items-center gap-2.5">
                          {step.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
                          {step.status === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
                          {step.status === 'failed' && <XCircle className="h-4 w-4 text-rose-500 shrink-0" />}
                          {step.status === 'pending' && <span className="h-4 w-4 rounded-full border border-border shrink-0" />}
                          {step.status === 'skipped' && <span className="h-4 w-4 rounded-full bg-muted-foreground/30 shrink-0" />}
                          <span className="text-xs font-medium text-foreground">
                            Step {idx + 1}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] capitalize font-mono font-medium ${
                            step.status === 'success' ? 'text-emerald-500 dark:text-emerald-400' :
                            step.status === 'failed' ? 'text-rose-500 dark:text-rose-400' :
                            step.status === 'running' ? 'text-primary' : 'text-muted-foreground'
                          }`}>
                            {step.status}
                          </span>
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                        </div>
                      </div>

                      {isExpanded && step.output && (
                        <div className="p-3.5 bg-black/90 dark:bg-black/90 border-t border-border font-mono text-[11px] text-zinc-300 max-h-52 overflow-y-auto whitespace-pre-wrap select-text">
                          {step.output}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <DialogFooter className="flex justify-between items-center sm:justify-between border-t border-border pt-3">
              <span className="text-[11px] text-muted-foreground font-mono">
                Pipeline ID: {activePipeline.pipelineId.slice(0, 8)}...
              </span>

              <div className="flex items-center gap-2">
                {activePipeline.status === 'running' ? (
                  <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={handleAbort}>
                    Abort Pipeline
                  </Button>
                ) : (
                  <Button size="sm" className="h-8 text-xs" onClick={() => setActivePipeline(null)}>
                    Done
                  </Button>
                )}
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
