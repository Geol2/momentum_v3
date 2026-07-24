import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../lib/useIsMobile.js'

const addBtn = {
  width: '100%', background: 'rgba(99,179,237,0.15)', border: '1px solid rgba(99,179,237,0.3)', borderRadius: 12,
  padding: '12px 18px', fontSize: 14, fontWeight: 400, color: 'rgba(99,179,237,0.9)', cursor: 'pointer',
  fontFamily: "'Noto Sans KR', sans-serif", whiteSpace: 'nowrap',
}
const fieldStyle = {
  width: '100%', minWidth: 0, minHeight: 62, background: 'rgba(0,0,0,0.58)',
  border: '1px solid rgba(255,255,255,0.2)', borderRadius: 12, padding: '13px 16px', fontSize: 14,
  color: 'rgba(255,255,255,0.85)', fontFamily: "'Noto Sans KR', sans-serif", fontWeight: 300,
  resize: 'none', lineHeight: 1.6, backdropFilter: 'blur(8px)',
}
const iconBtn = {
  width: 26, height: 26, minWidth: 26, borderRadius: 7, border: 'none', background: 'transparent',
  cursor: 'pointer', color: 'rgba(255,255,255,0.16)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0,
}

function timeLabel(ts) {
  if (!ts) return ''
  const t = new Date(ts)
  return `${t.getHours() < 12 ? '오전' : '오후'} ${((t.getHours() + 11) % 12) + 1}:${String(t.getMinutes()).padStart(2, '0')}`
}

// One memo in the inline list. Double-click (or ✎) swaps the text for a textarea,
// same commit/cancel keys as the sticky-note board so both views feel identical.
function MemoItem({ note, onRemove, onEdit, onTogglePin }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.text)
  const ref = useRef(null)

  useEffect(() => {
    if (!editing) return
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  const startEdit = () => { setDraft(note.text); setEditing(true) }
  const commit = () => {
    const text = draft.trim()
    if (text && text !== note.text) onEdit(note.id, text)
    setEditing(false)
  }

  return (
    <div style={{
      display: 'flex', alignItems: editing ? 'stretch' : 'flex-start', gap: 9,
      background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12,
      padding: '11px 12px', backdropFilter: 'blur(8px)', animation: 'itemIn 0.3s ease both',
    }}>
      {editing ? (
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() }
            else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
          }}
          rows={3}
          style={{
            flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(99,179,237,0.5)',
            borderRadius: 8, padding: '7px 9px', fontSize: 13, fontWeight: 300, lineHeight: 1.55,
            color: 'rgba(255,255,255,0.9)', fontFamily: "'Noto Sans KR', sans-serif", resize: 'none', outline: 'none',
          }}
        />
      ) : (
        <div
          onDoubleClick={startEdit}
          title="더블클릭하여 수정"
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, cursor: 'text' }}
        >
          <span style={{
            fontSize: 13.5, fontWeight: 300, lineHeight: 1.6, color: 'rgba(255,255,255,0.82)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{note.text}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'Outfit, sans-serif', fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.03em' }}>
            {note.pinned && <span style={{ color: 'rgba(233,150,140,0.8)' }}>📌 고정</span>}
            {timeLabel(note.ts)}
          </span>
        </div>
      )}

      {!editing && (
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {onTogglePin && (
            <button
              onClick={() => onTogglePin(note.id)}
              title={note.pinned ? '고정 해제 (이 날짜에만 표시)' : '고정 (모든 날짜에 표시)'}
              style={{ ...iconBtn, fontSize: 12, color: note.pinned ? 'rgba(233,150,140,0.9)' : 'rgba(255,255,255,0.16)' }}
            >{note.pinned ? '📌' : '📍'}</button>
          )}
          <button onClick={startEdit} title="수정" style={{ ...iconBtn, fontSize: 12 }}>✎</button>
          <button onClick={() => onRemove(note.id)} title="삭제" style={{ ...iconBtn, fontSize: 19 }}>×</button>
        </div>
      )}
    </div>
  )
}

// Memo input plus an inline list of the memos visible for the active day.
// On desktop those same memos also float as draggable sticky notes (StickyNotes.jsx);
// on mobile this list is the only place they show up.
export default function MemoSection({ notes = [], onAdd, onRemove, onEdit, onTogglePin }) {
  const isMobile = useIsMobile()
  const [val, setVal] = useState('')

  const submit = () => {
    const text = val.trim()
    if (!text) return
    onAdd(text)
    setVal('')
  }

  // Pinned memos ride along every day, so keep them at the top; newest first otherwise.
  const ordered = [...notes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.ts || 0) - (a.ts || 0))

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)' }}>메모</div>
        {ordered.length > 0 && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.06em' }}>{ordered.length}개</div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        <textarea
          placeholder="메모를 입력하세요..."
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          style={fieldStyle}
        />
        <button onClick={submit} style={addBtn}>+ 추가</button>
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.22)', fontWeight: 300, letterSpacing: '0.03em', textAlign: 'center' }}>
          Enter 저장 · Shift+Enter 줄바꿈{!isMobile && ' · 화면의 포스트잇은 드래그로 이동'}
        </div>
      </div>

      {ordered.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {ordered.map((note) => (
            <MemoItem key={note.id} note={note} onRemove={onRemove} onEdit={onEdit} onTogglePin={onTogglePin} />
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '20px 0 4px', color: 'rgba(255,255,255,0.14)', fontSize: 13, fontWeight: 300, letterSpacing: '0.06em' }}>
          이 날의 메모를 남겨보세요
        </div>
      )}
    </>
  )
}
