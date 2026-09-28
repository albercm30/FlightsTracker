/* Service worker de la web pública: recibe las notificaciones de Flight Tracker. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Flight Tracker', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Flight Tracker', {
    body: d.body || '', icon: 'static/icons/icon-192.png', badge: 'static/icons/icon-192.png',
    tag: d.tag || 'flight-deals', renotify: true, data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
