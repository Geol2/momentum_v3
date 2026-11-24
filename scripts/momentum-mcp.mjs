#!/usr/bin/env node
// 모멘텀 MCP 서버 — Claude 데스크톱 앱(일반 채팅)에서 "이 대화 모멘텀에 저장해줘" 하면 모멘텀에 올려 줍니다.
//
// 설정 (Windows: %APPDATA%\Claude\claude_desktop_config.json, Mac: ~/Library/Application Support/Claude/claude_desktop_config.json)
//   { "mcpServers": { "momentum": { "command": "node", "args": ["D:/05_project/momentum_v3/scripts/momentum-mcp.mjs"] } } }
// 로그인 정보는 ~/.momentum.env (MOMENTUM_EMAIL, MOMENTUM_PASSWORD) 를 씁니다.
//
// 의존성 없이 MCP(stdio, 줄 단위 JSON-RPC)를 직접 구현했어요. stdout 에는 프로토콜 메시지만 쓰고, 로그는 stderr 로.
//
// 도구
//   save_conversation  지금 대화의 질문·답을 모멘텀 "모멘텀 질문" 목록에 저장(같은 id로 다시 부르면 새 질문만 덧붙임)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import readline from 'node:readline'

try {
  for (const ln of fs.readFileSync(path.join(os.homedir(), '.momentum.env'), 'utf8').split(/\r?\n/)) {
    const m = ln.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
} catch { /* 파일 없음 */ }

const API = (process.env.MOMENTUM_API || 'https://api.geol2.com').replace(/\/$/, '')
const log = (...a) => process.stderr.write(`[momentum-mcp] ${a.join(' ')}\n`)

// ── 모멘텀 API ──
let token = process.env.MOMENTUM_TOKEN || ''
async function login() {
  const email = process.env.MOMENTUM_EMAIL, password = process.env.MOMENTUM_PASSWORD
  if (!email || !password) throw new Error('~/.momentum.env 에 MOMENTUM_EMAIL·MOMENTUM_PASSWORD 가 없어요.')
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  if (!r.ok) throw new Error(`모멘텀 로그인 실패 (${r.status})`)
  token = (await r.json()).token
}
async function api(method, p, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) await login()
    const r = await fetch(`${API}${p}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
    if (r.status === 401 && attempt === 0 && !process.env.MOMENTUM_TOKEN) { token = ''; continue }
    if (!r.ok) throw new Error(`모멘텀 서버 오류 ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const t = await r.text()
    return t ? JSON.parse(t) : null
  }
}

// ── 도구 ──
const TOOLS = [
  {
    name: 'save_conversation',
    description: '지금 대화를 사용자의 모멘텀 앱(momentum.geol2.com)에 저장합니다. 사용자가 "모멘텀에 저장/올려줘"라고 하면 쓰세요. '
      + '대화의 질문·답을 처음부터 순서대로 빠짐없이 turns 에 넣으세요(답은 요약하지 말고 실제로 답한 내용 그대로). '
      + '같은 대화를 나중에 다시 저장할 때는 처음 저장할 때 돌려받은 conversation_id 를 넘기면 새로 생긴 질문만 덧붙습니다.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '대화 제목(짧게, 한국어)' },
        turns: {
          type: 'array',
          description: '처음부터 지금까지의 질문·답 쌍',
          items: {
            type: 'object',
            properties: { question: { type: 'string' }, answer: { type: 'string' } },
            required: ['question', 'answer'],
          },
        },
        conversation_id: { type: 'string', description: '이전에 저장할 때 받은 id(이어 저장할 때만)' },
      },
      required: ['title', 'turns'],
    },
  },
]

async function callTool(name, args) {
  if (name !== 'save_conversation') throw new Error(`모르는 도구: ${name}`)
  const turns = Array.isArray(args?.turns) ? args.turns.filter((t) => t && (t.question || t.answer)) : []
  if (!turns.length) throw new Error('저장할 질문·답이 없어요.')
  // chat- 으로 시작하는 id 는 모멘텀에서 "모멘텀 질문" 목록으로 들어갑니다(Claude Code 대화와 구분).
  let id = String(args.conversation_id || '').trim()
  if (!/^chat-[A-Za-z0-9_-]{6,70}$/.test(id)) id = `chat-${crypto.randomUUID()}`
  const r = await api('POST', '/api/ai/conversations/import', {
    externalId: id,
    title: String(args.title || '').slice(0, 100),
    turns: turns.map((t) => ({ question: String(t.question || ''), answer: String(t.answer || ''), at: null })),
  })
  return `모멘텀에 저장했어요 — 새 질문 ${r?.added ?? 0}개 (전체 ${turns.length}개). conversation_id: ${id}\n이 대화를 나중에 다시 저장할 땐 이 conversation_id 를 넘겨 주세요. 보기: https://momentum.geol2.com/g2.html`
}

// ── MCP (stdio JSON-RPC) ──
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
async function handle(m) {
  const { id, method, params } = m
  if (id === undefined || id === null) return // 알림(notifications/*)은 답하지 않음
  try {
    if (method === 'initialize') {
      send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'momentum', version: '1.0.0' } } })
    } else if (method === 'ping') {
      send({ id, result: {} })
    } else if (method === 'tools/list') {
      send({ id, result: { tools: TOOLS } })
    } else if (method === 'tools/call') {
      try {
        const text = await callTool(params?.name, params?.arguments || {})
        send({ id, result: { content: [{ type: 'text', text }] } })
      } catch (e) {
        log(e.message)
        send({ id, result: { content: [{ type: 'text', text: e.message }], isError: true } })
      }
    } else {
      send({ id, error: { code: -32601, message: `Method not found: ${method}` } })
    }
  } catch (e) {
    send({ id, error: { code: -32603, message: e.message } })
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  let m
  try { m = JSON.parse(line) } catch { return }
  handle(m)
})
log(`시작 — 서버 ${API}`)
