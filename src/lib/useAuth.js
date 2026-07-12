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

  const signup = useCallback(async (email, password, name) => {
    const { token, user: u } = await apiFetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
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

  return { status, user, login, signup, logout }
}
