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
const PUBLIC_PATHS = [
  '/api/auth/login', '/api/auth/signup', '/api/auth/request-code',
  '/api/auth/forgot-password', '/api/auth/reset-password',
]

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

// 큰 파일 업로드용. fetch는 올라간 정도를 알 수 없어서 XMLHttpRequest로 진행률을 받습니다.
// 토큰·토큰 갱신·401 처리는 apiFetch와 같습니다. onProgress(0~1)는 '보낸 양'이고, 1이 된 뒤에는
// 서버가 처리(예: zip 풀기)하는 중입니다.
export function apiUpload(path, form, { onProgress, timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}${path}`)
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.timeout = timeoutMs
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    xhr.onerror = () => reject(new ApiError(0, 'network'))
    xhr.ontimeout = () => reject(new ApiError(0, '시간이 너무 오래 걸려요. 더 작게 압축해서 다시 올려 주세요.'))
    xhr.onload = () => {
      const renewed = xhr.getResponseHeader('X-Renewed-Token')
      if (renewed) setToken(renewed)
      let body = null
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null } catch { /* JSON 아님 */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body)
      if (xhr.status === 401) {
        clearToken()
        window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
      }
      reject(new ApiError(xhr.status, body?.message || null))
    }
    xhr.send(form)
  })
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

// 습관 트래커 — 정의(habits)와 날짜별 체크(logs)를 나눠 둡니다. 정의는 몇 개뿐이라
// 통째로 받고, 체크 기록은 날짜가 갈수록 끝없이 늘어나므로 화면에 보이는 달만 받습니다.
// today를 함께 보내는 이유: dateKey가 브라우저 로컬 날짜라, 서버가 자기 시간대로 "오늘"을
// 판단하면 연속일이 하루 틀어집니다.
export const habitsApi = {
  list: (today) => apiFetch(`/api/habits${today ? `?today=${today}` : ''}`),
  create: (habit) => apiFetch('/api/habits', { method: 'POST', body: JSON.stringify(habit) }),
  update: (id, patch) => apiFetch(`/api/habits/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id) => apiFetch(`/api/habits/${id}`, { method: 'DELETE' }),

  logs: (from, to) => apiFetch(`/api/habits/logs?from=${from}&to=${to}`),
  // 토글 POST가 아니라 PUT/DELETE인 이유: 네트워크 재시도가 겹쳐도 체크 상태가 뒤집히지 않습니다.
  check: (id, dateKey, today) => apiFetch(`/api/habits/${id}/logs/${dateKey}?today=${today}`, { method: 'PUT' }),
  uncheck: (id, dateKey, today) => apiFetch(`/api/habits/${id}/logs/${dateKey}?today=${today}`, { method: 'DELETE' }),
}

export const settingsApi = {
  get: () => apiFetch('/api/settings'),
  update: (settings) => apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
}

// Web Push subscriptions — one row per browser, used for 할 일 시간 알림.
// 우주 탐험: 지구 근접 소행성(NASA JPL 자료를 서버가 받아 6시간 캐시)
export const spaceApi = {
  neo: () => apiFetch('/api/space/neo'),
}

export const pushApi = {
  publicKey: () => apiFetch('/api/push/public-key'),
  subscribe: (sub) => apiFetch('/api/push/subscriptions', { method: 'POST', body: JSON.stringify(sub) }),
  unsubscribe: (endpoint) => apiFetch(`/api/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`, { method: 'DELETE' }),
  test: () => apiFetch('/api/push/test', { method: 'POST' }),
}

// G2 안경 "Claude에게 묻기". Claude API 키는 백엔드에만 있고, 여기서는 우리 서버만 부릅니다.
// history: [{ role: 'user' | 'assistant', text }] — 이어서 묻기용 이전 대화
// images: [{ mediaType: 'image/jpeg', data: base64 }] — 폐쇄망 PC 화면을 폰으로 찍은 사진
// 응답: { answer: 안경용 요약, detail: 폰용 전체 답(코드 등) 또는 null, steps: 할 일로 저장할 작업 단계[] }
export const aiApi = {
  // 허용된 계정만 true. 스토어에서 받은 다른 사용자에게는 메뉴 자체를 숨깁니다.
  status: () => apiFetch('/api/ai/status'),
  ask: (question, history = [], images = []) => apiFetch('/api/ai/ask', { method: 'POST', body: JSON.stringify({ question, history, images }) }),
  // 프로젝트를 읽으며 답하면 1~3분 걸리기도 해서(Cloudflare 100초 제한) 백그라운드로 돌리고 물어봅니다.
  // conversationId: 이어 갈 대화(없으면 project로 새 대화를 만듦). 응답: { jobId, conversationId }
  startJob: ({ question, images = [], project = null, conversationId = null }) =>
    apiFetch('/api/ai/jobs', { method: 'POST', body: JSON.stringify({ question, images, project, conversationId }) }),
  // { status: 'running' | 'done' | 'error', progress: ['읽기: src/App.jsx', ...], answer, detail, steps, error }
  job: (id) => apiFetch(`/api/ai/jobs/${encodeURIComponent(id)}`),
  // 어느 화면(폰·PC)에서 물었든 가장 최근 질문. 없으면 null. 안경 앱이 이걸 따라갑니다.
  latestJob: () => apiFetch('/api/ai/jobs/latest'),
  // 새 대화 — 모든 화면 공통
  resetConversation: () => apiFetch('/api/ai/conversation/reset', { method: 'POST' }),
  // 안경 마이크 음성(PCM 16bit 모노) → 텍스트. 서버의 whisper가 받아 적습니다. { text }
  transcribe: (pcm, rate = 16000) => {
    const form = new FormData()
    form.append('audio', new Blob([pcm], { type: 'application/octet-stream' }), 'audio.pcm')
    form.append('rate', String(rate))
    return apiFetch('/api/ai/transcribe', { method: 'POST', body: form })
  },
}

// Claude 대화 — 프로젝트마다 여러 개, 서버(DB)에 저장. 어느 화면에서 이어 물어도 같은 대화.
export const aiConversationsApi = {
  // [{ id, project, title, createdAt, updatedAt }] 최근 대화가 먼저
  list: () => apiFetch('/api/ai/conversations'),
  create: (project) => apiFetch('/api/ai/conversations', { method: 'POST', body: JSON.stringify({ project: project || null }) }),
  // { conversation, turns: [{ id, question, imageCount, answer, detail, steps, createdAt }] }
  get: (id) => apiFetch(`/api/ai/conversations/${id}`),
  rename: (id, title) => apiFetch(`/api/ai/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  // 밖에서 가져온 대화: { externalId, title, turns: [{ question, answer, at }] } → { conversation, added }
  importChat: (c) => apiFetch('/api/ai/conversations/import', { method: 'POST', body: JSON.stringify(c) }),
  remove: (id) => apiFetch(`/api/ai/conversations/${id}`, { method: 'DELETE' }),
}

// Claude가 읽을 프로젝트 — GitHub 저장소(서버가 클론) 또는 zip 업로드(출장 등)
export const aiProjectsApi = {
  list: () => apiFetch('/api/ai/projects'),
  // { privateRepos }: 서버에 GitHub 토큰이 있어 비공개 저장소도 받을 수 있는지
  settings: () => apiFetch('/api/ai/projects/settings'),
  addGit: (url, name) => apiFetch('/api/ai/projects/git', { method: 'POST', body: JSON.stringify({ url, name: name || null }) }),
  sync: (name) => apiFetch(`/api/ai/projects/${encodeURIComponent(name)}/sync`, { method: 'POST' }),
  // onProgress(0~1): 올라간 정도. 큰 zip은 몇 분 걸릴 수 있어 진행률을 보여 줍니다.
  upload: (name, file, onProgress) => {
    const form = new FormData()
    form.append('name', name)
    form.append('file', file)
    return apiUpload('/api/ai/projects/upload', form, { onProgress })
  },
  remove: (name) => apiFetch(`/api/ai/projects/${encodeURIComponent(name)}`, { method: 'DELETE' }),
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
