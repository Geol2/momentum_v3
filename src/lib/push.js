import { pushApi } from './api.js'

/**
 * Web Push (PWA) 알림 — 약속 시간 전에 폰으로 알려주는 기능의 클라이언트 쪽.
 *
 * The flow: register the service worker → ask the OS for notification permission →
 * create a PushSubscription with the backend's VAPID public key → hand the endpoint to
 * the backend, which pushes to it when a todo's reminder is due. Everything here is
 * best-effort: on a browser with no push support the app must keep working untouched.
 */

/** Base64url (what the API returns) → Uint8Array (what applicationServerKey wants). */
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export function pushSupported() {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export function isIOS() {
  // iPadOS 13+ reports as Mac, so the touch check is what separates it from a desktop.
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** True once the PWA is launched from the home screen — iOS's precondition for push. */
export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

/**
 * Why alerts can't be turned on here, or null when they can.
 * Checked before showing the toggle so the user gets a reason instead of a dead switch.
 */
export function pushBlockedReason() {
  if (!pushSupported()) {
    return isIOS() && !isStandalone()
      ? '아이폰은 홈 화면에 추가한 뒤에만 알림을 받을 수 있어요.'
      : '이 브라우저는 알림을 지원하지 않아요.'
  }
  if (isIOS() && !isStandalone()) {
    return '아이폰은 홈 화면에 추가한 뒤에만 알림을 받을 수 있어요.'
  }
  if (Notification.permission === 'denied') {
    return '브라우저에서 알림이 차단되어 있어요. 사이트 설정에서 허용해 주세요.'
  }
  return null
}

let swReady = null

/** Registers the worker once per page load; later callers reuse the same promise. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  if (!swReady) {
    swReady = navigator.serviceWorker.register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .catch((e) => {
        console.warn('[push] service worker registration failed', e)
        swReady = null
        return null
      })
  }
  return swReady
}

/** Whether this browser currently holds a subscription. */
export async function isSubscribed() {
  if (!pushSupported()) return false
  const reg = await registerServiceWorker()
  if (!reg) return false
  return !!(await reg.pushManager.getSubscription())
}

/**
 * Turns alerts on: permission → subscribe → register with the backend.
 * Throws with a Korean message the caller can show as-is.
 */
export async function enablePush() {
  const blocked = pushBlockedReason()
  if (blocked) throw new Error(blocked)

  // Must be called from a user gesture — hence the button, not an on-mount effect.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('알림 권한이 허용되지 않았어요.')

  const { enabled, publicKey } = await pushApi.publicKey()
  if (!enabled || !publicKey) throw new Error('서버에 알림이 아직 설정되지 않았어요.')

  const reg = await registerServiceWorker()
  if (!reg) throw new Error('알림 준비에 실패했어요. 페이지를 새로고침해 주세요.')

  // An existing subscription made with a different VAPID key can never be decrypted by
  // this server, so drop it and make a fresh one rather than silently going quiet.
  let sub = await reg.pushManager.getSubscription()
  if (sub) {
    const current = new Uint8Array(sub.options.applicationServerKey || [])
    const wanted = urlBase64ToUint8Array(publicKey)
    const same = current.length === wanted.length && current.every((b, i) => b === wanted[i])
    if (!same) {
      await sub.unsubscribe()
      sub = null
    }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, // required by Chrome: every push must show a notification
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }

  const json = sub.toJSON()
  await pushApi.subscribe({
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
  })
  return true
}

/** Turns alerts off on this device, both in the browser and on the server. */
export async function disablePush() {
  const reg = await registerServiceWorker()
  const sub = reg && (await reg.pushManager.getSubscription())
  if (!sub) return false
  // Server first: if unsubscribe() succeeded but the DELETE failed, the backend would keep
  // pushing to a dead endpoint until the push service 410s it.
  try {
    await pushApi.unsubscribe(sub.endpoint)
  } catch (e) {
    console.warn('[push] server unsubscribe failed', e)
  }
  await sub.unsubscribe()
  return true
}
