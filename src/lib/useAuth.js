import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getToken, setToken, clearToken } from './api.js'

// status: 'booting' | 'authenticated' | 'anonymous'
export function useAuth() {
  const [status, setStatus] = useState(getToken() ? 'booting' : 'anonymous')
  const [user, setUser] = useState(null)

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
    setStatus('authenticated')
    return u
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
    setStatus('anonymous')
  }, [])

  return { status, user, login, signup, requestCode, logout }
}
