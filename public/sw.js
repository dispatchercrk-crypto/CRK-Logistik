const APP_SHELL_CACHE = 'crk-app-shell-v4';
const APP_SHELL_KEY = '/__crk_app_shell__';
const PRECACHE_ASSETS = [
  '/icon.svg',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
];

function isGenuineCrkAppHtml(htmlText) {
  if (typeof htmlText !== 'string' || !htmlText) return false;
  const lower = htmlText.toLowerCase();
  if (
    lower.includes('please wait while your application starts') ||
    lower.includes('there may have been an issue during the build process')
  ) {
    return false;
  }
  return htmlText.includes('<div id="root"></div>');
}

function fetchWithTimeout(requestOrUrl, timeoutMs, initOverrides) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchPromise = initOverrides
    ? fetch(requestOrUrl, Object.assign({}, initOverrides, { signal: controller.signal }))
    : fetch(requestOrUrl, { signal: controller.signal });

  return fetchPromise.finally(() => {
    clearTimeout(timer);
  });
}

const OFFLINE_FALLBACK_HTML = `<!doctype html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CRK Logistik — Mode Offline</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; }
    .card { max-width: 400px; width: 100%; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; text-align: center; box-shadow: 0 1px 3px rgba(15,23,42,0.06); }
    h1 { font-size: 16px; margin: 0 0 8px; }
    p { font-size: 13px; color: #475569; line-height: 1.5; margin: 0 0 16px; }
    button { background: #047857; color: #fff; border: 0; border-radius: 12px; padding: 12px 18px; font-size: 13px; font-weight: 600; width: 100%; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>CRK Logistik Delivery Sistem</h1>
    <p>Perangkat sedang tidak terhubung ke jaringan internet. Periksa sinyal seluler atau Wi-Fi HP Anda lalu muat ulang.</p>
    <button onclick="window.location.reload()">Muat Ulang Aplikasi</button>
  </div>
</body>
</html>`;

const HIBERNATION_WAIT_HTML = `<!doctype html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CRK Logistik — Menghubungkan Server</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; }
    .card { max-width: 420px; width: 100%; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; text-align: center; box-shadow: 0 4px 12px rgba(15,23,42,0.06); }
    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #047857; border-radius: 50%; margin: 0 auto 14px; animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 16px; margin: 0 0 8px; color: #0f172a; }
    p { font-size: 13px; color: #475569; line-height: 1.55; margin: 0 0 16px; }
    button { background: #047857; color: #fff; border: 0; border-radius: 12px; padding: 12px 18px; font-size: 13px; font-weight: 600; width: 100%; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>CRK Logistik Delivery Sistem</h1>
    <p>Menghubungkan ke server operasional... Halaman ini akan terbuka otomatis begitu server siap.</p>
    <button onclick="window.location.reload()">Coba Muat Sekarang</button>
  </div>
  <script>
    setInterval(function () {
      fetch('/api/driver-link-ping', { cache: 'no-store' })
        .then(function (r) {
          var ct = (r.headers.get('content-type') || '').toLowerCase();
          if (r.ok && ct.indexOf('application/json') !== -1) {
            window.location.reload();
          }
        })
        .catch(function () {});
    }, 4500);
  </script>
</body>
</html>`;

async function cacheValidSubresource(cache, reqUrlString, res) {
  if (!res || res.status !== 200 || res.redirected || res.type === 'opaqueredirect') {
    return;
  }
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml+xml')) {
    return;
  }
  try {
    const parsedUrl = new URL(reqUrlString, self.location.origin);
    await cache.put(reqUrlString, res.clone());
    if (parsedUrl.search) {
      await cache.put(parsedUrl.pathname, res.clone());
    }
  } catch {
    // Ignore CacheStorage quota or opaque edge cases
  }
}

async function warmAppShellResources(urls) {
  try {
    const cache = await caches.open(APP_SHELL_CACHE);

    // 1. Ensure canonical App Shell HTML ('/') is cached
    try {
      const rootRes = await fetchWithTimeout('/', 5000, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (rootRes && rootRes.ok && !rootRes.redirected) {
        const html = await rootRes.text();
        if (isGenuineCrkAppHtml(html)) {
          await cache.put(
            APP_SHELL_KEY,
            new Response(html, {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }
      }
    } catch {
      // Ignore if offline while warming
    }

    // 2. Cache all loaded same-origin JS/TSX/CSS/font/image modules
    if (!Array.isArray(urls)) return;
    const uniqueUrls = Array.from(new Set(urls)).slice(0, 250);
    await Promise.allSettled(
      uniqueUrls.map(async (rawUrl) => {
        if (typeof rawUrl !== 'string' || !rawUrl) return;
        let parsed;
        try {
          parsed = new URL(rawUrl, self.location.origin);
        } catch {
          return;
        }
        if (parsed.origin !== self.location.origin) return;
        const p = parsed.pathname;
        if (
          p === '/' ||
          p.startsWith('/api/') ||
          p.startsWith('/ws') ||
          p === '/sw.js' ||
          p === '/dev-sw.js' ||
          p === '/manifest.webmanifest'
        ) {
          return;
        }
        const already = await cache.match(parsed.href);
        if (already) return;
        const res = await fetchWithTimeout(parsed.href, 5000, {
          credentials: 'same-origin',
        });
        await cacheValidSubresource(cache, parsed.href, res);
      })
    );
  } catch {
    // Ignore background cache warming errors
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then(async (cache) => {
        await Promise.allSettled(
          PRECACHE_ASSETS.map((assetUrl) =>
            fetchWithTimeout(assetUrl, 4500, {
              credentials: 'same-origin',
              cache: 'reload',
            })
              .then((res) => cacheValidSubresource(cache, assetUrl, res))
              .catch(() => undefined)
          )
        );
        await warmAppShellResources([]);
      })
      .catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key !== APP_SHELL_CACHE &&
                (key.startsWith('workbox-') ||
                  key.startsWith('crk-pwa-') ||
                  key.startsWith('crk-app-shell-') ||
                  key.includes('crk-api'))
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'WARM_APP_SHELL') {
    event.waitUntil(warmAppShellResources(event.data.urls || []));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;

  const pathname = url.pathname;
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/ws') ||
    pathname === '/__vite_ping' ||
    pathname === '/sw.js' ||
    pathname === '/dev-sw.js' ||
    pathname === '/manifest.webmanifest'
  ) {
    return;
  }

  // 1. Document Navigations: Protect Driver & Admin from "Please wait while your application starts..."
  // when AI Studio hibernates the container after Admin closes the editor.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_SHELL_CACHE).catch(() => null);
        try {
          const res = await fetchWithTimeout(req, 4200);

          // Preserve genuine 302 cookie handoffs so Cloud Run / AI Studio auth cookies can refresh
          if (res && res.type === 'opaqueredirect') {
            return res;
          }

          if (res) {
            const ct = (res.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('text/html') || !res.ok) {
              const html = await res.clone().text();
              if (res.ok && isGenuineCrkAppHtml(html)) {
                if (cache) {
                  cache
                    .put(
                      APP_SHELL_KEY,
                      new Response(html, {
                        status: 200,
                        headers: { 'Content-Type': 'text/html; charset=utf-8' },
                      })
                    )
                    .catch(() => undefined);
                }
                return res;
              }

              // Server returned AI Studio hibernation splash ("Please wait while your application starts...")
              // or 502/503 gateway error: serve cached CRK Logistik App Shell immediately!
              const cachedShell = cache ? await cache.match(APP_SHELL_KEY) : null;
              if (cachedShell) {
                return cachedShell;
              }

              return new Response(HIBERNATION_WAIT_HTML, {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
              });
            }
            return res;
          }
        } catch {
          // Network offline or container cold-start timed out
        }

        const cachedShell = cache ? await cache.match(APP_SHELL_KEY) : null;
        if (cachedShell) {
          return cachedShell;
        }

        const isOffline =
          self.navigator && self.navigator.onLine === false;
        return new Response(
          isOffline ? OFFLINE_FALLBACK_HTML : HIBERNATION_WAIT_HTML,
          {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }
        );
      })()
    );
    return;
  }

  // 2. Same-Origin Modules, Styles, Fonts, and Icons (including Vite /src/* & /node_modules/* and prod /assets/*)
  // Never cache HTML splash responses as JS/CSS, and fall back to cached modules whenever container is hibernating!
  event.respondWith(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE).catch(() => null);
      try {
        const res = await fetchWithTimeout(req, 3500);
        const ct = res ? (res.headers.get('content-type') || '').toLowerCase() : '';
        const isValidNonHtml =
          res &&
          res.status === 200 &&
          !res.redirected &&
          res.type !== 'opaqueredirect' &&
          !ct.includes('text/html') &&
          !ct.includes('application/xhtml+xml');

        if (isValidNonHtml) {
          if (cache) {
            void cacheValidSubresource(cache, req.url, res);
          }
          return res;
        }
      } catch {
        // Network error or timeout — serve from App Shell cache below
      }

      if (cache) {
        const exactMatch = await cache.match(req.url);
        if (exactMatch) return exactMatch;
        const pathMatch = await cache.match(pathname);
        if (pathMatch) return pathMatch;
      }

      // Prevent Vite dev HMR client from blocking app boot when container is hibernating
      if (pathname === '/@vite/client') {
        return new Response('export {};', {
          status: 200,
          headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
        });
      }

      return Response.error();
    })()
  );
});
