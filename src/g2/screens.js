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
  { key: 'interp', label: '통역 (영어→한국어)' },
  ...DECKS.map((d) => ({ key: `deck:${d.id}`, label: `${d.name} 카드` })),
  { key: 'memo', label: '메모' },
  { key: 'font', label: '글꼴 테스트' },
]

// Claude 메뉴는 항상 보여요. 쓸 수 없는 계정(서버 주인도 아니고 내 API 키도 없음)은 들어가면 등록 방법을 안내합니다.
function homeItems() {
  return HOME_ITEMS
}

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
// 한 쪽이 글 상자보다 길면 안경이 스스로 한 줄씩 스크롤해 버려서(앱은 모름), 어떤 쓸기는
// 한 줄만 움직이고 어떤 쓸기는 쪽이 넘어가 헷갈립니다. 그래서 줄 폭을 넉넉히 좁게 잡습니다.
const LINE_UNITS = 24
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
      // 단어 중간에서 끊기지 않게, 줄 뒤쪽에 공백이 있으면 거기서 자릅니다. 공백이 없으면
      // 코드 이름(OrderRepository.findAll...)이 가운데서 갈리지 않게 . ( / _ , 뒤에서 자릅니다.
      const space = cur.lastIndexOf(' ')
      const punct = Math.max(...['.', '(', '/', '_', ','].map((c) => cur.lastIndexOf(c)))
      if (space > cur.length * 0.6) {
        out.push(cur.slice(0, space))
        cur = cur.slice(space + 1)
        units = [...cur].reduce((n, c) => n + charUnits(c), 0)
      } else if (punct > cur.length * 0.5) {
        out.push(cur.slice(0, punct + 1))
        cur = cur.slice(punct + 1)
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
  const steps = ai.steps?.length ? `할 일:\n${ai.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''
  if (state.view === 'detail' && (ai.detail || steps)) {
    return paginate([ai.detail, steps].filter(Boolean).join('\n\n'))
  }
  const q = ai.question ? `Q. ${ai.question}\n\n` : ''
  return paginate(`${q}${ai.answer}${steps ? `\n\n${steps}` : ''}`)
}

// ---------- 카드 복습 (라이트너) ----------

// 섞기(Fisher–Yates). rand 는 테스트에서 고정값을 넣을 수 있게 받습니다.
export function shuffle(list, rand = Math.random) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 이번에 볼 카드: 복습할 때가 된 카드 중 덜 외운 상자부터 SESSION_SIZE장 고르고, 순서는 매번 섞어요.
// (같은 상자 안에서는 무작위로 골라서, 카드가 많아도 매번 같은 카드만 나오지 않게)
export function buildQueue(deck, progress, now = Date.now(), rand = Math.random) {
  const withBox = deck.cards.map((c) => ({ id: c.id, box: progress[c.id]?.box ?? 0, due: progress[c.id]?.due ?? 0, r: rand() }))
  const due = withBox.filter((c) => c.due <= now)
  // 복습할 카드가 없으면 전체를 낮은 상자(덜 외운 것)부터 다시 돕니다.
  const pool = due.length ? due : withBox
  const picked = pool.sort((a, b) => a.box - b.box || a.r - b.r).slice(0, SESSION_SIZE)
  return shuffle(picked, rand).map((c) => c.id)
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
        cursorLines(homeItems(data), state.cursor, 6, (it) => it.label),
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

    case 'interp': {
      if (!data.aiEnabled) {
        return frame('통역', '', '통역을 쓰려면\n폰의 모멘텀 G2 화면에서\n⋯ → Claude API 키 를\n등록해 주세요.', '두 번 누르기: 뒤로')
      }
      const it = data.interp || {}
      const right = it.status === 'listening' ? (it.busy ? '듣는 중 · 옮기는 중' : '듣는 중') : it.status === 'starting' ? '마이크 켜는 중' : ''
      if (it.status === 'error') return frame('통역', '', it.error || '통역을 시작하지 못했어요.', '두 번 누르기: 뒤로')
      const lines = (it.lines || []).slice(-3).map((l) => `· ${l.korean || l.original}`)
      let body = lines.length ? lines.join('\n') : '상대가 영어로 말하면\n여기에 한국어로 떠요.'
      if (it.status === 'listening') {
        // 소리 크기: 막대 2칸 이상이면 말로 알아듣고 서버로 보내요.
        const m = it.meter || 0
        body += `\n\n소리 ${'■'.repeat(m)}${'□'.repeat(5 - m)}`
        if (it.missed) body += ` · 못 알아들음 ${it.missed}`
      }
      if (it.lastError) body += `\n\n오류: ${it.lastError}`
      if (it.suggesting) body += '\n\n추천 대답 만드는 중...'
      else if (it.suggestion?.english) body += `\n\n추천: ${it.suggestion.english}${it.suggestion.korean ? `\n(${it.suggestion.korean})` : ''}`
      return frame('통역', right, body, '누르기: 대답 추천 · 두 번: 끝')
    }

    case 'ask': {
      if (!data.aiEnabled) {
        return frame('Claude', '', 'Claude에게 물으려면\n폰의 모멘텀 G2 화면에서\n⋯ → Claude API 키 를\n등록해 주세요.\n\n등록하면 이 메뉴에서\n바로 물어볼 수 있어요.', '두 번 누르기: 뒤로')
      }
      const ai = data.ai || {}
      const voice = data.voice || {}
      const mic = !!data.voiceEnabled
      const hintBack = '두 번 누르기: 뒤로'
      const title = ai.project ? `Claude · ${ai.project}` : 'Claude'
      // 안경 마이크: 누르면 듣기 시작, 다시 누르면 끝 → 받아 적어서 바로 물어봅니다.
      if (voice.status === 'recording') {
        return frame('말하는 중', `${voice.seconds || 0}초`, '듣고 있어요...\n\n다 말했으면 한 번 누르세요.', '누르기: 끝 · 두 번: 취소')
      }
      if (voice.status === 'transcribing') return frame('말하는 중', '', '받아 적는 중...', hintBack)
      if (voice.status === 'error') return frame('Claude', '', voice.error, `${mic ? '누르기: 다시 말하기 · ' : ''}${hintBack}`)
      if (ai.status === 'loading') {
        const q = ai.question.length > 50 ? `${ai.question.slice(0, 50)}...` : ai.question
        const photos = ai.imageCount ? ` (사진 ${ai.imageCount}장)` : ''
        // 프로젝트를 읽는 중이면 최근 작업 3개를 보여 줍니다(지금 저랑 대화할 때처럼).
        const steps = (ai.progress || []).slice(-3).map((p) => `- ${p.length > 34 ? `${p.slice(0, 34)}...` : p}`)
        const body = `Q. ${q || '사진 속 요구사항 보기'}${photos}\n\n${steps.length ? steps.join('\n') : '생각하는 중...'}`
        return frame(title, steps.length ? `${ai.progress.length}단계` : '', body, hintBack)
      }
      if (ai.status === 'error') return frame('Claude', '', ai.error, `${mic ? '누르기: 다시 말하기 · ' : ''}${hintBack}`)
      if (ai.status !== 'done') {
        const body = mic
          ? '한 번 누르고 말하세요.\n다 말했으면 다시 누르세요.\n\n폰·PC(momentum.geol2.com/g2.html)에서\n써서 물어도 여기에 같이 떠요.'
          : '폰이나 PC에서 질문하세요.\nPC: momentum.geol2.com/g2.html\n\n답은 질문한 화면과 여기에 같이 떠요.\n어느 화면에서 이어 물어도 같은 대화예요.'
        return frame('Claude에게 묻기', '', body, mic ? `누르기: 말하기 · ${hintBack}` : hintBack)
      }
      const pages = askPages(state, ai)
      const page = clamp(state.page ?? 0, pages.length - 1)
      const detail = state.view === 'detail'
      const steps = ai.steps?.length || 0
      const more = ai.detail || steps
      let save = ''
      if (steps && ai.todoSave === 'saving') save = '할 일 저장 중...'
      else if (steps && ai.todoSave === 'saved') save = `할 일 ${steps}개 저장됨`
      else if (steps && ai.todoSave === 'error') save = '저장 실패 · 누르기: 다시 저장'
      else if (steps) save = `누르기: 할 일 ${steps}개 저장`
      let hint
      if (mic) {
        // 마이크가 있으면 요약에서 누르기 = 말하기, 전체 답에서 누르기 = 할 일 저장
        if (detail) hint = save ? `${save} · 길게: 요약` : '쓸기: 쪽 넘김 · 길게: 요약'
        else hint = more ? '누르기: 말하기 · 길게: 전체 답' : '누르기: 말하기 · 쓸기: 쪽 넘김'
      } else if (save) hint = `${save}${ai.detail || steps ? (detail ? ' · 길게: 요약' : ' · 길게: 전체 답') : ''}`
      else if (ai.detail) hint = detail ? '쓸기: 쪽 넘김 · 길게: 요약 · 두 번: 뒤로' : '쓸기: 쪽 넘김 · 길게: 전체 답(코드)'
      else hint = '쓸기: 쪽 넘김 · 두 번: 뒤로'
      const nav = ai.pinNav
      const right = nav ? `답 ${nav.idx + 1}/${nav.total} · ${page + 1}/${pages.length}쪽` : `${page + 1}/${pages.length}`
      if (nav && !detail && !save) hint = `쓸기: 쪽·이전/다음 답${ai.detail ? ' · 길게: 전체 답' : ''}`
      return frame(detail ? `${title} 전체 답` : title, right, pages[page], hint)
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
  // 말하는 중에 두 번 누르기 = 녹음 취소 (뒤로 가지 않음)
  if (state.screen === 'ask' && data.voice?.status === 'recording' && gesture === 'double') {
    return { state, effects: [{ type: 'micCancel' }] }
  }
  // 통역: 두 번 누르면 마이크를 끄고 홈으로
  if (state.screen === 'interp' && gesture === 'double') {
    const back = homeItems(data).findIndex((it) => it.key === 'interp')
    return { state: home(Math.max(0, back)).state, effects: [{ type: 'interpStop' }] }
  }
  if (state.screen !== 'home' && gesture === 'double') {
    const back = homeItems(data).findIndex((it) =>
      it.key === state.screen || it.key === `deck:${state.deckId}`)
    return home(Math.max(0, back))
  }

  switch (state.screen) {
    case 'home': {
      const items = homeItems(data)
      const max = items.length - 1
      // 루트 화면의 두 번 누르기 = 앱 종료 (Even Hub 심사 필수 동작)
      if (gesture === 'double') return { state, effects: [{ type: 'exit' }] }
      if (gesture === 'up') return stay({ ...state, cursor: clamp(state.cursor - 1, max) })
      if (gesture === 'down') return stay({ ...state, cursor: clamp(state.cursor + 1, max) })
      if (gesture !== 'tap') return stay(state)
      const item = items[clamp(state.cursor, max)]
      if (item.key.startsWith('deck:')) return stay(startDeck(item.key.slice(5), data.progress))
      if (item.key === 'todos') return { state: { screen: 'todos', cursor: 0 }, effects: [{ type: 'loadTodos' }] }
      if (item.key === 'ask') return stay({ screen: 'ask', page: 0 })
      if (item.key === 'interp') return data.aiEnabled ? { state: { screen: 'interp' }, effects: [{ type: 'interpStart' }] } : stay({ screen: 'interp' })
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

    case 'interp': {
      if (!data.aiEnabled) return stay(state)
      return gesture === 'tap' ? { state, effects: [{ type: 'interpSuggest' }] } : stay(state)
    }

    case 'ask': {
      if (!data.aiEnabled) return gesture === 'double' ? home(1) : stay(state)
      const ai = data.ai || {}
      const voice = data.voice || {}
      const mic = !!data.voiceEnabled
      if (voice.status === 'recording') {
        return gesture === 'tap' ? { state, effects: [{ type: 'micStop' }] } : stay(state)
      }
      if (voice.status === 'transcribing') return stay(state)
      const canSave = ai.status === 'done' && ai.steps?.length && ai.todoSave !== 'saving' && ai.todoSave !== 'saved'
      if (gesture === 'tap') {
        // 누르기: (전체 답 화면이면) 작업 단계를 오늘 할 일로 저장, 아니면 마이크로 말하기.
        // 할 일은 한 답에 한 번만 저장됩니다(실수로 두 번 눌러도 중복되지 않게).
        if (canSave && (!mic || state.view === 'detail')) return { state, effects: [{ type: 'saveSteps' }] }
        if (mic && ai.status !== 'loading') return { state, effects: [{ type: 'micStart' }] }
        return stay(state)
      }
      if (ai.status !== 'done') return stay(state)
      // 길게 누르기: 요약 <-> 전체 답(코드) 전환. 폐쇄망 PC에서 타이핑하면서 안경으로 코드를 봅니다.
      if (gesture === 'long' && (ai.detail || ai.steps?.length)) {
        return stay({ ...state, view: state.view === 'detail' ? 'summary' : 'detail', page: 0 })
      }
      const max = askPages(state, ai).length - 1
      const pg = state.page ?? 0
      // 폰·PC에서 고른 대화: 첫 쪽에서 위로 = 이전 답, 마지막 쪽에서 아래로 = 다음 답
      const nav = ai.pinNav
      if (nav && gesture === 'up' && pg === 0 && nav.idx > 0) return { state, effects: [{ type: 'pinNav', dir: -1 }] }
      if (nav && gesture === 'down' && pg >= max && nav.idx < nav.total - 1) return { state, effects: [{ type: 'pinNav', dir: 1 }] }
      if (gesture === 'up') return stay({ ...state, page: clamp(pg - 1, max) })
      if (gesture === 'down') return stay({ ...state, page: clamp(pg + 1, max) })
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
