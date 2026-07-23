import { useEffect, useRef, useState } from 'react'

// Extract a YouTube video id from a pasted URL or a raw 11-char id.
export function parseVideoId(input) {
  const s = (input || '').trim()
  if (!s) return null
  if (/^[\w-]{11}$/.test(s)) return s
  try {
    const u = new URL(s)
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.slice(1, 12)
      return /^[\w-]{11}$/.test(id) ? id : null
    }
    const v = u.searchParams.get('v')
    if (v && /^[\w-]{11}$/.test(v)) return v
    const m = u.pathname.match(/\/(embed|shorts|v)\/([\w-]{11})/)
    if (m) return m[2]
  } catch {
    /* not a URL — fall through */
  }
  const m = s.match(/([\w-]{11})/)
  return m ? m[1] : null
}

// Load the YouTube IFrame API once, resolving when window.YT is ready.
let ytReadyPromise = null
function loadYT() {
  if (ytReadyPromise) return ytReadyPromise
  ytReadyPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(window.YT)
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT) }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  })
  return ytReadyPromise
}

// Full-width thin top bar (ad-banner style) that plays a per-account YouTube playlist.
export default function MusicPlayer({ tracks, onAdd, onRemove }) {
  const [open, setOpen] = useState(false)
  const [addUrl, setAddUrl] = useState('')
  const [addTitle, setAddTitle] = useState('')
  const [index, setIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')

  const playerRef = useRef(null)
  const hostRef = useRef(null)
  const indexRef = useRef(-1)
  const tracksRef = useRef(tracks)
  const playNextRef = useRef(() => {})
  tracksRef.current = tracks
  indexRef.current = index

  // Tear down the player when the component unmounts.
  useEffect(() => () => { try { playerRef.current?.destroy?.() } catch { /* ignore */ } }, [])

  const ensurePlayer = async () => {
    if (playerRef.current) return playerRef.current
    const YT = await loadYT()
    return new Promise((resolve) => {
      const p = new YT.Player(hostRef.current, {
        height: '0', width: '0',
        playerVars: { autoplay: 0, playsinline: 1 },
        events: {
          onReady: () => resolve(p),
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) playNextRef.current()
            else if (e.data === YT.PlayerState.PLAYING) setPlaying(true)
            else if (e.data === YT.PlayerState.PAUSED) setPlaying(false)
          },
          onError: () => setError('이 곡은 재생할 수 없어요 (삭제됨/임베드 불가)'),
        },
      })
      playerRef.current = p
    })
  }

  const playAt = async (i) => {
    const list = tracksRef.current
    if (!list.length) return
    const idx = ((i % list.length) + list.length) % list.length
    setIndex(idx); indexRef.current = idx
    setError('')
    const p = await ensurePlayer()
    p.loadVideoById(list[idx].videoId)
    p.playVideo()
    setPlaying(true)
  }
  playNextRef.current = () => playAt(indexRef.current + 1)

  const togglePlay = async () => {
    const p = playerRef.current
    if (!p || index < 0) return playAt(index < 0 ? 0 : index)
    if (playing) { p.pauseVideo(); setPlaying(false) }
    else { p.playVideo(); setPlaying(true) }
  }

  const submitAdd = async () => {
    const videoId = parseVideoId(addUrl)
    if (!videoId) { setError('유효한 YouTube 링크가 아니에요'); return }
    const title = addTitle.trim() || `트랙 ${tracks.length + 1}`
    setError('')
    setAddUrl(''); setAddTitle('')
    await onAdd(videoId, title)
  }

  const removeTrack = (t) => {
    const removedIdx = tracks.findIndex((x) => x.id === t.id)
    onRemove(t.id)
    if (removedIdx === index) { setIndex(-1); setPlaying(false); try { playerRef.current?.stopVideo?.() } catch { /* ignore */ } }
    else if (removedIdx < index) setIndex((i) => i - 1)
  }

  const nowPlaying = index >= 0 ? tracks[index] : null

  return (
    <>
      {/* Hidden audio host — kept mounted so playback survives the dropdown closing. */}
      <div style={{ position: 'fixed', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
        <div ref={hostRef} />
      </div>

      {/* Thin full-width top bar */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 44, zIndex: 101,
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px',
        background: 'rgba(12,15,24,0.72)', borderBottom: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(18px)', fontFamily: "'Noto Sans KR', sans-serif",
      }}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>{playing ? '🎵' : '🎧'}</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <button onClick={() => playAt(index - 1)} disabled={!tracks.length} style={barBtn(tracks.length)} title="이전">⏮</button>
          <button onClick={togglePlay} disabled={!tracks.length} style={{ ...barBtn(tracks.length), color: 'rgba(185,222,255,0.95)' }} title={playing ? '일시정지' : '재생'}>{playing ? '❚❚' : '▶'}</button>
          <button onClick={() => playAt(index + 1)} disabled={!tracks.length} style={barBtn(tracks.length)} title="다음">⏭</button>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 12.5, fontWeight: 300,
            color: nowPlaying ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.4)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{nowPlaying ? nowPlaying.title : '재생 중인 곡이 없어요'}</span>
          {playing && <span style={{ fontSize: 10, color: 'rgba(99,179,237,0.7)', fontFamily: 'Outfit, sans-serif', flexShrink: 0 }}>♪</span>}
        </div>

        <button
          onClick={() => setOpen((o) => !o)}
          title="플레이리스트"
          style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
            background: open ? 'rgba(99,179,237,0.16)' : 'rgba(255,255,255,0.06)',
            border: open ? '1px solid rgba(99,179,237,0.32)' : '1px solid rgba(255,255,255,0.12)',
            borderRadius: 9, padding: '6px 11px', fontSize: 12,
            color: open ? 'rgba(185,222,255,0.95)' : 'rgba(255,255,255,0.7)', fontFamily: "'Noto Sans KR', sans-serif",
          }}
        >
          목록{tracks.length ? ` ${tracks.length}` : ''} <span style={{ fontSize: 9 }}>{open ? '▲' : '▼'}</span>
        </button>
      </div>

      {/* Dropdown: add form + playlist */}
      {open && (
        <div
          className="thin-scroll"
          style={{
            position: 'fixed', top: 50, right: 12, zIndex: 101, width: 322, maxHeight: '74vh', overflowY: 'auto',
            background: 'rgba(18,22,34,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14,
            padding: 14, backdropFilter: 'blur(24px)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
            animation: 'itemIn 0.22s cubic-bezier(0.16,1,0.3,1) both',
          }}
        >
          {/* Add form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: tracks.length ? 13 : 2 }}>
            <input
              type="text" placeholder="제목 (선택)" value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
              style={addInput}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text" placeholder="YouTube 링크 붙여넣기" value={addUrl}
                onChange={(e) => { setAddUrl(e.target.value); setError('') }}
                onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
                style={{ ...addInput, flex: 1 }}
              />
              <button onClick={submitAdd} style={{
                background: 'rgba(99,179,237,0.16)', border: '1px solid rgba(99,179,237,0.32)', borderRadius: 9,
                color: 'rgba(185,222,255,0.95)', fontSize: 12.5, padding: '0 14px', cursor: 'pointer',
                fontFamily: "'Noto Sans KR', sans-serif", whiteSpace: 'nowrap',
              }}>추가</button>
            </div>
            {error && <div style={{ fontSize: 11, color: 'rgba(255,140,140,0.85)', fontFamily: "'Noto Sans KR', sans-serif" }}>{error}</div>}
          </div>

          {/* Playlist */}
          {tracks.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {tracks.map((t, i) => {
                const active = i === index
                return (
                  <div key={t.id} style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: 9,
                    background: active ? 'rgba(99,179,237,0.14)' : 'rgba(255,255,255,0.04)',
                    border: active ? '1px solid rgba(99,179,237,0.3)' : '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <button onClick={() => playAt(i)} title="재생" style={{
                      width: 22, height: 22, minWidth: 22, borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: 'transparent', color: active ? 'rgba(185,222,255,0.95)' : 'rgba(255,255,255,0.4)',
                      fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>{active && playing ? '♪' : '▶'}</button>
                    <span style={{
                      flex: 1, minWidth: 0, fontSize: 12, fontWeight: 300, fontFamily: "'Noto Sans KR', sans-serif",
                      color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer',
                    }} onClick={() => playAt(i)}>{t.title}</span>
                    <button onClick={() => removeTrack(t)} title="삭제" style={{
                      width: 22, height: 22, minWidth: 22, borderRadius: 6, border: 'none', background: 'transparent',
                      cursor: 'pointer', color: 'rgba(255,255,255,0.25)', fontSize: 16, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>×</button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '10px 0 4px', color: 'rgba(255,255,255,0.28)', fontSize: 12, fontWeight: 300, fontFamily: "'Noto Sans KR', sans-serif" }}>
              위에 YouTube 링크를 붙여넣어 곡을 추가하세요
            </div>
          )}
        </div>
      )}
    </>
  )
}

const addInput = {
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9,
  padding: '8px 11px', fontSize: 12, color: 'rgba(255,255,255,0.85)', fontFamily: "'Noto Sans KR', sans-serif",
  fontWeight: 300, outline: 'none',
}

const barBtn = (enabled) => ({
  width: 28, height: 28, minWidth: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)', fontSize: 11,
  cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.4,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0,
})
