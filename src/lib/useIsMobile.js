import { useEffect, useState } from 'react'

// True when the viewport is narrow enough that the desktop's fixed-position
// widgets (calendar, weather) would overlap — used to switch to a stacked layout.
export function useIsMobile(breakpoint = 720) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false,
  )
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= breakpoint)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [breakpoint])
  return isMobile
}
