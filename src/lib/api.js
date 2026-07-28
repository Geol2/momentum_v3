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

// 세션이 만료되면 이 이벤트가 발생합니다. useAuth가 듣고 로그인 화면으로 되돌립니다.
// 콜백을 주고받는 대신 이벤트를 쓰는 이유는, api.js가 인증 상태를 몰라도 되게 하려는 것.
export const AUTH_EXPIRED_EVENT = 'byeolbit:auth-expired'

// 로그인·회원가입처럼 "아직 토큰이 없는 게 정상"인 경로. 여기서 나온 401은
// 세션 만료가 아니라 비밀번호 오류이므로 로그아웃 이벤트를 쏘면 안 됩니다.
const PUBLIC_PATHS = ['/api/auth/login', '/api/auth/signup', '/api/auth/request-code']

export async function apiFetch(path, options = {}) {
  const token = getToken()
  // FormData를 보낼 때는 Content-Type을 건드리면 안 됩니다. 브라우저가 boundary가
  // 포함된 multipart/form-data를 직접 붙여야 하는데, 여기서 덮어쓰면 boundary가
  // 빠져서 서버가 본문을 파싱하지 못합니다.
  const isForm = options.body instanceof FormData
  const headers = {
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
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

  // 슬라이딩 만료: 백엔드가 수명이 절반 이하로 남은 토큰을 갱신해 이 헤더로 돌려줍니다.
  // 앱을 쓰고 있는 동안에는 세션이 끊기지 않습니다.
  const renewed = res.headers.get('X-Renewed-Token')
  if (renewed) setToken(renewed)

  if (!res.ok) {
    // 401 = 토큰이 없거나 만료됨. 예전에는 그냥 에러로 던져서, 화면은 로그인 상태인데
    // 모든 동작이 조용히 실패하는 상태가 됐습니다. 이제는 세션을 정리하고 알립니다.
    if (res.status === 401 && !PUBLIC_PATHS.includes(path)) {
      clearToken()
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
    }

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

// Web Push subscriptions — one row per browser, used for 할 일 시간 알림.
export const pushApi = {
  publicKey: () => apiFetch('/api/push/public-key'),
  subscribe: (sub) => apiFetch('/api/push/subscriptions', { method: 'POST', body: JSON.stringify(sub) }),
  unsubscribe: (endpoint) => apiFetch(`/api/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`, { method: 'DELETE' }),
  test: () => apiFetch('/api/push/test', { method: 'POST' }),
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
