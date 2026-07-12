import { useState } from 'react'
import StarField from './StarField.jsx'

function messageFor(err) {
  if (err?.status === 401) return '이메일 또는 비밀번호가 올바르지 않습니다'
  if (err?.status === 409) return '이미 등록된 이메일입니다'
  if (err?.status === 400) return err.message || '입력값을 확인해주세요'
  return '문제가 발생했습니다. 잠시 후 다시 시도해주세요'
}

export default function Login({ onLogin, onSignup }) {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setErrorMsg(null)
    try {
      if (mode === 'signup') await onSignup(email, password, name)
      else await onLogin(email, password)
    } catch (err) {
      setErrorMsg(messageFor(err))
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 9, padding: '10px 12px', fontSize: 13, color: 'rgba(255,255,255,0.88)',
    fontFamily: "'Noto Sans KR', sans-serif", fontWeight: 300, marginBottom: 12,
  }

  return (
    <>
      <StarField background="mountain" />
      <div style={{
        position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontFamily: "'Noto Sans KR', sans-serif",
      }}>
        <form onSubmit={handleSubmit} style={{
          width: 320, background: 'rgba(0,0,0,0.52)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 18, padding: 28, backdropFilter: 'blur(24px)',
          animation: 'itemIn 0.25s cubic-bezier(0.16,1,0.3,1) both',
        }}>
          <div style={{
            fontFamily: 'Outfit, sans-serif', fontSize: 20, fontWeight: 300,
            color: 'rgba(255,255,255,0.9)', letterSpacing: '0.06em', marginBottom: 22, textAlign: 'center',
          }}>달빛 서랍</div>

          {mode === 'signup' && (
            <input style={inputStyle} type="text" placeholder="이름" value={name}
                   onChange={(e) => setName(e.target.value)} required maxLength={12} />
          )}
          <input style={inputStyle} type="email" placeholder="이메일" value={email}
                 onChange={(e) => setEmail(e.target.value)} required />
          <input style={inputStyle} type="password" placeholder="비밀번호 (6자 이상)" value={password}
                 onChange={(e) => setPassword(e.target.value)} required minLength={6} />

          {errorMsg && (
            <div style={{ fontSize: 12, color: 'rgba(255,120,120,0.9)', marginBottom: 12 }}>{errorMsg}</div>
          )}

          <button type="submit" disabled={submitting} style={{
            width: '100%', padding: '10px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: 'rgba(99,179,237,0.75)', color: '#fff', fontSize: 13.5, fontWeight: 600,
            fontFamily: "'Noto Sans KR', sans-serif", opacity: submitting ? 0.6 : 1, marginBottom: 14,
          }}>
            {submitting ? '처리 중...' : mode === 'signup' ? '회원가입' : '로그인'}
          </button>

          <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
            {mode === 'login' ? (
              <span>계정이 없으신가요?{' '}
                <a onClick={() => { setMode('signup'); setErrorMsg(null) }} style={{ color: 'rgba(185,222,255,0.98)', cursor: 'pointer' }}>회원가입</a>
              </span>
            ) : (
              <span>이미 계정이 있으신가요?{' '}
                <a onClick={() => { setMode('login'); setErrorMsg(null) }} style={{ color: 'rgba(185,222,255,0.98)', cursor: 'pointer' }}>로그인</a>
              </span>
            )}
          </div>
        </form>
      </div>
    </>
  )
}
