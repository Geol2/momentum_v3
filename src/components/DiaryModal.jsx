import { useState, useEffect, useRef } from 'react'
import { DAYS_KR, MOODS } from '../lib/data.js'
import { useIsMobile } from '../lib/useIsMobile.js'

// 사진을 Tesseract에 넘기기 전에 다듬어 인식률을 끌어올린다: 작으면 확대 → 흑백 →
// Otsu 이진화(글자/배경 분리). 활자·또박또박한 정자체는 눈에 띄게 좋아지지만, 흘림
// 필기체는 엔진 자체의 한계라 이걸로도 완벽해지진 않는다.
function otsuThreshold(hist, total) {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, maxVar = 0, threshold = 0
  for (let i = 0; i < 256; i++) {
    wB += hist[i]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += i * hist[i]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > maxVar) { maxVar = between; threshold = i }
  }
  return threshold
}

async function preprocessForOcr(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = reject
      im.src = url
    })
    // 작은 사진은 글자가 커지도록 확대(긴 변 최대 2200px). 큰 사진은 그대로.
    const longEdge = Math.max(img.width, img.height) || 1
    const scale = longEdge < 2200 ? Math.min(2, 2200 / longEdge) : 1
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)

    const imageData = ctx.getImageData(0, 0, w, h)
    const d = imageData.data
    const hist = new Array(256).fill(0)
    const gray = new Uint8Array(w * h)
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
      gray[p] = g
      hist[g]++
    }
    // 살짝 어두운 쪽으로 치우쳐 얇은 획이 사라지지 않게 한다.
    const t = otsuThreshold(hist, w * h) + 10
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const v = gray[p] < t ? 0 : 255
      d[i] = d[i + 1] = d[i + 2] = v
    }
    ctx.putImageData(imageData, 0, 0)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Handwritten-diary modal on lined paper. Supports view + edit modes.
export default function DiaryModal({ open, dateInfo, entry, onSave, onDelete, onClose }) {
  const isMobile = useIsMobile()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [mood, setMood] = useState('')
  // 사진에서 글자 읽어오기(Tesseract OCR). 브라우저 안에서만 돌아가고 사진은 서버로 안 나갑니다.
  const fileRef = useRef(null)
  const [ocr, setOcr] = useState({ busy: false, progress: 0, error: '' })

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

  // 고른 사진을 Tesseract로 OCR해서 본문칸에 덮어씁니다. tesseract.js는 무겁고 OCR을
  // 눌러야만 필요하므로, 번들을 키우지 않게 이 시점에 동적으로 불러옵니다. 첫 실행 때
  // 한국어 학습데이터를 내려받고(수 MB) 이후엔 캐시됩니다.
  async function runOcr(file) {
    if (!file || ocr.busy) return
    setOcr({ busy: true, progress: 0, error: '' })

    // 외부 OCR 서비스(PaddleOCR 등)가 설정돼 있으면 그쪽으로 원본 이미지를 보낸다.
    // 손글씨는 Tesseract보다 서버형 엔진이 나아서, 이걸로 먼저 시도한다.
    const ocrUrl = import.meta.env.VITE_OCR_URL
    if (ocrUrl) {
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(ocrUrl, { method: 'POST', body: fd })
        if (!res.ok) throw new Error(`OCR ${res.status}`)
        const { text } = await res.json()
        const t = (text || '').replace(/\n{3,}/g, '\n\n').trim()
        if (!t) {
          setOcr({ busy: false, progress: 0, error: '사진에서 글자를 찾지 못했어요. 더 또렷한 사진으로 다시 시도해 주세요.' })
          return
        }
        setBody(t)   // 덮어쓰기
        setOcr({ busy: false, progress: 100, error: '' })
      } catch {
        setOcr({ busy: false, progress: 0, error: 'OCR 서버에 연결하지 못했어요. 서비스가 켜져 있는지 확인해 주세요.' })
      }
      return
    }

    let worker
    try {
      const Tesseract = (await import('tesseract.js')).default
      // 전처리(확대·이진화)한 캔버스를 넘긴다. 실패하면 원본 파일로 폴백.
      const source = await preprocessForOcr(file).catch(() => file)
      // 기본 tesseract.js는 'fast'(저정확도) 학습데이터를 쓴다. 한글 손글씨는 'best'
      // (LSTM 고정확도)로 바꾸면 인식률이 크게 오른다 — 대신 첫 다운로드가 더 크고 느리다.
      // oem=1 은 LSTM 전용 엔진.
      worker = await Tesseract.createWorker('kor+eng', 1, {
        langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
        // tesseract.js는 학습데이터를 파일명(kor.traineddata)으로 캐시한다. 예전 fast
        // 데이터가 이미 캐시돼 있으면 langPath만 바꿔도 그걸 재사용하므로, best는
        // 별도 캐시 네임스페이스에 받아 옛 fast 캐시와 섞이지 않게 한다.
        cachePath: 'tess-best',
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setOcr((o) => ({ ...o, progress: Math.round((m.progress || 0) * 100) }))
          }
        },
      })
      const { data } = await worker.recognize(source)
      const text = (data?.text || '').replace(/\n{3,}/g, '\n\n').trim()
      if (!text) {
        setOcr({ busy: false, progress: 0, error: '사진에서 글자를 찾지 못했어요. 더 또렷한 사진으로 다시 시도해 주세요.' })
        return
      }
      setBody(text)   // 덮어쓰기
      setOcr({ busy: false, progress: 100, error: '' })
    } catch {
      setOcr({ busy: false, progress: 0, error: 'OCR에 실패했어요. 첫 실행은 언어데이터를 받느라 네트워크가 필요해요.' })
    } finally {
      if (worker) { try { await worker.terminate() } catch { /* 이미 종료 */ } }
    }
  }

  // The red margin line eats 56px of a 480px page fine, but on a 360px phone that's
  // a sixth of the screen — pull the whole indent in.
  const gutter = isMobile ? 30 : 56
  const edge = isMobile ? 16 : 30

  const overlay = {
    position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(8,10,20,0.62)', backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? '20px 12px' : '40px 20px',
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
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: gutter - 12, width: 2, background: 'rgba(200,90,80,0.32)' }} />

        {/* Header */}
        <div style={{ position: 'relative', padding: `22px ${edge}px 14px ${gutter}px`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid rgba(150,130,90,0.18)' }}>
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
        <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: `18px ${edge}px 20px ${gutter}px` }}>
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

              {/* 사진에서 글자 불러오기 (OCR) — 본문 덮어쓰기 */}
              <div style={{ marginBottom: 14 }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; runOcr(f) }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={ocr.busy}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: ocr.busy ? 'default' : 'pointer',
                    background: 'rgba(120,100,70,0.10)', border: '1px solid rgba(120,100,70,0.3)', borderRadius: 9,
                    padding: '7px 12px', fontFamily: "'Gowun Batang', serif", fontSize: 12.5, color: 'rgba(74,63,42,0.9)',
                  }}
                >
                  📷 {ocr.busy ? `읽는 중… ${ocr.progress}%` : '사진에서 글자 불러오기'}
                </button>
                {ocr.error ? (
                  <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, color: 'rgba(180,70,60,0.9)', fontFamily: "'Gowun Batang', serif" }}>{ocr.error}</div>
                ) : (
                  <div style={{ marginTop: 6, fontSize: 10.5, lineHeight: 1.5, color: 'rgba(90,75,50,0.5)', fontFamily: "'Gowun Batang', serif" }}>
                    또박또박한 글씨·인쇄물일수록 잘 읽혀요(흘림체는 한계). 불러온 뒤 다듬어 저장하세요. (본문 덮어쓰기)
                  </div>
                )}
              </div>

              <input
                type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목"
                style={{
                  width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(150,130,90,0.25)',
                  padding: '4px 0 8px', fontFamily: "'Nanum Pen Script', 'Gowun Batang', cursive", fontSize: 23, fontWeight: 700,
                  color: '#3d3320', marginBottom: 14, lineHeight: 1.5,
                }}
              />
              <textarea
                value={body} onChange={(e) => setBody(e.target.value)} placeholder="오늘 하루는 어땠나요?" rows={9}
                style={{
                  width: '100%', background: 'transparent', border: 'none', resize: 'none',
                  fontFamily: "'Nanum Pen Script', 'Gowun Batang', cursive", fontSize: 18, lineHeight: '34px', color: '#4a3f28',
                  letterSpacing: '0.01em', minHeight: 240,
                }}
              />
            </>
          ) : (
            <>
              <div style={{ fontFamily: "'Nanum Pen Script', 'Gowun Batang', cursive", fontSize: 24, fontWeight: 700, color: '#3d3320', lineHeight: '34px', marginBottom: 6 }}>
                {title || '(제목 없음)'}
              </div>
              <div style={{ fontFamily: "'Nanum Pen Script', 'Gowun Batang', cursive", fontSize: 18, lineHeight: '34px', color: '#4a3f28', whiteSpace: 'pre-wrap', wordBreak: 'break-word', letterSpacing: '0.01em' }}>
                {body}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: `12px ${edge}px 16px ${gutter}px`, borderTop: '1px solid rgba(150,130,90,0.18)', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
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
