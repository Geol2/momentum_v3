import { useEffect, useRef, useState } from 'react'
import { searchApi } from '../lib/api.js'

// Unified account search — one spotlight over diaries · todos · notes, filterable by
// keyword and/or a date range. Clicking a hit jumps to that record.
//   • diary → opens the diary modal for that date
//   • todo  → jumps the todo panel to that day
//   • note  → just closes (sticky notes live on the board)

const TYPES = [
  { k: '', label: '전체' },
  { k: 'diary', label: '일기' },
  { k: 'todo', label: '할일' },
  { k: 'note', label: '메모' },
]

const TYPE_META = {
  diary: { label: '일기', icon: '📖', color: '#b98fff' },
  todo: { label: '할일', icon: '✓', color: '#7fd0ff' },
  note: { label: '메모', icon: '🗒', color: '#ffd76a' },
}

function infoFromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return { year: y, month: m - 1, day: d }
}

function prettyDate(iso) {
  if (!iso) return '날짜 없음'
  const [y, m, d] = iso.split('-')
  return `${y}.${m}.${d}`
}

export default function Search({ onOpenDiary, onJumpToDate }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [type, setType] = useState('')
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const inputRef = useRef(null)

  // focus the field when the panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40)
  }, [open])

  // close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // debounced search whenever a filter changes
  useEffect(() => {
    if (!open) return
    const hasQuery = q.trim() || from || to
    if (!hasQuery) { setResults([]); setStatus('idle'); return }
    setStatus('loading')
    let cancelled = false
    const id = setTimeout(() => {
      searchApi.query({ q: q.trim(), from, to, types: type ? [type] : [] })
        .then((r) => { if (!cancelled) { setResults(r || []); setStatus('done') } })
        .catch((e) => { if (!cancelled) { console.error('search failed', e); setStatus('error') } })
    }, 280)
    return () => { cancelled = true; clearTimeout(id) }
  }, [open, q, from, to, type])

  const pick = (hit) => {
    if (hit.type === 'diary') {
      const info = hit.date ? infoFromISO(hit.date) : infoFromISO(hit.ref)
      onOpenDiary(hit.ref, info)
    } else if (hit.type === 'todo' && hit.date) {
      onJumpToDate(hit.date)
    }
    setOpen(false)
  }

  const btn = {
    width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.4)',
    border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(16px)', color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
  }

  return (
    <>
      {/* launcher — sits to the left of the settings gear */}
      <button
        onClick={() => setOpen(true)}
        title="통합 검색"
        style={{ ...btn, position: 'fixed', bottom: 24, right: 84, zIndex: 100 }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'flex-start', paddingTop: '9vh',
            background: 'rgba(5,7,16,0.55)', backdropFilter: 'blur(6px)', fontFamily: "'Noto Sans KR', sans-serif",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="thin-scroll"
            style={{
              width: 'min(92vw, 580px)', maxHeight: '78vh', display: 'flex', flexDirection: 'column',
              background: 'rgba(10,13,26,0.82)', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 18,
              boxShadow: '0 24px 70px rgba(0,0,0,0.55)', overflow: 'hidden',
              animation: 'itemIn 0.22s cubic-bezier(0.16,1,0.3,1) both',
            }}
          >
            {/* search field */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="기록 검색 — 일기·할일·메모에서 찾기"
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  color: 'rgba(255,255,255,0.92)', fontSize: 15, fontFamily: 'inherit', fontWeight: 300,
                }}
              />
              <kbd style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, padding: '2px 6px' }}>ESC</kbd>
            </div>

            {/* filters: type chips + date range */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '11px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 9, padding: 3 }}>
                {TYPES.map((t) => {
                  const active = type === t.k
                  return (
                    <button
                      key={t.k || 'all'}
                      onClick={() => setType(t.k)}
                      style={{
                        padding: '5px 11px', borderRadius: 7, border: 'none', fontSize: 12, cursor: 'pointer',
                        fontFamily: 'inherit', transition: 'all 0.15s',
                        background: active ? 'rgba(99,179,237,0.28)' : 'transparent',
                        color: active ? 'rgba(185,222,255,0.98)' : 'rgba(255,255,255,0.45)',
                        fontWeight: active ? 600 : 400,
                      }}
                    >{t.label}</button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={dateInput} />
                <span>~</span>
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={dateInput} />
                {(from || to) && (
                  <button onClick={() => { setFrom(''); setTo('') }} title="기간 지우기"
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 14, padding: 2 }}>✕</button>
                )}
              </div>
            </div>

            {/* results */}
            <div className="thin-scroll" style={{ overflowY: 'auto', padding: '6px 8px', minHeight: 90 }}>
              {status === 'idle' && (
                <Empty text="검색어를 입력하거나 기간을 선택하세요." />
              )}
              {status === 'loading' && <Empty text="검색 중…" />}
              {status === 'error' && <Empty text="검색에 실패했어요. 잠시 후 다시 시도해 주세요." />}
              {status === 'done' && results.length === 0 && <Empty text="일치하는 기록이 없어요." />}
              {status === 'done' && results.map((hit, i) => {
                const meta = TYPE_META[hit.type] || { label: hit.type, icon: '•', color: '#9fb6ff' }
                const clickable = hit.type === 'diary' || (hit.type === 'todo' && hit.date)
                return (
                  <button
                    key={i}
                    onClick={() => pick(hit)}
                    style={{
                      width: '100%', textAlign: 'left', display: 'flex', gap: 12, alignItems: 'flex-start',
                      padding: '11px 12px', borderRadius: 11, border: 'none', background: 'transparent',
                      cursor: clickable ? 'pointer' : 'default', fontFamily: 'inherit', transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{
                      flexShrink: 0, width: 44, textAlign: 'center', fontSize: 11, fontWeight: 600, lineHeight: 1.3,
                      color: meta.color, marginTop: 1,
                    }}>
                      <span style={{ fontSize: 15 }}>{meta.icon}</span><br />{meta.label}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.9)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hit.title}</span>
                        <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 11.5, color: 'rgba(160,185,255,0.7)', fontFamily: 'Outfit, sans-serif' }}>{prettyDate(hit.date)}</span>
                      </span>
                      {hit.snippet && (
                        <span style={{ display: 'block', marginTop: 3, fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 300, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.snippet}</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const dateInput = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
  padding: '5px 8px', fontSize: 11.5, color: 'rgba(255,255,255,0.82)', fontFamily: 'inherit', colorScheme: 'dark',
}

function Empty({ text }) {
  return (
    <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{text}</div>
  )
}
