import React, { useState } from 'react';
import { useCredentials, useRevealCredential } from '../api/use-vault-mutations';
import { useVaultStore } from '@/stores/use-vault-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Key, Copy, Loader2, Lock, Unlock } from 'lucide-react';
import type { CredentialMetadataExtended } from '@/types';

export const CredentialsList = () => {
  const { data: credentials, isLoading } = useCredentials();
  const revealFlow = useRevealCredential();
  const { isUnlocked, masterPassword, unlock } = useVaultStore();

  const [activeCred, setActiveCred] = useState<CredentialMetadataExtended | null>(null);
  const [promptPassword, setPromptPassword] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const needsVault = (method: string) => method === 'private_key' || method === 'password_key';

  const handleRevealClick = (cred: CredentialMetadataExtended) => {
    if (needsVault(cred.auth_method) && !isUnlocked) {
      setActiveCred(cred);
      setRevealedSecret(null);
      setErrorMsg('');
      setPromptPassword('');
    } else {
      executeReveal(cred.id, masterPassword);
    }
  };

  const executeReveal = async (id: string, password?: string) => {
    try {
      setErrorMsg('');
      const secret = await revealFlow.mutateAsync({ id, masterPassword: password });
      setRevealedSecret(secret);
      
      // Auto hide after 15 seconds
      setTimeout(() => {
        setRevealedSecret(null);
        setActiveCred(null);
      }, 15000);
      
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to decrypt credential');
    }
  };

  const submitUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCred) return;
    
    try {
      await executeReveal(activeCred.id, promptPassword);
      unlock(promptPassword); // Save to session on success
    } catch {
      // Error already set by executeReveal
    }
  };

  const copyToClipboard = () => {
    if (revealedSecret) {
      navigator.clipboard.writeText(revealedSecret);
    }
  };

  if (isLoading) return <div className="p-4 text-muted-foreground">Loading credentials...</div>;

  return (
    <div className="space-y-4">
      {credentials?.length === 0 ? (
        <div className="p-8 text-center border rounded-xl bg-card/30 text-muted-foreground">
          No credentials stored yet.
        </div>
      ) : (
        <div className="border rounded-xl divide-y">
          {credentials?.map((cred) => (
            <div key={cred.id} className="p-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
              <div className="flex items-center space-x-4">
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-medium">{cred.server_name}</p>
                  <div className="text-sm text-muted-foreground flex items-center space-x-2">
                    <span className="capitalize">{cred.auth_method.replace('_', ' ')}</span>
                    {cred.key_fingerprint && (
                      <>
                        <span>•</span>
                        <span className="font-mono text-xs">{cred.key_fingerprint}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => handleRevealClick(cred)}>
                Reveal
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Unlock / Reveal Dialog */}
      <Dialog open={!!activeCred} onOpenChange={(open) => {
        if (!open) {
          setActiveCred(null);
          setRevealedSecret(null);
        }
      }}>
        <DialogContent className="max-w-md bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              {revealedSecret ? <Unlock className="w-5 h-5 mr-2 text-green-500" /> : <Lock className="w-5 h-5 mr-2 text-yellow-500" />}
              {revealedSecret ? 'Secret Revealed' : 'Unlock Vault'}
            </DialogTitle>
          </DialogHeader>
          
          {revealedSecret ? (
            <div className="space-y-4">
              <div className="p-4 bg-black/50 border rounded font-mono text-sm break-all max-h-60 overflow-y-auto">
                {revealedSecret}
              </div>
              <p className="text-xs text-muted-foreground">This secret will auto-hide in 15 seconds.</p>
              <DialogFooter>
                <Button onClick={copyToClipboard}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy to Clipboard
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={submitUnlock} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This credential is encrypted in your vault. Enter your Master Password to reveal it.
              </p>
              <Input 
                type="password" 
                placeholder="Master Password" 
                value={promptPassword}
                onChange={e => setPromptPassword(e.target.value)}
                autoFocus
              />
              {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setActiveCred(null)}>Cancel</Button>
                <Button type="submit" disabled={revealFlow.isPending || !promptPassword}>
                  {revealFlow.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Unlock
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
