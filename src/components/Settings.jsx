import { useState } from 'react'
import { BACKGROUNDS } from '../lib/data.js'

// Gear button + settings popover (name, clock format, seconds, temp unit, quote).
export default function Settings({ settings, onChange, user, onLogout }) {
  const [open, setOpen] = useState(false)
  const set = (patch) => onChange({ ...settings, ...patch })

  const gearBtn = {
    width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.4)',
    border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(16px)', color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
  }

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 26, zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
      {open && (
        <div className="thin-scroll" style={{
          background: 'rgba(0,0,0,0.52)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: 16,
          backdropFilter: 'blur(24px)', width: 256, maxHeight: '76vh', overflowY: 'auto',
          animation: 'itemIn 0.25s cubic-bezier(0.16,1,0.3,1) both',
        }}>
          <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', fontFamily: 'Outfit, sans-serif', marginBottom: 12 }}>개인 설정</div>

          {/* Name */}
          <div style={{ marginBottom: 13 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontFamily: "'Noto Sans KR', sans-serif", marginBottom: 6 }}>이름</div>
            <input
              type="text" value={settings.userName} maxLength={12} placeholder="이름을 입력하세요"
              onChange={(e) => set({ userName: e.target.value })}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9,
                padding: '8px 11px', fontSize: 12.5, color: 'rgba(255,255,255,0.88)', fontFamily: "'Noto Sans KR', sans-serif", fontWeight: 300,
              }}
            />
          </div>

          {/* Clock format */}
          <Segmented
            label="시간 형식"
            width={124}
            options={[{ k: true, t: '24시간' }, { k: false, t: '오전/오후' }]}
            value={settings.use24h}
            onSelect={(v) => set({ use24h: v })}
          />

          {/* Seconds */}
          <Toggle label="초 표시" on={settings.showSeconds} onToggle={() => set({ showSeconds: !settings.showSeconds })} />

          {/* Temp unit */}
          <Segmented
            label="온도 단위"
            width={96}
            options={[{ k: 'C', t: '°C' }, { k: 'F', t: '°F' }]}
            value={settings.tempUnit}
            onSelect={(v) => set({ tempUnit: v })}
          />

          {/* Quote */}
          <Toggle label="명언 표시" on={settings.showQuote} onToggle={() => set({ showQuote: !settings.showQuote })} />

          {/* Background */}
          <div style={{ marginBottom: 2 }}>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.6)', fontFamily: "'Noto Sans KR', sans-serif", marginBottom: 7 }}>배경</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
              {BACKGROUNDS.map((b) => {
                const active = (settings.background || BACKGROUNDS[0].k) === b.k
                return (
                  <button
                    key={b.k}
                    onClick={() => set({ background: b.k })}
                    title={b.name}
                    style={{
                      height: 44, borderRadius: 10, cursor: 'pointer', padding: 0, overflow: 'hidden',
                      border: active ? '1.5px solid rgba(150,200,255,0.85)' : '1px solid rgba(255,255,255,0.14)',
                      background: b.css, backgroundSize: 'cover', position: 'relative', transition: 'border 0.15s, transform 0.15s',
                      transform: active ? 'scale(1.04)' : 'none',
                    }}
                  >
                    <span style={{
                      position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                      paddingBottom: 4, fontSize: 10, fontFamily: "'Noto Sans KR', sans-serif",
                      color: active ? 'rgba(210,235,255,0.98)' : 'rgba(255,255,255,0.6)',
                      fontWeight: active ? 600 : 400, textShadow: '0 1px 4px rgba(0,0,0,0.7)',
                    }}>{b.name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Account */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '14px 0 12px' }} />
          <div style={{ marginBottom: 2 }}>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.6)', fontFamily: "'Noto Sans KR', sans-serif", marginBottom: 7 }}>계정</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', fontFamily: "'Noto Sans KR', sans-serif", marginBottom: 9 }}>
              {user?.name} · {user?.email}
            </div>
            <button
              onClick={onLogout}
              style={{
                width: '100%', padding: '8px 0', borderRadius: 9, cursor: 'pointer',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,150,150,0.9)', fontSize: 12, fontFamily: "'Noto Sans KR', sans-serif",
              }}
            >로그아웃</button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        title="설정"
        style={{ ...gearBtn, transform: open ? 'rotate(90deg)' : 'none', color: open ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.6)' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  )
}

function Toggle({ label, on, onToggle, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: last ? 2 : 11 }}>
      <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.6)', fontFamily: "'Noto Sans KR', sans-serif" }}>{label}</span>
      <button
        onClick={onToggle}
        style={{
          width: 40, height: 23, minWidth: 40, borderRadius: 12, border: 'none', padding: 0, position: 'relative',
          cursor: 'pointer', background: on ? 'rgba(99,179,237,0.75)' : 'rgba(255,255,255,0.16)', transition: 'background 0.2s',
        }}
      >
        <span style={{
          position: 'absolute', top: 2.5, left: on ? 19.5 : 2.5, width: 18, height: 18, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.35)', transition: 'left 0.22s cubic-bezier(0.34,1.56,0.64,1)',
        }} />
      </button>
    </div>
  )
}

function Segmented({ label, width, options, value, onSelect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 11 }}>
      <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.6)', fontFamily: "'Noto Sans KR', sans-serif" }}>{label}</span>
      <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 9, padding: 2, width }}>
        {options.map((o) => {
          const active = value === o.k
          return (
            <button
              key={o.t}
              onClick={() => onSelect(o.k)}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 7, border: 'none', fontSize: 11.5,
                fontFamily: "'Noto Sans KR', sans-serif", cursor: 'pointer', transition: 'all 0.15s',
                background: active ? 'rgba(99,179,237,0.28)' : 'transparent',
                color: active ? 'rgba(185,222,255,0.98)' : 'rgba(255,255,255,0.42)',
                fontWeight: active ? 600 : 400,
              }}
            >{o.t}</button>
          )
        })}
      </div>
    </div>
  )
}
