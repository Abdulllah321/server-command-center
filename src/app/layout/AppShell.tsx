import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { WorkspaceTabBar } from './WorkspaceTabBar';
import { WorkspaceTabViewport } from './WorkspaceTabViewport';
import { MobileBottomNav } from './MobileBottomNav';
import { SearchPalette } from '@/features/search/components/SearchPalette';
import { HostKeyModal } from '@/features/servers/components/HostKeyModal';
import { useWorkspaceTabsStore } from '@/stores/use-workspace-tabs-store';

export const AppShell = () => {
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const openTab = useWorkspaceTabsStore((s) => s.openTab);

  // Sync route transitions with workspace tabs
  useEffect(() => {
    const pathname = location.pathname;
    if (pathname === '/' || pathname === '') {
      openTab({
        id: 'tab-dashboard',
        title: 'Dashboard',
        type: 'dashboard',
        path: '/',
        closable: false,
        isPinned: true,
      });
    } else if (pathname.startsWith('/server/')) {
      const parts = pathname.split('/');
      const serverId = parts[2];
      if (serverId) {
        openTab({
          id: `server-${serverId}`,
          title: 'Server',
          type: 'server',
          serverId,
          path: `${pathname}${location.search}`,
        });
      }
    } else if (pathname.startsWith('/group/')) {
      const parts = pathname.split('/');
      const groupId = parts[2];
      if (groupId) {
        openTab({
          id: `group-${groupId}`,
          title: 'Group',
          type: 'group',
          groupId,
          path: `${pathname}${location.search}`,
        });
      }
    } else if (pathname === '/activity') {
      openTab({
        id: 'tab-activity',
        title: 'Activity',
        type: 'activity',
        path: '/activity',
      });
    } else if (pathname === '/fleet') {
      openTab({
        id: 'tab-fleet',
        title: 'Fleet Commander',
        type: 'fleet',
        path: '/fleet',
      });
    } else if (pathname === '/settings') {
      openTab({
        id: 'tab-settings',
        title: 'Settings',
        type: 'settings',
        path: '/settings',
      });
    }
  }, [location.pathname, location.search, openTab]);

  // Global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex h-[100dvh] w-full bg-background text-foreground overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar onSearchClick={() => setSearchOpen(true)} />
        <WorkspaceTabBar />
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom,16px))] md:pb-0">
          <WorkspaceTabViewport />
        </main>
      </div>
      <MobileBottomNav onSearchClick={() => setSearchOpen(true)} />
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <HostKeyModal />
    </div>
  );
};
