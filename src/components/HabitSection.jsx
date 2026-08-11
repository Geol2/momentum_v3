import { useState } from 'react'
import HabitModal from './HabitModal.jsx'
import { HABIT_COLORS } from '../lib/data.js'

// 오늘(또는 달력에서 고른 날) 해야 할 습관을 체크하는 곳. 추가·수정·삭제는 '관리' 모달로
// 빼서, 매일 마주하는 이 목록은 누르기만 하면 되게 둡니다.
export default function HabitSection({
  habits, doneKeys, dateKey, isToday, isFuture, onToggle, onAdd, onEdit, onRemove,
}) {
  const [managing, setManaging] = useState(false)

  const done = habits.filter((h) => doneKeys.has(`${h.id}:${dateKey}`)).length
  const label = isToday
    ? '오늘 습관'
    : `${parseInt(dateKey.slice(5, 7), 10)}월 ${parseInt(dateKey.slice(8, 10), 10)}일 습관`

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)' }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {habits.length > 0 && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.06em' }}>{done} / {habits.length} 완료</div>
          )}
          <button onClick={() => setManaging(true)} style={{
            border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
            fontSize: 10, color: 'rgba(99,179,237,0.7)', fontFamily: "'Noto Sans KR', sans-serif", letterSpacing: '0.04em',
          }}>관리</button>
        </div>
      </div>

      {habits.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {habits.map((h) => {
            const checked = doneKeys.has(`${h.id}:${dateKey}`)
            const c = h.color || HABIT_COLORS[0]
            return (
              <button
                key={h.id}
                onClick={() => !isFuture && onToggle(h.id)}
                disabled={isFuture}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
                  background: checked ? `${c}1f` : 'rgba(0,0,0,0.55)',
                  border: `1px solid ${checked ? `${c}66` : 'rgba(255,255,255,0.14)'}`,
                  borderRadius: 12, padding: '12px 13px', backdropFilter: 'blur(8px)',
                  cursor: isFuture ? 'default' : 'pointer', opacity: isFuture ? 0.45 : 1,
                  fontFamily: "'Noto Sans KR', sans-serif", transition: 'background 0.18s, border-color 0.18s',
                  animation: 'itemIn 0.3s ease both',
                }}
              >
                {/* 이모지는 습관을 알아보는 표지라 체크 후에도 그대로 두고, 오른쪽 아래
                    작은 ✓로 완료를 표시합니다. */}
                <span style={{ position: 'relative', width: 32, height: 32, minWidth: 32, flexShrink: 0 }}>
                  <span style={{
                    width: 32, height: 32, borderRadius: 10, fontSize: 16, lineHeight: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: checked ? `${c}33` : 'rgba(255,255,255,0.05)',
                    border: `1.5px solid ${checked ? c : 'rgba(255,255,255,0.18)'}`,
                    filter: checked ? 'none' : 'grayscale(0.5)', transition: 'all 0.18s',
                  }}>{h.emoji || '🌱'}</span>
                  {checked && (
                    <span style={{
                      position: 'absolute', right: -3, bottom: -3, width: 15, height: 15, borderRadius: '50%',
                      background: c, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 1px 5px rgba(0,0,0,0.45)',
                    }}>
                      <svg width="9" height="7" viewBox="0 0 11 8" fill="none">
                        <path d="M1 3.8L4 6.8L10 1" stroke="rgba(10,14,24,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </span>

                <span style={{
                  flex: 1, minWidth: 0, fontSize: 14, fontWeight: 300, letterSpacing: '0.01em', wordBreak: 'break-word',
                  color: checked ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.62)',
                }}>{h.name}</span>

                {h.currentStreak > 0 && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
                    fontSize: 11.5, fontWeight: 400, color: checked ? c : 'rgba(255,255,255,0.3)',
                    letterSpacing: '0.02em',
                  }}>🔥 {h.currentStreak}일</span>
                )}
              </button>
            )
          })}
          {isFuture && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)', textAlign: 'center', paddingTop: 4, fontWeight: 300 }}>
              아직 오지 않은 날은 체크할 수 없어요
            </div>
          )}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '18px 0 6px' }}>
          <div style={{ color: 'rgba(255,255,255,0.14)', fontSize: 13, fontWeight: 300, letterSpacing: '0.06em', marginBottom: 12 }}>
            매일 이어가고 싶은 습관을 등록해보세요
          </div>
          <button onClick={() => setManaging(true)} style={{
            cursor: 'pointer', padding: '8px 16px', borderRadius: 11,
            background: 'rgba(99,179,237,0.14)', border: '1px solid rgba(99,179,237,0.38)',
            fontSize: 12.5, color: 'rgba(150,205,255,0.95)', fontFamily: "'Noto Sans KR', sans-serif",
            letterSpacing: '0.02em',
          }}>+ 습관 추가</button>
        </div>
      )}

      <HabitModal
        open={managing}
        habits={habits}
        onAdd={onAdd}
        onEdit={onEdit}
        onRemove={onRemove}
        onClose={() => setManaging(false)}
      />
    </>
  )
}
