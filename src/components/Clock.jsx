import { useEffect, useRef } from 'react'

const pad = (n) => String(n).padStart(2, '0')

// Big central clock. Re-triggers the `digitIn` animation whenever a segment flips.
export default function Clock({ now, use24h, showSeconds }) {
  let h = now.getHours()
  let ampm = ''
  if (!use24h) {
    ampm = h < 12 ? '오전' : '오후'
    h = h % 12
    if (h === 0) h = 12
  }
  const hh = pad(h)
  const mm = pad(now.getMinutes())
  const ss = pad(now.getSeconds())

  const prev = useRef({})
  const refs = { h: useRef(null), m: useRef(null), s: useRef(null) }

  useEffect(() => {
    const cur = { h: hh, m: mm, s: ss }
    for (const seg of ['h', 'm', 's']) {
      if (prev.current[seg] !== undefined && prev.current[seg] !== cur[seg]) {
        const el = refs[seg].current
        if (el) {
          el.style.animation = 'none'
          void el.offsetWidth
          el.style.animation = 'digitIn 0.5s cubic-bezier(0.16,1,0.3,1)'
        }
      }
    }
    prev.current = cur
  })

  const colon = { display: 'inline-block', animation: 'colonBlink 1s step-start infinite' }

  return (
    <div
      style={{
        fontFamily: 'Outfit, sans-serif',
        fontSize: 'clamp(44px, 12vw, 170px)',
        fontWeight: 400,
        color: 'rgba(255,255,255,0.95)',
        letterSpacing: '-0.02em',
        lineHeight: 0.9,
        userSelect: 'none',
        fontVariantNumeric: 'tabular-nums',
        textShadow: '0 10px 30px rgba(0,0,0,0.7), 0 3px 12px rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'baseline',
        animation: 'fadeUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.07s both',
      }}
    >
      {ampm && (
        <span style={{ fontSize: '0.26em', fontWeight: 300, color: 'rgba(255,255,255,0.7)', marginRight: '0.35em', letterSpacing: '0.04em' }}>
          {ampm}
        </span>
      )}
      <span ref={refs.h} style={{ display: 'inline-block' }}>{hh}</span>
      <span style={colon}>:</span>
      <span ref={refs.m} style={{ display: 'inline-block' }}>{mm}</span>
      {showSeconds && (
        <>
          <span style={colon}>:</span>
          <span ref={refs.s} style={{ display: 'inline-block' }}>{ss}</span>
        </>
      )}
    </div>
  )
}
