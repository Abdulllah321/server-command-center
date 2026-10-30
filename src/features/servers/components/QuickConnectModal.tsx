import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createCredential, testDirectConnection, reconnectServer } from '@/lib/tauri-client';
import type { Server } from '@/types';
import { toast } from 'sonner';
import { showIpcError } from '@/lib/error-handler';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, ShieldCheck, Eye, EyeOff } from 'lucide-react';

interface QuickConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: Server;
  onConnected?: () => void;
}

export const QuickConnectModal = ({ open, onOpenChange, server, onConnected }: QuickConnectModalProps) => {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      toast.error('Please enter the SSH password');
      return;
    }

    setIsConnecting(true);
    try {
      // 1. Direct test connection with server's credentials
      await testDirectConnection({
        server_id: server.id,
        server_name: server.name,
        hostname: server.hostname,
        ssh_port: server.ssh_port,
        username: server.username,
        auth_method: 'password',
        secret_payload: password.trim(),
      });

      // 2. Persist to Windows Credential Manager
      await createCredential({
        server_id: server.id,
        auth_method: 'password',
        secret_payload: password.trim(),
      });

      // 3. Force reconnect the pooled session so subsequent calls use fresh session
      try {
        await reconnectServer(server.id);
      } catch (reconnectErr) {
        console.warn('Pooled session reconnect warning:', reconnectErr);
      }

      // 4. Refresh health & server data immediately
      await queryClient.invalidateQueries({ queryKey: ['health', server.id] });
      await queryClient.invalidateQueries({ queryKey: ['server', server.id] });
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      await queryClient.invalidateQueries({ queryKey: ['pm2', server.id] });

      toast.success(`Connected to ${server.name}! Credentials saved securely.`);
      setPassword('');
      onOpenChange(false);
      onConnected?.();
    } catch (err: any) {
      showIpcError(err, { action: 'Connect & Authenticate', serverName: server.name });
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-primary/20 shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg">Connect to {server.name}</DialogTitle>
              <DialogDescription className="text-xs font-mono text-muted-foreground">
                {server.username}@{server.hostname}:{server.ssh_port}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleConnect} className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center justify-between">
              <span>SSH Password</span>
              <span className="text-xs text-muted-foreground flex items-center gap-1 font-normal">
                <ShieldCheck className="h-3 w-3 text-green-500" /> Stored in Windows Credential Manager
              </span>
            </label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter SSH password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
                disabled={isConnecting}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-secondary/30 border border-white/5 text-xs text-muted-foreground">
            Once saved, this password is securely anchored in your operating system keychain. Veyra will reconnect automatically without prompting again.
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isConnecting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isConnecting || !password.trim()}>
              {isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect & Save'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

