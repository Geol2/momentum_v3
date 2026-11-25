import test from 'node:test'
import assert from 'node:assert/strict'
import { createSentenceSplitter } from '../src/g2/liveText.js'

test('온점·물음표에서 문장을 끊고, 남은 부분은 다음 조각과 이어 붙인다', () => {
  const sp = createSentenceSplitter()
  assert.deepEqual(sp.push('Hello there. How are'), ['Hello there.'])
  assert.equal(sp.pending(), 'How are')
  assert.deepEqual(sp.push('you doing today? I am'), ['How are you doing today?'])
  assert.deepEqual(sp.push('fine', true), ['I am fine'])
  assert.equal(sp.pending(), '')
})

test('한 조각에 여러 문장이 있으면 모두 나누고, 한 단어짜리는 다음 문장에 붙인다', () => {
  const sp = createSentenceSplitter()
  assert.deepEqual(sp.push('Yes. We can do that. Let me check!'), ['Yes. We can do that.', 'Let me check!'])
})

test('바로 앞과 같은 문장은 버린다(중복)', () => {
  const sp = createSentenceSplitter()
  assert.deepEqual(sp.push('See you at three.'), ['See you at three.'])
  assert.deepEqual(sp.push('See you at three.'), [])
  assert.deepEqual(sp.push('see you, at three', true), [])
  assert.deepEqual(sp.push('Great, thanks.'), ['Great, thanks.'])
})

test('쉬지 않고 길게 말하면 30단어에서 끊는다', () => {
  const sp = createSentenceSplitter(30)
  const long = Array.from({ length: 31 }, (_, i) => `w${i}`).join(' ')
  const out = sp.push(long)
  assert.equal(out.length, 1)
  assert.equal(sp.pending(), '')
})
