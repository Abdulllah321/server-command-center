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
      icon: KeyRound, 
      accentColor: 'text-emerald-400', 
      accentBg: 'bg-emerald-400' 
    },
    { 
      id: 'known_hosts', 
      label: 'Pinned Known Hosts', 
      icon: Shield, 
      accentColor: 'text-primary', 
      accentBg: 'bg-primary' 
    },
    { 
      id: 'deployment', 
      label: 'Deployment Profiles', 
      icon: Rocket, 
      accentColor: 'text-amber-400', 
      accentBg: 'bg-amber-400' 
    },
    { 
      id: 'preferences', 
      label: 'Preferences & Terminal', 
      icon: Sliders, 
      accentColor: 'text-sky-400', 
      accentBg: 'bg-sky-400' 
    },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden p-3 sm:p-5 lg:p-6 gap-4 sm:gap-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-2 border-b border-border/40 shrink-0">
        <div>
          <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Settings & Security Center
            </h1>
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-medium">
                <ShieldCheck className="w-3 h-3 mr-1" /> OS Keychain Active
              </Badge>
              <Badge variant="outline" className={`text-[10px] font-medium ${
                isUnlocked 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : 'bg-muted text-muted-foreground border-border'
              }`}>
                {isUnlocked ? <Unlock className="w-3 h-3 mr-1" /> : <Lock className="w-3 h-3 mr-1" />}
                {isUnlocked ? 'Vault Unlocked' : 'Vault Locked'}
              </Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Manage your secure credentials, SSH key identities, automation profiles, and host application preferences.
          </p>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col flex-1 min-h-0">
        <TabsList className="w-full sm:w-fit max-w-full flex items-center overflow-x-auto no-scrollbar bg-card/90 border border-border p-1.5 rounded-2xl gap-1.5 shadow-md backdrop-blur-md shrink-0">
          {SETTINGS_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={cn(
                  "relative flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all duration-200 select-none cursor-pointer",
                  isActive
                    ? "bg-accent text-foreground font-semibold shadow-sm border border-border ring-1 ring-border/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-transparent"
                )}
              >
                {/* Active Indicator Pulse Dot */}
                {isActive && (
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0 shadow-[0_0_8px_currentColor] animate-pulse", tab.accentBg)} />
                )}
                
                <Icon className={cn("h-3.5 w-3.5 transition-colors", isActive ? tab.accentColor : "text-muted-foreground")} />
                <span>{tab.label}</span>

                {/* Bottom Active Accent Glow Bar */}
                {isActive && (
                  <span className={cn("absolute bottom-0 inset-x-2.5 h-[2px] rounded-full shadow-[0_0_8px_currentColor]", tab.accentBg)} />
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

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
