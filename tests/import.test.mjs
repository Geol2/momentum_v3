// claude.ai 내보내기 가져오기: 작업 메모·중복 문단 없이 최종 답만
import test from 'node:test'
import assert from 'node:assert/strict'
import { fromClaudeAi, dedupeParagraphs } from '../src/g2/importChats.js'

test('도구를 쓴 답은 마지막 도구 뒤의 글만, 생각 블록은 빼기', () => {
  const [c] = fromClaudeAi([{ uuid: 'u1', name: '모멘텀', chat_messages: [
    { sender: 'human', text: '동기화 방법?', content: [{ type: 'text', text: '동기화 방법?' }] },
    { sender: 'assistant', content: [
      { type: 'thinking', thinking: '음' },
      { type: 'text', text: 'Now write a parser module + UI.' },
      { type: 'tool_use', name: 'Bash', input: {} },
      { type: 'tool_result', content: 'ok' },
      { type: 'text', text: '두 가지를 고쳐서 올렸어요.' },
    ] },
  ] }])
  assert.equal(c.turns.length, 1)
  assert.equal(c.turns[0].answer, '두 가지를 고쳐서 올렸어요.')
  assert.match(c.title, /^\[claude\.ai\] 모멘텀/)
})

test('같은 답이 두 메시지로 겹쳐 오면 한 번만', () => {
  const [c] = fromClaudeAi([{ uuid: 'u2', name: 't', chat_messages: [
    { sender: 'human', text: 'q' },
    { sender: 'assistant', text: '첫 문단' },
    { sender: 'assistant', text: '첫 문단\n\n둘째 문단' },
  ] }])
  assert.equal(c.turns[0].answer, '첫 문단\n\n둘째 문단')
})

test('연달아 같은 문단은 하나로', () => {
  assert.equal(dedupeParagraphs('A\n\nA\n\nB'), 'A\n\nB')
  assert.equal(dedupeParagraphs('A\n\nB\n\nA'), 'A\n\nB\n\nA')
})
