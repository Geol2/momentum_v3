import { useEffect, useRef, useState } from 'react'
import { isIOS } from '../lib/inAppBrowser.js'

// iOS refuses to start a hidden YouTube IFrame from a scripted playVideo() (the command
// isn't treated as a user gesture), so on iOS we render the real player VISIBLE with
// native controls and the user taps its play button. Desktop/Android keep the hidden 0×0
// background player.
const IOS = isIOS()

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

// Seconds → "m:ss".
function fmtTime(s) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

// Playlist thumbnail that doubles as the play button. Uses YouTube's public thumbnail
// URL (no API key, and an <img>/background load isn't subject to the CORS block that
// hits the API). A background-image degrades to a plain dark tile if the id is bad,
// avoiding a broken-image icon.
function TrackThumb({ videoId, active, playing, onClick }) {
  return (
    <button onClick={onClick} title="재생" style={{
      position: 'relative', width: 48, height: 30, minWidth: 48, borderRadius: 6, border: 'none', padding: 0,
      cursor: 'pointer', overflow: 'hidden', flexShrink: 0, backgroundColor: '#1a1e2b',
      backgroundImage: `url(https://img.youtube.com/vi/${videoId}/mqdefault.jpg)`,
      backgroundSize: 'cover', backgroundPosition: 'center',
    }}>
      <span style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? 'rgba(30,50,80,0.32)' : 'rgba(0,0,0,0.3)',
        color: active ? 'rgba(200,228,255,0.98)' : 'rgba(255,255,255,0.9)', fontSize: 11,
        textShadow: '0 1px 3px rgba(0,0,0,0.85)',
      }}>{active && playing ? '♪' : '▶'}</span>
    </button>
  )
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
export default function MusicPlayer({ tracks, onAdd, onRemove, onRename }) {
  const [open, setOpen] = useState(false)
  const [addUrl, setAddUrl] = useState('')
  const [addTitle, setAddTitle] = useState('')
  const [editId, setEditId] = useState(null)   // track being renamed
  const [editText, setEditText] = useState('')
  const [index, setIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState(0)   // playback position (s)
  const [duration, setDuration] = useState(0) // track length (s)
  const [volume, setVolume] = useState(80)    // 0–100
  const [muted, setMuted] = useState(false)

  const playerRef = useRef(null)
  const hostRef = useRef(null)
  const indexRef = useRef(-1)
  const tracksRef = useRef(tracks)
  const playNextRef = useRef(() => {})
  const volumeRef = useRef(volume)
  const seekingRef = useRef(false) // pause progress polling while dragging the seek bar
  const readyRef = useRef(false)   // true once the YT player fired onReady
  const readyPromiseRef = useRef(null) // cached "player is ready" promise
  tracksRef.current = tracks
  indexRef.current = index
  volumeRef.current = volume

  // Tear down the player when the component unmounts.
  useEffect(() => () => { try { playerRef.current?.destroy?.() } catch { /* ignore */ } }, [])

  // Poll playback position ~4×/s so the progress bar tracks the song.
  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current
      if (!p || !p.getDuration || seekingRef.current) return
      try {
        setDuration(p.getDuration() || 0)
        setCurrent(p.getCurrentTime() || 0)
      } catch { /* player not ready */ }
    }, 250)
    return () => clearInterval(id)
  }, [])

  // Resolves when the (single, reused) YT player has fired onReady. Cached so it runs
  // once — created eagerly below so the player exists BEFORE the user taps play.
  const ensurePlayer = () => {
    if (readyPromiseRef.current) return readyPromiseRef.current
    readyPromiseRef.current = (async () => {
      const YT = await loadYT()
      return await new Promise((resolve) => {
        const p = new YT.Player(hostRef.current, {
          height: IOS ? '100%' : '0', width: IOS ? '100%' : '0',
          // controls:1 on iOS so the user can tap the real play button (the only way
          // iOS starts playback with sound).
          playerVars: { autoplay: 0, playsinline: 1, controls: IOS ? 1 : 0, rel: 0 },
          events: {
            onReady: () => {
              readyRef.current = true
              try { p.setVolume(volumeRef.current) } catch { /* ignore */ }
              resolve(p)
            },
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
    })()
    return readyPromiseRef.current
  }

  // Build the player as soon as there's a playlist — well before any tap — so playAt
  // can start playback synchronously inside the user gesture (required by iOS).
  useEffect(() => {
    if (tracks.length > 0) ensurePlayer().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.length])

  const playAt = (i) => {
    const list = tracksRef.current
    if (!list.length) return
    const idx = ((i % list.length) + list.length) % list.length
    setIndex(idx); indexRef.current = idx
    setError('')
    // iOS: just cue the track into the visible player; the user taps its play button
    // (scripted playVideo() won't start on iOS). Elsewhere: load + play immediately.
    const start = (pp) => {
      if (IOS) {
        pp.cueVideoById(list[idx].videoId)
      } else {
        pp.loadVideoById(list[idx].videoId)
        if (!muted) { try { pp.unMute() } catch { /* ignore */ } }
        pp.playVideo()
        setPlaying(true)
      }
    }
    const p = playerRef.current
    if (p && readyRef.current) start(p)      // synchronous within the gesture
    else ensurePlayer().then(start)          // player still initializing
  }
  playNextRef.current = () => playAt(indexRef.current + 1)

  const togglePlay = () => {
    const p = playerRef.current
    if (!p || !readyRef.current || index < 0) return playAt(index < 0 ? 0 : index)
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

  // Live seek: update the label as the thumb drags, only jump the player on release.
  const onSeekInput = (v) => { seekingRef.current = true; setCurrent(v) }
  const onSeekCommit = (v) => {
    const p = playerRef.current
    try { p?.seekTo(v, true) } catch { /* ignore */ }
    setCurrent(v)
    seekingRef.current = false
  }

  const applyVolume = (v) => {
    setVolume(v)
    const p = playerRef.current
    try {
      p?.setVolume(v)
      if (v > 0 && muted) { p?.unMute(); setMuted(false) }
    } catch { /* ignore */ }
  }
  const toggleMute = () => {
    const p = playerRef.current
    try {
      if (muted) { p?.unMute(); if (volume === 0) applyVolume(50); setMuted(false) }
      else { p?.mute(); setMuted(true) }
    } catch { /* ignore */ }
  }

  const startRename = (t) => { setEditId(t.id); setEditText(t.title) }
  const commitRename = () => {
    const title = editText.trim()
    if (title && onRename) onRename(editId, title)
    setEditId(null)
  }
  const cancelRename = () => setEditId(null)

  const nowPlaying = index >= 0 ? tracks[index] : null
  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0
  const volIcon = muted || volume === 0 ? '🔇' : volume < 45 ? '🔉' : '🔊'

  return (
    <>
      {IOS ? (
        /* iOS: the YouTube player is visible so the user can tap its play button.
           Shown once a track is selected; sits just under the top bar. */
        <div style={{
          position: 'fixed', top: 50, right: 8, zIndex: 102,
          width: 'min(300px, calc(100vw - 16px))', borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 18px 44px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.14)',
          background: '#000', display: nowPlaying ? 'block' : 'none',
        }}>
          <div style={{
            fontSize: 10.5, color: 'rgba(255,255,255,0.55)', fontFamily: "'Noto Sans KR', sans-serif",
            padding: '5px 9px', background: 'rgba(12,15,24,0.9)', textAlign: 'center',
          }}>▶ 눌러 재생 · 곡을 바꾸면 다시 눌러주세요</div>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9' }}>
            <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
          </div>
        </div>
      ) : (
        /* Desktop/Android: hidden 0×0 background player — playback survives the dropdown closing. */
        <div style={{ position: 'fixed', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
          <div ref={hostRef} />
        </div>
      )}

      {/* Thin full-width top bar */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 44, zIndex: 101,
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px',
        background: 'rgba(12,15,24,0.72)', borderBottom: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(18px)', fontFamily: "'Noto Sans KR', sans-serif",
      }}>
        {nowPlaying ? (
          <div title={nowPlaying.title} style={{
            width: 40, height: 26, minWidth: 40, borderRadius: 5, flexShrink: 0, backgroundColor: '#1a1e2b',
            backgroundImage: `url(https://img.youtube.com/vi/${nowPlaying.videoId}/mqdefault.jpg)`,
            backgroundSize: 'cover', backgroundPosition: 'center',
          }} />
        ) : (
          <span style={{ fontSize: 14, flexShrink: 0 }}>{playing ? '🎵' : '🎧'}</span>
        )}

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

        {/* Time — hidden on the narrowest screens to keep the bar on one line. */}
        <span style={{
          flexShrink: 0, fontSize: 10.5, fontFamily: 'Outfit, sans-serif', color: 'rgba(255,255,255,0.45)',
          letterSpacing: '0.02em', fontVariantNumeric: 'tabular-nums',
        }} className="mp-time">
          {fmtTime(current)} / {fmtTime(duration)}
        </span>

        <button onClick={toggleMute} title={muted ? '음소거 해제' : '음소거'} style={{ ...barBtn(true), fontSize: 13, border: 'none', background: 'transparent' }}>
          {volIcon}
        </button>

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

        {/* Seek bar — sits along the bottom edge, inset so it clears the transport
            buttons on the left and the mute/목록 controls on the right. */}
        <input
          type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={current}
          disabled={!nowPlaying}
          onChange={(e) => onSeekInput(Number(e.target.value))}
          onMouseUp={(e) => onSeekCommit(Number(e.target.value))}
          onTouchEnd={(e) => onSeekCommit(Number(e.target.value))}
          title="탐색" aria-label="재생 위치"
          style={{
            position: 'absolute', left: 140, right: 128, bottom: -3, height: 20, margin: 0,
            cursor: nowPlaying ? 'pointer' : 'default', appearance: 'none', WebkitAppearance: 'none',
            background: 'transparent', '--pct': `${pct}%`,
          }}
          className="mp-seek"
        />
      </div>

      {/* Dropdown: add form + playlist */}
      {open && (
        <div
          className="thin-scroll"
          style={{
            position: 'fixed', top: 50, right: 12, zIndex: 101, width: 'min(322px, calc(100vw - 24px))', maxHeight: '74vh', overflowY: 'auto',
            background: 'rgba(18,22,34,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14,
            padding: 14, backdropFilter: 'blur(24px)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
            animation: 'itemIn 0.22s cubic-bezier(0.16,1,0.3,1) both',
          }}
        >
          {/* Volume */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <button onClick={toggleMute} title={muted ? '음소거 해제' : '음소거'} style={{
              border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, padding: 0, flexShrink: 0,
            }}>{volIcon}</button>
            <input
              type="range" min="0" max="100" value={muted ? 0 : volume}
              onChange={(e) => applyVolume(Number(e.target.value))}
              title="볼륨" aria-label="볼륨"
              className="mp-vol" style={{ flex: 1, minWidth: 0, '--pct': `${muted ? 0 : volume}%` }}
            />
            <span style={{ flexShrink: 0, width: 30, textAlign: 'right', fontSize: 11, fontFamily: 'Outfit, sans-serif', color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>
              {muted ? 0 : volume}
            </span>
          </div>

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
                    <TrackThumb videoId={t.videoId} active={active} playing={playing} onClick={() => playAt(i)} />
                    {editId === t.id ? (
                      <input
                        type="text" value={editText} autoFocus
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') cancelRename() }}
                        onBlur={commitRename}
                        style={{ ...addInput, flex: 1, minWidth: 0, padding: '5px 8px', border: '1px solid rgba(99,179,237,0.5)' }}
                      />
                    ) : (
                      <span style={{
                        flex: 1, minWidth: 0, fontSize: 12, fontWeight: 300, fontFamily: "'Noto Sans KR', sans-serif",
                        color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer',
                      }} onClick={() => playAt(i)} onDoubleClick={() => startRename(t)} title="더블클릭하여 이름 변경">{t.title}</span>
                    )}
                    {editId !== t.id && onRename && (
                      <button onClick={() => startRename(t)} title="이름 변경" style={{
                        width: 22, height: 22, minWidth: 22, borderRadius: 6, border: 'none', background: 'transparent',
                        cursor: 'pointer', color: 'rgba(255,255,255,0.25)', fontSize: 12, display: 'flex',
                        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>✎</button>
                    )}
                    {editId !== t.id && (
                      <button onClick={() => removeTrack(t)} title="삭제" style={{
                        width: 22, height: 22, minWidth: 22, borderRadius: 6, border: 'none', background: 'transparent',
                        cursor: 'pointer', color: 'rgba(255,255,255,0.25)', fontSize: 16, display: 'flex',
                        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>×</button>
                    )}
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
