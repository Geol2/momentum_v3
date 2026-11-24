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
const msgText = (m) => {
  if (Array.isArray(m.content) && m.content.length) {
    const t = m.content.filter((c) => c && c.type === 'text' && c.text).map((c) => c.text).join('\n')
    if (t.trim()) return t
  }
  return m.text || ''
}
function fromClaudeAi(list) {
  const out = []
  for (const c of list || []) {
    const turns = []
    let cur = null
    for (const m of c.chat_messages || []) {
      const t = msgText(m).trim()
      if (m.sender === 'human') { if (cur) turns.push(cur); cur = { question: t || '(파일만 첨부)', answer: '', at: m.created_at || null } }
      else if (cur) cur.answer = (cur.answer ? cur.answer + '\n\n' : '') + t
    }
    if (cur) turns.push(cur)
    if (turns.length) out.push({ externalId: `claude-ai:${c.uuid}`.slice(0, 80), title: `[claude.ai] ${c.name || turns[0].question.slice(0, 50)}`, turns })
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

/** 파일들 → 가져올 대화 목록 */
export async function parseChatFiles(files) {
  const out = []
  for (const f of files) {
    const name = f.name.toLowerCase()
    if (name.endsWith('.zip')) {
      const got = await unzip(await f.arrayBuffer(), (n) => /(^|\/)conversations\.json$/.test(n))
      for (const t of Object.values(got)) out.push(...fromClaudeAi(JSON.parse(t)))
    } else if (name.endsWith('.jsonl')) {
      out.push(...fromClaudeCode(await f.text(), f.name))
    } else {
      const j = JSON.parse(await f.text())
      out.push(...fromClaudeAi(Array.isArray(j) ? j : [j]))
    }
  }
  return out
}
