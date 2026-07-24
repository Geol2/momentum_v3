import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { detectInApp, isAndroid, openInExternalBrowser } from './lib/inAppBrowser.js'

// Android KakaoTalk's WebView blocks the cross-origin API call (login/signup fail),
// so bounce straight out to Chrome before React even mounts. This scheme is Android-only;
// iOS users get the in-app banner on the login screen instead (they must open Safari
// manually). Navigating away unloads the page, and Chrome's UA has no "kakaotalk", so
// there's no redirect loop.
if (detectInApp() === 'kakaotalk' && isAndroid()) {
  openInExternalBrowser('kakaotalk')
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
