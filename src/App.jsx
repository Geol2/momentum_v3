import { useEffect, useMemo, useState } from 'react'
import StarField from './components/StarField.jsx'
import Clock from './components/Clock.jsx'
import Calendar from './components/Calendar.jsx'
import WeatherQuote from './components/WeatherQuote.jsx'
import TodoSection from './components/TodoSection.jsx'
import MemoSection from './components/MemoSection.jsx'
import StickyNotes from './components/StickyNotes.jsx'
import DiaryModal from './components/DiaryModal.jsx'
import Settings from './components/Settings.jsx'
import Login from './components/Login.jsx'
import { useLocalStorage } from './lib/useLocalStorage.js'
import { useAuth } from './lib/useAuth.js'
import { DAYS_KR, QUOTES, greetingFor, weatherIcon } from './lib/data.js'

const DEFAULT_SETTINGS = {
  userName: '', use24h: true, showSeconds: true, tempUnit: 'C', showQuote: true, background: 'mountain',
}

export default function App() {
  const auth = useAuth()

  // Live clock — re-render every second.
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Persisted state.
  const [settings, setSettings] = useLocalStorage('byeolbit_settings', DEFAULT_SETTINGS)
  const [todos, setTodos] = useLocalStorage('byeolbit_todos', [])
  const [notes, setNotes] = useLocalStorage('byeolbit_notes', [])
  const [diaries, setDiaries] = useLocalStorage('byeolbit_diaries', {})

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
  const saveDiary = (entry) => {
    setDiaries((prev) => ({ ...prev, [diaryKey]: entry }))
    setDiaryOpen(false)
  }
  const deleteDiary = () => {
    setDiaries((prev) => {
      const copy = { ...prev }
      delete copy[diaryKey]
      return copy
    })
    setDiaryOpen(false)
  }

  // Todo handlers.
  const addTodo = (text) => setTodos((t) => [...t, { id: Date.now(), text, done: false }])
  const toggleTodo = (id) => setTodos((t) => t.map((x) => (x.id === id ? { ...x, done: !x.done } : x)))
  const removeTodo = (id) => setTodos((t) => t.filter((x) => x.id !== id))

  // Sticky-note handlers.
  const addNote = (text) => {
    const x = 60 + Math.random() * 120
    const y = 140 + Math.random() * 160
    const rot = (Math.random() - 0.5) * 8
    setNotes((n) => [...n, { id: Date.now(), text, ts: Date.now(), x, y, rot }])
  }
  const moveNote = (id, x, y) => setNotes((n) => n.map((m) => (m.id === id ? { ...m, x, y } : m)))
  const removeNote = (id) => setNotes((n) => n.filter((m) => m.id !== id))

  const greeting = greetingFor(now.getHours(), settings.userName)
  const dateStr = useMemo(
    () => `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${DAYS_KR[now.getDay()]}요일`,
    [now.getFullYear(), now.getMonth(), now.getDate()],
  )

  if (auth.status === 'booting') {
    return <StarField background={settings.background} />
  }
  if (auth.status === 'anonymous') {
    return <Login onLogin={auth.login} onSignup={auth.signup} />
  }

  return (
    <>
      <StarField background={settings.background} />

      <Calendar now={now} diaries={diaries} onOpenDiary={openDiary} />

      <WeatherQuote
        quote={quote}
        showQuote={settings.showQuote}
        onNewQuote={newQuote}
        weather={weather}
        tempUnit={settings.tempUnit}
      />

      <StickyNotes notes={notes} onMove={moveNote} onRemove={removeNote} />

      {/* Main column */}
      <div style={{
        position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: '80px 24px 110px', fontFamily: "'Noto Sans KR', sans-serif",
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
          <TodoSection todos={todos} onAdd={addTodo} onToggle={toggleTodo} onRemove={removeTodo} />
          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '22px 0' }} />
          <MemoSection count={notes.length} onAdd={addNote} />
        </div>
      </div>

      <Settings settings={settings} onChange={setSettings} user={auth.user} onLogout={auth.logout} />

      {/* Copyright */}
      <div style={{
        position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 90,
        fontFamily: 'Outfit, sans-serif', fontSize: 11, fontWeight: 300, letterSpacing: '0.08em',
        color: 'rgba(255,255,255,0.32)', textShadow: '0 1px 6px rgba(0,0,0,0.5)', userSelect: 'none', whiteSpace: 'nowrap',
      }}>© 2026 Geol2</div>

      <DiaryModal
        open={diaryOpen}
        dateInfo={diaryInfo}
        entry={diaryKey ? diaries[diaryKey] : null}
        onSave={saveDiary}
        onDelete={deleteDiary}
        onClose={() => setDiaryOpen(false)}
      />
    </>
  )
}
