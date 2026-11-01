import { useState, useEffect, type FormEvent } from 'react';
import { CredentialsList } from './CredentialsList';
import { useVaultStore } from '@/stores/use-vault-store';
import { 
  unlockVault, 
  checkWindowsHello, 
  enableWindowsHello, 
  disableWindowsHello, 
  unlockVaultWithWindowsHello,
  type WindowsHelloStatus 
} from '@/lib/tauri-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Lock, 
  Unlock, 
  ShieldAlert, 
  ShieldCheck, 
  KeyRound, 
  Timer, 
  Loader2,
  Info,
  Key,
  Clock,
  Fingerprint
} from 'lucide-react';
import { toast } from 'sonner';

export const VaultSettings = () => {
  const { 
    sessionTimeout, 
    setSessionTimeout, 
    isUnlocked, 
    masterPassword,
    lastActivity, 
    autoLockedAt,
    lock, 
    unlock,
    clearAutoLockNotice 
  } = useVaultStore();

  const [password, setPassword] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // Windows Hello Biometrics state
  const [helloStatus, setHelloStatus] = useState<WindowsHelloStatus | null>(null);
  const [isHelloUnlocking, setIsHelloUnlocking] = useState(false);
  const [isEnrollingHello, setIsEnrollingHello] = useState(false);
  const [showEnrollDialog, setShowEnrollDialog] = useState(false);
  const [enrollPasswordInput, setEnrollPasswordInput] = useState('');
  const [enrollError, setEnrollError] = useState('');

  const fetchHelloStatus = async () => {
    try {
      const status = await checkWindowsHello();
      setHelloStatus(status);
    } catch (err) {
      console.error('Failed to query Windows Hello status:', err);
    }
  };

  useEffect(() => {
    fetchHelloStatus();
  }, [isUnlocked]);

  // Update timer display every second
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleManualUnlock = async (e: FormEvent) => {
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

  const handleHelloUnlock = async () => {
    try {
      setIsHelloUnlocking(true);
      setErrorMsg('');
      const pw = await unlockVaultWithWindowsHello();
      unlock(pw);
      toast.success('Vault unlocked with Windows Hello biometric verification');
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Windows Hello verification failed';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsHelloUnlocking(false);
    }
  };

  const handleStartEnrollment = () => {
    if (masterPassword) {
      // We already have the master password in memory, proceed immediately
      handleConfirmEnrollment(masterPassword);
    } else {
      setEnrollPasswordInput('');
      setEnrollError('');
      setShowEnrollDialog(true);
    }
  };

  const handleConfirmEnrollment = async (pw: string) => {
    if (!pw) {
      setEnrollError('Master password is required to verify identity');
      return;
    }
    try {
      setIsEnrollingHello(true);
      setEnrollError('');
      await enableWindowsHello(pw);
      await fetchHelloStatus();
      setShowEnrollDialog(false);
      setEnrollPasswordInput('');
      toast.success('Windows Hello biometric unlock is now active!');
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Failed to enroll Windows Hello';
      setEnrollError(msg);
      toast.error(msg);
    } finally {
      setIsEnrollingHello(false);
    }
  };

  const handleDisableHello = async () => {
    try {
      await disableWindowsHello();
      await fetchHelloStatus();
      toast.info('Windows Hello biometric unlock has been disabled');
    } catch {
      toast.error('Failed to disable Windows Hello');
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
    <div className="space-y-6">
      {/* Auto-Lock Alert Notice */}
      {autoLockedAt && !isUnlocked && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-between text-amber-400 shadow-md">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">Vault Session Auto-Locked</p>
              <p className="text-xs text-amber-400/80">
                The vault locked automatically due to inactivity. Enter your master password or scan Windows Hello below to resume your session.
              </p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={clearAutoLockNotice} 
            className="text-xs text-amber-400 hover:bg-amber-500/20"
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Multi-Tier Security Architecture Explainer */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Tier 1: Hardware TPM & OS Keychain */}
        <div className="p-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-950/20 backdrop-blur-sm space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              <span className="font-semibold text-xs tracking-wide uppercase">Tier 1: OS Keychain</span>
            </div>
            <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-medium">
              Active & Zero-Prompt
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Windows Credential Manager / Apple Keychain with DPAPI hardware encryption. Your SSH passwords are encrypted at rest and connect seamlessly without repeated prompts.
          </p>
        </div>

        {/* Tier 2: Biometric Hardware Bridge (Windows Hello) */}
        <div className="p-5 rounded-2xl border border-sky-500/20 bg-sky-500/5 dark:bg-sky-950/20 backdrop-blur-sm space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400">
              <Fingerprint className="w-4 h-4" />
              <span className="font-semibold text-xs tracking-wide uppercase">Biometrics: Windows Hello</span>
            </div>
            <Badge variant="outline" className={`text-[10px] font-medium ${
              helloStatus?.enabled 
                ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30' 
                : helloStatus?.supported 
                ? 'bg-muted text-muted-foreground border-border'
                : 'bg-muted/40 text-muted-foreground/60 border-transparent'
            }`}>
              {helloStatus?.enabled ? 'Enrolled & Ready' : helloStatus?.supported ? 'Supported' : 'Unavailable'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Hardware-backed biometric verification (Fingerprint scanner, Facial Recognition, or PIN) via TPM 2.0 enclave. Unlocks master vault in 1 click without typing.
          </p>
        </div>

        {/* Tier 3: Encrypted Master Vault */}
        <div className={`p-5 rounded-2xl border backdrop-blur-sm space-y-2.5 transition-colors shadow-sm ${
          isUnlocked 
            ? 'border-primary/30 bg-primary/5 dark:bg-primary/10' 
            : 'border-border bg-card/60'
        }`}>
          <div className="flex items-center justify-between">
            <div className={`flex items-center gap-2 ${isUnlocked ? 'text-primary' : 'text-muted-foreground'}`}>
              {isUnlocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              <span className="font-semibold text-xs tracking-wide uppercase">Tier 3: Argon2id Vault</span>
            </div>
            <Badge variant="outline" className={`text-[10px] font-medium ${
              isUnlocked 
                ? 'bg-primary/20 text-primary border-primary/30' 
                : 'bg-muted text-muted-foreground border-border'
            }`}>
              {isUnlocked ? 'Session Active' : 'Session Locked'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            AES-256-GCM encrypted file vault for private SSH keys and passphrases. Ephemeral session memory zeroized and discarded upon lock or timeout.
          </p>
        </div>
      </div>

      {/* Main Grid: Credentials List + Vault Session Control */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Credentials List */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-card/80 border border-border shadow-xl rounded-2xl">
            <CardHeader className="p-6 pb-4 border-b border-border/50">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Key className="w-4 h-4 text-primary" /> Stored Credentials
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Server authentication secrets stored in OS Keychain or encrypted vault.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 pt-5">
              <CredentialsList />
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Vault Session Controller */}
        <div className="space-y-4">
          <Card className="bg-card/80 border border-border shadow-xl rounded-2xl">
            <CardHeader className="p-6 pb-4 border-b border-border/50">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                {isUnlocked ? (
                  <Unlock className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                ) : (
                  <Lock className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                )}
                Vault Session
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Locks all credentials from being revealed on screen without authentication.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-5 space-y-5">
              {/* Session Status Display */}
              <div className="p-4 rounded-xl border border-border bg-muted/40 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Session Status</span>
                  <Badge variant="outline" className={`text-[10px] font-semibold ${
                    isUnlocked 
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' 
                      : 'bg-muted text-muted-foreground border-border'
                  }`}>
                    {isUnlocked ? 'Unlocked & Active' : 'Locked'}
                  </Badge>
                </div>

                {isUnlocked && remainingFormatted && (
                  <div className="flex items-center justify-between text-xs font-mono text-muted-foreground pt-1.5 border-t border-border/40">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="w-3.5 h-3.5 text-primary" /> Auto-lock:
                    </span>
                    <span className="font-semibold text-primary">{remainingFormatted}</span>
                  </div>
                )}

                {isUnlocked && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => lock(false)} 
                    className="w-full mt-2 h-7 text-xs border-rose-500/30 text-rose-500 dark:text-rose-400 hover:bg-rose-500/15 font-medium"
                  >
                    Lock Vault Session Now
                  </Button>
                )}
              </div>

              {/* Unlock Section when Vault is Locked */}
              {!isUnlocked && (
                <div className="space-y-4 pt-1">
                  {/* Windows Hello 1-Click Biometric Unlock */}
                  {helloStatus?.enabled && (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        onClick={handleHelloUnlock}
                        disabled={isHelloUnlocking}
                        className="w-full h-10 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-2 rounded-xl shadow-md transition-all active:scale-[0.99]"
                      >
                        {isHelloUnlocking ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Fingerprint className="w-4 h-4 text-emerald-100" />
                        )}
                        <span>Unlock with Windows Hello</span>
                      </Button>
                      <p className="text-[11px] text-center text-muted-foreground">
                        Use your fingerprint, face scanner, or Windows PIN
                      </p>

                      <div className="relative my-3">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-border/60" />
                        </div>
                        <div className="relative flex justify-center text-[10px] uppercase">
                          <span className="bg-card px-2.5 text-muted-foreground font-mono">or use master password</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Manual Password Unlock Form */}
                  <form onSubmit={handleManualUnlock} className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" /> Master Password
                      </label>
                      <Input 
                        type="password" 
                        placeholder="Enter Master Password..." 
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-8 text-xs bg-background border-input focus:border-primary placeholder:text-muted-foreground"
                      />
                      {errorMsg && <p className="text-xs text-rose-500 dark:text-rose-400 font-medium">{errorMsg}</p>}
                    </div>

                    <Button 
                      type="submit" 
                      size="sm" 
                      disabled={isUnlocking || !password} 
                      className="w-full h-8 text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 border border-border disabled:opacity-40"
                    >
                      {isUnlocking && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Unlock Vault Session
                    </Button>
                  </form>

                  {helloStatus?.supported && !helloStatus?.enabled && (
                    <p className="text-[11px] text-muted-foreground text-center">
                      Tip: Once unlocked, you can enable 1-click Windows Hello biometric sign-in.
                    </p>
                  )}
                </div>
              )}

              {/* Windows Hello Settings (when Vault is Unlocked) */}
              {isUnlocked && (
                <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Fingerprint className="w-4 h-4 text-primary" />
                      <span className="text-xs font-semibold text-foreground">Windows Hello Biometrics</span>
                    </div>
                    {helloStatus?.enabled ? (
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-medium">
                        Enabled
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground border-border font-medium">
                        {helloStatus?.supported ? 'Ready to Enable' : 'Unsupported'}
                      </Badge>
                    )}
                  </div>

                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {helloStatus?.enabled
                      ? 'Biometric unlock is configured. You can unlock your vault instantly with fingerprint or face verification.'
                      : helloStatus?.supported
                      ? 'Enable hardware-backed fingerprint, facial recognition, or PIN unlock for this device.'
                      : 'Windows Hello biometric authentication is not supported or not configured on this machine.'}
                  </p>

                  {helloStatus?.supported && (
                    helloStatus?.enabled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDisableHello}
                        className="w-full h-7 text-xs border-border hover:bg-muted text-muted-foreground font-medium"
                      >
                        Disable Windows Hello
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={handleStartEnrollment}
                        disabled={isEnrollingHello}
                        className="w-full h-8 text-xs bg-primary text-primary-foreground hover:opacity-90 font-medium flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        {isEnrollingHello ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Fingerprint className="w-3.5 h-3.5" />
                        )}
                        Enable Windows Hello
                      </Button>
                    )
                  )}
                </div>
              )}

              {/* Auto-lock Timeout Selector */}
              <div className="space-y-2 pt-2 border-t border-border/50">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Timer className="w-3.5 h-3.5 text-muted-foreground" /> Inactivity Auto-Lock
                </label>
                <Select 
                  value={sessionTimeout.toString()} 
                  onValueChange={(v) => { if (v) setSessionTimeout(parseInt(v, 10)); }}
                >
                  <SelectTrigger className="h-8 text-xs bg-background border-input">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border text-xs">
                    <SelectItem value="1">1 Minute (Testing)</SelectItem>
                    <SelectItem value="5">5 Minutes</SelectItem>
                    <SelectItem value="15">15 Minutes</SelectItem>
                    <SelectItem value="30">30 Minutes (Recommended)</SelectItem>
                    <SelectItem value="60">1 Hour</SelectItem>
                    <SelectItem value="240">4 Hours</SelectItem>
                    <SelectItem value="0">Until App Closes</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground leading-normal">
                  Vault automatically purges decrypted keys from memory after specified inactivity.
                </p>
              </div>

              {/* Security Hint */}
              <div className="p-4 rounded-xl bg-muted/30 border border-border/60 text-[11px] text-muted-foreground space-y-1">
                <span className="font-semibold text-foreground flex items-center gap-1">
                  <Info className="w-3 h-3 text-primary" /> Zero Disbelief Guarantee
                </span>
                <p className="text-muted-foreground leading-relaxed">
                  Your credentials never touch external cloud servers. All secrets remain 100% local, protected by TPM 2.0 hardware and AES-256-GCM.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialog for Enrollment if Master Password is required */}
      <Dialog open={showEnrollDialog} onOpenChange={setShowEnrollDialog}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Fingerprint className="w-5 h-5 text-primary" />
              Enable Windows Hello Biometrics
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Please enter your Master Password once. Your system will prompt for Windows Hello biometric verification (fingerprint, face, or PIN) to bind the vault securely.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Master Password</label>
              <Input 
                type="password"
                placeholder="Enter your Master Password..."
                value={enrollPasswordInput}
                onChange={(e) => setEnrollPasswordInput(e.target.value)}
                className="h-8 text-xs bg-background border-input"
                autoFocus
              />
              {enrollError && (
                <p className="text-xs text-rose-500 font-medium">{enrollError}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowEnrollDialog(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => handleConfirmEnrollment(enrollPasswordInput)}
              disabled={isEnrollingHello || !enrollPasswordInput}
              className="text-xs bg-primary text-primary-foreground gap-1.5"
            >
              {isEnrollingHello && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <Fingerprint className="w-3.5 h-3.5" />
              Verify & Enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
