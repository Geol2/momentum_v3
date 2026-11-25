import React from 'react'
import ReactDOM from 'react-dom/client'
import G2App from './G2App.jsx'
import { isInEvenApp } from './bridge.js'
import { setTokenMirror, TOKEN_STORAGE_KEY } from '../lib/api.js'
// 로그인 화면(Login.jsx)이 전역 스타일을 쓰므로 함께 불러옵니다.
import '../index.css'

// Even 앱 안(설치형 .ehpk)에서는 WebView 주소가 http://127.0.0.1:<실행마다 바뀌는 포트> 라서
// 브라우저 localStorage 가 앱을 열 때마다 비어 있어요 → 매번 로그인해야 했던 원인.
// 그래서 로그인 토큰·마지막 이메일을 Even 앱의 저장소(bridge.setLocalStorage)에도 적어 두고,
// 앱을 열 때 먼저 되살린 뒤 화면을 그립니다.
const EMAIL_KEY = 'momentum_last_email'
const KEYS = [TOKEN_STORAGE_KEY, EMAIL_KEY]

async function restoreFromEvenApp() {
  if (!isInEvenApp()) return
  try {
    const { waitForEvenAppBridge } = await import('@evenrealities/even_hub_sdk')
    const bridge = await Promise.race([waitForEvenAppBridge(), new Promise((r) => setTimeout(() => r(null), 2500))])
    if (!bridge) return
    for (const k of KEYS) {
      try {
        const v = await bridge.getLocalStorage(k)
        if (v && !localStorage.getItem(k)) localStorage.setItem(k, v)
      } catch { /* 하나 실패해도 나머지는 계속 */ }
    }
    setTokenMirror((token) => {
      bridge.setLocalStorage(TOKEN_STORAGE_KEY, token || '').catch(() => {})
      // 로그인 화면은 토큰을 받은 다음에 이메일을 저장하므로 조금 뒤에 옮겨 적음
      setTimeout(() => {
        const email = localStorage.getItem(EMAIL_KEY)
        if (email) bridge.setLocalStorage(EMAIL_KEY, email).catch(() => {})
      }, 1500)
    })
  } catch { /* SDK 없음 — 그냥 진행 */ }
}

restoreFromEvenApp().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <G2App />
    </React.StrictMode>,
  )
})
