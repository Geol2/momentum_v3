import { Suspense, lazy, useCallback, useRef, useState } from 'react'

// The 3D game is a heavy chunk (three.js ~600KB). Lazy-load it so it only ships
// to the browser when the easter egg is actually triggered — the main app bundle
// stays untouched.
const Game3D = lazy(() => import('./Game3D.jsx'))

const CLICKS_NEEDED = 5
const WINDOW_MS = 3000 // all 5 clicks must land within this window

// A hidden easter-egg trigger: an invisible hotspot in the bottom-right corner.
// Click it 5 times within 3 seconds to launch the secret 3D RPG.
export default function HiddenGame() {
  const [open, setOpen] = useState(false)
  const clicks = useRef([])

  const handleHotspotClick = useCallback(() => {
    const now = performance.now()
    // keep only clicks inside the rolling window
    clicks.current = clicks.current.filter((t) => now - t < WINDOW_MS)
    clicks.current.push(now)
    if (clicks.current.length >= CLICKS_NEEDED) {
      clicks.current = []
      setOpen(true)
    }
  }, [])

  return (
    <>
      {/* Invisible hotspot in the bottom-right — nudged left of the ⚙ settings
          button (fixed at right:26/bottom:24) and kept BELOW its z-index (100)
          so the settings button and its panel always stay clickable. */}
      <div
        onClick={handleHotspotClick}
        style={{
          position: 'fixed', right: 84, bottom: 10, width: 60, height: 60,
          zIndex: 95, // above content/copyright, below settings (100)
        }}
        aria-hidden="true"
      />

      {open && (
        <Suspense fallback={<GameLoading />}>
          <Game3D onExit={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}

function GameLoading() {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: '#05060f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'rgba(255,255,255,0.7)', fontFamily: "'Noto Sans KR', sans-serif",
      letterSpacing: '0.1em', fontSize: 15,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 44, height: 44, margin: '0 auto 18px', borderRadius: '50%',
          border: '3px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(150,180,255,0.9)',
          animation: 'spin 0.9s linear infinite',
        }} />
        세계를 여는 중…
      </div>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  )
}
