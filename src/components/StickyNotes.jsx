import { useEffect, useRef, useState } from 'react'
import { NOTE_COLORS } from '../lib/data.js'

// Draggable pastel post-it notes. Each note stores its own {x, y} position.
export default function StickyNotes({ notes, onMove, onMoveEnd, onResize, onResizeEnd, onRemove, onEdit, onTogglePin }) {
  return (
    <>
      {notes.map((note, i) => (
        <Note key={note.id} note={note} color={NOTE_COLORS[i % NOTE_COLORS.length]} onMove={onMove} onMoveEnd={onMoveEnd} onResize={onResize} onResizeEnd={onResizeEnd} onRemove={onRemove} onEdit={onEdit} onTogglePin={onTogglePin} />
      ))}
    </>
  )
}

const MIN_W = 140
const MIN_H = 90
const MAX_W = 420
const MAX_H = 480

const iconBtn = {
  width: 18, height: 18, border: 'none', background: 'transparent', color: 'rgba(60,51,32,0.4)',
  lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 4, cursor: 'pointer',
}

function Note({ note, color, onMove, onMoveEnd, onResize, onResizeEnd, onRemove, onEdit, onTogglePin }) {
  const drag = useRef(null)
  const resize = useRef(null)
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
    if (e.target.closest('button') || e.target.closest('textarea') || e.target.closest('[data-resize]')) return
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

  const width = note.width || 180
  const height = note.height || 90

  const onResizeStart = (e) => {
    e.stopPropagation()
    resize.current = { startX: e.clientX, startY: e.clientY, baseW: width, baseH: height, lastW: width, lastH: height }
    const move = (ev) => {
      if (!resize.current) return
      const w = Math.max(MIN_W, Math.min(MAX_W, resize.current.baseW + (ev.clientX - resize.current.startX)))
      const h = Math.max(MIN_H, Math.min(MAX_H, resize.current.baseH + (ev.clientY - resize.current.startY)))
      resize.current.lastW = w
      resize.current.lastH = h
      onResize?.(note.id, w, h)
    }
    const up = () => {
      // Persist only the final size — mousemove fires far too often to PATCH each frame.
      if (resize.current) onResizeEnd?.(note.id, resize.current.lastW, resize.current.lastH)
      resize.current = null
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
        position: 'fixed', left: note.x, top: note.y, zIndex: 95, width, height, minHeight: MIN_H,
        background: color, borderRadius: 3, padding: '14px 14px 12px', color: '#3a3320',
        boxShadow: '0 12px 30px rgba(0,0,0,0.35)', transform: `rotate(${note.rot}deg)`,
        fontFamily: "'Noto Sans KR', sans-serif", cursor: editing ? 'default' : 'grab',
        userSelect: editing ? 'text' : 'none', display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
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
          style={{
            width: '100%', flex: 1, background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(60,51,32,0.2)',
            borderRadius: 3, padding: '4px 6px', fontSize: 13, fontWeight: 400, lineHeight: 1.55,
            color: '#3a3320', fontFamily: "'Noto Sans KR', sans-serif", resize: 'none', outline: 'none',
          }}
        />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', fontSize: 13, fontWeight: 400, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 62 }}>
          {note.text}
        </div>
      )}

      <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 9, color: 'rgba(60,51,32,0.5)', marginTop: 9, letterSpacing: '0.03em', flexShrink: 0 }}>
        {editing ? 'Enter 저장 · Esc 취소' : timeLabel}
      </div>

      {!editing && (
        <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 2 }}>
          {onTogglePin && (
            <button
              onClick={() => onTogglePin(note.id)}
              title={note.pinned ? '고정 해제 (이 날짜에만 표시)' : '고정 (모든 날짜에 표시)'}
              style={{ ...iconBtn, fontSize: 12, color: note.pinned ? '#c0392b' : 'rgba(60,51,32,0.4)' }}
            >{note.pinned ? '📌' : '📍'}</button>
          )}
          <button onClick={startEdit} title="수정" style={{ ...iconBtn, fontSize: 11 }}>✎</button>
          <button onClick={() => onRemove(note.id)} title="삭제" style={{ ...iconBtn, fontSize: 15 }}>×</button>
        </div>
      )}

      {!editing && (
        <div
          data-resize
          onMouseDown={onResizeStart}
          title="크기 조절"
          style={{
            position: 'absolute', right: 1, bottom: 1, width: 16, height: 16, cursor: 'nwse-resize',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 2,
          }}
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M8 1L1 8M8 4.5L4.5 8" stroke="rgba(60,51,32,0.45)" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  )
}
