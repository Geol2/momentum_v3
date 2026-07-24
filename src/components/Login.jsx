import { useEffect, useState } from 'react'
import StarField from './StarField.jsx'
import { detectInApp, isAndroid, isIOS, openInExternalBrowser, openInChromeIOS, copyCurrentUrl } from '../lib/inAppBrowser.js'

const IN_APP_NAMES = {
  kakaotalk: '카카오톡', naver: '네이버', instagram: '인스타그램',
  facebook: '페이스북', line: '라인', daum: '다음',
}

// Shown when the page is running inside an in-app browser (e.g. a KakaoTalk link),
// where localStorage is often blocked and the page reloads on app-switch — which
// silently breaks login and the email-code signup. Nudge the user to a real browser.
function InAppNotice() {
  // iOS in-app browsers get the dedicated IosEscape screen (Login early-returns before
  // the form), so this banner only ever renders for Android / other in-app browsers.
  const app = detectInApp()
  if (!app) return null
  const name = IN_APP_NAMES[app] || '인앱'
  const android = isAndroid()

  return (
    <div style={{
      background: 'rgba(255,196,84,0.1)', border: '1px solid rgba(255,196,84,0.32)', borderRadius: 12,
      padding: '13px 14px', marginBottom: 18, fontFamily: "'Noto Sans KR', sans-serif",
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(255,214,140,0.95)', marginBottom: 6 }}>
        ⚠️ {name} 브라우저에서는 로그인이 제한돼요
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 300, lineHeight: 1.6, color: 'rgba(255,255,255,0.62)' }}>
        {android
          ? '아래 버튼으로 크롬에서 열어주세요.'
          : '메뉴에서 “다른 브라우저로 열기”를 눌러주세요.'}
      </div>

      {android && (
        <button type="button" onClick={() => openInExternalBrowser(app)} style={{
          marginTop: 10, width: '100%', background: 'rgba(255,196,84,0.18)', border: '1px solid rgba(255,196,84,0.4)',
          borderRadius: 9, padding: '9px 0', fontSize: 12.5, fontWeight: 500, color: 'rgba(255,224,160,0.98)',
          cursor: 'pointer', fontFamily: "'Noto Sans KR', sans-serif",
        }}>
          외부 브라우저로 열기
        </button>
      )}
    </div>
  )
}

// Dedicated full-screen page shown when iOS opens the app inside an in-app browser
// (KakaoTalk 등). iOS has no way to force Safari and no reliable no-gesture escape, so
// we auto-attempt Chrome once and ALWAYS keep visible buttons as the fallback — never a
// truly blank page, or a failed auto-attempt would leave the user stuck.
function IosEscape({ appName }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    // Fire once, shortly after mount — some WebViews ignore an immediate on-load
    // scheme navigation. Silently no-ops if Chrome isn't installed.
    const t = setTimeout(() => openInChromeIOS(), 400)
    return () => clearTimeout(t)
  }, [])

  const copyLink = async () => {
    const ok = await copyCurrentUrl()
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }

  const btn = {
    width: '100%', background: 'rgba(255,196,84,0.2)', border: '1px solid rgba(255,196,84,0.45)',
    borderRadius: 11, padding: '13px 0', fontSize: 14, fontWeight: 500, color: 'rgba(255,228,168,0.98)',
    cursor: 'pointer', fontFamily: "'Noto Sans KR', sans-serif",
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14, padding: '24px 28px', textAlign: 'center',
      fontFamily: "'Noto Sans KR', sans-serif",
    }}>
      <div style={{ fontSize: 40 }}>🌙</div>
      <div style={{ fontSize: 16, fontWeight: 500, color: 'rgba(255,255,255,0.92)', lineHeight: 1.5 }}>
        {appName} 브라우저에서는<br />로그인이 제한돼요
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 300, lineHeight: 1.7, color: 'rgba(255,255,255,0.6)', maxWidth: 300 }}>
        잠시 후 크롬으로 자동 전환을 시도합니다.<br />
        열리지 않으면 아래 버튼을 눌러주세요.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, width: '100%', maxWidth: 300, marginTop: 6 }}>
        <button type="button" onClick={openInChromeIOS} style={btn}>크롬으로 열기</button>
        <button type="button" onClick={copyLink} style={{ ...btn, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)', color: 'rgba(255,255,255,0.85)' }}>
          {copied ? '복사됨 ✓ — 사파리에 붙여넣기' : '링크 복사'}
        </button>
      </div>
      <div style={{ fontSize: 11, fontWeight: 300, color: 'rgba(255,255,255,0.4)', marginTop: 4, lineHeight: 1.6 }}>
        또는 오른쪽 아래 메뉴 → “Safari로 열기”
      </div>
    </div>
  )
}

// Backend returns English messages; map the ones users can hit to Korean.
const KO_MESSAGES = {
  'Email already registered': '이미 등록된 이메일입니다',
  'Please wait before requesting another code': '잠시 후 다시 요청해주세요',
  'Incorrect verification code': '인증 코드가 올바르지 않습니다',
  'Verification code expired': '인증 코드가 만료되었습니다. 다시 받아주세요',
  'Too many incorrect attempts. Please request a new code': '입력 횟수를 초과했습니다. 코드를 다시 받아주세요',
  'No verification code requested for this email': '먼저 인증 코드를 받아주세요',
}

function messageFor(err) {
  if (err?.message && KO_MESSAGES[err.message]) return KO_MESSAGES[err.message]
  // status 0 = fetch never got a response (network / in-app-browser block). This is
  // the usual "카톡에서만 안 돼요" cause — point the user at a real browser.
  if (err?.status === 0) return '서버에 연결하지 못했어요. 카카오톡 등 인앱 브라우저라면 크롬·사파리로 열어 다시 시도해 주세요.'
  if (err?.status === 401) return '이메일 또는 비밀번호가 올바르지 않습니다'
  if (err?.status === 409) return '이미 등록된 이메일입니다'
  if (err?.status === 429) return '잠시 후 다시 요청해주세요'
  if (err?.status === 400) return err.message || '입력값을 확인해주세요'
  if (err?.status >= 500) return `서버 오류입니다 (${err.status}). 잠시 후 다시 시도하거나 외부 브라우저에서 열어 주세요.`
  return '문제가 발생했습니다. 잠시 후 다시 시도해주세요'
}

const RESEND_COOLDOWN = 60 // seconds — matches the backend resend cooldown

export default function Login({ onLogin, onSignup, onRequestCode }) {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  // Tick the resend cooldown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const resetSignupFlow = () => {
    setCodeSent(false)
    setCode('')
    setCooldown(0)
  }

  const switchMode = (next) => {
    setMode(next)
    setErrorMsg(null)
    resetSignupFlow()
  }

  const requestCode = async () => {
    if (!name || !email || password.length < 6) {
      setErrorMsg('이름, 이메일, 비밀번호(6자 이상)를 입력해주세요')
      return
    }
    setSubmitting(true)
    setErrorMsg(null)
    try {
      await onRequestCode(email)
      setCodeSent(true)
      setCooldown(RESEND_COOLDOWN)
    } catch (err) {
      setErrorMsg(messageFor(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg(null)

    if (mode === 'login') {
      setSubmitting(true)
      try {
        await onLogin(email, password)
      } catch (err) {
        setErrorMsg(messageFor(err))
      } finally {
        setSubmitting(false)
      }
      return
    }

    // signup: first press sends the code, second press completes registration
    if (!codeSent) {
      await requestCode()
      return
    }
    setSubmitting(true)
    try {
      await onSignup(email, password, name, code)
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

  const linkStyle = { color: 'rgba(185,222,255,0.98)', cursor: 'pointer' }

  const submitLabel = mode === 'login'
    ? (submitting ? '처리 중...' : '로그인')
    : codeSent
      ? (submitting ? '처리 중...' : '회원가입 완료')
      : (submitting ? '전송 중...' : '인증코드 받기')

  // iOS in-app browser can't reach the API and can't be auto-escaped — show the
  // dedicated Chrome/Safari escape screen instead of a login form that would only fail.
  const inApp = detectInApp()
  if (inApp && isIOS()) {
    return (
      <>
        <StarField background="mountain" />
        <IosEscape appName={IN_APP_NAMES[inApp] || '인앱'} />
      </>
    )
  }

  return (
    <>
      <StarField background="mountain" />
      <div style={{
        position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 16, overflowY: 'auto',
        fontFamily: "'Noto Sans KR', sans-serif",
      }}>
        <form onSubmit={handleSubmit} style={{
          width: '100%', maxWidth: 320, background: 'rgba(0,0,0,0.52)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 18, padding: 28, backdropFilter: 'blur(24px)',
          animation: 'itemIn 0.25s cubic-bezier(0.16,1,0.3,1) both',
        }}>
          <div style={{
            fontFamily: 'Outfit, sans-serif', fontSize: 20, fontWeight: 300,
            color: 'rgba(255,255,255,0.9)', letterSpacing: '0.06em', marginBottom: 22, textAlign: 'center',
          }}>{mode === 'signup' ? '회원가입' : '로그인'}</div>

          <InAppNotice />

          {mode === 'signup' && (
            <input style={inputStyle} type="text" placeholder="이름" value={name}
                   onChange={(e) => setName(e.target.value)} required maxLength={12}
                   disabled={codeSent} />
          )}
          <input style={inputStyle} type="email" placeholder="이메일" value={email}
                 onChange={(e) => { setEmail(e.target.value); if (mode === 'signup' && codeSent) resetSignupFlow() }}
                 required disabled={mode === 'signup' && codeSent} />
          <input style={inputStyle} type="password" placeholder="비밀번호 (6자 이상)" value={password}
                 onChange={(e) => setPassword(e.target.value)} required minLength={6}
                 disabled={mode === 'signup' && codeSent} />

          {mode === 'signup' && codeSent && (
            <>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 8 }}>
                <b style={{ color: 'rgba(185,222,255,0.9)' }}>{email}</b> 로 인증 코드를 보냈어요.
              </div>
              <input style={{ ...inputStyle, letterSpacing: '0.35em', textAlign: 'center' }}
                     type="text" inputMode="numeric" placeholder="6자리 코드" value={code}
                     onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                     required maxLength={6} autoFocus />
              <div style={{ textAlign: 'right', fontSize: 11.5, marginBottom: 12 }}>
                {cooldown > 0 ? (
                  <span style={{ color: 'rgba(255,255,255,0.4)' }}>코드 재전송 ({cooldown}s)</span>
                ) : (
                  <a onClick={() => { if (!submitting) requestCode() }} style={linkStyle}>코드 재전송</a>
                )}
              </div>
            </>
          )}

          {errorMsg && (
            <div style={{ fontSize: 12, color: 'rgba(255,120,120,0.9)', marginBottom: 12 }}>{errorMsg}</div>
          )}

          <button type="submit" disabled={submitting} style={{
            width: '100%', padding: '10px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: 'rgba(99,179,237,0.75)', color: '#fff', fontSize: 13.5, fontWeight: 600,
            fontFamily: "'Noto Sans KR', sans-serif", opacity: submitting ? 0.6 : 1, marginBottom: 14,
          }}>
            {submitLabel}
          </button>

          <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
            {mode === 'login' ? (
              <span>계정이 없으신가요?{' '}
                <a onClick={() => switchMode('signup')} style={linkStyle}>회원가입</a>
              </span>
            ) : (
              <span>이미 계정이 있으신가요?{' '}
                <a onClick={() => switchMode('login')} style={linkStyle}>로그인</a>
              </span>
            )}
          </div>
        </form>
      </div>
    </>
  )
}
