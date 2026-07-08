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

export default function TodoSection({ todos, onAdd, onToggle, onRemove }) {
  const [val, setVal] = useState('')
  const done = todos.filter((t) => t.done).length

  const submit = () => {
    const text = val.trim()
    if (!text) return
    onAdd(text)
    setVal('')
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)' }}>오늘 할 일</div>
        {todos.length > 0 && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.06em' }}>{done} / {todos.length} 완료</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          type="text" placeholder="오늘 할 일을 입력하세요..." value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          style={inputStyle}
        />
        <button onClick={submit} style={addBtn}>+ 추가</button>
      </div>

      {todos.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {todos.map((item) => (
            <div key={item.id} style={{
              display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(0,0,0,0.28)',
              border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 13px',
              backdropFilter: 'blur(8px)', animation: 'itemIn 0.3s ease both',
            }}>
              <button onClick={() => onToggle(item.id)} style={{
                width: 21, height: 21, minWidth: 21, borderRadius: 6,
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
              <span style={{
                flex: 1, fontSize: 14, fontWeight: 300, letterSpacing: '0.01em',
                color: item.done ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.82)',
                textDecoration: item.done ? 'line-through' : 'none',
              }}>{item.text}</span>
              <button onClick={() => onRemove(item.id)} style={{
                width: 26, height: 26, minWidth: 26, borderRadius: 7, border: 'none', background: 'transparent',
                cursor: 'pointer', color: 'rgba(255,255,255,0.16)', fontSize: 19, display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>×</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '26px 0 6px', color: 'rgba(255,255,255,0.14)', fontSize: 13, fontWeight: 300, letterSpacing: '0.06em' }}>
          오늘의 할 일을 추가해보세요
        </div>
      )}
    </>
  )
}
