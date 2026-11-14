/* D’Chicken Express Control · service worker v18
   - Abre sin internet (copia de la app en el dispositivo).
   - Recibe los avisos push diarios. */
const VERSION = 'dchicken-v18.0';
const SHELL = ['./', './index.html', './app.css?v=18', './cloud.js?v=18', './app.js?v=18', './logo.webp', './fonts/text.woff', './fonts/brasa-display.woff', './fonts/brasa-text.woff',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isLib = (u) => u.hostname === 'cdn.jsdelivr.net' && u.pathname.startsWith('/npm/@supabase/');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  // Página: primero internet (siempre la versión nueva), si no hay señal, la copia guardada.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh.ok) (await caches.open(VERSION)).put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }
  // Librería de Supabase (versión fija): se guarda la primera vez y se reutiliza.
  if (isLib(u)) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
      return res;
    })());
    return;
  }
  // Archivos propios: copia guardada y actualización en segundo plano.
  if (u.origin === self.location.origin) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      const net = fetch(req).then(async (res) => {
        if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
        return res;
      }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
  }
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const title = data.title || 'D’Chicken Express';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Tienes avisos pendientes.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'dchicken',
    renotify: true,
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { await c.focus(); return; } }
    await self.clients.openWindow(target);
  })());
});
