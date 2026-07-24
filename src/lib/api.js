const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const TOKEN_KEY = 'byeolbit_token'

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Some in-app browsers (KakaoTalk, Instagram, …) throw on any localStorage access
// or silently refuse to persist. Reading it during React render would crash the whole
// app, so every access is wrapped and we keep an in-memory copy as a fallback — that
// at least lets the current session stay logged in even when storage is unavailable.
let memoryToken = null

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}
export function setToken(token) {
  memoryToken = token
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch { /* storage blocked — memoryToken carries the session */ }
}
export function clearToken() {
  memoryToken = null
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch { /* ignore */ }
}

export async function apiFetch(path, options = {}) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  let res
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  } catch {
    // fetch() rejects on a network-layer failure: no connectivity, DNS, TLS, a
    // CORS block, or — the case we care about here — an in-app browser (KakaoTalk,
    // etc.) refusing the cross-origin request. There is no HTTP status, so flag it
    // as 0 and let the caller show "open in a real browser" guidance.
    throw new ApiError(0, 'network')
  }

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
  create: (text, dateKey, extra = {}) => apiFetch('/api/todos', { method: 'POST', body: JSON.stringify({ text, dateKey, ...extra }) }),
  update: (id, patch) => apiFetch(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id) => apiFetch(`/api/todos/${id}`, { method: 'DELETE' }),
}

export const tracksApi = {
  list: () => apiFetch('/api/tracks'),
  create: (videoId, title) => apiFetch('/api/tracks', { method: 'POST', body: JSON.stringify({ videoId, title, ts: Date.now() }) }),
  update: (id, patch) => apiFetch(`/api/tracks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id) => apiFetch(`/api/tracks/${id}`, { method: 'DELETE' }),
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
