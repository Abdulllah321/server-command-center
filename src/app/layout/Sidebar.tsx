import { NavLink } from 'react-router-dom';
import { 
  Server, 
  Settings, 
  Home, 
  History, 
  Lock, 
  Unlock, 
  PanelLeftClose, 
  PanelLeftOpen, 
  FolderTree, 
  X 
} from 'lucide-react';
import { GroupTree } from '@/features/groups/components/GroupTree';
import { useVaultStore } from '@/stores/use-vault-store';
import { useUiStore } from '@/stores/ui-store';

export const Sidebar = () => {
  const isUnlocked = useVaultStore((state) => state.isUnlocked);
  const { 
    sidebarCollapsed, 
    toggleSidebar, 
    mobileMenuOpen, 
    setMobileMenuOpen 
  } = useUiStore();

  const handleNavClick = () => {
    // Auto close drawer on mobile when clicking a nav item
    if (mobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  };

  const sidebarContent = (isMobile = false) => {
    const isCollapsed = !isMobile && sidebarCollapsed;

    return (
      <div className="flex flex-col h-full select-none">
        {/* Header / Brand */}
        <div className={`p-4 border-b border-border flex items-center justify-between shrink-0 h-14 ${isCollapsed ? 'px-3 justify-center' : ''}`}>
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="p-1.5 rounded-xl bg-primary/10 border border-primary/20 shrink-0">
              <Server className="h-5 w-5 text-primary" />
            </div>
            {!isCollapsed && (
              <span className="font-bold text-base tracking-tight truncate text-foreground">
                Command Center
              </span>
            )}
          </div>

          {/* Desktop collapse toggle */}
          {!isMobile ? (
            <button
              onClick={toggleSidebar}
              title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer hidden md:flex items-center justify-center"
            >
              {isCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          ) : (
            /* Mobile close button */
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Navigation links & Groups */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-6">
          <nav className="flex flex-col gap-1">
            <NavLink
              to="/"
              end
              onClick={handleNavClick}
              title="Dashboard"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 ${
                  isCollapsed ? 'justify-center px-2' : ''
                } ${
                  isActive
                    ? 'bg-primary/15 text-primary font-semibold shadow-xs'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`
              }
            >
              <Home className="h-4 w-4 shrink-0" />
              {!isCollapsed && <span className="text-sm font-medium">Dashboard</span>}
            </NavLink>

            <NavLink
              to="/activity"
              onClick={handleNavClick}
              title="Activity History"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 ${
                  isCollapsed ? 'justify-center px-2' : ''
                } ${
                  isActive
                    ? 'bg-primary/15 text-primary font-semibold shadow-xs'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`
              }
            >
              <History className="h-4 w-4 shrink-0" />
              {!isCollapsed && <span className="text-sm font-medium">Activity</span>}
            </NavLink>
          </nav>

          {/* Groups Section */}
          {!isCollapsed ? (
            <div>
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
                Server Groups
              </h4>
              <div className="px-1">
                <GroupTree />
              </div>
            </div>
          ) : (
            <div className="flex justify-center" title="Server Groups">
              <div className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <FolderTree className="h-4 w-4" />
              </div>
            </div>
          )}
        </div>

        {/* Footer: Vault status + Settings */}
        <div className={`p-3 border-t border-border flex flex-col gap-2 shrink-0 ${isCollapsed ? 'items-center px-2' : ''}`}>
          {!isCollapsed ? (
            <div className="px-3 py-1.5 rounded-xl bg-muted/40 border border-border/50 flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span className="flex items-center gap-2">
                {isUnlocked ? (
                  <Unlock className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-amber-500" />
                )}
                <span className={isUnlocked ? 'text-emerald-500 font-medium' : 'text-muted-foreground'}>
                  Vault {isUnlocked ? 'Unlocked' : 'Locked'}
                </span>
              </span>
              {isUnlocked && (
                <button
                  onClick={() => useVaultStore.getState().lock(false)}
                  className="text-[11px] text-rose-500 hover:underline cursor-pointer font-medium"
                >
                  Lock
                </button>
              )}
            </div>
          ) : (
            <div 
              title={`Vault ${isUnlocked ? 'Unlocked' : 'Locked'}`}
              className="p-2 flex justify-center text-muted-foreground"
            >
              {isUnlocked ? (
                <Unlock className="w-4 h-4 text-emerald-500" />
              ) : (
                <Lock className="w-4 h-4 text-amber-500" />
              )}
            </div>
          )}

          <NavLink
            to="/settings"
            onClick={handleNavClick}
            title="Settings & Vault"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 ${
                isCollapsed ? 'justify-center px-2' : ''
              } ${
                isActive
                  ? 'bg-primary/15 text-primary font-semibold shadow-xs'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`
            }
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span className="text-sm font-medium">Settings & Vault</span>}
          </NavLink>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Sticky Sidebar */}
      <aside
        className={`border-r border-border bg-card/80 backdrop-blur-md flex-col h-full transition-all duration-300 hidden md:flex shrink-0 ${
          sidebarCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        {sidebarContent(false)}
      </aside>

      {/* Mobile Off-canvas Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in"
            onClick={() => setMobileMenuOpen(false)}
          />
          {/* Drawer Panel */}
          <div className="relative w-72 max-w-[85vw] h-full bg-card border-r border-border shadow-2xl flex flex-col z-10 animate-in slide-in-from-left duration-200 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-[max(env(safe-area-inset-bottom,0px),1rem)]">
            {sidebarContent(true)}
          </div>
        </div>
      )}
    </>
  );
};
