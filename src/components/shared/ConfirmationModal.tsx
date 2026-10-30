import { createContext, useContext, useState, type ReactNode } from 'react';
import { 
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldAlert, AlertTriangle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface ConfirmationContextType {
  requestConfirmation: (description: string, targets?: string[]) => Promise<string>;
}

const ConfirmationContext = createContext<ConfirmationContextType | null>(null);

export const useConfirmAction = () => {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error('useConfirmAction must be used within a ConfirmationProvider');
  }
  return context;
};

export const ConfirmationProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [targets, setTargets] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  
  // Resolve/Reject handlers for the promise
  const [resolver, setResolver] = useState<{resolve: (token: string) => void, reject: (reason: any) => void} | null>(null);

  const requestConfirmation = (desc: string, tgts?: string[]): Promise<string> => {
    setDescription(desc);
    setTargets(tgts || []);
    setPassword('');
    setOpen(true);
    
    return new Promise((resolve, reject) => {
      setResolver({ resolve, reject });
    });
  };

  const handleConfirm = async () => {
    if (!password) {
      alert("Master password is required");
      return;
    }
    
    // In V1 MVP we assume any non-empty password is fine for the UI flow, 
    // but the backend request_confirmation acts as the token generator.
    try {
      const res = await invoke<{token: string}>('request_confirmation', { 
        payload: { action_description: description, targets: targets.length > 0 ? targets : null } 
      });
      setOpen(false);
      if (resolver) {
        resolver.resolve(res.token);
      }
    } catch (e) {
      alert("Failed to get confirmation token: " + e);
    }
  };

  const handleCancel = () => {
    setOpen(false);
    if (resolver) {
      resolver.reject(new Error("User cancelled action"));
    }
  };

  return (
    <ConfirmationContext.Provider value={{ requestConfirmation }}>
      {children}
      
      <Dialog open={open} onOpenChange={(val) => !val && handleCancel()}>
        <DialogContent className="max-w-md border-destructive">
          <DialogHeader>
            <DialogTitle className="flex items-center text-destructive">
              <ShieldAlert className="w-5 h-5 mr-2" />
              Security Check
            </DialogTitle>
            <DialogDescription className="pt-2">
              You are about to perform a destructive action:
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="bg-destructive/10 border border-destructive/20 p-3 rounded-md flex gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm">
                <span className="font-semibold block mb-1">{description}</span>
                {targets.length > 0 && (
                  <ul className="list-disc pl-4 text-muted-foreground mt-2">
                    {targets.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                )}
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Master Password</Label>
              <Input 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                placeholder="Enter password to confirm..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirm();
                }}
                autoFocus
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirm}>Confirm Action</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmationContext.Provider>
  );
};
