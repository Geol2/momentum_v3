import { useEffect, useRef, useState } from 'react'
import { uploadRecording } from '../lib/uploadRecording.js'
import { isIOS } from '../lib/inAppBrowser.js'

/**
 * 🎙 회의록 녹음 — 1단계: 브라우저 안에서만 동작합니다.
 *
 * 녹음 → 재생 → 다운로드, 그리고 브라우저 내장 음성인식(Web Speech API)으로 실시간 전사.
 * 서버 업로드도 유료 STT API도 아직 쓰지 않습니다. 목적은 "한국어 텍스트가 쓸 만하게
 * 나오는가"를 비용 없이 확인하는 것 — 품질을 보고 나서 저장소와 STT를 결정합니다.
 *
 * 알려진 한계:
 *  - 실시간 전사는 Chrome/Edge 계열에서만 동작합니다 (Web Speech API 미구현 브라우저 존재).
 *  - Chrome의 음성인식은 오디오를 구글 서버로 보냅니다. 민감한 회의라면 전사를 끄고
 *    녹음만 하세요 — 녹음 자체는 이 기기 밖으로 나가지 않습니다.
 *  - 녹음 파일은 페이지를 벗어나면 사라집니다. 필요하면 반드시 내려받으세요.
 */

// 브라우저마다 지원 코덱이 다릅니다. Chrome/Android는 webm/opus, iOS Safari는 mp4/aac.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return '' // 빈 문자열 = 브라우저 기본값에 맡김
}

function extFor(mime) {
  if (!mime) return 'webm'
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

function fmtTime(total) {
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

const SpeechRecognitionCtor =
  typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

export default function MeetingRecorder() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('idle')   // idle | recording | done
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)          // 0..1 마이크 입력 레벨
  const [error, setError] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [sttEnabled, setSttEnabled] = useState(true)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  // 음성인식이 실제로 살아있는지 화면에 드러냅니다. 조용히 죽으면 사용자는
  // "왜 텍스트가 안 나오지"만 알 뿐 이유를 알 수 없습니다.
  const [sttState, setSttState] = useState('off') // off | starting | listening | error
  const [sttError, setSttError] = useState('')

  // 서버 업로드는 status(idle|recording|done)와 별개로 둡니다. 같은 변수에 섞으면
  // status === 'done'으로 분기하는 결과 패널이 업로드 중에 사라집니다.
  const [upload, setUpload] = useState('idle')   // idle | uploading | saved | error
  const [uploadError, setUploadError] = useState('')
  const [title, setTitle] = useState('')
  const [autoTitle, setAutoTitle] = useState('')
  // 녹음 중 화면이 꺼지거나(잠금) 다른 앱으로 전환돼 녹음이 끊긴 경우 true.
  const [interrupted, setInterrupted] = useState(false)

  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const blobRef = useRef(null)       // 업로드용 원본 — audioUrl로는 되돌릴 수 없습니다
  const mimeRef = useRef('')
  const audioCtxRef = useRef(null)
  const rafRef = useRef(null)
  const timerRef = useRef(null)
  const recognitionRef = useRef(null)
  const wantSttRef = useRef(false)   // onend에서 재시작할지 여부
  const wakeLockRef = useRef(null)
  const transcriptRef = useRef(null) // 자동 스크롤용
  // status(state)는 visibilitychange 콜백 안에서 최신값을 못 읽으므로 ref로도 미러링합니다.
  const recordingRef = useRef(false)

  const supported = typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined'

  // 아이폰(및 iOS 크롬)은 화면이 꺼지면 페이지를 정지시켜 웹 녹음이 끊깁니다. 그리고 iOS
  // 크롬(CriOS)은 화면 잠금 방지(wakeLock)를 아예 지원하지 않아 Safari보다 더 잘 끊깁니다.
  const ios = isIOS()
  const iosChrome = ios && /CriOS/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')

  // 전사 영역은 새 문장이 들어올 때마다 맨 아래로.
  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [transcript, interim])

  // 페이지를 벗어나거나 컴포넌트가 사라질 때 마이크를 확실히 놓아줍니다.
  useEffect(() => () => teardown(), [])

  function teardown() {
    recordingRef.current = false
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    wantSttRef.current = false
    try { recognitionRef.current?.stop() } catch { /* 이미 멈춤 */ }
    recognitionRef.current = null
    try { recorderRef.current?.stop() } catch { /* 이미 멈춤 */ }
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
  }

  // ── 화면 잠금 방지 & 녹음 중단 감지 ─────────────────────────────────────────
  // iOS/Safari는 페이지가 잠깐이라도 가려지면 wakeLock을 풀어버립니다. 녹음 중에는 화면이
  // 다시 보일 때마다 다시 잡아줘야 자동 잠금으로 녹음이 끊기지 않습니다. (iOS 크롬은
  // wakeLock 자체가 없어 조용히 실패 — 그래서 화면 상단에 경고 배너로 안내합니다.)
  async function acquireWakeLock() {
    if (!recordingRef.current) return
    try {
      wakeLockRef.current = await navigator.wakeLock?.request('screen')
    } catch { /* 미지원 또는 거부 — 무시 */ }
  }

  // 화면이 꺼지거나 다른 앱으로 전환되면 iOS는 페이지를 정지시켜 녹음이 끊깁니다. 예전에는
  // 조용히 실패해서 사용자는 "왜 안 됐지"만 알았습니다. 이제는 중단을 감지해 알리고,
  // 끊기기 전까지 녹음한 부분은 저장할 수 있게 정리합니다.
  function handleInterruption() {
    if (!recordingRef.current) return
    recordingRef.current = false
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    setLevel(0)
    wantSttRef.current = false
    try { recognitionRef.current?.stop() } catch { /* 이미 멈춤 */ }
    recognitionRef.current = null
    setInterim('')

    const rec = recorderRef.current
    recorderRef.current = null
    try {
      // 아직 살아 있으면 stop() → onstop이 blob을 만듭니다. 이미 죽었으면(iOS가 정지시킴)
      // onstop이 못 도니, 모아둔 청크로 여기서 직접 blob을 만들어 둡니다.
      if (rec && rec.state !== 'inactive') {
        rec.stop()
      } else if (!blobRef.current && chunksRef.current.length) {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' })
        blobRef.current = blob
        setAutoTitle(`회의록_${stamp()}`)
        setAudioUrl(URL.createObjectURL(blob))
      }
    } catch { /* 이미 멈춤 */ }

    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null

    setInterrupted(true)
    setStatus('done')
  }

  // 화면이 다시 켜질 때마다 wakeLock을 다시 잡고, 백그라운드 동안 녹음이 죽었으면 중단 처리.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState !== 'visible' || !recordingRef.current) return
      acquireWakeLock()
      if (recorderRef.current && recorderRef.current.state === 'inactive') {
        handleInterruption()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // ── 마이크 입력 레벨 (녹음이 실제로 들어오고 있는지 눈으로 확인) ──────────────
  function startMeter(stream) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)

      const tick = () => {
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (const v of buf) {
          const n = (v - 128) / 128
          sum += n * n
        }
        // RMS를 살짝 부풀려야 일반적인 말소리에서 미터가 눈에 띄게 움직입니다.
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3.2))
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      /* 레벨 미터는 부가 기능 — 실패해도 녹음은 계속됩니다 */
    }
  }

  // ── 실시간 전사 ────────────────────────────────────────────────────────────
  function startStt() {
    if (!SpeechRecognitionCtor || !sttEnabled) return
    const rec = new SpeechRecognitionCtor()
    rec.lang = 'ko-KR'
    rec.continuous = true
    rec.interimResults = true

    rec.onresult = (event) => {
      let finals = ''
      let pending = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]
        if (r.isFinal) finals += r[0].transcript
        else pending += r[0].transcript
      }
      if (finals) setTranscript((prev) => (prev ? `${prev} ${finals.trim()}` : finals.trim()))
      setInterim(pending)
    }

    rec.onstart = () => { setSttState('listening'); setSttError('') }

    rec.onerror = (e) => {
      // no-speech/aborted는 정적이 길거나 우리가 멈춘 경우 — 정상 동작입니다.
      if (e.error === 'no-speech' || e.error === 'aborted') return

      // 나머지는 전부 표면화합니다. 이전에는 조용히 삼켜서, 인식이 죽어도
      // 화면상으로는 멀쩡해 보였습니다.
      const KNOWN = {
        'not-allowed': '음성인식 권한이 거부됐어요. 주소창 자물쇠 → 마이크를 허용해 주세요.',
        'service-not-allowed': '브라우저가 음성인식 서비스를 막았어요.',
        'audio-capture': '마이크를 음성인식이 잡지 못했어요. 녹음기와 충돌한 것 같아요.',
        'network': '음성인식 서버에 연결하지 못했어요 (네트워크). 녹음은 계속됩니다.',
        'language-not-supported': '이 브라우저에서 한국어 인식을 지원하지 않아요.',
      }
      setSttState('error')
      setSttError(KNOWN[e.error] || `음성인식 오류: ${e.error}`)
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantSttRef.current = false
      }
    }

    // Chrome은 정적이 이어지면 인식기를 임의로 종료합니다. 녹음 중이면 즉시 되살립니다.
    rec.onend = () => {
      if (!wantSttRef.current) return
      try { rec.start() } catch { /* 재시작 경합 — 다음 onend에서 다시 시도 */ }
    }

    wantSttRef.current = true
    setSttState('starting')
    setSttError('')
    try {
      rec.start()
    } catch (e) {
      // start()가 던지면 인식은 아예 시작되지 않습니다. 이걸 삼키면 원인을 알 수 없습니다.
      setSttState('error')
      setSttError(`음성인식을 시작하지 못했어요: ${e.name || e.message}`)
    }
    recognitionRef.current = rec
  }

  // ── 녹음 시작/종료 ─────────────────────────────────────────────────────────
  async function start() {
    setError(null)
    setTranscript('')
    setInterim('')
    setUpload('idle')
    setUploadError('')
    setTitle('')
    setAutoTitle('')
    setInterrupted(false)
    blobRef.current = null
    if (audioUrl) { URL.revokeObjectURL(audioUrl); setAudioUrl(null) }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // 말소리만 담으면 되므로 모노로 받습니다. 아래 32kbps에서 스테레오로 쪼개는
        // 것보다 한 채널에 몰아주는 쪽이 알아듣기 좋습니다.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
    } catch (e) {
      setError(e.name === 'NotAllowedError'
        ? '마이크 권한이 필요해요. 브라우저 주소창의 자물쇠 아이콘에서 허용해 주세요.'
        : '마이크를 열지 못했어요. 다른 앱이 사용 중인지 확인해 주세요.')
      return
    }
    streamRef.current = stream
    // 마이크 트랙이 끊기면(화면 잠금·다른 앱의 마이크 선점 등) 녹음도 사실상 끝난 것 —
    // 중단으로 처리해 사용자에게 알립니다.
    stream.getAudioTracks().forEach((t) => { t.onended = () => handleInterruption() })

    const mime = pickMime()
    mimeRef.current = mime
    chunksRef.current = []
    // mimeType은 pickMime()이 고른 값을 그대로 씁니다 — iOS Safari는 webm을 만들지
    // 못해서 하드코딩하면 생성 자체가 실패합니다. 비트레이트만 낮춰 잡으면
    // 1시간에 약 14MB로, Cloudflare 100MB 제한에 여유가 생깁니다.
    const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 })
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' })
      // 업로드는 사용자가 버튼을 누를 때 하므로 blob을 들고 있어야 합니다.
      // audioUrl에서는 blob을 되찾을 수 없습니다.
      blobRef.current = blob
      setAutoTitle(`회의록_${stamp()}`)
      setAudioUrl(URL.createObjectURL(blob))
    }
    // 1초 단위로 청크를 뱉게 해서, 브라우저가 중간에 죽어도 앞부분은 남습니다.
    recorder.start(1000)
    recorderRef.current = recorder

    startMeter(stream)
    startStt()

    // 화면이 꺼지면 모바일에서 녹음이 끊깁니다. 지원하는 기기에서는 켜둔 채로 유지하고,
    // 잠깐 가려졌다 돌아오면 visibilitychange에서 다시 잡습니다(iOS/Safari는 자동으로 풉니다).
    recordingRef.current = true
    acquireWakeLock()

    setSeconds(0)
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    setStatus('recording')
  }

  function stop() {
    // 정상 종료. 아래에서 트랙을 멈추면 track.onended가 불리는데, 이 플래그를 먼저 내려서
    // handleInterruption이 "중단"으로 오인하지 않게 합니다.
    recordingRef.current = false
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    setLevel(0)

    wantSttRef.current = false
    try { recognitionRef.current?.stop() } catch { /* 이미 멈춤 */ }
    recognitionRef.current = null
    setInterim('')
    if (sttState !== 'error') setSttState('off')

    try { recorderRef.current?.stop() } catch { /* 이미 멈춤 */ }
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null

    setStatus('done')
  }

  function close() {
    if (status === 'recording') stop()
    setOpen(false)
  }

  function download(url, filename) {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }

  // 업로드는 자동이 아니라 버튼입니다. 1시간짜리를 종료 즉시 밀어올리면 취소도
  // 재시도도 못 하고, 실패하면 회의 하나가 통째로 날아갑니다.
  async function saveToServer() {
    const blob = blobRef.current
    if (!blob || upload === 'uploading') return
    const name = title.trim() || autoTitle
    setUpload('uploading')
    setUploadError('')
    try {
      await uploadRecording(blob, { title: name, filename: `${name}.${extFor(mimeRef.current)}` })
      setUpload('saved')
    } catch (e) {
      // 실패해도 blob은 그대로 들고 있습니다 — 다시 시도하거나 내려받을 수 있습니다.
      setUpload('error')
      setUploadError(e.message || '업로드에 실패했어요.')
    }
  }

  function downloadTranscript() {
    const url = URL.createObjectURL(new Blob([transcript], { type: 'text/plain;charset=utf-8' }))
    download(url, `회의록_${stamp()}.txt`)
    URL.revokeObjectURL(url)
  }

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(transcript)
      setError({ ok: true, text: '전사 내용을 복사했어요.' })
      setTimeout(() => setError(null), 2000)
    } catch {
      setError('복사에 실패했어요. 직접 선택해서 복사해 주세요.')
    }
  }

  const errText = typeof error === 'string' ? error : error?.text
  const errOk = typeof error === 'object' && error?.ok
  // 인식 결과가 아직 없어도, 전사가 돌고 있는 동안에는 상자를 보여줍니다.
  const showTranscriptPanel = status === 'recording' && sttEnabled && !!SpeechRecognitionCtor

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="회의록 녹음"
        style={{
          position: 'fixed', bottom: 24, right: 142, zIndex: 100,
          width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(16px)',
          color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="11" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <path d="M12 17v4" />
        </svg>
      </button>

      {open && (
        <div
          onClick={close}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(8,10,20,0.62)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px',
            animation: 'backdropIn 0.3s ease both',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="thin-scroll"
            style={{
              position: 'relative', width: '100%', maxWidth: 460, maxHeight: '84vh', overflowY: 'auto',
              background: 'rgba(18,22,34,0.92)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18,
              padding: '22px 22px 24px', backdropFilter: 'blur(24px)',
              boxShadow: '0 30px 70px rgba(0,0,0,0.55)', animation: 'itemIn 0.3s cubic-bezier(0.16,1,0.3,1) both',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>🎙</span>
                <span style={{ fontSize: 14, fontWeight: 400, color: 'rgba(255,255,255,0.9)', fontFamily: "'Noto Sans KR', sans-serif", letterSpacing: '0.02em' }}>회의록 녹음</span>
              </div>
              <button
                onClick={close}
                title="닫기"
                style={{
                  width: 28, height: 28, minWidth: 28, border: 'none', background: 'rgba(255,255,255,0.06)', borderRadius: 8,
                  color: 'rgba(255,255,255,0.55)', fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', padding: 0, cursor: 'pointer',
                }}
              >×</button>
            </div>

            {!supported ? (
              <div style={{ textAlign: 'center', padding: '28px 0', color: 'rgba(255,255,255,0.4)', fontSize: 12.5, fontWeight: 300, fontFamily: "'Noto Sans KR', sans-serif", lineHeight: 1.7 }}>
                이 브라우저는 녹음을 지원하지 않아요.<br />
                카카오톡 인앱 브라우저라면 Chrome이나 Safari로 열어주세요.
              </div>
            ) : (
              <>
                {/* 아이폰 경고 — 웹은 화면이 꺼지면 녹음을 이어갈 수 없습니다(iOS 제약). */}
                {ios && (
                  <div style={{
                    fontSize: 11, lineHeight: 1.6, marginBottom: 12, padding: '9px 11px', borderRadius: 9,
                    background: 'rgba(230,180,90,0.10)', border: '1px solid rgba(230,180,90,0.32)',
                    color: 'rgba(240,208,145,0.95)', fontFamily: "'Noto Sans KR', sans-serif",
                  }}>
                    ⚠️ 아이폰은 녹음 중 화면이 꺼지면 녹음이 멈춰요. 화면을 켜둔 채로 진행해 주세요.
                    {iosChrome && <><br />크롬보다 <b>Safari</b>에서 더 안정적으로 동작합니다.</>}
                  </div>
                )}

                {/* 타이머 + 레벨 미터 */}
                <div style={{
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 14, padding: '18px 16px', marginBottom: 14, textAlign: 'center',
                }}>
                  <div style={{
                    fontSize: 34, fontWeight: 200, letterSpacing: '0.04em', fontFamily: 'Outfit, sans-serif',
                    color: status === 'recording' ? 'rgba(255,150,150,0.95)' : 'rgba(255,255,255,0.75)',
                  }}>{fmtTime(seconds)}</div>

                  <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', margin: '12px 20px 0', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${Math.round(level * 100)}%`,
                      background: 'linear-gradient(90deg, rgba(99,179,237,0.8), rgba(150,220,255,0.95))',
                      transition: 'width 0.08s linear',
                    }} />
                  </div>

                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', fontFamily: "'Noto Sans KR', sans-serif", marginTop: 9 }}>
                    {status === 'recording' ? '녹음 중… 말소리에 따라 막대가 움직이면 정상이에요'
                      : status === 'done' ? '녹음 완료'
                      : '마이크 권한을 허용하면 녹음이 시작됩니다'}
                  </div>
                </div>

                {/* 녹음 버튼 */}
                {status !== 'recording' ? (
                  <button
                    onClick={start}
                    style={{
                      width: '100%', padding: '13px 0', borderRadius: 12, cursor: 'pointer',
                      background: 'rgba(255,120,120,0.16)', border: '1px solid rgba(255,120,120,0.4)',
                      color: 'rgba(255,175,175,0.95)', fontSize: 13.5, fontFamily: "'Noto Sans KR', sans-serif",
                    }}
                  >● {status === 'done' ? '다시 녹음' : '녹음 시작'}</button>
                ) : (
                  <button
                    onClick={stop}
                    style={{
                      width: '100%', padding: '13px 0', borderRadius: 12, cursor: 'pointer',
                      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
                      color: 'rgba(255,255,255,0.9)', fontSize: 13.5, fontFamily: "'Noto Sans KR', sans-serif",
                    }}
                  >■ 녹음 종료</button>
                )}

                {/* 실시간 전사 스위치 */}
                {SpeechRecognitionCtor ? (
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginTop: 13, cursor: status === 'recording' ? 'default' : 'pointer',
                    fontSize: 11.5, color: 'rgba(255,255,255,0.55)', fontFamily: "'Noto Sans KR', sans-serif",
                  }}>
                    <input
                      type="checkbox"
                      checked={sttEnabled}
                      disabled={status === 'recording'}
                      onChange={(e) => setSttEnabled(e.target.checked)}
                      style={{ accentColor: 'rgba(99,179,237,0.9)', width: 15, height: 15 }}
                    />
                    실시간 텍스트 변환 (녹음 중에는 변경할 수 없어요)
                  </label>
                ) : (
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', fontFamily: "'Noto Sans KR', sans-serif", marginTop: 13, lineHeight: 1.6 }}>
                    이 브라우저는 실시간 텍스트 변환을 지원하지 않아요. 녹음은 정상 동작합니다.
                  </div>
                )}

                {sttError && (
                  <div style={{
                    fontSize: 11, lineHeight: 1.6, marginTop: 10, padding: '9px 11px', borderRadius: 9,
                    background: 'rgba(255,120,120,0.09)', border: '1px solid rgba(255,120,120,0.28)',
                    color: 'rgba(255,180,180,0.92)', fontFamily: "'Noto Sans KR', sans-serif",
                  }}>{sttError}</div>
                )}

                {errText && (
                  <div style={{
                    fontSize: 11, lineHeight: 1.6, marginTop: 11, fontFamily: "'Noto Sans KR', sans-serif",
                    color: errOk ? 'rgba(160,225,190,0.9)' : 'rgba(255,170,170,0.85)',
                  }}>{errText}</div>
                )}

                {/* 전사 결과 — 녹음이 시작되면 내용이 없어도 상자를 먼저 띄웁니다.
                    첫 단어가 인식될 때까지 화면에 아무것도 없으면 어디를 봐야 하는지,
                    인식이 되고는 있는 건지 알 수가 없습니다. */}
                {(showTranscriptPanel || transcript || interim) && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
                      color: 'rgba(255,255,255,0.35)', fontFamily: 'Outfit, sans-serif', marginBottom: 8,
                    }}>
                      <span>TRANSCRIPT</span>
                      {status === 'recording' && sttState !== 'off' && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5, letterSpacing: 0, textTransform: 'none',
                          fontFamily: "'Noto Sans KR', sans-serif", fontSize: 10.5,
                          color: sttState === 'error' ? 'rgba(255,170,170,0.85)' : 'rgba(150,205,255,0.75)',
                        }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: sttState === 'error' ? 'rgba(255,120,120,0.95)'
                              : sttState === 'listening' ? 'rgba(120,220,160,0.95)' : 'rgba(230,200,120,0.95)',
                            animation: sttState === 'listening' ? 'pulse 1.4s ease-in-out infinite' : 'none',
                          }} />
                          {sttState === 'listening' ? '인식 중' : sttState === 'starting' ? '시작하는 중' : '인식 오류'}
                        </span>
                      )}
                    </div>
                    <div
                      ref={transcriptRef}
                      className="thin-scroll"
                      style={{
                        background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
                        padding: '12px 14px', maxHeight: 180, overflowY: 'auto',
                        fontSize: 12.5, lineHeight: 1.75, fontWeight: 300, color: 'rgba(255,255,255,0.82)',
                        fontFamily: "'Noto Sans KR', sans-serif", whiteSpace: 'pre-wrap',
                      }}
                    >
                      {transcript}
                      {interim && <span style={{ color: 'rgba(255,255,255,0.38)' }}>{transcript ? ' ' : ''}{interim}</span>}
                      {!transcript && !interim && (
                        <span style={{ color: 'rgba(255,255,255,0.3)' }}>
                          {status === 'recording'
                            ? '말씀하시면 여기에 텍스트가 나타납니다…'
                            : '녹음을 시작하면 여기에 텍스트가 나타납니다.'}
                        </span>
                      )}
                    </div>

                    {transcript && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                        <SmallBtn onClick={copyTranscript}>복사</SmallBtn>
                        <SmallBtn onClick={downloadTranscript}>텍스트 저장</SmallBtn>
                      </div>
                    )}
                  </div>
                )}

                {/* 녹음 결과 재생 / 저장 */}
                {status === 'done' && audioUrl && (
                  <div style={{ marginTop: 16 }}>
                    {/* 녹음이 중단으로 끝난 경우 안내 — 조용히 실패하지 않도록. */}
                    {interrupted && (
                      <div style={{
                        fontSize: 11, lineHeight: 1.6, marginBottom: 12, padding: '9px 11px', borderRadius: 9,
                        background: 'rgba(255,120,120,0.10)', border: '1px solid rgba(255,120,120,0.3)',
                        color: 'rgba(255,182,182,0.95)', fontFamily: "'Noto Sans KR', sans-serif",
                      }}>
                        ⚠️ 녹음이 중단됐어요. 화면이 꺼졌거나 다른 앱으로 전환된 것 같아요.
                        끊기기 전까지 녹음한 부분은 아래에서 저장하거나 내려받을 수 있어요.
                      </div>
                    )}
                    <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', fontFamily: 'Outfit, sans-serif', marginBottom: 8 }}>
                      RECORDING
                    </div>
                    <audio src={audioUrl} controls style={{ width: '100%', height: 38 }} />

                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={autoTitle}
                      disabled={upload === 'uploading' || upload === 'saved'}
                      style={{
                        width: '100%', boxSizing: 'border-box', marginTop: 9, padding: '9px 11px',
                        background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9,
                        color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontWeight: 300,
                        fontFamily: "'Noto Sans KR', sans-serif", outline: 'none',
                      }}
                    />

                    <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                      <SmallBtn
                        onClick={saveToServer}
                        disabled={upload === 'uploading' || upload === 'saved'}
                        tone={upload === 'saved' ? 'ok' : upload === 'error' ? 'warn' : 'primary'}
                      >
                        {upload === 'uploading' ? '업로드 중…'
                          : upload === 'saved' ? '✓ 저장 완료'
                          : upload === 'error' ? '다시 시도'
                          : '☁ 서버에 저장'}
                      </SmallBtn>
                      <SmallBtn onClick={() => download(audioUrl, `${title.trim() || autoTitle}.${extFor(mimeRef.current)}`)}>
                        녹음 파일 저장
                      </SmallBtn>
                    </div>

                    {uploadError && (
                      <div style={{
                        fontSize: 11, lineHeight: 1.6, marginTop: 9, padding: '9px 11px', borderRadius: 9,
                        background: 'rgba(255,120,120,0.09)', border: '1px solid rgba(255,120,120,0.28)',
                        color: 'rgba(255,180,180,0.92)', fontFamily: "'Noto Sans KR', sans-serif",
                      }}>{uploadError}<br />녹음은 아직 여기 있어요 — 다시 시도하거나 파일로 내려받으세요.</div>
                    )}

                    <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)', fontFamily: "'Noto Sans KR', sans-serif", marginTop: 10, lineHeight: 1.6 }}>
                      {upload === 'saved'
                        ? '서버에 저장했어요. 이 창의 녹음본은 창을 닫으면 사라집니다.'
                        : '아직 서버에 저장되지 않아요. 창을 닫으면 사라지니 먼저 저장하거나 내려받으세요.'}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const TONES = {
  default: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(185,222,255,0.9)' },
  primary: { background: 'rgba(99,179,237,0.16)', border: '1px solid rgba(99,179,237,0.45)', color: 'rgba(190,225,255,0.95)' },
  ok:      { background: 'rgba(120,220,160,0.12)', border: '1px solid rgba(120,220,160,0.4)', color: 'rgba(170,230,195,0.95)' },
  warn:    { background: 'rgba(255,120,120,0.12)', border: '1px solid rgba(255,120,120,0.4)', color: 'rgba(255,180,180,0.95)' },
}

function SmallBtn({ onClick, children, disabled = false, tone = 'default' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1, padding: '8px 0', borderRadius: 9, cursor: disabled ? 'default' : 'pointer',
        ...TONES[tone], opacity: disabled ? 0.6 : 1, fontSize: 11.5, fontFamily: "'Noto Sans KR', sans-serif",
      }}
    >{children}</button>
  )
}
