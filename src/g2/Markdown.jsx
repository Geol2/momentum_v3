// 가벼운 마크다운 표시기 — Claude 답의 제목·목록·코드·굵게·링크를 읽기 좋게 그립니다.
// HTML 문자열을 끼워 넣지 않고(React 요소로만 만듦) 링크는 http(s)만 허용해서, 답 내용에 스크립트가 섞여도 실행되지 않아요.
import { Fragment } from 'react'

const SAFE_URL = /^https?:\/\//i

// 한 줄 안의 `코드`, **굵게**, *기울임*, [글](주소), 맨 주소
function inline(text, keyBase = 'i') {
  const out = []
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"])|(\*[^*\s][^*\n]*\*)/g
  let last = 0, m, k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0], key = `${keyBase}-${k++}`
    if (m[1]) out.push(<code key={key} className="md-ic">{t.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={key}>{inline(t.slice(2, -2), key)}</strong>)
    else if (m[3]) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)
      out.push(SAFE_URL.test(mm[2])
        ? <a key={key} href={mm[2]} target="_blank" rel="noreferrer noopener">{mm[1]}</a>
        : <Fragment key={key}>{mm[1]}</Fragment>)
    } else if (m[4]) out.push(<a key={key} href={t} target="_blank" rel="noreferrer noopener">{t}</a>)
    else if (m[5]) out.push(<em key={key}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function parse(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const ln = lines[i]
    // ``` 코드 블록
    const fence = /^\s*```(\S*)/.exec(ln)
    if (fence) {
      const body = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++])
      i++
      blocks.push({ t: 'code', lang: fence[1], text: body.join('\n') })
      continue
    }
    if (!ln.trim()) { i++; continue }
    const h = /^(#{1,4})\s+(.*)$/.exec(ln)
    if (h) { blocks.push({ t: 'h', level: h[1].length, text: h[2] }); i++; continue }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(ln)) { blocks.push({ t: 'hr' }); i++; continue }
    if (/^\s*>/.test(ln)) {
      const body = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push({ t: 'quote', text: body.join('\n') })
      continue
    }
    // 표: | a | b | 줄이 이어지면 그대로 고정폭으로
    if (/^\s*\|.*\|\s*$/.test(ln)) {
      const rows = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++])
      const cells = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r))
        .map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
      blocks.push({ t: 'table', head: cells[0] || [], rows: cells.slice(1) })
      continue
    }
    const li = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(ln)
    if (li) {
      const ordered = /\d/.test(li[2])
      const items = []
      while (i < lines.length) {
        const m = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(lines[i])
        if (m && /\d/.test(m[2]) === ordered) {
          items.push({ depth: Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2)), text: m[3] })
          i++
        } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ` ${lines[i].trim()}`
          i++
        } else break
      }
      blocks.push({ t: ordered ? 'ol' : 'ul', items })
      continue
    }
    // 문단: 빈 줄이나 다른 블록 전까지
    const body = []
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^(#{1,4})\s/.test(lines[i])
      && !/^(\s*)([-*•]|\d+[.)])\s+/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) body.push(lines[i++])
    blocks.push({ t: 'p', text: body.join('\n') })
  }
  return blocks
}

function withBreaks(text, key) {
  const parts = text.split('\n')
  return parts.map((p, j) => <Fragment key={`${key}-${j}`}>{inline(p, `${key}-${j}`)}{j < parts.length - 1 && <br />}</Fragment>)
}

export default function Markdown({ text, className = '' }) {
  const blocks = parse(text)
  return (
    <div className={`md ${className}`}>
      {blocks.map((b, n) => {
        const key = `b${n}`
        switch (b.t) {
          case 'code': return <pre key={key} className="md-code" data-lang={b.lang || undefined}><code>{b.text}</code></pre>
          case 'h': { const H = `h${Math.min(6, b.level + 2)}`; return <H key={key} className={`md-h md-h${b.level}`}>{inline(b.text, key)}</H> }
          case 'hr': return <hr key={key} className="md-hr" />
          case 'quote': return <blockquote key={key} className="md-quote">{withBreaks(b.text, key)}</blockquote>
          case 'table': return (
            <div key={key} className="md-table"><table>
              <thead><tr>{b.head.map((c, j) => <th key={j}>{inline(c, `${key}h${j}`)}</th>)}</tr></thead>
              <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${key}r${ri}${j}`)}</td>)}</tr>)}</tbody>
            </table></div>
          )
          case 'ul': case 'ol': {
            const L = b.t
            return <L key={key} className="md-list">{b.items.map((it, j) => <li key={j} style={it.depth ? { marginLeft: it.depth * 16 } : undefined}>{inline(it.text, `${key}-${j}`)}</li>)}</L>
          }
          default: return <p key={key}>{withBreaks(b.text, key)}</p>
        }
      })}
    </div>
  )
}

export const MARKDOWN_CSS = `
.md { font-size:15px; line-height:1.72; color:var(--text); word-break:break-word; }
.md > :first-child { margin-top:0; }
.md p { margin:0 0 10px; }
.md-h { margin:18px 0 8px; line-height:1.4; color:#f4f5f7; }
.md-h1 { font-size:19px; } .md-h2 { font-size:17px; } .md-h3, .md-h4 { font-size:15px; color:#c8ffd6; }
.md-list { margin:0 0 10px; padding-left:22px; }
.md-list li { margin:3px 0; }
.md-list li::marker { color:var(--accent); }
.md strong { color:#ffffff; font-weight:700; }
.md em { color:#d6dae1; }
.md a { color:#8dffaa; text-decoration:underline; text-underline-offset:2px; }
.md-ic { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"D2Coding",monospace; font-size:.88em; background:#1a1f29; border:1px solid #2a3140; border-radius:5px; padding:1px 5px; color:#e6ffe9; }
.md-code { margin:8px 0 12px; padding:12px 14px; background:#07090d; border:1px solid #232a36; border-left:3px solid rgba(77,255,122,.5); border-radius:8px; overflow-x:auto;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"D2Coding",monospace; font-size:13px; line-height:1.6; white-space:pre; color:#dfe3ea; }
.md-code[data-lang]::before { content:attr(data-lang); display:block; font-size:11px; color:var(--muted); margin-bottom:6px; }
.md-quote { margin:0 0 10px; padding:6px 12px; border-left:3px solid #3a4250; color:#c3c8d0; background:rgba(255,255,255,.02); border-radius:0 6px 6px 0; }
.md-hr { border:0; border-top:1px solid var(--line); margin:14px 0; }
.md-table { overflow-x:auto; margin:0 0 12px; }
.md-table table { border-collapse:collapse; font-size:14px; min-width:60%; }
.md-table th, .md-table td { border:1px solid #2a3140; padding:6px 10px; text-align:left; vertical-align:top; }
.md-table th { background:#151a22; color:#f4f5f7; }
`
