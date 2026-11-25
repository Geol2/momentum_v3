// PC Claude Code 세션 → 모멘텀 동기화(parseSession) 테스트
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseSession } from '../scripts/sync-claude-sessions.mjs'

function session(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'))
  const f = path.join(dir, 'abc-123.jsonl')
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n'))
  return f
}

test('질문·답 쌍으로 묶고, 도구 실행·생각은 빼고, 프로젝트 이름을 제목 앞에', () => {
  const f = session([
    { type: 'user', cwd: '/home/a/work/momentum_v3', message: { role: 'user', content: '로그인 고쳐줘' }, timestamp: '2026-11-25T01:00:00Z' },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '음...' }, { type: 'tool_use', name: 'Read', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: '파일 내용' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '고쳤어요.' }] } },
    { type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
    { type: 'user', message: { role: 'user', content: '고마워' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '천만에요' }] } },
  ])
  const s = parseSession(f)
  assert.equal(s.sessionId, 'abc-123')
  assert.match(s.title, /^\[momentum_v3\] /)
  assert.equal(s.turns.length, 2)
  assert.equal(s.turns[0].question, '로그인 고쳐줘')
  assert.match(s.turns[0].answer, /고쳤어요/)
  assert.ok(!s.turns[0].answer.includes('음...'))
  assert.equal(s.turns[1].question, '고마워')
})

test('요약 후 이어진 세션은 제목을 다음 실제 질문에서', () => {
  const f = session([
    { type: 'user', cwd: '/x/proj', message: { role: 'user', content: 'This session is being continued from a previous conversation...' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '네' }] } },
    { type: 'user', message: { role: 'user', content: '배포 스크립트 정리해줘' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '정리했어요' }] } },
  ])
  const s = parseSession(f)
  assert.match(s.title, /배포 스크립트/)
})
