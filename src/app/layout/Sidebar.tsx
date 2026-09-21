import React from 'react';
import { NavLink } from 'react-router-dom';
import { Server, Settings, Home, Folder } from 'lucide-react';

export const Sidebar = () => {
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
            className={({ isActive }) => 
              `flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`
            }
          >
            <Home className="h-4 w-4" />
            <span className="text-sm font-medium">Dashboard</span>
          </NavLink>
        </nav>
        
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">Groups</h4>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground">
              <Folder className="h-4 w-4" />
              <span className="text-sm">Production</span>
            </div>
            <div className="flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground">
              <Folder className="h-4 w-4" />
              <span className="text-sm">Staging</span>
            </div>
          </div>
        </div>
      </div>
      
      <div className="p-4 border-t border-border">
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
