import { NavLink } from 'react-router-dom';
import { Server, Settings, Home, History, Lock, Unlock } from 'lucide-react';
import { GroupTree } from '@/features/groups/components/GroupTree';
import { useVaultStore } from '@/stores/use-vault-store';

export const Sidebar = () => {
  const isUnlocked = useVaultStore((state) => state.isUnlocked);

  return (
    <aside className="w-64 border-r border-border bg-card flex flex-col h-full">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <Server className="h-6 w-6 text-primary" />
        <span className="font-semibold text-lg tracking-tight">Command Center</span>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
        <nav className="flex flex-col gap-1">
          <NavLink 
            to="/" 
            end
            className={({ isActive }) => 
              `flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`
            }
          >
            <Home className="h-4 w-4" />
            <span className="text-sm font-medium">Dashboard</span>
          </NavLink>
          <NavLink 
            to="/activity" 
            className={({ isActive }) => 
              `flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`
            }
          >
            <History className="h-4 w-4" />
            <span className="text-sm font-medium">Activity</span>
          </NavLink>
        </nav>
        
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">Groups</h4>
          <div className="px-1">
            <GroupTree />
          </div>
        </div>
      </div>
      
      <div className="p-4 border-t border-border flex flex-col gap-2">
        <div className="px-3 flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span className="flex items-center gap-2">
            {isUnlocked ? <Unlock className="w-3.5 h-3.5 text-green-500" /> : <Lock className="w-3.5 h-3.5 text-muted-foreground" />}
            <span className={isUnlocked ? 'text-green-500 font-medium' : ''}>
              Vault {isUnlocked ? 'Unlocked' : 'Locked'}
            </span>
          </span>
          {isUnlocked && (
            <button 
              onClick={() => useVaultStore.getState().lock(false)}
              className="text-[11px] text-destructive hover:underline cursor-pointer"
            >
              Lock
            </button>
          )}
        </div>
        <NavLink 
            to="/settings" 
            className={({ isActive }) => 
              `flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`
            }
          >
          <Settings className="h-4 w-4" />
          <span className="text-sm font-medium">Settings & Vault</span>
        </NavLink>
      </div>
    </aside>
  );
};
