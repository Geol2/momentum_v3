import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../lib/useIsMobile.js'
import {
  SERVER_ENABLED, SOURCE_LANGS, createEngine, detectLanguage, localAvailability,
} from '../lib/translate.js'

/**
 * 📄 논문 PDF 번역 — 파일을 넣으면 문단 단위로 번역해 원문과 나란히 보여 줍니다.
 *
 * PDF에서 글자를 뽑는 일(pdf.js)과 스캔본 OCR(tesseract.js)은 전부 이 브라우저 안에서
 * 끝나고, 파일은 어디로도 올라가지 않습니다. 번역만 엔진을 탑니다 — 자세한 갈림길은
 * lib/translate.js 주석 참고.
 */

// Tesseract 학습데이터 이름. 원문 언어를 골라 두면 그 언어로 OCR합니다.
const OCR_LANGS = { en: 'eng', ja: 'jpn', zh: 'chi_sim', de: 'deu', fr: 'fra', es: 'spa', ru: 'rus' }

const labelStyle = {
  fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.25)', marginBottom: 8,
}
const selectStyle = {
  background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 9,
  padding: '7px 10px', fontSize: 12.5, color: 'rgba(255,255,255,0.85)',
  fontFamily: "'Noto Sans KR', sans-serif", outline: 'none',
}
const primaryBtn = {
  background: 'linear-gradient(135deg, rgba(88,160,235,0.95), rgba(120,140,240,0.95))',
  border: '1px solid rgba(150,200,255,0.55)', borderRadius: 11,
  padding: '10px 18px', fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer',
  fontFamily: "'Noto Sans KR', sans-serif", letterSpacing: '0.02em',
  boxShadow: '0 4px 14px rgba(70,120,220,0.4)',
}
const ghostBtn = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 10,
  padding: '8px 14px', fontSize: 12.5, color: 'rgba(255,255,255,0.75)', cursor: 'pointer',
  fontFamily: "'Noto Sans KR', sans-serif",
}

function Bar({ value }) {
  return (
    <div style={{ height: 4, borderRadius: 3, background: 'rgba(255,255,255,0.09)', overflow: 'hidden' }}>
      <div style={{
        height: '100%', width: `${Math.round(value * 100)}%`,
        background: 'linear-gradient(90deg, rgba(99,179,237,0.9), rgba(134,239,172,0.9))',
        transition: 'width 0.2s',
      }} />
    </div>
  )
}

export default function PdfTranslator() {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const fileRef = useRef(null)

  const [file, setFile] = useState(null)
  const [stage, setStage] = useState('idle')    // idle | extracting | ready | translating | done
  const [progress, setProgress] = useState({ done: 0, total: 0, note: '' })
  const [source, setSource] = useState('auto')
  const [detected, setDetected] = useState('')
  const [doc, setDoc] = useState(null)          // {paragraphs, pageCount, charCount, likelyScanned}
  const [translated, setTranslated] = useState([])
  const [engineKind, setEngineKind] = useState('')
  const [avail, setAvail] = useState('')        // Translator API 가용성
  const [error, setError] = useState('')
  const [onlyTarget, setOnlyTarget] = useState(false)
  const [range, setRange] = useState({ from: '', to: '' })

  const cancelRef = useRef(false)

  // 번역 엔진이 지금 이 브라우저에서 되는지 미리 확인해 둡니다. 다 뽑아 놓고 나서
  // "번역기가 없다"고 알리면 시간만 버리게 됩니다.
  useEffect(() => {
    if (!open) return
    let alive = true
    const src = source === 'auto' ? (detected || 'en') : source
    localAvailability(src, 'ko').then((a) => { if (alive) setAvail(a) })
    return () => { alive = false }
  }, [open, source, detected])

  const reset = () => {
    cancelRef.current = true
    setFile(null); setDoc(null); setTranslated([]); setStage('idle')
    setProgress({ done: 0, total: 0, note: '' }); setError(''); setDetected('')
    setRange({ from: '', to: '' })
  }

  const close = () => { setOpen(false) }

  const pageRange = () => ({
    pageFrom: Math.max(1, parseInt(range.from, 10) || 1),
    pageTo: parseInt(range.to, 10) || 0,
  })

  async function loadPdf(f, { ocr = false } = {}) {
    if (!f) return
    setFile(f); setError(''); setTranslated([]); setDoc(null)
    setStage('extracting')
    setProgress({ done: 0, total: 0, note: ocr ? '이미지에서 글자 읽는 중' : '텍스트 추출 중' })
    cancelRef.current = false

    try {
      // pdf.js와 tesseract는 무겁습니다. 버튼을 누른 이 순간에만 내려받습니다.
      const { extractPdfText, ocrPdfPages } = await import('../lib/pdfText.js')
      const opts = {
        ...pageRange(),
        onProgress: ({ page, total }) => setProgress((p) => ({ ...p, done: page, total })),
      }
      const result = ocr
        ? await ocrPdfPages(f, { ...opts, langs: OCR_LANGS[source] || 'eng' })
        : await extractPdfText(f, opts)

      if (!result.paragraphs.length) {
        setError('읽을 수 있는 글자가 없어요. 스캔본이라면 아래 OCR로 시도해 보세요.')
        setDoc(result); setStage('ready')
        return
      }

      setDoc(result)
      setStage('ready')

      // 원문 언어를 미리 감지해 둡니다. 번역 시작 버튼을 누른 뒤에 하면 사용자 활성화가
      // 만료돼 내장 번역기 생성이 거부될 수 있습니다.
      if (source === 'auto') {
        const sample = result.paragraphs.slice(0, 6).map((p) => p.text).join(' ')
        const lang = await detectLanguage(sample)
        if (lang) setDetected(lang)
      }
    } catch (e) {
      console.error('pdf extract failed', e)
      setError('PDF를 읽지 못했어요. 암호가 걸린 파일이거나 손상된 파일일 수 있어요.')
      setStage('idle')
    }
  }

  async function translateAll() {
    if (!doc?.paragraphs.length) return
    const src = source === 'auto' ? (detected || 'en') : source
    if (src === 'ko') {
      setError('원문이 이미 한국어예요.')
      return
    }

    setError('')
    cancelRef.current = false
    setStage('translating')
    setProgress({ done: 0, total: doc.paragraphs.length, note: '번역 준비 중' })

    let engine
    try {
      // 사용자 제스처 안에서 곧바로 — 앞에 await를 끼우면 안 됩니다.
      engine = await createEngine({
        source: src,
        target: 'ko',
        onDownload: (loaded) => setProgress((p) => ({
          ...p, note: `번역기 내려받는 중 ${Math.round(loaded * 100)}%`,
        })),
      })
      setEngineKind(engine.kind)

      const texts = doc.paragraphs.map((p) => p.text)
      const out = await engine.translateAll(texts, (done, total) => {
        if (cancelRef.current) throw new Error('cancelled')
        setProgress({ done, total, note: '' })
      })
      setTranslated(out)
      setStage('done')
    } catch (e) {
      if (e?.message === 'cancelled') {
        setStage('ready')
      } else if (e?.message === 'no-engine') {
        setStage('ready')
        setError('이 브라우저에는 번역 엔진이 없어요. Chrome 138 이상 데스크톱에서 열거나, 서버 번역을 설정해 주세요.')
      } else {
        console.error('translate failed', e)
        setStage('ready')
        setError(`번역에 실패했어요. ${e?.message || ''}`.trim())
      }
    } finally {
      engine?.destroy()
    }
  }

  const plainText = () => doc?.paragraphs.map((p, i) => {
    const ko = translated[i]
    return onlyTarget ? (ko || '') : `${p.text}\n${ko || ''}`
  }).join('\n\n') || ''

  const download = () => {
    const blob = new Blob([plainText()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(file?.name || 'translated').replace(/\.pdf$/i, '')}_ko.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(plainText()) } catch { /* 클립보드 거부 — 무시 */ }
  }

  const srcNow = source === 'auto' ? (detected || 'en') : source
  const srcLabel = SOURCE_LANGS.find((l) => l.code === srcNow)?.label || srcNow
  const engineNote = SERVER_ENABLED
    ? { text: '서버 번역을 씁니다 (논문 품질).', ok: true }
    : avail === 'available'
      ? { text: '브라우저 내장 번역기 — 무료, 기기 안에서 실행됩니다. 문장 단위 번역이라 전문용어·문체는 거칠어요.', ok: true }
      : avail === 'downloadable' || avail === 'downloading'
        ? { text: `내장 번역기(${srcLabel}→한국어) 언어팩을 처음 한 번 내려받습니다.`, ok: true }
        : avail === 'unsupported'
          ? { text: '이 브라우저에는 번역 엔진이 없어요. Chrome 138 이상 데스크톱에서 열면 무료 내장 번역기를 쓸 수 있어요.', ok: false }
          : { text: `${srcLabel}→한국어는 내장 번역기가 지원하지 않아요.`, ok: false }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="논문 PDF 번역"
        style={{
          position: 'fixed', bottom: 24, right: 200, zIndex: 100,
          width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(16px)',
          color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M8.5 12.5h4M10.5 12.5v4" />
          <path d="M13 18.5l2.5-5 2.5 5M13.9 16.7h3.2" />
        </svg>
      </button>

      {open && (
        <div
          onClick={close}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(8,10,20,0.62)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? '20px 12px' : '40px 20px',
            animation: 'backdropIn 0.3s ease both',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="thin-scroll"
            style={{
              position: 'relative', width: '100%', maxWidth: stage === 'done' ? 720 : 500, maxHeight: '86vh', overflowY: 'auto',
              background: 'rgba(18,22,34,0.94)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18,
              padding: '22px 22px 24px', backdropFilter: 'blur(24px)',
              boxShadow: '0 30px 70px rgba(0,0,0,0.55)', animation: 'itemIn 0.3s cubic-bezier(0.16,1,0.3,1) both',
              fontFamily: "'Noto Sans KR', sans-serif",
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>📄</span>
                <span style={{ fontSize: 14, fontWeight: 400, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em' }}>논문 PDF 번역</span>
              </div>
              <button onClick={close} title="닫기" style={{
                width: 28, height: 28, minWidth: 28, border: 'none', background: 'rgba(255,255,255,0.06)', borderRadius: 8,
                color: 'rgba(255,255,255,0.55)', fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 0, cursor: 'pointer',
              }}>×</button>
            </div>

            {/* 1) 파일 고르기 */}
            {stage === 'idle' && (
              <div>
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const f = e.dataTransfer.files?.[0]
                    if (f?.type === 'application/pdf') loadPdf(f)
                  }}
                  style={{
                    border: '1px dashed rgba(255,255,255,0.22)', borderRadius: 14, padding: '30px 18px',
                    textAlign: 'center', cursor: 'pointer', background: 'rgba(255,255,255,0.03)',
                  }}
                >
                  <div style={{ fontSize: 26, marginBottom: 8 }}>📎</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 5 }}>PDF를 여기에 끌어다 놓거나 눌러서 고르세요</div>
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.3)', fontWeight: 300, lineHeight: 1.6 }}>
                    파일은 이 브라우저 안에서만 열립니다 — 어디로도 올라가지 않아요
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
                  <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}>페이지</span>
                  <input
                    type="number" min="1" placeholder="처음" value={range.from}
                    onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                    style={{ ...selectStyle, width: 74 }}
                  />
                  <span style={{ color: 'rgba(255,255,255,0.25)' }}>~</span>
                  <input
                    type="number" min="1" placeholder="끝" value={range.to}
                    onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                    style={{ ...selectStyle, width: 74 }}
                  />
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: 300 }}>비우면 전체</span>
                </div>

                <input
                  ref={fileRef} type="file" accept="application/pdf" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; loadPdf(f) }}
                />
              </div>
            )}

            {/* 2) 추출 중 */}
            {stage === 'extracting' && (
              <div style={{ padding: '10px 0 4px' }}>
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>
                  {progress.note} {progress.total ? `· ${progress.done} / ${progress.total} 페이지` : ''}
                </div>
                <Bar value={progress.total ? progress.done / progress.total : 0} />
              </div>
            )}

            {/* 3) 준비됨 → 언어 고르고 번역 */}
            {(stage === 'ready' || stage === 'translating') && doc && (
              <div>
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.55)', marginBottom: 4, wordBreak: 'break-all' }}>{file?.name}</div>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.3)', fontWeight: 300, marginBottom: 16 }}>
                  {doc.pageCount}쪽 · 문단 {doc.paragraphs.length}개 · {doc.charCount.toLocaleString()}자
                </div>

                {doc.likelyScanned && (
                  <div style={{
                    background: 'rgba(233,213,160,0.1)', border: '1px solid rgba(233,213,160,0.3)', borderRadius: 11,
                    padding: '11px 13px', fontSize: 12, color: 'rgba(233,213,160,0.9)', fontWeight: 300, lineHeight: 1.65, marginBottom: 14,
                  }}>
                    글자가 거의 안 나왔어요 — 스캔한 PDF 같습니다.
                    <button onClick={() => loadPdf(file, { ocr: true })} style={{ ...ghostBtn, marginTop: 9, display: 'block' }}>
                      이미지에서 글자 읽기 (OCR · 느립니다)
                    </button>
                  </div>
                )}

                <div style={labelStyle}>원문 언어</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
                  <select value={source} onChange={(e) => setSource(e.target.value)} style={selectStyle}>
                    {SOURCE_LANGS.map((l) => <option key={l.code} value={l.code} style={{ background: '#151a26' }}>{l.label}</option>)}
                  </select>
                  <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.3)' }}>→ 한국어</span>
                  {source === 'auto' && detected && (
                    <span style={{ fontSize: 11.5, color: 'rgba(134,239,172,0.75)' }}>감지됨: {srcLabel}</span>
                  )}
                </div>

                <div style={{
                  fontSize: 11.5, fontWeight: 300, lineHeight: 1.65, marginBottom: 16,
                  color: engineNote.ok ? 'rgba(255,255,255,0.42)' : 'rgba(252,165,165,0.85)',
                }}>{engineNote.text}</div>

                {stage === 'translating' ? (
                  <div>
                    <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>
                      {progress.note || `번역 중 · ${progress.done} / ${progress.total} 문단`}
                    </div>
                    <Bar value={progress.total ? progress.done / progress.total : 0} />
                    <button onClick={() => { cancelRef.current = true }} style={{ ...ghostBtn, marginTop: 12 }}>중단</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={translateAll} disabled={!engineNote.ok} style={{
                      ...primaryBtn, ...(engineNote.ok ? {} : { filter: 'saturate(0.3) brightness(0.7)', cursor: 'default', boxShadow: 'none' }),
                    }}>번역 시작</button>
                    <button onClick={reset} style={ghostBtn}>다른 파일</button>
                  </div>
                )}
              </div>
            )}

            {/* 4) 결과 */}
            {stage === 'done' && doc && (
              <div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                  <button onClick={() => setOnlyTarget((v) => !v)} style={ghostBtn}>
                    {onlyTarget ? '원문 같이 보기' : '번역만 보기'}
                  </button>
                  <button onClick={copy} style={ghostBtn}>복사</button>
                  <button onClick={download} style={ghostBtn}>.txt 저장</button>
                  <button onClick={reset} style={ghostBtn}>다른 파일</button>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' }}>
                    {engineKind === 'server' ? '서버 번역' : '브라우저 내장 번역기'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {doc.paragraphs.map((p, i) => (
                    <div key={i} style={{
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.09)',
                      borderRadius: 12, padding: '12px 14px',
                    }}>
                      {(i === 0 || doc.paragraphs[i - 1].page !== p.page) && (
                        <div style={{ fontSize: 9.5, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.22)', marginBottom: 8 }}>
                          P.{p.page}
                        </div>
                      )}
                      {!onlyTarget && (
                        <div style={{
                          fontSize: 12, fontWeight: 300, lineHeight: 1.7, color: 'rgba(255,255,255,0.4)',
                          marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.07)',
                        }}>{p.text}</div>
                      )}
                      <div style={{ fontSize: 13.5, fontWeight: 300, lineHeight: 1.85, color: 'rgba(255,255,255,0.87)' }}>
                        {translated[i]}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div style={{
                marginTop: 14, background: 'rgba(252,165,165,0.1)', border: '1px solid rgba(252,165,165,0.3)',
                borderRadius: 11, padding: '10px 13px', fontSize: 12, color: 'rgba(252,165,165,0.9)',
                fontWeight: 300, lineHeight: 1.6,
              }}>{error}</div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
