import { useState } from 'react'

const card = {
  background: 'rgba(0,0,0,0.38)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20,
  padding: '18px 22px', minWidth: 158, backdropFilter: 'blur(20px)',
}

export default function WeatherQuote({ quote, showQuote, onNewQuote, weather, tempUnit, mobile = false }) {
  const [spin, setSpin] = useState(false)

  const refresh = () => {
    setSpin(true)
    onNewQuote()
    setTimeout(() => setSpin(false), 500)
  }

  const toTemp = (c) => {
    if (c == null) return '--'
    const v = tempUnit === 'F' ? Math.round((c * 9) / 5 + 32) : Math.round(c)
    return `${v}°`
  }

  return (
    <div style={{
      ...(mobile
        ? { position: 'static', alignItems: 'center', margin: '0 auto', animation: 'fadeUp 0.8s cubic-bezier(0.16,1,0.3,1) both' }
        : { position: 'fixed', top: 60, right: 30, zIndex: 100, alignItems: 'flex-end', animation: 'slideFromRight 0.8s cubic-bezier(0.16,1,0.3,1) 0.5s both' }),
      display: 'flex', flexDirection: 'column', gap: 14, fontFamily: "'Noto Sans KR', sans-serif",
    }}>
      {showQuote && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, maxWidth: 330 }}>
          <div style={{ textAlign: mobile ? 'center' : 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 300, color: 'rgba(255,255,255,0.72)', lineHeight: 1.5, textShadow: '0 1px 8px rgba(0,0,0,0.65)' }}>
              “{quote.text}”
            </div>
            <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 10, fontWeight: 300, color: 'rgba(255,255,255,0.42)', letterSpacing: '0.08em', marginTop: 3 }}>
              — {quote.author}
            </div>
          </div>
          <button
            onClick={refresh}
            title="명언 새로고침"
            style={{
              flexShrink: 0, width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(16px)', color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
              transition: 'transform 0.5s cubic-bezier(0.16,1,0.3,1)', transform: spin ? 'rotate(-180deg)' : 'none',
            }}
          >↻</button>
        </div>
      )}

      {weather.status === 'loading' && (
        <div style={{ ...card, borderRadius: 18, padding: '14px 18px' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)' }}>날씨 불러오는 중...</div>
        </div>
      )}

      {weather.status === 'ok' && (
        <div style={card}>
          <div style={{ fontSize: 9.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 11 }}>
            서울 · 오늘
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
            <span style={{ fontSize: 36, lineHeight: 1, userSelect: 'none' }}>{weather.icon}</span>
            <span style={{ fontSize: 30, fontWeight: 200, color: 'rgba(255,255,255,0.93)', letterSpacing: '-0.02em' }}>
              {toTemp(weather.tempC)}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', marginBottom: 11 }}>{weather.desc}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <Row k="습도" v={weather.humidity} />
            <Row k="체감" v={toTemp(weather.feelsC)} />
          </div>
        </div>
      )}

      {weather.status === 'failed' && (
        <div style={{ ...card, borderRadius: 18, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.18)' }}>날씨 정보 없음</div>
        </div>
      )}
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18 }}>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)' }}>{k}</span>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>{v}</span>
    </div>
  )
}
