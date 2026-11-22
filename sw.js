/* SilverAid — service worker: funcionamiento sin conexión e instalación como aplicación (PWA).

   Estrategias de caché:
     Páginas (navegación)        red primero (máx. 4 s) → copia guardada → offline.html
     css/, js/, assets/          stale-while-revalidate: responde con la copia y la actualiza en segundo plano
     Fuentes de Google           caché primero (no cambian)
     GET /api/…                  red primero → última respuesta guardada (separada por usuario)
     POST/PUT/DELETE /api/…      siempre a la red; si no hay conexión, la página las deja en la cola de
                                 IndexedDB (js/db.js) y este service worker las envía al volver (Background Sync)

   Al publicar cambios en páginas o scripts, suba VERSION (y el ?v= de los HTML) para renovar las cachés. */
importScripts('js/db.js?v=10');

const VERSION = 'v10';
const STATIC = `sa-static-${VERSION}`;
const PAGES = `sa-pages-${VERSION}`;
const API = 'sa-api';
const FONTS = 'sa-fonts';
const KEEP = [STATIC, PAGES, API, FONTS];
const SYNC_TAG = 'sa-sync';

const PAGE_URLS = [
  'index.html', 'login.html', 'app.html', 'usuario.html', 'admin.html', 'documentos.html', 'offline.html',
  'registro-familiar.html', 'registro-cuidador.html', 'registro-colaborador.html',
];
const STATIC_URLS = [
  'css/styles.css', 'css/landing.css', 'manifest.webmanifest',
  ...['auth', 'db', 'pwa', 'store', 'meds', 'family', 'sos', 'assistant', 'availability', 'caregivers', 'elders',
    'main', 'usuario', 'admin', 'registro'].map((n) => `js/${n}.js`),
  'assets/brand/silveraid-horizontal-color.svg', 'assets/brand/silveraid-horizontal-negativo.svg',
  'assets/brand/silveraid-vertical-color.svg', 'assets/brand/silveraid-simbolo-color.svg',
  'assets/brand/silveraid-icono-app.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
].map((u) => (/\.(css|js)$/.test(u) ? `${u}?v=10` : u));

// ------------------------------------------------------------------ instalación y activación
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const [pages, stat] = await Promise.all([caches.open(PAGES), caches.open(STATIC)]);
    await Promise.all([pages.addAll(PAGE_URLS), stat.addAll(STATIC_URLS)]);
  })());
  // La nueva versión espera a que la página acepte actualizar (mensaje SKIP_WAITING), salvo la primera vez.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (!KEEP.includes(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'SYNC') event.waitUntil(runSync().catch(() => {}));
  if (msg.type === 'CLEAR_USER') event.waitUntil(clearUserCache(msg.token));
});

// ------------------------------------------------------------------ peticiones
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    return event.respondWith(cacheFirst(req, FONTS));
  }
  if (url.origin !== self.location.origin) return;            // otros sitios (mapas…): sin tocar

  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' || url.pathname === '/api/me/state' || url.pathname.includes('/attachments/')) return;
    return event.respondWith(apiNetworkFirst(event));
  }
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') return event.respondWith(pageNetworkFirst(event));
  if (/\/(css|js|assets)\//.test(url.pathname) || url.pathname.endsWith('/manifest.webmanifest')) {
    return event.respondWith(staleWhileRevalidate(event));
  }
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function pageNetworkFirst(event) {
  const req = event.request;
  const cache = await caches.open(PAGES);
  try {
    if (self.navigator && self.navigator.onLine === false) throw new Error('offline'); // sin esperar a la red
    const res = await Promise.race([fetch(req), timeout(4000)]);
    if (res.ok) event.waitUntil(cache.put(pageKey(req.url), res.clone()));
    return res;
  } catch (e) {
    return (await cache.match(pageKey(req.url))) || (await cache.match('offline.html')) || Response.error();
  }
}

/** Una sola copia por página: sin ?consulta ni #ancla (login.html?source=pwa → login.html). */
function pageKey(href) {
  const u = new URL(href);
  return u.origin + (u.pathname.endsWith('/') ? u.pathname + 'index.html' : u.pathname);
}

async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await caches.open(STATIC);
  const cached = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  return network.catch(() => Response.error());
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch (e) {
    return Response.error();
  }
}

// ------------------------------------------------------------------ API: copia por usuario
async function hashToken(token) {
  if (!token) return 'anon';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function apiKey(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
  const u = new URL(req.url);
  u.searchParams.set('__sa_user', await hashToken(token));
  return u.href;
}

async function apiNetworkFirst(event) {
  const req = event.request;
  const cache = await caches.open(API);
  const key = await apiKey(req);
  try {
    if (self.navigator && self.navigator.onLine === false) throw new Error('offline');
    const res = await Promise.race([fetch(req), timeout(8000)]);
    if (res.ok) event.waitUntil(cache.put(key, res.clone()));
    else if (res.status === 401 || res.status === 403) event.waitUntil(cache.delete(key));
    return res;
  } catch (e) {
    const cached = await cache.match(key);
    if (cached) {
      // Marca la respuesta para que la página sepa que son datos guardados.
      const headers = new Headers(cached.headers);
      headers.set('X-SA-Offline', '1');
      return new Response(await cached.blob(), { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: 'Sin conexión: estos datos todavía no están guardados en el dispositivo.' }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'X-SA-Offline': '1' } });
  }
}

async function clearUserCache(token) {
  const cache = await caches.open(API);
  const tag = '__sa_user=' + (await hashToken(token));
  for (const req of await cache.keys()) if (req.url.includes(tag)) await cache.delete(req);
}

// ------------------------------------------------------------------ sincronización en segundo plano
let syncing = null;

function runSync() {
  if (!syncing) {
    syncing = (async () => {
      try {
        const report = await SADB.syncAll((path, opts) => fetch(path, opts));
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        clients.forEach((c) => c.postMessage({ type: 'SYNCED', report }));
        if (report.offline) throw new Error('Sin conexión'); // Background Sync lo reintentará
        return report;
      } finally {
        syncing = null;
      }
    })();
  }
  return syncing;
}

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(runSync());
});
