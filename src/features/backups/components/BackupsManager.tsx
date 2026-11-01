import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  listBackups, 
  createBackup, 
  restoreBackup, 
  deleteBackup, 
  downloadBackup, 
  requestConfirmation, 
  type BackupRecord, 
  type CreateBackupOptions 
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
  Zap
} from 'lucide-react';
import { toast } from 'sonner';

interface BackupsManagerProps {
  serverId: string;
}

export const BackupsManager: React.FC<BackupsManagerProps> = ({ serverId }) => {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupRecord | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [creating, setCreating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Form State
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

  useEffect(() => {
    loadBackups();
  }, [serverId]);

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
            <h2 className="text-xl font-bold tracking-tight text-foreground">Live Database Backups & Snapshots</h2>
            <Badge variant="outline" className="text-xs bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border-indigo-500/30">
              SSH Stream Download
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Execute automated live database dumps (pg_dump, mysqldump, redis bgsave) and download backup archives directly to your PC's Downloads folder.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
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
            New Backup
          </Button>
        </div>
      </div>

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

      {/* Backups List */}
      {backups.length === 0 && !loading ? (
        <Card className="border-dashed border-border bg-card/40">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FolderArchive className="h-12 w-12 text-muted-foreground mb-3" />
            <h3 className="font-semibold text-lg text-foreground">No backups found</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-1 mb-4">
              Take a snapshot of your live PostgreSQL, MySQL, Redis databases, or application files. You can restore them anytime or download the archives to your local PC.
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
                      className="h-8 text-xs text-amber-400 hover:text-amber-300 border-amber-500/30 hover:bg-amber-500/10"
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
                      className="h-8 w-8 p-0 text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
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

      {/* Create Backup Modal */}
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

      {/* Restore Confirmation Modal */}
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
