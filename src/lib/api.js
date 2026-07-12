const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const TOKEN_KEY = 'byeolbit_token'

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function apiFetch(path, options = {}) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })

  if (!res.ok) {
    let message = null
    try {
      const body = await res.json()
      message = body?.message || null
    } catch {
      /* empty or non-JSON body — ignore */
    }
    throw new ApiError(res.status, message)
  }

  if (res.status === 204) return null
  return res.json()
}
