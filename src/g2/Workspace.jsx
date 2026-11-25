// 폰·PC 화면의 Claude 작업 공간 — 클로드 데스크톱처럼
//   왼쪽: 새 대화 · 프로젝트(관리) · 그 프로젝트의 대화 목록
//   가운데: 고른 대화의 전체 내역 + 진행 상황 + 입력칸
//   오른쪽: 안경 화면 미리보기
// 좁은 화면(폰)에서는 왼쪽이 서랍으로 접히고, 안경 미리보기는 펼침 버튼으로 엽니다.
// 대화는 서버(DB)에 저장되고, 안경은 '가장 최근 질문'을 따라가므로 어느 화면에서 물어도 같이 보입니다.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { aiApi, aiConversationsApi, ApiError, pcApi, todosApi } from '../lib/api.js'
import Markdown, { MARKDOWN_CSS } from './Markdown.jsx'
import ChangePassword from '../components/ChangePassword.jsx'
import DeviceTokens from '../components/DeviceTokens.jsx'
import ApiKey from '../components/ApiKey.jsx'
// 작은 SVG라 번들에 바로 들어가요(안경 앱 패키지에도 따로 파일 없이 보임)
import logoUrl from './icon.svg'
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

// 작은 선 아이콘(색은 글자색을 따름)
const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
const I = {
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>,
  share: <><path d="M12 3v12" /><path d="m7 8 5-5 5 5" /><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 17-5-5-9 8" /></>,
  glasses: <><circle cx="7" cy="14" r="3.5" /><circle cx="17" cy="14" r="3.5" /><path d="M10.5 14h3" /></>,
  more: <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
}

// Claude Code가 긴 대화를 요약하고 이어 간 세션은 첫 질문이 요약문이라 제목이 "This session is being continued…" 로 붙어요.
const clip = (t, n) => { const x = String(t || '').replace(/\s+\n/g, '\n').trim(); return x.length > n ? `${x.slice(0, n)}…` : x }
const cleanTitle = (t) => (/^this session is being continued/i.test(t || '') ? '이어서 한 세션' : (t || '(제목 없음)'))

// 대화 목록 날짜 묶음: 오늘 / 어제 / 이번 주 / 이번 달 / 이전
function dateGroup(iso) {
  const d = new Date(iso), now = new Date()
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86400000)
  if (diff <= 0) return '오늘'
  if (diff === 1) return '어제'
  if (diff < 7) return '이번 주'
  if (diff < 31) return '이번 달'
  return '이전'
}
const LIST_LIMIT = 10

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
  // 대화 목록 탭: 'chat' 모멘텀에서 한 질문 / 'code' PC Claude Code 등 밖에서 가져온 대화
  // 폰 키보드: 보이는 영역(visualViewport) 높이에 화면을 맞춰 입력창이 키보드 위에 오게 합니다.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return undefined
    const root = document.documentElement
    const fit = () => {
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`)
      // 아이폰은 키보드가 뜰 때 페이지 전체를 위로 밀어 올려서, 다시 맨 위에 붙여 둠
      if (window.scrollY) window.scrollTo(0, 0)
    }
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); root.style.removeProperty('--vvh') }
  }, [])

  const [listTab, setListTab] = useState('chat')
  const [moreMenu, setMoreMenu] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [showOlder, setShowOlder] = useState({}) // 묶음별 '이전 세션' 펼침
  const [pwOpen, setPwOpen] = useState(false)
  const [devOpen, setDevOpen] = useState(false)
  const [keyOpen, setKeyOpen] = useState(false)
  const [pcAgents, setPcAgents] = useState([])
  const [pcJobs, setPcJobs] = useState([])
  // Claude Code 프로젝트 묶음 접기(브라우저에 기억)
  const [folded, setFolded] = useState(() => { try { return JSON.parse(localStorage.getItem('g2_code_folded') || '{}') } catch { return {} } })
  const toggleFold = (name) => setFolded((f) => {
    const n = { ...f, [name]: !f[name] }
    try { localStorage.setItem('g2_code_folded', JSON.stringify(n)) } catch { /* 무시 */ }
    return n
  })

  // 누가 답하는지(구독 / 한도라 API). 질문이 끝날 때마다 다시 봅니다.
  const [engine, setEngine] = useState(null)
  const [aiStatus, setAiStatus] = useState(null) // { owner, key: { hasKey, last4 } }
  const [keyTick, setKeyTick] = useState(0)
  useEffect(() => {
    aiApi.status().then((r) => { setEngine(r?.engine || null); setAiStatus(r || null) }).catch(() => {})
  }, [version, keyTick])
  const isOwner = aiStatus ? aiStatus.owner !== false : true

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

  // PC Claude Code 동기화처럼 다른 곳에서 들어온 대화도 곧바로 보이도록, 화면을 보고 있는 동안 10초마다 조용히 다시 불러옵니다.
  // (실패해도 오류를 띄우지 않고, 질문 수가 바뀌었을 때만 화면을 갱신)
  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return
      try {
        const list = await aiConversationsApi.list()
        setConversations((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list))
        if (conv.id) {
          const d = await aiConversationsApi.get(conv.id)
          setDetail((prev) => (prev?.conversation?.id === d?.conversation?.id && prev?.turns?.length === d?.turns?.length
            && prev?.turns?.at(-1)?.answer === d?.turns?.at(-1)?.answer ? prev : d))
        }
      } catch { /* 다음 차례에 다시 */ }
    }
    const t = setInterval(tick, 10000)
    const onVis = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [conv.id])

  // PC 에이전트(연결된 PC)와 PC로 보낸 질문 상태. 화면을 보는 동안 5초마다 확인.
  const loadPc = useCallback(async () => {
    try { setPcAgents(await pcApi.agents() || []) } catch { setPcAgents([]) }
    try { setPcJobs(await pcApi.jobs() || []) } catch { /* 무시 */ }
  }, [])
  useEffect(() => {
    loadPc()
    const t = setInterval(() => { if (!document.hidden) loadPc() }, 5000)
    return () => clearInterval(t)
  }, [loadPc])

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

  // 대화 내보내기: 다른 곳(다른 AI, 메모 앱 등)에 붙여 쓰도록 마크다운으로
  const toMarkdown = (c, ts) => [
    `# ${c.title}`,
    `${c.project ? `프로젝트: ${c.project} · ` : ''}${new Date(c.createdAt).toLocaleString('ko-KR')}`,
    '',
    ...ts.flatMap((t) => [`## Q. ${t.question}`, '', t.answer, ...(t.detail ? ['', t.detail] : []),
      ...(t.steps?.length ? ['', '할 일:', ...t.steps.map((x, i) => `${i + 1}. ${x}`)] : []), '']),
  ].join('\n')
  const download = (name, text, type) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type }))
    a.download = name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const safeName = (t) => (t || '대화').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60)
  const [exportMsg, setExportMsg] = useState('')
  async function exportOne(mode) {
    if (!detail?.conversation) return
    const md = toMarkdown(detail.conversation, turns)
    try {
      if (mode === 'copy') { await navigator.clipboard.writeText(md); setExportMsg('복사했어요') }
      else if (mode === 'share' && navigator.share) await navigator.share({ title: detail.conversation.title, text: md })
      else { download(`${safeName(detail.conversation.title)}.md`, md, 'text/markdown'); setExportMsg('파일로 받았어요') }
    } catch (e) { if (e?.name !== 'AbortError') setExportMsg('내보내지 못했어요') }
    setTimeout(() => setExportMsg(''), 3000)
  }
  async function exportAll() {
    setImporting('전체 대화 모으는 중...')
    try {
      const list = await aiConversationsApi.list()
      const all = []
      for (let i = 0; i < list.length; i++) {
        setImporting(`전체 대화 모으는 중 ${i + 1}/${list.length}`)
        const d = await aiConversationsApi.get(list[i].id)
        all.push({ ...d.conversation, turns: d.turns })
      }
      const stamp = new Date().toISOString().slice(0, 10)
      download(`claude-대화-${stamp}.json`, JSON.stringify(all, null, 2), 'application/json')
      download(`claude-대화-${stamp}.md`, all.map((c) => toMarkdown(c, c.turns)).join('\n\n---\n\n'), 'text/markdown')
      setImporting(`대화 ${all.length}개를 파일로 받았어요`)
      setTimeout(() => setImporting(''), 5000)
    } catch (e) { setImporting(''); setError(errMsg(e)) }
  }

  const pick = (fn) => (...args) => { setDrawer(false); fn(...args) }
  const ready = (projects || []).filter((p) => p.status === 'ready')
  // 밖에서 가져온 대화 중 Claude Code 세션만 따로 묶음. chat- 은 데스크톱 앱 채팅을 MCP로 저장한 것 → 모멘텀 질문 쪽
  const isCode = (c) => !!c?.externalId && !/^(chat-|claude-ai:)/.test(c.externalId)
  const projectConvs = (conversations || []).filter((c) => !isCode(c) && (c.project || GENERAL) === conv.project)
  const codeConvs = (conversations || []).filter(isCode)
  // 제목 앞 [프로젝트] 로 묶기
  const codeGroups = []
  for (const c of codeConvs) {
    const m = /^\[([^\]]+)\]\s*/.exec(c.title || '')
    const g = m ? m[1] : '기타'
    let grp = codeGroups.find((x) => x.name === g)
    if (!grp) codeGroups.push(grp = { name: g, items: [], older: [] })
    const item = { ...c, short: cleanTitle(m ? c.title.slice(m[0].length) : c.title) }
    // Claude Code로 이전 세션을 이어 열면(--resume) 앞 내용이 통째로 복사된 새 세션이 생겨 같은 제목이 겹쳐요.
    // 같은 묶음에 같은 제목이 있으면 가장 최근 것만 보이고, 이전 것은 '이전 세션'으로 접어 둡니다.
    const same = grp.items.find((x) => x.short === item.short)
    if (!same) grp.items.push(item)
    else if (new Date(item.updatedAt) > new Date(same.updatedAt)) { grp.items[grp.items.indexOf(same)] = item; grp.older.push(same) }
    else grp.older.push(item)
  }
  // 지금 보고 있는 대화가 접힌 쪽이면 그 묶음은 펼쳐서 보여 줌
  for (const g of codeGroups) {
    g.items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    g.older.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  }
  const curConv = (conversations || []).find((c) => c.id === conv.id) || detail?.conversation
  const codeMode = isCode(curConv)
  const sessionId = codeMode ? curConv.externalId : null
  const pcAgent = sessionId ? pcAgents.find((a) => a.sessions?.some((x) => x.sessionId === sessionId)) : null
  const myPcJobs = sessionId ? pcJobs.filter((j) => j.sessionId === sessionId).slice().reverse() : []
  const title = conv.id ? (detail?.conversation?.title || '대화') : '새 대화'

  useEffect(() => { if (codeMode) setListTab('code') }, [codeMode])

  // "This session is being continued…" 제목은 그 대화의 첫 실제 질문으로 한 번만 바꿔 둡니다(서버에 저장 → 다음부터는 그대로).
  const fixingRef = useRef(new Set())
  useEffect(() => {
    if (listTab !== 'code' || !conversations) return
    const todo = conversations.filter((c) => c.externalId && /^(\[[^\]]+\]\s*)?this session is being continued/i.test(c.title || '')
      && !fixingRef.current.has(c.id)).slice(0, 20)
    if (!todo.length) return
    let stop = false
    ;(async () => {
      let changed = false
      for (const c of todo) {
        if (stop) break
        fixingRef.current.add(c.id)
        try {
          const d = await aiConversationsApi.get(c.id)
          const q = (d?.turns || []).map((t) => (t.question || '').trim())
            .find((x) => x && !/^this session is being continued/i.test(x))
          if (!q) continue
          const pre = /^\[[^\]]+\]/.exec(c.title || '')?.[0]
          await aiConversationsApi.rename(c.id, `${pre ? `${pre} ` : ''}${q.replace(/\s+/g, ' ').slice(0, 50)}`)
          changed = true
        } catch { /* 다음에 다시 */ }
      }
      if (changed && !stop) loadConversations()
    })()
    return () => { stop = true }
  }, [listTab, conversations, loadConversations])

  const rename = async (c) => {
    // Claude Code 대화는 제목 앞 [프로젝트] 로 묶이므로, 이름만 바꾸고 그 묶음 표시는 그대로 둡니다.
    const m = /^\[([^\]]+)\]\s*/.exec(c.title || '')
    const t = window.prompt('대화 이름', m ? c.title.slice(m[0].length) : c.title)
    if (t == null || !t.trim()) return
    const name = m && !/^\[[^\]]+\]/.test(t.trim()) ? `[${m[1]}] ${t.trim()}` : t.trim()
    try { await aiConversationsApi.rename(c.id, name); loadConversations() } catch (e) { setError(errMsg(e)) }
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
      if (!chats.length) { setImporting(''); setError('가져올 대화를 찾지 못했어요. 내보내기로 받은 zip 파일을 통째로 고르거나, 그 안의 대화 파일(conversations.json 등)을 골라 주세요. manifest.json은 목록일 뿐이라 대화가 없어요.'); return }
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
      <div className="ws-newrow">
        <button type="button" className="ws-new" onClick={pick(() => onNewChat(conv.project))}>+ 새 대화</button>
        <div className="ws-more">
          <button type="button" className="ws-iconbtn" aria-label="더 보기" aria-expanded={moreMenu} onClick={() => setMoreMenu((o) => !o)}><Icon d={I.more} /></button>
          {moreMenu && (
            <>
              <button type="button" className="ws-menu-scrim" aria-label="닫기" onClick={() => setMoreMenu(false)} />
              <div className="ws-menu-pop" role="menu">
                <button type="button" role="menuitem" disabled={!!importing && !importing.startsWith('대화')}
                  title="claude.ai 내보내기 zip 또는 Claude Code 세션 .jsonl"
                  onClick={() => { setMoreMenu(false); importRef.current?.click() }}>Claude 대화 가져오기</button>
                <button type="button" role="menuitem" onClick={() => { setMoreMenu(false); exportAll() }}>전체 대화 내보내기</button>
                {isOwner && <button type="button" role="menuitem" onClick={() => { setMoreMenu(false); setManaging(true) }}>프로젝트 관리</button>}
                {!isOwner && <button type="button" role="menuitem" onClick={() => { setMoreMenu(false); setKeyOpen(true) }}>Claude API 키</button>}
                <button type="button" role="menuitem" onClick={() => { setMoreMenu(false); setDevOpen(true) }}>기기 연결 (PC·파이)</button>
                <button type="button" role="menuitem" onClick={() => { setMoreMenu(false); setPwOpen(true) }}>비밀번호 바꾸기</button>
              </div>
            </>
          )}
        </div>
      </div>
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
      {devOpen && <DeviceTokens onClose={() => setDevOpen(false)} />}
      {keyOpen && <ApiKey onClose={() => setKeyOpen(false)} onSaved={() => setKeyTick((n) => n + 1)} />}
      <input ref={importRef} type="file" accept=".zip,.json,.jsonl" multiple hidden onChange={(e) => { importFiles(e.target.files); e.target.value = '' }} />
      {importing && <p className="ws-engine">{importing}</p>}

      <label className="ws-label" htmlFor="ws-project">프로젝트</label>
      <select id="ws-project" className="ws-select" value={conv.project || GENERAL}
        onChange={(e) => { setDrawer(false); onNewChat(e.target.value) }}>
        {[{ name: GENERAL }, ...ready].map((p) => <option key={p.name || '_'} value={p.name}>{p.name || '일반 질문'}</option>)}
        {(projects || []).filter((p) => p.status !== 'ready').map((p) => (
          <option key={p.name} value={p.name} disabled>{p.name} · {p.status === 'syncing' ? '받는 중' : '실패'}</option>
        ))}
      </select>

      <div className="ws-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={listTab === 'chat'} className={listTab === 'chat' ? 'on' : ''} onClick={() => setListTab('chat')}>채팅</button>
        <button type="button" role="tab" aria-selected={listTab === 'code'} className={listTab === 'code' ? 'on' : ''} onClick={() => setListTab('code')}>
          Claude Code{codeConvs.length ? ` ${codeConvs.length}` : ''}
        </button>
      </div>
      {listTab === 'chat' ? (
        <>
        <ul className="ws-list ws-convs">
          {conversations === null && <li className="ws-dim">불러오는 중...</li>}
          {conversations && projectConvs.length === 0 && <li className="ws-dim">아직 대화가 없어요.</li>}
          {(showAll ? projectConvs : projectConvs.slice(0, LIST_LIMIT)).map((c, n, arr) => {
            const g = dateGroup(c.updatedAt)
            const head = n === 0 || dateGroup(arr[n - 1].updatedAt) !== g
            return (
              <Fragment key={c.id}>
                {head && <li className="ws-group">{g}</li>}
                <li className="ws-conv">
                  <button type="button" className={`ws-item${c.id === conv.id ? ' on' : ''}`} onClick={pick(() => onSelectConversation(c))} title={c.title}>
                    <span className="ws-title">{c.title}</span>
                  </button>
                  <span className="ws-actions">
                    <button type="button" aria-label={`${c.title} 이름 바꾸기`} onClick={() => rename(c)}>이름</button>
                    <button type="button" aria-label={`${c.title} 지우기`} onClick={() => remove(c)}>삭제</button>
                  </span>
                </li>
              </Fragment>
            )
          })}
          {projectConvs.length > LIST_LIMIT && (
            <li><button type="button" className="ws-showmore" onClick={() => setShowAll((v) => !v)}>
              {showAll ? '접기' : `더 보기 · ${projectConvs.length - LIST_LIMIT}개`}
            </button></li>
          )}
        </ul>
        </>
      ) : (
        <>
          <div className={`ws-pcstat${pcAgents.length ? ' on' : ''}`}
            title={pcAgents.length ? '이 PC의 대화는 여기서 이어 물을 수 있어요(코드 읽기만)' : 'PC에서 pc-agent를 켜 두면 여기서 이어 물을 수 있어요'}>
            <span className="ws-dot-sw" aria-hidden="true" />
            {pcAgents.length ? <>{pcAgents.map((a) => a.name).join(', ')} 연결됨</> : 'PC 연결 안 됨'}
          </div>
          {pcAgents.length > 0 && (
            <NewPcChat agents={pcAgents} jobs={pcJobs} codeConvs={codeConvs}
              onSent={loadPc} onError={(e) => setError(errMsg(e))}
              onOpen={(c) => { setDrawer(false); onSelectConversation(c) }} />
          )}
          {conversations && codeConvs.length === 0 && <p className="ws-dim">아직 없어요. PC에서 sync 스크립트를 돌리거나 "Claude 대화 가져오기"를 쓰세요.</p>}
          {codeGroups.map((g) => (
            <div key={g.name}>
              <button type="button" className="ws-sec ws-fold" onClick={() => toggleFold(g.name)} aria-expanded={!folded[g.name]}>
                <span>{folded[g.name] ? '▸' : '▾'} {g.name} <em>{g.items.length}</em></span>
              </button>
              {!folded[g.name] && <ul className="ws-list ws-convs">
                {[...g.items, ...((showOlder[g.name] || g.older.some((o) => o.id === conv.id)) ? g.older.map((o) => ({ ...o, isOlder: true })) : [])].map((c) => (
                  <li key={c.id} className="ws-conv">
                  <button type="button" className={`ws-item${c.id === conv.id ? ' on' : ''}`} onClick={pick(() => onSelectConversation(c))}>
                    <span className="ws-title">{c.isOlder && <em className="ws-older">이전 · </em>}{c.short}</span>
                    <span className="ws-time">{ago(c.updatedAt)}</span>
                  </button>
                  <span className="ws-actions">
                    <button type="button" aria-label={`${c.title} 이름 바꾸기`} onClick={() => rename(c)}>이름</button>
                    <button type="button" aria-label={`${c.title} 지우기`} onClick={() => remove(c)}>삭제</button>
                  </span>
                </li>
                ))}
                {g.older.length > 0 && (
                  <li><button type="button" className="ws-showmore" onClick={() => setShowOlder((o) => ({ ...o, [g.name]: !o[g.name] }))}>
                    {showOlder[g.name] ? '이전 세션 접기' : `같은 대화의 이전 세션 ${g.older.length}개`}
                  </button></li>
                )}
              </ul>}
            </div>
          ))}
        </>
      )}
      {isOwner ? <EngineInfo engine={engine} />
        : <p className="ws-engine">{aiStatus?.key?.hasKey ? `내 API 키(…${aiStatus.key.last4})로 답해요`
          : <>Claude에게 물으려면 <button type="button" className="ws-link" onClick={() => setKeyOpen(true)}>내 API 키 등록</button></>}</p>}
    </nav>
  )

  return (
    <div className="ws">
      <style>{CSS}</style>
      <header className="ws-top">
        <button type="button" className="ws-menu ws-iconbtn" onClick={() => setDrawer((o) => !o)} aria-expanded={drawer} aria-label="대화 목록"><Icon d={I.menu} /></button>
        <div className="ws-head">
          <span className="ws-brand"><img src={logoUrl} alt="" width="20" height="20" className="ws-logo" />모멘텀</span>
          <span className="ws-crumb" aria-hidden="true">/</span>
          <strong title={title}>{title}</strong>
          <span className={`ws-chip${codeMode ? ' cc' : ''}`}>
            {codeMode ? <>Claude Code{pcAgent ? ` · ${pcAgent.name}` : ' · PC 연결 안 됨'}</> : conv.project ? conv.project : '일반 질문'}
          </span>
        </div>
        <div className="ws-tools">
          {exportMsg && <em className="ws-toast">{exportMsg}</em>}
          {turns.length > 0 && (
            <>
              <button type="button" className="ws-iconbtn" onClick={() => exportOne('copy')} aria-label="대화 복사" title="대화 복사"><Icon d={I.copy} /></button>
              <button type="button" className="ws-iconbtn" onClick={() => exportOne(navigator.share ? 'share' : 'file')}
                aria-label={navigator.share ? '공유' : '파일로 저장'} title={navigator.share ? '공유' : '파일로 저장'}><Icon d={I.share} /></button>
            </>
          )}
          <span className="ws-vsep" aria-hidden="true" />
          <button type="button" className={`ws-pin${toGlasses ? ' on' : ''}`} onClick={switchGlasses} aria-pressed={toGlasses}
            title="켜면 지금 보는 대화의 답이 안경에 떠요">
            <span className="ws-dot-sw" aria-hidden="true" />{toGlasses ? '안경에 띄우는 중' : '안경 꺼짐'}
          </button>
          <button type="button" className="ws-glass-toggle ws-iconbtn" onClick={() => setShowGlasses((o) => !o)} aria-expanded={showGlasses}
            aria-label="안경 화면 미리보기" title="안경 화면 미리보기"><Icon d={I.eye} /></button>
          <span className="ws-status">{status}</span>
        </div>
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
            {myPcJobs.filter((j) => j.status !== 'done' || !turns.some((t) => t.question?.trim() === j.question.trim())).map((j) => (
              <div key={`pc-${j.id}`} className="ws-turn">
                <div className="ws-q">{j.question}</div>
                {j.status === 'queued' || j.status === 'running' ? (
                  <div className="ws-a ws-progress"><span className="ws-dot" aria-hidden="true" /> {j.status === 'queued' ? 'PC로 보내는 중...' : 'PC의 Claude Code가 답하는 중...'}</div>
                ) : j.status === 'error' ? <div className="ws-a ws-err">{j.error}</div>
                  : <div className="ws-a"><Markdown text={j.answer} /></div>}
              </div>
            ))}
            <div ref={endRef} />
          </div>
          {codeMode ? (
            <PcComposer agent={pcAgent} busy={myPcJobs.some((j) => j.status === 'queued' || j.status === 'running')}
              onAsk={async (q) => {
                try { await pcApi.ask(pcAgent.id, sessionId, q); loadPc() } catch (e) { setError(errMsg(e)) }
              }}
              onAskOffline={async (q) => {
                // PC가 꺼져 있을 때: 이 대화의 최근 내용을 붙여 '채팅'에 새 대화로 묻기(코드는 못 읽음)
                const recent = turns.slice(-3).map((t, i) => `Q${i + 1}. ${clip(t.question, 400)}\nA${i + 1}. ${clip(t.answer, 900)}`).join('\n\n')
                const prompt = `${q}\n\n---\n(참고: PC Claude Code 대화 "${cleanTitle(title)}"에서 이어지는 질문이에요. 지금은 코드를 열어 볼 수 없으니 아래 최근 대화 내용을 바탕으로 답해 주세요.)\n\n${recent}`
                await onNewChat(GENERAL)
                setListTab('chat')
                onAsk(prompt)
              }} />
          ) : (
            <Composer busy={ai.status === 'loading'} project={conv.project} onAsk={onAsk} speak={speak} onSpeakChange={onSpeakChange} />
          )}
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
const ENGINE_KO = { subscription: '구독', api: 'API', byok: '내 API 키', 'claude-code': 'Claude Code' }

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
        <Markdown text={turn.answer} />
        {turn.detail && (
          <details className="ws-more-card">
            <summary>{detailLabel(turn.detail)}</summary>
            <Markdown text={turn.detail} className="ws-detail" />
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
        <div className="ws-a-foot">
          <button type="button" className={`ws-glassbtn${onGlassesNow ? ' on' : ''}`} onClick={onGlasses} aria-pressed={!!onGlassesNow}>
            {onGlassesNow ? <><span className="ws-dot-sw" aria-hidden="true" />안경에 떠 있음</> : <><Icon d={I.glasses} size={15} />안경에</>}
          </button>
          {turn.engine && <span className={`ws-badge ${turn.engine}`}>{ENGINE_KO[turn.engine] || turn.engine}</span>}
        </div>
      </div>
    </div>
  )
}

// 접힌 "자세히" 카드 제목: 자세한 답의 첫 제목(없으면 첫 줄) + 코드가 있으면 "· 코드"
function detailLabel(detail) {
  const t = String(detail || '')
  const h = /^#{1,4}\s+(.+)$/m.exec(t)
  let label = (h ? h[1] : t.split('\n').find((l) => l.trim() && !l.trim().startsWith('```')) || '자세히').replace(/[*`#]/g, '').trim()
  if (label.length > 28) label = `${label.slice(0, 28)}…`
  return /```/.test(t) ? `${label} · 코드` : label
}

// 입력칸: 질문 + 사진(모니터를 찍어 보내기)
// PC에서 새 Claude Code 대화 시작: PC·프로젝트 폴더를 고르고 질문 → 그 폴더에서 새 세션(읽기 전용).
// 끝나면 동기화로 Claude Code 목록에 새 대화가 생기고, 여기서 바로 열 수 있어요.
function NewPcChat({ agents, jobs, codeConvs, onSent, onError, onOpen }) {
  const [open, setOpen] = useState(false)
  // PC가 켜져 있으면 PC를 먼저, 꺼져 있으면 라즈베리파이(항상 켜진 쪽). 고른 건 이 화면에서만 유지.
  const [agentId, setAgentId] = useState('')
  const [cwd, setCwd] = useState('')
  const [text, setText] = useState('')
  const [mine, setMine] = useState([]) // 여기서 보낸 질문 id
  const isPi = (a) => /raspberry|라즈베리|\bpi\b/i.test(`${a.name} ${a.id}`)
  const ordered = [...agents].sort((a, b) => Number(isPi(a)) - Number(isPi(b)))
  const agent = ordered.find((a) => a.id === agentId) || ordered[0]
  const dirs = [...new Set((agent?.sessions || []).map((x) => x.cwd))]
  const dir = dirs.includes(cwd) ? cwd : dirs[0] || ''
  const base = (d) => d.split(/[\\/]/).filter(Boolean).pop() || d
  const myJobs = jobs.filter((j) => mine.includes(j.id))
  const send = async (e) => {
    e.preventDefault()
    if (!agent || !dir || !text.trim()) return
    try {
      const j = await pcApi.askNew(agent.id, dir, text.trim())
      setMine((m) => [j.id, ...m].slice(0, 5)); setText(''); onSent()
    } catch (err) { onError(err) }
  }
  if (!open) return <button type="button" className="ws-ghost" onClick={() => setOpen(true)}>+ PC에서 새 대화</button>
  return (
    <form className="ws-newpc" onSubmit={send}>
      {agents.length > 1 && (
        <select value={agent?.id || ''} onChange={(e) => setAgentId(e.target.value)} aria-label="PC">
          {ordered.map((a) => <option key={a.id} value={a.id}>{a.name}{isPi(a) ? ' (항상 켜짐)' : ''}</option>)}
        </select>
      )}
      <select value={dir} onChange={(e) => setCwd(e.target.value)} aria-label="프로젝트 폴더" title={dir}>
        {dirs.map((d) => <option key={d} value={d}>{base(d)}</option>)}
      </select>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={`${agent?.name}의 ${base(dir)}에서 새로 묻기 (코드 읽기만 해요)`} />
      <div className="ws-compose-row">
        <button type="submit" className="ws-btn ws-send" disabled={!text.trim() || !dir}>PC로 보내기</button>
        <button type="button" className="ws-link" onClick={() => setOpen(false)}>접기</button>
      </div>
      {myJobs.map((j) => {
        const conv = j.sessionId && codeConvs.find((c) => c.externalId === j.sessionId)
        return (
          <div key={j.id} className="ws-newpc-job">
            <div className="ws-q">{j.question}</div>
            {j.status === 'error' ? <div className="ws-err">{j.error}</div>
              : j.status !== 'done' ? <div className="ws-dim"><span className="ws-dot" aria-hidden="true" /> {j.status === 'queued' ? 'PC로 보내는 중...' : 'PC가 답하는 중...'}</div>
              : conv ? <button type="button" className="ws-link" onClick={() => onOpen(conv)}>답 왔어요 — 대화 열기</button>
              : <div className="ws-dim">답 왔어요. 목록에 곧 생겨요...</div>}
          </div>
        )
      })}
    </form>
  )
}

// PC Claude Code 대화에서 쓰는 입력창: 질문이 그 PC의 같은 세션으로 가요(읽기 전용).
// 모멘텀 Claude로 물으면 세션 기록과 순서가 어긋나므로, 이 대화에서는 PC로만 보냅니다.
function PcComposer({ agent, busy, onAsk, onAskOffline }) {
  const [text, setText] = useState('')
  const can = !busy && !!text.trim()
  const submit = (e) => {
    e.preventDefault()
    if (!can) return
    if (agent) onAsk(text.trim())
    else onAskOffline(text.trim())
    setText('')
  }
  return (
    <form className="ws-compose" onSubmit={submit}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
        placeholder={agent ? `${agent.name}의 Claude Code에게 이어서 묻기 (코드 읽기만 해요)` : 'PC가 꺼져 있어요 — 이 대화 내용을 바탕으로 코드 없이 이어 물을 수 있어요'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) submit(e)
        }} />
      <div className="ws-compose-row">
        <button type="submit" className="ws-send" disabled={!can}>{busy ? 'PC가 답하는 중...' : agent ? 'PC로 보내기' : '코드 없이 이어 묻기'}</button>
      </div>
    </form>
  )
}

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
        <button type="button" className="ws-iconbtn" onClick={() => cameraRef.current?.click()} disabled={busy || photos.length >= MAX_PHOTOS} aria-label="사진 찍기" title="사진 찍기"><Icon d={I.camera} /></button>
        <button type="button" className="ws-iconbtn" onClick={() => albumRef.current?.click()} disabled={busy || photos.length >= MAX_PHOTOS} aria-label="앨범에서 고르기" title="앨범"><Icon d={I.image} /></button>
        <label className="ws-speak">
          <input type="checkbox" checked={speak} onChange={(e) => onSpeakChange(e.target.checked)} /> 폰으로 읽어주기
        </label>
        <button type="submit" className="ws-send" disabled={!canSend}>{busy ? '답을 기다리는 중...' : '보내기'}</button>
      </div>
    </form>
  )
}

const CSS = MARKDOWN_CSS + `
.ws { --bg:#0b0d12; --panel:#11141b; --line:#222831; --text:#e8e8ea; --muted:#b0b6c0; --dim:#8c939e; --accent:#4dff7a;
  /* --vvh: 키보드를 뺀 실제 보이는 높이(아이폰은 키보드가 떠도 100vh가 안 줄어서 입력창이 가려졌어요) */
  height:var(--vvh, 100dvh); display:flex; flex-direction:column; background:var(--bg); color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif; }
.ws button { font:inherit; }
.ws-top { display:flex; align-items:center; gap:12px; padding:10px 16px; border-bottom:1px solid var(--line); min-height:52px; box-sizing:border-box; }
.ws-head { flex:1; min-width:0; display:flex; flex-direction:column; }
.ws-head strong { font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ws-head span, .ws-status { font-size:12px; color:var(--muted); }
.ws-status { white-space:nowrap; }
.ws-export { display:flex; gap:10px; align-items:center; font-size:13px; white-space:nowrap; }
.ws-export em { color:#6fd3a0; font-style:normal; font-size:12px; }
.ws-tools { display:flex; align-items:center; gap:10px; }
.ws-head em { font-style:normal; }
.ws-dot-sw { display:inline-block; width:8px; height:8px; border-radius:50%; background:#555; margin-right:6px; vertical-align:1px; }
.ws-pin.on .ws-dot-sw { background:#6fd3a0; box-shadow:0 0 6px #6fd3a0; }
.ws-pin.on { border-color:#6fd3a0; color:#6fd3a0; }
.ws-pin-one { float:right; font-size:12px; }
.ws-pin-one.on { color:#6fd3a0; text-decoration:none; }
/* 스크롤바: 검은 바탕 + 안경 글자와 같은 초록 */
.ws, .ws * { scrollbar-width:thin; scrollbar-color:var(--accent) #000; }
.ws ::-webkit-scrollbar { width:10px; height:10px; }
.ws ::-webkit-scrollbar-track { background:#000; }
.ws ::-webkit-scrollbar-thumb { background:var(--accent); border-radius:6px; border:2px solid #000; }
.ws ::-webkit-scrollbar-thumb:hover { background:#8dffaa; }
.ws ::-webkit-scrollbar-corner { background:#000; }
.ws-menu, .ws-glass-toggle { display:none; background:none; border:1px solid var(--line); color:var(--text); border-radius:8px; padding:6px 10px; cursor:pointer; white-space:nowrap; }
.ws-body { flex:1; min-height:0; display:grid; grid-template-columns:260px minmax(0,1fr) 360px; }
.ws-side { border-right:1px solid var(--line); padding:12px; overflow-y:auto; background:var(--panel); }
.ws-new { width:100%; padding:10px; border-radius:10px; border:1px solid rgba(77,255,122,.35); background:rgba(77,255,122,.08); color:#c8ffd6; cursor:pointer; font-size:14px; }
.ws-sec { display:flex; justify-content:space-between; align-items:center; margin:18px 4px 6px; font-size:12px; color:var(--muted); font-weight:600; letter-spacing:.02em; }
.ws-link { background:none; border:none; color:#c8ffd6; cursor:pointer; font-size:12px; padding:2px 4px; }
.ws-list { list-style:none; margin:0; padding:0; }
.ws-item { width:100%; display:flex; justify-content:space-between; gap:8px; text-align:left; background:none; border:none; color:var(--text);
  padding:9px 10px; border-radius:8px; cursor:pointer; font-size:14px; }
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
.ws-turn { max-width:780px; margin:0 auto 28px; padding-bottom:22px; border-bottom:1px solid #1a1f28; }
.ws-turn:last-of-type { border-bottom:0; }
.ws-q { margin-left:auto; width:fit-content; max-width:85%; background:#1f2a3a; border:1px solid #2b3a50; color:#f2f5f9; border-radius:14px 14px 4px 14px; padding:10px 14px; white-space:pre-wrap; word-break:break-word; font-size:15px; line-height:1.55; }
.ws-q em { color:var(--muted); font-style:normal; font-size:13px; }
.ws-a { margin-top:14px; padding-left:14px; border-left:2px solid rgba(77,255,122,.28); font-size:15px; line-height:1.7; }
.ws-a::after { content:''; display:block; clear:both; }
.ws-a pre { margin:0; white-space:pre-wrap; word-break:break-word; font:inherit; }
.ws-a details { margin-top:10px; }
.ws-a summary { cursor:pointer; color:var(--muted); font-size:13px; margin-bottom:8px; }
.ws-detail { padding:12px 14px; background:var(--panel); border:1px solid var(--line); border-radius:10px; font-size:14px; }
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
.ws-tabs { display:flex; gap:4px; margin:12px 0 6px; }
.ws-tabs button { flex:1; padding:7px 6px; border-radius:8px; border:1px solid #2a2f3a; background:transparent; color:var(--dim, #8b93a5); font-size:13px; cursor:pointer; }
.ws-tabs button.on { background:var(--panel); color:var(--text); border-color:var(--accent); }
.ws-newpc { display:flex; flex-direction:column; gap:6px; margin:8px 0; padding:8px; border:1px solid var(--line); border-radius:10px; }
.ws-newpc select, .ws-newpc textarea { width:100%; box-sizing:border-box; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:6px 8px; font:inherit; font-size:14px; }
.ws-newpc-job { border-top:1px solid var(--line); padding-top:6px; font-size:13px; }
.ws-newpc-job .ws-q { margin-bottom:4px; }
.ws-fold { width:100%; background:none; border:0; padding:0; cursor:pointer; text-align:left; color:inherit; font:inherit; }
.ws-fold em { font-style:normal; opacity:.6; margin-left:4px; }
.ws-fold { margin:12px 4px 2px !important; padding:4px 2px !important; color:var(--muted) !important; font-size:12px !important; }
.ws-fold:hover { color:var(--text) !important; }
.ws-cc { font-weight:600; color:#c084fc; }
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
/* ── 새 화면 구성 (목업 기준) ── 글자는 조금 작게: 본문 14px, 목록 13.5px, 보조 12px */
.ws { --q:#18231f; --qline:#26352f; font-size:14px; }
.ws-top { padding:10px 20px; min-height:56px; gap:10px; }
.ws-head { flex-direction:row; align-items:center; gap:10px; }
.ws-logo { border-radius:5px; vertical-align:-4px; margin-right:7px; }
.ws-brand { font-weight:700; font-size:15px; color:#f4f5f7; white-space:nowrap; }
.ws-crumb { color:var(--dim); }
.ws-head strong { font-size:14px; font-weight:500; color:#d8dce2; }
.ws-chip { flex:none; font-size:11.5px; padding:2px 9px; border-radius:999px; border:1px solid #39404c; color:var(--muted); white-space:nowrap; }
.ws-chip.cc { color:#d8b4fe; border-color:rgba(192,132,252,.45); }
.ws-tools { gap:4px; margin-left:auto; }
.ws-iconbtn { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:8px; border:1px solid transparent; background:none; color:var(--muted); cursor:pointer; padding:0; }
.ws-iconbtn:hover { background:#1a1f28; color:var(--text); }
.ws-iconbtn:disabled { opacity:.4; cursor:default; }
.ws-vsep { width:1px; height:18px; background:var(--line); margin:0 6px; }
.ws-toast { font-style:normal; font-size:12px; color:#6fd3a0; margin-right:6px; }
.ws-pin { display:inline-flex; align-items:center; height:30px; padding:0 10px; border-radius:999px; border:1px solid var(--line); background:none; color:var(--muted); font-size:12.5px; cursor:pointer; white-space:nowrap; }
.ws-pin.on { color:#8dffaa; border-color:rgba(77,255,122,.4); background:rgba(77,255,122,.07); }
.ws-status { font-size:12px; color:var(--dim); margin-left:6px; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ws-top .ws-menu.ws-iconbtn { display:none; }
.ws-body { grid-template-columns:250px minmax(0,1fr) 340px; }
.ws-side { padding:14px 12px; background:#0e1116; }
.ws-newrow { display:flex; gap:8px; }
.ws-new { flex:1; padding:9px; border-radius:10px; border:1px solid rgba(77,255,122,.3); background:rgba(77,255,122,.08); color:#d9ffe2; font-size:13.5px; font-weight:600; }
.ws-new:hover { background:rgba(77,255,122,.13); }
.ws-newrow .ws-iconbtn { width:38px; height:38px; border:1px solid var(--line); border-radius:10px; }
.ws-more { position:relative; }
.ws-menu-scrim { position:fixed; inset:0; background:none; border:0; z-index:30; cursor:default; }
.ws-menu-pop { position:absolute; right:0; top:44px; z-index:31; min-width:190px; padding:6px; background:#151a22; border:1px solid #2a3140; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,.5); display:flex; flex-direction:column; }
.ws-menu-pop button { text-align:left; background:none; border:0; color:var(--text); font-size:13px; padding:8px 10px; border-radius:6px; cursor:pointer; }
.ws-menu-pop button:hover { background:#1f2530; }
.ws-label { display:block; margin:16px 2px 6px; font-size:11.5px; color:var(--dim); }
.ws-select { width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--line); background:#11141b; color:var(--text); font:inherit; font-size:13.5px; }
.ws-tabs { gap:0; margin:16px 0 4px; border-bottom:1px solid var(--line); }
.ws-tabs button { flex:1; padding:8px 4px; border:0; border-radius:0; background:none; color:var(--dim); font-size:13px; border-bottom:2px solid transparent; margin-bottom:-1px; }
.ws-tabs button.on { background:none; color:#f4f5f7; border-bottom-color:var(--accent); font-weight:600; }
.ws-group { margin:14px 6px 4px; font-size:11.5px; color:var(--dim); }
.ws-item { padding:8px 10px; font-size:13.5px; color:#d8dce2; }
.ws-item.on { background:#18211d; box-shadow:none; color:#f4f5f7; }
.ws-showmore { background:none; border:0; color:var(--dim); font-size:12px; padding:10px; cursor:pointer; }
.ws-showmore:hover { color:var(--text); }
.ws-sec { font-size:11.5px; }
.ws-chat { padding:24px 28px; }
.ws-turn { max-width:720px; margin:0 auto 26px; padding-bottom:0; border-bottom:0; }
.ws-q { background:var(--q); border:1px solid var(--qline); color:#eef1f4; font-size:14px; line-height:1.6; padding:10px 14px; border-radius:14px 14px 4px 14px; }
.ws-a { margin-top:16px; padding-left:0; border-left:0; font-size:14px; }
.md { font-size:14px; line-height:1.75; }
.md-h1 { font-size:17px; } .md-h2 { font-size:15.5px; } .md-h3, .md-h4 { font-size:14px; }
.md-code { font-size:12.5px; }
.md-table table { font-size:13px; }
.ws-more-card { margin:10px 0 0; border:1px solid var(--line); border-radius:10px; background:#0f1217; }
.ws-more-card > summary { list-style:none; padding:10px 14px; font-size:13px; color:var(--muted); cursor:pointer; margin:0; }
.ws-more-card > summary::-webkit-details-marker { display:none; }
.ws-more-card > summary::before { content:'▸'; display:inline-block; margin-right:8px; transition:transform .15s; }
.ws-more-card[open] > summary::before { transform:rotate(90deg); }
.ws-more-card .ws-detail { margin:0; border:0; border-top:1px solid var(--line); border-radius:0 0 10px 10px; background:none; font-size:13.5px; }
.ws-a-foot { display:flex; align-items:center; gap:10px; margin-top:10px; }
.ws-glassbtn { display:inline-flex; align-items:center; gap:6px; background:none; border:1px solid transparent; color:var(--dim); font-size:12px; padding:4px 8px; border-radius:999px; cursor:pointer; }
.ws-glassbtn:hover { color:var(--text); background:#161b23; }
.ws-glassbtn.on { color:#8dffaa; border-color:rgba(77,255,122,.35); background:rgba(77,255,122,.08); }
.ws-glassbtn.on .ws-dot-sw { background:var(--accent); box-shadow:0 0 6px var(--accent); }
.ws-badge { font-size:11px; margin:0; }
.ws-compose { border-top:0; padding:10px 28px 18px; }
.ws-compose > * { max-width:720px; margin-left:auto; margin-right:auto; }
.ws-compose { display:flex; flex-direction:column; }
.ws-compose textarea, .ws-compose-row { width:100%; }
.ws-compose textarea { border:1px solid var(--line); border-bottom:0; border-radius:14px 14px 0 0; background:#11141b; padding:14px 16px 6px; font-size:14px; resize:none; min-height:56px; }
.ws-compose textarea:focus { outline:none; }
.ws-compose-row { margin-top:0; padding:6px 10px 10px; border:1px solid var(--line); border-top:0; border-radius:0 0 14px 14px; background:#11141b; box-sizing:border-box; gap:4px; }
.ws-compose:focus-within textarea, .ws-compose:focus-within .ws-compose-row { border-color:#33503f; }
.ws-speak { font-size:12.5px; margin-left:8px; }
.ws-send { margin-left:auto; background:#2f8f57; color:#fff; border:0; border-radius:8px; padding:8px 16px; font-size:13.5px; font-weight:600; cursor:pointer; }
.ws-send:hover { background:#36a364; }
.ws-send:disabled { background:#24402f; color:#9fb8a8; cursor:default; }
.ws-glasses { background:#0e1116; }
.ws-older { font-style:normal; color:var(--dim); font-size:12px; }
.ws-pcstat { display:flex; align-items:center; gap:2px; margin:12px 4px 4px; font-size:12px; color:var(--dim); }
.ws-pcstat.on { color:#8dffaa; }
.ws-pcstat.on .ws-dot-sw { background:var(--accent); box-shadow:0 0 6px var(--accent); }
.ws-ghost { width:100%; margin:4px 0 6px; padding:7px 10px; text-align:left; background:none; border:1px dashed #2f3a46; border-radius:8px; color:var(--muted); font-size:12.5px; cursor:pointer; }
.ws-ghost:hover { border-color:rgba(77,255,122,.4); color:#c8ffd6; }
.ws-side .ws-time { font-size:11px; color:#6f7682; }
.ws-side .ws-engine { font-size:11.5px; }
.ws-side::-webkit-scrollbar { width:6px; }
.ws-side::-webkit-scrollbar-thumb { border:0; background:rgba(77,255,122,.45); }
.ws-side::-webkit-scrollbar-thumb:hover { background:var(--accent); }
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
  .ws-a { padding-left:10px; }
  .md { font-size:15.5px; }
  .ws-actions { display:flex; position:static; transform:none; background:none; justify-content:flex-end; }
  .ws-glasses { position:static; width:auto; max-height:45dvh; flex:none; border:0; border-bottom:1px solid var(--line); border-radius:0; box-shadow:none; order:-1; }
  /* 폰: 1줄 = 메뉴·제목, 2줄 = 버튼 줄(가로로 밀어 보기) */
  .ws-top { flex-wrap:wrap; row-gap:8px; min-height:0; }
  .ws-menu { padding:6px 10px; font-size:13px; }
  .ws-head strong { font-size:15px; }
  .ws-head span { font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ws-sub-long, .ws-long { display:none; }
  .ws-brand, .ws-crumb, .ws-vsep { display:none; }
  .ws-top .ws-menu.ws-iconbtn { display:inline-flex; }
  .ws-head { gap:8px; }
  .ws-top .ws-tools .ws-iconbtn { width:32px; height:32px; padding:0; border-radius:8px; background:none; border:0; }
  .ws-top .ws-tools .ws-pin { height:30px; padding:0 10px; border-radius:999px; }
  .ws-tools .ws-pin { height:30px; }
  .ws-chat { padding:16px 14px; }
  .ws-compose { padding:8px 10px 10px; }
  .ws-tools { order:3; width:100%; gap:6px; overflow-x:auto; scrollbar-width:none; -webkit-overflow-scrolling:touch; }
  .ws-tools::-webkit-scrollbar { display:none; }
  .ws-tools .ws-btn, .ws-tools .ws-glass-toggle, .ws-export .ws-link {
    flex:none; height:32px; padding:0 12px; font-size:13px; border-radius:16px; display:inline-flex; align-items:center;
    background:rgba(255,255,255,.04); border:1px solid var(--line); color:var(--text); text-decoration:none; }
  .ws-tools .ws-pin.on { border-color:#6fd3a0; color:#6fd3a0; background:rgba(111,211,160,.1); }
  .ws-export { gap:6px; order:2; }
  .ws-pin { order:0; }
  .ws-glass-toggle { order:1; }
  .ws-compose-row { gap:6px; flex-wrap:wrap; }
  .ws-compose-row .ws-btn { padding:7px 10px; font-size:13px; }
  .ws-turn .ws-pin-one { font-size:12px; }
}
`
