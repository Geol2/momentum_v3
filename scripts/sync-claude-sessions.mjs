#!/usr/bin/env node
// PC의 Claude Code 세션 기록을 모멘텀 "Claude 대화"로 동기화합니다.
//
// Claude Code는 대화를 ~/.claude/projects/<폴더>/<세션ID>.jsonl 에 저장합니다.
// 이 스크립트는 그 파일들을 읽어 질문·답 쌍으로 묶고, 백엔드 POST /api/ai/conversations/import 로 보냅니다.
// 서버는 세션 ID로 같은 대화를 찾아 "새로 생긴 질문"만 붙이므로, 몇 번을 돌려도 중복되지 않습니다.
//
// 사용법 (Node 18+)
//   MOMENTUM_EMAIL=me@example.com MOMENTUM_PASSWORD=... node scripts/sync-claude-sessions.mjs
//   node scripts/sync-claude-sessions.mjs --watch 10      # 10분마다 반복
//   node scripts/sync-claude-sessions.mjs --dry           # 보내지 않고 무엇을 보낼지만 출력
//   node scripts/sync-claude-sessions.mjs --since 7       # 최근 7일 안에 바뀐 세션만
//
// 환경 변수
//   MOMENTUM_API       백엔드 주소 (기본 https://api.geol2.com)
//   MOMENTUM_TOKEN     로그인 토큰(JWT). 없으면 MOMENTUM_EMAIL·MOMENTUM_PASSWORD로 로그인
//   CLAUDE_CONFIG_DIR  Claude Code 설정 폴더 (기본 ~/.claude)
//
// 비밀번호·토큰은 이 파일이나 저장소에 적지 말고 환경 변수로만 넘기세요.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d }

const API = (process.env.MOMENTUM_API || 'https://api.geol2.com').replace(/\/$/, '')
const ROOT = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
const STATE = path.join(os.homedir(), '.momentum-claude-sync.json')
const DRY = flag('--dry')
const WATCH = flag('--watch') ? Math.max(1, +opt('--watch', 10)) : 0
const SINCE_DAYS = +opt('--since', 0)

// ── 세션 파일 → 질문·답 쌍 ──

const textOf = (content) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
}
const isToolResult = (content) => Array.isArray(content) && content.some((b) => b && b.type === 'tool_result')
// Claude Code가 자동으로 넣는 줄(명령 출력·시스템 알림 등)은 질문으로 치지 않음
const isNoise = (t) => !t.trim() || /^<(local-command-stdout|command-name|command-message|system-reminder|local-command-caveat)/.test(t.trim()) || t.startsWith('Caveat: The messages below were generated')

export function parseSession(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const turns = []
  let cur = null, title = '', cwd = '', sessionId = path.basename(file, '.jsonl')
  const tools = new Map()
  const close = () => {
    if (!cur) return
    const used = [...tools].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ')
    cur.answer = cur.parts.join('\n\n').trim() + (used ? `\n\n[사용한 도구: ${used}]` : '')
    delete cur.parts
    turns.push(cur); cur = null; tools.clear()
  }
  for (const ln of lines) {
    if (!ln.trim()) continue
    let e
    try { e = JSON.parse(ln) } catch { continue }
    if (e.type === 'summary' && e.summary) { title = e.summary; continue }
    if (e.isSidechain) continue // 서브에이전트 내부 대화는 제외
    if (e.cwd && !cwd) cwd = e.cwd
    if (e.sessionId) sessionId = e.sessionId
    const msg = e.message
    if (!msg) continue
    if (e.type === 'user' && !e.isMeta && !isToolResult(msg.content)) {
      const q = textOf(msg.content)
      if (isNoise(q)) continue
      close()
      cur = { question: q.trim(), parts: [], at: e.timestamp || null }
    } else if (e.type === 'assistant' && cur) {
      const t = textOf(msg.content)
      if (t.trim()) cur.parts.push(t.trim())
      if (Array.isArray(msg.content)) for (const b of msg.content) if (b?.type === 'tool_use') tools.set(b.name, (tools.get(b.name) || 0) + 1)
    }
  }
  close()
  const proj = cwd ? path.basename(cwd) : ''
  const base = title || (turns[0]?.question || '').replace(/\s+/g, ' ').slice(0, 60)
  return { sessionId, title: (proj ? `[${proj}] ` : '') + base, turns }
}

// ── 백엔드 ──

let token = process.env.MOMENTUM_TOKEN || ''
async function login() {
  if (token) return
  const email = process.env.MOMENTUM_EMAIL, password = process.env.MOMENTUM_PASSWORD
  if (!email || !password) throw new Error('MOMENTUM_TOKEN 또는 MOMENTUM_EMAIL·MOMENTUM_PASSWORD 환경 변수가 필요해요.')
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  if (!r.ok) throw new Error(`로그인 실패 (${r.status})`)
  token = (await r.json()).token
}
async function send(s) {
  const body = JSON.stringify({ externalId: s.sessionId, title: s.title.slice(0, 100), turns: s.turns.map((t) => ({ question: t.question, answer: t.answer, at: t.at })) })
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`${API}/api/ai/conversations/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body })
    if (r.status === 401 && attempt === 0 && !process.env.MOMENTUM_TOKEN) { token = ''; await login(); continue }
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
    return r.json()
  }
}

// ── 한 번 돌기 ──

function listSessions() {
  if (!fs.existsSync(ROOT)) return []
  const out = []
  for (const d of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, d)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) { const p = path.join(dir, f); out.push({ p, st: fs.statSync(p) }) }
  }
  return out
}

async function runOnce() {
  let state = {}
  try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { /* 처음 */ }
  const cut = SINCE_DAYS ? Date.now() - SINCE_DAYS * 86400000 : 0
  const files = listSessions().filter(({ p, st }) => st.mtimeMs >= cut && state[p] !== `${st.size}:${st.mtimeMs}`)
  if (!files.length) { console.log(`[${new Date().toLocaleTimeString('ko-KR')}] 바뀐 세션 없음`); return }
  if (!DRY) await login()
  let sent = 0, added = 0
  for (const { p, st } of files) {
    const s = parseSession(p)
    if (!s.turns.length) { state[p] = `${st.size}:${st.mtimeMs}`; continue }
    if (DRY) { console.log(`· ${s.title} — 질문 ${s.turns.length}개 (${s.sessionId})`); continue }
    try {
      const res = await send(s)
      sent++; added += res.added
      if (res.added) console.log(`· ${s.title} +${res.added}`)
      state[p] = `${st.size}:${st.mtimeMs}`
    } catch (e) { console.error(`✗ ${s.title}: ${e.message}`) }
  }
  if (DRY) { console.log(`세션 파일 ${files.length}개 확인 (--dry: 보내지 않음)`); return }
  fs.writeFileSync(STATE, JSON.stringify(state))
  console.log(`[${new Date().toLocaleTimeString('ko-KR')}] 세션 ${sent}개 확인, 새 질문 ${added}개 올림`)
}

const main = async () => {
  await runOnce()
  if (WATCH) setInterval(() => runOnce().catch((e) => console.error(e.message)), WATCH * 60000)
}
// Windows 경로(D:\...)도 맞게 비교하도록 URL로 바꿔서 비교
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((e) => { console.error(e.message); process.exit(1) })
