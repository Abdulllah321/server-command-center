import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Server, Activity, Search, ShieldCheck, Settings, Lock } from 'lucide-react';
import { useVaultStore } from '@/stores/use-vault-store';

interface MobileBottomNavProps {
  onSearchClick: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ onSearchClick }) => {
  const location = useLocation();
  const isUnlocked = useVaultStore((state) => state.isUnlocked);

  const isServersActive = location.pathname === '/' || location.pathname.startsWith('/server/');
  const isActivityActive = location.pathname.startsWith('/activity');
  const isVaultActive = location.pathname === '/settings' && location.search.includes('tab=vault');
  const isSettingsActive = location.pathname === '/settings' && !location.search.includes('tab=vault');

  return (
    <nav 
      aria-label="Mobile Navigation Bar"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card/95 backdrop-blur-xl border-t border-border flex items-center justify-around px-2 pt-2 pb-[max(0.875rem,env(safe-area-inset-bottom,16px))] shadow-[0_-8px_24px_rgba(0,0,0,0.15)] select-none transition-all"
    >
      {/* 1. Servers Fleet */}
      <NavLink
        to="/"
        className={`flex flex-col items-center justify-center min-w-[58px] py-1 px-2 rounded-2xl text-[11px] font-medium transition-all active:scale-95 ${
          isServersActive
            ? 'text-primary font-bold'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <div className="relative">
          <Server className="w-5 h-5 mb-0.5" />
          {isServersActive && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_currentColor]" />
          )}
        </div>
        <span className="tracking-tight mt-0.5">Servers</span>
      </NavLink>

      {/* 2. Activity Audit */}
      <NavLink
        to="/activity"
        className={`flex flex-col items-center justify-center min-w-[58px] py-1 px-2 rounded-2xl text-[11px] font-medium transition-all active:scale-95 ${
          isActivityActive
            ? 'text-primary font-bold'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <div className="relative">
          <Activity className="w-5 h-5 mb-0.5" />
          {isActivityActive && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_currentColor]" />
          )}
        </div>
        <span className="tracking-tight mt-0.5">Activity</span>
      </NavLink>

      {/* 3. Global Search */}
      <button
        type="button"
        onClick={onSearchClick}
        className="flex flex-col items-center justify-center min-w-[58px] py-1 px-2 rounded-2xl text-[11px] font-medium text-muted-foreground hover:text-foreground active:scale-95 transition-all cursor-pointer"
        title="Search (⌘K)"
      >
        <div className="p-2 rounded-2xl bg-muted/90 text-foreground border border-border/80 -mt-2.5 shadow-sm">
          <Search className="w-4 h-4" />
        </div>
        <span className="tracking-tight mt-0.5">Search</span>
      </button>

      {/* 4. Vault & Credentials */}
      <NavLink
        to="/settings?tab=vault"
        className={`flex flex-col items-center justify-center min-w-[58px] py-1 px-2 rounded-2xl text-[11px] font-medium transition-all active:scale-95 ${
          isVaultActive
            ? 'text-primary font-bold'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <div className="relative">
          {isUnlocked ? (
            <ShieldCheck className="w-5 h-5 mb-0.5 text-emerald-500" />
          ) : (
            <Lock className="w-5 h-5 mb-0.5" />
          )}
          {isVaultActive && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_currentColor]" />
          )}
        </div>
        <span className="tracking-tight mt-0.5">Vault</span>
      </NavLink>

      {/* 5. Preferences & Settings */}
      <NavLink
        to="/settings?tab=preferences"
        className={`flex flex-col items-center justify-center min-w-[58px] py-1 px-2 rounded-2xl text-[11px] font-medium transition-all active:scale-95 ${
          isSettingsActive
            ? 'text-primary font-bold'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <div className="relative">
          <Settings className="w-5 h-5 mb-0.5" />
          {isSettingsActive && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_currentColor]" />
          )}
        </div>
        <span className="tracking-tight mt-0.5">Settings</span>
      </NavLink>
    </nav>
  );
};
