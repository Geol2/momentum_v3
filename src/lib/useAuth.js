import { useCallback, useEffect, useState } from 'react'
import { AUTH_EXPIRED_EVENT, apiFetch, getToken, setToken, clearToken } from './api.js'

// status: 'booting' | 'authenticated' | 'anonymous'
export function useAuth() {
  const [status, setStatus] = useState(getToken() ? 'booting' : 'anonymous')
  const [user, setUser] = useState(null)
  // 만료로 끊긴 경우에만 true — 사용자가 직접 누른 로그아웃과 구분해서
  // 로그인 화면에 "세션이 만료되었어요"를 띄우기 위한 것입니다.
  const [expired, setExpired] = useState(false)

  // 어떤 API 호출이든 401을 받으면 여기로 옵니다. 화면은 로그인 상태인데 동작만
  // 안 되는 상황을 없애는 안전망입니다.
  useEffect(() => {
    const onExpired = () => {
      setUser(null)
      setExpired(true)
      setStatus('anonymous')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [])

  useEffect(() => {
    if (status !== 'booting') return
    let cancelled = false
    apiFetch('/api/auth/me')
      .then((u) => { if (!cancelled) { setUser(u); setStatus('authenticated') } })
      .catch(() => { if (!cancelled) { clearToken(); setUser(null); setStatus('anonymous') } })
    return () => { cancelled = true }
  }, [status])

  const login = useCallback(async (email, password) => {
    const { token, user: u } = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    setToken(token)
    setUser(u)
    setExpired(false)
    setStatus('authenticated')
    return u
  }, [])

  // Step 1 of signup: ask the backend to email a 6-digit verification code.
  const requestCode = useCallback(async (email) => {
    await apiFetch('/api/auth/request-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  }, [])

  // Step 2 of signup: submit the code alongside the account details.
  const signup = useCallback(async (email, password, name, code) => {
    const { token, user: u } = await apiFetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, code }),
    })
    setToken(token)
    setUser(u)
    setExpired(false)
    setStatus('authenticated')
    return u
  }, [])

  // Step 1 of the password reset: email a 6-digit code. The backend answers 204 even
  // for an unknown address, so this resolving tells us nothing about the account.
  const forgotPassword = useCallback(async (email) => {
    await apiFetch('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  }, [])

  // Step 2: swap the password. No token comes back — the user logs in with the new one.
  const resetPassword = useCallback(async (email, code, password) => {
    await apiFetch('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, code, password }),
    })
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
    setExpired(false) // 직접 로그아웃한 경우엔 만료 안내를 띄우지 않습니다
    setStatus('anonymous')
  }, [])

  return { status, user, expired, login, signup, requestCode, forgotPassword, resetPassword, logout }
}
