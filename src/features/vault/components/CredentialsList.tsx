import { useState, useEffect, type FormEvent } from 'react';
import { useCredentials, useRevealCredential } from '../api/use-vault-mutations';
import { useVaultStore } from '@/stores/use-vault-store';
import { 
  unlockVault, 
  setupVault, 
  checkWindowsHello, 
  unlockVaultWithWindowsHello, 
  isVaultInitialized, 
  type WindowsHelloStatus 
} from '@/lib/tauri-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter 
} from '@/components/ui/dialog';
import { 
  Key, 
  Copy, 
  Check, 
  Eye, 
  EyeOff, 
  Loader2, 
  Lock, 
  Unlock, 
  ShieldCheck, 
  Fingerprint,
  KeyRound
} from 'lucide-react';
import { toast } from 'sonner';
import type { CredentialMetadataExtended } from '@/types';

export const CredentialsList = () => {
  const { data: credentials, isLoading } = useCredentials();
  const revealFlow = useRevealCredential();
  const { isUnlocked, masterPassword, unlock } = useVaultStore();

  const [activeCred, setActiveCred] = useState<CredentialMetadataExtended | null>(null);
  const [promptPassword, setPromptPassword] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [timerCountdown, setTimerCountdown] = useState<number>(15);
  const [isMasked, setIsMasked] = useState(false);

  // Security & Hardware verification state
  const [helloStatus, setHelloStatus] = useState<WindowsHelloStatus | null>(null);
  const [isVaultInit, setIsVaultInit] = useState(true);
  const [isVerifyingHello, setIsVerifyingHello] = useState(false);
  const [isUnlockingManual, setIsUnlockingManual] = useState(false);

  useEffect(() => {
    checkWindowsHello().then(setHelloStatus).catch(() => {});
    isVaultInitialized().then(setIsVaultInit).catch(() => {});
  }, [isUnlocked]);

  // Handle click to reveal secret
  const handleRevealClick = (cred: CredentialMetadataExtended) => {
    setActiveCred(cred);
    setRevealedSecret(null);
    setErrorMsg('');
    setPromptPassword('');
    setIsMasked(false);
    setTimerCountdown(15);

    // If the Vault Session is ALREADY unlocked, reveal immediately without re-prompting
    if (isUnlocked) {
      executeReveal(cred.id, masterPassword);
    }
    // If the Vault Session is LOCKED, do NOT reveal. The unlock dialog will prompt for Windows Hello or Master Password!
  };

  const executeReveal = async (id: string, password?: string) => {
    try {
      setErrorMsg('');
      const secret = await revealFlow.mutateAsync({ id, masterPassword: password });
      setRevealedSecret(secret);
      setTimerCountdown(15);
      
      // Ping vault activity since we successfully used it
      useVaultStore.getState().pingVaultActivity();
    } catch (err: any) {
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'Failed to decrypt credential from secure storage');
    }
  };

  // 15-second auto-clear timer
  useEffect(() => {
    if (!revealedSecret) return;
    
    const interval = setInterval(() => {
      setTimerCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setRevealedSecret(null);
          setActiveCred(null);
          toast.info('Credential secret automatically hidden from memory');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [revealedSecret]);

  // Unlock with Device Biometrics (Fingerprint / Face / Device PIN)
  const handleHelloUnlockAndReveal = async () => {
    if (!activeCred) return;
    try {
      setIsVerifyingHello(true);
      setErrorMsg('');
      const pw = await unlockVaultWithWindowsHello();
      unlock(pw);
      await executeReveal(activeCred.id, pw);
      toast.success('Identity verified with biometric authentication');
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Biometric verification failed';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsVerifyingHello(false);
    }
  };

  // Unlock with Master Password
  const submitUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeCred || !promptPassword) return;
    
    try {
      setIsUnlockingManual(true);
      setErrorMsg('');

      if (!isVaultInit) {
        await setupVault(promptPassword);
        setIsVaultInit(true);
        toast.success('Master Password set! Vault session active.');
      } else {
        await unlockVault(promptPassword);
      }

      unlock(promptPassword);
      await executeReveal(activeCred.id, promptPassword);
      toast.success('Vault session unlocked & secret revealed');
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Invalid master password';
      setErrorMsg(msg);
    } finally {
      setIsUnlockingManual(false);
    }
  };

  const copyToClipboard = () => {
    if (revealedSecret) {
      navigator.clipboard.writeText(revealedSecret);
      setCopiedId('dialog');
      setTimeout(() => setCopiedId(null), 2000);
      toast.success('Secret copied to clipboard');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-zinc-500 gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-xs font-mono">Loading credentials registry...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {credentials?.length === 0 ? (
        <div className="p-8 text-center border border-dashed border-border rounded-2xl bg-card/40 text-muted-foreground flex flex-col items-center gap-2">
          <Key className="w-8 h-8 text-muted-foreground mb-1" />
          <p className="text-sm font-medium text-foreground">No credentials stored yet</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            When you add or edit a server, its SSH credentials will automatically register here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {credentials?.map((cred) => {
            const isPassword = cred.auth_method === 'password';

            return (
              <div 
                key={cred.id} 
                className="p-4 rounded-xl border border-border bg-card/70 hover:bg-accent/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className={`p-2.5 rounded-xl border shrink-0 ${
                    isPassword 
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
                      : 'bg-primary/10 border-primary/20 text-primary'
                  }`}>
                    {isPassword ? <Key className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground truncate">
                        {cred.server_name}
                      </span>
                      
                      {isPassword ? (
                        <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-medium">
                          <ShieldCheck className="w-3 h-3 mr-1" /> System Keychain
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20 font-medium">
                          <Lock className="w-3 h-3 mr-1" /> Encrypted Vault
                        </Badge>
                      )}

                      <span className="text-[11px] font-mono text-muted-foreground capitalize bg-muted px-2 py-0.5 rounded-md border border-border">
                        {cred.auth_method.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="text-xs text-muted-foreground flex items-center gap-2 font-mono">
                      {cred.key_fingerprint ? (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Fingerprint className="w-3 h-3 text-muted-foreground" />
                          {cred.key_fingerprint.slice(0, 16)}...
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Encrypted secret reference</span>
                      )}
                      <span>•</span>
                      <span className="text-[10px] text-muted-foreground">ID: {cred.id.slice(0, 8)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => handleRevealClick(cred)}
                    className="h-8 text-xs border-border hover:bg-accent text-foreground flex items-center gap-1.5"
                  >
                    {isUnlocked ? (
                      <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                    )}
                    Reveal Secret
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Unlock & Reveal Dialog */}
      <Dialog 
        open={!!activeCred} 
        onOpenChange={(open) => {
          if (!open) {
            setActiveCred(null);
            setRevealedSecret(null);
            setErrorMsg('');
          }
        }}
      >
        <DialogContent className="max-w-md bg-card border border-border text-foreground shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base text-foreground">
              {revealedSecret ? (
                <>
                  <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    <Unlock className="w-4 h-4" />
                  </div>
                  <span>Secret Revealed: {activeCred?.server_name}</span>
                </>
              ) : (
                <>
                  <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                    <Lock className="w-4 h-4" />
                  </div>
                  <span>Vault Authentication Required</span>
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {revealedSecret 
                ? `Decrypted from ${activeCred?.auth_method === 'password' ? 'System Keychain' : 'Argon2id Vault'}. Discarded from memory on window close.`
                : isVaultInit
                ? `The Vault Session is currently locked. Authenticate to unlock session and reveal ${activeCred?.server_name} secrets.`
                : `Create a Master Password to lock and protect all your stored server credentials.`}
            </DialogDescription>
          </DialogHeader>
          
          {revealedSecret ? (
            <div className="space-y-4 pt-2">
              <div className="relative">
                <div className="p-3.5 bg-muted/60 border border-border rounded-xl font-mono text-xs text-foreground break-all max-h-56 overflow-y-auto select-all shadow-inner">
                  {isMasked ? '•'.repeat(Math.min(revealedSecret.length, 32)) : revealedSecret}
                </div>
                <button
                  type="button"
                  onClick={() => setIsMasked(!isMasked)}
                  className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                  title={isMasked ? 'Show secret' : 'Mask secret'}
                >
                  {isMasked ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>

              {/* Countdown Progress */}
              <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                <span>Auto-clearing from memory:</span>
                <span className="text-amber-600 dark:text-amber-400 font-semibold">{timerCountdown}s remaining</span>
              </div>

              <DialogFooter className="gap-2 sm:gap-0 pt-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  className="h-8 text-xs border-border"
                  onClick={() => {
                    setActiveCred(null);
                    setRevealedSecret(null);
                  }}
                >
                  Close
                </Button>
                <Button 
                  size="sm" 
                  className="h-8 text-xs gap-1.5 font-medium"
                  onClick={copyToClipboard}
                >
                  {copiedId === 'dialog' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedId === 'dialog' ? 'Copied' : 'Copy to Clipboard'}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              {/* 1-Click Biometric Option */}
              {helloStatus?.enabled && (
                <div className="space-y-2">
                  <Button
                    type="button"
                    onClick={handleHelloUnlockAndReveal}
                    disabled={isVerifyingHello}
                    className="w-full h-10 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-2 rounded-xl shadow-md transition-all active:scale-[0.99]"
                  >
                    {isVerifyingHello ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Fingerprint className="w-4 h-4 text-emerald-100" />
                    )}
                    <span>Unlock & Reveal with Biometrics</span>
                  </Button>

                  <div className="relative my-2.5">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-border/60" />
                    </div>
                    <div className="relative flex justify-center text-[10px] uppercase">
                      <span className="bg-card px-2.5 text-muted-foreground font-mono">or enter master password</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Master Password Form */}
              <form onSubmit={submitUnlock} className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                    {isVaultInit ? 'Master Password' : 'Create Master Password'}
                  </label>
                  <Input 
                    type="password" 
                    placeholder={isVaultInit ? "Enter Master Password..." : "Choose Master Password..."}
                    value={promptPassword}
                    onChange={e => setPromptPassword(e.target.value)}
                    autoFocus
                    className="h-9 text-sm bg-background border-input text-foreground"
                  />
                  {errorMsg && <p className="text-xs text-rose-500 dark:text-rose-400 font-medium">{errorMsg}</p>}
                </div>

                <DialogFooter className="gap-2 sm:gap-0 pt-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    className="h-8 text-xs border-border"
                    onClick={() => setActiveCred(null)}
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    size="sm" 
                    className="h-8 text-xs gap-1.5 font-semibold"
                    disabled={isUnlockingManual || !promptPassword}
                  >
                    {isUnlockingManual && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {isVaultInit ? 'Unlock Vault & Reveal' : 'Set Password & Reveal'}
                  </Button>
                </DialogFooter>
              </form>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
