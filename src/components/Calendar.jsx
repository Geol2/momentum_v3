import { useState } from 'react'
import { DAYS_KR, dateKey } from '../lib/data.js'

function buildCells(year, month) {
  const first = new Date(year, month, 1).getDay()
  const count = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < first; i++) cells.push(null)
  for (let d = 1; d <= count; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export default function Calendar({ now, diaries, onOpenDiary }) {
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selected, setSelected] = useState(null)

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()
  const todayD = now.getDate()
  const cells = buildCells(year, month)

  const prev = () => {
    let m = month - 1, y = year
    if (m < 0) { m = 11; y-- }
    setMonth(m); setYear(y); setSelected(null)
  }
  const next = () => {
    let m = month + 1, y = year
    if (m > 11) { m = 0; y++ }
    setMonth(m); setYear(y); setSelected(null)
  }

  const cellStyle = (d) => {
    const base = {
      width: 23, height: 23, display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: '50%', fontSize: 10.5, fontFamily: 'Outfit, sans-serif', cursor: 'pointer',
      color: 'rgba(255,255,255,0.72)', transition: 'all 0.15s',
    }
    if (isCurrentMonth && d === todayD) return { ...base, background: 'rgba(99,179,237,0.9)', color: '#fff', fontWeight: 500 }
    if (d === selected) return { ...base, background: 'rgba(255,255,255,0.12)' }
    return base
  }

  const navBtn = {
    width: 24, height: 24, borderRadius: 7, border: 'none', background: 'transparent',
    color: 'rgba(255,255,255,0.45)', fontSize: 17, lineHeight: 1, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  const selKey = selected != null ? dateKey(year, month, selected) : null
  const selEntry = selKey ? diaries[selKey] : null

  return (
    <div style={{
      position: 'fixed', top: 24, left: 26, zIndex: 100, width: 196,
      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16,
      padding: '12px 14px', backdropFilter: 'blur(20px)', fontFamily: 'Outfit, sans-serif',
      animation: 'fadeUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.55s both',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
        <button onClick={prev} style={navBtn}>‹</button>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', letterSpacing: '0.03em', fontFamily: "'Noto Sans KR', sans-serif" }}>
          {year}년 {month + 1}월
        </div>
        <button onClick={next} style={navBtn}>›</button>
      </div>

      {/* Weekday row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 6 }}>
        {DAYS_KR.map((d, i) => (
          <div key={d} style={{
            textAlign: 'center', fontSize: 9.5,
            color: i === 0 ? 'rgba(255,130,130,0.65)' : i === 6 ? 'rgba(120,170,255,0.7)' : 'rgba(255,255,255,0.38)',
          }}>{d}</div>
        ))}
      </div>

      {/* Days grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
        {cells.map((d, i) => {
          const hasDiary = d != null && !!diaries[dateKey(year, month, d)]
          const isToday = isCurrentMonth && d === todayD
          return (
            <div key={i} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 23 }}>
              {d != null && (
                <div role="button" onClick={() => setSelected(d)} style={cellStyle(d)}>{d}</div>
              )}
              {hasDiary && !isToday && (
                <div style={{
                  position: 'absolute', bottom: 1, width: 5, height: 5, borderRadius: '50%',
                  border: '1.5px solid rgba(99,179,237,0.75)', boxSizing: 'border-box',
                }} />
              )}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, paddingTop: 11, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 11, height: 11, borderRadius: '50%', background: 'rgba(99,179,237,0.9)' }} />
          <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', fontFamily: "'Noto Sans KR', sans-serif" }}>오늘</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid rgba(99,179,237,0.75)', boxSizing: 'border-box' }} />
          <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', fontFamily: "'Noto Sans KR', sans-serif" }}>기록 있음</span>
        </div>
      </div>

      {/* Day detail */}
      {selected != null && (
        <div style={{ marginTop: 11, paddingTop: 11, borderTop: '1px solid rgba(255,255,255,0.07)', animation: 'itemIn 0.3s ease both' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontFamily: "'Noto Sans KR', sans-serif", letterSpacing: '0.03em' }}>
              {month + 1}월 {selected}일 기록
            </span>
            <button onClick={() => setSelected(null)} style={{
              width: 18, height: 18, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.4)',
              fontSize: 14, lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}>×</button>
          </div>

          {selEntry ? (
            <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 12, lineHeight: 1.5, flexShrink: 0 }}>{selEntry.mood || '📖'}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: "'Noto Sans KR', sans-serif", lineHeight: 1.5 }}>
                {selEntry.title || '(제목 없음)'}
              </span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Noto Sans KR', sans-serif", padding: '2px 0' }}>
              이 날의 기록이 없어요
            </div>
          )}

          <button
            onClick={() => onOpenDiary(dateKey(year, month, selected), { year, month, day: selected })}
            style={{
              width: '100%', marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: 'rgba(233,213,160,0.14)', border: '1px solid rgba(233,213,160,0.35)', borderRadius: 10,
              padding: '9px 12px', fontSize: 11.5, fontFamily: "'Noto Sans KR', sans-serif",
              color: 'rgba(240,225,180,0.92)', letterSpacing: '0.02em', cursor: 'pointer', transition: 'all 0.18s',
            }}
          >
            {selEntry ? '✏️ 일기 보기' : '📖 일기 쓰기'}
          </button>
        </div>
      )}
    </div>
  )
}
