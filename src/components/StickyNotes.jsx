import { useEffect, useRef, useState } from 'react'
import { NOTE_COLORS } from '../lib/data.js'

// Draggable pastel post-it notes. Each note stores its own {x, y} position.
export default function StickyNotes({ notes, onMove, onMoveEnd, onRemove, onEdit }) {
  return (
    <>
      {notes.map((note, i) => (
        <Note key={note.id} note={note} color={NOTE_COLORS[i % NOTE_COLORS.length]} onMove={onMove} onMoveEnd={onMoveEnd} onRemove={onRemove} onEdit={onEdit} />
      ))}
    </>
  )
}

const iconBtn = {
  width: 18, height: 18, border: 'none', background: 'transparent', color: 'rgba(60,51,32,0.4)',
  lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 4, cursor: 'pointer',
}

function Note({ note, color, onMove, onMoveEnd, onRemove, onEdit }) {
  const drag = useRef(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.text)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  const startEdit = () => {
    setDraft(note.text)
    setEditing(true)
  }

  const commit = () => {
    const text = draft.trim()
    if (text && text !== note.text) onEdit(note.id, text)
    setEditing(false)
  }

  const cancel = () => {
    setDraft(note.text)
    setEditing(false)
  }

  const onMouseDown = (e) => {
    // Buttons and the edit textarea handle their own clicks — dragging from them
    // would swallow the click and make the note impossible to edit.
    if (e.target.closest('button') || e.target.closest('textarea')) return
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: note.x, baseY: note.y, lastX: note.x, lastY: note.y }
    const move = (ev) => {
      if (!drag.current) return
      const dx = ev.clientX - drag.current.startX
      const dy = ev.clientY - drag.current.startY
      const x = drag.current.baseX + dx
      const y = drag.current.baseY + dy
      drag.current.lastX = x
      drag.current.lastY = y
      onMove(note.id, x, y)
    }
    const up = () => {
      // Only the final position is persisted to the backend — mousemove can fire
      // dozens of times per drag and would otherwise flood the API with PATCH calls.
      if (drag.current) onMoveEnd?.(note.id, drag.current.lastX, drag.current.lastY)
      drag.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const t = new Date(note.ts)
  const timeLabel = `${t.getHours() < 12 ? '오전' : '오후'} ${((t.getHours() + 11) % 12) + 1}:${String(t.getMinutes()).padStart(2, '0')}`

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={() => { if (!editing) startEdit() }}
      style={{
        position: 'fixed', left: note.x, top: note.y, zIndex: 95, width: 180, minHeight: 90,
        background: color, borderRadius: 3, padding: '14px 14px 12px', color: '#3a3320',
        boxShadow: '0 12px 30px rgba(0,0,0,0.35)', transform: `rotate(${note.rot}deg)`,
        fontFamily: "'Noto Sans KR', sans-serif", cursor: editing ? 'default' : 'grab',
        userSelect: editing ? 'text' : 'none',
      }}
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          rows={3}
          style={{
            width: '100%', background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(60,51,32,0.2)',
            borderRadius: 3, padding: '4px 6px', fontSize: 13, fontWeight: 400, lineHeight: 1.55,
            color: '#3a3320', fontFamily: "'Noto Sans KR', sans-serif", resize: 'none', outline: 'none',
          }}
        />
      ) : (
        <div style={{ fontSize: 13, fontWeight: 400, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 40 }}>
          {note.text}
        </div>
      )}

      <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 9, color: 'rgba(60,51,32,0.5)', marginTop: 9, letterSpacing: '0.03em' }}>
        {editing ? 'Enter 저장 · Esc 취소' : timeLabel}
      </div>

      {!editing && (
        <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 2 }}>
          <button onClick={startEdit} title="수정" style={{ ...iconBtn, fontSize: 11 }}>✎</button>
          <button onClick={() => onRemove(note.id)} title="삭제" style={{ ...iconBtn, fontSize: 15 }}>×</button>
        </div>
      )}
    </div>
  )
}
