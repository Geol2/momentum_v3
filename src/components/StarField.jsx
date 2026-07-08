import { useEffect, useRef } from 'react'
import { BACKGROUNDS } from '../lib/data.js'

// Fullscreen scenery photo background with a readability overlay.
export default function StarField({ background }) {
  const bg = BACKGROUNDS.find((b) => b.k === background) || BACKGROUNDS[0]

  // Previous background stays underneath while the new one fades in.
  const prevBgRef = useRef(bg)
  useEffect(() => { prevBgRef.current = bg }, [bg])

  return (
    <>
      <div className="bg-layer" style={{ background: prevBgRef.current.css }} />
      <div key={bg.k} className="bg-layer" style={{ background: bg.css, animation: 'backdropIn 0.9s ease both' }} />
    </>
  )
}
