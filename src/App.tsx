import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './app/layout/AppShell';
import { Dashboard } from './app/routes/Dashboard';
import { ServerDetail } from './app/routes/ServerDetail';
import { Settings } from './app/routes/Settings';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="server/:id" element={<ServerDetail />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
