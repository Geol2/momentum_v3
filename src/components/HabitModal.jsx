import { useEffect, useState } from 'react'
import { HABIT_COLORS, HABIT_EMOJIS } from '../lib/data.js'
import { useIsMobile } from '../lib/useIsMobile.js'

const addBtn = {
  background: 'linear-gradient(135deg, rgba(88,160,235,0.95), rgba(120,140,240,0.95))',
  border: '1px solid rgba(150,200,255,0.55)', borderRadius: 12,
  padding: '11px 18px', fontSize: 13.5, fontWeight: 600, color: '#fff', cursor: 'pointer',
  fontFamily: "'Noto Sans KR', sans-serif", whiteSpace: 'nowrap', letterSpacing: '0.02em',
  boxShadow: '0 4px 14px rgba(70,120,220,0.42)', transition: 'filter 0.15s',
}
const addBtnBusy = { ...addBtn, cursor: 'default', filter: 'saturate(0.5) brightness(0.8)', boxShadow: 'none' }
const inputStyle = {
  width: '100%', minWidth: 0, background: 'rgba(0,0,0,0.58)', border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 12, padding: '11px 14px', fontSize: 14, color: 'rgba(255,255,255,0.85)',
  fontFamily: "'Noto Sans KR', sans-serif", fontWeight: 300, outline: 'none',
}
const iconBtn = {
  width: 26, height: 26, minWidth: 26, borderRadius: 7, border: 'none', background: 'transparent',
  cursor: 'pointer', color: 'rgba(255,255,255,0.2)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0,
}
const label = {
  fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.22)', marginBottom: 8,
}

function EmojiPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {HABIT_EMOJIS.map((e) => (
        <button
          key={e} type="button" onClick={() => onChange(e)}
          style={{
            width: 34, height: 34, borderRadius: 10, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0,
            background: value === e ? 'rgba(99,179,237,0.18)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${value === e ? 'rgba(99,179,237,0.5)' : 'rgba(255,255,255,0.12)'}`,
            transition: 'all 0.15s',
          }}
        >{e}</button>
      ))}
    </div>
  )
}

function ColorPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
      {HABIT_COLORS.map((c) => (
        <button
          key={c} type="button" onClick={() => onChange(c)} title={c}
          style={{
            width: 26, height: 26, borderRadius: '50%', cursor: 'pointer', padding: 0,
            background: c, opacity: value === c ? 1 : 0.45,
            border: `2px solid ${value === c ? 'rgba(255,255,255,0.85)' : 'transparent'}`,
            transition: 'all 0.15s',
          }}
        />
      ))}
    </div>
  )
}

// 습관 추가·수정·삭제. 체크는 본문 섹션에서 하고, 여기는 목록을 손보는 곳입니다.
export default function HabitModal({ open, habits, onAdd, onEdit, onRemove, onClose }) {
  const isMobile = useIsMobile()
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(HABIT_EMOJIS[0])
  const [color, setColor] = useState(HABIT_COLORS[0])
  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState(null)
  const [edit, setEdit] = useState({ name: '', emoji: '', color: '' })
  // 삭제는 기록까지 함께 사라지므로 한 번 더 묻습니다. window.confirm은 인앱 브라우저에서
  // 막히는 경우가 있어 화면 안에서 확인받습니다.
  const [confirmId, setConfirmId] = useState(null)

  useEffect(() => {
    if (!open) return
    setName(''); setEmoji(HABIT_EMOJIS[0]); setColor(HABIT_COLORS[0])
    setEditingId(null); setConfirmId(null)
  }, [open])

  if (!open) return null

  // 성공했을 때만 입력을 비웁니다 — 저장이 실패하면 쓰던 이름까지 사라지지 않게.
  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await onAdd({ name: trimmed, emoji, color })
      setName('')
    } catch {
      /* 실패 — 입력을 그대로 둡니다 */
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (h) => {
    setConfirmId(null)
    setEditingId(h.id)
    setEdit({ name: h.name, emoji: h.emoji || HABIT_EMOJIS[0], color: h.color || HABIT_COLORS[0] })
  }
  const commitEdit = () => {
    const trimmed = edit.name.trim()
    if (trimmed) onEdit(editingId, { name: trimmed, emoji: edit.emoji, color: edit.color })
    setEditingId(null)
  }

  const overlay = {
    position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(8,10,20,0.62)', backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? '20px 12px' : '40px 20px',
    animation: 'backdropIn 0.3s ease both',
  }
  const panel = {
    width: '100%', maxWidth: 420, maxHeight: '86vh', display: 'flex', flexDirection: 'column',
    background: 'rgba(14,18,30,0.92)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18,
    backdropFilter: 'blur(24px)', boxShadow: '0 30px 70px rgba(0,0,0,0.55)',
    fontFamily: "'Noto Sans KR', sans-serif", overflow: 'hidden',
    animation: 'diaryIn 0.35s cubic-bezier(0.16,1,0.3,1) both',
  }
  const pad = isMobile ? 16 : 22

  return (
    <div style={overlay} onClick={onClose}>
      <div className="thin-scroll" onClick={(e) => e.stopPropagation()} style={panel}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: `18px ${pad}px 14px`, borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.8)', letterSpacing: '0.02em' }}>습관 관리</div>
          <button onClick={onClose} style={{ ...iconBtn, fontSize: 20, color: 'rgba(255,255,255,0.35)' }}>×</button>
        </div>

        <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: `18px ${pad}px 22px` }}>
          {/* 새 습관 */}
          <div style={label}>새 습관</div>
          <input
            type="text" value={name} placeholder="예: 물 2L 마시기"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            style={inputStyle}
          />
          <div style={{ marginTop: 12 }}><EmojiPicker value={emoji} onChange={setEmoji} /></div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <ColorPicker value={color} onChange={setColor} />
            <button onClick={submit} disabled={saving} style={saving ? addBtnBusy : addBtn}>
              {saving ? '저장 중…' : '+ 추가'}
            </button>
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '20px 0 18px' }} />

          {/* 목록 */}
          <div style={label}>내 습관 {habits.length > 0 && <span style={{ letterSpacing: 0 }}>({habits.length})</span>}</div>
          {habits.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '18px 0 6px', color: 'rgba(255,255,255,0.16)', fontSize: 13, fontWeight: 300 }}>
              아직 등록한 습관이 없어요
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {habits.map((h) => {
                const editing = editingId === h.id
                const c = h.color || HABIT_COLORS[0]
                return (
                  <div key={h.id} style={{
                    background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 12, padding: '11px 12px',
                  }}>
                    {editing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <input
                          type="text" value={edit.name} autoFocus
                          onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit()
                            else if (e.key === 'Escape') setEditingId(null)
                          }}
                          style={{ ...inputStyle, padding: '8px 11px', fontSize: 13 }}
                        />
                        <EmojiPicker value={edit.emoji} onChange={(v) => setEdit((s) => ({ ...s, emoji: v }))} />
                        <ColorPicker value={edit.color} onChange={(v) => setEdit((s) => ({ ...s, color: v }))} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={commitEdit} style={{
                            border: 'none', background: 'rgba(99,179,237,0.18)', color: 'rgba(99,179,237,0.9)',
                            borderRadius: 7, padding: '5px 14px', fontSize: 12, cursor: 'pointer',
                            fontFamily: "'Noto Sans KR', sans-serif",
                          }}>저장</button>
                          <button onClick={() => setEditingId(null)} style={{
                            border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.35)',
                            borderRadius: 7, padding: '5px 8px', fontSize: 12, cursor: 'pointer',
                            fontFamily: "'Noto Sans KR', sans-serif",
                          }}>취소</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{
                          width: 28, height: 28, minWidth: 28, borderRadius: 9, fontSize: 15, lineHeight: 1,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: `${c}22`, border: `1px solid ${c}55`,
                        }}>{h.emoji || '🌱'}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 300, color: 'rgba(255,255,255,0.82)', wordBreak: 'break-word' }}>
                          {h.name}
                        </span>
                        {h.bestStreak > 0 && (
                          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.28)', whiteSpace: 'nowrap' }}>
                            최고 {h.bestStreak}일
                          </span>
                        )}
                        {confirmId === h.id ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button onClick={() => { setConfirmId(null); onRemove(h.id) }} style={{
                              border: '1px solid rgba(200,90,80,0.4)', background: 'rgba(200,90,80,0.14)',
                              color: 'rgba(240,140,130,0.95)', borderRadius: 7, padding: '4px 10px', fontSize: 11.5,
                              cursor: 'pointer', fontFamily: "'Noto Sans KR', sans-serif", whiteSpace: 'nowrap',
                            }}>기록까지 삭제</button>
                            <button onClick={() => setConfirmId(null)} style={{
                              border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.35)',
                              borderRadius: 7, padding: '4px 6px', fontSize: 11.5, cursor: 'pointer',
                              fontFamily: "'Noto Sans KR', sans-serif",
                            }}>취소</button>
                          </span>
                        ) : (
                          <>
                            <button onClick={() => startEdit(h)} title="수정" style={iconBtn}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                                <path d="M14.06 6.19l3.75 3.75L8.5 19.25 4.75 19.25 4.75 15.5 14.06 6.19z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M14.06 6.19l1.94-1.94a1.5 1.5 0 012.12 0l1.63 1.63a1.5 1.5 0 010 2.12L17.81 9.94" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button onClick={() => setConfirmId(h.id)} title="삭제" style={{ ...iconBtn, fontSize: 18 }}>×</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
