import React, { useState, useEffect } from 'react';
import { CredentialsList } from './CredentialsList';
import { useVaultStore } from '@/stores/use-vault-store';
import { unlockVault } from '@/lib/tauri-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, Unlock, ShieldAlert, Timer, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export const VaultSettings = () => {
  const { 
    sessionTimeout, 
    setSessionTimeout, 
    isUnlocked, 
    lastActivity, 
    autoLockedAt,
    lock, 
    unlock,
    clearAutoLockNotice 
  } = useVaultStore();

  const [password, setPassword] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [now, setNow] = useState(Date.now());

  // Update timer display every second
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleManualUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    try {
      setIsUnlocking(true);
      setErrorMsg('');
      await unlockVault(password);
      unlock(password);
      setPassword('');
      toast.success('Vault session unlocked successfully');
    } catch (err: any) {
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'Invalid master password');
    } finally {
      setIsUnlocking(false);
    }
  };

  const calculateRemainingText = () => {
    if (!isUnlocked || sessionTimeout === 0 || lastActivity === 0) return null;
    const timeoutMs = sessionTimeout * 60 * 1000;
    const remainingMs = Math.max(0, timeoutMs - (now - lastActivity));
    const totalSec = Math.floor(remainingMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  };

  const remainingFormatted = calculateRemainingText();

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight mb-2">Vault & Credentials</h2>
        <p className="text-muted-foreground">Manage your secure credentials, SSH keys, and vault configuration.</p>
      </div>

      {autoLockedAt && !isUnlocked && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-center justify-between text-yellow-500">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-medium text-sm">Vault Session Auto-Locked</p>
              <p className="text-xs text-yellow-500/80">
                The vault was locked due to inactivity. Enter your master password below to resume.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={clearAutoLockNotice} className="text-xs text-yellow-500 hover:bg-yellow-500/20">
            Dismiss
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card className="bg-card/50">
            <CardHeader>
              <CardTitle>Stored Credentials</CardTitle>
              <CardDescription>
                Credentials used to authenticate with your servers. Raw secrets are never exposed in this list.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CredentialsList />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-card/50">
            <CardHeader>
              <CardTitle className="flex items-center">
                {isUnlocked ? <Unlock className="w-5 h-5 mr-2 text-green-500" /> : <Lock className="w-5 h-5 mr-2 text-primary" />}
                Vault Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col space-y-2">
                <span className="text-sm font-medium">Session Status</span>
                <div className="flex items-center justify-between">
                  <span className={`text-sm flex items-center gap-1.5 ${isUnlocked ? 'text-green-500 font-medium' : 'text-muted-foreground'}`}>
                    {isUnlocked ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Unlocked
                      </>
                    ) : (
                      <>
                        <Lock className="w-4 h-4" />
                        Locked
                      </>
                    )}
                  </span>
                  {isUnlocked && (
                    <Button variant="outline" size="sm" onClick={() => lock(false)} className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10">
                      Lock Now
                    </Button>
                  )}
                </div>

                {isUnlocked && remainingFormatted && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
                    <Timer className="w-3.5 h-3.5 text-primary" />
                    <span>Auto-locks in <span className="font-mono text-foreground font-medium">{remainingFormatted}</span></span>
                  </div>
                )}
              </div>

              {!isUnlocked && (
                <form onSubmit={handleManualUnlock} className="space-y-3 pt-2 border-t">
                  <span className="text-sm font-medium">Unlock Session</span>
                  <Input 
                    type="password" 
                    placeholder="Master Password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-8 text-sm"
                  />
                  {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
                  <Button type="submit" size="sm" disabled={isUnlocking || !password} className="w-full h-8 text-xs">
                    {isUnlocking && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    Unlock Vault
                  </Button>
                </form>
              )}

              <div className="flex flex-col space-y-2 pt-2 border-t">
                <span className="text-sm font-medium">Auto-lock Timeout</span>
                <Select value={sessionTimeout.toString()} onValueChange={(v) => { if (v) setSessionTimeout(parseInt(v, 10)); }}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 Minute (Testing)</SelectItem>
                    <SelectItem value="5">5 Minutes</SelectItem>
                    <SelectItem value="15">15 Minutes</SelectItem>
                    <SelectItem value="30">30 Minutes</SelectItem>
                    <SelectItem value="60">1 Hour</SelectItem>
                    <SelectItem value="240">4 Hours</SelectItem>
                    <SelectItem value="0">Until App Closes</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">
                  Enforces auto-lock on vault inactivity.
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

