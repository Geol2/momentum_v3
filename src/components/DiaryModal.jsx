import { useState, useEffect } from 'react'
import { DAYS_KR, MOODS } from '../lib/data.js'

// Handwritten-diary modal on lined paper. Supports view + edit modes.
export default function DiaryModal({ open, dateInfo, entry, onSave, onDelete, onClose }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [mood, setMood] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle(entry?.title || '')
    setBody(entry?.body || '')
    setMood(entry?.mood || '')
    setEditing(!entry) // new entry → start in edit mode
  }, [open, entry])

  if (!open || !dateInfo) return null

  const { year, month, day } = dateInfo
  const weekday = DAYS_KR[new Date(year, month, day).getDay()]

  const save = () => {
    onSave({ title: title.trim(), body: body.trim(), mood })
    setEditing(false)
  }

  const overlay = {
    position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(8,10,20,0.62)', backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px',
    animation: 'backdropIn 0.3s ease both',
  }
  const paper = {
    position: 'relative', width: '100%', maxWidth: 480, maxHeight: '86vh', display: 'flex', flexDirection: 'column',
    backgroundColor: '#f5eedd',
    backgroundImage: 'repeating-linear-gradient(transparent, transparent 33px, rgba(150,130,90,0.16) 33px, rgba(150,130,90,0.16) 34px)',
    borderRadius: 4, boxShadow: '0 30px 70px rgba(0,0,0,0.55), 0 2px 0 rgba(255,255,255,0.5) inset',
    overflow: 'hidden', animation: 'diaryIn 0.4s cubic-bezier(0.16,1,0.3,1) both',
  }
  const closeBtn = {
    width: 28, height: 28, minWidth: 28, border: 'none', background: 'rgba(120,100,70,0.08)', borderRadius: 8,
    color: 'rgba(90,75,50,0.6)', fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: 0, cursor: 'pointer',
  }
  const deleteBtn = {
    marginRight: 'auto', background: 'transparent', border: '1px solid rgba(200,90,80,0.3)', borderRadius: 9,
    padding: '8px 14px', fontFamily: "'Noto Sans KR', sans-serif", fontSize: 12, color: 'rgba(180,70,60,0.85)', cursor: 'pointer',
  }
  const primaryBtn = {
    background: '#6b5836', border: 'none', borderRadius: 9, padding: '8px 22px',
    fontFamily: "'Noto Sans KR', sans-serif", fontSize: 13, fontWeight: 500, color: '#f7f1e3', cursor: 'pointer',
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div className="diary-paper thin-scroll" onClick={(e) => e.stopPropagation()} style={paper}>
        {/* Red margin line */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 44, width: 2, background: 'rgba(200,90,80,0.32)' }} />

        {/* Header */}
        <div style={{ position: 'relative', padding: '22px 30px 14px 56px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid rgba(150,130,90,0.18)' }}>
          <div>
            <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 26, fontWeight: 400, color: '#4a3f2a', letterSpacing: '0.02em', lineHeight: 1 }}>
              {month + 1}.{String(day).padStart(2, '0')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 7 }}>
              <span style={{ fontFamily: "'Gowun Batang', serif", fontSize: 13, color: 'rgba(90,75,50,0.7)' }}>{weekday}요일</span>
              {mood && <span style={{ fontSize: 17, lineHeight: 1 }}>{mood}</span>}
            </div>
          </div>
          <button onClick={onClose} style={closeBtn}>×</button>
        </div>

        {/* Body */}
        <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: '18px 30px 20px 56px' }}>
          {editing ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'Gowun Batang', serif", fontSize: 12, color: 'rgba(90,75,50,0.55)', marginBottom: 7, letterSpacing: '0.04em' }}>오늘의 기분</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {MOODS.map((m) => (
                    <div
                      key={m.label}
                      role="button"
                      onClick={() => setMood(m.emoji)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 8px',
                        borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                        background: mood === m.emoji ? 'rgba(120,100,70,0.16)' : 'transparent',
                        border: mood === m.emoji ? '1px solid rgba(120,100,70,0.35)' : '1px solid transparent',
                      }}
                    >
                      <span style={{ fontSize: 19, lineHeight: 1 }}>{m.emoji}</span>
                      <span style={{ fontFamily: "'Gowun Batang', serif", fontSize: 9.5, color: 'rgba(74,63,42,0.78)' }}>{m.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <input
                type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목"
                style={{
                  width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(150,130,90,0.25)',
                  padding: '4px 0 8px', fontFamily: "'Gowun Batang', serif", fontSize: 20, fontWeight: 700,
                  color: '#3d3320', marginBottom: 14, lineHeight: 1.5,
                }}
              />
              <textarea
                value={body} onChange={(e) => setBody(e.target.value)} placeholder="오늘 하루는 어땠나요?" rows={9}
                style={{
                  width: '100%', background: 'transparent', border: 'none', resize: 'none',
                  fontFamily: "'Gowun Batang', serif", fontSize: 15.5, lineHeight: '34px', color: '#4a3f28',
                  letterSpacing: '0.01em', minHeight: 240,
                }}
              />
            </>
          ) : (
            <>
              <div style={{ fontFamily: "'Gowun Batang', serif", fontSize: 21, fontWeight: 700, color: '#3d3320', lineHeight: '34px', marginBottom: 6 }}>
                {title || '(제목 없음)'}
              </div>
              <div style={{ fontFamily: "'Gowun Batang', serif", fontSize: 15.5, lineHeight: '34px', color: '#4a3f28', whiteSpace: 'pre-wrap', wordBreak: 'break-word', letterSpacing: '0.01em' }}>
                {body}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 30px 16px 56px', borderTop: '1px solid rgba(150,130,90,0.18)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {entry && <button onClick={onDelete} style={deleteBtn}>삭제</button>}
          {editing ? (
            <button onClick={save} style={primaryBtn}>저장</button>
          ) : (
            <button onClick={() => setEditing(true)} style={primaryBtn}>✏️ 수정</button>
          )}
        </div>
      </div>
    </div>
  )
}
