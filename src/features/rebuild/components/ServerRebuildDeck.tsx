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
  Folder
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
  listApplications, 
  createApplication, 
  listProfiles, 
  triggerRebuild, 
  abortPipeline 
} from '@/lib/tauri-client';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';

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
  }, [serverId]);

  const loadData = async () => {
    try {
      const [apps, profs] = await Promise.all([
        listApplications(serverId),
        listProfiles()
      ]);
      setApplications(apps);
      setProfiles(profs);
    } catch (e: any) {
      console.error('Failed to load apps/profiles:', e);
    }
  };

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

    return () => {
      if (unlistenUpdate) unlistenUpdate();
      if (unlistenComplete) unlistenComplete();
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
        
        // Pick appropriate profile
        const matchingProfile = profiles.find(p => 
          type === 'frontend' ? p.name.includes('Next') || p.name.includes('Bun') : p.name.includes('Nest') || p.name.includes('Node')
        ) || profiles[0];

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

      const profileId = app.rebuild_profile_id || profiles[0]?.id;
      if (!profileId) {
        toast.error('No rebuild profile available');
        return;
      }

      setStepStatuses({});
      setExpandedStep(null);
      
      const pid = await triggerRebuild(app.id, profileId);
      setActivePipeline({
        pipelineId: pid,
        appName: app.name,
        targetPath: app.repo_path || 'Default Working Directory',
        status: 'running'
      });
      toast.info(`Starting rebuild pipeline for ${app.name}...`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to trigger rebuild');
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
      {/* Header Deck Description */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border border-white/10 bg-zinc-950/70 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-base text-foreground">Directory Rebuilder & Deploy Center</h3>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Zero-Downtime
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Execute automated build pipelines directly in your remote <code>frontend/</code> and <code>backend/</code> directories: pulls latest git commits, installs packages, runs build scripts, and reloads PM2.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="border-white/10 text-xs shrink-0"
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
          Add Directory Target
        </Button>
      </div>

      {/* Target Directory Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Frontend App ("mind fountain") */}
        <div className="p-6 rounded-2xl border border-white/10 bg-zinc-950/80 hover:border-white/20 transition-all duration-300 shadow-xl flex flex-col justify-between gap-5 relative overflow-hidden group">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                  <FolderGit2 className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-foreground flex items-center gap-2">
                    {frontendApp?.name || 'Main Frontend Directory'}
                    <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20">
                      Frontend
                    </Badge>
                  </h4>
                  <div className="text-xs text-muted-foreground font-mono flex items-center gap-1.5 mt-0.5">
                    <Folder className="h-3.5 w-3.5 text-zinc-500" />
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
            <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-zinc-900/50 border border-white/5 text-xs">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-mono">Branch</span>
                <p className="font-mono text-zinc-300 font-medium">{frontendApp?.branch || 'main'}</p>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-mono">Package Mgr</span>
                <p className="font-mono text-zinc-300 font-medium uppercase">{frontendApp?.package_mgr || 'bun'}</p>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-mono">PM2 Process</span>
                <p className="font-mono text-zinc-300 font-medium">{frontendApp?.pm2_name || 'frontend'}</p>
              </div>
            </div>

            {/* Steps Preview */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Automated Pipeline:</span>
              <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono text-zinc-400">
                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-white/5">1. git pull</span>
                <span>→</span>
                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-white/5">2. bun install</span>
                <span>→</span>
                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-white/5">3. bun run build</span>
                <span>→</span>
                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-white/5">4. pm2 reload</span>
              </div>
            </div>
          </div>

          <Button
            size="default"
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
            onClick={() => handleStartRebuild('frontend', frontendApp)}
          >
            <Rocket className="h-4 w-4" />
            Rebuild Frontend
          </Button>
        </div>

        {/* Card 2: Backend Directory ("bacon directory") */}
        <div className="p-6 rounded-2xl border border-white/10 bg-zinc-950/80 hover:border-white/20 transition-all duration-300 shadow-xl flex flex-col justify-between gap-5 relative overflow-hidden group">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                  <ServerIcon className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-foreground flex items-center gap-2">
                    {backendApp?.name || 'Backend Directory'}
                    <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20">
                      Backend
                    </Badge>
                  </h4>
                  <div className="text-xs text-muted-foreground font-mono flex items-center gap-1.5 mt-0.5">
                    <Folder className="h-3.5 w-3.5 text-zinc-500" />
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
            <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-zinc-900/50 border border-white/5 text-xs">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-mono">Branch</span>
                <p className="font-mono text-zinc-300 font-medium">{backendApp?.branch || 'main'}</p>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-mono">Package Mgr</span>
                <p className="font-mono text-zinc-300 font-medium uppercase">{backendApp?.package_mgr || 'bun'}</p>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-mono">PM2 Process</span>
                <p className="font-mono text-zinc-300 font-medium">{backendApp?.pm2_name || 'backend'}</p>
              </div>
            </div>

            {/* Steps Preview */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Automated Pipeline:</span>
              <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono text-zinc-400">
                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-white/5">1. git pull</span>
                <span>→</span>
                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-white/5">2. bun install</span>
                <span>→</span>
                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-white/5">3. bun run build</span>
                <span>→</span>
                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-white/5">4. pm2 restart</span>
              </div>
            </div>
          </div>

          <Button
            size="default"
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
            onClick={() => handleStartRebuild('backend', backendApp)}
          >
            <Rocket className="h-4 w-4" />
            Rebuild Backend
          </Button>
        </div>
      </div>

      {/* Directory Configuration Modal */}
      {configApp && (
        <Dialog open={!!configApp} onOpenChange={(open) => !open && setConfigApp(null)}>
          <DialogContent className="max-w-md bg-zinc-950 border-white/10 text-foreground">
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
                <label className="text-muted-foreground font-medium">Application Name</label>
                <Input
                  value={configApp.name}
                  onChange={(e) => setConfigApp({ ...configApp, name: e.target.value })}
                  placeholder="e.g. Frontend App"
                  className="bg-zinc-900/60 border-white/10 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-muted-foreground font-medium">Target Working Directory (repo_path)</label>
                <Input
                  value={configApp.repo_path}
                  onChange={(e) => setConfigApp({ ...configApp, repo_path: e.target.value })}
                  placeholder="/var/www/frontend or /var/www/backend"
                  className="bg-zinc-900/60 border-white/10 font-mono text-xs"
                />
                <p className="text-[11px] text-zinc-500">
                  Build steps (<code>git pull</code>, <code>bun install</code>, etc.) will execute inside this directory.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-muted-foreground font-medium">PM2 Process Name</label>
                  <Input
                    value={configApp.pm2_name}
                    onChange={(e) => setConfigApp({ ...configApp, pm2_name: e.target.value })}
                    placeholder="e.g. frontend"
                    className="bg-zinc-900/60 border-white/10 font-mono text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-muted-foreground font-medium">Git Branch</label>
                  <Input
                    value={configApp.branch}
                    onChange={(e) => setConfigApp({ ...configApp, branch: e.target.value })}
                    placeholder="main"
                    className="bg-zinc-900/60 border-white/10 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-muted-foreground font-medium">Package Manager</label>
                  <select
                    value={configApp.package_mgr}
                    onChange={(e) => setConfigApp({ ...configApp, package_mgr: e.target.value })}
                    className="w-full h-9 rounded-md bg-zinc-900 border border-white/10 px-3 text-xs text-foreground focus:outline-none"
                  >
                    <option value="bun">bun</option>
                    <option value="npm">npm</option>
                    <option value="pnpm">pnpm</option>
                    <option value="yarn">yarn</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-muted-foreground font-medium">Build Profile</label>
                  <select
                    value={configApp.profile_id}
                    onChange={(e) => setConfigApp({ ...configApp, profile_id: e.target.value })}
                    className="w-full h-9 rounded-md bg-zinc-900 border border-white/10 px-3 text-xs text-foreground focus:outline-none"
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
              <Button size="sm" onClick={handleSaveConfig}>
                Save Target
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Live Rebuild Pipeline Execution Dialog */}
      {activePipeline && (
        <Dialog open={!!activePipeline} onOpenChange={(open) => !open && activePipeline.status !== 'running' && setActivePipeline(null)}>
          <DialogContent className="max-w-2xl bg-zinc-950 border-white/10 text-foreground max-h-[85vh] flex flex-col p-6">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {activePipeline.status === 'running' && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                  {activePipeline.status === 'success' && <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
                  {activePipeline.status === 'failed' && <XCircle className="h-5 w-5 text-rose-400" />}
                  {activePipeline.status === 'aborted' && <AlertCircle className="h-5 w-5 text-amber-400" />}
                  <DialogTitle className="text-base font-semibold">
                    Rebuilding: {activePipeline.appName}
                  </DialogTitle>
                </div>

                <Badge variant="outline" className={`capitalize text-xs ${
                  activePipeline.status === 'running' ? 'bg-primary/10 text-primary border-primary/20' :
                  activePipeline.status === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                  activePipeline.status === 'failed' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                  'bg-zinc-800 text-zinc-400'
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
                    <div key={idx} className="border border-white/10 rounded-xl bg-zinc-900/50 overflow-hidden">
                      <div 
                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                        onClick={() => setExpandedStep(isExpanded ? null : idx)}
                      >
                        <div className="flex items-center gap-2.5">
                          {step.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
                          {step.status === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />}
                          {step.status === 'failed' && <XCircle className="h-4 w-4 text-rose-400 shrink-0" />}
                          {step.status === 'pending' && <span className="h-4 w-4 rounded-full border border-zinc-600 shrink-0" />}
                          {step.status === 'skipped' && <span className="h-4 w-4 rounded-full bg-zinc-700 shrink-0" />}
                          <span className="text-xs font-medium text-foreground">
                            Step {idx + 1}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] capitalize font-mono ${
                            step.status === 'success' ? 'text-emerald-400' :
                            step.status === 'failed' ? 'text-rose-400' :
                            step.status === 'running' ? 'text-primary' : 'text-zinc-500'
                          }`}>
                            {step.status}
                          </span>
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                        </div>
                      </div>

                      {isExpanded && step.output && (
                        <div className="p-3 bg-black/90 border-t border-white/5 font-mono text-[11px] text-zinc-300 max-h-52 overflow-y-auto whitespace-pre-wrap select-text">
                          {step.output}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <DialogFooter className="flex justify-between items-center sm:justify-between border-t border-white/5 pt-3">
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
