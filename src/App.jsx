import { useEffect, useMemo, useRef, useState } from 'react'
import StarField from './components/StarField.jsx'
import Clock from './components/Clock.jsx'
import Calendar from './components/Calendar.jsx'
import WeatherQuote from './components/WeatherQuote.jsx'
import TodoSection from './components/TodoSection.jsx'
import MemoSection from './components/MemoSection.jsx'
import StickyNotes from './components/StickyNotes.jsx'
import DiaryModal from './components/DiaryModal.jsx'
import Settings from './components/Settings.jsx'
import Search from './components/Search.jsx'
import Notice from './components/Notice.jsx'
import MusicPlayer from './components/MusicPlayer.jsx'
import Login from './components/Login.jsx'
import HiddenGame from './game/HiddenGame.jsx'
import { useAuth } from './lib/useAuth.js'
import { useIsMobile } from './lib/useIsMobile.js'
import { todosApi, notesApi, diariesApi, settingsApi, tracksApi } from './lib/api.js'
import { DAYS_KR, QUOTES, greetingFor, weatherIcon, dateKey } from './lib/data.js'

const DEFAULT_SETTINGS = {
  userName: '', use24h: true, showSeconds: true, tempUnit: 'C', showQuote: true, background: 'mountain',
}

export default function App() {
  const auth = useAuth()
  const isMobile = useIsMobile()

  // Live clock — re-render every second.
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // All persisted state lives in the backend, scoped per account.
  const [settings, setSettingsLocal] = useState(DEFAULT_SETTINGS)
  const [diaries, setDiaries] = useState({})
  const [todos, setTodos] = useState([])
  const [notes, setNotes] = useState([])
  const [tracks, setTracks] = useState([])

  // Which day the todo panel is showing. null = follow "today" live; a dateKey = a day the user picked on the calendar.
  const [selectedDateKey, setSelectedDateKey] = useState(null)
  const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate())
  const activeDateKey = selectedDateKey || todayKey
  const visibleTodos = useMemo(
    () => todos.filter((t) => t.dateKey === activeDateKey),
    [todos, activeDateKey],
  )
  // A note shows if it's pinned (every day), legacy (no dateKey), or belongs to the active day.
  const visibleNotes = useMemo(
    () => notes.filter((n) => n.pinned || !n.dateKey || n.dateKey === activeDateKey),
    [notes, activeDateKey],
  )
  const isViewingToday = activeDateKey === todayKey
  const todoLabel = isViewingToday
    ? '오늘 할 일'
    : `${parseInt(activeDateKey.slice(5, 7), 10)}월 ${parseInt(activeDateKey.slice(8, 10), 10)}일 할 일`
  useEffect(() => {
    if (auth.status !== 'authenticated') {
      if (auth.status === 'anonymous') {
        setSettingsLocal(DEFAULT_SETTINGS); setDiaries({}); setTodos([]); setNotes([]); setTracks([])
      }
      return
    }
    let cancelled = false
    Promise.all([settingsApi.get(), diariesApi.list(), todosApi.list(), notesApi.list(), tracksApi.list()])
      .then(([s, d, t, n, tr]) => {
        if (cancelled) return
        setSettingsLocal(s)
        setDiaries(Object.fromEntries(d.map((e) => [e.dateKey, { title: e.title, body: e.body, mood: e.mood }])))
        setTodos(t)
        setNotes(n)
        setTracks(tr)
      }).catch((e) => console.error('failed to load account data', e))
    return () => { cancelled = true }
  }, [auth.status])

  // Settings writes are debounced — the name field fires onChange per keystroke,
  // and we don't want a PUT /api/settings for every character typed.
  const settingsSaveTimer = useRef(null)
  const setSettings = (next) => {
    setSettingsLocal(next)
    clearTimeout(settingsSaveTimer.current)
    settingsSaveTimer.current = setTimeout(() => {
      settingsApi.update(next).catch((e) => console.error('failed to save settings', e))
    }, 500)
  }

  // Quote (random on mount).
  const [quote, setQuote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)])
  const newQuote = () => {
    let q
    do { q = QUOTES[Math.floor(Math.random() * QUOTES.length)] } while (QUOTES.length > 1 && q === quote)
    setQuote(q)
  }

  // Weather from wttr.in.
  const [weather, setWeather] = useState({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('https://wttr.in/Seoul?format=j1')
        const d = await r.json()
        const cc = d.current_condition[0]
        if (cancelled) return
        setWeather({
          status: 'ok',
          icon: weatherIcon(cc.weatherCode),
          tempC: parseFloat(cc.temp_C),
          feelsC: parseFloat(cc.FeelsLikeC),
          humidity: cc.humidity + '%',
          desc: cc.lang_ko?.[0]?.value || cc.weatherDesc[0].value,
        })
      } catch {
        if (!cancelled) setWeather({ status: 'failed' })
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Diary modal state.
  const [diaryOpen, setDiaryOpen] = useState(false)
  const [diaryKey, setDiaryKey] = useState(null)
  const [diaryInfo, setDiaryInfo] = useState(null)

  const openDiary = (key, info) => {
    setDiaryKey(key)
    setDiaryInfo(info)
    setDiaryOpen(true)
  }
  const saveDiary = async (entry) => {
    const saved = await diariesApi.upsert(diaryKey, entry)
    setDiaries((prev) => ({ ...prev, [diaryKey]: { title: saved.title, body: saved.body, mood: saved.mood } }))
    setDiaryOpen(false)
  }
  const deleteDiary = async () => {
    await diariesApi.remove(diaryKey)
    setDiaries((prev) => {
      const copy = { ...prev }
      delete copy[diaryKey]
      return copy
    })
    setDiaryOpen(false)
  }

  // Todo handlers — each mutates the backend, then syncs local state from the response.
  const addTodo = async (text, opts = {}) => {
    const created = await todosApi.create(text, activeDateKey, {
      timeLabel: opts.timeLabel || null,
      place: opts.place || null,
    })
    setTodos((t) => [...t, created])
  }
  const toggleTodo = async (id) => {
    const target = todos.find((t) => t.id === id)
    if (!target) return
    const updated = await todosApi.update(id, { done: !target.done })
    setTodos((t) => t.map((x) => (x.id === id ? updated : x)))
  }
  const removeTodo = async (id) => {
    setTodos((t) => t.filter((x) => x.id !== id))
    await todosApi.remove(id)
  }
  // patch may contain any of: text, timeLabel, place. Empty string clears a field on the backend.
  const editTodo = (id, patch) => {
    setTodos((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    todosApi.update(id, patch).catch((e) => console.error('failed to save todo', e))
  }

  // Sticky-note handlers.
  const addNote = async (text) => {
    const x = 60 + Math.random() * 120
    const y = 140 + Math.random() * 160
    const rot = (Math.random() - 0.5) * 8
    const created = await notesApi.create({ text, x, y, rot, dateKey: activeDateKey, ts: Date.now() })
    setNotes((n) => [...n, created])
  }
  const togglePin = (id) => {
    const target = notes.find((m) => m.id === id)
    if (!target) return
    const pinned = !target.pinned
    setNotes((n) => n.map((m) => (m.id === id ? { ...m, pinned } : m)))
    notesApi.update(id, { pinned }).catch((e) => console.error('failed to toggle note pin', e))
  }
  // Live drag position — local only, no network call per mousemove.
  const moveNote = (id, x, y) => setNotes((n) => n.map((m) => (m.id === id ? { ...m, x, y } : m)))
  // Fired once at drag end to persist the final position.
  const persistNotePosition = (id, x, y) => {
    notesApi.update(id, { x, y }).catch((e) => console.error('failed to save note position', e))
  }
  // Live resize — local only, no network call per mousemove.
  const resizeNote = (id, width, height) => setNotes((n) => n.map((m) => (m.id === id ? { ...m, width, height } : m)))
  // Fired once at resize end to persist the final size.
  const persistNoteSize = (id, width, height) => {
    notesApi.update(id, { width, height }).catch((e) => console.error('failed to save note size', e))
  }
  const removeNote = (id) => {
    setNotes((n) => n.filter((m) => m.id !== id))
    notesApi.remove(id).catch((e) => console.error('failed to delete note', e))
  }
  const editNote = (id, text) => {
    setNotes((n) => n.map((m) => (m.id === id ? { ...m, text } : m)))
    notesApi.update(id, { text }).catch((e) => console.error('failed to save note text', e))
  }

  // Music playlist handlers.
  const addTrack = async (videoId, title) => {
    const created = await tracksApi.create(videoId, title)
    setTracks((t) => [...t, created])
  }
  const removeTrack = (id) => {
    setTracks((t) => t.filter((x) => x.id !== id))
    tracksApi.remove(id).catch((e) => console.error('failed to delete track', e))
  }

  const greeting = greetingFor(now.getHours(), settings.userName)
  const dateStr = useMemo(
    () => `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${DAYS_KR[now.getDay()]}요일`,
    [now.getFullYear(), now.getMonth(), now.getDate()],
  )

  if (auth.status === 'booting') {
    return <StarField background={settings.background} />
  }
  if (auth.status === 'anonymous') {
    return <Login onLogin={auth.login} onSignup={auth.signup} onRequestCode={auth.requestCode} />
  }

  return (
    <>
      <StarField background={settings.background} />

      {/* Desktop: floating fixed widgets. Mobile: they drop into the column below. */}
      {!isMobile && (
        <Calendar
          now={now}
          diaries={diaries}
          todos={todos}
          selectedDateKey={selectedDateKey}
          onSelectDate={setSelectedDateKey}
          onOpenDiary={openDiary}
        />
      )}

      {!isMobile && (
        <WeatherQuote
          quote={quote}
          showQuote={settings.showQuote}
          onNewQuote={newQuote}
          weather={weather}
          tempUnit={settings.tempUnit}
        />
      )}

      {/* Draggable notes only make sense on a pointer device — skip on mobile. */}
      {!isMobile && (
        <StickyNotes notes={visibleNotes} onMove={moveNote} onMoveEnd={persistNotePosition} onResize={resizeNote} onResizeEnd={persistNoteSize} onRemove={removeNote} onEdit={editNote} onTogglePin={togglePin} />
      )}

      {/* Main column */}
      <div style={{
        position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: isMobile ? 'flex-start' : 'center',
        padding: isMobile ? '58px 16px 96px' : '80px 24px 110px', fontFamily: "'Noto Sans KR', sans-serif",
      }}>
        <div style={{
          fontSize: 'clamp(14px, 1.6vw, 19px)', fontWeight: 300, color: 'rgba(255,255,255,0.62)',
          letterSpacing: '0.08em', marginBottom: 14, textShadow: '0 1px 10px rgba(0,0,0,0.55)',
          animation: 'fadeUp 0.8s cubic-bezier(0.16,1,0.3,1) 0s both',
        }}>{greeting}</div>

        <Clock now={now} use24h={settings.use24h} showSeconds={settings.showSeconds} />

        <div style={{
          fontFamily: 'Outfit, sans-serif', fontSize: 'clamp(14px, 1.8vw, 24px)', fontWeight: 300,
          color: 'rgba(255,255,255,0.45)', letterSpacing: '0.06em', marginTop: 20, textShadow: '0 1px 10px rgba(0,0,0,0.5)',
          animation: 'fadeUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.14s both',
        }}>{dateStr}</div>

        <div style={{ width: 1, height: 50, background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.15) 50%, transparent)', margin: '38px 0' }} />

        <div style={{ width: '100%', maxWidth: 520, animation: 'fadeUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.26s both' }}>
          <TodoSection
            todos={visibleTodos}
            label={todoLabel}
            isToday={isViewingToday}
            onAdd={addTodo}
            onToggle={toggleTodo}
            onRemove={removeTodo}
            onEdit={editTodo}
            onResetToToday={() => setSelectedDateKey(null)}
          />
          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '22px 0' }} />
          <MemoSection
            notes={visibleNotes}
            onAdd={addNote}
            onRemove={removeNote}
            onEdit={editNote}
            onTogglePin={togglePin}
          />
        </div>

        {/* Mobile: calendar + weather stacked below the main content instead of
            floating in the corners. */}
        {isMobile && (
          <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, marginTop: 40 }}>
            <Calendar
              now={now}
              diaries={diaries}
              todos={todos}
              selectedDateKey={selectedDateKey}
              onSelectDate={setSelectedDateKey}
              onOpenDiary={openDiary}
              mobile
            />
            <WeatherQuote
              quote={quote}
              showQuote={settings.showQuote}
              onNewQuote={newQuote}
              weather={weather}
              tempUnit={settings.tempUnit}
              mobile
            />
          </div>
        )}
      </div>

      <Settings settings={settings} onChange={setSettings} user={auth.user} onLogout={auth.logout} />

      {/* unified account search across diaries · todos · notes */}
      <Search onOpenDiary={openDiary} onJumpToDate={(k) => setSelectedDateKey(k)} />

      {/* Copyright */}
      {/* On mobile the notice pill and the gear/search buttons already fill the bottom
          strip, so sit above them instead of underneath. */}
      <div style={{
        position: 'fixed', bottom: isMobile ? 76 : 16, left: '50%', transform: 'translateX(-50%)', zIndex: 90,
        maxWidth: '100vw', padding: '0 12px',
        fontFamily: 'Outfit, sans-serif', fontSize: 11, fontWeight: 300, letterSpacing: '0.08em',
        color: 'rgba(255,255,255,0.32)', textShadow: '0 1px 6px rgba(0,0,0,0.5)', userSelect: 'none', whiteSpace: 'nowrap',
      }}>© 2026 Geol2 · big9401@gmail.com</div>

      <Notice />

      {!isMobile && <MusicPlayer tracks={tracks} onAdd={addTrack} onRemove={removeTrack} />}

      <DiaryModal
        open={diaryOpen}
        dateInfo={diaryInfo}
        entry={diaryKey ? diaries[diaryKey] : null}
        onSave={saveDiary}
        onDelete={deleteDiary}
        onClose={() => setDiaryOpen(false)}
      />

      {/* 우측 하단 구석을 3초 안에 5번 클릭하면 숨겨진 3D RPG가 열린다 🌙 */}
      <HiddenGame />
    </>
  )
}
