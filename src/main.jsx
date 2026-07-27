import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { detectInApp, isAndroid, openInExternalBrowser } from './lib/inAppBrowser.js'
import { registerServiceWorker } from './lib/push.js'

// Android KakaoTalk's WebView blocks the cross-origin API call (login/signup fail),
// so bounce straight out to Chrome before React even mounts. This scheme is Android-only;
// iOS users get the in-app banner on the login screen instead (they must open Safari
// manually). Navigating away unloads the page, and Chrome's UA has no "kakaotalk", so
// there's no redirect loop.
if (detectInApp() === 'kakaotalk' && isAndroid()) {
  openInExternalBrowser('kakaotalk')
}

// Register the push worker up front so a browser that already granted permission keeps
// receiving reminders without the user touching settings again. Registration alone shows
// no prompt — asking for permission still happens behind the toggle in Settings.
registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
