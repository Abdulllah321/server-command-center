import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCreateServerFlow } from '../api/use-server-mutations';
import { toast } from 'sonner';
import { showIpcError } from '@/lib/error-handler';
import { testDirectConnection, testConnection, updateServer, createCredential } from '@/lib/tauri-client';
import type { AuthMethod, Environment, Server } from '@/types';
import { Loader2 } from 'lucide-react';
import { useVaultStore } from '@/stores/use-vault-store';
import { useQueryClient } from '@tanstack/react-query';

interface ServerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverToEdit?: Server | null;
  onSaved?: (server: Server) => void;
}

export const ServerModal = ({ open, onOpenChange, serverToEdit, onSaved }: ServerModalProps) => {
  const queryClient = useQueryClient();
  const isEditing = !!serverToEdit;

  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [sshPort, setSshPort] = useState(22);
  const [username, setUsername] = useState('root');
  const [environment, setEnvironment] = useState<Environment>('dev');
  const [tags, setTags] = useState('');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password');
  const [secretPayload, setSecretPayload] = useState('');
  const [masterPassword, setMasterPassword] = useState('');

  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const createFlow = useCreateServerFlow();

  useEffect(() => {
    if (open) {
      if (serverToEdit) {
        setName(serverToEdit.name || '');
        setHostname(serverToEdit.hostname || '');
        setSshPort(serverToEdit.ssh_port || 22);
        setUsername(serverToEdit.username || 'root');
        setEnvironment((serverToEdit.environment as Environment) || 'dev');
        setTags(serverToEdit.tags ? serverToEdit.tags.join(', ') : '');
        setAuthMethod('password');
        setSecretPayload('');
        setMasterPassword('');
        setTestResult(null);
      } else {
        setName('');
        setHostname('');
        setSshPort(22);
        setUsername('root');
        setEnvironment('dev');
        setTags('');
        setAuthMethod('password');
        setSecretPayload('');
        setMasterPassword('');
        setTestResult(null);
      }
    }
  }, [open, serverToEdit]);

  const handleTestConnection = async () => {
    if (!hostname.trim() || !username.trim()) {
      toast.error('Please enter Hostname and SSH Username to test');
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      if (secretPayload.trim() || authMethod === 'ssh_agent') {
        // Direct test with entered credentials
        await testDirectConnection({
          server_id: serverToEdit?.id,
          server_name: name.trim() || undefined,
          hostname: hostname.trim(),
          ssh_port: Number(sshPort) || 22,
          username: username.trim(),
          auth_method: authMethod,
          secret_payload: secretPayload,
        });
        setTestResult({ success: true, message: 'SSH connection & authentication succeeded!' });
      } else if (serverToEdit) {
        // Test existing saved credentials for this server
        await testConnection(
          serverToEdit.id,
          authMethod,
          masterPassword || useVaultStore.getState().masterPassword || undefined
        );
        setTestResult({ success: true, message: 'SSH connection & authentication succeeded with saved credentials!' });
      } else {
        toast.error(`Please enter your SSH ${authMethod === 'password' ? 'password' : 'private key'} to test`);
        setIsTesting(false);
        return;
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || String(err) });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !hostname.trim() || !username.trim()) {
      toast.error('Please fill in all required fields (name, hostname, username)');
      return;
    }

    if (!isEditing && authMethod !== 'ssh_agent' && !secretPayload.trim()) {
      toast.error(`Please enter your SSH ${authMethod === 'password' ? 'password' : 'private key'}`);
      return;
    }

    const tagsArray = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    
    if (isEditing && serverToEdit) {
      setIsSaving(true);
      try {
        const updated = await updateServer(serverToEdit.id, {
          name: name.trim(),
          hostname: hostname.trim(),
          ssh_port: Number(sshPort) || 22,
          username: username.trim(),
          environment,
          tags: tagsArray,
        });

        if (secretPayload.trim() || authMethod === 'ssh_agent') {
          await createCredential({
            server_id: serverToEdit.id,
            auth_method: authMethod,
            secret_payload: secretPayload,
            master_password: masterPassword || useVaultStore.getState().masterPassword,
          });

          if (masterPassword) {
            useVaultStore.getState().unlock(masterPassword);
          } else if (authMethod === 'private_key' || authMethod === 'password_key') {
            useVaultStore.getState().pingVaultActivity();
          }
        }

        queryClient.invalidateQueries({ queryKey: ['servers'] });
        queryClient.invalidateQueries({ queryKey: ['server', serverToEdit.id] });
        toast.success(`Server "${updated.name}" updated successfully`);
        onSaved?.(updated);
        onOpenChange(false);
      } catch (err: any) {
        showIpcError(err, { action: 'Update Server', serverName: serverToEdit.name });
      } finally {
        setIsSaving(false);
      }
    } else {
      try {
        const newServer = await createFlow.mutateAsync({
          server: {
            name: name.trim(),
            hostname: hostname.trim(),
            ssh_port: Number(sshPort) || 22,
            username: username.trim(),
            os: null,
            provider: null,
            environment,
            description: null,
            tags: tagsArray,
          },
          credential: {
            auth_method: authMethod,
            secret_payload: secretPayload,
            master_password: masterPassword || useVaultStore.getState().masterPassword,
          }
        });
        
        if (masterPassword) {
          useVaultStore.getState().unlock(masterPassword);
        } else if (authMethod === 'private_key' || authMethod === 'password_key') {
          useVaultStore.getState().pingVaultActivity();
        }
        
        queryClient.invalidateQueries({ queryKey: ['servers'] });
        toast.success('Server added successfully');
        onSaved?.(newServer);
        onOpenChange(false);
      } catch (err: any) {
        showIpcError(err, { action: 'Add Server' });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border-primary/20">
        <DialogHeader>
          <DialogTitle>{isEditing ? `Edit Server — ${serverToEdit?.name}` : 'Add Server'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name *</label>
              <Input 
                placeholder="Production DB" 
                value={name} 
                onChange={e => setName(e.target.value)} 
                required 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Environment</label>
              <Select value={environment} onValueChange={(v) => setEnvironment((v as Environment) || 'dev')}>
                <SelectTrigger><SelectValue placeholder="Select env" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Production</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="dev">Dev</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-2">
              <label className="text-sm font-medium">Hostname / IP *</label>
              <Input 
                placeholder="192.168.1.10" 
                value={hostname} 
                onChange={e => setHostname(e.target.value)} 
                required 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">SSH Port</label>
              <Input 
                type="number" 
                value={sshPort} 
                onChange={e => setSshPort(Number(e.target.value))} 
                min={1} 
                max={65535} 
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">SSH Username *</label>
              <Input 
                placeholder="root" 
                value={username} 
                onChange={e => setUsername(e.target.value)} 
                required 
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Tags (comma separated)</label>
              <Input 
                placeholder="db, production, redis" 
                value={tags} 
                onChange={e => setTags(e.target.value)} 
              />
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">Authentication</h3>
              {isEditing && (
                <span className="text-xs text-muted-foreground">
                  (Leave blank to keep existing stored credentials)
                </span>
              )}
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Auth Method</label>
                <Select value={authMethod} onValueChange={(v) => setAuthMethod((v as AuthMethod) || 'password')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="password">Password</SelectItem>
                    <SelectItem value="private_key">Private Key (Vault)</SelectItem>
                    <SelectItem value="ssh_agent">SSH Agent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {authMethod === 'password' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Password {isEditing ? '(optional)' : '*'}
                  </label>
                  <Input 
                    type="password" 
                    placeholder={isEditing ? 'Enter new password to update (or leave blank)' : 'Enter SSH password'} 
                    value={secretPayload} 
                    onChange={e => setSecretPayload(e.target.value)} 
                    required={!isEditing}
                  />
                </div>
              )}

              {authMethod === 'private_key' && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Private Key (PEM) {isEditing ? '(optional)' : '*'}
                    </label>
                    <Textarea 
                      placeholder={isEditing ? 'Enter new private key to update (or leave blank)' : '-----BEGIN OPENSSH PRIVATE KEY-----...'} 
                      className="font-mono text-xs h-32" 
                      value={secretPayload} 
                      onChange={e => setSecretPayload(e.target.value)} 
                      required={!isEditing}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Vault Master Password (to unlock/save to vault)</label>
                    <Input 
                      type="password" 
                      placeholder="Required for Vault storage" 
                      value={masterPassword} 
                      onChange={e => setMasterPassword(e.target.value)} 
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {testResult && (
            <div className={`p-3 rounded text-sm ${testResult.success ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive'}`}>
              {testResult.message}
            </div>
          )}

          <div className="flex justify-between border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={handleTestConnection} disabled={isTesting}>
              {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Test Connection
            </Button>
            <div className="space-x-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={createFlow.isPending || isSaving}>
                {(createFlow.isPending || isSaving) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? 'Save Changes' : 'Save Server'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
