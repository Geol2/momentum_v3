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

  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export const todosApi = {
  list: () => apiFetch('/api/todos'),
  create: (text, dateKey) => apiFetch('/api/todos', { method: 'POST', body: JSON.stringify({ text, dateKey }) }),
  update: (id, patch) => apiFetch(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id) => apiFetch(`/api/todos/${id}`, { method: 'DELETE' }),
}

export const notesApi = {
  list: () => apiFetch('/api/notes'),
  create: (note) => apiFetch('/api/notes', { method: 'POST', body: JSON.stringify(note) }),
  update: (id, patch) => apiFetch(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id) => apiFetch(`/api/notes/${id}`, { method: 'DELETE' }),
}

export const diariesApi = {
  list: () => apiFetch('/api/diaries'),
  upsert: (dateKey, entry) => apiFetch(`/api/diaries/${dateKey}`, { method: 'PUT', body: JSON.stringify(entry) }),
  remove: (dateKey) => apiFetch(`/api/diaries/${dateKey}`, { method: 'DELETE' }),
}

export const settingsApi = {
  get: () => apiFetch('/api/settings'),
  update: (settings) => apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
}

// Unified search across the account's diaries / todos / notes.
export const searchApi = {
  query: ({ q, from, to, types } = {}) => {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    if (types && types.length) p.set('types', types.join(','))
    return apiFetch(`/api/search?${p.toString()}`)
  },
}
