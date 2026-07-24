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
