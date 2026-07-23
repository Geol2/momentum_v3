import { useState } from 'react'

const addBtn = {
  background: 'rgba(99,179,237,0.15)', border: '1px solid rgba(99,179,237,0.3)', borderRadius: 12,
  padding: '12px 18px', fontSize: 14, fontWeight: 400, color: 'rgba(99,179,237,0.9)', cursor: 'pointer',
  fontFamily: "'Noto Sans KR', sans-serif", whiteSpace: 'nowrap',
}
const inputStyle = {
  flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
  padding: '12px 16px', fontSize: 14, color: 'rgba(255,255,255,0.85)', fontFamily: "'Noto Sans KR', sans-serif",
  fontWeight: 300, backdropFilter: 'blur(8px)',
}
// Compact inputs for the optional time / place fields.
const optInput = {
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
  padding: '9px 12px', fontSize: 13, color: 'rgba(255,255,255,0.82)', fontFamily: "'Noto Sans KR', sans-serif",
  fontWeight: 300, outline: 'none',
}
const editInput = {
  background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(99,179,237,0.4)', borderRadius: 8,
  padding: '6px 9px', fontSize: 13, fontWeight: 300, color: 'rgba(255,255,255,0.9)',
  fontFamily: "'Noto Sans KR', sans-serif", outline: 'none',
}

// Small pill shown under a todo when it has a time or place.
function Badge({ icon, children, dim }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 300,
      color: dim ? 'rgba(255,255,255,0.22)' : 'rgba(99,179,237,0.72)', letterSpacing: '0.02em',
    }}>
      <span style={{ opacity: 0.85 }}>{icon}</span>{children}
    </span>
  )
}

export default function TodoSection({ todos, label = '오늘 할 일', isToday = true, onAdd, onToggle, onRemove, onEdit, onResetToToday }) {
  const [val, setVal] = useState('')
  const [time, setTime] = useState('')
  const [place, setPlace] = useState('')
  const [showOpts, setShowOpts] = useState(false)

  const [editingId, setEditingId] = useState(null)
  const [edit, setEdit] = useState({ text: '', timeLabel: '', place: '' })

  const done = todos.filter((t) => t.done).length

  const submit = () => {
    const text = val.trim()
    if (!text) return
    onAdd(text, { timeLabel: time.trim(), place: place.trim() })
    setVal(''); setTime(''); setPlace(''); setShowOpts(false)
  }

  const startEdit = (item) => {
    setEditingId(item.id)
    setEdit({ text: item.text, timeLabel: item.timeLabel || '', place: item.place || '' })
  }
  const commitEdit = () => {
    const text = edit.text.trim()
    if (text && onEdit) {
      // "" clears time/place on the backend; a filled value sets it.
      onEdit(editingId, { text, timeLabel: edit.timeLabel.trim(), place: edit.place.trim() })
    }
    setEditingId(null)
  }
  const cancelEdit = () => setEditingId(null)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)' }}>{label}</div>
          {!isToday && onResetToToday && (
            <button onClick={onResetToToday} style={{
              border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
              fontSize: 10, color: 'rgba(99,179,237,0.7)', fontFamily: "'Noto Sans KR', sans-serif", letterSpacing: '0.04em',
            }}>← 오늘</button>
          )}
        </div>
        {todos.length > 0 && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.06em' }}>{done} / {todos.length} 완료</div>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text" placeholder={isToday ? '오늘 할 일을 입력하세요...' : '이 날의 할 일을 입력하세요...'} value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            style={inputStyle}
          />
          <button onClick={submit} style={addBtn}>+ 추가</button>
        </div>

        <button
          onClick={() => setShowOpts((s) => !s)}
          style={{
            marginTop: 8, border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px 2px',
            fontSize: 11, color: 'rgba(99,179,237,0.6)', fontFamily: "'Noto Sans KR', sans-serif",
            letterSpacing: '0.03em', display: 'inline-flex', alignItems: 'center', gap: 5,
          }}
        >
          🕐 시간·장소 {showOpts ? '▴' : '▾'}
        </button>

        {showOpts && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, animation: 'itemIn 0.25s ease both' }}>
            <input
              type="time" value={time} onChange={(e) => setTime(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              style={{ ...optInput, width: 120, colorScheme: 'dark' }}
            />
            <input
              type="text" placeholder="📍 장소 (선택)" value={place} onChange={(e) => setPlace(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              style={{ ...optInput, flex: 1 }}
            />
          </div>
        )}
      </div>

      {todos.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {todos.map((item) => {
            const editing = editingId === item.id
            return (
              <div key={item.id} style={{
                display: 'flex', alignItems: editing ? 'flex-start' : 'center', gap: 11, background: 'rgba(0,0,0,0.28)',
                border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 13px',
                backdropFilter: 'blur(8px)', animation: 'itemIn 0.3s ease both',
              }}>
                <button onClick={() => onToggle(item.id)} style={{
                  width: 21, height: 21, minWidth: 21, borderRadius: 6, marginTop: editing ? 2 : 0,
                  border: item.done ? '1.5px solid rgba(99,179,237,0.65)' : '1.5px solid rgba(255,255,255,0.22)',
                  background: item.done ? 'rgba(99,179,237,0.2)' : 'transparent', cursor: 'pointer', padding: 0,
                  flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {item.done && (
                    <svg width="11" height="8" viewBox="0 0 11 8" fill="none">
                      <path d="M1 3.8L4 6.8L10 1" stroke="rgba(99,179,237,0.92)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>

                {editing ? (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <input
                      type="text" value={edit.text} autoFocus
                      onChange={(e) => setEdit((s) => ({ ...s, text: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit()
                        else if (e.key === 'Escape') cancelEdit()
                      }}
                      style={{ ...editInput, width: '100%' }}
                    />
                    <div style={{ display: 'flex', gap: 7 }}>
                      <input
                        type="time" value={edit.timeLabel}
                        onChange={(e) => setEdit((s) => ({ ...s, timeLabel: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') cancelEdit() }}
                        style={{ ...editInput, width: 110, colorScheme: 'dark' }}
                      />
                      <input
                        type="text" placeholder="📍 장소" value={edit.place}
                        onChange={(e) => setEdit((s) => ({ ...s, place: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') cancelEdit() }}
                        style={{ ...editInput, flex: 1 }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 1 }}>
                      <button onClick={commitEdit} style={{
                        border: 'none', background: 'rgba(99,179,237,0.18)', color: 'rgba(99,179,237,0.9)',
                        borderRadius: 7, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
                        fontFamily: "'Noto Sans KR', sans-serif",
                      }}>저장</button>
                      <button onClick={cancelEdit} style={{
                        border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.35)',
                        borderRadius: 7, padding: '4px 8px', fontSize: 12, cursor: 'pointer',
                        fontFamily: "'Noto Sans KR', sans-serif",
                      }}>취소</button>
                    </div>
                  </div>
                ) : (
                  <div
                    onDoubleClick={() => onEdit && startEdit(item)} title={onEdit ? '더블클릭하여 수정' : undefined}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, cursor: onEdit ? 'text' : 'default', minWidth: 0 }}
                  >
                    <span style={{
                      fontSize: 14, fontWeight: 300, letterSpacing: '0.01em', wordBreak: 'break-word',
                      color: item.done ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.82)',
                      textDecoration: item.done ? 'line-through' : 'none',
                    }}>{item.text}</span>
                    {(item.timeLabel || item.place) && (
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {item.timeLabel && <Badge icon="🕐" dim={item.done}>{item.timeLabel}</Badge>}
                        {item.place && <Badge icon="📍" dim={item.done}>{item.place}</Badge>}
                      </span>
                    )}
                  </div>
                )}

                {!editing && onEdit && (
                  <button onClick={() => startEdit(item)} title="수정" style={{
                    width: 26, height: 26, minWidth: 26, borderRadius: 7, border: 'none', background: 'transparent',
                    cursor: 'pointer', color: 'rgba(255,255,255,0.16)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M14.06 6.19l3.75 3.75L8.5 19.25 4.75 19.25 4.75 15.5 14.06 6.19z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M14.06 6.19l1.94-1.94a1.5 1.5 0 012.12 0l1.63 1.63a1.5 1.5 0 010 2.12L17.81 9.94" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                {!editing && (
                  <button onClick={() => onRemove(item.id)} style={{
                    width: 26, height: 26, minWidth: 26, borderRadius: 7, border: 'none', background: 'transparent',
                    cursor: 'pointer', color: 'rgba(255,255,255,0.16)', fontSize: 19, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>×</button>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '26px 0 6px', color: 'rgba(255,255,255,0.14)', fontSize: 13, fontWeight: 300, letterSpacing: '0.06em' }}>
          {isToday ? '오늘의 할 일을 추가해보세요' : '이 날의 할 일을 추가해보세요'}
        </div>
      )}
    </>
  )
}
