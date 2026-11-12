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
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  // 예전 버전 자산 캐시 정리
  for (const k of await caches.keys()) if (k.startsWith('momentum-assets-') && k !== ASSET_CACHE) await caches.delete(k)
  await self.clients.claim()
})()))

// ── 큰 정적 자산 캐시 (우주 탐험의 별·지구 자료 등) ──
// /assets/* 는 빌드 때 파일 이름에 해시가 붙으므로 내용이 절대 안 바뀜 → 캐시 우선.
// /gaia/* 타일은 이름이 고정이라 캐시를 먼저 보여 주고 뒤에서 새로 받아 둔다.
const ASSET_CACHE = 'momentum-assets-v1'
const MAX_ENTRIES = 400
async function trim(cache) {
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) await cache.delete(keys[i])
}
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  const immutable = url.pathname.startsWith('/assets/')
  const tiles = url.pathname.startsWith('/gaia/')
  if (!immutable && !tiles) return
  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE)
    const hit = await cache.match(req)
    const net = fetch(req).then(async (res) => {
      if (res.ok && res.type === 'basic') { await cache.put(req, res.clone()); trim(cache) }
      return res
    })
    if (hit) { if (tiles) event.waitUntil(net.catch(() => {})); return hit }
    return net
  })())
})

self.addEventListener('push', (event) => {
  // Payload shape is set by WebPushService.Payload on the backend.
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // Not JSON — some push services send a bare string during testing.
    data = { body: event.data ? event.data.text() : '' }
  }

  const title = data.title || '모멘텀'
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
