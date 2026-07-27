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
  {
    k: 'starnight', name: '밤하늘',
    css: scenery('https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1920&q=80'),
  },
  {
    k: 'galaxy', name: '은하수',
    css: scenery('https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?auto=format&fit=crop&w=1920&q=80'),
  },
  {
    k: 'city', name: '도시',
    css: scenery('https://images.unsplash.com/photo-1449824913935-59a10b8d2000?auto=format&fit=crop&w=1920&q=80'),
  },
  {
    k: 'blossom', name: '벚꽃',
    css: scenery('https://images.unsplash.com/photo-1522383225653-ed111181a951?auto=format&fit=crop&w=1920&q=80'),
  },
  {
    k: 'desert', name: '사막',
    css: scenery('https://images.unsplash.com/photo-1509316785289-025f5b846b35?auto=format&fit=crop&w=1920&q=80'),
  },
  {
    k: 'waterfall', name: '폭포',
    css: scenery('https://images.unsplash.com/photo-1432405972618-c60b0225b8f9?auto=format&fit=crop&w=1920&q=80'),
  },
  {
    k: 'valley', name: '계곡',
    css: scenery('https://images.unsplash.com/photo-1426604966848-d7adac402bff?auto=format&fit=crop&w=1920&q=80'),
  },
  {
    k: 'hills', name: '언덕',
    css: scenery('https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&w=1920&q=80'),
  },
  {
    k: 'forestpath', name: '숲길',
    css: scenery('https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?auto=format&fit=crop&w=1920&q=80'),
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

// 공지사항 — 최신 항목을 배열 맨 위에 추가하세요.
export const NOTICES = [
  {
    date: '2026-07-28',
    title: '게임 스테이지 · 로그인 유지 개선',
    body: [
      '• 게임에 스테이지가 생겼어요. 적을 처치할수록 다음 스테이지로 올라갑니다',
      '• 이제 적이 끝없이 나와요. 쓰러뜨려도 잠시 뒤 다시 몰려옵니다',
      '• 스테이지가 오를수록 적이 강해지고, 한 번에 덤비는 수도 늘어나요',
      '• 화면 왼쪽 위에서 현재 스테이지와 다음 단계까지 남은 수를 볼 수 있어요',
      '',
      '• 자리를 오래 비워도 로그인이 유지돼요. 앱을 쓰는 동안엔 끊기지 않습니다',
      '• 로그아웃된 경우 안내가 뜨고, 쓰던 할 일 내용도 그대로 남아요',
    ].join('\n'),
  },
  {
    date: '2026-07-27',
    title: '약속 알림 기능 추가',
    body: [
      '• 시간을 정해둔 할 일이 다가오면 폰으로 알림을 보내드려요',
      '• 설정(⚙) → 약속 알림에서 켤 수 있어요',
      '• 미리 알림 시간은 5분 · 10분 · 30분 전 중에 고를 수 있어요',
      '• 앱을 꺼놔도 알림이 도착해요',
      '• 아이폰은 공유 → "홈 화면에 추가"로 설치한 뒤에 켤 수 있어요 (애플 정책)',
    ].join('\n'),
  },
  {
    date: '2026-07-24',
    title: '모바일 · 게임 업데이트',
    body: [
      '• 게임에 매직완드 아이템 추가 (획득 시 자동으로 마법 미사일 발사, 중첩 시 강화)',
      '• 모바일에서도 게임 플레이 가능 (왼쪽 조이스틱 이동 · 화면 드래그 시점 · 공격/구르기/질주 버튼)',
      '• 아이폰 음악 재생 문제 개선 (재생 정책에 맞춰 플레이어 표시 방식 변경)',
      '• 카카오톡 등 인앱 브라우저에서 로그인·저장이 안 되던 문제 해결',
      '• 모바일 화면에서 입력창·목록 음영 및 레이아웃 정리',
    ].join('\n'),
  },
  {
    date: '2026-07-23',
    title: '이번 업데이트 안내',
    body: [
      '• 할 일 수정 기능 추가 (더블클릭 또는 ✎)',
      '• 할 일에 시간·장소 옵션 추가',
      '• 메모 크기 조절 가능',
      '• 메모 날짜별 표시 + 고정(📌) 기능',
      '• 상단에 음악 플레이어 추가 (YouTube)',
      '• 공지사항 기능 추가',
    ].join('\n'),
  },
]
