// 내 Anthropic API 키 등록 — 서버 주인이 아닌 사용자는 이 키로만 Claude를 씁니다(사용료는 그 키 계정으로).
// 키는 서버에서 암호화해 저장하고 다시 보여 주지 않아요(끝 4자리만).
import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'

export default function ApiKey({ onClose, onSaved }) {
  const [info, setInfo] = useState(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => { apiFetch('/api/ai/key').then(setInfo).catch(() => setInfo({ hasKey: false })) }, [])

  const save = async (e) => {
    e.preventDefault()
    if (!key.trim() || busy) return
    setBusy(true); setErr(''); setOk('')
    try {
      const r = await apiFetch('/api/ai/key', { method: 'PUT', body: JSON.stringify({ key: key.trim() }) })
      setInfo(r); setKey(''); setOk('등록했어요. 이제 Claude에게 물어볼 수 있어요.')
      onSaved?.()
    } catch (e2) {
      setErr(e2.message || '등록하지 못했어요.')
    } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm('등록한 API 키를 지울까요? 지우면 Claude를 쓸 수 없어요.')) return
    try { await apiFetch('/api/ai/key', { method: 'DELETE' }); setInfo({ hasKey: false }); setOk(''); onSaved?.() } catch (e) { setErr(e.message || '지우지 못했어요.') }
  }

  return (
    <div style={S.scrim} role="dialog" aria-modal="true" aria-label="Claude API 키" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form style={S.box} onSubmit={save}>
        <h2 style={S.h}>Claude API 키</h2>
        <p style={S.p}>
          모멘텀에서 Claude에게 묻는 데 <b>내 Anthropic API 키</b>를 써요. 사용료는 그 키의 Anthropic 계정으로 청구돼요.
          키는 <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer noopener" style={S.a}>Anthropic Console → API Keys</a>에서 만들 수 있어요.
        </p>
        {info?.hasKey && (
          <div style={S.card}>
            <span>등록됨 · <code style={S.code}>sk-ant-…{info.last4}</code></span>
            <button type="button" style={S.danger} onClick={remove}>지우기</button>
          </div>
        )}
        <input style={S.in} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)}
          placeholder={info?.hasKey ? '새 키로 바꾸기 (sk-ant-…)' : 'sk-ant-…'} autoFocus />
        <p style={S.note}>저장할 때 Anthropic에 맞는 키인지 확인해요. 서버에는 암호화해서 두고, 다시 보여 주지 않아요. 프로젝트(코드 읽기) 기능은 아직 쓸 수 없어요.</p>
        {err && <p style={S.err}>{err}</p>}
        {ok && <p style={S.ok}>{ok}</p>}
        <div style={S.row}>
          <button type="button" style={S.ghost} onClick={onClose}>닫기</button>
          <button type="submit" style={{ ...S.primary, opacity: key.trim() && !busy ? 1 : 0.5 }} disabled={!key.trim() || busy}>{busy ? '확인하는 중...' : '등록'}</button>
        </div>
      </form>
    </div>
  )
}

const font = "'Noto Sans KR', system-ui, sans-serif"
const S = {
  scrim: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: { width: '100%', maxWidth: 400, background: '#11141b', border: '1px solid #262c36', borderRadius: 14, padding: 20, color: '#e8e8ea', fontFamily: font, boxShadow: '0 20px 60px rgba(0,0,0,.5)' },
  h: { margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#f4f5f7' },
  p: { margin: '0 0 14px', fontSize: 13, lineHeight: 1.65, color: '#b0b6c0' },
  a: { color: '#8dffaa' },
  card: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, padding: '8px 10px', border: '1px solid rgba(77,255,122,.35)', borderRadius: 8, background: 'rgba(77,255,122,.05)', fontSize: 13 },
  code: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', color: '#c8ffd6' },
  in: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid #2a2f3a', background: '#0b0d12', color: '#e8e8ea', fontSize: 14, fontFamily: 'ui-monospace, Menlo, Consolas, monospace' },
  note: { margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.6, color: '#8c939e' },
  err: { margin: '8px 0 0', fontSize: 12.5, color: '#ff8a8a' },
  ok: { margin: '8px 0 0', fontSize: 12.5, color: '#8dffaa' },
  row: { display: 'flex', gap: 8, marginTop: 14 },
  ghost: { flex: 1, padding: 10, borderRadius: 8, border: '1px solid #2a2f3a', background: 'none', color: '#b0b6c0', fontSize: 13.5, cursor: 'pointer', fontFamily: font },
  primary: { flex: 1, padding: 10, borderRadius: 8, border: 0, background: '#2f8f57', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: font },
  danger: { padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,120,120,.35)', background: 'none', color: '#ff9a9a', fontSize: 12, cursor: 'pointer', fontFamily: font },
}
