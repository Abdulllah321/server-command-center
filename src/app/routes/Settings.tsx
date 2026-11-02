import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { VaultSettings } from '@/features/vault/components/VaultSettings';
import { RebuildProfileManager } from '@/features/rebuild/components/RebuildProfileManager';
import { KnownHostsManager } from '@/features/settings/components/KnownHostsManager';
import { GeneralPreferences } from '@/features/settings/components/GeneralPreferences';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  ShieldCheck, 
  KeyRound, 
  Shield, 
  Rocket, 
  Sliders, 
  Lock, 
  Unlock 
} from 'lucide-react';
import { useVaultStore } from '@/stores/use-vault-store';
import { cn } from 'cn';

export const Settings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'vault';
  const [activeTab, setActiveTab] = useState(initialTab);
  const isUnlocked = useVaultStore((state) => state.isUnlocked);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    setSearchParams({ tab: val });
  };

  const SETTINGS_TABS = [
    { 
      id: 'vault', 
      label: 'Vault & Credentials', 
      shortLabel: 'Vault',
      icon: KeyRound, 
      accentColor: 'text-emerald-400', 
      accentBg: 'bg-emerald-400' 
    },
    { 
      id: 'known_hosts', 
      label: 'Pinned Known Hosts', 
      shortLabel: 'Known Hosts',
      icon: Shield, 
      accentColor: 'text-primary', 
      accentBg: 'bg-primary' 
    },
    { 
      id: 'deployment', 
      label: 'Deployment Profiles', 
      shortLabel: 'Deploy Profiles',
      icon: Rocket, 
      accentColor: 'text-amber-400', 
      accentBg: 'bg-amber-400' 
    },
    { 
      id: 'preferences', 
      label: 'Preferences & Terminal', 
      shortLabel: 'Preferences',
      icon: Sliders, 
      accentColor: 'text-sky-400', 
      accentBg: 'bg-sky-400' 
    },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden p-3.5 sm:p-5 lg:p-6 gap-3.5 sm:gap-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4 pb-2 border-b border-border/40 shrink-0">
        <div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-foreground">
              Settings & Security
            </h1>
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20 font-medium">
                <ShieldCheck className="w-3 h-3 mr-1" /> Hardware Enclave Active
              </Badge>
              <Badge variant="outline" className={`text-[10px] font-medium ${
                isUnlocked 
                  ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20' 
                  : 'bg-muted text-muted-foreground border-border'
              }`}>
                {isUnlocked ? <Unlock className="w-3 h-3 mr-1 text-emerald-500" /> : <Lock className="w-3 h-3 mr-1 text-amber-500" />}
                {isUnlocked ? 'Vault Unlocked' : 'Vault Locked'}
              </Badge>
            </div>
          </div>
          <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
            Manage your secure credentials, SSH key identities, automation profiles, and application preferences.
          </p>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col flex-1 min-h-0">
        <div className="w-full overflow-x-auto no-scrollbar shrink-0 pb-1">
          <TabsList className="w-max sm:w-fit flex items-center bg-card/90 border border-border p-1 rounded-2xl gap-1 shadow-xs backdrop-blur-md">
            {SETTINGS_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className={cn(
                    "relative flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all select-none cursor-pointer whitespace-nowrap",
                    isActive
                      ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5 transition-colors shrink-0", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.shortLabel}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {/* Tab 1: Vault & Credentials */}
        <TabsContent value="vault" className="flex-1 mt-6 overflow-y-auto pr-2 space-y-6">
          <VaultSettings />
        </TabsContent>

        {/* Tab 2: Known Hosts & TOFU */}
        <TabsContent value="known_hosts" className="flex-1 mt-6 overflow-y-auto pr-2 space-y-6">
          <KnownHostsManager />
        </TabsContent>

        {/* Tab 3: Deployment Profiles */}
        <TabsContent value="deployment" className="flex-1 mt-6 overflow-y-auto pr-2 space-y-6">
          <RebuildProfileManager />
        </TabsContent>

        {/* Tab 4: Preferences & Terminal */}
        <TabsContent value="preferences" className="flex-1 mt-6 overflow-y-auto pr-2 space-y-6">
          <GeneralPreferences />
        </TabsContent>
      </Tabs>
    </div>
  );
};
