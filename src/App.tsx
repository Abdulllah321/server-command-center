import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './app/layout/AppShell';
import { Dashboard } from './app/routes/Dashboard';
import { ServerDetail } from './app/routes/ServerDetail';
import { Settings } from './app/routes/Settings';
import { ConfirmationProvider } from '@/components/shared/ConfirmationModal';
import { ActivityScreen } from '@/features/activity/components/ActivityScreen';
import { GroupDetail } from '@/features/groups/components/GroupDetail';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { Toaster } from '@/components/ui/sonner';

function App() {
  return (
    <ErrorBoundary fallbackTitle="Application Error" fallbackDescription="The application root encountered an unexpected crash.">
      <BrowserRouter>
        <ConfirmationProvider>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route 
                index 
                element={
                  <ErrorBoundary fallbackTitle="Dashboard Error" fallbackDescription="Failed to render the server overview dashboard.">
                    <Dashboard />
                  </ErrorBoundary>
                } 
              />
              <Route 
                path="server/:id" 
                element={
                  <ErrorBoundary fallbackTitle="Server Detail Error" fallbackDescription="Failed to render the server management screen.">
                    <ServerDetail />
                  </ErrorBoundary>
                } 
              />
              <Route 
                path="group/:id" 
                element={
                  <ErrorBoundary fallbackTitle="Group Detail Error" fallbackDescription="Failed to render server group management.">
                    <GroupDetail />
                  </ErrorBoundary>
                } 
              />
              <Route 
                path="activity" 
                element={
                  <ErrorBoundary fallbackTitle="Activity Log Error" fallbackDescription="Failed to load and render the activity log history.">
                    <ActivityScreen />
                  </ErrorBoundary>
                } 
              />
              <Route 
                path="settings" 
                element={
                  <ErrorBoundary fallbackTitle="Settings Error" fallbackDescription="Failed to render application settings.">
                    <Settings />
                  </ErrorBoundary>
                } 
              />
            </Route>
          </Routes>
        </ConfirmationProvider>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </ErrorBoundary>
  );
}

export default App;
