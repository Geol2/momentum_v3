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
import ProjectsPanel from './ProjectsPanel.jsx'
import { gradeCard, initialState, reduce, render } from './screens.js'

const PROGRESS_KEY = 'g2_card_progress'
const PROJECT_KEY = 'g2_ai_project'
// 최근 질문 확인 간격: 답을 기다리는 중이면 자주, 아니면 가끔(다른 화면에서 새로 물었는지)
const POLL_RUNNING_MS = 1500
const POLL_IDLE_MS = 3000
// 한 번에 말할 수 있는 길이. 서버 whisper가 CPU로 받아 적으므로 짧을수록 빨라요.
const MIC_MAX_SECONDS = 30
const MIC_RATE = 16000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function loadProject() {
  try { return localStorage.getItem(PROJECT_KEY) || '' } catch { return '' }
}

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
  const [data, setData] = useState(() => ({ todos: null, notes: null, progress: loadProgress(), ai: { status: 'idle', turns: 0 } }))
  const [speak, setSpeak] = useState(false)
  // Claude가 읽을 프로젝트(이 기기에서 물을 때). 바꾸면 대화가 섞이지 않게 새 대화로 시작합니다.
  const [project, setProjectState] = useState(loadProject)
  // 마지막으로 본 질문 { id, status }. undefined = 아직 한 번도 확인 안 함(앱을 막 열었음).
  const seenRef = useRef({ id: undefined, status: null })
  // 이 기기에서 질문을 보내거나 새 대화를 누르는 중이면, 그사이 받은 '최근 질문'은 무시합니다.
  const pendingRef = useRef(false)
  const speakRef = useRef(speak)
  speakRef.current = speak
  // 녹음 중인 소리 조각들
  const micRef = useRef({ chunks: [], bytes: 0, timer: null })
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
      case 'saveSteps': {
        // 같은 화면에서 저장 중/완료 표시를 보여 주고, 단계 순서대로 하나씩 만듭니다(목록 순서 유지).
        const ai = dataRef.current.ai
        if (!ai?.steps?.length || ai.todoSave === 'saving' || ai.todoSave === 'saved') break
        const setSave = (todoSave) => setData((d) => ({ ...d, ai: { ...d.ai, todoSave } }))
        setSave('saving')
        try {
          const today = todayKey()
          // 실패 후 다시 누를 때 이미 만든 단계는 건너뜁니다.
          for (let i = ai.savedSteps || 0; i < ai.steps.length; i++) {
            await todosApi.create(ai.steps[i], today)
            setData((d) => ({ ...d, ai: { ...d.ai, savedSteps: i + 1 } }))
          }
          // '오늘 할 일' 화면에 들어가면 새로 불러오도록 비워 둡니다.
          setData((d) => ({ ...d, todos: null, ai: { ...d.ai, todoSave: 'saved' } }))
        } catch (e) {
          console.error('[g2] 할 일 저장 실패', e)
          setSave('error')
        }
        break
      }
      case 'micStart': {
        const g = glassesRef.current
        if (!g?.startMic) {
          setData((d) => ({ ...d, voice: { status: 'error', error: '마이크는 안경에서만 돼요.\nPC에서는 입력칸에 써서 물어보세요.' } }))
          break
        }
        if (dataRef.current.voice?.status === 'recording') break
        const mic = micRef.current
        mic.chunks = []
        mic.bytes = 0
        try {
          await g.startMic((chunk) => {
            mic.chunks.push(chunk)
            mic.bytes += chunk.length
          })
        } catch (e) {
          setData((d) => ({ ...d, voice: { status: 'error', error: `${e.message || '마이크를 켜지 못했어요.'}\n다시 눌러 보세요.` } }))
          break
        }
        const started = Date.now()
        setData((d) => ({ ...d, voice: { status: 'recording', seconds: 0 } }))
        clearInterval(mic.timer)
        mic.timer = setInterval(() => {
          const seconds = Math.floor((Date.now() - started) / 1000)
          setData((d) => (d.voice?.status === 'recording' ? { ...d, voice: { ...d.voice, seconds } } : d))
          // 너무 길면 알아서 끝냅니다.
          if (seconds >= MIC_MAX_SECONDS) runEffectRef.current({ type: 'micStop' })
        }, 500)
        break
      }
      case 'micCancel':
      case 'micStop': {
        const mic = micRef.current
        if (dataRef.current.voice?.status !== 'recording') break
        clearInterval(mic.timer)
        await glassesRef.current?.stopMic?.().catch(() => {})
        if (fx.type === 'micCancel') {
          setData((d) => ({ ...d, voice: { status: 'idle' } }))
          break
        }
        const pcm = new Uint8Array(mic.bytes)
        let off = 0
        for (const c of mic.chunks) { pcm.set(c, off); off += c.length }
        mic.chunks = []
        setData((d) => ({ ...d, voice: { status: 'transcribing' } }))
        try {
          const { text } = await aiApi.transcribe(pcm, MIC_RATE)
          if (!text?.trim()) {
            setData((d) => ({ ...d, voice: { status: 'error', error: '잘 못 알아들었어요.\n다시 눌러서 말해 주세요.' } }))
            break
          }
          setData((d) => ({ ...d, voice: { status: 'idle' } }))
          await askClaudeRef.current(text)
        } catch (e) {
          setData((d) => ({ ...d, voice: { status: 'error', error: errorText(e) } }))
        }
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

  // 타이머·녹음 끝에서 부르기 위한 참조 (runEffect는 한 번만 만들어집니다)
  const runEffectRef = useRef(runEffect)
  runEffectRef.current = runEffect

  const handleGesture = useCallback((gesture) => {
    setLastGesture(gesture)
    const { state: next, effects } = reduce(stateRef.current, gesture, dataRef.current)
    stateRef.current = next
    setState(next)
    effects.forEach(runEffect)
  }, [runEffect])

  // 서버의 '최근 질문'을 화면 상태로 옮깁니다. 같은 답이면 할 일 저장 상태는 유지합니다.
  const applyJob = useCallback((job) => {
    setData((prev) => {
      // 새 질문이 오면 '못 알아들었어요' 같은 마이크 안내는 지웁니다(녹음 중이면 그대로).
      const d = prev.voice?.status === 'error' ? { ...prev, voice: { status: 'idle' } } : prev
      if (!job) return { ...d, ai: { status: 'idle', turns: 0 } }
      const base = {
        jobId: job.id, question: job.question, project: job.project, imageCount: job.imageCount,
        turns: job.turns, progress: job.progress || [],
      }
      if (job.status === 'running') return { ...d, ai: { ...base, status: 'loading' } }
      if (job.status === 'error') return { ...d, ai: { ...base, status: 'error', error: job.error || '답을 받지 못했어요.' } }
      const same = d.ai.jobId === job.id && d.ai.status === 'done'
      return {
        ...d,
        ai: {
          ...base, status: 'done', answer: job.answer, detail: job.detail || null, steps: job.steps || [],
          todoSave: same ? d.ai.todoSave : 'idle', savedSteps: same ? d.ai.savedSteps : 0,
        },
      }
    })
  }, [])

  // 어느 화면(이 폰, PC 브라우저 등)에서 물었든 가장 최근 질문을 따라갑니다.
  // 새 질문이 생기면 안경을 Claude 화면으로 넘기고, 답이 오면 요약 첫 쪽부터 보여 줍니다.
  const pollLatest = useCallback(async () => {
    if (pendingRef.current) return
    let job
    try {
      job = await aiApi.latestJob()
    } catch {
      return // 잠깐 끊긴 건 다음 확인 때 다시
    }
    if (pendingRef.current) return
    const seen = seenRef.current
    const first = seen.id === undefined
    const id = job?.id ?? null
    const status = job?.status ?? null
    if (!first && id === seen.id && status === seen.status && status !== 'running') return
    seenRef.current = { id, status }
    applyJob(job)
    if (first || !job) return // 앱을 막 열었을 땐 예전 답으로 화면을 뺏지 않습니다.
    if (id !== seen.id) {
      const toAsk = { screen: 'ask', page: 0, view: 'summary' }
      stateRef.current = toAsk
      setState(toAsk)
    }
    if (status === 'done' && (id !== seen.id || seen.status !== 'done')) {
      setState((s) => (s.screen === 'ask' ? { ...s, page: 0, view: 'summary' } : s))
      if (speakRef.current && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
        // 코드(전체 답)는 읽어 주면 알아듣기 어려워서 요약만 읽습니다.
        const u = new SpeechSynthesisUtterance(job.answer)
        u.lang = 'ko-KR'
        window.speechSynthesis.speak(u)
      }
    }
  }, [applyJob])

  useEffect(() => {
    if (!data.aiEnabled) return undefined
    let stop = false
    ;(async () => {
      while (!stop) {
        // 일반 브라우저 탭이 가려져 있으면 쉽니다. Even 앱은 폰 화면이 꺼져도 안경이 쓰므로 계속 봅니다.
        if (isInEvenApp() || !document.hidden) await pollLatest()
        await sleep(dataRef.current.ai.status === 'loading' ? POLL_RUNNING_MS : POLL_IDLE_MS)
      }
    })()
    return () => { stop = true }
  }, [data.aiEnabled, pollLatest])

  // 이 화면에서 입력한 질문(+사진)을 보냅니다. 답은 위의 '최근 질문 따라가기'가 받아서
  // 이 화면과 안경(그리고 열려 있는 다른 화면)에 함께 띄웁니다.
  const askClaude = useCallback(async (question, images = []) => {
    const q = question.trim()
    if (!q && !images.length) return
    const toAsk = { screen: 'ask', page: 0, view: 'summary' }
    stateRef.current = toAsk
    setState(toAsk)
    if (!getToken()) {
      setData((d) => ({ ...d, ai: { status: 'error', question: q, error: LOGIN_NEEDED } }))
      return
    }
    pendingRef.current = true
    setData((d) => ({ ...d, ai: { status: 'loading', question: q, imageCount: images.length, project, progress: [], turns: d.ai.turns } }))
    try {
      const { jobId } = await aiApi.startJob({ question: q, images, project: project || null })
      seenRef.current = { id: jobId, status: 'running' }
      setData((d) => ({ ...d, ai: { ...d.ai, jobId } }))
    } catch (e) {
      setData((d) => ({ ...d, ai: { status: 'error', question: q, error: errorText(e), turns: d.ai.turns } }))
    } finally {
      pendingRef.current = false
    }
  }, [project])

  const askClaudeRef = useRef(askClaude)
  askClaudeRef.current = askClaude

  const resetClaude = useCallback(async () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    pendingRef.current = true
    setData((d) => ({ ...d, ai: { status: 'idle', turns: 0 } }))
    try {
      await aiApi.resetConversation()
    } catch (e) {
      console.error('[g2] 새 대화 실패', e)
    } finally {
      seenRef.current = { id: null, status: null }
      pendingRef.current = false
    }
  }, [])

  const setProject = useCallback((name) => {
    setProjectState(name)
    try { if (name) localStorage.setItem(PROJECT_KEY, name); else localStorage.removeItem(PROJECT_KEY) } catch { /* 저장 불가 */ }
    resetClaude()
  }, [resetClaude])

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

  // 이 계정이 Claude를 쓸 수 있는지 서버에 묻습니다. 실패하면 꺼진 것으로 봅니다.
  useEffect(() => {
    if (auth.status !== 'authenticated') {
      setData((d) => ({ ...d, aiEnabled: false, voiceEnabled: false }))
      return
    }
    let cancelled = false
    aiApi.status()
      .then((r) => { if (!cancelled) setData((d) => ({ ...d, aiEnabled: !!r?.enabled, voiceEnabled: !!r?.voice })) })
      .catch(() => { if (!cancelled) setData((d) => ({ ...d, aiEnabled: false, voiceEnabled: false })) })
    return () => { cancelled = true }
  }, [auth.status])

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

        {data.aiEnabled && <AskBox
          ai={data.ai}
          busy={data.ai.status === 'loading'}
          turns={data.ai.turns || 0}
          onAsk={askClaude}
          onReset={resetClaude}
          speak={speak}
          onSpeakChange={setSpeak}
          onSaveSteps={() => runEffect({ type: 'saveSteps' })}
          project={project}
          onProjectChange={setProject}
        />}
      </div>
    </div>
  )
}

const MAX_PHOTOS = 6
// Claude는 긴 변이 1568px를 넘는 사진을 어차피 줄여서 봅니다. 미리 줄이면 업로드가 빠르고
// 모니터 글자도 충분히 읽힙니다.
const PHOTO_MAX_SIDE = 1568

async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  const url = canvas.toDataURL('image/jpeg', 0.85)
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), preview: url }
}

// 폰 화면의 질문 입력칸. 안경에는 키보드·카메라가 없어서 질문과 사진은 폰에서 보냅니다.
function AskBox({ ai, busy, turns, onAsk, onReset, speak, onSpeakChange, onSaveSteps, project, onProjectChange }) {
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState([])
  const [photoError, setPhotoError] = useState('')
  const cameraRef = useRef(null)
  const albumRef = useRef(null)

  const addPhotos = async (files) => {
    setPhotoError('')
    const list = [...(files || [])].filter((f) => f.type.startsWith('image/'))
    const room = MAX_PHOTOS - photos.length
    if (list.length > room) setPhotoError(`사진은 ${MAX_PHOTOS}장까지예요.`)
    try {
      const shrunk = await Promise.all(list.slice(0, Math.max(0, room)).map(shrinkPhoto))
      setPhotos((p) => [...p, ...shrunk].slice(0, MAX_PHOTOS))
    } catch (e) {
      console.error('[g2] 사진 처리 실패', e)
      setPhotoError('사진을 읽지 못했어요. 다른 사진으로 해 보세요.')
    }
  }

  const canSend = !busy && (text.trim() || photos.length)
  const submit = (e) => {
    e.preventDefault()
    if (!canSend) return
    onAsk(text, photos.map(({ mediaType, data }) => ({ mediaType, data })))
    setText('')
    setPhotos([])
  }
  return (
    <div style={{ marginTop: 20, borderTop: '1px solid #222831', paddingTop: 16 }}>
      {/* 프로젝트 패널에도 form이 있어서, 질문 form 밖에 둡니다(form 중첩 금지). */}
      <ProjectsPanel selected={project} onSelect={onProjectChange} disabled={busy} />
      <form onSubmit={submit}>
      <label htmlFor="g2-ask" style={{ display: 'block', fontSize: 14, fontWeight: 600, margin: '12px 0 8px' }}>
        Claude에게 묻기 {turns > 0 && <span style={{ color: '#9aa0aa', fontWeight: 400 }}>· 이어서 묻는 중 ({turns}번째 대화)</span>}
      </label>
      <textarea
        id="g2-ask"
        value={text}
        onChange={(e) => setText(e.target.value)}
        // 폰 키보드의 줄바꿈과 겹치지 않게, PC에서만 Ctrl/Cmd+Enter로 보냅니다.
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e) }}
        rows={3}
        placeholder={photos.length ? '예: 이 요구사항대로 고치려면? (비우면 기본 질문)'
          : project ? `예: ${project}에서 로그인 처리는 어디서 해?` : '예: JPA에서 N+1 문제 해결법?'}
        style={{
          width: '100%', boxSizing: 'border-box', background: '#12151c', color: '#e8e8ea',
          border: '1px solid #2a2f3a', borderRadius: 8, padding: 10, fontSize: 15, resize: 'vertical',
        }}
      />
      {photos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {photos.map((p, i) => (
            <div key={p.preview.slice(-32) + i} style={{ position: 'relative' }}>
              <img src={p.preview} alt={`사진 ${i + 1}`} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid #2a2f3a' }} />
              <button
                type="button"
                aria-label={`사진 ${i + 1} 빼기`}
                onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, border: 0, background: '#e8e8ea', color: '#0b0d12', fontSize: 13, cursor: 'pointer' }}
              >x</button>
            </div>
          ))}
        </div>
      )}
      {photoError && <p style={{ color: '#ffb4a8', fontSize: 13, margin: '6px 0 0' }}>{photoError}</p>}

      {/* capture가 있으면 바로 카메라, 없으면 앨범/파일 선택 */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
      <input ref={albumRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy || photos.length >= MAX_PHOTOS} style={btn}>사진 찍기</button>
        <button type="button" onClick={() => albumRef.current?.click()} disabled={busy || photos.length >= MAX_PHOTOS} style={btn}>앨범</button>
        <button type="submit" disabled={!canSend} style={{ ...btn, opacity: canSend ? 1 : 0.5 }}>
          {busy ? '생각하는 중...' : '보내기 (안경에 표시)'}
        </button>
        <button type="button" onClick={onReset} disabled={busy} style={btn}>새 대화</button>
        <label style={{ fontSize: 13, color: '#9aa0aa', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={speak} onChange={(e) => onSpeakChange(e.target.checked)} />
          폰으로 읽어 주기
        </label>
      </div>
      <p style={{ fontSize: 12, color: '#6b717c', margin: '8px 0 0' }}>
        모니터는 정면에서, 글자가 선명하게 찍어 주세요. 코드가 길면 여러 장으로 나눠 찍으면 돼요.
      </p>

      {ai.status === 'done' && (
        <section style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>답변{ai.detail ? ' (안경: 요약 · 길게 누르면 전체)' : ''}</h2>
          <pre style={answerBox}>{ai.answer}</pre>
          {ai.steps?.length > 0 && <StepsPanel ai={ai} onSave={onSaveSteps} />}
          {ai.detail && (
            <>
              <h2 style={{ fontSize: 14, margin: '12px 0 6px' }}>전체 답 / 수정 코드</h2>
              <pre style={answerBox}>{ai.detail}</pre>
            </>
          )}
        </section>
      )}
      {ai.status === 'loading' && ai.progress?.length > 0 && (
        <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 13, color: '#9aa0aa', lineHeight: 1.6 }}>
          {ai.progress.slice(-6).map((p, i) => <li key={`${i}-${p}`}>{p}</li>)}
        </ul>
      )}
      {ai.status === 'error' && <p style={{ color: '#ffb4a8', fontSize: 14, marginTop: 12 }}>{ai.error}</p>}
      </form>
    </div>
  )
}

// Claude가 정리한 작업 단계 → 오늘 할 일로 저장. 안경에서 누르기로도 저장됩니다.
function StepsPanel({ ai, onSave }) {
  const label = {
    saving: `저장 중... (${ai.savedSteps || 0}/${ai.steps.length})`,
    saved: `오늘 할 일에 ${ai.steps.length}개 저장됨`,
    error: '저장 실패 — 다시 저장',
  }[ai.todoSave] || `오늘 할 일로 저장 (${ai.steps.length}개)`
  const disabled = ai.todoSave === 'saving' || ai.todoSave === 'saved'
  return (
    <div style={{ marginTop: 12 }}>
      <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>작업 단계</h2>
      <ol style={{ margin: '0 0 8px', paddingLeft: 22, fontSize: 14, lineHeight: 1.6 }}>
        {ai.steps.map((s, i) => <li key={`${i}-${s}`}>{s}</li>)}
      </ol>
      <button type="button" onClick={onSave} disabled={disabled}
        style={{ ...btn, opacity: disabled ? 0.6 : 1, color: ai.todoSave === 'error' ? '#ffb4a8' : btn.color }}>
        {label}
      </button>
    </div>
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

const answerBox = {
  margin: 0, padding: 12, background: '#12151c', border: '1px solid #2a2f3a', borderRadius: 8,
  color: '#e8e8ea', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "D2Coding", monospace',
}

const btn = {
  background: 'rgba(77,255,122,0.08)', color: '#c8ffd6',
  border: '1px solid rgba(77,255,122,0.35)', borderRadius: 8,
  padding: '8px 12px', fontSize: 14, cursor: 'pointer',
}
