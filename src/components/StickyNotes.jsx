import { useRef } from 'react'
import { NOTE_COLORS } from '../lib/data.js'

// Draggable pastel post-it notes. Each note stores its own {x, y} position.
export default function StickyNotes({ notes, onMove, onMoveEnd, onRemove }) {
  return (
    <>
      {notes.map((note, i) => (
        <Note key={note.id} note={note} color={NOTE_COLORS[i % NOTE_COLORS.length]} onMove={onMove} onMoveEnd={onMoveEnd} onRemove={onRemove} />
      ))}
    </>
  )
}

function Note({ note, color, onMove, onMoveEnd, onRemove }) {
  const drag = useRef(null)

  const onMouseDown = (e) => {
    if (e.target.closest('button')) return
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
      style={{
        position: 'fixed', left: note.x, top: note.y, zIndex: 95, width: 180, minHeight: 90,
        background: color, borderRadius: 3, padding: '14px 14px 12px', color: '#3a3320',
        boxShadow: '0 12px 30px rgba(0,0,0,0.35)', transform: `rotate(${note.rot}deg)`,
        fontFamily: "'Noto Sans KR', sans-serif", cursor: 'grab', userSelect: 'none',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 400, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 22 }}>
        {note.text}
      </div>
      <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 9, color: 'rgba(60,51,32,0.5)', marginTop: 9, letterSpacing: '0.03em' }}>
        {timeLabel}
      </div>
      <button
        onClick={() => onRemove(note.id)}
        title="삭제"
        style={{
          position: 'absolute', top: 6, right: 6, width: 18, height: 18, border: 'none', background: 'transparent',
          color: 'rgba(60,51,32,0.4)', fontSize: 15, lineHeight: 1, padding: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center', borderRadius: 4, cursor: 'pointer',
        }}
      >×</button>
    </div>
  )
}
