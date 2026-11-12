import { useEffect, useRef, useState } from 'react'
import { onSecret } from './easter-egg.js'

// 숨겨진 게임 2: 우리 우주 탐험 🌌
// - 시계 위 「우주」 버튼
// - 큰 시계를 1.5초 안에 7번 클릭(탭)
// - 또는 키보드로 ↑↑↓↓←→←→BA / "universe" 입력
// 게임 코드는 트리거될 때만 lazy import 되므로 메인 번들에는 영향이 없다.
export default function UniverseGame() {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState('loading') // loading | ready | error
  const hostRef = useRef(null)

  useEffect(() => onSecret(() => setOpen(true), { tapSelector: '[data-universe-trigger]', taps: 7 }), [])
  // 시계 위 「우주」 버튼
  useEffect(() => {
    const open = () => setOpen(true)
    window.addEventListener('momentum:open-universe', open)
    return () => window.removeEventListener('momentum:open-universe', open)
  }, [])

  useEffect(() => {
    if (!open || !hostRef.current) return
    let game
    let cancelled = false
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    setPhase('loading')
    // 별·지구 자료를 폰에 저장해 두는 서비스 워커(알림용과 같은 파일) — 두 번째 진입부터 바로 열림
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    import('./universe-explorer.js')
      .then(async ({ mountUniverseExplorer }) => {
        // 안내 문구가 화면에 먼저 그려진 뒤 무거운 초기화(지구 텍스처 생성)를 시작
        await frame()
        if (cancelled || !hostRef.current) return
        game = mountUniverseExplorer(hostRef.current, { onClose: () => setOpen(false) })
        await frame()
        if (!cancelled) setPhase('ready')
      })
      .catch((err) => {
        console.warn('우주 탐험을 불러오지 못했어요', err)
        if (!cancelled) setPhase('error')
      })

    return () => {
      cancelled = true
      game?.destroy()
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  if (!open) return null
  return (
    <>
      <div ref={hostRef} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000' }} />
      {phase !== 'ready' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1001, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
          background: 'radial-gradient(ellipse at 50% 55%, #06140c 0%, #000 70%)', color: '#3dff8f',
          fontFamily: '"SF Mono", Menlo, Consolas, "Apple SD Gothic Neo", "Noto Sans KR", monospace', fontSize: 12, letterSpacing: '0.08em',
          textShadow: '0 0 8px rgba(61,255,143,.6)',
        }}>
          {phase === 'loading' ? (
            <>
              <div style={{ width: 34, height: 34, border: '2px solid rgba(61,255,143,.25)', borderTopColor: '#3dff8f', borderRadius: '50%', animation: 'muSpin 0.9s linear infinite' }} />
              <div>우주로 가는 중…</div>
              <div style={{ fontSize: 10, color: 'rgba(61,255,143,.6)' }}>처음엔 별·지구 자료를 받느라 몇 초 걸려요</div>
              <style>{'@keyframes muSpin{to{transform:rotate(360deg)}}'}</style>
            </>
          ) : (
            <>
              <div>우주를 불러오지 못했어요</div>
              <div style={{ fontSize: 10, color: 'rgba(61,255,143,.6)' }}>새 버전이 배포됐거나 연결이 불안정할 수 있어요</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => window.location.reload()} style={btnStyle}>새로고침</button>
                <button type="button" onClick={() => setOpen(false)} style={btnStyle}>닫기</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

const btnStyle = {
  border: '1px solid rgba(61,255,143,.6)', background: 'rgba(61,255,143,.15)', color: '#eafff2', fontFamily: 'inherit',
  fontSize: 11, padding: '7px 14px', cursor: 'pointer',
}
