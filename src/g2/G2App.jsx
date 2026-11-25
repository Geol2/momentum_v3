// G2 안경용 화면의 진입 컴포넌트.
//  - 일반 브라우저: 576×288 미리보기 + 키보드/버튼으로 제스처 흉내
//  - Even 앱 WebView: 같은 화면을 SDK로 안경에 보내고, 안경 제스처를 받습니다.
//    (이때 폰 화면에는 이 미리보기가 그대로 보입니다)
import { useCallback, useEffect, useRef, useState } from 'react'
import Login from '../components/Login.jsx'
import { aiApi, aiConversationsApi, ApiError, getToken, notesApi, todosApi } from '../lib/api.js'
import { dateKey } from '../lib/dates.js'
import { useAuth } from '../lib/useAuth.js'
import { connectGlasses, isInEvenApp } from './bridge.js'
import Preview from './Preview.jsx'
import Workspace from './Workspace.jsx'
import ApiKey from '../components/ApiKey.jsx'
import { gradeCard, initialState, reduce, render } from './screens.js'

const PROGRESS_KEY = 'g2_card_progress'
const PROJECT_KEY = 'g2_ai_project' // 예전 버전: 고른 프로젝트 이름만
const CONV_KEY = 'g2_ai_conv'       // 지금 대화 { id, project }
// 최근 질문 확인 간격: 답을 기다리는 중이면 자주, 아니면 가끔(다른 화면에서 새로 물었는지)
const POLL_RUNNING_MS = 1500
const POLL_IDLE_MS = 3000
// 통역: 조용할 때 소리(잡음) 크기를 계속 재서, 그보다 충분히 크면 말하는 중으로 봄.
// 고정값 하나로는 안경 마이크에 멀리서 들어오는 상대 목소리를 놓쳐요.
const INTERP_RMS_MIN = 120 // 아무리 조용해도 이보다는 커야 말로 봄
const INTERP_RMS_RATIO = 2.5 // 잡음의 몇 배면 말로 볼지
function rms16(bytes) {
  const n = Math.floor(bytes.length / 2)
  if (!n) return 0
  const v = new DataView(bytes.buffer, bytes.byteOffset, n * 2)
  let sum = 0
  for (let i = 0; i < n; i++) { const x = v.getInt16(i * 2, true); sum += x * x }
  return Math.sqrt(sum / n)
}
// 한 번에 말할 수 있는 길이. 서버 whisper가 CPU로 받아 적으므로 짧을수록 빨라요.
const MIC_MAX_SECONDS = 30
const MIC_RATE = 16000

// 깨우기(wake)로 일찍 끝낼 수 있는 대기 — 질문을 보내면 다음 확인을 기다리지 않고 바로 봅니다.
function wakeableSleep(ms, wakeRef) {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms)
    function done() { clearTimeout(t); wakeRef.current = null; resolve() }
    wakeRef.current = done
  })
}

// 지금 대화. id가 null이면 '질문 전인 새 대화'(첫 질문 때 서버가 만듭니다).
function loadConv() {
  try {
    const c = JSON.parse(localStorage.getItem(CONV_KEY))
    if (c && typeof c.project === 'string') return { id: Number.isInteger(c.id) ? c.id : null, project: c.project }
    return { id: null, project: localStorage.getItem(PROJECT_KEY) || '' }
  } catch {
    return { id: null, project: '' }
  }
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
  // 메시지 없는 503은 대개 서버가 재시작 중(빌드·배포)일 때 터널이 돌려준 것
  if (e instanceof ApiError && e.status === 503) return e.message || '서버가 잠깐 응답하지 않아요(503). 빌드 중이면 끝난 뒤 다시 해 보세요.'
  // 0: 네트워크 오류, 5xx: 개발 중 백엔드(9090)가 꺼져 있으면 Vite 프록시가 5xx를 돌려줍니다.
  if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) return '서버에 연결할 수 없어요.'
  if (e instanceof ApiError && e.status === 404) return '서버에 이 기능이 아직 없어요(404). 백엔드를 새로 빌드해 주세요.'
  if (e instanceof ApiError) return `불러오지 못했어요(${e.status}).`
  return '불러오지 못했어요.'
}

// 키보드 → 제스처 (미리보기용)
const KEYS = {
  Enter: 'tap', ' ': 'tap',
  Backspace: 'double', Escape: 'double', d: 'double',
  ArrowUp: 'up', ArrowDown: 'down',
  l: 'long',
}

// [제스처, 짧은 이름, 풀어 쓴 설명(마우스 올리면 보임)]
const BUTTONS = [
  ['up', '↑', '위로 쓸기 (↑)'],
  ['tap', '누르기', '누르기 (Enter)'],
  ['double', '두 번', '두 번 누르기 (Esc)'],
  ['down', '↓', '아래로 쓸기 (↓)'],
]

export default function G2App() {
  const auth = useAuth()
  const [state, setState] = useState(initialState)
  const [data, setData] = useState(() => ({ todos: null, notes: null, progress: loadProgress(), ai: { status: 'idle', turns: 0 } }))
  const [speak, setSpeak] = useState(false)
  // 지금 대화 { id, project }. 왼쪽 목록에서 고르거나, 다른 화면에서 새로 물으면 그쪽을 따라갑니다.
  const [conv, setConvState] = useState(loadConv)
  const convRef = useRef(conv)
  convRef.current = conv
  const setConv = useCallback((c) => {
    convRef.current = c
    setConvState(c)
    try { localStorage.setItem(CONV_KEY, JSON.stringify(c)) } catch { /* 저장 불가 */ }
  }, [])
  // 질문이 시작·끝날 때마다 늘려서, 대화 목록·내역을 다시 불러오게 합니다.
  const [aiVersion, setAiVersion] = useState(0)
  const bump = useCallback(() => setAiVersion((v) => v + 1), [])
  // 마지막으로 본 질문 { id, status }. undefined = 아직 한 번도 확인 안 함(앱을 막 열었음).
  const seenRef = useRef({ id: undefined, status: null })
  // 이 기기에서 질문을 보내거나 새 대화를 누르는 중이면, 그사이 받은 '최근 질문'은 무시합니다.
  const pendingRef = useRef(false)
  const wakeRef = useRef(null)
  const speakRef = useRef(speak)
  speakRef.current = speak
  // 녹음 중인 소리 조각들
  const interpRef = useRef({ on: false })
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
      case 'pinNav': {
        // '안경에 띄우기'로 연 대화에서 이전/다음 답으로 넘기기
        showPinRef.current?.(fx.dir)
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
      // ── 통역: 안경 마이크를 켠 채로 말이 끊기는 곳(조용 0.7초 또는 8초)마다 잘라 보내 한국어로 받음 ──
      case 'interpStart': {
        const g = glassesRef.current
        if (!g?.startMic) {
          setData((d) => ({ ...d, interp: { status: 'error', error: '통역은 안경 마이크에서만 돼요.\nEven 앱에서 열어 주세요.' } }))
          break
        }
        const it = interpRef.current
        if (it.on) break
        Object.assign(it, { on: true, seg: [], segMs: 0, silence: 0, speaking: false, pre: [], queue: [], sending: false, floor: 0, peak: 0, lastLevelAt: 0 })
        setData((d) => ({ ...d, interp: { status: 'starting', lines: d.interp?.lines || [], suggestion: null } }))
        const send = async () => {
          if (it.sending || !it.queue.length) return
          it.sending = true
          setData((d) => ({ ...d, interp: { ...d.interp, busy: true } }))
          const pcm = it.queue.shift()
          try {
            const r = await aiApi.interpretChunk(pcm, MIC_RATE)
            if (r?.original) {
              setData((d) => ({ ...d, interp: { ...d.interp, lastError: null, lines: [...(d.interp?.lines || []), r].slice(-20), suggestion: null } }))
            } else {
              setData((d) => ({ ...d, interp: { ...d.interp, lastError: null, missed: (d.interp?.missed || 0) + 1 } }))
            }
          } catch (e) {
            setData((d) => ({ ...d, interp: { ...d.interp, lastError: errorText(e) } }))
          } finally {
            it.sending = false
            setData((d) => ({ ...d, interp: { ...d.interp, busy: it.queue.length > 0 } }))
            if (it.queue.length) send()
          }
        }
        const flush = () => {
          if (it.segMs >= 600) {
            const total = it.seg.reduce((n, c) => n + c.length, 0)
            const pcm = new Uint8Array(total)
            let off = 0
            for (const c of it.seg) { pcm.set(c, off); off += c.length }
            it.queue.push(pcm)
            if (it.queue.length > 3) it.queue.shift() // 밀리면 오래된 조각은 버림(지금 말이 더 중요)
            send()
          }
          it.seg = []; it.segMs = 0; it.silence = 0; it.speaking = false
        }
        try {
          await g.startMic((chunk) => {
            if (!it.on) return
            const ms = (chunk.length / 2 / MIC_RATE) * 1000
            const level = rms16(chunk)
            const limit = Math.max(INTERP_RMS_MIN, it.floor * INTERP_RMS_RATIO)
            const loud = it.floor > 0 && level > limit
            // 말 안 할 때만 잡음 크기를 천천히 따라감(처음 값은 바로 씀)
            if (!loud) it.floor = it.floor ? it.floor * 0.95 + level * 0.05 : level
            // 안경 화면은 1초에 한 번만 갱신(소리 크기 표시)
            it.peak = Math.max(it.peak, level)
            const now = Date.now()
            if (now - it.lastLevelAt >= 1000) {
              const meter = Math.min(5, Math.round((it.peak / limit) * 2))
              it.lastLevelAt = now; it.peak = 0
              setData((d) => (d.interp?.meter === meter ? d : { ...d, interp: { ...d.interp, meter } }))
            }
            if (loud) { it.silence = 0; if (!it.speaking) { it.speaking = true; it.seg = [...it.pre]; it.segMs = it.pre.length * ms } }
            else it.silence += ms
            if (it.speaking) { it.seg.push(chunk); it.segMs += ms }
            else { it.pre.push(chunk); if (it.pre.length > 3) it.pre.shift() } // 말 시작 직전 0.3초도 붙임
            if (it.speaking && (it.silence >= 700 || it.segMs >= 8000)) flush()
          })
        } catch (e) {
          it.on = false
          setData((d) => ({ ...d, interp: { status: 'error', error: `${e.message || '마이크를 켜지 못했어요.'}\n다시 들어와 보세요.` } }))
          break
        }
        setData((d) => ({ ...d, interp: { ...d.interp, status: 'listening' } }))
        break
      }
      case 'interpSuggest': {
        const lines = dataRef.current.interp?.lines || []
        if (!lines.length) {
          setData((d) => ({ ...d, interp: { ...d.interp, suggestion: { english: '아직 들은 말이 없어요.', korean: '' } } }))
          break
        }
        setData((d) => ({ ...d, interp: { ...d.interp, suggesting: true } }))
        try {
          const r = await aiApi.interpretSuggest(lines.slice(-8))
          setData((d) => ({ ...d, interp: { ...d.interp, suggesting: false, suggestion: r } }))
        } catch (e) {
          setData((d) => ({ ...d, interp: { ...d.interp, suggesting: false, suggestion: { english: errorText(e), korean: '' } } }))
        }
        break
      }
      case 'interpStop': {
        const it = interpRef.current
        if (!it.on) break
        it.on = false
        it.queue = []
        await glassesRef.current?.stopMic?.().catch(() => {})
        setData((d) => ({ ...d, interp: { ...d.interp, status: 'idle', busy: false } }))
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
        jobId: job.id, conversationId: job.conversationId ?? null, question: job.question, project: job.project,
        imageCount: job.imageCount, turns: job.turns, progress: job.progress || [],
        pinNav: job.pinNav || null, // 고른 대화에서 몇 번째 답인지 { idx, total }
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
  const pinSeenRef = useRef(undefined) // 마지막으로 띄운 '안경에 띄우기' 답
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
      // 다른 화면에서 새로 물었으면 이 화면도 그 대화로 따라갑니다.
      if (job.conversationId != null) setConv({ id: job.conversationId, project: job.project || '' })
      bump()
    }
    if (status !== 'running' && (id !== seen.id || seen.status !== status)) bump()
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
  }, [applyJob, setConv, bump])

  // 폰·PC에서 '안경에 띄우기'로 고른 대화를 따라갑니다(켰을 때만 서버에 남아 있음).
  // 안경에서 맨 위/맨 아래 쪽에서 더 쓸면 그 대화의 이전/다음 답으로 넘어가요(오래된 답도 볼 수 있게).
  const pinRef = useRef(null) // { key, conversationId, project, turns, idx, jobAtPin }
  const showPinRef = useRef(null)
  const showPin = useCallback((dir = 0, toScreen = true) => {
    const P = pinRef.current
    if (!P || !P.turns.length) return
    P.idx = Math.max(0, Math.min(P.turns.length - 1, P.idx + dir))
    const t = P.turns[P.idx]
    applyJob({
      id: `pin:${t.id}`, status: 'done', conversationId: P.conversationId, project: P.project,
      question: t.question, answer: t.answer, detail: t.detail, steps: t.steps, imageCount: t.imageCount,
      turns: P.turns.length, pinNav: { idx: P.idx, total: P.turns.length },
    })
    if (toScreen) {
      // 이전 답으로 갈 땐 그 답의 첫 쪽부터
      const toAsk = { screen: 'ask', page: 0, view: 'summary' }
      stateRef.current = toAsk
      setState(toAsk)
    }
    bump()
  }, [applyJob, bump])
  showPinRef.current = showPin

  const pollPin = useCallback(async () => {
    let pin
    try { pin = await aiConversationsApi.glassesPin() } catch { return }
    // 같은 답을 다시 알려 줘도(30초마다) 화면을 다시 뺏지 않도록 시각은 빼고 비교합니다.
    const key = pin ? `${pin.conversationId}:${pin.turnId}` : null
    if (!pin) { pinRef.current = null; pinSeenRef.current = null; return }
    if (key !== pinSeenRef.current) {
      pinSeenRef.current = key
      try {
        const d = await aiConversationsApi.get(pin.conversationId)
        const turns = d?.turns || []
        if (!turns.length) return
        const at = turns.findIndex((x) => x.id === pin.turnId)
        pinRef.current = { key, conversationId: pin.conversationId, project: d.conversation?.project || '', turns, idx: at >= 0 ? at : turns.length - 1, jobAtPin: seenRef.current.id }
        showPin(0, true)
      } catch { pinSeenRef.current = undefined }
      return
    }
    // 고른 대화에 새 답이 붙었으면(PC Claude Code에서 이어 물은 답 등) 보고 있던 답과 상관없이 최신 답으로 넘어갑니다.
    // 대화 내역은 너무 자주 받지 않도록 8초에 한 번만 확인.
    const P = pinRef.current
    if (P && Date.now() - (P.checkedAt || 0) > 8000) {
      P.checkedAt = Date.now()
      try {
        const d = await aiConversationsApi.get(P.conversationId)
        const turns = d?.turns || []
        if (pinRef.current === P && turns.length > P.turns.length) {
          P.turns = turns
          P.idx = turns.length - 1
          P.jobAtPin = seenRef.current.id
          showPin(0, true)
          return
        }
      } catch { /* 다음 차례에 */ }
    }
    // 같은 고른 답인데 안경 내용이 다른 걸로 바뀌어 있으면(앱을 막 열었을 때 등) 다시 띄움.
    // 단, 그사이 새로 질문했으면 새 질문이 우선입니다.
    if (P && !String(dataRef.current.ai?.jobId || '').startsWith('pin:') && seenRef.current.id === P.jobAtPin) showPin(0, false)
  }, [showPin])

  // 안경에 띄운 답·최근 질문 확인: 로그인했으면 키가 없어도(커넥터로 저장한 대화를 안경에 띄울 수 있게)
  const loggedIn = auth.status === 'authenticated'
  const beatRef = useRef(0)
  useEffect(() => {
    if (!loggedIn) return undefined
    let stop = false
    ;(async () => {
      while (!stop) {
        // 일반 브라우저 탭이 가려져 있으면 쉽니다. Even 앱은 폰 화면이 꺼져도 안경이 쓰므로 계속 봅니다.
        // 최근 질문을 먼저 보고, 그다음 '안경에 띄우기'로 고른 답을 봅니다.
        // (반대 순서면 앱을 연 직후 최근 질문이 고른 답을 덮어써서 안경에 안 떴어요)
        if (isInEvenApp() || !document.hidden) { await pollLatest(); await pollPin() }
        // 안경 앱이 켜져 있다고 서버에 알림(웹은 이걸 보고 오른쪽 안경 화면을 보여 줌)
        if (isInEvenApp() && Date.now() - beatRef.current > 10000) {
          beatRef.current = Date.now()
          aiConversationsApi.glassesHeartbeat().catch(() => {})
        }
        await wakeableSleep(dataRef.current.ai.status === 'loading' ? POLL_RUNNING_MS : POLL_IDLE_MS, wakeRef)
      }
    })()
    return () => { stop = true }
  }, [loggedIn, pollLatest, pollPin])

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
    const { id: conversationId, project } = convRef.current
    pendingRef.current = true
    setData((d) => ({ ...d, ai: { status: 'loading', conversationId, question: q, imageCount: images.length, project, progress: [], turns: d.ai.turns } }))
    try {
      const res = await aiApi.startJob({ question: q, images, project: project || null, conversationId })
      seenRef.current = { id: res.jobId, status: 'running' }
      // 새 대화의 첫 질문이면 서버가 만든 대화 id를 받습니다.
      if (res.conversationId != null && res.conversationId !== conversationId) setConv({ id: res.conversationId, project })
      setData((d) => ({ ...d, ai: { ...d.ai, jobId: res.jobId, conversationId: res.conversationId ?? conversationId } }))
      bump()
    } catch (e) {
      setData((d) => ({ ...d, ai: { status: 'error', conversationId, question: q, error: errorText(e), turns: d.ai.turns } }))
    } finally {
      pendingRef.current = false
      wakeRef.current?.() // 다음 확인을 기다리지 않고 바로 진행 상황을 봅니다
    }
  }, [setConv, bump])

  const askClaudeRef = useRef(askClaude)
  askClaudeRef.current = askClaude

  // 새 대화(질문 전): 안경의 최근 질문 표시도 비웁니다. project: 이 대화가 읽을 프로젝트('' = 일반)
  const newChat = useCallback(async (project) => {
    setConv({ id: null, project: project || '' })
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
  }, [setConv])

  // 목록에서 예전 대화를 고르면 거기서 이어 묻습니다.
  const selectConversation = useCallback((c) => {
    setConv({ id: c.id, project: c.project || '' })
  }, [setConv])

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
  // statusTick: 내 API 키를 등록·삭제하면 다시 묻기
  const [statusTick, setStatusTick] = useState(0)
  const [keyOpen, setKeyOpen] = useState(false)
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
  }, [auth.status, statusTick])

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
        <button type="button" onClick={() => setShowLogin(false)} style={{ ...btn, ...btnBox, margin: 16 }}>← G2 화면으로</button>
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

  const statusLine = (
    <>
      {isInEvenApp()
        ? (glasses ? '안경에 연결됨' : '안경에 연결하는 중...')
        : '브라우저 미리보기 — 글꼴·줄 간격은 근사치예요.'}
      {' '}
      {auth.status === 'authenticated'
        ? `· ${userName || '로그인됨'}`
        : auth.status === 'anonymous' && (
          <button type="button" onClick={() => setShowLogin(true)} style={{ ...btn, ...btnBox, padding: '2px 8px' }}>로그인</button>
        )}
    </>
  )

  const glassesPane = (
    <>
      <ScaledPreview page={page} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 10, border: '1px solid rgba(77,255,122,0.3)', borderRadius: 10, overflow: 'hidden' }}>
        {BUTTONS.map(([g, label, full], n) => (
          <button key={g} type="button" onClick={() => handleGesture(g)} title={full} aria-label={full}
            style={{ ...btn, borderLeft: n ? '1px solid rgba(77,255,122,0.2)' : 0 }}>{label}</button>
        ))}
      </div>
      <p style={{ fontSize: 11.5, color: '#8c939e', marginTop: 8, lineHeight: 1.5 }}>
        키보드: ↑/↓ 쓸기 · Enter 누르기 · Esc 두 번 누르기 · L 길게 누르기
        {lastGesture && ` · 마지막 입력: ${lastGesture}`}
      </p>
    </>
  )

  // Claude를 쓸 수 있는 계정: 클로드 데스크톱 같은 작업 공간(프로젝트·대화 목록 / 대화 / 안경 화면)
  // 로그인했으면 작업 공간을 보여 줌. Claude에게 묻기는 서버 주인이거나 내 API 키를 등록했을 때만 답이 와요
  // (대화 목록·안경 띄우기·PC 중계·커넥터로 저장한 대화 보기는 키 없이도 됨).
  if (auth.status === 'authenticated') {
    return (
      <Workspace
        conv={conv}
        onSelectConversation={selectConversation}
        onNewChat={newChat}
        version={aiVersion}
        ai={data.ai}
        onAsk={askClaude}
        speak={speak}
        onSpeakChange={setSpeak}
        glassesPane={glassesPane}
        status={statusLine}
        user={auth.user}
        onLogout={auth.logout}
      />
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0b0d12', color: '#e8e8ea', padding: '24px 16px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>G2 화면 미리보기</h1>
        <p style={{ fontSize: 13, color: '#9aa0aa', margin: '0 0 16px' }}>{statusLine}</p>
        {auth.status === 'authenticated' && (
          <div style={{ margin: '0 0 16px', padding: '12px 14px', border: '1px solid rgba(77,255,122,0.3)', borderRadius: 10, background: 'rgba(77,255,122,0.05)', fontSize: 13, lineHeight: 1.6 }}>
            Claude에게 물어보려면 <b>내 Anthropic API 키</b>를 등록하세요. 사용료는 그 키 계정으로 청구돼요.
            <div><button type="button" onClick={() => setKeyOpen(true)} style={{ ...btn, ...btnBox, marginTop: 8 }}>API 키 등록</button></div>
          </div>
        )}
        {keyOpen && <ApiKey onClose={() => setKeyOpen(false)} onSaved={() => setStatusTick((n) => n + 1)} />}
        {glassesPane}
      </div>
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

const btn = {
  background: 'rgba(77,255,122,0.06)', color: '#c8ffd6',
  border: 0, borderRadius: 0,
  padding: '9px 4px', fontSize: 13, cursor: 'pointer',
}
// 단독 버튼용 테두리(제스처 버튼 줄은 테두리 없이 이어 붙임)
const btnBox = { border: '1px solid rgba(77,255,122,0.35)', borderRadius: 8, padding: '8px 12px' }
