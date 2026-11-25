// 안경 화면 로직(screens.js) 필수 동작 테스트 — node --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQueue, shuffle, gradeCard, reduce, render, initialState } from '../src/g2/screens.js'
import { DECKS } from '../src/g2/decks.js'

// 고정된 난수(테스트가 매번 같게)
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
const DAY = 86400000

test('shuffle: 원소는 그대로, 원본은 안 바뀜', () => {
  const a = [1, 2, 3, 4, 5, 6]
  const b = shuffle(a, seeded(7))
  assert.deepEqual([...b].sort(), [...a].sort())
  assert.deepEqual(a, [1, 2, 3, 4, 5, 6])
})

test('buildQueue: 최대 20장, 중복 없음, 덱에 있는 카드만', () => {
  for (const deck of DECKS) {
    const q = buildQueue(deck, {}, Date.now(), seeded(3))
    assert.ok(q.length <= 20 && q.length === Math.min(20, deck.cards.length), deck.id)
    assert.equal(new Set(q).size, q.length)
    const ids = new Set(deck.cards.map((c) => c.id))
    q.forEach((id) => assert.ok(ids.has(id)))
  }
})

test('buildQueue: 난수에 따라 순서가 달라짐(랜덤)', () => {
  const deck = DECKS.find((d) => d.cards.length > 20)
  const a = buildQueue(deck, {}, Date.now(), seeded(1))
  const b = buildQueue(deck, {}, Date.now(), seeded(99))
  assert.notDeepEqual(a, b)
})

test('buildQueue: 복습할 때가 된 카드만, 덜 외운 상자 먼저', () => {
  const deck = { cards: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
  const now = 10 * DAY
  const progress = { a: { box: 3, due: now - 1 }, b: { box: 1, due: now - 1 }, c: { box: 1, due: now + DAY } }
  const q = buildQueue(deck, progress, now, seeded(5))
  assert.deepEqual([...q].sort(), ['a', 'b']) // c 는 아직 아님
})

test('buildQueue: 복습할 카드가 없으면 전체를 다시', () => {
  const deck = { cards: [{ id: 'a' }, { id: 'b' }] }
  const now = DAY
  const q = buildQueue(deck, { a: { box: 2, due: now + DAY }, b: { box: 1, due: now + DAY } }, now, seeded(2))
  assert.equal(q.length, 2)
})

test('gradeCard: 알면 상자 +1(최대 5), 모르면 1로', () => {
  assert.equal(gradeCard(undefined, true, 0).box, 1)
  assert.equal(gradeCard({ box: 5 }, true, 0).box, 5)
  assert.equal(gradeCard({ box: 4 }, false, 0).box, 1)
  assert.ok(gradeCard({ box: 2 }, true, 0).due > 0)
})

test('덱 데이터: id 전부 고유, 앞뒤 내용 있음, 안경에 맞게 짧음', () => {
  const all = new Set()
  for (const d of DECKS) {
    for (const c of d.cards) {
      assert.ok(!all.has(c.id), `중복 id ${c.id}`)
      all.add(c.id)
      assert.ok(c.front && c.front.trim(), c.id)
      assert.ok(c.back && c.back.trim(), c.id)
      assert.ok(!c.front.includes('\n'), `앞면은 한 줄: ${c.id}`)
      assert.ok(c.back.split('\n').length <= 4, `뒷면은 4줄 이하: ${c.id}`)
    }
  }
})

test('홈: Claude 메뉴는 항상 보이고, 못 쓰는 계정은 안내 화면 → 두 번 누르면 홈', () => {
  const data = { aiEnabled: false }
  const home = JSON.stringify(render(initialState, data))
  assert.ok(home.includes('Claude에게 묻기'))
  let st = reduce(initialState, 'down', data).state
  st = reduce(st, 'tap', data).state
  assert.equal(st.screen, 'ask')
  assert.ok(JSON.stringify(render(st, data)).includes('API 키'))
  assert.equal(reduce(st, 'tap', data).state.screen, 'ask') // 다른 동작은 무시
  assert.equal(reduce(st, 'double', data).state.screen, 'home')
})

test('홈: 카드 덱 메뉴로 들어가면 카드 화면', () => {
  const data = { aiEnabled: true, progress: {} }
  const items = JSON.stringify(render(initialState, data))
  assert.ok(items.includes('IT 영어 카드'))
  let st = initialState
  // 'IT 영어 카드'까지 내려가서 누르기
  for (let i = 0; i < 10 && !JSON.stringify(render(st, data)).includes('> IT 영어'); i++) st = reduce(st, 'down', data).state
  const r = reduce(st, 'tap', data)
  assert.ok(r.state.deckId === 'it-en' || r.state.screen !== 'home')
})

test('통역: 들어가면 마이크 켜기, 누르면 대답 추천, 두 번 누르면 마이크 끄고 홈', () => {
  const data = { aiEnabled: true }
  let st = reduce(initialState, 'down', data).state // Claude에게 묻기
  st = reduce(st, 'down', data).state // 통역
  let r = reduce(st, 'tap', data)
  assert.equal(r.state.screen, 'interp')
  assert.deepEqual(r.effects, [{ type: 'interpStart' }])
  r = reduce(r.state, 'tap', data)
  assert.deepEqual(r.effects, [{ type: 'interpSuggest' }])
  r = reduce(r.state, 'double', data)
  assert.equal(r.state.screen, 'home')
  assert.deepEqual(r.effects, [{ type: 'interpStop' }])
})

test('통역 화면: 최근 번역 2줄, 추천 대답은 따로 한 화면, 키 없는 계정은 안내', () => {
  const lines = [1, 2, 3, 4].map((i) => ({ original: `line ${i}`, korean: `한국어 ${i}` }))
  const page = JSON.stringify(render({ screen: 'interp' }, { aiEnabled: true, interp: { status: 'listening', lines } }))
  assert.ok(!page.includes('한국어 2') && page.includes('한국어 3') && page.includes('한국어 4'))
  assert.ok(page.includes('듣는 중'))
  const stopped = { aiEnabled: true, interp: { status: 'paused', lines, suggestOpen: true, suggestion: { english: 'Sounds good.', korean: '좋아요.', summary: ['3시로 옮기자'] } } }
  // 멈추면 요점 쪽부터
  const tapped = reduce({ screen: 'interp' }, 'tap', { aiEnabled: true, interp: { lines } })
  assert.deepEqual(tapped.effects, [{ type: 'interpSuggest' }])
  let pg = JSON.stringify(render(tapped.state, stopped))
  assert.ok(pg.includes('상대 요점') && pg.includes('3시로 옮기자'))
  // 아래 = 추천 대답, 위로 가면 전체 말(쪽 2/2 → 1/2)
  pg = JSON.stringify(render(reduce(tapped.state, 'down', stopped).state, stopped))
  assert.ok(pg.includes('추천 대답') && pg.includes('Sounds good.'))
  let st2 = reduce(tapped.state, 'up', stopped).state
  pg = JSON.stringify(render(st2, stopped))
  assert.ok(pg.includes('전체 말') && pg.includes('2/2') && pg.includes('한국어 4'))
  st2 = reduce(reduce(st2, 'up', stopped).state, 'up', stopped).state
  pg = JSON.stringify(render(st2, stopped))
  assert.ok(pg.includes('1/2') && pg.includes('한국어 1'))
  // 추천 화면: 누르면 닫기, 두 번이면 다른 추천(나가지 않음)
  const open = { aiEnabled: true, interp: { suggestOpen: true } }
  assert.deepEqual(reduce({ screen: 'interp' }, 'tap', open).effects, [{ type: 'interpCloseSuggest' }])
  const again = reduce({ screen: 'interp' }, 'double', open)
  assert.equal(again.state.screen, 'interp')
  assert.deepEqual(again.effects, [{ type: 'interpSuggest' }])
  assert.ok(JSON.stringify(render({ screen: 'interp' }, { aiEnabled: false })).includes('API 키'))
  // 키 없는 계정은 들어가도 마이크를 켜지 않음
  let st = reduce(initialState, 'down', { aiEnabled: false }).state
  st = reduce(st, 'down', { aiEnabled: false }).state
  assert.deepEqual(reduce(st, 'tap', { aiEnabled: false }).effects, [])
})

test('통역 기록: 위로 넘기면 지난 통역을 3개씩, 아래로 끝까지 오면 실시간', () => {
  const lines = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ original: `line ${i}`, korean: `한국어 ${i}` }))
  const data = { aiEnabled: true, interp: { status: 'listening', lines } }
  let st = { screen: 'interp' }
  st = reduce(st, 'up', data).state
  let page = JSON.stringify(render(st, data))
  assert.ok(page.includes('통역 기록') && page.includes('3/3') && page.includes('한국어 7') && page.includes('line 5') && !page.includes('한국어 4'))
  st = reduce(reduce(st, 'up', data).state, 'up', data).state
  st = reduce(st, 'up', data).state // 맨 처음에서 더 위로 가도 그대로
  page = JSON.stringify(render(st, data))
  assert.ok(page.includes('1/3') && page.includes('한국어 1') && !page.includes('한국어 2'))
  st = reduce(reduce(reduce(st, 'down', data).state, 'down', data).state, 'down', data).state
  assert.equal(st.hist, 0)
  assert.ok(JSON.stringify(render(st, data)).includes('위: 기록'))
})
