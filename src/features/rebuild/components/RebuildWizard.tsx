import React, { useState, useEffect } from 'react';
import { 
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { 
  Application, RebuildProfile, 
  listApplications, createApplication, listProfiles, 
  triggerRebuild, abortPipeline, RebuildStep
} from '@/lib/tauri-client';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Play, Loader2, CheckCircle2, XCircle, AlertCircle, Rocket } from 'lucide-react';

interface RebuildWizardProps {
  serverId: string;
}

type WizardStep = 'select_app' | 'preview' | 'live';

interface StepStatus {
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  output: string | null;
  exit_code: number | null;
}

export const RebuildWizard = ({ serverId }: RebuildWizardProps) => {
  const [open, setOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>('select_app');
  
  // App Selection State
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [isNewApp, setIsNewApp] = useState(false);
  const [profiles, setProfiles] = useState<RebuildProfile[]>([]);
  
  // New App Form State
  const [newAppName, setNewAppName] = useState('');
  const [newAppRepo, setNewAppRepo] = useState('');
  const [newAppBranch, setNewAppBranch] = useState('main');
  const [newAppPkg, setNewAppPkg] = useState('bun');
  const [newAppPm2, setNewAppPm2] = useState('');
  const [newAppProfile, setNewAppProfile] = useState('');

  // Preview & Live State
  const [resolvedProfile, setResolvedProfile] = useState<RebuildProfile | null>(null);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [stepStatuses, setStepStatuses] = useState<Record<number, StepStatus>>({});
  const [pipelineCompleteStatus, setPipelineCompleteStatus] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      loadInitialData();
    } else {
      // Reset state on close
      setWizardStep('select_app');
      setPipelineId(null);
      setStepStatuses({});
      setPipelineCompleteStatus(null);
      setResolvedProfile(null);
    }
  }, [open, serverId]);

  const loadInitialData = async () => {
    try {
      const apps = await listApplications(serverId);
      setApplications(apps);
      const profs = await listProfiles();
      setProfiles(profs);
      
      if (apps.length > 0) {
        setSelectedAppId(apps[0].id);
        setIsNewApp(false);
      } else {
        setIsNewApp(true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleNextToPreview = async () => {
    try {
      let targetAppId = selectedAppId;
      let targetProfileId: string | null = null;
      
      if (isNewApp) {
        if (!newAppName || !newAppProfile) {
          alert('Name and Profile are required');
          return;
        }
        const app = await createApplication({
          server_id: serverId,
          name: newAppName,
          repo_path: newAppRepo || undefined,
          pm2_name: newAppPm2 || undefined,
          branch: newAppBranch,
          package_mgr: newAppPkg,
          rebuild_profile_id: newAppProfile,
        });
        targetAppId = app.id;
        targetProfileId = newAppProfile;
        
        // Refresh apps list
        const apps = await listApplications(serverId);
        setApplications(apps);
        setSelectedAppId(app.id);
        setIsNewApp(false);
      } else {
        const app = applications.find(a => a.id === targetAppId);
        targetProfileId = app?.rebuild_profile_id || null;
      }

      if (!targetAppId || !targetProfileId) {
        alert("Application must have an assigned Rebuild Profile");
        return;
      }

      const prof = profiles.find(p => p.id === targetProfileId);
      if (!prof) {
        alert("Selected profile not found");
        return;
      }

      // Add preflight checks virtually to the preview
      const fullSteps: RebuildStep[] = [
        { label: 'Check SSH connection', command: 'echo "SSH Connection Alive"', continue_on_error: false },
        { label: 'Check disk space', command: 'df -m / | awk ...', continue_on_error: false },
        ...prof.steps
      ];
      
      setResolvedProfile({ ...prof, steps: fullSteps });
      setWizardStep('preview');
      
    } catch (e) {
      alert(String(e));
    }
  };

  const startPipeline = async (retryFromStep?: number) => {
    if (!selectedAppId || !resolvedProfile) return;
    try {
      setWizardStep('live');
      
      if (retryFromStep === undefined) {
         setStepStatuses({});
         setPipelineCompleteStatus(null);
         setExpandedStep(null);
      } else {
         setPipelineCompleteStatus(null);
         // Keep existing statuses for steps < retryFromStep
      }
      
      const pid = await triggerRebuild(selectedAppId, resolvedProfile.id, retryFromStep);
      setPipelineId(pid);
    } catch (e) {
      alert(String(e));
      setWizardStep('preview');
    }
  };

  useEffect(() => {
    let unlistenUpdate: UnlistenFn;
    let unlistenComplete: UnlistenFn;

    if (pipelineId) {
      listen<any>(`pipeline://step-update:${pipelineId}`, (event) => {
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

      listen<any>(`pipeline://complete:${pipelineId}`, (event) => {
        setPipelineCompleteStatus(event.payload.status);
      }).then(fn => unlistenComplete = fn);
    }

    return () => {
      if (unlistenUpdate) unlistenUpdate();
      if (unlistenComplete) unlistenComplete();
    };
  }, [pipelineId]);

  const handleAbort = async () => {
    if (pipelineId) {
      try {
        await abortPipeline(pipelineId);
      } catch (e) {
        console.error(e);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default">
          <Rocket className="mr-2 h-4 w-4" /> Deploy / Rebuild
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Rebuild Wizard</DialogTitle>
          <DialogDescription>
            {wizardStep === 'select_app' && "Select an application to deploy."}
            {wizardStep === 'preview' && "Review the pipeline steps before execution."}
            {wizardStep === 'live' && "Executing deployment pipeline..."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {wizardStep === 'select_app' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border rounded p-3">
                <div className="flex items-center gap-2">
                  <input type="radio" checked={!isNewApp} onChange={() => setIsNewApp(false)} disabled={applications.length === 0} />
                  <span className={applications.length === 0 ? "text-muted-foreground" : ""}>Existing Application</span>
                </div>
                {!isNewApp && (
                  <Select value={selectedAppId || ''} onValueChange={setSelectedAppId}>
                    <SelectTrigger className="w-[250px]">
                      <SelectValue placeholder="Select App" />
                    </SelectTrigger>
                    <SelectContent>
                      {applications.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex items-start justify-between border rounded p-3">
                <div className="flex items-center gap-2 mt-2">
                  <input type="radio" checked={isNewApp} onChange={() => setIsNewApp(true)} />
                  <span>New Application</span>
                </div>
                {isNewApp && (
                  <div className="w-[400px] space-y-3">
                    <div>
                      <label className="text-xs">App Name</label>
                      <Input value={newAppName} onChange={e => setNewAppName(e.target.value)} placeholder="e.g. backend-api" />
                    </div>
                    <div>
                      <label className="text-xs">Repo Path</label>
                      <Input value={newAppRepo} onChange={e => setNewAppRepo(e.target.value)} placeholder="/var/www/app" />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-xs">Branch</label>
                        <Input value={newAppBranch} onChange={e => setNewAppBranch(e.target.value)} />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs">Package Manager</label>
                        <Select value={newAppPkg} onValueChange={setNewAppPkg}>
                          <SelectTrigger><SelectValue/></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="bun">bun</SelectItem>
                            <SelectItem value="npm">npm</SelectItem>
                            <SelectItem value="yarn">yarn</SelectItem>
                            <SelectItem value="pnpm">pnpm</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs">PM2 Name (Optional)</label>
                      <Input value={newAppPm2} onChange={e => setNewAppPm2(e.target.value)} placeholder="pm2-process-name" />
                    </div>
                    <div>
                      <label className="text-xs">Rebuild Profile</label>
                      <Select value={newAppProfile} onValueChange={setNewAppProfile}>
                        <SelectTrigger><SelectValue placeholder="Select Profile" /></SelectTrigger>
                        <SelectContent>
                          {profiles.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {wizardStep === 'preview' && resolvedProfile && (
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">{resolvedProfile.name}</h3>
              <div className="space-y-2">
                {resolvedProfile.steps.map((step, idx) => (
                  <div key={idx} className="p-3 border rounded-md flex items-center justify-between bg-muted/20">
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">{step.label}</span>
                      <span className="text-xs font-mono text-muted-foreground mt-1">{step.command}</span>
                    </div>
                    {step.continue_on_error && (
                      <Badge variant="outline" className="text-[10px]">Continue on Error</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {wizardStep === 'live' && resolvedProfile && (
            <div className="space-y-2">
              {resolvedProfile.steps.map((step, idx) => {
                const statusInfo = stepStatuses[idx];
                const status = statusInfo?.status || 'pending';
                const isFailed = status === 'failed';
                const output = statusInfo?.output;
                
                return (
                  <div key={idx} className={`border rounded-md overflow-hidden ${isFailed ? 'border-destructive' : 'border-border'}`}>
                    <div 
                      className={`p-3 flex items-center justify-between cursor-pointer ${status === 'running' ? 'bg-primary/5' : 'bg-card'}`}
                      onClick={() => setExpandedStep(expandedStep === idx ? null : idx)}
                    >
                      <div className="flex items-center gap-3">
                        {status === 'pending' && <div className="w-5 h-5 rounded-full border-2 border-muted" />}
                        {status === 'running' && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
                        {status === 'success' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                        {status === 'skipped' && <CheckCircle2 className="w-5 h-5 text-muted-foreground" />}
                        {status === 'failed' && <XCircle className="w-5 h-5 text-destructive" />}
                        
                        <div className="flex flex-col">
                          <span className={`font-medium text-sm ${status === 'pending' ? 'text-muted-foreground' : ''}`}>{step.label}</span>
                          <span className="text-xs text-muted-foreground">{status.toUpperCase()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isFailed && statusInfo.exit_code !== null && (
                          <Badge variant="destructive">Exit {statusInfo.exit_code}</Badge>
                        )}
                        {status === 'skipped' && (
                          <Badge variant="secondary">Skipped</Badge>
                        )}
                      </div>
                    </div>
                    
                    {/* Expandable output */}
                    {(expandedStep === idx || isFailed) && output && (
                      <div className="p-3 bg-black/90 text-green-400 font-mono text-xs overflow-x-auto whitespace-pre-wrap border-t border-border/50 max-h-48 overflow-y-auto">
                        {output.split('\n').slice(-20).join('\n')}
                      </div>
                    )}
                    
                    {isFailed && pipelineCompleteStatus === 'failed' && (
                       <div className="p-2 bg-destructive/10 border-t border-destructive/20 flex justify-end gap-2">
                         <Button variant="outline" size="sm" onClick={() => startPipeline(idx)}>
                           Retry from this step
                         </Button>
                       </div>
                    )}
                  </div>
                );
              })}
              
              {pipelineCompleteStatus === 'failed' && (
                <div className="mt-4 p-4 border border-destructive bg-destructive/10 rounded-md flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-destructive" />
                  <span className="font-medium text-destructive">Pipeline failed. Review the logs above.</span>
                </div>
              )}
              
              {pipelineCompleteStatus === 'success' && (
                <div className="mt-4 p-4 border border-green-500 bg-green-500/10 rounded-md flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <span className="font-medium text-green-600">Pipeline completed successfully!</span>
                </div>
              )}
              
              {pipelineCompleteStatus === 'aborted' && (
                <div className="mt-4 p-4 border border-yellow-500 bg-yellow-500/10 rounded-md flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-600" />
                  <span className="font-medium text-yellow-700">Pipeline was aborted by user.</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 pt-4 border-t shrink-0">
          {wizardStep === 'select_app' && (
            <Button onClick={handleNextToPreview}>Next: Preview Steps</Button>
          )}
          {wizardStep === 'preview' && (
            <div className="flex gap-2 w-full justify-end">
              <Button variant="outline" onClick={() => setWizardStep('select_app')}>Back</Button>
              <Button onClick={() => startPipeline()}>Start Rebuild</Button>
            </div>
          )}
          {wizardStep === 'live' && !pipelineCompleteStatus && (
            <Button variant="destructive" onClick={handleAbort}>Abort Pipeline</Button>
          )}
          {wizardStep === 'live' && pipelineCompleteStatus && (
            <Button variant="default" onClick={() => setOpen(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
