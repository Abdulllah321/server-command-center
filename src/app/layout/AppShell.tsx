import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileBottomNav } from './MobileBottomNav';
import { SearchPalette } from '@/features/search/components/SearchPalette';
import { HostKeyModal } from '@/features/servers/components/HostKeyModal';

export const AppShell = () => {
  const [searchOpen, setSearchOpen] = useState(false);

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
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom,16px))] md:pb-0">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav onSearchClick={() => setSearchOpen(true)} />
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <HostKeyModal />
    </div>
  );
};
