import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  CalendarClock, 
  Play, 
  Plus, 
  RotateCw, 
  Trash2, 
  Edit3, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Terminal, 
  Copy, 
  Search, 
  BookOpen, 
  X,
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  listServerCronJobs, 
  saveServerCronJob, 
  toggleServerCronJob, 
  deleteServerCronJob, 
  runCronJobNow,
  requestConfirmation,
  type CronJobItem,
  type SaveCronJobPayload,
  type CronRunResult
} from '@/lib/tauri-client';
import { toast } from 'sonner';

interface CronManagerProps {
  serverId: string;
  isOnline: boolean;
}

interface RunbookPreset {
  name: string;
  category: string;
  description: string;
  schedule: string;
  command: string;
  human_readable: string;
}

const CRON_RUNBOOKS: RunbookPreset[] = [
  {
    name: 'SSL Auto-Renew',
    category: 'Security',
    description: 'Dry-run and renew expiring Let\'s Encrypt SSL certificates automatically twice daily.',
    schedule: '0 2,14 * * *',
    command: 'certbot renew --quiet --no-self-upgrade',
    human_readable: 'Twice daily at 02:00 and 14:00',
  },
  {
    name: 'Log Files Purge (14+ Days)',
    category: 'Maintenance',
    description: 'Compress or remove archived log files older than 14 days to preserve disk space.',
    schedule: '0 3 * * *',
    command: 'find /var/log -type f -name "*.gz" -mtime +14 -delete',
    human_readable: 'Daily at 03:00 AM',
  },
  {
    name: 'Temporary & Session Cleanup',
    category: 'Maintenance',
    description: 'Remove abandoned temporary and session files not accessed for over 7 days.',
    schedule: '0 4 * * *',
    command: 'find /tmp -type f -atime +7 -delete',
    human_readable: 'Daily at 04:00 AM',
  },
  {
    name: 'Free PageCache & Inodes',
    category: 'Performance',
    description: 'Safely flush system pagecache, dentries, and inodes weekly without killing processes.',
    schedule: '0 5 * * 0',
    command: 'sync; echo 3 > /proc/sys/vm/drop_caches',
    human_readable: 'Every Sunday at 05:00 AM',
  },
  {
    name: 'Docker System Prune',
    category: 'Docker',
    description: 'Clean up stopped containers, unused networks, and dangling images weekly.',
    schedule: '0 4 * * 0',
    command: 'docker system prune -f --volumes',
    human_readable: 'Every Sunday at 04:00 AM',
  },
  {
    name: 'PostgreSQL Auto-Analyze',
    category: 'Database',
    description: 'Update PostgreSQL database query planner statistics across all databases.',
    schedule: '0 1 * * *',
    command: 'vacuumdb -U postgres -a -z 2>/dev/null',
    human_readable: 'Daily at 01:00 AM',
  },
  {
    name: 'Laravel / PHP Schedule Worker',
    category: 'Application',
    description: 'Standard Laravel task scheduler daemon runner.',
    schedule: '* * * * *',
    command: 'php /var/www/html/artisan schedule:run >> /dev/null 2>&1',
    human_readable: 'Every minute',
  },
  {
    name: 'Node / Next.js Heap Monitor',
    category: 'Application',
    description: 'Audit top memory consumers and dump process status to syslog.',
    schedule: '*/30 * * * *',
    command: 'ps -eo pid,%mem,%cpu,cmd --sort=-%mem | head -n 10',
    human_readable: 'Every 30 minutes',
  }
];

const SCHEDULE_PRESETS = [
  { label: 'Every Minute', value: '* * * * *' },
  { label: 'Every 5 Mins', value: '*/5 * * * *' },
  { label: 'Every 15 Mins', value: '*/15 * * * *' },
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily Midnight', value: '0 0 * * *' },
  { label: 'Daily 02:00 AM', value: '0 2 * * *' },
  { label: 'Weekly Sunday', value: '0 0 * * 0' },
  { label: 'Monthly 1st', value: '0 0 1 * *' },
  { label: 'At Reboot', value: '@reboot' },
];

export const CronManager: React.FC<CronManagerProps> = ({ serverId, isOnline }) => {
  const [jobs, setJobs] = useState<CronJobItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Editor Modal
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(false);
  const [editingJob, setEditingJob] = useState<CronJobItem | null>(null);
  const [formSchedule, setFormSchedule] = useState<string>('0 2 * * *');
  const [formCommand, setFormCommand] = useState<string>('');
  const [formComment, setFormComment] = useState<string>('');
  const [formEnabled, setFormEnabled] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Runbooks Modal
  const [isRunbooksOpen, setIsRunbooksOpen] = useState<boolean>(false);

  // Run Now Modal
  const [runningJobCommand, setRunningJobCommand] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<CronRunResult | null>(null);
  const [isRunningNow, setIsRunningNow] = useState<boolean>(false);

  // Load crontab
  const fetchCronJobs = useCallback(async () => {
    if (!isOnline) return;
    setIsLoading(true);
    try {
      const data = await listServerCronJobs(serverId);
      setJobs(data);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to read server crontab');
    } finally {
      setIsLoading(false);
    }
  }, [serverId, isOnline]);

  useEffect(() => {
    fetchCronJobs();
  }, [fetchCronJobs]);

  // Toggle active/commented
  const handleToggle = async (job: CronJobItem) => {
    const nextState = !job.enabled;
    try {
      await toggleServerCronJob(serverId, job.id, nextState);
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, enabled: nextState } : j));
      toast.success(nextState ? 'Cron job enabled' : 'Cron job disabled (commented out)');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to toggle cron job state');
    }
  };

  // Delete cron job
  const handleDelete = async (job: CronJobItem) => {
    try {
      let token: string | undefined = undefined;
      const upper = job.command.toUpperCase();
      if (upper.includes('DELETE') || upper.includes('RM ') || upper.includes('DROP')) {
        token = await requestConfirmation(
          `Delete scheduled cron task "${job.command.slice(0, 50)}"`,
          [serverId, job.id]
        );
      }

      await deleteServerCronJob(serverId, job.id, token);
      setJobs(prev => prev.filter(j => j.id !== job.id));
      toast.success('Cron job deleted from server crontab');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete cron job');
    }
  };

  // Run Now ad-hoc execution
  const handleRunNow = async (job: CronJobItem) => {
    setRunningJobCommand(job.command);
    setIsRunningNow(true);
    setRunResult(null);

    try {
      const result = await runCronJobNow(serverId, job.command);
      setRunResult(result);
      if (result.success) {
        toast.success(`Task executed in ${result.duration_ms}ms (exit 0)`);
      } else {
        toast.error(`Task finished with exit code ${result.exit_code ?? 'unknown'}`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to execute cron task ad-hoc');
      setRunningJobCommand(null);
    } finally {
      setIsRunningNow(false);
    }
  };

  // Open editor
  const handleOpenCreate = () => {
    setEditingJob(null);
    setFormSchedule('0 2 * * *');
    setFormCommand('');
    setFormComment('');
    setFormEnabled(true);
    setIsEditorOpen(true);
  };

  const handleOpenEdit = (job: CronJobItem) => {
    setEditingJob(job);
    setFormSchedule(job.schedule);
    setFormCommand(job.command);
    setFormComment(job.comment || '');
    setFormEnabled(job.enabled);
    setIsEditorOpen(true);
  };

  const handleApplyPreset = (preset: RunbookPreset) => {
    setEditingJob(null);
    setFormSchedule(preset.schedule);
    setFormCommand(preset.command);
    setFormComment(preset.name);
    setFormEnabled(true);
    setIsRunbooksOpen(false);
    setIsEditorOpen(true);
  };

  // Save cron job
  const handleSaveJob = async () => {
    if (!formSchedule.trim()) {
      toast.error('Schedule cannot be empty');
      return;
    }
    if (!formCommand.trim()) {
      toast.error('Command cannot be empty');
      return;
    }

    setIsSaving(true);
    try {
      let confirmationToken: string | undefined = undefined;
      const upper = formCommand.toUpperCase();
      if (upper.includes('RM -RF') || upper.includes('DROP DATABASE') || upper.includes('MKFS')) {
        confirmationToken = await requestConfirmation(
          `Save destructive cron job: "${formCommand.slice(0, 60)}"`,
          [serverId, formCommand]
        );
      }

      const payload: SaveCronJobPayload = {
        id: editingJob?.id,
        schedule: formSchedule.trim(),
        command: formCommand.trim(),
        comment: formComment.trim() || undefined,
        enabled: formEnabled,
      };

      await saveServerCronJob(serverId, payload, confirmationToken);
      toast.success(editingJob ? 'Cron job updated' : 'Cron job scheduled successfully');
      setIsEditorOpen(false);
      fetchCronJobs();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save cron job');
    } finally {
      setIsSaving(false);
    }
  };

  // Filtered jobs
  const filteredJobs = useMemo(() => {
    if (!searchQuery.trim()) return jobs;
    const lower = searchQuery.toLowerCase();
    return jobs.filter(j => 
      j.command.toLowerCase().includes(lower) || 
      j.schedule.toLowerCase().includes(lower) ||
      (j.comment && j.comment.toLowerCase().includes(lower)) ||
      j.human_readable.toLowerCase().includes(lower)
    );
  }, [jobs, searchQuery]);

  const activeCount = jobs.filter(j => j.enabled).length;

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden p-4 space-y-4">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <CalendarClock className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">Crontab & Scheduled Automation</h2>
              <Badge variant="outline" className="text-xs font-mono font-normal">
                {activeCount} active / {jobs.length} total
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Direct remote crontab synchronization, human schedule translator, and 1-click execution.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Preset Runbooks */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsRunbooksOpen(true)}
            className="text-xs h-8 gap-1.5"
          >
            <BookOpen className="w-3.5 h-3.5 text-sky-400" />
            <span>Runbook Presets</span>
          </Button>

          {/* New Schedule */}
          <Button
            size="sm"
            onClick={handleOpenCreate}
            disabled={!isOnline}
            className="text-xs h-8 gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Schedule</span>
          </Button>

          {/* Refresh */}
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchCronJobs}
            disabled={isLoading || !isOnline}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title="Refresh crontab from server"
          >
            <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search cron schedules, commands, or descriptions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 text-xs pl-8 font-mono"
          />
        </div>
      </div>

      {/* Cron List Viewport */}
      <div className="flex-1 overflow-y-auto space-y-2.5 min-h-0 pr-1">
        {isLoading && jobs.length === 0 && (
          <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
            <RotateCw className="w-8 h-8 animate-spin text-primary mb-3" />
            <p className="text-xs font-mono">Reading remote crontab...</p>
          </div>
        )}

        {!isLoading && filteredJobs.length === 0 && (
          <div className="h-64 border border-dashed border-border rounded-xl flex flex-col items-center justify-center text-center p-6 bg-card/40">
            <CalendarClock className="w-10 h-10 text-muted-foreground opacity-30 mb-2" />
            <h3 className="text-sm font-medium text-foreground">No Cron Tasks Found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mt-1">
              There are currently no active or disabled cron tasks registered in this server's crontab.
            </p>
            <div className="flex gap-2 mt-4">
              <Button size="sm" onClick={handleOpenCreate} className="text-xs h-8 gap-1.5">
                <Plus className="w-3 h-3" />
                <span>Create Schedule</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setIsRunbooksOpen(true)} className="text-xs h-8 gap-1.5">
                <BookOpen className="w-3 h-3 text-sky-400" />
                <span>Browse Presets</span>
              </Button>
            </div>
          </div>
        )}

        {filteredJobs.map((job) => (
          <div
            key={job.id}
            className={`border rounded-lg p-3.5 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              job.enabled
                ? 'bg-card border-border hover:border-border/80 shadow-sm'
                : 'bg-muted/20 border-border/40 opacity-70'
            }`}
          >
            {/* Left: Schedule and Command */}
            <div className="space-y-1.5 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={job.enabled ? 'default' : 'secondary'}
                  className="font-mono text-[11px] px-2 py-0.5 tracking-wide"
                >
                  {job.schedule}
                </Badge>
                <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  {job.human_readable}
                </span>
                {job.comment && (
                  <span className="text-xs text-muted-foreground/80 truncate">
                    — {job.comment}
                  </span>
                )}
              </div>

              {/* Command text */}
              <div className="bg-background/80 border border-border/50 rounded px-2.5 py-1.5 font-mono text-xs text-foreground/90 overflow-x-auto select-all flex items-center justify-between group">
                <span className="truncate mr-2">{job.command}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(job.command);
                    toast.success('Command copied to clipboard');
                  }}
                  className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                  title="Copy command"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Right: Actions and Toggle */}
            <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
              {/* Enabled switch */}
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <span>{job.enabled ? 'Active' : 'Paused'}</span>
                <Switch
                  checked={job.enabled}
                  onCheckedChange={() => handleToggle(job)}
                  className="data-[state=checked]:bg-emerald-600 scale-75"
                />
              </label>

              <div className="h-4 w-px bg-border/60 hidden sm:block" />

              {/* Run Now Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRunNow(job)}
                disabled={isRunningNow || !isOnline}
                className="h-7 text-xs gap-1 px-2.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border-emerald-500/30"
                title="Execute cron task immediately without waiting"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Run Now</span>
              </Button>

              {/* Edit Button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleOpenEdit(job)}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                title="Edit schedule"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </Button>

              {/* Delete Button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(job)}
                className="h-7 w-7 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                title="Delete from crontab"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* ======================================================== */}
      {/* MODAL 1: CREATE / EDIT CRON JOB                          */}
      {/* ======================================================== */}
      {isEditorOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg p-5 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  {editingJob ? 'Edit Cron Schedule' : 'Schedule New Cron Task'}
                </h3>
              </div>
              <button onClick={() => setIsEditorOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Presets Pills */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase">Schedule Presets</label>
              <div className="flex flex-wrap gap-1.5">
                {SCHEDULE_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setFormSchedule(p.value)}
                    className={`text-[11px] px-2.5 py-1 rounded-md border transition-all ${
                      formSchedule === p.value
                        ? 'bg-primary text-primary-foreground border-primary font-medium shadow-xs'
                        : 'bg-muted/40 border-border hover:bg-muted text-foreground'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Schedule Expression Input */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase">Cron Expression</label>
              <Input
                value={formSchedule}
                onChange={(e) => setFormSchedule(e.target.value)}
                placeholder="e.g. 0 2 * * * or */15 * * * *"
                className="h-8 text-xs font-mono"
              />
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3 text-primary" />
                Format: <code>minute hour day-of-month month day-of-week</code>
              </span>
            </div>

            {/* Command Input */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase">Command / Script to Run</label>
              <Input
                value={formCommand}
                onChange={(e) => setFormCommand(e.target.value)}
                placeholder="/usr/bin/certbot renew --quiet"
                className="h-8 text-xs font-mono"
              />
            </div>

            {/* Optional Description / Comment */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase">Description / Tag (Optional)</label>
              <Input
                value={formComment}
                onChange={(e) => setFormComment(e.target.value)}
                placeholder="e.g. Daily SSL Cert Auto-Renew"
                className="h-8 text-xs"
              />
            </div>

            {/* Enabled Switch */}
            <div className="flex items-center justify-between bg-muted/30 p-2.5 rounded-lg border border-border/50">
              <span className="text-xs font-medium text-foreground">Enable immediately on server</span>
              <Switch checked={formEnabled} onCheckedChange={setFormEnabled} />
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
              <Button variant="outline" size="sm" onClick={() => setIsEditorOpen(false)} className="text-xs h-8">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveJob}
                disabled={isSaving}
                className="text-xs h-8 gap-1.5"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>{editingJob ? 'Update Schedule' : 'Save & Install'}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: RUNBOOK PRESETS PALETTE                         */}
      {/* ======================================================== */}
      {isRunbooksOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-border/60 shrink-0">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-foreground">Curated Automation Runbooks</h3>
              </div>
              <button onClick={() => setIsRunbooksOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
              {CRON_RUNBOOKS.map((preset) => (
                <div
                  key={preset.name}
                  className="border border-border rounded-lg p-3 bg-muted/20 hover:bg-muted/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-foreground">{preset.name}</span>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {preset.category}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] font-mono text-primary">
                        {preset.human_readable}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{preset.description}</p>
                    <div className="font-mono text-[11px] text-muted-foreground/90 bg-background/60 p-1.5 rounded border border-border/40 truncate">
                      {preset.command}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    onClick={() => handleApplyPreset(preset)}
                    className="text-xs h-7 gap-1 px-3 shrink-0"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Use Preset</span>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 3: RUN NOW LIVE OUTPUT                             */}
      {/* ======================================================== */}
      {runningJobCommand && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-border/60 shrink-0">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Task Ad-Hoc Execution</h3>
              </div>
              <button
                onClick={() => setRunningJobCommand(null)}
                disabled={isRunningNow}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <div className="bg-muted/40 p-2 rounded border border-border/50 font-mono text-xs text-foreground truncate">
                $ {runningJobCommand}
              </div>

              {isRunningNow && (
                <div className="py-8 flex flex-col items-center justify-center text-muted-foreground">
                  <RotateCw className="w-8 h-8 animate-spin text-primary mb-3" />
                  <p className="text-xs font-mono">Executing task on remote server...</p>
                </div>
              )}

              {runResult && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      {runResult.success ? (
                        <Badge className="bg-emerald-600 text-white gap-1 text-[11px]">
                          <CheckCircle2 className="w-3 h-3" /> Success (Exit 0)
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1 text-[11px]">
                          <XCircle className="w-3 h-3" /> Exit Code {runResult.exit_code ?? 'Error'}
                        </Badge>
                      )}
                      <span className="text-muted-foreground font-mono">{runResult.duration_ms} ms</span>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const content = runResult.stdout || runResult.stderr || '(no output)';
                        navigator.clipboard.writeText(content);
                        toast.success('Terminal output copied to clipboard');
                      }}
                      className="h-6 text-[11px] gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy Output</span>
                    </Button>
                  </div>

                  {/* Terminal stdout / stderr viewer */}
                  <div className="bg-black/90 text-green-400 p-3 rounded-lg font-mono text-xs max-h-64 overflow-y-auto whitespace-pre-wrap border border-border/80">
                    {runResult.stdout && <div>{runResult.stdout}</div>}
                    {runResult.stderr && <div className="text-rose-400">{runResult.stderr}</div>}
                    {!runResult.stdout && !runResult.stderr && (
                      <div className="text-muted-foreground/60 italic">(Command exited cleanly with no output)</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-border/60 bg-muted/20 flex justify-end shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRunningJobCommand(null)}
                disabled={isRunningNow}
                className="text-xs h-8"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
