import { useEffect, useRef, useState } from 'react'
import { onSecret } from './easter-egg.js'

// 숨겨진 게임 2: 우리 우주 탐험 🌌
// - 시계 위 「우주」 버튼
// - 큰 시계를 1.5초 안에 7번 클릭(탭)
// - 또는 키보드로 ↑↑↓↓←→←→BA / "universe" 입력
// 게임 코드는 트리거될 때만 lazy import 되므로 메인 번들에는 영향이 없다.
export default function UniverseGame() {
  const [open, setOpen] = useState(false)
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

    import('./universe-explorer.js').then(({ mountUniverseExplorer }) => {
      if (cancelled || !hostRef.current) return
      game = mountUniverseExplorer(hostRef.current, { onClose: () => setOpen(false) })
    })

    return () => {
      cancelled = true
      game?.destroy()
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  if (!open) return null
  return <div ref={hostRef} style={{ position: 'fixed', inset: 0, zIndex: 1000 }} />
}
