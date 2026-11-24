// Claude 대화 가져오기 — 파일을 브라우저에서 읽어 질문·답 쌍으로 바꿉니다.
//  · claude.ai 데이터 내보내기 zip(또는 그 안의 conversations.json)
//  · Claude Code 세션 파일(.jsonl, PC의 ~/.claude/projects/…)
// 서버(/api/ai/conversations/import)는 같은 ID면 새로 생긴 질문만 붙여서, 여러 번 가져와도 중복되지 않습니다.

// ── zip 읽기 (의존성 없이: 중앙 디렉터리 + DecompressionStream) ──
async function unzip(buf, want) {
  const d = new DataView(buf), u8 = new Uint8Array(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (d.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('zip 파일이 아니에요')
  const n = d.getUint16(eocd + 10, true)
  let p = d.getUint32(eocd + 16, true)
  const out = {}
  const td = new TextDecoder()
  for (let k = 0; k < n; k++) {
    const method = d.getUint16(p + 10, true), csize = d.getUint32(p + 20, true)
    const nlen = d.getUint16(p + 28, true), xlen = d.getUint16(p + 30, true), clen = d.getUint16(p + 32, true)
    const loff = d.getUint32(p + 42, true)
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen))
    p += 46 + nlen + xlen + clen
    if (!want(name)) continue
    const lnl = d.getUint16(loff + 26, true), lxl = d.getUint16(loff + 28, true)
    const data = u8.subarray(loff + 30 + lnl + lxl, loff + 30 + lnl + lxl + csize)
    if (method === 0) out[name] = td.decode(data)
    else if (method === 8) out[name] = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
  }
  return out
}

// ── claude.ai 내보내기: [{ uuid, name, chat_messages: [{ sender, text, content, created_at }] }] ──
// 메시지에서 글자 뽑기 — 내보내기 형식마다 위치가 달라서 넓게 찾음
// (content 문자열/배열, text, parts, message.content …). 생각(thinking)·도구·이미지 블록은 뺌
const SKIP_TYPES = /^(thinking|redacted_thinking|tool_use|tool_result|image|document|server_tool_use|web_search_tool_result)$/
function deepText(v, depth = 0) {
  if (v == null || depth > 6) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => deepText(x, depth + 1)).filter(Boolean).join('\n')
  if (typeof v === 'object') {
    if (typeof v.type === 'string' && SKIP_TYPES.test(v.type)) return ''
    for (const k of ['text', 'content', 'parts', 'value', 'message', 'body']) {
      if (v[k] != null) { const t = deepText(v[k], depth + 1); if (t.trim()) return t }
    }
  }
  return ''
}
const msgText = (m) => deepText(m.content) || deepText(m.text) || deepText(m.message) || deepText(m.parts) || ''
// 내보내기 형식이 바뀌어도 읽히도록: 메시지 배열(chat_messages / messages)과 보낸 쪽(sender / role)을 넓게 받음
const msgsOf = (c) => c?.chat_messages || c?.messages || c?.chatMessages || null
const roleOf = (m) => m.sender || m.role || m.author?.role || m.author || m.message?.role || m.type
const isHuman = (m) => ['human', 'user'].includes(roleOf(m))
const isConv = (c) => c && typeof c === 'object' && Array.isArray(msgsOf(c))
function fromClaudeAi(list) {
  const out = []
  for (const c of list || []) {
    if (!isConv(c)) continue
    const turns = []
    let cur = null
    for (const m of msgsOf(c)) {
      const t = msgText(m).trim()
      // 도구 결과·자동 알림처럼 사람이 쓴 게 아닌 '사용자' 메시지는 새 질문으로 치지 않음
      const onlyTool = Array.isArray(m.content) && m.content.length && m.content.every((b) => b && (b.type === 'tool_result' || b.type === 'tool_use'))
      if (isHuman(m) && (onlyTool || (t && isNoise(t)))) continue
      if (isHuman(m)) { if (cur) turns.push(cur); cur = { question: t || '(파일만 첨부)', answer: '', at: m.created_at || m.createdAt || null } }
      else if (cur) cur.answer = (cur.answer ? cur.answer + '\n\n' : '') + t
    }
    if (cur) turns.push(cur)
    const id = c.uuid || c.id || `${c.name || ''}-${turns[0].at || ''}`
    if (turns.length) out.push({ externalId: `claude-ai:${id}`.slice(0, 80), title: `[claude.ai] ${c.name || c.title || turns[0].question.slice(0, 50)}`, turns })
  }
  return out
}

// ── Claude Code .jsonl ──
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '')
const isNoise = (t) => !t.trim() || /^<(local-command-stdout|command-name|command-message|system-reminder|local-command-caveat)/.test(t.trim()) || t.startsWith('Caveat: The messages below')
function fromClaudeCode(text, fileName) {
  const turns = []
  let cur = null, title = '', cwd = '', sid = fileName.replace(/\.jsonl$/, '')
  const tools = new Map()
  const close = () => {
    if (!cur) return
    const used = [...tools].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ')
    cur.answer = cur.parts.join('\n\n').trim() + (used ? `\n\n[사용한 도구: ${used}]` : '')
    delete cur.parts; turns.push(cur); cur = null; tools.clear()
  }
  for (const ln of text.split('\n')) {
    if (!ln.trim()) continue
    let e; try { e = JSON.parse(ln) } catch { continue }
    if (e.type === 'summary' && e.summary) { title = e.summary; continue }
    if (e.isSidechain) continue
    if (e.cwd && !cwd) cwd = e.cwd
    if (e.sessionId) sid = e.sessionId
    const m = e.message
    if (!m) continue
    if (e.type === 'user' && !e.isMeta && !(Array.isArray(m.content) && m.content.some((b) => b?.type === 'tool_result'))) {
      const q = textOf(m.content)
      if (isNoise(q)) continue
      close(); cur = { question: q.trim(), parts: [], at: e.timestamp || null }
    } else if (e.type === 'assistant' && cur) {
      const t = textOf(m.content); if (t.trim()) cur.parts.push(t.trim())
      if (Array.isArray(m.content)) for (const b of m.content) if (b?.type === 'tool_use') tools.set(b.name, (tools.get(b.name) || 0) + 1)
    }
  }
  close()
  if (!turns.length) return []
  const proj = cwd ? cwd.split(/[\\/]/).pop() : ''
  return [{ externalId: sid.slice(0, 80), title: `${proj ? `[${proj}] ` : '[Claude Code] '}${title || turns[0].question.replace(/\s+/g, ' ').slice(0, 50)}`, turns }]
}

// 아무 JSON에서 대화 찾기
function convsInJson(j) {
  if (Array.isArray(j)) return j.filter(isConv)
  if (isConv(j)) return [j]
  if (j && typeof j === 'object') for (const v of Object.values(j)) if (Array.isArray(v) && v.some(isConv)) return v.filter(isConv)
  return []
}
function convsInText(text) {
  try { return convsInJson(JSON.parse(text)) } catch { /* JSONL일 수 있음 */ }
  const out = []
  for (const ln of text.split('\n')) { if (!ln.trim()) continue; try { out.push(...convsInJson(JSON.parse(ln))) } catch { /* */ } }
  return out
}
const isClaudeCodeJsonl = (text) => /"sessionId"\s*:/.test(text.slice(0, 5000)) && /"type"\s*:\s*"(user|assistant)"/.test(text.slice(0, 20000))

/** 파일들 → 가져올 대화 목록 */
export async function parseChatFiles(files) {
  const out = []
  for (const f of files) {
    const name = f.name.toLowerCase()
    if (name.endsWith('.zip')) {
      // 내보내기 zip 안의 모든 .json/.jsonl을 훑어 대화가 든 파일만 씀(manifest.json 같은 건 건너뜀)
      const got = await unzip(await f.arrayBuffer(), (n) => /\.(json|jsonl)$/i.test(n) && !n.endsWith('/'))
      for (const [n, t] of Object.entries(got)) {
        if (isClaudeCodeJsonl(t)) out.push(...fromClaudeCode(t, n.split('/').pop()))
        else out.push(...fromClaudeAi(convsInText(t)))
      }
    } else {
      const t = await f.text()
      if (isClaudeCodeJsonl(t)) out.push(...fromClaudeCode(t, f.name))
      else out.push(...fromClaudeAi(convsInText(t)))
    }
  }
  return out
}
