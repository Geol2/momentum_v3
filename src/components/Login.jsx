import { useEffect, useState } from 'react'
import StarField from './StarField.jsx'
import { DAYS_KR } from '../lib/data.js'
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
  'Account not found': '계정을 찾을 수 없어요. 이메일을 확인해주세요',
}

// 시간대에 맞춰 건네는 인사. 로그인 화면을 "쉬어가는 자리"로 만들어주는 한 줄입니다.
function greetingFor(hour) {
  if (hour < 5) return '깊은 밤이에요. 잠들기 전에 들러주셨네요.'
  if (hour < 11) return '좋은 아침이에요. 오늘도 천천히 시작해요.'
  if (hour < 17) return '나른한 오후네요. 잠시 쉬어가세요.'
  if (hour < 21) return '하루가 저물어요. 오늘은 어떠셨나요?'
  return '오늘 하루도 수고했어요. 이제 좀 쉬어요.'
}

// 나머지가 전부 컬러 이모지라, 할 일만 텍스트 글리프(✓)를 쓰면 혼자 흐리게 묻힙니다.
const FEATURES = [
  { icon: '✅', label: '할 일' },
  { icon: '📓', label: '일기' },
  { icon: '🎵', label: '음악' },
  { icon: '📝', label: '메모' },
]

const pad = (n) => String(n).padStart(2, '0')

// 카드 위쪽의 달·인사·시계 블록. 폼만 덩그러니 있던 화면을 채우면서,
// 로그인하기 전부터 앱의 분위기(밤 · 휴식)를 먼저 보여주는 역할입니다.
function Welcome() {
  // 분만 표시하므로 15초마다면 충분합니다 — 초 단위로 리렌더할 이유가 없어요.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(t)
  }, [])

  return (
    <div style={{ textAlign: 'center', marginBottom: 22 }}>
      <div style={{ fontSize: 34, lineHeight: 1, animation: 'moonBreathe 6s ease-in-out infinite' }}>🌙</div>
      <div style={{
        fontFamily: 'Outfit, sans-serif', fontSize: 21, fontWeight: 300, letterSpacing: '0.12em',
        color: 'rgba(255,255,255,0.94)', marginTop: 13,
      }}>
        모멘텀
      </div>
      <div style={{
        fontSize: 11.5, fontWeight: 300, letterSpacing: '0.02em',
        color: 'rgba(255,255,255,0.46)', marginTop: 7,
      }}>
        할 일과 일기를 한 화면에
      </div>

      <div style={{
        marginTop: 18, display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 9,
      }}>
        <span style={{
          fontFamily: 'Outfit, sans-serif', fontSize: 27, fontWeight: 300, letterSpacing: '-0.01em',
          color: 'rgba(255,255,255,0.9)', fontVariantNumeric: 'tabular-nums',
        }}>
          {pad(now.getHours())}:{pad(now.getMinutes())}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 300, color: 'rgba(255,255,255,0.45)' }}>
          {now.getMonth() + 1}월 {now.getDate()}일 {DAYS_KR[now.getDay()]}요일
        </span>
      </div>

      <div style={{
        fontSize: 12, fontWeight: 300, lineHeight: 1.6, color: 'rgba(200,218,255,0.62)', marginTop: 11,
      }}>
        {greetingFor(now.getHours())}
      </div>
    </div>
  )
}

// 가운데에 작은 별을 물린 구분선 — 환영 블록과 입력 폼 사이의 숨 고르는 자리.
function Divider() {
  const line = { flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent)' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
      <div style={line} />
      <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>✦</span>
      <div style={line} />
    </div>
  )
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

const MODE_LABEL = { login: '로그인', signup: '회원가입', forgot: '비밀번호 찾기' }

export default function Login({ onLogin, onSignup, onRequestCode, onForgotPassword, onResetPassword, expired = false }) {
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('') // forgot 모드에서는 "새 비밀번호"로 씁니다
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)
  // 비밀번호 변경 성공처럼 "잘 됐어요"를 알리는 자리. 에러와 색이 다릅니다.
  const [noticeMsg, setNoticeMsg] = useState(null)

  // 코드를 주고받는 단계가 있는 모드 — 제출 버튼이 2단(코드 받기 → 완료)으로 동작합니다.
  const needsCode = mode === 'signup' || mode === 'forgot'

  // Tick the resend cooldown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const resetCodeFlow = () => {
    setCodeSent(false)
    setCode('')
    setCooldown(0)
  }

  const switchMode = (next) => {
    setMode(next)
    setErrorMsg(null)
    setNoticeMsg(null)
    setPassword('') // 모드마다 뜻이 다른 칸이라(로그인 비번 ↔ 새 비번) 넘어갈 때 비웁니다
    resetCodeFlow()
  }

  const requestCode = async () => {
    if (mode === 'signup' && (!name || !email || password.length < 6)) {
      setErrorMsg('이름, 이메일, 비밀번호(6자 이상)를 입력해주세요')
      return
    }
    if (mode === 'forgot' && !email) {
      setErrorMsg('가입하신 이메일을 입력해주세요')
      return
    }
    setSubmitting(true)
    setErrorMsg(null)
    try {
      await (mode === 'forgot' ? onForgotPassword(email) : onRequestCode(email))
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
    setNoticeMsg(null)

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

    // signup/forgot: 첫 제출은 코드 발송, 두 번째 제출이 실제 완료입니다.
    if (!codeSent) {
      await requestCode()
      return
    }

    setSubmitting(true)
    try {
      if (mode === 'forgot') {
        await onResetPassword(email, code, password)
        // 새 비밀번호로 직접 한 번 로그인하게 둡니다 — 방금 정한 비밀번호가 손에 익고,
        // 예전 비밀번호를 쓰던 다른 기기도 그대로 로그아웃 상태로 남습니다.
        setMode('login')
        setPassword('')
        resetCodeFlow()
        setNoticeMsg('비밀번호가 바뀌었어요. 새 비밀번호로 로그인해 주세요.')
      } else {
        await onSignup(email, password, name, code)
      }
    } catch (err) {
      setErrorMsg(messageFor(err))
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    width: '100%', background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 11, padding: '12px 13px', fontSize: 13, color: 'rgba(255,255,255,0.9)',
    fontFamily: "'Noto Sans KR', sans-serif", fontWeight: 300, marginBottom: 10,
  }

  const linkStyle = { color: 'rgba(185,222,255,0.98)', cursor: 'pointer' }

  const submitLabel = mode === 'login'
    ? (submitting ? '처리 중...' : '로그인')
    : mode === 'forgot'
      ? codeSent
        ? (submitting ? '변경 중...' : '비밀번호 변경')
        : (submitting ? '전송 중...' : '재설정 코드 받기')
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
        position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-start',
        justifyContent: 'center', padding: '24px 16px', overflowY: 'auto',
        fontFamily: "'Noto Sans KR', sans-serif",
      }}>
        {/* margin:auto로 세로 가운데를 맞춥니다. alignItems:center로 하면 카드가 화면보다
            길어졌을 때 위쪽이 잘려서 스크롤로도 못 올라가요. */}
        <form onSubmit={handleSubmit} style={{
          width: '100%', maxWidth: 360, margin: 'auto',
          background: 'linear-gradient(180deg, rgba(16,20,42,0.62) 0%, rgba(6,9,22,0.72) 100%)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 22, padding: '32px 28px 26px',
          backdropFilter: 'blur(26px) saturate(120%)', WebkitBackdropFilter: 'blur(26px) saturate(120%)',
          boxShadow: '0 26px 60px rgba(0,0,0,0.45)',
          animation: 'loginIn 0.6s cubic-bezier(0.16,1,0.3,1) both',
        }}>
          <Welcome />
          <Divider />

          <div style={{
            textAlign: 'center', fontSize: 11.5, fontWeight: 400, letterSpacing: '0.14em',
            color: 'rgba(255,255,255,0.5)', marginBottom: 16,
          }}>
            {MODE_LABEL[mode]}
          </div>

          <InAppNotice />

          {mode === 'forgot' && !codeSent && (
            <div style={{ fontSize: 11.5, fontWeight: 300, lineHeight: 1.65, color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>
              가입하신 이메일로 재설정 코드를 보내드려요.
            </div>
          )}

          {mode === 'signup' && (
            <input className="login-field" style={inputStyle} type="text" placeholder="이름" value={name}
                   onChange={(e) => setName(e.target.value)} required maxLength={12}
                   disabled={codeSent} />
          )}
          <input className="login-field" style={inputStyle} type="email" placeholder="이메일" value={email}
                 onChange={(e) => { setEmail(e.target.value); if (needsCode && codeSent) resetCodeFlow() }}
                 required disabled={needsCode && codeSent} autoComplete="email" />
          {/* forgot 모드에서는 코드를 받은 뒤에야 "새 비밀번호"를 물어봅니다. */}
          {(mode !== 'forgot' || codeSent) && (
            <input className="login-field" style={inputStyle} type="password"
                   placeholder={mode === 'login' ? '비밀번호' : mode === 'forgot' ? '새 비밀번호 (6자 이상)' : '비밀번호 (6자 이상)'}
                   value={password} onChange={(e) => setPassword(e.target.value)}
                   required minLength={mode === 'login' ? undefined : 6}
                   disabled={mode === 'signup' && codeSent}
                   autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          )}

          {needsCode && codeSent && (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 300, lineHeight: 1.6, color: 'rgba(255,255,255,0.55)', marginBottom: 9 }}>
                <b style={{ color: 'rgba(185,222,255,0.9)', fontWeight: 500 }}>{email}</b> 로 코드를 보냈어요.
              </div>
              <input className="login-field" style={{ ...inputStyle, letterSpacing: '0.35em', textAlign: 'center' }}
                     type="text" inputMode="numeric" placeholder="6자리 코드" value={code}
                     onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                     required maxLength={6} autoFocus autoComplete="one-time-code" />
              <div style={{ textAlign: 'right', fontSize: 11.5, marginBottom: 12 }}>
                {cooldown > 0 ? (
                  <span style={{ color: 'rgba(255,255,255,0.4)' }}>코드 재전송 ({cooldown}s)</span>
                ) : (
                  <a className="login-link" onClick={() => { if (!submitting) requestCode() }} style={linkStyle}>코드 재전송</a>
                )}
              </div>
            </>
          )}

          {mode === 'login' && (
            <div style={{ textAlign: 'right', fontSize: 11.5, marginTop: 2, marginBottom: 14 }}>
              <a className="login-link" onClick={() => switchMode('forgot')} style={linkStyle}>비밀번호를 잊으셨나요?</a>
            </div>
          )}

          {/* 자리를 비운 사이 세션이 끊긴 경우. 로그인 실패와 달리 사용자 잘못이 아니라
              무슨 일이 있었는지만 담담히 알려줍니다. */}
          {expired && !errorMsg && !noticeMsg && mode === 'login' && (
            <div style={{
              fontSize: 11.5, lineHeight: 1.6, marginBottom: 12, padding: '10px 12px', borderRadius: 10,
              background: 'rgba(120,170,255,0.1)', border: '1px solid rgba(120,170,255,0.28)',
              color: 'rgba(185,215,255,0.92)',
            }}>
              오래 자리를 비우셔서 로그아웃되었어요. 다시 로그인해 주세요.
            </div>
          )}
          {noticeMsg && (
            <div style={{
              fontSize: 11.5, lineHeight: 1.6, marginBottom: 12, padding: '10px 12px', borderRadius: 10,
              background: 'rgba(130,220,190,0.1)', border: '1px solid rgba(130,220,190,0.3)',
              color: 'rgba(180,238,216,0.94)',
            }}>
              {noticeMsg}
            </div>
          )}
          {errorMsg && (
            <div style={{
              fontSize: 11.5, lineHeight: 1.6, marginBottom: 12, padding: '10px 12px', borderRadius: 10,
              background: 'rgba(255,120,120,0.1)', border: '1px solid rgba(255,120,120,0.28)',
              color: 'rgba(255,168,168,0.95)',
            }}>
              {errorMsg}
            </div>
          )}

          <button type="submit" disabled={submitting} className="login-submit" style={{
            width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, rgba(122,163,236,0.92) 0%, rgba(96,132,206,0.94) 100%)',
            color: '#fff', fontSize: 13.5, fontWeight: 600, letterSpacing: '0.02em',
            fontFamily: "'Noto Sans KR', sans-serif", opacity: submitting ? 0.6 : 1, marginBottom: 15,
            boxShadow: '0 6px 18px rgba(70,110,190,0.3)',
          }}>
            {submitLabel}
          </button>

          <div style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 300, color: 'rgba(255,255,255,0.5)' }}>
            {mode === 'login' ? (
              <span>계정이 없으신가요?{' '}
                <a className="login-link" onClick={() => switchMode('signup')} style={linkStyle}>회원가입</a>
              </span>
            ) : mode === 'forgot' ? (
              <span>비밀번호가 기억나셨나요?{' '}
                <a className="login-link" onClick={() => switchMode('login')} style={linkStyle}>로그인</a>
              </span>
            ) : (
              <span>이미 계정이 있으신가요?{' '}
                <a className="login-link" onClick={() => switchMode('login')} style={linkStyle}>로그인</a>
              </span>
            )}
          </div>

          {/* 로그인하면 뭘 할 수 있는지 — 가입 전 사용자에게 주는 유일한 힌트입니다. */}
          <div style={{
            display: 'flex', justifyContent: 'center', gap: 16, marginTop: 22, paddingTop: 17,
            borderTop: '1px solid rgba(255,255,255,0.07)',
          }}>
            {FEATURES.map((f) => (
              <div key={f.label} style={{ textAlign: 'center', opacity: 0.62 }}>
                <div style={{ fontSize: 15, lineHeight: 1.2 }}>{f.icon}</div>
                <div style={{ fontSize: 10, fontWeight: 300, color: 'rgba(255,255,255,0.72)', marginTop: 4 }}>{f.label}</div>
              </div>
            ))}
          </div>
        </form>
      </div>
    </>
  )
}
