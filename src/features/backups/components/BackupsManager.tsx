import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  listBackups, 
  createBackup, 
  restoreBackup, 
  deleteBackup, 
  downloadBackup, 
  requestConfirmation, 
  listBackupSchedules,
  createBackupSchedule,
  toggleBackupSchedule,
  deleteBackupSchedule,
  runBackupScheduleNow,
  listCloudConfigs,
  saveCloudConfig,
  deleteCloudConfig,
  testCloudStorageConnection,
  uploadBackupToCloud,
  type BackupRecord, 
  type CreateBackupOptions,
  type BackupSchedule,
  type CreateBackupScheduleOptions,
  type CloudStorageConfig,
  type SaveCloudStorageConfigOptions
} from '@/lib/tauri-client';
import { 
  Database, 
  FolderArchive, 
  RefreshCw, 
  Trash2, 
  RotateCcw, 
  Plus, 
  CheckCircle2, 
  XCircle, 
  HardDrive, 
  Loader2, 
  AlertTriangle,
  Download,
  Zap,
  Calendar,
  Clock,
  Cloud,
  CloudUpload,
  Play,
  ShieldCheck,
  Check
} from 'lucide-react';
import { toast } from 'sonner';

interface BackupsManagerProps {
  serverId: string;
}

type BackupSubTab = 'snapshots' | 'schedules' | 'cloud';

export const BackupsManager: React.FC<BackupsManagerProps> = ({ serverId }) => {
  const [activeSubTab, setActiveSubTab] = useState<BackupSubTab>('snapshots');

  // --- Snapshots State ---
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupRecord | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [creating, setCreating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Form State for Ad-hoc Dump
  const [targetType, setTargetType] = useState<'postgres' | 'mysql' | 'redis' | 'directory' | 'custom'>('postgres');
  const [targetName, setTargetName] = useState('');
  const [destinationDir, setDestinationDir] = useState('/var/backups');
  const [dbUser, setDbUser] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [dbHost, setDbHost] = useState('');
  const [dbPort, setDbPort] = useState('');
  const [showAdvancedDb, setShowAdvancedDb] = useState(false);
  const [customCommand, setCustomCommand] = useState('');
  const [confirmInput, setConfirmInput] = useState('');

  // --- Schedules State ---
  const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [creatingSchedule, setCreatingSchedule] = useState(false);
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);

  // Schedule Form State
  const [schedName, setSchedName] = useState('');
  const [schedTargetType, setSchedTargetType] = useState<'postgres' | 'mysql' | 'redis' | 'directory' | 'custom'>('postgres');
  const [schedTargetName, setSchedTargetName] = useState('');
  const [schedCronPreset, setSchedCronPreset] = useState<string>('twice_daily');
  const [schedCustomCron, setSchedCustomCron] = useState<string>('0 2,14 * * *');
  const [schedDestinationDir, setSchedDestinationDir] = useState('/var/backups');
  const [schedRetention, setSchedRetention] = useState<number>(14);
  const [schedCloudProvider, setSchedCloudProvider] = useState<'none' | 's3' | 'dropbox'>('none');
  const [schedCloudConfigId, setSchedCloudConfigId] = useState<string>('');
  const [schedDbUser, setSchedDbUser] = useState('');
  const [schedDbPassword, setSchedDbPassword] = useState('');
  const [schedDbHost, setSchedDbHost] = useState('');
  const [schedDbPort, setSchedDbPort] = useState('');
  const [schedShowAdvancedDb, setSchedShowAdvancedDb] = useState(false);
  const [schedCustomCommand, setSchedCustomCommand] = useState('');

  // --- Cloud Storage State ---
  const [cloudConfigs, setCloudConfigs] = useState<CloudStorageConfig[]>([]);
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [cloudModalOpen, setCloudModalOpen] = useState(false);
  const [savingCloud, setSavingCloud] = useState(false);
  const [testingCloud, setTestingCloud] = useState(false);

  // Cloud Config Form
  const [cloudProviderType, setCloudProviderType] = useState<'s3' | 'dropbox'>('s3');
  const [cloudConfigName, setCloudConfigName] = useState('');
  // S3 Form
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Region, setS3Region] = useState('us-east-1');
  const [s3AccessKey, setS3AccessKey] = useState('');
  const [s3SecretKey, setS3SecretKey] = useState('');
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3Prefix, setS3Prefix] = useState('backups/');
  // Dropbox Form
  const [dropboxToken, setDropboxToken] = useState('');
  const [dropboxPrefix, setDropboxPrefix] = useState('/ServerBackups');

  // Ad-hoc Cloud Upload Modal
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadingBackup, setUploadingBackup] = useState<BackupRecord | null>(null);
  const [uploadCloudConfigId, setUploadCloudConfigId] = useState<string>('');
  const [uploadingToCloud, setUploadingToCloud] = useState(false);

  // --- Loaders ---
  const loadBackups = async () => {
    setLoading(true);
    try {
      const data = await listBackups(serverId);
      setBackups(data);
    } catch (err: any) {
      toast.error('Failed to load backups', { description: err.message || String(err) });
    } finally {
      setLoading(false);
    }
  };

  const loadSchedules = async () => {
    setLoadingSchedules(true);
    try {
      const data = await listBackupSchedules(serverId);
      setSchedules(data);
    } catch (err: any) {
      toast.error('Failed to load backup schedules', { description: err.message || String(err) });
    } finally {
      setLoadingSchedules(false);
    }
  };

  const loadCloudConfigs = async () => {
    setLoadingCloud(true);
    try {
      const data = await listCloudConfigs();
      setCloudConfigs(data);
      if (data.length > 0 && !schedCloudConfigId) {
        setSchedCloudConfigId(data[0].id);
      }
      if (data.length > 0 && !uploadCloudConfigId) {
        setUploadCloudConfigId(data[0].id);
      }
    } catch (err: any) {
      toast.error('Failed to load cloud configurations', { description: err.message || String(err) });
    } finally {
      setLoadingCloud(false);
    }
  };

  useEffect(() => {
    loadBackups();
    loadSchedules();
    loadCloudConfigs();
  }, [serverId]);

  // --- Handlers: Snapshots ---
  const handleCreate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!targetName.trim()) {
      toast.error('Please specify a target database name or directory path');
      return;
    }

    setCreating(true);
    try {
      const opts: CreateBackupOptions = {
        target_type: targetType,
        target_name: targetName.trim(),
        destination_dir: destinationDir.trim() || undefined,
        db_user: dbUser.trim() || undefined,
        db_password: dbPassword.trim() || undefined,
        db_host: dbHost.trim() || undefined,
        db_port: dbPort ? parseInt(dbPort, 10) : undefined,
        custom_command: targetType === 'custom' ? customCommand.trim() : undefined,
      };

      const record = await createBackup(serverId, opts);
      toast.success('Backup created successfully', {
        description: `Saved to ${record.destination} (${formatBytes(record.size_bytes || 0)})`,
      });
      setCreateModalOpen(false);
      setTargetName('');
      setDbUser('');
      setDbPassword('');
      setDbHost('');
      setDbPort('');
      setShowAdvancedDb(false);
      loadBackups();
    } catch (err: any) {
      toast.error('Backup creation failed', { description: err.message || String(err) });
    } finally {
      setCreating(false);
    }
  };

  const handleQuickBackup = (type: 'postgres' | 'mysql' | 'redis', defaultName: string) => {
    setTargetType(type);
    setTargetName(defaultName);
    setCreateModalOpen(true);
  };

  const handleDownload = async (backup: BackupRecord) => {
    setDownloadingId(backup.id);
    try {
      const res = await downloadBackup(serverId, backup.id);
      toast.success('Backup downloaded to your PC!', {
        description: `Saved to: ${res.local_path} (${formatBytes(res.bytes_written)})`,
        action: {
          label: 'Copy Path',
          onClick: () => {
            navigator.clipboard.writeText(res.local_path);
            toast.info('Local file path copied to clipboard');
          },
        },
      });
    } catch (err: any) {
      toast.error('Failed to download backup', {
        description: err.message || String(err),
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleRestore = async () => {
    if (!selectedBackup) return;
    if (confirmInput.trim() !== 'RESTORE') {
      toast.error('Please type RESTORE to confirm this destructive operation');
      return;
    }

    setRestoring(true);
    try {
      const token = await requestConfirmation(`Restore backup ${selectedBackup.target} on server`, [serverId]);
      await restoreBackup(serverId, selectedBackup.id, token);
      toast.success('Backup restored successfully', {
        description: `Restored ${selectedBackup.target} from ${selectedBackup.destination}`,
      });
      setRestoreModalOpen(false);
      setSelectedBackup(null);
      setConfirmInput('');
    } catch (err: any) {
      toast.error('Restore failed', { description: err.message || String(err) });
    } finally {
      setRestoring(false);
    }
  };

  const handleDelete = async (backup: BackupRecord) => {
    if (!confirm(`Are you sure you want to delete backup for ${backup.target}?`)) return;

    try {
      await deleteBackup(serverId, backup.id);
      toast.success('Backup deleted');
      setBackups(prev => prev.filter(b => b.id !== backup.id));
    } catch (err: any) {
      toast.error('Failed to delete backup', { description: err.message || String(err) });
    }
  };

  // --- Handlers: Schedules ---
  const getCronFromPreset = (preset: string): string => {
    switch (preset) {
      case 'twice_daily': return '0 2,14 * * *';
      case 'daily': return '0 3 * * *';
      case 'every_6h': return '0 */6 * * *';
      case 'hourly': return '0 * * * *';
      case 'weekly': return '0 2 * * 0';
      case 'custom': return schedCustomCron.trim() || '0 2,14 * * *';
      default: return '0 2,14 * * *';
    }
  };

  const formatCronHuman = (cron: string): string => {
    const trimmed = cron.trim();
    if (trimmed === '0 2,14 * * *') return 'Twice Daily (02:00 & 14:00 UTC)';
    if (trimmed === '0 3 * * *') return 'Daily (03:00 UTC)';
    if (trimmed === '0 */6 * * *') return 'Every 6 Hours';
    if (trimmed === '0 * * * *') return 'Hourly';
    if (trimmed === '0 2 * * 0') return 'Weekly (Sunday 02:00 UTC)';
    return `Cron: ${trimmed}`;
  };

  const handleCreateSchedule = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!schedName.trim()) {
      toast.error('Please specify a schedule name');
      return;
    }
    if (!schedTargetName.trim()) {
      toast.error('Please specify a target database name or directory path');
      return;
    }

    const cronExpression = getCronFromPreset(schedCronPreset);

    setCreatingSchedule(true);
    try {
      const opts: CreateBackupScheduleOptions = {
        server_id: serverId,
        name: schedName.trim(),
        target_type: schedTargetType,
        target_name: schedTargetName.trim(),
        cron_expression: cronExpression,
        destination_dir: schedDestinationDir.trim() || '/var/backups',
        retention_count: schedRetention,
        cloud_provider: schedCloudProvider,
        cloud_config_id: schedCloudProvider !== 'none' ? schedCloudConfigId : undefined,
        db_user: schedDbUser.trim() || undefined,
        db_password: schedDbPassword.trim() || undefined,
        db_host: schedDbHost.trim() || undefined,
        db_port: schedDbPort ? parseInt(schedDbPort, 10) : undefined,
        custom_command: schedTargetType === 'custom' ? schedCustomCommand.trim() : undefined,
        enabled: true,
      };

      const sched = await createBackupSchedule(opts);
      toast.success('Server cron schedule created!', {
        description: `Autonomous cron job injected into server: ${sched.cron_expression}`,
      });
      setScheduleModalOpen(false);
      setSchedName('');
      setSchedTargetName('');
      setSchedDbUser('');
      setSchedDbPassword('');
      setSchedDbHost('');
      setSchedDbPort('');
      setSchedShowAdvancedDb(false);
      loadSchedules();
    } catch (err: any) {
      toast.error('Failed to create server schedule', { description: err.message || String(err) });
    } finally {
      setCreatingSchedule(false);
    }
  };

  const handleToggleSchedule = async (schedule: BackupSchedule) => {
    const newStatus = !schedule.enabled;
    try {
      const updated = await toggleBackupSchedule(schedule.id, newStatus);
      toast.success(newStatus ? 'Schedule enabled in crontab' : 'Schedule paused in crontab');
      setSchedules(prev => prev.map(s => s.id === updated.id ? updated : s));
    } catch (err: any) {
      toast.error('Failed to toggle schedule', { description: err.message || String(err) });
    }
  };

  const handleDeleteSchedule = async (schedule: BackupSchedule) => {
    if (!confirm(`Are you sure you want to remove cron schedule "${schedule.name}" from server?`)) return;

    try {
      await deleteBackupSchedule(schedule.id);
      toast.success('Schedule removed from server crontab');
      setSchedules(prev => prev.filter(s => s.id !== schedule.id));
    } catch (err: any) {
      toast.error('Failed to delete schedule', { description: err.message || String(err) });
    }
  };

  const handleRunScheduleNow = async (schedule: BackupSchedule) => {
    setRunningScheduleId(schedule.id);
    try {
      const res = await runBackupScheduleNow(schedule.id);
      toast.success('Scheduled backup executed successfully!', {
        description: `Archive created: ${res.archive_file}`,
      });
      loadSchedules();
      loadBackups();
    } catch (err: any) {
      toast.error('Schedule execution failed', { description: err.message || String(err) });
    } finally {
      setRunningScheduleId(null);
    }
  };

  // --- Handlers: Cloud Storage ---
  const handleTestCloudConnection = async () => {
    setTestingCloud(true);
    try {
      let configJson = '';
      if (cloudProviderType === 's3') {
        if (!s3Bucket.trim() || !s3AccessKey.trim() || !s3SecretKey.trim()) {
          toast.error('Bucket, Access Key, and Secret Key are required');
          setTestingCloud(false);
          return;
        }
        configJson = JSON.stringify({
          bucket: s3Bucket.trim(),
          region: s3Region.trim() || 'us-east-1',
          access_key: s3AccessKey.trim(),
          secret_key: s3SecretKey.trim(),
          endpoint: s3Endpoint.trim() || undefined,
          prefix: s3Prefix.trim() || undefined,
        });
      } else {
        if (!dropboxToken.trim()) {
          toast.error('Dropbox Access Token is required');
          setTestingCloud(false);
          return;
        }
        configJson = JSON.stringify({
          access_token: dropboxToken.trim(),
          prefix: dropboxPrefix.trim() || undefined,
        });
      }

      const res = await testCloudStorageConnection(serverId, cloudProviderType, configJson);
      if (res.success) {
        toast.success('Connection verified successfully!', { description: res.message });
      } else {
        toast.error('Connection verification failed', { description: res.message });
      }
    } catch (err: any) {
      toast.error('Connection test error', { description: err.message || String(err) });
    } finally {
      setTestingCloud(false);
    }
  };

  const handleSaveCloudConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!cloudConfigName.trim()) {
      toast.error('Please enter a name for this cloud storage configuration');
      return;
    }

    let configJson = '';
    if (cloudProviderType === 's3') {
      if (!s3Bucket.trim() || !s3AccessKey.trim() || !s3SecretKey.trim()) {
        toast.error('Bucket, Access Key, and Secret Key are required');
        return;
      }
      configJson = JSON.stringify({
        bucket: s3Bucket.trim(),
        region: s3Region.trim() || 'us-east-1',
        access_key: s3AccessKey.trim(),
        secret_key: s3SecretKey.trim(),
        endpoint: s3Endpoint.trim() || undefined,
        prefix: s3Prefix.trim() || undefined,
      });
    } else {
      if (!dropboxToken.trim()) {
        toast.error('Dropbox Access Token is required');
        return;
      }
      configJson = JSON.stringify({
        access_token: dropboxToken.trim(),
        prefix: dropboxPrefix.trim() || undefined,
      });
    }

    setSavingCloud(true);
    try {
      const opts: SaveCloudStorageConfigOptions = {
        name: cloudConfigName.trim(),
        provider: cloudProviderType,
        config_json: configJson,
      };

      await saveCloudConfig(opts);
      toast.success('Cloud storage configuration saved!');
      setCloudModalOpen(false);
      setCloudConfigName('');
      setS3Bucket('');
      setS3AccessKey('');
      setS3SecretKey('');
      setS3Endpoint('');
      setDropboxToken('');
      loadCloudConfigs();
    } catch (err: any) {
      toast.error('Failed to save cloud configuration', { description: err.message || String(err) });
    } finally {
      setSavingCloud(false);
    }
  };

  const handleDeleteCloudConfig = async (config: CloudStorageConfig) => {
    if (!confirm(`Delete cloud configuration "${config.name}"?`)) return;

    try {
      await deleteCloudConfig(config.id);
      toast.success('Cloud configuration deleted');
      setCloudConfigs(prev => prev.filter(c => c.id !== config.id));
    } catch (err: any) {
      toast.error('Failed to delete cloud config', { description: err.message || String(err) });
    }
  };

  // --- Handlers: Upload Existing Backup to Cloud ---
  const handleOpenUploadModal = (backup: BackupRecord) => {
    setUploadingBackup(backup);
    if (cloudConfigs.length > 0 && !uploadCloudConfigId) {
      setUploadCloudConfigId(cloudConfigs[0].id);
    }
    setUploadModalOpen(true);
  };

  const handleUploadBackupToCloud = async () => {
    if (!uploadingBackup) return;
    if (!uploadCloudConfigId) {
      toast.error('Please select a cloud storage target');
      return;
    }

    setUploadingToCloud(true);
    try {
      const res = await uploadBackupToCloud(serverId, uploadingBackup.id, uploadCloudConfigId);
      toast.success('Backup uploaded to cloud storage!', {
        description: res.remote_path,
        action: {
          label: 'Copy Remote Path',
          onClick: () => {
            navigator.clipboard.writeText(res.remote_path);
            toast.info('Path copied to clipboard');
          },
        },
      });
      setUploadModalOpen(false);
      setUploadingBackup(null);
    } catch (err: any) {
      toast.error('Failed to upload backup to cloud', { description: err.message || String(err) });
    } finally {
      setUploadingToCloud(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6">
      {/* Top Deck Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border border-border bg-card shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              <HardDrive className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">Server Backups & Automation</h2>
            <Badge variant="outline" className="text-xs bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border-indigo-500/30">
              Server-Native Crontab + S3 / Dropbox
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Live database dumps, server-autonomous cron schedules (e.g. 2 backups/day), automatic local retention pruning, and direct offsite sync to S3 & Dropbox.
          </p>
        </div>

        {/* Global Tab Navigation */}
        <div className="flex items-center p-1 rounded-xl bg-muted/60 border border-border/80 self-start sm:self-center">
          <button
            type="button"
            onClick={() => setActiveSubTab('snapshots')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeSubTab === 'snapshots'
                ? 'bg-card text-foreground shadow-xs border border-border/60'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <FolderArchive className="h-3.5 w-3.5" />
            <span>Snapshots</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-primary/10 text-primary font-mono">
              {backups.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('schedules')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeSubTab === 'schedules'
                ? 'bg-card text-foreground shadow-xs border border-border/60'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Calendar className="h-3.5 w-3.5 text-indigo-500" />
            <span>Server Cron Schedules</span>
            {schedules.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-mono font-bold">
                {schedules.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('cloud')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeSubTab === 'cloud'
                ? 'bg-card text-foreground shadow-xs border border-border/60'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Cloud className="h-3.5 w-3.5 text-sky-500" />
            <span>Cloud Storage (S3 / Dropbox)</span>
            {cloudConfigs.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-sky-500/20 text-sky-600 dark:text-sky-400 font-mono font-bold">
                {cloudConfigs.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SUB-TAB 1: SNAPSHOTS & DUMPS                                              */}
      {/* ========================================================================= */}
      {activeSubTab === 'snapshots' && (
        <div className="space-y-6">
          {/* Quick Dump Action Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div 
              onClick={() => handleQuickBackup('postgres', 'postgres')}
              className="p-3.5 rounded-xl border border-blue-500/20 bg-blue-500/5 dark:bg-blue-950/15 hover:border-blue-500/40 hover:bg-blue-500/10 transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-lg">
                  🐘
                </div>
                <div>
                  <div className="font-semibold text-sm text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-300 transition-colors">
                    Dump PostgreSQL DB
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">pg_dump | gzip</div>
                </div>
              </div>
              <Button size="sm" variant="ghost" className="text-xs text-blue-600 dark:text-blue-300 hover:text-foreground">
                <Zap className="h-3.5 w-3.5 mr-1 text-blue-500" /> Dump
              </Button>
            </div>

            <div 
              onClick={() => handleQuickBackup('mysql', 'mysql')}
              className="p-3.5 rounded-xl border border-amber-500/20 bg-amber-500/5 dark:bg-amber-950/15 hover:border-amber-500/40 hover:bg-amber-500/10 transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-lg">
                  🐬
                </div>
                <div>
                  <div className="font-semibold text-sm text-foreground group-hover:text-amber-600 dark:group-hover:text-amber-300 transition-colors">
                    Dump MySQL / MariaDB
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">mysqldump | gzip</div>
                </div>
              </div>
              <Button size="sm" variant="ghost" className="text-xs text-amber-600 dark:text-amber-300 hover:text-foreground">
                <Zap className="h-3.5 w-3.5 mr-1 text-amber-500" /> Dump
              </Button>
            </div>

            <div 
              onClick={() => handleQuickBackup('redis', 'dump.rdb')}
              className="p-3.5 rounded-xl border border-red-500/20 bg-red-500/5 dark:bg-red-950/15 hover:border-red-500/40 hover:bg-red-500/10 transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 text-lg">
                  ⚡
                </div>
                <div>
                  <div className="font-semibold text-sm text-foreground group-hover:text-red-600 dark:group-hover:text-red-300 transition-colors">
                    Snapshot Redis RDB
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">bgsave + copy</div>
                </div>
              </div>
              <Button size="sm" variant="ghost" className="text-xs text-red-600 dark:text-red-300 hover:text-foreground">
                <Zap className="h-3.5 w-3.5 mr-1 text-red-500" /> Dump
              </Button>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Available Snapshots</span>
              <span className="text-xs text-muted-foreground">({backups.length} archives recorded)</span>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="border-border text-foreground hover:bg-accent"
                onClick={loadBackups} 
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button 
                size="sm" 
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-sm"
                onClick={() => {
                  setTargetType('postgres');
                  setTargetName('');
                  setCreateModalOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                New Ad-Hoc Dump
              </Button>
            </div>
          </div>

          {/* Backups List */}
          {backups.length === 0 && !loading ? (
            <Card className="border-dashed border-border bg-card/40">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <FolderArchive className="h-12 w-12 text-muted-foreground mb-3" />
                <h3 className="font-semibold text-lg text-foreground">No backups found</h3>
                <p className="text-sm text-muted-foreground max-w-md mt-1 mb-4">
                  Take a snapshot of your live PostgreSQL, MySQL, Redis databases, or application files. You can restore them anytime, upload to S3/Dropbox, or download to your PC.
                </p>
                <Button 
                  size="sm" 
                  className="bg-indigo-600 hover:bg-indigo-500 text-white"
                  onClick={() => setCreateModalOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" /> Create First Backup
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3.5">
              {backups.map(b => {
                const isDownloading = downloadingId === b.id;

                return (
                  <Card 
                    key={b.id} 
                    className="overflow-hidden border border-border bg-card hover:border-primary/30 transition-all shadow-xs"
                  >
                    <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      {/* Left Metadata */}
                      <div className="flex items-center gap-3.5">
                        <div className="p-3 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 rounded-xl shrink-0">
                          {b.destination.includes('pg_') || b.destination.includes('mysql_') || b.destination.includes('redis_') ? (
                            <Database className="h-6 w-6" />
                          ) : (
                            <FolderArchive className="h-6 w-6" />
                          )}
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-base text-foreground">{b.target}</span>
                            {b.status === 'success' && (b.size_bytes && b.size_bytes <= 40) ? (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium" title="Dump produced 0 data bytes">
                                <AlertTriangle className="h-3 w-3" /> Empty (0 B)
                              </span>
                            ) : b.status === 'success' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                                <CheckCircle2 className="h-3 w-3" /> Ready
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 font-medium">
                                <XCircle className="h-3 w-3" /> Failed
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2 font-mono">
                            <span className="px-1.5 py-0.5 rounded bg-muted border border-border text-foreground">
                              {b.destination}
                            </span>
                            <span className="text-muted-foreground/60">•</span>
                            <span className={`font-semibold ${b.size_bytes && b.size_bytes <= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-teal-600 dark:text-teal-400'}`}>
                              {b.size_bytes ? (b.size_bytes <= 40 ? '20 B (Empty dump)' : formatBytes(b.size_bytes)) : 'Size unknown'}
                            </span>
                            <span className="text-muted-foreground/60">•</span>
                            <span className="text-muted-foreground font-sans">{new Date(b.created_at).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>

                      {/* Actions Deck */}
                      <div className="flex items-center flex-wrap gap-2 self-end md:self-center">
                        {/* Upload to Cloud */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs border-sky-500/30 bg-sky-500/5 dark:bg-sky-950/20 text-sky-700 dark:text-sky-300 hover:bg-sky-500/15"
                          disabled={b.status !== 'success'}
                          onClick={() => handleOpenUploadModal(b)}
                          title="Upload directly to Amazon S3 or Dropbox"
                        >
                          <CloudUpload className="h-3.5 w-3.5 mr-1.5" />
                          Push to Cloud
                        </Button>

                        {/* Download to Local PC */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs border-teal-500/30 bg-teal-500/5 dark:bg-teal-950/20 text-teal-700 dark:text-teal-300 hover:bg-teal-500/15"
                          disabled={isDownloading || b.status !== 'success'}
                          onClick={() => handleDownload(b)}
                        >
                          {isDownloading ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          {isDownloading ? 'Downloading...' : 'Download to PC'}
                        </Button>

                        {/* Restore */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 border-amber-500/30 hover:bg-amber-500/10"
                          onClick={() => {
                            setSelectedBackup(b);
                            setConfirmInput('');
                            setRestoreModalOpen(true);
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                          Restore
                        </Button>

                        {/* Delete */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                          onClick={() => handleDelete(b)}
                          title="Delete Backup"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 2: AUTOMATED SERVER CRON SCHEDULES                                */}
      {/* ========================================================================= */}
      {activeSubTab === 'schedules' && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 dark:bg-indigo-950/15 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-indigo-500" />
                <span className="font-semibold text-sm text-foreground">Server-Autonomous Cron Jobs</span>
                <Badge variant="outline" className="text-[10px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30">
                  Remote Crontab Execution
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
                These schedules are created <strong>directly inside the server's crontab</strong> (<code className="font-mono text-foreground">/var/scripts/scc_backup_*.sh</code>). They run autonomously 24/7 on the remote server with automatic retention pruning, even when Server Command Center is closed on your desktop.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button 
                variant="outline" 
                size="sm" 
                className="border-border text-foreground hover:bg-accent"
                onClick={loadSchedules} 
                disabled={loadingSchedules}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loadingSchedules ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button 
                size="sm" 
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-sm"
                onClick={() => {
                  setSchedName('');
                  setSchedTargetName('');
                  setSchedCronPreset('twice_daily');
                  setSchedRetention(14);
                  setSchedCloudProvider('none');
                  setScheduleModalOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                New Cron Schedule
              </Button>
            </div>
          </div>

          {/* Schedules List */}
          {schedules.length === 0 && !loadingSchedules ? (
            <Card className="border-dashed border-border bg-card/40">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Calendar className="h-12 w-12 text-muted-foreground mb-3" />
                <h3 className="font-semibold text-lg text-foreground">No automated schedules configured</h3>
                <p className="text-sm text-muted-foreground max-w-md mt-1 mb-4">
                  Set up automated schedules like <strong>2 backups a day</strong> (e.g. 02:00 and 14:00) or daily backups. The schedule script is installed directly onto the server crontab and executes autonomously.
                </p>
                <Button 
                  size="sm" 
                  className="bg-indigo-600 hover:bg-indigo-500 text-white"
                  onClick={() => setScheduleModalOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" /> Add 2x Daily Backup Schedule
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3.5">
              {schedules.map(s => {
                const isRunning = runningScheduleId === s.id;

                return (
                  <Card 
                    key={s.id} 
                    className="overflow-hidden border border-border bg-card hover:border-indigo-500/30 transition-all shadow-xs"
                  >
                    <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      {/* Left Side: Schedule Details */}
                      <div className="flex items-start sm:items-center gap-3.5">
                        <div className="p-3 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 rounded-xl shrink-0 mt-1 sm:mt-0">
                          <Clock className="h-6 w-6" />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center flex-wrap gap-2">
                            <span className="font-bold text-base text-foreground">{s.name}</span>
                            <Badge variant="outline" className="text-xs bg-muted text-foreground border-border uppercase font-mono">
                              {s.target_type}
                            </Badge>
                            <Badge className="text-xs bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 font-medium">
                              {formatCronHuman(s.cron_expression)}
                            </Badge>
                            {s.enabled ? (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                                <Check className="h-3 w-3" /> Active Crontab
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-medium">
                                Paused
                              </span>
                            )}
                          </div>

                          <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2 font-mono">
                            <span className="text-foreground font-semibold">Target: {s.target_name}</span>
                            <span className="text-muted-foreground/60">•</span>
                            <span>Cron: <code className="bg-muted px-1 py-0.5 rounded border border-border">{s.cron_expression}</code></span>
                            <span className="text-muted-foreground/60">•</span>
                            <span>Retain: {s.retention_count} dumps</span>
                            <span className="text-muted-foreground/60">•</span>
                            {s.cloud_provider !== 'none' ? (
                              <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 font-semibold">
                                <Cloud className="h-3 w-3" /> Offsite {s.cloud_provider.toUpperCase()}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Local Only</span>
                            )}
                          </div>

                          <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                            <span>Script: <code className="font-mono text-foreground">/var/scripts/scc_backup_{s.id.slice(0, 8)}.sh</code></span>
                            {s.last_run_at && (
                              <>
                                <span>•</span>
                                <span>Last Run: {new Date(s.last_run_at).toLocaleString()}</span>
                                <Badge 
                                  variant="outline" 
                                  className={`text-[10px] py-0 px-1.5 ${
                                    s.last_status === 'success' 
                                      ? 'text-emerald-600 border-emerald-500/30 bg-emerald-500/10' 
                                      : 'text-red-500 border-red-500/30 bg-red-500/10'
                                  }`}
                                >
                                  {s.last_status}
                                </Badge>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right Side: Actions */}
                      <div className="flex items-center gap-3 self-end md:self-center">
                        <div className="flex items-center gap-2 border-r border-border pr-3">
                          <span className="text-xs text-muted-foreground font-medium">
                            {s.enabled ? 'Active' : 'Paused'}
                          </span>
                          <Switch 
                            checked={s.enabled}
                            onCheckedChange={() => handleToggleSchedule(s)}
                          />
                        </div>

                        {/* Execute Immediate Run */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs border-indigo-500/30 bg-indigo-500/5 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/15"
                          disabled={isRunning}
                          onClick={() => handleRunScheduleNow(s)}
                          title="Trigger immediate execution of this remote backup script"
                        >
                          {isRunning ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          {isRunning ? 'Running Script...' : 'Run Now'}
                        </Button>

                        {/* Delete Schedule */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                          onClick={() => handleDeleteSchedule(s)}
                          title="Remove cron job from server"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 3: CLOUD STORAGE (S3 & DROPBOX)                                    */}
      {/* ========================================================================= */}
      {activeSubTab === 'cloud' && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl border border-sky-500/20 bg-sky-500/5 dark:bg-sky-950/15 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-sky-500" />
                <span className="font-semibold text-sm text-foreground">Offsite Cloud Storage Targets</span>
                <Badge variant="outline" className="text-[10px] bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30">
                  Amazon S3 & Dropbox
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
                Connect external object storage to protect against catastrophic server failures. Archives are streamed directly from the remote server to your cloud bucket or Dropbox folder without downloading to your local computer.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button 
                variant="outline" 
                size="sm" 
                className="border-border text-foreground hover:bg-accent"
                onClick={loadCloudConfigs} 
                disabled={loadingCloud}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loadingCloud ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button 
                size="sm" 
                className="bg-sky-600 hover:bg-sky-500 text-white font-medium shadow-sm"
                onClick={() => {
                  setCloudConfigName('');
                  setCloudProviderType('s3');
                  setS3Bucket('');
                  setS3Region('us-east-1');
                  setS3AccessKey('');
                  setS3SecretKey('');
                  setS3Endpoint('');
                  setS3Prefix('backups/');
                  setDropboxToken('');
                  setDropboxPrefix('/ServerBackups');
                  setCloudModalOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add Cloud Account
              </Button>
            </div>
          </div>

          {/* Cloud Configs List */}
          {cloudConfigs.length === 0 && !loadingCloud ? (
            <Card className="border-dashed border-border bg-card/40">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Cloud className="h-12 w-12 text-muted-foreground mb-3" />
                <h3 className="font-semibold text-lg text-foreground">No cloud storage accounts connected</h3>
                <p className="text-sm text-muted-foreground max-w-md mt-1 mb-4">
                  Add an Amazon S3 bucket (or S3-compatible like Cloudflare R2, MinIO, Wasabi) or a Dropbox account to enable offsite disaster recovery for all scheduled backups.
                </p>
                <Button 
                  size="sm" 
                  className="bg-sky-600 hover:bg-sky-500 text-white"
                  onClick={() => setCloudModalOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" /> Connect S3 or Dropbox
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {cloudConfigs.map(c => {
                let parsed: any = {};
                try {
                  parsed = JSON.parse(c.config_json);
                } catch (e) {}

                return (
                  <Card key={c.id} className="border border-border bg-card hover:border-sky-500/30 transition-all shadow-xs">
                    <CardHeader className="p-4 pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className={`p-2 rounded-lg border text-lg ${
                            c.provider === 's3' 
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' 
                              : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                          }`}>
                            {c.provider === 's3' ? '🪣' : '📦'}
                          </div>
                          <div>
                            <CardTitle className="text-base font-bold text-foreground">{c.name}</CardTitle>
                            <Badge variant="outline" className="text-[10px] uppercase font-mono mt-0.5">
                              {c.provider === 's3' ? (parsed.endpoint ? 'S3-Compatible (R2/MinIO)' : 'Amazon S3') : 'Dropbox API'}
                            </Badge>
                          </div>
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                          onClick={() => handleDeleteCloudConfig(c)}
                          title="Delete Configuration"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-2 space-y-3">
                      <div className="space-y-1 text-xs font-mono bg-muted/50 p-2.5 rounded-lg border border-border">
                        {c.provider === 's3' ? (
                          <>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Bucket:</span>
                              <span className="font-semibold text-foreground">{parsed.bucket}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Region:</span>
                              <span className="text-foreground">{parsed.region || 'us-east-1'}</span>
                            </div>
                            {parsed.endpoint && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Endpoint:</span>
                                <span className="text-foreground truncate max-w-[200px]" title={parsed.endpoint}>{parsed.endpoint}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Prefix:</span>
                              <span className="text-foreground">{parsed.prefix || '/'}</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Auth:</span>
                              <span className="text-foreground">OAuth2 Bearer Token (Configured)</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Remote Prefix:</span>
                              <span className="text-foreground">{parsed.prefix || '/'}</span>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1">
                        <span className="text-[11px] text-muted-foreground">
                          Added {new Date(c.created_at).toLocaleDateString()}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-sky-500/30 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10"
                          onClick={async () => {
                            toast.loading('Testing connection via server...', { id: 'test-cloud' });
                            try {
                              const res = await testCloudStorageConnection(serverId, c.provider, c.config_json);
                              if (res.success) {
                                toast.success('Connection verified!', { id: 'test-cloud', description: res.message });
                              } else {
                                toast.error('Connection failed', { id: 'test-cloud', description: res.message });
                              }
                            } catch (err: any) {
                              toast.error('Test failed', { id: 'test-cloud', description: err.message || String(err) });
                            }
                          }}
                        >
                          <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Test Probe
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CREATE LIVE DUMP                                                   */}
      {/* ========================================================================= */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-md bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <HardDrive className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />
              Create Live Server Backup
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              Execute a live database dump or directory snapshot directly on this server.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium text-foreground">Target Type</label>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                {[
                  { id: 'postgres', label: '🐘 PostgreSQL DB' },
                  { id: 'mysql', label: '🐬 MySQL DB' },
                  { id: 'redis', label: '⚡ Redis RDB' },
                  { id: 'directory', label: '📁 Directory Archive' },
                  { id: 'custom', label: '⚙️ Custom Command' },
                ].map(t => (
                  <Button
                    key={t.id}
                    type="button"
                    variant={targetType === t.id ? 'default' : 'outline'}
                    size="sm"
                    className={`justify-start text-xs h-8 ${
                      targetType === t.id 
                        ? 'bg-indigo-600 text-white hover:bg-indigo-500' 
                        : 'border-border bg-background text-foreground hover:bg-accent'
                    }`}
                    onClick={() => setTargetType(t.id as any)}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-foreground">
                {targetType === 'directory' ? 'Absolute Directory Path' : 'Database / Service Name'}
              </label>
              <Input
                placeholder={
                  targetType === 'directory' 
                    ? '/var/www/my-app' 
                    : targetType === 'postgres' 
                      ? 'e.g. tenant_speed_main_mox1gfsi' 
                      : targetType === 'mysql' 
                        ? 'e.g. my_database' 
                        : 'dump.rdb'
                }
                value={targetName}
                onChange={e => setTargetName(e.target.value)}
                required
                className="mt-1 bg-background border-input text-foreground text-xs font-mono"
              />
              {targetType === 'postgres' && (
                <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                  💡 <span className="text-foreground">Auto-connection:</span> Defaults to <code className="text-indigo-600 dark:text-indigo-300 bg-muted px-1 py-0.5 rounded font-mono border border-border">postgres</code> superuser via peer socket auth or auto-detects running PostgreSQL Docker containers.
                </p>
              )}
            </div>

            {(targetType === 'postgres' || targetType === 'mysql') && (
              <div className="border border-border bg-muted/40 rounded-xl p-3 space-y-2.5">
                <button
                  type="button"
                  onClick={() => setShowAdvancedDb(!showAdvancedDb)}
                  className="text-xs font-medium text-foreground hover:text-primary flex items-center justify-between w-full transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <span>⚙️</span>
                    <span>Advanced DB Connection Credentials (Optional)</span>
                  </span>
                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono">{showAdvancedDb ? '▲ Hide' : '▼ Configure'}</span>
                </button>
                {showAdvancedDb && (
                  <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-border">
                    <div>
                      <label className="text-[11px] text-muted-foreground">Database User</label>
                      <Input
                        placeholder={targetType === 'postgres' ? 'postgres' : 'root'}
                        value={dbUser}
                        onChange={e => setDbUser(e.target.value)}
                        className="mt-1 h-8 text-xs bg-background border-input text-foreground font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground">Database Password</label>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={dbPassword}
                        onChange={e => setDbPassword(e.target.value)}
                        className="mt-1 h-8 text-xs bg-background border-input text-foreground font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground">Host (default: localhost)</label>
                      <Input
                        placeholder="127.0.0.1"
                        value={dbHost}
                        onChange={e => setDbHost(e.target.value)}
                        className="mt-1 h-8 text-xs bg-background border-input text-foreground font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground">Port</label>
                      <Input
                        placeholder={targetType === 'postgres' ? '5432' : '3306'}
                        value={dbPort}
                        onChange={e => setDbPort(e.target.value)}
                        className="mt-1 h-8 text-xs bg-background border-input text-foreground font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {targetType === 'custom' && (
              <div>
                <label className="text-xs font-medium text-foreground">Custom Backup Command (Use {"{{dest}}"} for output file)</label>
                <Input
                  placeholder="docker exec -t db_container pg_dump -U user db | gzip > {{dest}}"
                  value={customCommand}
                  onChange={e => setCustomCommand(e.target.value)}
                  className="mt-1 font-mono text-xs bg-background border-input text-foreground"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-foreground">Remote Destination Directory</label>
              <Input
                placeholder="/var/backups"
                value={destinationDir}
                onChange={e => setDestinationDir(e.target.value)}
                className="mt-1 font-mono text-xs bg-background border-input text-foreground"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setCreateModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                Cancel
              </Button>
              <Button type="submit" disabled={creating} className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
                {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <HardDrive className="h-4 w-4 mr-2" />}
                Run Live Dump
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL: CREATE SERVER CRON SCHEDULE                                       */}
      {/* ========================================================================= */}
      <Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
        <DialogContent className="max-w-xl bg-card border-border text-foreground max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Calendar className="h-5 w-5 text-indigo-500" />
              Configure Server-Native Backup Schedule
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              Injects a dedicated cron job directly into the server's crontab. The remote server will execute this autonomously according to your interval.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSchedule} className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium text-foreground">Schedule Name</label>
              <Input
                placeholder="e.g. Twice Daily Production DB Dump"
                value={schedName}
                onChange={e => setSchedName(e.target.value)}
                required
                className="mt-1 bg-background border-input text-foreground text-xs"
              />
            </div>

            {/* Target Selection */}
            <div>
              <label className="text-xs font-medium text-foreground">Target Type</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1.5">
                {[
                  { id: 'postgres', label: '🐘 PostgreSQL DB' },
                  { id: 'mysql', label: '🐬 MySQL DB' },
                  { id: 'redis', label: '⚡ Redis RDB' },
                  { id: 'directory', label: '📁 Directory' },
                  { id: 'custom', label: '⚙️ Custom Command' },
                ].map(t => (
                  <Button
                    key={t.id}
                    type="button"
                    variant={schedTargetType === t.id ? 'default' : 'outline'}
                    size="sm"
                    className={`justify-start text-xs h-8 ${
                      schedTargetType === t.id 
                        ? 'bg-indigo-600 text-white hover:bg-indigo-500' 
                        : 'border-border bg-background text-foreground hover:bg-accent'
                    }`}
                    onClick={() => setSchedTargetType(t.id as any)}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-foreground">
                {schedTargetType === 'directory' ? 'Absolute Directory Path' : 'Database / Service Name'}
              </label>
              <Input
                placeholder={
                  schedTargetType === 'directory' 
                    ? '/var/www/my-app' 
                    : schedTargetType === 'postgres' 
                      ? 'e.g. tenant_speed_main_mox1gfsi' 
                      : schedTargetType === 'mysql' 
                        ? 'e.g. my_database' 
                        : 'dump.rdb'
                }
                value={schedTargetName}
                onChange={e => setSchedTargetName(e.target.value)}
                required
                className="mt-1 bg-background border-input text-foreground text-xs font-mono"
              />
            </div>

            {(schedTargetType === 'postgres' || schedTargetType === 'mysql') && (
              <div className="border border-border bg-muted/40 rounded-xl p-3 space-y-2.5">
                <button
                  type="button"
                  onClick={() => setSchedShowAdvancedDb(!schedShowAdvancedDb)}
                  className="text-xs font-medium text-foreground hover:text-primary flex items-center justify-between w-full transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <span>⚙️</span>
                    <span>Advanced DB Connection Credentials (Optional)</span>
                  </span>
                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono">
                    {schedShowAdvancedDb ? '▲ Hide' : '▼ Configure'}
                  </span>
                </button>
                {schedShowAdvancedDb && (
                  <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-border">
                    <div>
                      <label className="text-[11px] text-muted-foreground">Database User</label>
                      <Input
                        placeholder={schedTargetType === 'postgres' ? 'postgres' : 'root'}
                        value={schedDbUser}
                        onChange={e => setSchedDbUser(e.target.value)}
                        className="mt-1 h-8 text-xs bg-background border-input text-foreground font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground">Database Password</label>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={schedDbPassword}
                        onChange={e => setSchedDbPassword(e.target.value)}
                        className="mt-1 h-8 text-xs bg-background border-input text-foreground font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground">Host</label>
                      <Input
                        placeholder="127.0.0.1"
                        value={schedDbHost}
                        onChange={e => setSchedDbHost(e.target.value)}
                        className="mt-1 h-8 text-xs bg-background border-input text-foreground font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground">Port</label>
                      <Input
                        placeholder={schedTargetType === 'postgres' ? '5432' : '3306'}
                        value={schedDbPort}
                        onChange={e => setSchedDbPort(e.target.value)}
                        className="mt-1 h-8 text-xs bg-background border-input text-foreground font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {schedTargetType === 'custom' && (
              <div>
                <label className="text-xs font-medium text-foreground">Custom Script / Command (Use {"{{dest}}"} for output archive path)</label>
                <Input
                  placeholder="docker exec -t db_container pg_dump -U user db | gzip > {{dest}}"
                  value={schedCustomCommand}
                  onChange={e => setSchedCustomCommand(e.target.value)}
                  className="mt-1 font-mono text-xs bg-background border-input text-foreground"
                  required
                />
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-foreground">Remote Destination Directory</label>
              <Input
                placeholder="/var/backups"
                value={schedDestinationDir}
                onChange={e => setSchedDestinationDir(e.target.value)}
                className="mt-1 font-mono text-xs bg-background border-input text-foreground"
              />
            </div>

            {/* Cron Frequency Presets */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">Execution Interval (Server Crontab)</label>
                <span className="text-[11px] font-mono text-indigo-500 font-semibold">
                  {getCronFromPreset(schedCronPreset)}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {/* 2x Daily Featured Button */}
                <div 
                  onClick={() => setSchedCronPreset('twice_daily')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    schedCronPreset === 'twice_daily'
                      ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40'
                      : 'border-border bg-card/60 hover:border-border/90'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                      ⭐ 2 Backups a Day
                    </span>
                    <Badge variant="outline" className="text-[10px] font-mono bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border-indigo-500/30">
                      0 2,14 * * *
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Runs every 12 hours at 02:00 and 14:00 server time.
                  </p>
                </div>

                {/* Daily */}
                <div 
                  onClick={() => setSchedCronPreset('daily')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    schedCronPreset === 'daily'
                      ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40'
                      : 'border-border bg-card/60 hover:border-border/90'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-foreground">🌙 Once Daily</span>
                    <Badge variant="outline" className="text-[10px] font-mono">0 3 * * *</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Runs nightly at 03:00 server time.
                  </p>
                </div>

                {/* Every 6 Hours */}
                <div 
                  onClick={() => setSchedCronPreset('every_6h')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    schedCronPreset === 'every_6h'
                      ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40'
                      : 'border-border bg-card/60 hover:border-border/90'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-foreground">🔄 Every 6 Hours</span>
                    <Badge variant="outline" className="text-[10px] font-mono">0 */6 * * *</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Runs at 00:00, 06:00, 12:00, and 18:00.
                  </p>
                </div>

                {/* Hourly */}
                <div 
                  onClick={() => setSchedCronPreset('hourly')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    schedCronPreset === 'hourly'
                      ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40'
                      : 'border-border bg-card/60 hover:border-border/90'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-foreground">⚡ Hourly</span>
                    <Badge variant="outline" className="text-[10px] font-mono">0 * * * *</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Runs at minute 0 of every hour.
                  </p>
                </div>

                {/* Weekly */}
                <div 
                  onClick={() => setSchedCronPreset('weekly')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    schedCronPreset === 'weekly'
                      ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40'
                      : 'border-border bg-card/60 hover:border-border/90'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-foreground">📅 Weekly</span>
                    <Badge variant="outline" className="text-[10px] font-mono">0 2 * * 0</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Runs every Sunday at 02:00.
                  </p>
                </div>

                {/* Custom */}
                <div 
                  onClick={() => setSchedCronPreset('custom')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    schedCronPreset === 'custom'
                      ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40'
                      : 'border-border bg-card/60 hover:border-border/90'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-foreground">⚙️ Custom Cron</span>
                    <Badge variant="outline" className="text-[10px] font-mono">Custom</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Enter raw 5-field cron syntax.
                  </p>
                </div>
              </div>

              {schedCronPreset === 'custom' && (
                <div className="pt-2">
                  <Input 
                    placeholder="e.g. 30 1,13 * * *"
                    value={schedCustomCron}
                    onChange={e => setSchedCustomCron(e.target.value)}
                    className="font-mono text-xs bg-background border-input text-foreground"
                    required
                  />
                </div>
              )}
            </div>

            {/* Local Retention Count */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">Local Server Retention</label>
                <span className="text-xs font-mono text-muted-foreground">Keep latest {schedRetention} backups</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[7, 14, 30, 60].map(cnt => (
                  <Button
                    key={cnt}
                    type="button"
                    variant={schedRetention === cnt ? 'default' : 'outline'}
                    size="sm"
                    className={`text-xs h-8 ${
                      schedRetention === cnt 
                        ? 'bg-indigo-600 text-white hover:bg-indigo-500' 
                        : 'border-border bg-background text-foreground hover:bg-accent'
                    }`}
                    onClick={() => setSchedRetention(cnt)}
                  >
                    Keep {cnt}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Older local archives beyond this count will be automatically purged by the script to avoid filling server disk space.
              </p>
            </div>

            {/* Cloud Offsite Upload Toggle */}
            <div className="border border-border bg-muted/40 rounded-xl p-3 space-y-2.5">
              <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Cloud className="h-4 w-4 text-sky-500" />
                <span>Offsite Cloud Sync (Amazon S3 / Dropbox)</span>
              </label>

              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant={schedCloudProvider === 'none' ? 'default' : 'outline'}
                  size="sm"
                  className={`text-xs h-8 ${
                    schedCloudProvider === 'none' 
                      ? 'bg-zinc-800 text-white' 
                      : 'border-border bg-background text-foreground hover:bg-accent'
                  }`}
                  onClick={() => setSchedCloudProvider('none')}
                >
                  None (Local Only)
                </Button>
                <Button
                  type="button"
                  variant={schedCloudProvider === 's3' ? 'default' : 'outline'}
                  size="sm"
                  className={`text-xs h-8 ${
                    schedCloudProvider === 's3' 
                      ? 'bg-amber-600 text-white hover:bg-amber-500' 
                      : 'border-border bg-background text-foreground hover:bg-accent'
                  }`}
                  onClick={() => setSchedCloudProvider('s3')}
                >
                  Amazon S3 / R2
                </Button>
                <Button
                  type="button"
                  variant={schedCloudProvider === 'dropbox' ? 'default' : 'outline'}
                  size="sm"
                  className={`text-xs h-8 ${
                    schedCloudProvider === 'dropbox' 
                      ? 'bg-blue-600 text-white hover:bg-blue-500' 
                      : 'border-border bg-background text-foreground hover:bg-accent'
                  }`}
                  onClick={() => setSchedCloudProvider('dropbox')}
                >
                  Dropbox
                </Button>
              </div>

              {schedCloudProvider !== 'none' && (
                <div className="space-y-2 pt-2 border-t border-border">
                  <label className="text-[11px] text-muted-foreground">Select Cloud Storage Account</label>
                  {cloudConfigs.filter(c => c.provider === schedCloudProvider).length === 0 ? (
                    <div className="text-xs text-amber-500 p-2 rounded bg-amber-500/10 border border-amber-500/20">
                      No {schedCloudProvider.toUpperCase()} configurations found. Please create one in the "Cloud Storage" tab first or click "Cancel" to configure it.
                    </div>
                  ) : (
                    <select
                      value={schedCloudConfigId}
                      onChange={e => setSchedCloudConfigId(e.target.value)}
                      className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 text-foreground"
                    >
                      {cloudConfigs
                        .filter(c => c.provider === schedCloudProvider)
                        .map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setScheduleModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                Cancel
              </Button>
              <Button type="submit" disabled={creatingSchedule} className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
                {creatingSchedule ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calendar className="h-4 w-4 mr-2" />}
                Install Server Cron Job
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL: ADD CLOUD STORAGE CONFIG                                           */}
      {/* ========================================================================= */}
      <Dialog open={cloudModalOpen} onOpenChange={setCloudModalOpen}>
        <DialogContent className="max-w-lg bg-card border-border text-foreground max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Cloud className="h-5 w-5 text-sky-500" />
              Connect Cloud Storage Provider
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              Configure credentials for Amazon S3 (or S3-compatible endpoints) or Dropbox to enable remote disaster recovery.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveCloudConfig} className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium text-foreground">Storage Provider</label>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                <Button
                  type="button"
                  variant={cloudProviderType === 's3' ? 'default' : 'outline'}
                  size="sm"
                  className={`text-xs h-9 ${
                    cloudProviderType === 's3' 
                      ? 'bg-amber-600 text-white hover:bg-amber-500' 
                      : 'border-border bg-background text-foreground hover:bg-accent'
                  }`}
                  onClick={() => setCloudProviderType('s3')}
                >
                  🪣 Amazon S3 / S3-Compatible
                </Button>
                <Button
                  type="button"
                  variant={cloudProviderType === 'dropbox' ? 'default' : 'outline'}
                  size="sm"
                  className={`text-xs h-9 ${
                    cloudProviderType === 'dropbox' 
                      ? 'bg-blue-600 text-white hover:bg-blue-500' 
                      : 'border-border bg-background text-foreground hover:bg-accent'
                  }`}
                  onClick={() => setCloudProviderType('dropbox')}
                >
                  📦 Dropbox
                </Button>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-foreground">Configuration Name</label>
              <Input
                placeholder={cloudProviderType === 's3' ? 'e.g. AWS Production S3 or Cloudflare R2' : 'e.g. Dropbox Business Backup'}
                value={cloudConfigName}
                onChange={e => setCloudConfigName(e.target.value)}
                required
                className="mt-1 bg-background border-input text-foreground text-xs"
              />
            </div>

            {cloudProviderType === 's3' ? (
              <div className="space-y-3 p-3 rounded-xl border border-border bg-muted/30">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] text-muted-foreground">S3 Bucket Name *</label>
                    <Input
                      placeholder="my-server-backups"
                      value={s3Bucket}
                      onChange={e => setS3Bucket(e.target.value)}
                      required
                      className="mt-1 h-8 text-xs font-mono bg-background border-input text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">AWS Region</label>
                    <Input
                      placeholder="us-east-1 (or auto for R2)"
                      value={s3Region}
                      onChange={e => setS3Region(e.target.value)}
                      className="mt-1 h-8 text-xs font-mono bg-background border-input text-foreground"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground">Access Key ID *</label>
                  <Input
                    placeholder="AKIAIOSFODNN7EXAMPLE"
                    value={s3AccessKey}
                    onChange={e => setS3AccessKey(e.target.value)}
                    required
                    className="mt-1 h-8 text-xs font-mono bg-background border-input text-foreground"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground">Secret Access Key *</label>
                  <Input
                    type="password"
                    placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                    value={s3SecretKey}
                    onChange={e => setS3SecretKey(e.target.value)}
                    required
                    className="mt-1 h-8 text-xs font-mono bg-background border-input text-foreground"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground">Custom Endpoint URL (Optional)</label>
                  <Input
                    placeholder="https://<account-id>.r2.cloudflarestorage.com or MinIO URL"
                    value={s3Endpoint}
                    onChange={e => setS3Endpoint(e.target.value)}
                    className="mt-1 h-8 text-xs font-mono bg-background border-input text-foreground"
                  />
                  <span className="text-[10px] text-muted-foreground">Leave blank for standard AWS S3</span>
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground">Remote Key Prefix (Folder Path)</label>
                  <Input
                    placeholder="backups/production/"
                    value={s3Prefix}
                    onChange={e => setS3Prefix(e.target.value)}
                    className="mt-1 h-8 text-xs font-mono bg-background border-input text-foreground"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-3 rounded-xl border border-border bg-muted/30">
                <div>
                  <label className="text-[11px] text-muted-foreground">Dropbox Access Token *</label>
                  <Input
                    type="password"
                    placeholder="sl.u.AF3... (Scoped access token)"
                    value={dropboxToken}
                    onChange={e => setDropboxToken(e.target.value)}
                    required
                    className="mt-1 h-8 text-xs font-mono bg-background border-input text-foreground"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Generate an OAuth2 access token with <code className="text-primary">files.content.write</code> permission in the Dropbox App Console.
                  </p>
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground">Remote Destination Folder</label>
                  <Input
                    placeholder="/ServerBackups"
                    value={dropboxPrefix}
                    onChange={e => setDropboxPrefix(e.target.value)}
                    className="mt-1 h-8 text-xs font-mono bg-background border-input text-foreground"
                  />
                </div>
              </div>
            )}

            <DialogFooter className="pt-2 flex items-center justify-between sm:justify-between w-full">
              <Button 
                type="button" 
                variant="outline" 
                onClick={handleTestCloudConnection} 
                disabled={testingCloud}
                className="text-xs h-9 border-sky-500/30 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10"
              >
                {testingCloud ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />}
                Test Probe
              </Button>

              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={() => setCloudModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                  Cancel
                </Button>
                <Button type="submit" disabled={savingCloud} className="bg-sky-600 hover:bg-sky-500 text-white font-medium">
                  {savingCloud ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Cloud className="h-4 w-4 mr-2" />}
                  Save Account
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL: UPLOAD BACKUP TO CLOUD                                              */}
      {/* ========================================================================= */}
      <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
        <DialogContent className="max-w-md bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <CloudUpload className="h-5 w-5 text-sky-500" />
              Upload Backup to Cloud Storage
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              Ship this archive directly from the remote server to your offsite S3 or Dropbox account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="p-3 bg-muted/40 rounded-xl border border-border space-y-1">
              <div className="text-xs font-semibold text-foreground">Backup Target: {uploadingBackup?.target}</div>
              <div className="text-[11px] text-muted-foreground font-mono">{uploadingBackup?.destination}</div>
              <div className="text-[11px] text-teal-600 dark:text-teal-400 font-semibold font-mono">
                {formatBytes(uploadingBackup?.size_bytes || 0)}
              </div>
            </div>

            {cloudConfigs.length === 0 ? (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
                No cloud storage accounts configured. Please add an S3 or Dropbox account in the "Cloud Storage" tab first.
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-foreground">Select Cloud Storage Destination</label>
                <select
                  value={uploadCloudConfigId}
                  onChange={e => setUploadCloudConfigId(e.target.value)}
                  className="w-full mt-1.5 text-xs h-9 rounded-md border border-input bg-background px-3 py-1 text-foreground"
                >
                  {cloudConfigs.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.provider.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => setUploadModalOpen(false)} className="text-muted-foreground hover:text-foreground">
              Cancel
            </Button>
            <Button 
              type="button" 
              onClick={handleUploadBackupToCloud} 
              disabled={uploadingToCloud || cloudConfigs.length === 0} 
              className="bg-sky-600 hover:bg-sky-500 text-white font-medium"
            >
              {uploadingToCloud ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CloudUpload className="h-4 w-4 mr-2" />}
              {uploadingToCloud ? 'Streaming to Cloud...' : 'Upload Now'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL: RESTORE BACKUP CONFIRMATION                                         */}
      {/* ========================================================================= */}
      <Dialog open={restoreModalOpen} onOpenChange={setRestoreModalOpen}>
        <DialogContent className="max-w-md bg-card border-border text-foreground">
          <DialogHeader>
            <div className="flex items-center gap-2 text-rose-500 dark:text-rose-400 font-semibold">
              <AlertTriangle className="h-5 w-5" />
              <span>Confirm Destructive Restore</span>
            </div>
            <DialogDescription className="pt-2 text-muted-foreground text-xs">
              Restoring <span className="font-semibold text-foreground">{selectedBackup?.target}</span> from{' '}
              <span className="font-mono text-xs text-teal-600 dark:text-teal-300">{selectedBackup?.destination}</span> will overwrite existing
              data on the server.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-2">
            <p className="text-xs text-muted-foreground">
              To prevent accidental data loss, please type <strong className="text-rose-500 dark:text-rose-400 font-mono">RESTORE</strong> below to proceed:
            </p>
            <Input
              value={confirmInput}
              onChange={e => setConfirmInput(e.target.value)}
              placeholder="Type RESTORE to confirm"
              className="font-mono text-center font-bold tracking-widest bg-background border-rose-500/30 text-rose-600 dark:text-rose-300"
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setRestoreModalOpen(false)} disabled={restoring} className="text-muted-foreground hover:text-foreground">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRestore}
              disabled={confirmInput !== 'RESTORE' || restoring}
              className="bg-red-600 hover:bg-red-500 text-white"
            >
              {restoring ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
              Confirm Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
