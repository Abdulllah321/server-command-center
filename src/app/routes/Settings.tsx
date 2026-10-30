import { VaultSettings } from '@/features/vault/components/VaultSettings';
import { RebuildProfileManager } from '@/features/rebuild/components/RebuildProfileManager';
import { KnownHostsManager } from '@/features/settings/components/KnownHostsManager';

export const Settings = () => {
  return (
    <div className="flex-1 p-8 space-y-8">
      <VaultSettings />
      <div>
        <h2 className="text-2xl font-semibold tracking-tight mb-4">Deployment Settings</h2>
        <RebuildProfileManager />
      </div>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight mb-4">Security Settings</h2>
        <KnownHostsManager />
      </div>
    </div>
  );
};
