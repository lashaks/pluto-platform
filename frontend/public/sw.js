const CACHE = 'plutotrader-v1';
const PRECACHE = ['/terminal.html', '/css/style.css', '/img/favicon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network first, cache fallback for HTML/CSS/JS
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Don't cache API calls or WebSocket
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return;
  
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});
