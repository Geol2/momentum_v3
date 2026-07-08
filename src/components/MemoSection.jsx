import { useState } from 'react'

const addBtn = {
  background: 'rgba(99,179,237,0.15)', border: '1px solid rgba(99,179,237,0.3)', borderRadius: 12,
  padding: '13px 18px', fontSize: 14, fontWeight: 400, color: 'rgba(99,179,237,0.9)', cursor: 'pointer',
  fontFamily: "'Noto Sans KR', sans-serif", whiteSpace: 'nowrap',
}

// The input + label part of the memo feature. The notes themselves render as
// draggable sticky notes (see StickyNotes.jsx).
export default function MemoSection({ count, onAdd }) {
  const [val, setVal] = useState('')

  const submit = () => {
    const text = val.trim()
    if (!text) return
    onAdd(text)
    setVal('')
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)' }}>메모</div>
        {count > 0 && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.06em' }}>{count}개</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'flex-start' }}>
        <textarea
          placeholder="메모를 입력하세요... (Enter 저장, Shift+Enter 줄바꿈)"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          style={{
            flex: 1, minHeight: 46, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 12, padding: '13px 16px', fontSize: 14, color: 'rgba(255,255,255,0.85)',
            fontFamily: "'Noto Sans KR', sans-serif", fontWeight: 300, resize: 'none', lineHeight: 1.6,
            backdropFilter: 'blur(8px)',
          }}
        />
        <button onClick={submit} style={addBtn}>+ 추가</button>
      </div>

      <div style={{ textAlign: 'center', padding: '4px 0 2px', color: 'rgba(255,255,255,0.2)', fontSize: 11, fontWeight: 300, letterSpacing: '0.03em' }}>
        추가하면 화면에 포스트잇으로 붙어요 · 드래그로 이동
      </div>
    </>
  )
}
