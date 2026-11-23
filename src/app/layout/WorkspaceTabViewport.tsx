import React from 'react';
import { useWorkspaceTabsStore } from '@/stores/use-workspace-tabs-store';
import { Dashboard } from '@/app/routes/Dashboard';
import { ServerDetail } from '@/app/routes/ServerDetail';
import { GroupDetail } from '@/features/groups/components/GroupDetail';
import { ActivityScreen } from '@/features/activity/components/ActivityScreen';
import { Settings } from '@/app/routes/Settings';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

export const WorkspaceTabViewport: React.FC = () => {
  const tabs = useWorkspaceTabsStore((s) => s.tabs);
  const activeTabId = useWorkspaceTabsStore((s) => s.activeTabId);

  return (
    <div className="relative w-full h-full flex-1 min-h-0 overflow-hidden bg-background">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            id={`tab-viewport-${tab.id}`}
            className="w-full h-full flex flex-col flex-1 min-h-0 overflow-hidden"
            style={{
              display: isActive ? 'flex' : 'none',
            }}
          >
            {tab.type === 'dashboard' && (
              <ErrorBoundary
                fallbackTitle="Dashboard Error"
                fallbackDescription="Failed to render the infrastructure cockpit dashboard."
              >
                <Dashboard />
              </ErrorBoundary>
            )}

            {tab.type === 'server' && (
              <ErrorBoundary
                fallbackTitle="Server View Error"
                fallbackDescription={`Failed to render server management for "${tab.title}".`}
              >
                <ServerDetail serverId={tab.serverId} isActive={isActive} />
              </ErrorBoundary>
            )}

            {tab.type === 'group' && (
              <ErrorBoundary
                fallbackTitle="Group View Error"
                fallbackDescription={`Failed to render server group management for "${tab.title}".`}
              >
                <GroupDetail groupId={tab.groupId} />
              </ErrorBoundary>
            )}

            {tab.type === 'activity' && (
              <ErrorBoundary
                fallbackTitle="Activity Log Error"
                fallbackDescription="Failed to load and render the activity log history."
              >
                <ActivityScreen />
              </ErrorBoundary>
            )}

            {tab.type === 'settings' && (
              <ErrorBoundary
                fallbackTitle="Settings Error"
                fallbackDescription="Failed to render application settings."
              >
                <Settings />
              </ErrorBoundary>
            )}
          </div>
        );
      })}
    </div>
  );
};

