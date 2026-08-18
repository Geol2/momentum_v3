import { useEffect, useMemo, useState } from 'react'
import { DAYS_KR, dateKey } from '../lib/data.js'

// 달력 마커 규칙 — 셋 다 지켜야 표시가 헷갈리지 않습니다.
//   1. 마커는 카테고리마다 점 하나. 크기·모양(채운 원)은 전부 같습니다.
//   2. 순서는 항상 할 일 → 습관 → 기록. 위치만 봐도 무엇인지 알 수 있게.
//   3. 색이 곧 뜻입니다. 그날 그 카테고리를 다 끝냈으면 초록으로 바뀝니다.
// 파랑은 '오늘'에만 쓰고(셀 배경), 마커에는 쓰지 않습니다.
const MARK = {
  today: 'rgba(99,179,237,0.9)',
  todo: 'rgba(233,213,160,0.92)',
  habit: 'rgba(249,168,212,0.9)',
  diary: 'rgba(196,181,253,0.9)',
  done: 'rgba(134,239,172,0.92)',
}
const DOT = 5      // 마커 지름. 범례도 같은 값을 써서 눈으로 대조됩니다.
const CELL = 20    // 날짜 원 지름

const LEGEND = [
  [MARK.today, '오늘'],
  [MARK.todo, '할 일'],
  [MARK.habit, '습관'],
  [MARK.diary, '기록'],
  [MARK.done, '완료'],
]

function buildCells(year, month) {
  const first = new Date(year, month, 1).getDay()
  const count = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < first; i++) cells.push(null)
  for (let d = 1; d <= count; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export default function Calendar({
  now, diaries, todos = [], habits = [], habitLogs,
  selectedDateKey, onSelectDate, onOpenDiary, onMonthChange, mobile = false,
}) {
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()
  const todayD = now.getDate()
  const cells = buildCells(year, month)

  // 화면에 보이는 달이 바뀌면 부모에게 알려, 그 달의 습관 기록을 받아오게 합니다.
  // (날짜를 고르지 않고 달만 넘겨봐도 습관 마커가 비어 보이지 않도록.)
  useEffect(() => {
    if (onMonthChange) onMonthChange(dateKey(year, month, 1).slice(0, 7))
  }, [year, month, onMonthChange])

  // Count of todos per day, so we can mark days that have any.
  const todoByDate = useMemo(() => {
    const m = {}
    for (const t of todos) {
      if (!t.dateKey) continue
      if (!m[t.dateKey]) m[t.dateKey] = { total: 0, done: 0 }
      m[t.dateKey].total++
      if (t.done) m[t.dateKey].done++
    }
    return m
  }, [todos])

  // 습관은 할 일과 달리 날짜에 배정되는 게 아니라 체크 기록만 남습니다. 그래서
  // '체크가 하나라도 있는 날'에만 점을 찍습니다 — 습관을 만들기 전의 지난 날들이
  // 전부 미완료로 표시되는 걸 막기 위해서입니다.
  const habitTotal = habits.length
  const habitByDate = useMemo(() => {
    const m = {}
    if (!habitLogs || habitTotal === 0) return m
    const ids = new Set(habits.map((h) => String(h.id)))
    for (const logKey of habitLogs) {
      const i = logKey.indexOf(':')
      if (i < 0) continue
      // 지운 습관의 기록이 남아 있을 수 있어, 현재 습관 것만 셉니다.
      if (!ids.has(logKey.slice(0, i))) continue
      const dk = logKey.slice(i + 1)
      m[dk] = (m[dk] || 0) + 1
    }
    return m
  }, [habits, habitLogs, habitTotal])

  // The picked day, only if it falls inside the month currently on screen.
  const selected =
    selectedDateKey && selectedDateKey.startsWith(dateKey(year, month, 1).slice(0, 7))
      ? parseInt(selectedDateKey.slice(8, 10), 10)
      : null
  const select = (d) => onSelectDate(dateKey(year, month, d))

  const prev = () => {
    let m = month - 1, y = year
    if (m < 0) { m = 11; y-- }
    setMonth(m); setYear(y)
  }
  const next = () => {
    let m = month + 1, y = year
    if (m > 11) { m = 0; y++ }
    setMonth(m); setYear(y)
  }

  const cellStyle = (d) => {
    const s = {
      width: CELL, height: CELL, display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: '50%', fontSize: 10.5, fontFamily: 'Outfit, sans-serif', cursor: 'pointer',
      color: 'rgba(255,255,255,0.72)', transition: 'all 0.15s',
    }
    const today = isCurrentMonth && d === todayD
    if (today) { s.background = MARK.today; s.color = '#fff'; s.fontWeight = 500 }
    // 선택은 배경이 아니라 바깥 링으로 표시합니다. 오늘을 골라도 '오늘'과 '선택'이
    // 서로를 덮지 않고 함께 보입니다.
    if (d === selected) {
      if (!today) s.background = 'rgba(255,255,255,0.12)'
      s.boxShadow = '0 0 0 1.5px rgba(255,255,255,0.55)'
    }
    return s
  }

  const navBtn = {
    width: 24, height: 24, borderRadius: 7, border: 'none', background: 'transparent',
    color: 'rgba(255,255,255,0.45)', fontSize: 17, lineHeight: 1, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  const dotStyle = (color) => ({ width: DOT, height: DOT, borderRadius: '50%', background: color, flexShrink: 0 })
  const krText = { fontFamily: "'Noto Sans KR', sans-serif" }

  const selKey = selected != null ? dateKey(year, month, selected) : null
  const selEntry = selKey ? diaries[selKey] : null
  const selTodo = selKey ? todoByDate[selKey] : null
  const selHabitDone = selKey ? (habitByDate[selKey] || 0) : 0

  return (
    <div style={{
      ...(mobile
        ? { position: 'static', width: 216, margin: '0 auto' }
        : { position: 'fixed', top: 60, left: 26, zIndex: 100, width: 196 }),
      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16,
      padding: '12px 14px', backdropFilter: 'blur(20px)', fontFamily: 'Outfit, sans-serif',
      animation: 'fadeUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.55s both',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
        <button onClick={prev} style={navBtn}>‹</button>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', letterSpacing: '0.03em', ...krText }}>
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
          const key = d != null ? dateKey(year, month, d) : null
          const todoInfo = key ? todoByDate[key] : null
          const habitDone = key ? (habitByDate[key] || 0) : 0

          // 규칙 2·3이 여기 한 곳에 모여 있습니다: 순서 고정, 다 끝냈으면 초록.
          const marks = []
          if (todoInfo) marks.push(todoInfo.done === todoInfo.total ? MARK.done : MARK.todo)
          if (habitDone > 0) marks.push(habitDone === habitTotal ? MARK.done : MARK.habit)
          if (key && diaries[key]) marks.push(MARK.diary)

          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0 }}>
              {d != null
                ? <div role="button" onClick={() => select(d)} style={cellStyle(d)}>{d}</div>
                : <div style={{ height: CELL }} />}
              {/* 마커 줄은 비어 있어도 자리를 지킵니다 — 날짜 숫자를 가리지 않고 줄도 안 흔들립니다. */}
              <div style={{ height: DOT, display: 'flex', gap: 2, alignItems: 'center' }}>
                {marks.map((c, j) => <div key={j} style={dotStyle(c)} />)}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend — 점 크기를 실제 마커와 똑같이 맞춰 눈으로 대조되게 했습니다. */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', rowGap: 5, columnGap: 9,
        marginTop: 12, paddingTop: 11, borderTop: '1px solid rgba(255,255,255,0.07)',
      }}>
        {LEGEND.map(([color, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={dotStyle(color)} />
            <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', ...krText }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Day detail */}
      {selected != null && (
        <div style={{ marginTop: 11, paddingTop: 11, borderTop: '1px solid rgba(255,255,255,0.07)', animation: 'itemIn 0.3s ease both' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', letterSpacing: '0.03em', ...krText }}>
              {month + 1}월 {selected}일
            </span>
            <button onClick={() => onSelectDate(null)} style={{
              width: 18, height: 18, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.4)',
              fontSize: 14, lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}>×</button>
          </div>

          {/* Todo summary — the panel below the calendar shows this day's list in full. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
            <span style={{ fontSize: 12, flexShrink: 0 }}>✅</span>
            {selTodo && selTodo.total > 0 ? (
              <span style={{ fontSize: 11, ...krText, color: selTodo.done === selTodo.total ? MARK.done : MARK.todo }}>
                할 일 {selTodo.done}/{selTodo.total} 완료
              </span>
            ) : (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', ...krText }}>이 날의 할 일이 없어요</span>
            )}
          </div>

          {/* Habit summary — 마커와 같은 색 규칙을 씁니다. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 12, flexShrink: 0 }}>🌱</span>
            {habitTotal > 0 ? (
              <span style={{
                fontSize: 11, ...krText,
                color: selHabitDone === 0 ? 'rgba(255,255,255,0.3)'
                  : selHabitDone === habitTotal ? MARK.done : MARK.habit,
              }}>
                습관 {selHabitDone}/{habitTotal} 완료
              </span>
            ) : (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', ...krText }}>등록된 습관이 없어요</span>
            )}
          </div>

          {selEntry ? (
            <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 12, lineHeight: 1.5, flexShrink: 0 }}>{selEntry.mood || '📖'}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, ...krText }}>
                {selEntry.title || '(제목 없음)'}
              </span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', padding: '2px 0', ...krText }}>
              이 날의 기록이 없어요
            </div>
          )}

          <button
            onClick={() => onOpenDiary(dateKey(year, month, selected), { year, month, day: selected })}
            style={{
              width: '100%', marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: 'rgba(233,213,160,0.14)', border: '1px solid rgba(233,213,160,0.35)', borderRadius: 10,
              padding: '9px 12px', fontSize: 11.5, ...krText,
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
