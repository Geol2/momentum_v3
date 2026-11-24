#!/usr/bin/env node
// 모멘텀에서 보낸 질문을 이 PC의 Claude Code로 실행하는 에이전트.
//
// 켜 두면 몇 초마다 모멘텀 서버에 "이 PC 켜져 있어요 + 최근 세션 목록"을 알리고,
// 모멘텀 화면에서 이 PC의 세션으로 보낸 질문을 받아 `claude -p --resume <세션>` 으로 실행해 답을 돌려줍니다.
// 끝나면 sync-claude-sessions.mjs 를 돌려 그 세션의 새 질문·답을 모멘텀 대화에도 붙입니다.
//
// 안전장치 — 모멘텀에서 온 질문은 "읽기 전용"으로만 실행합니다.
//   · 파일 읽기·검색(Read, Grep, Glob, LS)만 허용, 명령 실행·파일 수정·웹 접속·MCP는 막음
//   · 서버가 이 PC가 알려 준 세션·폴더에서만 실행되게 확인함
//
// 사용법 (Node 18+, Claude Code 설치·로그인 필요)
//   node scripts/pc-agent.mjs            # 켜 두기 (Ctrl+C로 끔)
//   node scripts/pc-agent.mjs --name 회사PC
//
// 로그인 정보는 sync 스크립트와 같은 ~/.momentum.env (MOMENTUM_EMAIL, MOMENTUM_PASSWORD) 를 씁니다.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }

try {
  for (const ln of fs.readFileSync(path.join(os.homedir(), '.momentum.env'), 'utf8').split(/\r?\n/)) {
    const m = ln.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
} catch { /* 파일 없음 */ }

const API = (process.env.MOMENTUM_API || 'https://api.geol2.com').replace(/\/$/, '')
const ROOT = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
const ID_FILE = path.join(os.homedir(), '.momentum-pc-agent.json')
const POLL_MS = 3000
const RUN_TIMEOUT_MS = 15 * 60 * 1000
const READ_ONLY_TOOLS = 'Read,Grep,Glob,LS'
const BLOCKED_TOOLS = 'Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task'

// 이 PC의 고정 ID (처음 한 번 만들어 저장)
let agentId
try { agentId = JSON.parse(fs.readFileSync(ID_FILE, 'utf8')).id } catch { /* 처음 */ }
if (!agentId || !/^[A-Za-z0-9_-]{1,80}$/.test(agentId)) {
  agentId = `${os.hostname().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || 'pc'}-${crypto.randomBytes(4).toString('hex')}`
  fs.writeFileSync(ID_FILE, JSON.stringify({ id: agentId }))
}
const NAME = opt('--name', os.hostname())
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('ko-KR')}]`, ...a)

// ── 로그인 ──
let token = process.env.MOMENTUM_TOKEN || ''
async function login() {
  const email = process.env.MOMENTUM_EMAIL, password = process.env.MOMENTUM_PASSWORD
  if (!email || !password) throw new Error('~/.momentum.env 에 MOMENTUM_EMAIL·MOMENTUM_PASSWORD 가 필요해요.')
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  if (!r.ok) throw new Error(`로그인 실패 (${r.status})`)
  token = (await r.json()).token
}
async function api(method, p, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) await login()
    const r = await fetch(`${API}${p}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
    if (r.status === 401 && attempt === 0 && !process.env.MOMENTUM_TOKEN) { token = ''; continue }
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
    const t = await r.text()
    return t ? JSON.parse(t) : null
  }
}

// ── 최근 세션 목록 (세션 ID · 폴더 · 제목) ──
const metaCache = new Map()
function sessionMeta(file, st) {
  const key = `${st.size}:${st.mtimeMs}`
  const c = metaCache.get(file)
  if (c && c.key === key) return c.meta
  let cwd = '', title = '', firstQ = '', sessionId = path.basename(file, '.jsonl')
  for (const ln of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!ln.trim()) continue
    let e
    try { e = JSON.parse(ln) } catch { continue }
    if (e.type === 'summary' && e.summary) title = e.summary
    if (e.cwd && !cwd) cwd = e.cwd
    if (!firstQ && e.type === 'user' && !e.isMeta && typeof e.message?.content === 'string' && !e.message.content.startsWith('<')) firstQ = e.message.content
  }
  const proj = cwd ? path.basename(cwd) : ''
  const meta = { sessionId, cwd, title: `${proj ? `[${proj}] ` : ''}${(title || firstQ).replace(/\s+/g, ' ').slice(0, 60)}`, updatedAt: new Date(st.mtimeMs).toISOString() }
  metaCache.set(file, { key, meta })
  return meta
}
let sessions = [], sessionsAt = 0
function recentSessions() {
  if (Date.now() - sessionsAt < 30000) return sessions
  const files = []
  try {
    for (const d of fs.readdirSync(ROOT)) {
      const dir = path.join(ROOT, d)
      if (!fs.statSync(dir).isDirectory()) continue
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) { const p = path.join(dir, f); files.push({ p, st: fs.statSync(p) }) }
    }
  } catch { /* 폴더 없음 */ }
  files.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
  sessions = files.slice(0, 40).map(({ p, st }) => sessionMeta(p, st)).filter((s) => s.cwd && fs.existsSync(s.cwd))
  sessionsAt = Date.now()
  return sessions
}

// ── Claude Code 실행 (읽기 전용) ──
function runClaude(job) {
  return new Promise((resolve) => {
    if (!fs.existsSync(job.cwd)) { resolve({ error: `폴더가 없어요: ${job.cwd}` }); return }
    if (job.sessionId && !/^[A-Za-z0-9_-]{1,80}$/.test(job.sessionId)) { resolve({ error: '세션 ID 형식이 이상해요.' }); return }
    // 질문은 인자가 아니라 표준 입력으로 넘깁니다(셸이 질문 내용을 해석하지 않도록).
    const argv = ['-p', '--output-format', 'json', '--permission-mode', 'default',
      '--allowedTools', READ_ONLY_TOOLS, '--disallowedTools', BLOCKED_TOOLS, '--strict-mcp-config']
    if (job.sessionId) argv.push('--resume', job.sessionId)
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY // 구독 로그인으로 실행
    delete env.MOMENTUM_PASSWORD
    // Windows는 claude 가 .cmd 라 셸로 실행해야 해요. 인자는 위에서 검사한 고정 값뿐이라 한 줄로 이어 붙여도 안전합니다
    // (질문은 표준 입력으로 가므로 셸에 닿지 않음).
    const child = process.platform === 'win32'
      ? spawn(['claude', ...argv].join(' '), { cwd: job.cwd, env, shell: true, windowsHide: true })
      : spawn('claude', argv, { cwd: job.cwd, env })
    let out = '', err = ''
    const timer = setTimeout(() => { child.kill(); err += '\n시간 초과(15분)' }, RUN_TIMEOUT_MS)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: `claude 실행 실패: ${e.message}` }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const j = JSON.parse(out.trim().split('\n').filter(Boolean).at(-1))
        if (j.is_error) resolve({ error: String(j.result || '오류'), sessionId: j.session_id })
        else resolve({ answer: String(j.result ?? ''), sessionId: j.session_id })
      } catch {
        resolve({ error: (err || out || `종료 코드 ${code}`).trim().slice(0, 2000) })
      }
    })
    child.stdin.end(job.question)
  })
}

function syncSessions() {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(HERE, 'sync-claude-sessions.mjs'), '--since', '1'], { stdio: 'ignore', windowsHide: true })
    c.on('close', resolve)
    c.on('error', resolve)
  })
}

// ── 반복 ──
let busy = false, lastErr = ''
async function tick() {
  if (busy) { api('PUT', `/api/ai/pc/agents/${agentId}?busy=true`, { name: NAME, sessions }).catch(() => {}); return }
  try {
    const job = await api('PUT', `/api/ai/pc/agents/${agentId}`, { name: NAME, sessions: recentSessions() })
    if (lastErr) { log('서버에 다시 연결됐어요.'); lastErr = '' }
    if (!job) return
    busy = true
    log(`질문 받음 #${job.id} (${path.basename(job.cwd)}): ${job.question.slice(0, 60)}`)
    const r = await runClaude(job)
    await api('POST', `/api/ai/pc/jobs/${job.id}/result`, r)
    log(r.error ? `실패 #${job.id}: ${r.error.slice(0, 120)}` : `답 보냄 #${job.id}`)
    await syncSessions()
    sessionsAt = 0
  } catch (e) {
    if (e.message !== lastErr) { log(`연결 문제: ${e.message}`); lastErr = e.message }
  } finally { busy = false }
}

log(`pc-agent 시작 — 이름 "${NAME}", 서버 ${API}`)
log('모멘텀에서 이 PC의 Claude Code 대화를 열면 이어서 물을 수 있어요. (읽기 전용 · Ctrl+C로 종료)')
tick()
setInterval(tick, POLL_MS)
