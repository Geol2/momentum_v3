import { useState } from 'react'
import { NOTICES } from '../lib/data.js'

// 📢 공지사항 버튼 + 오버레이 모달. 내용은 data.js의 NOTICES 배열에서 옵니다.
export default function Notice() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="공지사항"
        style={{
          position: 'fixed', bottom: 18, left: 20, zIndex: 90,
          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)',
          backdropFilter: 'blur(16px)', borderRadius: 20, padding: '7px 13px',
          color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 300,
          fontFamily: "'Noto Sans KR', sans-serif", letterSpacing: '0.02em',
        }}
      >
        <span style={{ fontSize: 13 }}>📢</span> 공지사항
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(8,10,20,0.62)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px',
            animation: 'backdropIn 0.3s ease both',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="thin-scroll"
            style={{
              position: 'relative', width: '100%', maxWidth: 440, maxHeight: '80vh', overflowY: 'auto',
              background: 'rgba(18,22,34,0.92)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18,
              padding: '22px 22px 24px', backdropFilter: 'blur(24px)',
              boxShadow: '0 30px 70px rgba(0,0,0,0.55)', animation: 'itemIn 0.3s cubic-bezier(0.16,1,0.3,1) both',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>📢</span>
                <span style={{ fontSize: 14, fontWeight: 400, color: 'rgba(255,255,255,0.9)', fontFamily: "'Noto Sans KR', sans-serif", letterSpacing: '0.02em' }}>공지사항</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                title="닫기"
                style={{
                  width: 28, height: 28, minWidth: 28, border: 'none', background: 'rgba(255,255,255,0.06)', borderRadius: 8,
                  color: 'rgba(255,255,255,0.55)', fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', padding: 0, cursor: 'pointer',
                }}
              >×</button>
            </div>

            {NOTICES.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {NOTICES.map((n, i) => (
                  <div key={i} style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 12, padding: '13px 15px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(185,222,255,0.95)', fontFamily: "'Noto Sans KR', sans-serif" }}>{n.title}</span>
                      <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.32)', fontFamily: 'Outfit, sans-serif', whiteSpace: 'nowrap', flexShrink: 0 }}>{n.date}</span>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 300, lineHeight: 1.65, color: 'rgba(255,255,255,0.72)', fontFamily: "'Noto Sans KR', sans-serif", whiteSpace: 'pre-wrap' }}>{n.body}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '28px 0', color: 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: 300, fontFamily: "'Noto Sans KR', sans-serif" }}>
                등록된 공지사항이 없습니다
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
