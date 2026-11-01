import React, { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { changeRemotePermissions } from '@/lib/tauri-client';
import { toast } from 'sonner';
import type { RemoteFileEntry } from '@/types';

interface ChmodModalProps {
  serverId: string;
  entry: RemoteFileEntry | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const ChmodModal: React.FC<ChmodModalProps> = ({
  serverId,
  entry,
  onClose,
  onSuccess,
}) => {
  const [mode, setMode] = useState('0644');
  const [recursive, setRecursive] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    if (entry) {
      setMode(entry.mode || (entry.is_dir ? '0755' : '0644'));
      setRecursive(false);
    }
  }, [entry]);

  if (!entry) return null;

  // Parse octal digits (e.g. "0755" -> [7, 5, 5])
  const getDigits = (m: string) => {
    const raw = m.replace(/^0+/, '');
    const padded = raw.padStart(3, '0').slice(-3);
    return padded.split('').map(Number);
  };

  const digits = getDigits(mode);
  const owner = digits[0] || 0;
  const group = digits[1] || 0;
  const others = digits[2] || 0;

  const toggleBit = (entityIndex: number, bitValue: number) => {
    const currentDigits = [...digits];
    const val = currentDigits[entityIndex] || 0;
    if ((val & bitValue) !== 0) {
      currentDigits[entityIndex] = val - bitValue;
    } else {
      currentDigits[entityIndex] = val + bitValue;
    }
    const newMode = `0${currentDigits.join('')}`;
    setMode(newMode);
  };

  const setPreset = (preset: string) => {
    setMode(preset);
  };

  const handleApply = async () => {
    try {
      setIsApplying(true);
      await changeRemotePermissions(serverId, entry.path, mode, recursive);
      toast.success(`Permissions for ${entry.name} changed to ${mode}`);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(`Failed to change permissions: ${err?.message || err}`);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-card border-border text-foreground shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="w-4 h-4 text-primary" />
            File Permissions (chmod)
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground font-mono truncate">
            {entry.path}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Octal Input & Common Presets */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">Octal Mode:</span>
              <Input
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                maxLength={5}
                className="w-24 h-8 text-xs font-mono bg-background border-input text-center font-bold text-foreground"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {['0644', '0755', '0600', '0777'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPreset(preset)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                    mode === preset 
                      ? 'border-primary/50 bg-primary/20 text-primary font-bold' 
                      : 'border-border bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Permission Matrix Table */}
          <div className="border border-border rounded-xl overflow-hidden text-xs">
            <table className="w-full text-center">
              <thead>
                <tr className="bg-muted/70 text-[11px] text-muted-foreground border-b border-border">
                  <th className="py-2 px-3 text-left">Scope</th>
                  <th className="py-2 px-3">Read (4)</th>
                  <th className="py-2 px-3">Write (2)</th>
                  <th className="py-2 px-3">Execute (1)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card font-medium">
                {/* Owner */}
                <tr>
                  <td className="py-2 px-3 text-left text-foreground">Owner (User)</td>
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      checked={(owner & 4) !== 0}
                      onChange={() => toggleBit(0, 4)}
                      className="rounded border-input text-primary"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      checked={(owner & 2) !== 0}
                      onChange={() => toggleBit(0, 2)}
                      className="rounded border-input text-primary"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      checked={(owner & 1) !== 0}
                      onChange={() => toggleBit(0, 1)}
                      className="rounded border-input text-primary"
                    />
                  </td>
                </tr>

                {/* Group */}
                <tr>
                  <td className="py-2 px-3 text-left text-foreground">Group</td>
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      checked={(group & 4) !== 0}
                      onChange={() => toggleBit(1, 4)}
                      className="rounded border-input text-primary"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      checked={(group & 2) !== 0}
                      onChange={() => toggleBit(1, 2)}
                      className="rounded border-input text-primary"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      checked={(group & 1) !== 0}
                      onChange={() => toggleBit(1, 1)}
                      className="rounded border-input text-primary"
                    />
                  </td>
                </tr>

                {/* Others */}
                <tr>
                  <td className="py-2 px-3 text-left text-foreground">Others (Public)</td>
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      checked={(others & 4) !== 0}
                      onChange={() => toggleBit(2, 4)}
                      className="rounded border-input text-primary"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      checked={(others & 2) !== 0}
                      onChange={() => toggleBit(2, 2)}
                      className="rounded border-input text-primary"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      checked={(others & 1) !== 0}
                      onChange={() => toggleBit(2, 1)}
                      className="rounded border-input text-primary"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Recursive checkbox for directories */}
          {entry.is_dir && (
            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
                className="rounded border-input text-primary"
              />
              <span>Apply recursively to all subdirectories and files (-R)</span>
            </label>
          )}
        </div>

        <DialogFooter className="border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={isApplying}
            className="h-8 text-xs bg-primary text-primary-foreground gap-1.5"
          >
            {isApplying && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Apply Permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

