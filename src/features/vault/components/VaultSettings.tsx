import React from 'react';
import { CredentialsList } from './CredentialsList';
import { useVaultStore } from '@/stores/use-vault-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Lock, Unlock } from 'lucide-react';

export const VaultSettings = () => {
  const { sessionTimeout, setSessionTimeout, isUnlocked, lock } = useVaultStore();

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight mb-2">Vault & Credentials</h2>
        <p className="text-muted-foreground">Manage your secure credentials, SSH keys, and vault configuration.</p>
      </div>

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
                  <span className={`text-sm ${isUnlocked ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {isUnlocked ? 'Unlocked (Session Active)' : 'Locked'}
                  </span>
                  {isUnlocked && (
                    <button onClick={lock} className="text-sm text-destructive hover:underline">
                      Lock Now
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col space-y-2">
                <span className="text-sm font-medium">Auto-lock Timeout</span>
                <Select value={sessionTimeout.toString()} onValueChange={(v) => setSessionTimeout(parseInt(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 Minutes</SelectItem>
                    <SelectItem value="30">30 Minutes</SelectItem>
                    <SelectItem value="60">1 Hour</SelectItem>
                    <SelectItem value="240">4 Hours</SelectItem>
                    <SelectItem value="0">Until App Closes</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">Enforcement active in Phase 11</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
