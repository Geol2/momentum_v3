import { useEffect, useState } from 'react'
import { BACKGROUNDS } from '../lib/data.js'
import { pushApi } from '../lib/api.js'
import { disablePush, enablePush, isSubscribed, isIOS, isStandalone, pushBlockedReason, pushSupported } from '../lib/push.js'

// Gear button + settings popover (name, clock format, seconds, temp unit, quote, 알림).
export default function Settings({ settings, onChange, user, onLogout, currentBackground }) {
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
                // 셔플로 배경이 바뀌면 지금 화면에 보이는 배경(currentBackground)을
                // 하이라이트한다. 없으면 저장된 배경으로 폴백.
                const active = (currentBackground || settings.background || BACKGROUNDS[0].k) === b.k
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

          {/* 돌아올 때 배경 바꾸기 — 탭을 떠났다 돌아오면 다른 배경으로 셔플 (기본 켜짐) */}
          <div style={{ height: 12 }} />
          <Toggle
            label="돌아올 때 배경 바꾸기"
            on={settings.shuffleBgOnReturn !== false}
            onToggle={() => set({ shuffleBgOnReturn: settings.shuffleBgOnReturn === false })}
          />

          {/* Reminders */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '14px 0 12px' }} />
          <ReminderSettings settings={settings} set={set} open={open} />

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

/**
 * 할 일 시간 알림 (Web Push). The toggle owns the browser subscription; the lead-time
 * picker is an ordinary account setting the backend's scheduler reads.
 */
function ReminderSettings({ settings, set, open }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  // Whether the server has VAPID keys at all — null until the first check resolves.
  const [serverReady, setServerReady] = useState(null)

  const blocked = pushBlockedReason()
  const needsInstall = isIOS() && !isStandalone()

  // Re-check on each open: permission or the subscription can change outside the app
  // (browser settings, another tab, an OS-level uninstall of the PWA).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    isSubscribed().then((v) => { if (!cancelled) setOn(v) })
    pushApi.publicKey()
      .then((r) => { if (!cancelled) setServerReady(!!r.enabled) })
      .catch(() => { if (!cancelled) setServerReady(false) })
    return () => { cancelled = true }
  }, [open])

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    setMsg(null)
    try {
      if (on) {
        await disablePush()
        setOn(false)
      } else {
        await enablePush()
        setOn(true)
        setMsg({ ok: true, text: '알림이 켜졌어요.' })
      }
    } catch (e) {
      setMsg({ ok: false, text: e.message || '알림을 켜지 못했어요.' })
    } finally {
      setBusy(false)
    }
  }

  const sendTest = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const { sent } = await pushApi.test()
      setMsg(sent > 0
        ? { ok: true, text: '테스트 알림을 보냈어요.' }
        : { ok: false, text: '보낼 기기가 없어요. 알림을 다시 켜보세요.' })
    } catch {
      setMsg({ ok: false, text: '테스트 알림을 보내지 못했어요.' })
    } finally {
      setBusy(false)
    }
  }

  const note = (text, tone) => (
    <div style={{
      fontSize: 10.5, lineHeight: 1.55, marginTop: 7, fontFamily: "'Noto Sans KR', sans-serif",
      color: tone === 'bad' ? 'rgba(255,170,170,0.85)' : tone === 'good' ? 'rgba(160,225,190,0.9)' : 'rgba(255,255,255,0.42)',
    }}>{text}</div>
  )

  return (
    <div style={{ marginBottom: 2 }}>
      <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.6)', fontFamily: "'Noto Sans KR', sans-serif", marginBottom: 7 }}>
        약속 알림
      </div>

      {!pushSupported() && !needsInstall
        ? note('이 브라우저는 알림을 지원하지 않아요.')
        : (
          <>
            <Toggle
              label={busy ? '처리 중…' : '시간 알림 받기'}
              on={on}
              onToggle={blocked || serverReady === false ? () => {} : toggle}
            />

            {/* Lead time — only meaningful once alerts are actually on. */}
            {on && (
              <Segmented
                label="미리 알림"
                width={140}
                options={[{ k: 5, t: '5분' }, { k: 10, t: '10분' }, { k: 30, t: '30분' }]}
                value={settings.remindLeadMinutes ?? 10}
                onSelect={(v) => set({ remindLeadMinutes: v })}
              />
            )}

            {on && (
              <button
                onClick={sendTest}
                disabled={busy}
                style={{
                  width: '100%', padding: '7px 0', borderRadius: 9, cursor: busy ? 'default' : 'pointer',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(185,222,255,0.9)', fontSize: 11.5, fontFamily: "'Noto Sans KR', sans-serif",
                }}
              >테스트 알림 보내기</button>
            )}

            {msg && note(msg.text, msg.ok ? 'good' : 'bad')}
            {!msg && needsInstall && note('아이폰은 공유 → "홈 화면에 추가"로 설치한 뒤 여기서 알림을 켜주세요.')}
            {!msg && !needsInstall && blocked && note(blocked, 'bad')}
            {!msg && !blocked && serverReady === false && note('서버에 알림이 아직 설정되지 않았어요.', 'bad')}
            {!msg && !blocked && serverReady && !on && note('시간을 정해둔 할 일이 다가오면 폰으로 알려드려요.')}
          </>
        )}
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
