import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { QueryProvider } from './app/providers/query-provider.tsx'
import { ThemeProvider } from './app/providers/theme-provider.tsx'
import { openExternalUrl } from './lib/tauri-client'

// Global handler: intercept external HTTP/HTTPS links and open them in the OS default browser
if (typeof window !== 'undefined') {
  document.addEventListener('click', (e) => {
    const anchor = (e.target as HTMLElement)?.closest('a');
    if (!anchor || !anchor.href) return;

    try {
      const url = new URL(anchor.href, window.location.href);
      // Strictly isolate internal SPA routes from external web links
      const isInternal =
        url.origin === window.location.origin ||
        url.hostname === 'tauri.localhost' ||
        url.hostname === 'localhost' ||
        url.protocol === 'tauri:' ||
        url.protocol === 'javascript:';

      if (!isInternal && (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:')) {
        e.preventDefault();
        openExternalUrl(anchor.href);
      }
    } catch {
      // Ignore URL parsing errors and allow standard navigation
    }
  });

  // Suppress useless default Chromium webview context menu everywhere except in text inputs and terminal
  document.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement;
    const isTextInput = target.closest('input, textarea, [contenteditable="true"], .xterm');
    if (!isTextInput) {
      e.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryProvider>
        <App />
      </QueryProvider>
    </ThemeProvider>
  </StrictMode>,
)
