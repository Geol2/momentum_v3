// 기기 연결 — PC·파이의 pc-agent, 동기화 스크립트가 비밀번호 대신 쓰는 "기기용 토큰"을 만들고 끊는 창.
// 토큰은 만들 때 한 번만 보여 주고(서버는 고유 id만 저장), 끊으면 그 기기는 바로 연결이 끊겨요.
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'

export default function DeviceTokens({ onClose }) {
  const [list, setList] = useState(null)
  const [name, setName] = useState('')
  const [created, setCreated] = useState(null) // { name, token }
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    try { setList(await apiFetch('/api/devices') || []) } catch (e) { setErr(e.message || '불러오지 못했어요.'); setList([]) }
  }, [])
  useEffect(() => { load() }, [load])

  const create = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setErr('')
    try {
      const r = await apiFetch('/api/devices', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
      setCreated(r); setName(''); load()
    } catch (e2) { setErr(e2.message || '만들지 못했어요.') }
  }
  const revoke = async (d) => {
    if (!window.confirm(`"${d.name}" 연결을 끊을까요? 그 기기의 pc-agent·동기화가 바로 멈춰요.`)) return
    try { await apiFetch(`/api/devices/${d.id}`, { method: 'DELETE' }); load() } catch (e) { setErr(e.message || '끊지 못했어요.') }
  }
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1500) } catch { /* 직접 선택해서 복사 */ }
  }

  // ~/.momentum.env 에서 비밀번호 줄을 지우고 토큰 줄로 바꾸는 한 줄(Git Bash·파이 공통)
  const cmd = created && `sed -i '/^MOMENTUM_\\(EMAIL\\|PASSWORD\\|TOKEN\\)=/d' ~/.momentum.env 2>/dev/null; echo 'MOMENTUM_TOKEN=${created.token}' >> ~/.momentum.env && chmod 600 ~/.momentum.env`

  return (
    <div style={S.scrim} role="dialog" aria-modal="true" aria-label="기기 연결" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={S.box}>
        <h2 style={S.h}>기기 연결</h2>
        <p style={S.p}>PC·라즈베리파이의 pc-agent와 동기화가 <b>비밀번호 대신</b> 쓰는 열쇠예요. 비밀번호를 바꿔도 끊기지 않고, 기기마다 따로 끊을 수 있어요.</p>

        {created ? (
          <div style={S.card}>
            <div style={S.label}>"{created.name}" 토큰 — 지금만 보여요</div>
            <code style={S.token}>{created.token}</code>
            <button type="button" style={S.small} onClick={() => copy(created.token, 'token')}>{copied === 'token' ? '복사됨' : '토큰 복사'}</button>
            <div style={{ ...S.label, marginTop: 12 }}>그 기기 터미널에 붙여넣기 (비밀번호 줄은 지우고 토큰으로 바꿔요)</div>
            <code style={S.token}>{cmd}</code>
            <button type="button" style={S.small} onClick={() => copy(cmd, 'cmd')}>{copied === 'cmd' ? '복사됨' : '명령 복사'}</button>
            <p style={{ ...S.p, margin: '10px 0 0' }}>그다음 pc-agent 다시 켜기 — 파이: <code>sudo systemctl restart momentum-pc-agent</code></p>
            <button type="button" style={{ ...S.primary, marginTop: 12 }} onClick={() => setCreated(null)}>확인했어요</button>
          </div>
        ) : (
          <form onSubmit={create} style={S.row}>
            <input style={S.in} value={name} onChange={(e) => setName(e.target.value)} placeholder="기기 이름 (예: 회사PC, 라즈베리파이)" maxLength={60} />
            <button type="submit" style={{ ...S.primary, flex: 'none', width: 'auto', padding: '0 14px', opacity: name.trim() ? 1 : 0.5 }} disabled={!name.trim()}>만들기</button>
          </form>
        )}

        {err && <p style={S.err}>{err}</p>}

        <div style={{ ...S.label, marginTop: 16 }}>연결된 기기</div>
        {list === null ? <p style={S.dim}>불러오는 중...</p> : list.length === 0 ? <p style={S.dim}>아직 없어요.</p> : (
          <ul style={S.ul}>
            {list.map((d) => (
              <li key={d.id} style={S.li}>
                <span>
                  <span style={{ color: '#e8e8ea' }}>{d.name}</span>
                  <span style={S.meta}> · {d.lastUsedAt ? `마지막 사용 ${new Date(d.lastUsedAt).toLocaleString('ko-KR')}` : '아직 안 씀'}</span>
                </span>
                <button type="button" style={S.danger} onClick={() => revoke(d)}>끊기</button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" style={{ ...S.ghost, marginTop: 12 }} onClick={onClose}>닫기</button>
      </div>
    </div>
  )
}

const font = "'Noto Sans KR', system-ui, sans-serif"
const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const S = {
  scrim: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: { width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', background: '#11141b', border: '1px solid #262c36', borderRadius: 14, padding: 20, color: '#e8e8ea', fontFamily: font, boxShadow: '0 20px 60px rgba(0,0,0,.5)' },
  h: { margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#f4f5f7' },
  p: { margin: '0 0 14px', fontSize: 13, lineHeight: 1.6, color: '#b0b6c0' },
  label: { fontSize: 12, color: '#8c939e', marginBottom: 6 },
  card: { padding: 12, border: '1px solid rgba(77,255,122,.35)', borderRadius: 10, background: 'rgba(77,255,122,.05)' },
  token: { display: 'block', fontFamily: mono, fontSize: 11.5, lineHeight: 1.5, wordBreak: 'break-all', background: '#07090d', border: '1px solid #232a36', borderRadius: 6, padding: '8px 10px', color: '#c8ffd6', userSelect: 'all' },
  row: { display: 'flex', gap: 8 },
  in: { flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 8, border: '1px solid #2a2f3a', background: '#0b0d12', color: '#e8e8ea', fontSize: 14, fontFamily: font },
  ul: { listStyle: 'none', margin: 0, padding: 0 },
  li: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid #1c2129', fontSize: 13.5 },
  meta: { fontSize: 12, color: '#8c939e' },
  dim: { fontSize: 13, color: '#8c939e', margin: 0 },
  err: { margin: '8px 0 0', fontSize: 12.5, color: '#ff8a8a' },
  small: { marginTop: 6, padding: '5px 10px', borderRadius: 6, border: '1px solid #2a2f3a', background: 'none', color: '#c8ffd6', fontSize: 12, cursor: 'pointer', fontFamily: font },
  danger: { padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,120,120,.35)', background: 'none', color: '#ff9a9a', fontSize: 12, cursor: 'pointer', fontFamily: font },
  ghost: { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #2a2f3a', background: 'none', color: '#b0b6c0', fontSize: 13.5, cursor: 'pointer', fontFamily: font },
  primary: { width: '100%', padding: 10, borderRadius: 8, border: 0, background: '#2f8f57', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: font },
}
