/* Service worker: la interfaz funciona como app instalable y abre aunque la red falle.
   Las llamadas /api/ van siempre a la red (datos frescos). */
const CACHE = 'ft-v4';
const SHELL = ['/', '/static/styles.css', '/static/js/core.js', '/static/js/static-mode.js', '/static/js/detail.js', '/static/js/views.js', '/static/js/admin.js',
  '/static/icons/icon-192.png', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/login') return;
  // red primero, caché si no hay conexión
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});

/* Notificaciones propias (Web Push) */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Flight Tracker', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Flight Tracker', {
    body: d.body || '', icon: '/static/icons/icon-192.png', badge: '/static/icons/icon-192.png',
    tag: d.tag || 'flight-deals', renotify: true, data: { url: d.url || '/#alerts' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/#alerts';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.navigate(url.startsWith('http') ? url : '/#alerts'); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
