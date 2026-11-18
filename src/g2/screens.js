// G2 화면 상태 머신. React와 SDK를 모르는 순수 함수만 둡니다.
//   render(state, data) → page (layout.js 모델)
//   reduce(state, gesture, data) → { state, effects }
// effects는 서버 저장처럼 바깥에서 처리할 일을 담습니다(G2App.jsx가 실행).
//
// 화면 문자에는 ASCII 기호만 씁니다(>, [x], ->). 안경 글꼴에 없는 글자는 경고 없이
// 사라지기 때문에, ▶ ✓ 같은 특수기호는 '글꼴 테스트'로 확인한 뒤에만 쓰세요.
import { DECKS } from './decks.js'
import { SCREEN_W, text, windowAround } from './layout.js'

const HOME_ITEMS = [
  { key: 'todos', label: '오늘 할 일' },
  { key: 'ask', label: 'Claude에게 묻기' },
  ...DECKS.map((d) => ({ key: `deck:${d.id}`, label: `${d.name} 카드` })),
  { key: 'memo', label: '메모' },
  { key: 'font', label: '글꼴 테스트' },
]

const SESSION_SIZE = 20
const DAY = 24 * 60 * 60 * 1000
// 상자 번호별 다음 복습까지의 간격(일). 라이트너 방식.
const BOX_INTERVAL_DAYS = [0, 0, 1, 3, 7, 15]

export const initialState = { screen: 'home', cursor: 0 }

// ---------- 공통 틀 ----------

function frame(title, right, body, hint) {
  return {
    texts: [
      text('header', 0, 0, SCREEN_W, 36, right ? `${title}   ${right}` : title, { level: 2 }),
      text('body', 0, 40, SCREEN_W, 210, body),
      text('hint', 0, 254, SCREEN_W, 34, hint, { level: 2 }),
    ],
    capture: 'body',
  }
}

function cursorLines(items, cursor, size, toLine) {
  const { start, slice } = windowAround(items, cursor, size)
  return slice.map((it, i) => `${start + i === cursor ? '>' : ' '} ${toLine(it)}`).join('\n')
}

const clamp = (v, max) => Math.max(0, Math.min(max, v))

// ---------- 긴 글 쪽 나누기 ----------

// 미리보기 기준(20px, 본문 폭 564px) 한 줄에 한글 약 28자. 실제 안경 글꼴은 조금 다를 수
// 있어서 여유를 둡니다. 영문·숫자·기호는 한글의 절반 남짓 폭으로 계산합니다.
const LINE_UNITS = 26
const PAGE_LINES = 6

function charUnits(ch) {
  return /[\u0000-\u00ff]/.test(ch) ? 0.6 : 1
}

function wrapLine(line) {
  if (!line) return ['']
  const out = []
  let cur = ''
  let units = 0
  for (const ch of line) {
    const u = charUnits(ch)
    if (units + u > LINE_UNITS && cur) {
      // 단어 중간에서 끊기지 않게, 줄 뒤쪽에 공백이 있으면 거기서 자릅니다.
      const cut = cur.lastIndexOf(' ')
      if (cut > cur.length * 0.6) {
        out.push(cur.slice(0, cut))
        cur = cur.slice(cut + 1)
        units = [...cur].reduce((n, c) => n + charUnits(c), 0)
      } else {
        out.push(cur)
        cur = ''
        units = 0
      }
    }
    cur += ch
    units += u
  }
  out.push(cur)
  return out
}

export function paginate(text) {
  const lines = String(text ?? '').split('\n').flatMap(wrapLine)
  const pages = []
  for (let i = 0; i < lines.length; i += PAGE_LINES) pages.push(lines.slice(i, i + PAGE_LINES).join('\n'))
  return pages.length ? pages : ['']
}

function askPages(state, ai) {
  if (state.view === 'detail' && ai.detail) return paginate(ai.detail)
  const q = ai.question ? `Q. ${ai.question}\n\n` : ''
  const steps = ai.steps?.length ? `\n\n할 일:\n${ai.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''
  return paginate(`${q}${ai.answer}${steps}`)
}

// ---------- 카드 복습 (라이트너) ----------

export function buildQueue(deck, progress, now = Date.now()) {
  const withBox = deck.cards.map((c) => ({ id: c.id, box: progress[c.id]?.box ?? 0, due: progress[c.id]?.due ?? 0 }))
  const due = withBox.filter((c) => c.due <= now)
  // 복습할 카드가 없으면 전체를 낮은 상자(덜 외운 것)부터 다시 돕니다.
  const pool = due.length ? due : withBox
  return pool.sort((a, b) => a.box - b.box || a.due - b.due).slice(0, SESSION_SIZE).map((c) => c.id)
}

export function gradeCard(prev, known, now = Date.now()) {
  const box = known ? Math.min(5, (prev?.box ?? 0) + 1) : 1
  return { box, due: now + BOX_INTERVAL_DAYS[box] * DAY }
}

// ---------- render ----------

export function render(state, data) {
  switch (state.screen) {
    case 'home':
      return frame(
        '달빛 서랍',
        data.userName || '',
        cursorLines(HOME_ITEMS, state.cursor, 6, (it) => it.label),
        '쓸기: 이동 · 누르기: 열기 · 두 번: 종료',
      )

    case 'todos': {
      const todos = data.todos
      if (data.todosError) return frame('오늘 할 일', '', data.todosError, '두 번 누르기: 뒤로')
      if (!todos) return frame('오늘 할 일', '', '불러오는 중...', '두 번 누르기: 뒤로')
      if (!todos.length) return frame('오늘 할 일', '0개', '오늘 할 일이 없어요.', '두 번 누르기: 뒤로')
      const done = todos.filter((t) => t.done).length
      const body = cursorLines(todos, state.cursor, 6, (t) => {
        const when = t.timeLabel ? ` (${t.timeLabel})` : ''
        return `${t.done ? '[x]' : '[ ]'} ${t.text}${when}`
      })
      return frame('오늘 할 일', `${done}/${todos.length} 완료`, body, '누르기: 완료 표시 · 두 번: 뒤로')
    }

    case 'ask': {
      const ai = data.ai || {}
      const hintBack = '두 번 누르기: 뒤로'
      if (ai.status === 'loading') {
        const q = ai.question.length > 60 ? `${ai.question.slice(0, 60)}...` : ai.question
        const photos = ai.imageCount ? `\n(사진 ${ai.imageCount}장)` : ''
        return frame('Claude', '', `Q. ${q || '사진 속 요구사항 보기'}${photos}\n\n생각하는 중...`, hintBack)
      }
      if (ai.status === 'error') return frame('Claude', '', ai.error, hintBack)
      if (ai.status !== 'done') {
        return frame('Claude에게 묻기', '', '폰 화면에 질문을 입력하세요.\n\n답은 여기에 떠요.\n이어서 물어보면 앞 대화를 기억해요.', hintBack)
      }
      const pages = askPages(state, ai)
      const page = clamp(state.page ?? 0, pages.length - 1)
      const detail = state.view === 'detail'
      const steps = ai.steps?.length || 0
      let hint
      if (steps && ai.todoSave === 'saving') hint = '할 일 저장 중...'
      else if (steps && ai.todoSave === 'saved') hint = `할 일 ${steps}개 저장됨 · 두 번: 뒤로`
      else if (steps && ai.todoSave === 'error') hint = '저장 실패 · 누르기: 다시 저장'
      else if (steps) hint = `누르기: 할 일 ${steps}개 저장${ai.detail ? ' · 길게: 전체 답' : ''}`
      else if (ai.detail) hint = detail ? '쓸기: 쪽 넘김 · 길게: 요약 · 두 번: 뒤로' : '쓸기: 쪽 넘김 · 길게: 전체 답(코드)'
      else hint = '쓸기: 쪽 넘김 · 두 번: 뒤로'
      return frame(detail ? 'Claude 전체 답' : 'Claude', `${page + 1}/${pages.length}`, pages[page], hint)
    }

    case 'cards': {
      const deck = DECKS.find((d) => d.id === state.deckId)
      if (state.idx >= state.queue.length) {
        return frame(
          `${deck.name} 카드`,
          '끝',
          `복습 완료!\n\n알았음 ${state.known}개 · 몰랐음 ${state.unknown}개`,
          '누르기: 다시 · 두 번: 뒤로',
        )
      }
      const card = deck.cards.find((c) => c.id === state.queue[state.idx])
      const body = state.flipped ? `${card.front}\n\n${card.back}` : `\n${card.front}`
      const hint = state.flipped ? '위로: 알았음 · 아래로: 몰랐음' : '누르기: 뜻 보기 · 두 번: 뒤로'
      return frame(`${deck.name} 카드`, `${state.idx + 1}/${state.queue.length}`, body, hint)
    }

    case 'memo': {
      const notes = data.notes
      if (data.notesError) return frame('메모', '', data.notesError, '두 번 누르기: 뒤로')
      if (!notes) return frame('메모', '', '불러오는 중...', '두 번 누르기: 뒤로')
      if (!notes.length) return frame('메모', '0개', '메모가 없어요.', '두 번 누르기: 뒤로')
      const note = notes[state.idx]
      // 한 화면에 들어가는 만큼만 (전체 페이지 1000자 제한)
      const body = note.text.length > 400 ? `${note.text.slice(0, 400)}...` : note.text
      return frame('메모', `${state.idx + 1}/${notes.length}${note.pinned ? ' 고정' : ''}`, body, '쓸기: 다음/이전 · 두 번: 뒤로')
    }

    case 'font':
      return frame(
        '글꼴 테스트',
        '',
        [
          '한글: 가나다라 마바사 아자차카 타파하',
          '자모: ㄱㄴㄷ ㅏㅑㅓ  숫자: 0123456789',
          'ABC abc  !@#$%^&*()[]{}<>?/\\|',
          '화살표: → ← ↑ ↓   도형: ▶ ● ○ ■ □',
          '체크: ✓ ✔ ✗   별: ★ ☆   기타: … · ①②',
        ].join('\n'),
        '빠진 글자 = 안경 글꼴에 없음 · 두 번: 뒤로',
      )

    default:
      return frame('?', '', `알 수 없는 화면: ${state.screen}`, '')
  }
}

// ---------- reduce ----------

const home = (cursor = 0) => ({ state: { screen: 'home', cursor }, effects: [] })
const stay = (state) => ({ state, effects: [] })

export function reduce(state, gesture, data) {
  if (state.screen !== 'home' && gesture === 'double') {
    const back = HOME_ITEMS.findIndex((it) =>
      it.key === state.screen || it.key === `deck:${state.deckId}`)
    return home(Math.max(0, back))
  }

  switch (state.screen) {
    case 'home': {
      const max = HOME_ITEMS.length - 1
      // 루트 화면의 두 번 누르기 = 앱 종료 (Even Hub 심사 필수 동작)
      if (gesture === 'double') return { state, effects: [{ type: 'exit' }] }
      if (gesture === 'up') return stay({ ...state, cursor: clamp(state.cursor - 1, max) })
      if (gesture === 'down') return stay({ ...state, cursor: clamp(state.cursor + 1, max) })
      if (gesture !== 'tap') return stay(state)
      const item = HOME_ITEMS[state.cursor]
      if (item.key.startsWith('deck:')) return stay(startDeck(item.key.slice(5), data.progress))
      if (item.key === 'todos') return { state: { screen: 'todos', cursor: 0 }, effects: [{ type: 'loadTodos' }] }
      if (item.key === 'ask') return stay({ screen: 'ask', page: 0 })
      if (item.key === 'memo') return { state: { screen: 'memo', idx: 0 }, effects: [{ type: 'loadNotes' }] }
      return stay({ screen: item.key })
    }

    case 'todos': {
      const todos = data.todos || []
      const max = Math.max(0, todos.length - 1)
      if (gesture === 'up') return stay({ ...state, cursor: clamp(state.cursor - 1, max) })
      if (gesture === 'down') return stay({ ...state, cursor: clamp(state.cursor + 1, max) })
      if (gesture === 'tap' && todos[state.cursor]) {
        const t = todos[state.cursor]
        return { state, effects: [{ type: 'toggleTodo', id: t.id, done: !t.done }] }
      }
      return stay(state)
    }

    case 'cards': {
      if (state.idx >= state.queue.length) {
        return gesture === 'tap' ? stay(startDeck(state.deckId, data.progress)) : stay(state)
      }
      if (!state.flipped) return gesture === 'tap' ? stay({ ...state, flipped: true }) : stay(state)
      if (gesture !== 'up' && gesture !== 'down') return stay(state)
      const known = gesture === 'up'
      const cardId = state.queue[state.idx]
      // 몰랐던 카드는 이번 회차 끝에 한 번 더 나오게 합니다(같은 회차에 한 번만).
      const queue = !known && !state.retried.includes(cardId) ? [...state.queue, cardId] : state.queue
      return {
        state: {
          ...state,
          queue,
          idx: state.idx + 1,
          flipped: false,
          known: state.known + (known ? 1 : 0),
          unknown: state.unknown + (known ? 0 : 1),
          retried: known ? state.retried : [...state.retried, cardId],
        },
        effects: [{ type: 'grade', cardId, known }],
      }
    }

    case 'ask': {
      const ai = data.ai || {}
      if (ai.status !== 'done') return stay(state)
      // 길게 누르기: 요약 <-> 전체 답(코드) 전환. 폐쇄망 PC에서 타이핑하면서 안경으로 코드를 봅니다.
      if (gesture === 'long' && ai.detail) {
        return stay({ ...state, view: state.view === 'detail' ? 'summary' : 'detail', page: 0 })
      }
      // 누르기: 작업 단계를 오늘 할 일로 저장 (한 답에 한 번만 — 실수로 두 번 눌러도 중복되지 않게)
      if (gesture === 'tap' && ai.steps?.length && ai.todoSave !== 'saving' && ai.todoSave !== 'saved') {
        return { state, effects: [{ type: 'saveSteps' }] }
      }
      const max = askPages(state, ai).length - 1
      if (gesture === 'up') return stay({ ...state, page: clamp((state.page ?? 0) - 1, max) })
      if (gesture === 'down') return stay({ ...state, page: clamp((state.page ?? 0) + 1, max) })
      return stay(state)
    }

    case 'memo': {
      const max = Math.max(0, (data.notes?.length || 1) - 1)
      if (gesture === 'up') return stay({ ...state, idx: clamp(state.idx - 1, max) })
      if (gesture === 'down') return stay({ ...state, idx: clamp(state.idx + 1, max) })
      return stay(state)
    }

    default:
      return stay(state)
  }
}

function startDeck(deckId, progress) {
  const deck = DECKS.find((d) => d.id === deckId)
  return {
    screen: 'cards', deckId,
    queue: buildQueue(deck, progress || {}),
    idx: 0, flipped: false, known: 0, unknown: 0, retried: [],
  }
}
