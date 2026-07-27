/**
 * Service worker — the only part of the app that runs when the tab is closed.
 * Its whole job is to receive Web Push messages from the backend's ReminderScheduler
 * and turn them into an OS notification.
 *
 * Registered from src/main.jsx. Lives in public/ so Vite copies it to the site root,
 * which gives it scope "/" — a worker served from /assets/ could only control /assets/.
 */

// Take over immediately instead of waiting for every old tab to close, so a deployed
// fix to this file is live on the next visit rather than the next browser restart.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  // Payload shape is set by WebPushService.Payload on the backend.
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // Not JSON — some push services send a bare string during testing.
    data = { body: event.data ? event.data.text() : '' }
  }

  const title = data.title || '달빛 서랍'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Same tag replaces an earlier alert for the same todo instead of stacking a duplicate.
    tag: data.tag || 'momentum',
    renotify: true,
    vibrate: [80, 40, 80],
    data: { url: data.url || '/' },
  }

  // waitUntil keeps the worker alive until the notification is actually shown —
  // without it the browser may kill it first and the alert silently never appears.
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data && event.notification.data.url

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Prefer an already-open app window; opening a second one loses the user's place.
    for (const client of clients) {
      if ('focus' in client) return client.focus()
    }
    if (self.clients.openWindow) return self.clients.openWindow(target || '/')
  })())
})
