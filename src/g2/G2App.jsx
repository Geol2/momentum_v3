// G2 안경용 화면의 진입 컴포넌트.
//  - 일반 브라우저: 576×288 미리보기 + 키보드/버튼으로 제스처 흉내
//  - Even 앱 WebView: 같은 화면을 SDK로 안경에 보내고, 안경 제스처를 받습니다.
//    (이때 폰 화면에는 이 미리보기가 그대로 보입니다)
import { useCallback, useEffect, useRef, useState } from 'react'
import Login from '../components/Login.jsx'
import { aiApi, ApiError, getToken, notesApi, todosApi } from '../lib/api.js'
import { dateKey } from '../lib/data.js'
import { useAuth } from '../lib/useAuth.js'
import { connectGlasses, isInEvenApp } from './bridge.js'
import Preview from './Preview.jsx'
import { gradeCard, initialState, reduce, render } from './screens.js'

const PROGRESS_KEY = 'g2_card_progress'

// 카드 진도는 이 기기에만 저장합니다(서버 API가 아직 없음).
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {} } catch { return {} }
}
function saveProgress(p) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)) } catch { /* 저장 불가 — 이번 세션만 유지 */ }
}

function todayKey() {
  const d = new Date()
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate())
}

const LOGIN_NEEDED = '로그인이 필요해요.\n폰 화면에서 로그인하세요.'

function errorText(e) {
  if (e instanceof ApiError && e.status === 401) return LOGIN_NEEDED
  // 400/429/503 등은 서버가 사용자에게 보여줄 문장을 message로 보냅니다(예: 오늘 질문 횟수 초과).
  if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.message && e.message !== 'network') return e.message
  if (e instanceof ApiError && e.status === 503) return e.message || 'AI 기능이 꺼져 있어요.'
  // 0: 네트워크 오류, 5xx: 개발 중 백엔드(9090)가 꺼져 있으면 Vite 프록시가 5xx를 돌려줍니다.
  if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) return '서버에 연결할 수 없어요.'
  return '불러오지 못했어요.'
}

// 키보드 → 제스처 (미리보기용)
const KEYS = {
  Enter: 'tap', ' ': 'tap',
  Backspace: 'double', Escape: 'double', d: 'double',
  ArrowUp: 'up', ArrowDown: 'down',
  l: 'long',
}

const BUTTONS = [
  ['up', '위로 쓸기 ↑'],
  ['tap', '누르기 (Enter)'],
  ['double', '두 번 (Esc)'],
  ['down', '아래로 쓸기 ↓'],
]

export default function G2App() {
  const auth = useAuth()
  const [state, setState] = useState(initialState)
  const [data, setData] = useState(() => ({ todos: null, notes: null, progress: loadProgress(), ai: { status: 'idle' } }))
  // Claude 대화 기록 (이어서 묻기). 앱을 닫으면 사라집니다.
  const historyRef = useRef([])
  const [speak, setSpeak] = useState(false)
  const [glasses, setGlasses] = useState(null)
  const [lastGesture, setLastGesture] = useState('')

  // 안경 이벤트 콜백은 한 번만 등록하므로 최신 상태를 ref로 읽습니다.
  const stateRef = useRef(state)
  const dataRef = useRef(data)
  const glassesRef = useRef(null)
  stateRef.current = state
  dataRef.current = data
  glassesRef.current = glasses

  const userName = auth.user?.name || ''
  const page = render(state, { ...data, userName })

  const runEffect = useCallback(async (fx) => {
    switch (fx.type) {
      case 'loadTodos': {
        if (!getToken()) { setData((d) => ({ ...d, todosError: LOGIN_NEEDED })); break }
        setData((d) => ({ ...d, todos: null, todosError: null }))
        try {
          const all = await todosApi.list()
          const today = todayKey()
          const todos = (all || []).filter((t) => t.dateKey === today)
          setData((d) => ({ ...d, todos }))
        } catch (e) {
          setData((d) => ({ ...d, todosError: errorText(e) }))
        }
        break
      }
      case 'toggleTodo': {
        // 먼저 화면에 반영하고, 실패하면 되돌립니다.
        const flip = (done) => setData((d) => ({
          ...d, todos: d.todos?.map((t) => (t.id === fx.id ? { ...t, done } : t)),
        }))
        flip(fx.done)
        try { await todosApi.update(fx.id, { done: fx.done }) } catch (e) {
          console.error('[g2] 할 일 저장 실패', e)
          flip(!fx.done)
        }
        break
      }
      case 'loadNotes': {
        if (!getToken()) { setData((d) => ({ ...d, notesError: LOGIN_NEEDED })); break }
        setData((d) => ({ ...d, notes: null, notesError: null }))
        try {
          const all = (await notesApi.list()) || []
          const today = todayKey()
          const visible = all.filter((n) => n.pinned || n.dateKey === today)
          const notes = (visible.length ? visible : all)
            .slice()
            .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
          setData((d) => ({ ...d, notes }))
        } catch (e) {
          setData((d) => ({ ...d, notesError: errorText(e) }))
        }
        break
      }
      case 'grade': {
        setData((d) => {
          const progress = { ...d.progress, [fx.cardId]: gradeCard(d.progress[fx.cardId], fx.known) }
          saveProgress(progress)
          return { ...d, progress }
        })
        break
      }
      case 'exit': {
        // 브라우저 미리보기에는 닫을 안경 화면이 없으므로 아무것도 하지 않습니다.
        await glassesRef.current?.close()
        break
      }
      default:
        console.warn('[g2] 모르는 effect', fx)
    }
  }, [])

  const handleGesture = useCallback((gesture) => {
    setLastGesture(gesture)
    const { state: next, effects } = reduce(stateRef.current, gesture, dataRef.current)
    stateRef.current = next
    setState(next)
    effects.forEach(runEffect)
  }, [runEffect])

  // 폰 화면에서 입력한 질문을 보내고, 답을 안경의 'Claude' 화면에 띄웁니다.
  const askClaude = useCallback(async (question) => {
    const q = question.trim()
    if (!q) return
    const toAsk = { screen: 'ask', page: 0 }
    stateRef.current = toAsk
    setState(toAsk)
    if (!getToken()) {
      setData((d) => ({ ...d, ai: { status: 'error', question: q, error: LOGIN_NEEDED } }))
      return
    }
    setData((d) => ({ ...d, ai: { status: 'loading', question: q } }))
    try {
      const { answer } = await aiApi.ask(q, historyRef.current)
      historyRef.current = [...historyRef.current, { role: 'user', text: q }, { role: 'assistant', text: answer }]
      setData((d) => ({ ...d, ai: { status: 'done', question: q, answer } }))
      // 새 답은 항상 첫 쪽부터
      setState((s) => (s.screen === 'ask' ? { ...s, page: 0 } : s))
      if (speak && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(answer)
        u.lang = 'ko-KR'
        window.speechSynthesis.speak(u)
      }
    } catch (e) {
      setData((d) => ({ ...d, ai: { status: 'error', question: q, error: errorText(e) } }))
    }
  }, [speak])

  const resetClaude = useCallback(() => {
    historyRef.current = []
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    setData((d) => ({ ...d, ai: { status: 'idle' } }))
  }, [])

  // 키보드
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const g = KEYS[e.key]
      if (!g) return
      e.preventDefault()
      handleGesture(g)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleGesture])

  // 안경 연결 (Even 앱 안에서만)
  useEffect(() => {
    let off = null
    let cancelled = false
    connectGlasses()
      .then((g) => {
        if (!g || cancelled) return
        off = g.onGesture(handleGesture)
        setGlasses(g)
      })
      .catch((e) => console.error('[g2] 안경 연결 실패', e))
    return () => { cancelled = true; off?.() }
  }, [handleGesture])

  // 화면이 바뀔 때마다 안경으로 전송 (같은 내용이면 bridge가 건너뜀)
  useEffect(() => {
    glasses?.show(page)
  }, [glasses, page])

  // 로그인 상태가 바뀌면 열려 있는 화면의 데이터를 다시 불러옵니다.
  useEffect(() => {
    if (auth.status !== 'authenticated') return
    if (stateRef.current.screen === 'todos') runEffect({ type: 'loadTodos' })
    if (stateRef.current.screen === 'memo') runEffect({ type: 'loadNotes' })
  }, [auth.status, runEffect])

  const [showLogin, setShowLogin] = useState(false)
  if (showLogin && auth.status === 'anonymous') {
    return (
      <div>
        <button type="button" onClick={() => setShowLogin(false)} style={{ ...btn, margin: 16 }}>← G2 화면으로</button>
        <Login
          onLogin={auth.login}
          onSignup={auth.signup}
          onRequestCode={auth.requestCode}
          onForgotPassword={auth.forgotPassword}
          onResetPassword={auth.resetPassword}
          expired={auth.expired}
        />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0b0d12', color: '#e8e8ea', padding: '24px 16px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>G2 화면 미리보기</h1>
        <p style={{ fontSize: 13, color: '#9aa0aa', margin: '0 0 16px' }}>
          {isInEvenApp()
            ? (glasses ? '안경에 연결됨 — 안경에서 조작하세요.' : '안경에 연결하는 중...')
            : '브라우저 미리보기 — 글꼴·줄 간격은 근사치예요.'}
          {' '}
          {auth.status === 'authenticated'
            ? `${userName || '로그인됨'}`
            : auth.status === 'anonymous' && (
              <button type="button" onClick={() => setShowLogin(true)} style={{ ...btn, padding: '2px 8px' }}>로그인</button>
            )}
        </p>

        <ScaledPreview page={page} />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          {BUTTONS.map(([g, label]) => (
            <button key={g} type="button" onClick={() => handleGesture(g)} style={btn}>{label}</button>
          ))}
        </div>
        <p style={{ fontSize: 12, color: '#6b717c', marginTop: 12 }}>
          키보드: ↑/↓ 쓸기 · Enter 누르기 · Esc 두 번 누르기 · L 길게 누르기
          {lastGesture && ` · 마지막 입력: ${lastGesture}`}
        </p>

        <AskBox
          busy={data.ai.status === 'loading'}
          turns={historyRef.current.length / 2}
          onAsk={askClaude}
          onReset={resetClaude}
          speak={speak}
          onSpeakChange={setSpeak}
        />
      </div>
    </div>
  )
}

// 폰 화면의 질문 입력칸. 안경에는 키보드가 없어서 질문은 폰에서 칩니다.
function AskBox({ busy, turns, onAsk, onReset, speak, onSpeakChange }) {
  const [text, setText] = useState('')
  const submit = (e) => {
    e.preventDefault()
    if (busy || !text.trim()) return
    onAsk(text)
    setText('')
  }
  return (
    <form onSubmit={submit} style={{ marginTop: 20, borderTop: '1px solid #222831', paddingTop: 16 }}>
      <label htmlFor="g2-ask" style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
        Claude에게 묻기 {turns > 0 && <span style={{ color: '#9aa0aa', fontWeight: 400 }}>· 이어서 묻는 중 ({turns}번째 대화)</span>}
      </label>
      <textarea
        id="g2-ask"
        value={text}
        onChange={(e) => setText(e.target.value)}
        // 폰 키보드의 줄바꿈과 겹치지 않게, PC에서만 Ctrl/Cmd+Enter로 보냅니다.
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e) }}
        rows={3}
        placeholder="예: JPA에서 N+1 문제 해결법?"
        style={{
          width: '100%', boxSizing: 'border-box', background: '#12151c', color: '#e8e8ea',
          border: '1px solid #2a2f3a', borderRadius: 8, padding: 10, fontSize: 15, resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button type="submit" disabled={busy || !text.trim()} style={{ ...btn, opacity: busy || !text.trim() ? 0.5 : 1 }}>
          {busy ? '생각하는 중...' : '보내기 (안경에 표시)'}
        </button>
        <button type="button" onClick={onReset} disabled={busy} style={btn}>새 대화</button>
        <label style={{ fontSize: 13, color: '#9aa0aa', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={speak} onChange={(e) => onSpeakChange(e.target.checked)} />
          폰으로 읽어 주기
        </label>
      </div>
    </form>
  )
}

// 화면 폭이 576px보다 좁으면(폰) 비율을 유지한 채 줄입니다.
function ScaledPreview({ page }) {
  const ref = useRef(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / 576)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return <div ref={ref} style={{ width: '100%' }}><Preview page={page} scale={scale} /></div>
}

const btn = {
  background: 'rgba(77,255,122,0.08)', color: '#c8ffd6',
  border: '1px solid rgba(77,255,122,0.35)', borderRadius: 8,
  padding: '8px 12px', fontSize: 14, cursor: 'pointer',
}
