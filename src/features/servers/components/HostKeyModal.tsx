import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { showIpcError } from '@/lib/error-handler';
import { 
  ShieldAlert, 
  ShieldCheck, 
  Copy, 
  Check, 
  AlertTriangle, 
  Server, 
  Globe, 
  ArrowRightLeft,
  XCircle,
  KeyRound
} from 'lucide-react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface HostKeyVerificationEvent {
  server_id: string;
  server_name: string;
  hostname: string;
  fingerprint: string;
  old_fingerprint?: string;
  is_mismatch: boolean;
}

export const HostKeyModal = () => {
  const [event, setEvent] = useState<HostKeyVerificationEvent | null>(null);
  const [copiedNew, setCopiedNew] = useState(false);
  const [copiedOld, setCopiedOld] = useState(false);
  const [confirmedRisk, setConfirmedRisk] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');

  useEffect(() => {
    let unlisten: UnlistenFn;
    listen<HostKeyVerificationEvent>('host_key_verification_required', (e) => {
      setEvent(e.payload);
      setConfirmedRisk(false);
      setConfirmInput('');
      setCopiedNew(false);
      setCopiedOld(false);
    }).then(fn => unlisten = fn);

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleCopy = (text: string, isOld = false) => {
    navigator.clipboard.writeText(text);
    if (isOld) {
      setCopiedOld(true);
      setTimeout(() => setCopiedOld(false), 2000);
    } else {
      setCopiedNew(true);
      setTimeout(() => setCopiedNew(false), 2000);
    }
    toast.success('Fingerprint copied to clipboard');
  };

  const handleResolve = async (accept: boolean) => {
    if (!event) return;
    
    const currentEvent = event;
    setEvent(null);
    setConfirmedRisk(false);
    setConfirmInput('');
    
    try {
      await invoke('resolve_host_key_verification', {
        serverId: currentEvent.server_id,
        accepted: accept,
      });
      if (accept) {
        toast.success(`Host key pinned for ${currentEvent.server_name}`);
      } else {
        toast.info(`Connection cancelled for ${currentEvent.server_name}`);
      }
    } catch (e: any) {
      showIpcError(e, { action: 'Verify Host Key', serverName: currentEvent.server_name });
    }
  };

  if (!event) return null;

  const isMismatch = event.is_mismatch;
  const canAcceptMismatch = confirmedRisk && (confirmInput.trim().toUpperCase() === 'REPLACE');

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent className={`sm:max-w-[580px] p-0 overflow-hidden border-2 shadow-2xl ${
        isMismatch 
          ? 'border-destructive bg-gradient-to-b from-destructive/10 via-background to-background' 
          : 'border-primary/40 bg-gradient-to-b from-primary/5 via-background to-background'
      }`}>
        
        {/* Header Banner */}
        <div className={`p-6 pb-4 border-b ${isMismatch ? 'bg-destructive/15 border-destructive/30' : 'bg-primary/10 border-primary/20'}`}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-full ${isMismatch ? 'bg-destructive/20 text-destructive' : 'bg-primary/20 text-primary'}`}>
                {isMismatch ? (
                  <ShieldAlert className="w-7 h-7 animate-pulse text-destructive" />
                ) : (
                  <ShieldCheck className="w-7 h-7 text-primary" />
                )}
              </div>
              <div>
                <DialogTitle className={`text-xl font-bold tracking-tight ${isMismatch ? 'text-destructive' : 'text-foreground'}`}>
                  {isMismatch ? 'CRITICAL: Host Key Mismatch' : 'Trust On First Use (TOFU)'}
                </DialogTitle>
                <DialogDescription className="text-xs font-medium text-muted-foreground mt-0.5">
                  {isMismatch 
                    ? 'The remote server key does not match the pinned trust anchor.'
                    : 'Establish cryptographic identity anchor for this SSH server.'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-5">
          {/* Server Identity Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-muted/40 border text-sm">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold text-foreground">{event.server_name}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
              <Globe className="w-3.5 h-3.5" />
              <span>{event.hostname}</span>
            </div>
          </div>

          {/* Mismatch Warning & Comparison */}
          {isMismatch ? (
            <div className="space-y-4">
              <div className="p-3.5 bg-destructive/15 border border-destructive/30 rounded-lg text-sm space-y-2">
                <div className="flex items-center gap-2 font-bold text-destructive">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>POTENTIAL SECURITY INCIDENT (MAN-IN-THE-MIDDLE)</span>
                </div>
                <p className="text-xs text-destructive/90 leading-relaxed">
                  Someone may be intercepting your connection to steal credentials or execute unauthorized commands. 
                  This can also happen legitimately if the server was rebuilt or re-keyed. <strong>Do NOT accept unless verified out-of-band with your system administrator.</strong>
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                {/* Previously Trusted Key */}
                {event.old_fingerprint && (
                  <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-amber-500 flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5" /> Previously Pinned Fingerprint
                      </span>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 text-[10px] px-2 text-amber-500 hover:text-amber-400"
                        onClick={() => handleCopy(event.old_fingerprint || '', true)}
                      >
                        {copiedOld ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                        {copiedOld ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                    <div className="font-mono text-xs break-all text-amber-200/90 bg-black/40 p-2 rounded border border-amber-500/20">
                      {event.old_fingerprint}
                    </div>
                  </div>
                )}

                {/* New Offered Key */}
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-destructive flex items-center gap-1.5">
                      <ArrowRightLeft className="w-3.5 h-3.5" /> Newly Offered Fingerprint (Untrusted)
                    </span>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 text-[10px] px-2 text-destructive hover:text-destructive/80"
                      onClick={() => handleCopy(event.fingerprint, false)}
                    >
                      {copiedNew ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                      {copiedNew ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <div className="font-mono text-xs break-all text-destructive-foreground font-bold bg-black/60 p-2 rounded border border-destructive/30">
                    {event.fingerprint}
                  </div>
                </div>
              </div>

              {/* Safety Interlock Checkbox and Typing Gate */}
              <div className="p-3.5 rounded-lg border border-destructive/40 bg-background space-y-3">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input 
                    type="checkbox"
                    checked={confirmedRisk} 
                    onChange={(e) => setConfirmedRisk(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-destructive text-destructive accent-destructive cursor-pointer"
                  />
                  <span className="text-xs text-foreground leading-snug">
                    I understand the critical risk of Man-in-the-Middle interception and confirm this key rotation is legitimate.
                  </span>
                </label>

                {confirmedRisk && (
                  <div className="space-y-1.5 pt-2 border-t border-border">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Type <span className="font-mono font-bold text-destructive">REPLACE</span> to unlock key overwrite:
                    </label>
                    <input 
                      type="text"
                      value={confirmInput}
                      onChange={(e) => setConfirmInput(e.target.value)}
                      placeholder="Type REPLACE here"
                      className="w-full text-xs font-mono px-3 py-1.5 rounded border bg-muted/40 text-foreground focus:outline-none focus:ring-1 focus:ring-destructive uppercase"
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* First Connect View */
            <div className="space-y-4">
              <div className="p-3.5 bg-primary/10 border border-primary/20 rounded-lg text-xs space-y-1.5 text-foreground leading-relaxed">
                <div className="font-semibold text-primary flex items-center gap-1.5 text-sm">
                  <ShieldCheck className="w-4 h-4" /> Permanent Trust Decision
                </div>
                <p className="text-muted-foreground">
                  The authenticity of host <span className="font-mono text-foreground font-semibold">"{event.hostname}"</span> cannot be established automatically. 
                  Once accepted, this fingerprint will be permanently pinned to protect all future SSH sessions from spoofing.
                </p>
              </div>

              <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-muted-foreground flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5" /> Key Fingerprint (SHA256)
                  </span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 text-xs px-2 text-muted-foreground hover:text-foreground"
                    onClick={() => handleCopy(event.fingerprint, false)}
                  >
                    {copiedNew ? <Check className="w-3.5 h-3.5 mr-1 text-green-500" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                    {copiedNew ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <div className="font-mono text-xs font-semibold text-primary bg-primary/10 p-2.5 rounded border border-primary/20 break-all select-all">
                  {event.fingerprint}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Compare this fingerprint with the public key on your server or cloud dashboard (<code className="bg-muted px-1 py-0.5 rounded">ssh-keygen -lf /etc/ssh/ssh_host_...</code>).
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <DialogFooter className="p-4 bg-muted/30 border-t flex flex-col sm:flex-row gap-2 justify-end">
          <Button 
            variant="outline" 
            onClick={() => handleResolve(false)} 
            className="w-full sm:w-auto font-medium"
          >
            <XCircle className="w-4 h-4 mr-2" />
            {isMismatch ? 'Abort Connection (Recommended)' : 'Reject & Abort'}
          </Button>

          {isMismatch ? (
            <Button 
              variant="destructive" 
              onClick={() => handleResolve(true)}
              disabled={!canAcceptMismatch}
              className="w-full sm:w-auto font-bold shadow-md"
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              Replace Key & Connect
            </Button>
          ) : (
            <Button 
              variant="default" 
              onClick={() => handleResolve(true)}
              className="w-full sm:w-auto font-semibold shadow-md bg-primary hover:bg-primary/90"
            >
              <ShieldCheck className="w-4 h-4 mr-2" />
              Trust & Save Host Key
            </Button>
          )}
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
};
