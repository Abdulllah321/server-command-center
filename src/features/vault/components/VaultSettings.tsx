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

  // Biometrics hardware state
  const [biometricsStatus, setBiometricsStatus] = useState<WindowsHelloStatus | null>(null);
  const [isBiometricUnlocking, setIsBiometricUnlocking] = useState(false);
  const [isEnrollingBiometrics, setIsEnrollingBiometrics] = useState(false);
  const [showEnrollDialog, setShowEnrollDialog] = useState(false);
  const [enrollPasswordInput, setEnrollPasswordInput] = useState('');
  const [enrollError, setEnrollError] = useState('');

  const fetchBiometricsStatus = async () => {
    try {
      const status = await checkWindowsHello();
      setBiometricsStatus(status);
    } catch (err) {
      console.error('Failed to query biometrics status:', err);
    }
  };

  useEffect(() => {
    fetchBiometricsStatus();
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

  const handleBiometricUnlock = async () => {
    try {
      setIsBiometricUnlocking(true);
      setErrorMsg('');
      const pw = await unlockVaultWithWindowsHello();
      unlock(pw);
      toast.success('Vault unlocked with biometric verification');
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Biometric verification failed';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsBiometricUnlocking(false);
    }
  };

  const handleStartEnrollment = () => {
    if (masterPassword) {
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
      setIsEnrollingBiometrics(true);
      setEnrollError('');
      await enableWindowsHello(pw);
      await fetchBiometricsStatus();
      setShowEnrollDialog(false);
      setEnrollPasswordInput('');
      toast.success('Biometric unlock is now active!');
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Failed to enroll biometrics';
      setEnrollError(msg);
      toast.error(msg);
    } finally {
      setIsEnrollingBiometrics(false);
    }
  };

  const handleDisableBiometrics = async () => {
    try {
      await disableWindowsHello();
      await fetchBiometricsStatus();
      toast.info('Biometric unlock has been disabled');
    } catch {
      toast.error('Failed to disable biometric unlock');
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
    <div className="space-y-4 sm:space-y-6">
      {/* Auto-Lock Alert Notice */}
      {autoLockedAt && !isUnlocked && (
        <div className="p-3.5 sm:p-4 bg-amber-500/10 border border-amber-500/25 rounded-2xl flex items-center justify-between text-amber-500 dark:text-amber-400 shadow-sm">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-semibold text-xs sm:text-sm">Vault Session Auto-Locked</p>
              <p className="text-[11px] text-amber-500/80 dark:text-amber-400/80">
                The vault locked automatically due to inactivity. Authenticate below to resume session.
              </p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={clearAutoLockNotice} 
            className="text-xs text-amber-500 dark:text-amber-400 hover:bg-amber-500/20 h-7 px-2"
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Main Grid: On mobile, Session Control comes first so unlock actions are directly accessible! */}
      <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Session Controller Card (Top on mobile, Right column on desktop) */}
        <div className="order-first lg:order-last space-y-4">
          <Card className="bg-card/90 border border-border shadow-md rounded-2xl">
            <CardHeader className="p-4 sm:p-6 pb-3 sm:pb-4 border-b border-border/50">
              <CardTitle className="text-sm sm:text-base font-semibold flex items-center gap-2">
                {isUnlocked ? (
                  <Unlock className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Lock className="w-4 h-4 text-amber-500" />
                )}
                Vault Authentication
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Session state and biometric authentication controls.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-4 space-y-4">
              {/* Session Status Display */}
              <div className="p-3.5 sm:p-4 rounded-xl border border-border bg-muted/40 space-y-2.5">
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
                    <span className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
                      <Clock className="w-3.5 h-3.5 text-primary" /> Auto-lock in:
                    </span>
                    <span className="font-semibold text-primary">{remainingFormatted}</span>
                  </div>
                )}

                {isUnlocked && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => lock(false)} 
                    className="w-full mt-2 h-8 text-xs border-rose-500/30 text-rose-500 hover:bg-rose-500/10 font-semibold rounded-xl"
                  >
                    Lock Vault Session Now
                  </Button>
                )}
              </div>

              {/* Unlock Section when Vault is Locked */}
              {!isUnlocked && (
                <div className="space-y-3.5 pt-1">
                  {/* 1-Click Biometric Unlock */}
                  {biometricsStatus?.enabled && (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        onClick={handleBiometricUnlock}
                        disabled={isBiometricUnlocking}
                        className="w-full h-10 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-2 rounded-xl shadow-sm transition-all active:scale-[0.99]"
                      >
                        {isBiometricUnlocking ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Fingerprint className="w-4 h-4 text-emerald-100" />
                        )}
                        <span>Unlock with Biometrics</span>
                      </Button>
                      <p className="text-[10px] text-center text-muted-foreground">
                        Use your fingerprint, facial recognition, or device PIN
                      </p>

                      <div className="relative my-2">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-border/60" />
                        </div>
                        <div className="relative flex justify-center text-[10px] uppercase">
                          <span className="bg-card px-2.5 text-muted-foreground font-mono">or enter master password</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Manual Password Unlock Form */}
                  <form onSubmit={handleManualUnlock} className="space-y-2.5">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-amber-500" /> Master Password
                      </label>
                      <Input 
                        type="password" 
                        placeholder="Enter Master Password..." 
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-9 text-xs bg-background border-input focus:border-primary placeholder:text-muted-foreground rounded-xl"
                      />
                      {errorMsg && <p className="text-xs text-rose-500 font-medium">{errorMsg}</p>}
                    </div>

                    <Button 
                      type="submit" 
                      size="sm" 
                      disabled={isUnlocking || !password} 
                      className="w-full h-9 text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 rounded-xl disabled:opacity-40 shadow-xs"
                    >
                      {isUnlocking && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Unlock Vault Session
                    </Button>
                  </form>

                  {biometricsStatus?.supported && !biometricsStatus?.enabled && (
                    <p className="text-[11px] text-muted-foreground text-center">
                      Tip: Once unlocked, you can enable 1-tap biometric authentication.
                    </p>
                  )}
                </div>
              )}

              {/* Biometrics Settings (when Vault is Unlocked) */}
              {isUnlocked && (
                <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Fingerprint className="w-4 h-4 text-primary" />
                      <span className="text-xs font-semibold text-foreground">Device Biometrics</span>
                    </div>
                    {biometricsStatus?.enabled ? (
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-medium">
                        Enabled
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground border-border font-medium">
                        {biometricsStatus?.supported ? 'Ready to Enable' : 'Unsupported'}
                      </Badge>
                    )}
                  </div>

                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {biometricsStatus?.enabled
                      ? 'Hardware-backed biometric verification is active. You can unlock your vault instantly with fingerprint or facial scan.'
                      : biometricsStatus?.supported
                      ? 'Enable hardware-backed fingerprint, facial recognition, or PIN unlock for this device.'
                      : 'Biometric authentication is not configured or unsupported on this device.'}
                  </p>

                  {biometricsStatus?.supported && (
                    biometricsStatus?.enabled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDisableBiometrics}
                        className="w-full h-7 text-xs border-border hover:bg-muted text-muted-foreground font-medium rounded-lg"
                      >
                        Disable Biometric Unlock
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={handleStartEnrollment}
                        disabled={isEnrollingBiometrics}
                        className="w-full h-8 text-xs bg-primary text-primary-foreground hover:opacity-90 font-medium flex items-center justify-center gap-1.5 rounded-xl shadow-xs"
                      >
                        {isEnrollingBiometrics ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Fingerprint className="w-3.5 h-3.5" />
                        )}
                        Enable Biometric Unlock
                      </Button>
                    )
                  )}
                </div>
              )}

              {/* Auto-lock Timeout Selector */}
              <div className="space-y-1.5 pt-2 border-t border-border/50">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Timer className="w-3.5 h-3.5 text-muted-foreground" /> Inactivity Auto-Lock
                </label>
                <Select 
                  value={sessionTimeout.toString()} 
                  onValueChange={(v) => { if (v) setSessionTimeout(parseInt(v, 10)); }}
                >
                  <SelectTrigger className="h-8 text-xs bg-background border-input rounded-xl">
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
                <p className="text-[10px] text-muted-foreground">
                  Vault automatically clears decrypted credentials from memory after inactivity.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Credentials List (Left Column on Desktop, Second on Mobile) */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-card/90 border border-border shadow-md rounded-2xl">
            <CardHeader className="p-4 sm:p-6 pb-3 sm:pb-4 border-b border-border/50">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm sm:text-base font-semibold flex items-center gap-2">
                    <Key className="w-4 h-4 text-primary" /> Stored Credentials
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Server authentication secrets stored in secure hardware enclave.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-3.5 sm:p-6 pt-3 sm:pt-5">
              <CredentialsList />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Compact Security Architecture Badges */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Tier 1 */}
        <div className="p-3.5 sm:p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 space-y-1 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5" /> Hardware Enclave
            </div>
            <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
              Active
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Hardware-backed encryption keys protect stored SSH secrets at rest with zero plain-text leaks.
          </p>
        </div>

        {/* Tier 2 */}
        <div className="p-3.5 sm:p-4 rounded-xl border border-sky-500/20 bg-sky-500/5 space-y-1 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-semibold text-xs uppercase tracking-wider">
              <Fingerprint className="w-3.5 h-3.5" /> Biometric Passkey
            </div>
            <Badge variant="outline" className="text-[10px] bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30">
              {biometricsStatus?.enabled ? 'Enrolled' : biometricsStatus?.supported ? 'Supported' : 'Optional'}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Hardware-backed biometric verification unlocks master session keys with one touch.
          </p>
        </div>

        {/* Tier 3 */}
        <div className="p-3.5 sm:p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-1 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary font-semibold text-xs uppercase tracking-wider">
              <KeyRound className="w-3.5 h-3.5" /> Argon2id + AES-GCM
            </div>
            <Badge variant="outline" className="text-[10px] bg-primary/15 text-primary border-primary/30">
              {isUnlocked ? 'Active' : 'Encrypted'}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Ephemeral key cache in volatile RAM is securely zeroized and flushed on timeout or lock.
          </p>
        </div>
      </div>

      {/* Dialog for Enrollment */}
      <Dialog open={showEnrollDialog} onOpenChange={setShowEnrollDialog}>
        <DialogContent className="max-w-md bg-card border-border rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Fingerprint className="w-5 h-5 text-primary" />
              Enable Biometric Verification
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Please enter your Master Password once. Your device will prompt for biometric verification (fingerprint, face, or PIN) to bind the vault securely.
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
                className="h-9 text-xs bg-background border-input rounded-xl"
                autoFocus
              />
              {enrollError && (
                <p className="text-xs text-rose-500 font-medium">{enrollError}</p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowEnrollDialog(false)}
              className="text-xs rounded-xl"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => handleConfirmEnrollment(enrollPasswordInput)}
              disabled={isEnrollingBiometrics || !enrollPasswordInput}
              className="text-xs bg-primary text-primary-foreground gap-1.5 rounded-xl font-medium"
            >
              {isEnrollingBiometrics && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <Fingerprint className="w-3.5 h-3.5" />
              Verify & Enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
