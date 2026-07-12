// Static data ported from the original 달빛 서랍 design.

export const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토']

export const MOODS = [
  { emoji: '😊', label: '행복', color: '#fcd34d' },
  { emoji: '😌', label: '평온', color: '#86efac' },
  { emoji: '🥰', label: '설렘', color: '#fda4af' },
  { emoji: '😢', label: '슬픔', color: '#93c5fd' },
  { emoji: '😡', label: '화남', color: '#f87171' },
  { emoji: '😴', label: '피곤', color: '#c4b5fd' },
  { emoji: '🤔', label: '복잡', color: '#a8a29e' },
]

// Selectable scenery photo backgrounds (Unsplash). A dark overlay keeps white text readable.
const scenery = (url) =>
  `linear-gradient(180deg, rgba(6,10,20,0.45), rgba(6,10,20,0.55)), url(${url}) center/cover no-repeat #0a0d18`

export const BACKGROUNDS = [
  {
    k: 'mountain', name: '산',
    css: scenery('https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1920&q=80'),
  },
  {
    k: 'ocean', name: '바다',
    css: scenery('https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=80'),
  },
  {
    k: 'forest', name: '숲',
    css: scenery('https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1920&q=80'),
  },
  {
    k: 'lake', name: '호수',
    css: scenery('https://images.unsplash.com/photo-1439066615861-d1af74d74000?auto=format&fit=crop&w=1920&q=80'),
  },
  {
    k: 'field', name: '들판',
    css: scenery('https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1920&q=80'),
  },
  {
    k: 'sunrise', name: '일출',
    css: scenery('https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1920&q=80'),
  },
]

export const QUOTES = [
  { text: '오늘 할 수 있는 일을 내일로 미루지 마라.', author: '벤자민 프랭클린' },
  { text: '천 리 길도 한 걸음부터.', author: '노자' },
  { text: '당신이 할 수 있다고 생각하든, 할 수 없다고 생각하든 당신이 옳다.', author: '헨리 포드' },
  { text: '성공은 매일 반복되는 작은 노력들의 합이다.', author: '로버트 콜리어' },
  { text: '지금 이 순간에 충실하라.', author: '톨스토이' },
  { text: '꿈을 향해 자신 있게 나아가라.', author: '헨리 데이비드 소로' },
  { text: '포기하지 않는 한 실패는 없다.', author: '작자 미상' },
  { text: '배움에는 끝이 없다.', author: '공자' },
  { text: '오늘의 나는 어제의 내가 만든 것이다.', author: '마하트마 간디' },
  { text: '시간은 돈보다 소중하다.', author: '벤자민 프랭클린' },
  { text: '두려움 없이 사는 자가 진정 자유롭다.', author: '빌리 조엘' },
  { text: '작은 것에 감사하면 큰 것이 찾아온다.', author: '작자 미상' },
]

// Sticky-note pastel colors, cycled as notes are added.
export const NOTE_COLORS = [
  'linear-gradient(135deg, #fef3a0, #fde68a)',
  'linear-gradient(135deg, #bbf7d0, #86efac)',
  'linear-gradient(135deg, #fecdd3, #fda4af)',
  'linear-gradient(135deg, #bfdbfe, #93c5fd)',
  'linear-gradient(135deg, #ddd6fe, #c4b5fd)',
]

// Map a wttr.in weatherCode to an emoji.
export function weatherIcon(code) {
  code = parseInt(code, 10)
  if (code === 113) return '☀️'
  if (code === 116) return '⛅'
  if (code === 119 || code === 122) return '☁️'
  if (code === 143 || code === 248 || code === 260) return '🌫️'
  if (code >= 386) return '⛈️'
  if (code >= 338) return '❄️'
  if (code >= 227 && code <= 284) return '🌨️'
  if (code >= 176) return '🌧️'
  return '🌤️'
}

export function greetingFor(hour, name) {
  let g = '안녕하세요!'
  if (hour >= 5 && hour < 12) g = '좋은 아침이에요'
  else if (hour >= 12 && hour < 18) g = '좋은 오후예요'
  else if (hour >= 18 && hour < 22) g = '좋은 저녁이에요'
  else g = '좋은 밤이에요'
  const n = (name || '').trim()
  return n ? `${n}님, ${g}` : g
}

// A stable key for a given day, used for the diaries map.
export function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
