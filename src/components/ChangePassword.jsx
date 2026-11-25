// 비밀번호 바꾸기 창 — 메인 화면 설정과 g2 화면 메뉴에서 같이 씁니다.
// 바꾸면 서버가 예전 토큰을 모두 무효로 만들어 다른 기기는 로그아웃되고, 이 기기는 새 토큰으로 로그인이 유지돼요.
import { useState } from 'react'
import { apiFetch, setToken } from '../lib/api.js'

const MIN = 8

export default function ChangePassword({ onClose }) {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const problem = !cur ? '' : next.length < MIN ? `새 비밀번호는 ${MIN}자 이상이어야 해요.`
    : next === cur ? '지금 비밀번호와 다르게 정해 주세요.'
      : again && again !== next ? '새 비밀번호 확인이 달라요.' : ''
  const can = cur && next.length >= MIN && next === again && next !== cur && !busy

  const submit = async (e) => {
    e.preventDefault()
    if (!can) return
    setBusy(true); setErr('')
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      })
      if (res?.token) setToken(res.token)
      setDone(true)
    } catch (e2) {
      setErr(e2?.message && !/^\d+$/.test(e2.message) ? e2.message : '바꾸지 못했어요. 지금 비밀번호를 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={S.scrim} role="dialog" aria-modal="true" aria-label="비밀번호 바꾸기" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form style={S.box} onSubmit={submit}>
        <h2 style={S.h}>비밀번호 바꾸기</h2>
        {done ? (
          <>
            <p style={S.p}>바꿨어요. 이 기기는 그대로 로그인돼 있고, <b>다른 기기는 모두 로그아웃</b>됐어요.</p>
            <ul style={S.ul}>
              <li>안경(Even 앱)은 새 비밀번호로 다시 로그인</li>
              <li>PC·파이의 <code>~/.momentum.env</code> 비밀번호를 새것으로 고치고 pc-agent 다시 켜기</li>
              <li>claude.ai 모멘텀 커넥터는 다시 연결</li>
            </ul>
            <button type="button" style={S.primary} onClick={onClose}>닫기</button>
          </>
        ) : (
          <>
            <p style={S.p}>바꾸면 다른 기기(혹시 털린 곳 포함)는 모두 로그아웃돼요.</p>
            {/* 숨은 아이디 칸: 비밀번호 관리자가 어느 계정의 새 비밀번호인지 알 수 있게 */}
            <input type="text" name="username" autoComplete="username" defaultValue={(() => { try { return localStorage.getItem('momentum_last_email') || '' } catch { return '' } })()} hidden readOnly />
            <input style={S.in} type="password" autoComplete="current-password" placeholder="지금 비밀번호" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus />
            <input style={S.in} type="password" autoComplete="new-password" placeholder={`새 비밀번호 (${MIN}자 이상)`} value={next} onChange={(e) => setNext(e.target.value)} />
            <input style={S.in} type="password" autoComplete="new-password" placeholder="새 비밀번호 확인" value={again} onChange={(e) => setAgain(e.target.value)} />
            {(problem || err) && <p style={S.err}>{err || problem}</p>}
            <div style={S.row}>
              <button type="button" style={S.ghost} onClick={onClose}>취소</button>
              <button type="submit" style={{ ...S.primary, opacity: can ? 1 : 0.5 }} disabled={!can}>{busy ? '바꾸는 중...' : '바꾸기'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

const font = "'Noto Sans KR', system-ui, sans-serif"
const S = {
  scrim: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: { width: '100%', maxWidth: 360, background: '#11141b', border: '1px solid #262c36', borderRadius: 14, padding: 20, color: '#e8e8ea', fontFamily: font, boxShadow: '0 20px 60px rgba(0,0,0,.5)' },
  h: { margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#f4f5f7' },
  p: { margin: '0 0 14px', fontSize: 13, lineHeight: 1.6, color: '#b0b6c0' },
  ul: { margin: '0 0 16px', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8, color: '#b0b6c0' },
  in: { width: '100%', boxSizing: 'border-box', marginBottom: 8, padding: '10px 12px', borderRadius: 8, border: '1px solid #2a2f3a', background: '#0b0d12', color: '#e8e8ea', fontSize: 14, fontFamily: font },
  err: { margin: '2px 0 8px', fontSize: 12.5, color: '#ff8a8a' },
  row: { display: 'flex', gap: 8, marginTop: 6 },
  ghost: { flex: 1, padding: 10, borderRadius: 8, border: '1px solid #2a2f3a', background: 'none', color: '#b0b6c0', fontSize: 13.5, cursor: 'pointer', fontFamily: font },
  primary: { flex: 1, width: '100%', padding: 10, borderRadius: 8, border: 0, background: '#2f8f57', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: font },
}
