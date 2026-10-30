import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { listBackups, createBackup, restoreBackup, deleteBackup, requestConfirmation, type BackupRecord, type CreateBackupOptions } from '@/lib/tauri-client';
import { Database, FolderArchive, RefreshCw, Trash2, RotateCcw, Plus, CheckCircle2, XCircle, HardDrive, Loader2, AlertTriangle } from 'lucide-react';
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

  // Form State
  const [targetType, setTargetType] = useState<'postgres' | 'mysql' | 'redis' | 'directory' | 'custom'>('postgres');
  const [targetName, setTargetName] = useState('');
  const [destinationDir, setDestinationDir] = useState('/var/backups');
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
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
        custom_command: targetType === 'custom' ? customCommand.trim() : undefined,
      };

      const record = await createBackup(serverId, opts);
      toast.success('Backup created successfully', {
        description: `Saved to ${record.destination} (${formatBytes(record.size_bytes || 0)})`,
      });
      setCreateModalOpen(false);
      setTargetName('');
      loadBackups();
    } catch (err: any) {
      toast.error('Backup creation failed', { description: err.message || String(err) });
    } finally {
      setCreating(false);
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
      // 1. Obtain confirmation token
      const token = await requestConfirmation(`Restore backup ${selectedBackup.target} on server`, [serverId]);
      
      // 2. Perform restore
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Remote Backups</h2>
          <p className="text-sm text-muted-foreground">
            Automated database dumps and file archive snapshots directly over SSH.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadBackups} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Backup
          </Button>
        </div>
      </div>

      {backups.length === 0 && !loading ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FolderArchive className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg">No backups found</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-1 mb-4">
              Create an automated dump for your PostgreSQL, MySQL, Redis databases, or application files.
            </p>
            <Button size="sm" onClick={() => setCreateModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Create First Backup
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {backups.map(b => (
            <Card key={b.id} className="overflow-hidden hover:border-primary/50 transition-colors">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary/10 text-primary rounded-lg">
                    {b.destination.includes('pg_') || b.destination.includes('mysql_') || b.destination.includes('redis_') ? (
                      <Database className="h-6 w-6" />
                    ) : (
                      <FolderArchive className="h-6 w-6" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-base">{b.target}</span>
                      {b.status === 'success' ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
                          <CheckCircle2 className="h-3 w-3" /> Ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
                          <XCircle className="h-3 w-3" /> Failed
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-3 mt-1 font-mono">
                      <span>{b.destination}</span>
                      <span>•</span>
                      <span>{b.size_bytes ? formatBytes(b.size_bytes) : 'Size unknown'}</span>
                      <span>•</span>
                      <span>{new Date(b.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
                    onClick={() => {
                      setSelectedBackup(b);
                      setConfirmInput('');
                      setRestoreModalOpen(true);
                    }}
                  >
                    <RotateCcw className="h-4 w-4 mr-1.5" />
                    Restore
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(b)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Backup Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Remote Backup</DialogTitle>
            <DialogDescription>
              Execute an automated backup dump on this server.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Target Type</label>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                {[
                  { id: 'postgres', label: 'PostgreSQL DB' },
                  { id: 'mysql', label: 'MySQL DB' },
                  { id: 'redis', label: 'Redis RDB' },
                  { id: 'directory', label: 'File Directory' },
                  { id: 'custom', label: 'Custom Command' },
                ].map(t => (
                  <Button
                    key={t.id}
                    type="button"
                    variant={targetType === t.id ? 'default' : 'outline'}
                    size="sm"
                    className="justify-start text-xs"
                    onClick={() => setTargetType(t.id as any)}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {targetType === 'directory' ? 'Absolute Directory Path' : 'Database / Service Name'}
              </label>
              <Input
                placeholder={targetType === 'directory' ? '/var/www/my-app' : 'production_db'}
                value={targetName}
                onChange={e => setTargetName(e.target.value)}
                required
                className="mt-1"
              />
            </div>

            {targetType === 'custom' && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Custom Backup Command (Use {"{{dest}}"} for output file)</label>
                <Input
                  placeholder="docker exec -t db_container pg_dump -U user db | gzip > {{dest}}"
                  value={customCommand}
                  onChange={e => setCustomCommand(e.target.value)}
                  className="mt-1 font-mono text-xs"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground">Remote Destination Directory</label>
              <Input
                placeholder="/var/backups"
                value={destinationDir}
                onChange={e => setDestinationDir(e.target.value)}
                className="mt-1 font-mono text-xs"
              />
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="ghost" onClick={() => setCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <HardDrive className="h-4 w-4 mr-2" />}
                Run Backup
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Restore Confirmation Modal */}
      <Dialog open={restoreModalOpen} onOpenChange={setRestoreModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 text-destructive font-semibold">
              <AlertTriangle className="h-5 w-5" />
              <span>Confirm Destructive Restore</span>
            </div>
            <DialogDescription className="pt-2">
              Restoring <span className="font-semibold text-foreground">{selectedBackup?.target}</span> from{' '}
              <span className="font-mono text-xs text-foreground">{selectedBackup?.destination}</span> will overwrite existing
              data on the server.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-2">
            <p className="text-xs text-muted-foreground">
              To prevent accidental data loss, please type <strong className="text-destructive font-mono">RESTORE</strong> below to proceed:
            </p>
            <Input
              value={confirmInput}
              onChange={e => setConfirmInput(e.target.value)}
              placeholder="Type RESTORE to confirm"
              className="font-mono text-center font-bold tracking-widest"
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setRestoreModalOpen(false)} disabled={restoring}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRestore}
              disabled={confirmInput !== 'RESTORE' || restoring}
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
