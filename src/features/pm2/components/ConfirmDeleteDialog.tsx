import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { confirmAction } from '@/lib/tauri-client';

interface ConfirmDeleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  processName: string;
  onConfirm: (token: string) => Promise<void>;
}

export const ConfirmDeleteDialog: React.FC<ConfirmDeleteDialogProps> = ({ isOpen, onClose, processName, onConfirm }) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setIsDeleting(true);
    setError('');
    try {
      // In a real implementation, the token would be requested via a 2FA prompt or master password unlock.
      // We will simulate it by passing a hardcoded token and simulating the confirmAction check.
      const simulatedToken = "delete-token-123";
      await confirmAction(simulatedToken);
      
      await onConfirm(simulatedToken);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to delete process');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isDeleting && !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete Process
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to permanently delete the process <strong>{processName}</strong>? 
            This action cannot be undone, and the process will be removed from PM2's registry.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
            {error}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0 mt-4">
          <Button variant="outline" onClick={onClose} disabled={isDeleting}>Cancel</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isDeleting}>
            {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Yes, delete {processName}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
