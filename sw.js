'use strict';
const VERSION = '3.0.0';
const PREFIX = 'weight-notes-shell:';
const CACHE = PREFIX + VERSION + ':9823882380c70bde';
const ASSETS = ['./', './index.html', './styles.css', './core.js', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const absolute = p => new URL(p, self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache only our fixed, generic application files, never user records or auth pages.
    for (const p of ASSETS) {
      const url = absolute(p), response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
      if (!response.ok || response.redirected || response.type === 'opaque' || new URL(response.url).origin !== self.location.origin) throw Error('Cannot cache app shell');
      const contentType = response.headers.get('content-type') || '';
      if (p.endsWith('.js') && !/javascript/.test(contentType)) throw Error('Invalid script response');
      if ((p === './' || p.endsWith('.html')) && !(await response.clone().text()).includes('id="entry-weight"')) throw Error('Not the app shell');
      await cache.put(url, response);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  // Do not touch other applications' caches or any local record storage.
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const isNavigation = event.request.mode === 'navigate' && url.href.startsWith(self.registration.scope);
  const key = isNavigation ? absolute('./index.html') : event.request.url;
  if (!isNavigation && !ASSETS.map(absolute).includes(key)) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(CACHE)).match(key);
    return cached || fetch(event.request);
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'VERIFY_CACHE' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE), results = await Promise.all(ASSETS.map(p => cache.match(absolute(p))));
    event.ports[0].postMessage({ ready: results.every(Boolean), version: VERSION });
  })());
});
