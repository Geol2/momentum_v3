// In-app browsers (KakaoTalk, Naver, Instagram, Facebook, Line, …) run inside a
// restricted WebView where localStorage may be blocked and the page reloads on
// app-switch — which breaks token-based login and the email-code signup flow.
// We detect them so the UI can nudge the user out to a real browser.

export function detectInApp() {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent || ''
  if (/KAKAOTALK/i.test(ua)) return 'kakaotalk'
  if (/NAVER|whale/i.test(ua)) return 'naver'
  if (/Instagram/i.test(ua)) return 'instagram'
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'facebook'
  if (/Line\//i.test(ua)) return 'line'
  if (/DaumApps/i.test(ua)) return 'daum'
  return null
}

export function isAndroid() {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '')
}

export function isIOS() {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent || '')
}

// Best-effort escape to Chrome on iOS. There is NO scheme that forces Safari and none
// that works without a user tap, so this is button-triggered only and silently does
// nothing if Chrome isn't installed. Safari can only be reached via the app's own menu.
export function openInChromeIOS() {
  if (typeof window === 'undefined') return
  const href = window.location.href
  window.location.href = href
    .replace(/^https:\/\//, 'googlechromes://')
    .replace(/^http:\/\//, 'googlechrome://')
}

// Copy the current URL so the user can paste it into Safari. Falls back to a hidden
// textarea + execCommand for the older WebViews where navigator.clipboard is missing.
export async function copyCurrentUrl() {
  if (typeof window === 'undefined') return false
  const url = window.location.href
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

// Best-effort escape to the system browser. Reliable only on Android:
//   • KakaoTalk exposes kakaotalk://web/openExternal
//   • other apps → an android-app intent that opens Chrome
// iOS WebViews give no programmatic escape, so there we can only show instructions.
export function openInExternalBrowser(app) {
  if (typeof window === 'undefined') return false
  const url = window.location.href

  if (isAndroid()) {
    if (app === 'kakaotalk') {
      window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url)
      return true
    }
    const noScheme = url.replace(/^https?:\/\//, '')
    window.location.href =
      'intent://' + noScheme + '#Intent;scheme=https;package=com.android.chrome;end'
    return true
  }
  return false
}
