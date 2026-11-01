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
  const isSettingsActive = location.pathname === '/settings' && !location.search.includes('tab=vault');
  const isVaultActive = location.pathname === '/settings' && location.search.includes('tab=vault');

  return (
    <nav 
      aria-label="Mobile Navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card/95 backdrop-blur-lg border-t border-border flex items-center justify-around px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] shadow-xl select-none"
    >
      {/* 1. Servers Fleet */}
      <NavLink
        to="/"
        className={`flex flex-col items-center justify-center min-w-[54px] py-1 px-2 rounded-xl text-[10px] font-medium transition-colors ${
          isServersActive
            ? 'text-primary font-semibold'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <div className="relative">
          <Server className="w-5 h-5 mb-0.5" />
          {isServersActive && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
          )}
        </div>
        <span>Servers</span>
      </NavLink>

      {/* 2. Activity Audit */}
      <NavLink
        to="/activity"
        className={`flex flex-col items-center justify-center min-w-[54px] py-1 px-2 rounded-xl text-[10px] font-medium transition-colors ${
          isActivityActive
            ? 'text-primary font-semibold'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <div className="relative">
          <Activity className="w-5 h-5 mb-0.5" />
          {isActivityActive && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
          )}
        </div>
        <span>Activity</span>
      </NavLink>

      {/* 3. Global Search (Action Trigger) */}
      <button
        type="button"
        onClick={onSearchClick}
        className="flex flex-col items-center justify-center min-w-[54px] py-1 px-2 rounded-xl text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        title="Search (Ctrl+K)"
      >
        <div className="p-1.5 rounded-full bg-muted/80 text-foreground border border-border/80 -mt-2 shadow-xs">
          <Search className="w-4 h-4" />
        </div>
        <span className="mt-0.5">Search</span>
      </button>

      {/* 4. Vault & Security */}
      <NavLink
        to="/settings?tab=vault"
        className={`flex flex-col items-center justify-center min-w-[54px] py-1 px-2 rounded-xl text-[10px] font-medium transition-colors ${
          isVaultActive
            ? 'text-primary font-semibold'
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
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
          )}
        </div>
        <span>Vault</span>
      </NavLink>

      {/* 5. Settings */}
      <NavLink
        to="/settings"
        className={`flex flex-col items-center justify-center min-w-[54px] py-1 px-2 rounded-xl text-[10px] font-medium transition-colors ${
          isSettingsActive
            ? 'text-primary font-semibold'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <div className="relative">
          <Settings className="w-5 h-5 mb-0.5" />
          {isSettingsActive && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
          )}
        </div>
        <span>Settings</span>
      </NavLink>
    </nav>
  );
};

