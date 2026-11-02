import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { ensureGlobalPwaListeners } from './hooks/usePWAInstall.ts';
import './index.css';

// Capture beforeinstallprompt immediately before service worker & bootstrap finish
ensureGlobalPwaListeners();

function collectSameOriginModuleUrls(): string[] {
  if (typeof window === 'undefined' || !('performance' in window)) return [];
  try {
    const entries = window.performance.getEntriesByType(
      'resource'
    ) as PerformanceResourceTiming[];
    const origin = window.location.origin;
    const urls: string[] = [];
    for (const entry of entries) {
      if (!entry.name || !entry.name.startsWith(origin)) continue;
      const path = entry.name.slice(origin.length);
      if (
        path.startsWith('/api/') ||
        path.startsWith('/ws') ||
        path.startsWith('/sw.js') ||
        path.startsWith('/dev-sw.js')
      ) {
        continue;
      }
      urls.push(entry.name);
    }
    return urls;
  } catch {
    return [];
  }
}

function sendWarmAppShellMessage(sw: ServiceWorker | null | undefined): void {
  if (!sw) return;
  try {
    sw.postMessage({
      type: 'WARM_APP_SHELL',
      urls: collectSameOriginModuleUrls(),
    });
  } catch {
    // Ignore postMessage errors
  }
}

async function initPwaServiceWorker() {
  if (typeof window === 'undefined') return;

  // Proactively clear any legacy Workbox precaches that could serve stale HTML
  if ('caches' in window) {
    try {
      const cacheKeys = await window.caches.keys();
      await Promise.all(
        cacheKeys
          .filter((key) => key.startsWith('workbox-'))
          .map((key) => window.caches.delete(key))
      );
    } catch {
      // Ignore CacheStorage restrictions in private/embedded contexts
    }
  }

  if (!('serviceWorker' in navigator)) return;

  try {
    // Unregister any legacy /dev-sw.js worker so /sw.js is the single active controller
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((reg) => {
          const scriptUrl =
            reg.active?.scriptURL ||
            reg.waiting?.scriptURL ||
            reg.installing?.scriptURL ||
            '';
          return scriptUrl.includes('/dev-sw.js');
        })
        .map((reg) => reg.unregister().catch(() => false))
    );

    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
    void registration.update().catch(() => undefined);

    const warmActiveWorker = () => {
      const target =
        navigator.serviceWorker.controller ||
        registration.active ||
        registration.waiting ||
        registration.installing;
      sendWarmAppShellMessage(target);
    };

    if (navigator.serviceWorker.controller) {
      warmActiveWorker();
    }
    navigator.serviceWorker.ready
      .then((readyReg) => {
        sendWarmAppShellMessage(readyReg.active);
        window.setTimeout(() => {
          sendWarmAppShellMessage(
            navigator.serviceWorker.controller || readyReg.active
          );
        }, 2500);
      })
      .catch(() => undefined);
  } catch {
    // Ignore ServiceWorker restrictions inside sandboxed iframes or restricted WebViews
  }
}

void initPwaServiceWorker();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
