// 폰·PC 화면의 Claude 작업 공간 — 클로드 데스크톱처럼
//   왼쪽: 새 대화 · 프로젝트(관리) · 그 프로젝트의 대화 목록
//   가운데: 고른 대화의 전체 내역 + 진행 상황 + 입력칸
//   오른쪽: 안경 화면 미리보기
// 좁은 화면(폰)에서는 왼쪽이 서랍으로 접히고, 안경 미리보기는 펼침 버튼으로 엽니다.
// 대화는 서버(DB)에 저장되고, 안경은 '가장 최근 질문'을 따라가므로 어느 화면에서 물어도 같이 보입니다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { aiApi, aiConversationsApi, ApiError, todosApi } from '../lib/api.js'
import { parseChatFiles } from './importChats.js'
import { dateKey } from '../lib/dates.js'
import ProjectManager, { useProjects } from './ProjectsPanel.jsx'

const MAX_PHOTOS = 6
// Claude는 긴 변이 1568px를 넘는 사진을 어차피 줄여서 봅니다. 미리 줄이면 업로드가 빠르고
// 모니터 글자도 충분히 읽힙니다.
const PHOTO_MAX_SIDE = 1568
const GENERAL = '' // 프로젝트 없음(일반 질문)

async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  const url = canvas.toDataURL('image/jpeg', 0.85)
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), preview: url }
}

function ago(iso) {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return '방금'
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function todayKey() {
  const d = new Date()
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate())
}

const errMsg = (e) => (e instanceof ApiError && e.message && e.message !== 'network' ? e.message : '요청에 실패했어요.')

/**
 * conv: 지금 대화 { id: 숫자 | null(아직 질문 전인 새 대화), project: '' | 이름 }
 * ai: 안경과 같은 '가장 최근 질문' 상태(진행 상황 표시용)
 * version: 질문이 시작·끝날 때마다 늘어나는 수 — 목록·내역을 다시 불러오는 신호
 */
export default function Workspace({
  conv, onSelectConversation, onNewChat, version, ai, onAsk, speak, onSpeakChange, glassesPane, status,
}) {
  const { projects, load: loadProjects } = useProjects()
  const [conversations, setConversations] = useState(null)
  const [detail, setDetail] = useState(null) // { conversation, turns }
  const [error, setError] = useState('')
  const [drawer, setDrawer] = useState(false)
  const [managing, setManaging] = useState(false)
  const [showGlasses, setShowGlasses] = useState(false)
  const endRef = useRef(null)

  // 누가 답하는지(구독 / 한도라 API). 질문이 끝날 때마다 다시 봅니다.
  const [engine, setEngine] = useState(null)
  useEffect(() => {
    aiApi.status().then((r) => setEngine(r?.engine || null)).catch(() => {})
  }, [version])

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await aiConversationsApi.list())
    } catch (e) {
      setError(errMsg(e))
    }
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations, version])

  useEffect(() => {
    if (!conv.id) { setDetail(null); return undefined }
    let cancelled = false
    aiConversationsApi.get(conv.id)
      .then((d) => { if (!cancelled) setDetail(d) })
      .catch((e) => { if (!cancelled) { setDetail(null); setError(errMsg(e)) } })
    return () => { cancelled = true }
  }, [conv.id, version])

  // 이 대화에서 진행 중인 질문(안경과 같은 상태). 새 대화의 첫 질문은 id가 아직 없을 수 있습니다.
  const live = (ai.status === 'loading' || ai.status === 'error')
    && (ai.conversationId == null ? !conv.id : ai.conversationId === conv.id) ? ai : null
  const turns = detail?.conversation?.id === conv.id ? detail.turns : []

  // 새 내용이 생기면 맨 아래로
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [turns.length, live?.progress?.length, live?.status, conv.id])

  // 안경에 띄우기: 켜 두면 지금 보는 대화의 마지막 답(또는 '안경에'를 누른 답)이 안경에 떠요. 끄면 원래대로.
  const [toGlasses, setToGlasses] = useState(() => { try { return localStorage.getItem('g2_to_glasses') === '1' } catch { return false } })
  const [pinned, setPinned] = useState(null) // 고른 답 id (없으면 마지막 답)
  const [pinErr, setPinErr] = useState('')
  const lastTurnId = turns.length ? turns[turns.length - 1].id : null
  useEffect(() => { setPinned(null) }, [conv.id])
  useEffect(() => {
    if (!toGlasses || !conv.id || !lastTurnId) return undefined
    const send = () => aiConversationsApi.pinToGlasses(conv.id, pinned ?? lastTurnId)
      .then(() => setPinErr(''))
      .catch((e) => setPinErr(`안경에 띄우지 못했어요: ${e?.status === 404 ? '서버에 아직 이 기능이 없어요(백엔드 배포 확인)' : errMsg(e)}`))
    send()
    // 서버는 이 값을 메모리에만 둬서, 배포·재시작하면 사라집니다 → 켜져 있는 동안 30초마다 다시 알려 줍니다.
    const t = setInterval(() => { if (!document.hidden) send() }, 30000)
    return () => clearInterval(t)
  }, [toGlasses, conv.id, lastTurnId, pinned])
  const switchGlasses = () => {
    const on = !toGlasses
    setToGlasses(on)
    try { localStorage.setItem('g2_to_glasses', on ? '1' : '0') } catch { /* 저장 불가 */ }
    if (!on) { setPinned(null); setPinErr(''); aiConversationsApi.unpinGlasses().catch(() => {}) }
  }
  const pinTurn = (id) => {
    setPinned(id)
    if (!toGlasses) { setToGlasses(true); try { localStorage.setItem('g2_to_glasses', '1') } catch { /* */ } }
  }

  const pick = (fn) => (...args) => { setDrawer(false); fn(...args) }
  const ready = (projects || []).filter((p) => p.status === 'ready')
  const projectConvs = (conversations || []).filter((c) => (c.project || GENERAL) === conv.project)
  const title = conv.id ? (detail?.conversation?.title || '대화') : '새 대화'

  const rename = async (c) => {
    const t = window.prompt('대화 이름', c.title)
    if (t == null || !t.trim()) return
    try { await aiConversationsApi.rename(c.id, t.trim()); loadConversations() } catch (e) { setError(errMsg(e)) }
  }
  const remove = async (c) => {
    if (!window.confirm(`"${c.title}" 대화를 지울까요?`)) return
    try {
      await aiConversationsApi.remove(c.id)
      if (c.id === conv.id) onNewChat(conv.project)
      loadConversations()
    } catch (e) { setError(errMsg(e)) }
  }

  // Claude 대화 가져오기: claude.ai 내보내기 zip / conversations.json / Claude Code .jsonl
  const importRef = useRef(null)
  const [importing, setImporting] = useState('')
  async function importFiles(files) {
    if (!files?.length) return
    setError(''); setImporting('파일 읽는 중...')
    try {
      const chats = await parseChatFiles([...files])
      if (!chats.length) { setImporting(''); setError('가져올 대화를 찾지 못했어요.'); return }
      let added = 0
      for (let i = 0; i < chats.length; i++) {
        setImporting(`가져오는 중 ${i + 1}/${chats.length}`)
        const r = await aiConversationsApi.importChat(chats[i])
        added += r?.added || 0
      }
      setImporting(`대화 ${chats.length}개 확인 · 새 질문 ${added}개 추가`)
      loadConversations()
      setTimeout(() => setImporting(''), 5000)
    } catch (e) { setImporting(''); setError(errMsg(e)) }
  }

  const sidebar = (
    <nav className="ws-side" aria-label="프로젝트와 대화">
      <button type="button" className="ws-new" onClick={pick(() => onNewChat(conv.project))}>+ 새 대화</button>
      <button type="button" className="ws-link" onClick={() => importRef.current?.click()} disabled={!!importing && !importing.startsWith('대화')}
        title="claude.ai 내보내기 zip(설정 > 개인정보 > 데이터 내보내기) 또는 Claude Code 세션 .jsonl">
        Claude 대화 가져오기
      </button>
      <input ref={importRef} type="file" accept=".zip,.json,.jsonl" multiple hidden onChange={(e) => { importFiles(e.target.files); e.target.value = '' }} />
      {importing && <p className="ws-engine">{importing}</p>}

      <div className="ws-sec">
        <span>프로젝트</span>
        <button type="button" className="ws-link" onClick={() => setManaging(true)}>관리</button>
      </div>
      <ul className="ws-list">
        {[{ name: GENERAL }, ...ready].map((p) => (
          <li key={p.name || '_'}>
            <button type="button" className={`ws-item${conv.project === p.name ? ' on' : ''}`}
              onClick={pick(() => onNewChat(p.name))} title={p.name ? `${p.name} 코드를 읽으며 답해요` : '프로젝트 없이 묻기'}>
              {p.name || '일반 질문'}
            </button>
          </li>
        ))}
        {(projects || []).filter((p) => p.status !== 'ready').map((p) => (
          <li key={p.name} className="ws-dim">{p.name} · {p.status === 'syncing' ? '받는 중' : '실패'}</li>
        ))}
      </ul>

      <div className="ws-sec"><span>대화 · {conv.project || '일반 질문'}</span></div>
      <ul className="ws-list ws-convs">
        {conversations === null && <li className="ws-dim">불러오는 중...</li>}
        {conversations && projectConvs.length === 0 && <li className="ws-dim">아직 대화가 없어요.</li>}
        {projectConvs.map((c) => (
          <li key={c.id} className="ws-conv">
            <button type="button" className={`ws-item${c.id === conv.id ? ' on' : ''}`} onClick={pick(() => onSelectConversation(c))}>
              <span className="ws-title">{c.title}</span>
              <span className="ws-time">{ago(c.updatedAt)}</span>
            </button>
            <span className="ws-actions">
              <button type="button" aria-label={`${c.title} 이름 바꾸기`} onClick={() => rename(c)}>이름</button>
              <button type="button" aria-label={`${c.title} 지우기`} onClick={() => remove(c)}>삭제</button>
            </span>
          </li>
        ))}
      </ul>
      <EngineInfo engine={engine} />
    </nav>
  )

  return (
    <div className="ws">
      <style>{CSS}</style>
      <header className="ws-top">
        <button type="button" className="ws-menu" onClick={() => setDrawer((o) => !o)} aria-expanded={drawer}>☰ 대화</button>
        <div className="ws-head">
          <strong>{title}</strong>
          <span>{conv.project ? `프로젝트 ${conv.project} · Claude가 코드를 직접 읽어요` : '일반 질문'}</span>
        </div>
        <button type="button" className={`ws-btn ws-pin${toGlasses ? ' on' : ''}`} onClick={switchGlasses} aria-pressed={toGlasses}
          title="켜면 지금 보는 대화의 답이 안경에 떠요">
          {toGlasses ? '안경에 띄우는 중' : '안경에 띄우기'}
        </button>
        <button type="button" className="ws-glass-toggle" onClick={() => setShowGlasses((o) => !o)} aria-expanded={showGlasses}>
          안경 화면 {showGlasses ? '▲' : '▼'}
        </button>
        <span className="ws-status">{status}</span>
      </header>

      <div className={`ws-body${drawer ? ' drawer' : ''}`}>
        {sidebar}
        {drawer && <button type="button" className="ws-scrim" aria-label="닫기" onClick={() => setDrawer(false)} />}

        <main className="ws-main">
          <div className="ws-chat" aria-live="polite">
            {error && <p className="ws-err">{error} <button type="button" className="ws-link" onClick={() => setError('')}>닫기</button></p>}
            {toGlasses && pinErr && <p className="ws-err">{pinErr}</p>}
            {toGlasses && !pinErr && conv.id && !lastTurnId && <p className="ws-engine">이 대화에 아직 답이 없어서 안경에 띄울 게 없어요.</p>}
            {turns.length === 0 && !live && (
              <div className="ws-empty">
                <p>{conv.project ? `${conv.project} 프로젝트에 대해 물어보세요.` : '무엇이든 물어보세요.'}</p>
                <p>답은 이 화면과 안경에 같이 떠요. 폰·PC·안경 마이크 어디서 이어 물어도 같은 대화예요.</p>
              </div>
            )}
            {turns.map((t) => (
              <Turn key={t.id} turn={t} onGlasses={() => pinTurn(t.id)}
                onGlassesNow={toGlasses && (pinned ?? lastTurnId) === t.id} />
            ))}
            {live && (
              <div className="ws-turn">
                <div className="ws-q">{live.question || '사진 속 요구사항 보기'}{live.imageCount ? <em> · 사진 {live.imageCount}장</em> : null}</div>
                {live.status === 'loading' ? (
                  <div className="ws-a ws-progress">
                    <span className="ws-dot" aria-hidden="true" /> 생각하는 중...
                    {live.progress?.length > 0 && (
                      <ul>{live.progress.slice(-8).map((p, i) => <li key={`${i}-${p}`}>{p}</li>)}</ul>
                    )}
                  </div>
                ) : <div className="ws-a ws-err">{live.error}</div>}
              </div>
            )}
            <div ref={endRef} />
          </div>
          <Composer busy={ai.status === 'loading'} project={conv.project} onAsk={onAsk} speak={speak} onSpeakChange={onSpeakChange} />
        </main>

        <aside className={`ws-glasses${showGlasses ? ' open' : ''}`} aria-label="안경 화면">{glassesPane}</aside>
      </div>

      {managing && (
        <div className="ws-modal" role="dialog" aria-modal="true" aria-label="프로젝트 관리">
          <div className="ws-modal-box">
            <div className="ws-sec" style={{ marginTop: 0 }}>
              <span style={{ fontSize: 15, color: '#e8e8ea' }}>프로젝트 관리</span>
              <button type="button" className="ws-link" onClick={() => setManaging(false)}>닫기</button>
            </div>
            <ProjectManager projects={projects} load={loadProjects}
              onSelect={(name) => { setManaging(false); onNewChat(name) }} />
          </div>
        </div>
      )}
    </div>
  )
}

const hhmm = (iso) => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 지금 누가 답하는지: 구독(서버의 Claude Code) 먼저, 한도에 걸리면 API 키
function EngineInfo({ engine }) {
  if (!engine) return null
  const sub = engine.subscription
  let text
  if (!sub?.installed) text = engine.api ? 'API 키로 답해요' : '답할 수 있는 방법이 없어요'
  else if (sub.pausedUntil) {
    text = engine.api
      ? `구독 쉬는 중(${sub.reason}) · ${hhmm(sub.pausedUntil)}까지 API로 답해요`
      : `구독 쉬는 중(${sub.reason}) · API 키가 없어 ${hhmm(sub.pausedUntil)} 이후 다시 물어봐 주세요`
  } else text = engine.api ? '구독으로 답해요 · 한도에 걸리면 API로' : '구독으로 답해요'
  return <p className="ws-engine" title="구독 = 서버의 Claude Code(구독 계정), API = API 키(사용한 만큼 청구)">{text}</p>
}

// 질문·답 한 쌍. 답 = 안경용 요약, 전체 답(코드), 할 일로 저장할 단계
const ENGINE_KO = { subscription: '구독', api: 'API', 'claude-code': 'Claude Code' }

function Turn({ turn, onGlasses, onGlassesNow }) {
  const [save, setSave] = useState({ status: 'idle', done: 0 })
  const steps = turn.steps || []
  const saveSteps = async () => {
    setSave((s) => ({ ...s, status: 'saving' }))
    try {
      // 중간에 실패하면 다시 눌렀을 때 남은 단계부터 이어서 저장합니다(순서 유지).
      for (let i = save.done; i < steps.length; i++) {
        await todosApi.create(steps[i], todayKey())
        setSave({ status: 'saving', done: i + 1 })
      }
      setSave({ status: 'saved', done: steps.length })
    } catch {
      setSave((s) => ({ ...s, status: 'error' }))
    }
  }
  return (
    <div className="ws-turn">
      <div className="ws-q">{turn.question}{turn.imageCount ? <em> · 사진 {turn.imageCount}장</em> : null}</div>
      <div className="ws-a">
        {turn.engine && <span className={`ws-badge ${turn.engine}`}>{ENGINE_KO[turn.engine] || turn.engine}</span>}
        <button type="button" className={`ws-link ws-pin-one${onGlassesNow ? ' on' : ''}`} onClick={onGlasses}>
          {onGlassesNow ? '안경에 떠 있음' : '안경에'}
        </button>
        <pre>{turn.answer}</pre>
        {turn.detail && (
          <details open>
            <summary>전체 답 / 수정 코드</summary>
            <pre className="ws-code">{turn.detail}</pre>
          </details>
        )}
        {steps.length > 0 && (
          <div className="ws-steps">
            <ol>{steps.map((s, i) => <li key={`${i}-${s}`}>{s}</li>)}</ol>
            <button type="button" className="ws-btn" onClick={saveSteps} disabled={save.status === 'saving' || save.status === 'saved'}>
              {{ saving: `저장 중... (${save.done}/${steps.length})`, saved: `오늘 할 일에 ${steps.length}개 저장됨`, error: '저장 실패 — 다시 저장' }[save.status]
                || `오늘 할 일로 저장 (${steps.length}개)`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// 입력칸: 질문 + 사진(모니터를 찍어 보내기)
function Composer({ busy, project, onAsk, speak, onSpeakChange }) {
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState([])
  const [photoError, setPhotoError] = useState('')
  const cameraRef = useRef(null)
  const albumRef = useRef(null)

  const addPhotos = async (files) => {
    setPhotoError('')
    const all = [...(files || [])]
    const list = all.filter((f) => f.type.startsWith('image/'))
    const room = MAX_PHOTOS - photos.length
    // zip 등을 사진 칸에 넣으면 조용히 버려지고 Claude는 "사진만 읽을 수 있다"고 답합니다. 바로 알려 줍니다.
    if (list.length < all.length) {
      setPhotoError('사진이 아닌 파일은 여기에 넣을 수 없어요. zip은 왼쪽 "프로젝트 → 관리 → zip 업로드"로 올린 뒤, 그 프로젝트를 고르고 물어보세요.')
    } else if (list.length > room) setPhotoError(`사진은 ${MAX_PHOTOS}장까지예요.`)
    try {
      const shrunk = await Promise.all(list.slice(0, Math.max(0, room)).map(shrinkPhoto))
      setPhotos((p) => [...p, ...shrunk].slice(0, MAX_PHOTOS))
    } catch (e) {
      console.error('[g2] 사진 처리 실패', e)
      setPhotoError('사진을 읽지 못했어요. 다른 사진으로 해 보세요.')
    }
  }

  const canSend = !busy && (text.trim() || photos.length)
  const submit = (e) => {
    e.preventDefault()
    if (!canSend) return
    onAsk(text, photos.map(({ mediaType, data }) => ({ mediaType, data })))
    setText('')
    setPhotos([])
  }

  return (
    <form className="ws-compose" onSubmit={submit}>
      {photos.length > 0 && (
        <div className="ws-photos">
          {photos.map((p, i) => (
            <div key={p.preview.slice(-32) + i}>
              <img src={p.preview} alt={`사진 ${i + 1}`} />
              <button type="button" aria-label={`사진 ${i + 1} 빼기`} onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}>x</button>
            </div>
          ))}
        </div>
      )}
      {photoError && <p className="ws-err">{photoError}</p>}
      <textarea
        id="g2-ask"
        aria-label="Claude에게 질문"
        value={text}
        onChange={(e) => setText(e.target.value)}
        // PC: Enter 보내기, Shift+Enter 줄바꿈 (폰 키보드의 줄바꿈은 그대로)
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) submit(e)
        }}
        rows={2}
        placeholder={photos.length ? '예: 이 요구사항대로 고치려면? (비우면 기본 질문)'
          : project ? `${project}에 대해 물어보세요 (예: 로그인 처리는 어디서 해?)` : 'Claude에게 물어보세요'}
      />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
      <input ref={albumRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
      <div className="ws-compose-row">
        <button type="button" className="ws-btn" onClick={() => cameraRef.current?.click()} disabled={busy || photos.length >= MAX_PHOTOS}>사진 찍기</button>
        <button type="button" className="ws-btn" onClick={() => albumRef.current?.click()} disabled={busy || photos.length >= MAX_PHOTOS}>앨범</button>
        <label className="ws-speak">
          <input type="checkbox" checked={speak} onChange={(e) => onSpeakChange(e.target.checked)} /> 폰으로 읽어 주기
        </label>
        <button type="submit" className="ws-btn ws-send" disabled={!canSend}>{busy ? '답을 기다리는 중...' : '보내기'}</button>
      </div>
    </form>
  )
}

const CSS = `
.ws { --bg:#0b0d12; --panel:#11141b; --line:#222831; --text:#e8e8ea; --muted:#9aa0aa; --dim:#6b717c; --accent:#4dff7a;
  min-height:100vh; height:100dvh; display:flex; flex-direction:column; background:var(--bg); color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif; }
.ws button { font:inherit; }
.ws-top { display:flex; align-items:center; gap:12px; padding:10px 16px; border-bottom:1px solid var(--line); min-height:52px; box-sizing:border-box; }
.ws-head { flex:1; min-width:0; display:flex; flex-direction:column; }
.ws-head strong { font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ws-head span, .ws-status { font-size:12px; color:var(--muted); }
.ws-status { white-space:nowrap; }
.ws-pin.on { border-color:#6fd3a0; color:#6fd3a0; }
.ws-pin-one { float:right; font-size:12px; }
.ws-pin-one.on { color:#6fd3a0; text-decoration:none; }
.ws-menu, .ws-glass-toggle { display:none; background:none; border:1px solid var(--line); color:var(--text); border-radius:8px; padding:6px 10px; cursor:pointer; white-space:nowrap; }
.ws-body { flex:1; min-height:0; display:grid; grid-template-columns:260px minmax(0,1fr) 360px; }
.ws-side { border-right:1px solid var(--line); padding:12px; overflow-y:auto; background:var(--panel); }
.ws-new { width:100%; padding:10px; border-radius:10px; border:1px solid rgba(77,255,122,.35); background:rgba(77,255,122,.08); color:#c8ffd6; cursor:pointer; font-size:14px; }
.ws-sec { display:flex; justify-content:space-between; align-items:center; margin:18px 4px 6px; font-size:12px; color:var(--muted); }
.ws-link { background:none; border:none; color:#c8ffd6; cursor:pointer; font-size:12px; padding:2px 4px; }
.ws-list { list-style:none; margin:0; padding:0; }
.ws-item { width:100%; display:flex; justify-content:space-between; gap:8px; text-align:left; background:none; border:none; color:var(--text);
  padding:8px 10px; border-radius:8px; cursor:pointer; font-size:14px; }
.ws-item:hover { background:#1a1e26; }
.ws-item.on { background:#1d2430; box-shadow:inset 2px 0 0 var(--accent); }
.ws-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ws-time { color:var(--dim); font-size:11px; white-space:nowrap; }
.ws-dim { color:var(--dim); font-size:12px; padding:6px 10px; }
.ws-conv { position:relative; }
.ws-actions { display:none; position:absolute; right:4px; top:50%; transform:translateY(-50%); gap:2px; background:#1a1e26; border-radius:6px; }
.ws-conv:hover .ws-actions, .ws-conv:focus-within .ws-actions { display:flex; }
.ws-actions button { background:none; border:none; color:var(--muted); font-size:11px; padding:4px 6px; cursor:pointer; }
.ws-actions button:hover { color:var(--text); }
.ws-main { display:flex; flex-direction:column; min-width:0; min-height:0; }
.ws-chat { flex:1; overflow-y:auto; padding:20px 24px; }
.ws-empty { color:var(--muted); font-size:14px; margin:48px auto; max-width:520px; text-align:center; line-height:1.7; }
.ws-turn { max-width:760px; margin:0 auto 22px; }
.ws-q { margin-left:auto; width:fit-content; max-width:85%; background:#1d2430; border-radius:14px 14px 4px 14px; padding:10px 14px; white-space:pre-wrap; word-break:break-word; font-size:15px; line-height:1.55; }
.ws-q em { color:var(--muted); font-style:normal; font-size:13px; }
.ws-a { margin-top:10px; font-size:15px; line-height:1.65; }
.ws-a pre { margin:0; white-space:pre-wrap; word-break:break-word; font:inherit; }
.ws-a details { margin-top:10px; }
.ws-a summary { cursor:pointer; color:var(--muted); font-size:13px; }
.ws-code { margin-top:8px !important; padding:12px; background:var(--panel); border:1px solid var(--line); border-radius:8px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"D2Coding",monospace !important; font-size:13px !important; line-height:1.55; overflow-x:auto; }
.ws-steps { margin-top:10px; padding:10px 12px; border:1px solid var(--line); border-radius:8px; }
.ws-steps ol { margin:0 0 8px; padding-left:20px; font-size:14px; }
.ws-progress { color:var(--muted); font-size:14px; }
.ws-progress ul { margin:6px 0 0; padding-left:18px; font-size:13px; color:var(--dim); }
.ws-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--accent); margin-right:6px; animation:wsPulse 1.2s infinite; }
@keyframes wsPulse { 50% { opacity:.25 } }
@media (prefers-reduced-motion: reduce) { .ws-dot { animation:none } }
.ws-err { color:#ffb4a8; font-size:13px; }
.ws-engine { margin:20px 4px 0; padding-top:12px; border-top:1px solid var(--line); font-size:12px; color:var(--muted); line-height:1.5; }
.ws-badge { display:inline-block; font-size:11px; padding:0 6px; border-radius:4px; margin-bottom:4px; border:1px solid var(--line); color:var(--muted); }
.ws-badge.subscription { color:#c8ffd6; border-color:rgba(77,255,122,.35); }
.ws-compose { border-top:1px solid var(--line); padding:12px 24px 16px; }
.ws-compose textarea { width:100%; box-sizing:border-box; background:var(--panel); color:var(--text); border:1px solid #2a2f3a; border-radius:10px; padding:10px 12px; font-size:15px; resize:vertical; min-height:48px; max-height:40vh; font-family:inherit; }
.ws-compose-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:8px; }
.ws-speak { font-size:13px; color:var(--muted); display:flex; gap:6px; align-items:center; }
.ws-send { margin-left:auto; }
.ws-btn { background:rgba(77,255,122,.08); color:#c8ffd6; border:1px solid rgba(77,255,122,.35); border-radius:8px; padding:8px 12px; font-size:14px; cursor:pointer; white-space:nowrap; }
.ws-btn:disabled { opacity:.5; cursor:default; }
.ws-photos { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px; }
.ws-photos div { position:relative; }
.ws-photos img { width:64px; height:64px; object-fit:cover; border-radius:6px; border:1px solid #2a2f3a; }
.ws-photos button { position:absolute; top:-6px; right:-6px; width:22px; height:22px; border-radius:11px; border:0; background:#e8e8ea; color:#0b0d12; font-size:12px; cursor:pointer; }
.ws-glasses { border-left:1px solid var(--line); padding:16px; overflow-y:auto; background:var(--panel); }
.ws-scrim { display:none; }
.ws-modal { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:flex-start; justify-content:center; padding:48px 16px; z-index:60; overflow-y:auto; }
.ws-modal-box { width:100%; max-width:560px; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; }
@media (max-width: 1180px) {
  .ws-body { grid-template-columns:240px minmax(0,1fr); }
  .ws-glass-toggle { display:inline-block; }
  .ws-glasses { display:none; position:fixed; right:16px; top:60px; width:min(380px, calc(100vw - 32px)); max-height:calc(100dvh - 80px); border:1px solid var(--line); border-radius:12px; z-index:40; box-shadow:0 12px 40px rgba(0,0,0,.6); }
  .ws-glasses.open { display:block; }
}
@media (max-width: 760px) {
  .ws-top { padding:8px 12px; gap:8px; flex-wrap:wrap; }
  .ws-status { display:none; }
  .ws-menu { display:inline-block; }
  .ws-body { display:flex; flex-direction:column; }
  .ws-main { flex:1; min-height:0; }
  .ws-side { display:none; }
  .ws-body.drawer .ws-side { display:block; position:fixed; left:0; top:0; bottom:0; width:min(300px, 84vw); z-index:50; }
  .ws-body.drawer .ws-scrim { display:block; position:fixed; inset:0; background:rgba(0,0,0,.5); border:0; z-index:45; }
  .ws-chat { padding:16px; }
  .ws-compose { padding:10px 12px 12px; }
  .ws-q { max-width:92%; }
  .ws-actions { display:flex; position:static; transform:none; background:none; justify-content:flex-end; }
  .ws-glasses { position:static; width:auto; max-height:45dvh; flex:none; border:0; border-bottom:1px solid var(--line); border-radius:0; box-shadow:none; order:-1; }
}
`
