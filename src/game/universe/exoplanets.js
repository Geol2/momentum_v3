/**
 * 이웃 행성계 5곳 (NASA Exoplanet Archive 등 공개 값 기준, 일부 반올림)
 *  - 하늘 위치(적경·적위)·거리는 실제 → 황도면에 투영해 배치
 *  - 행성 궤도 반지름·공전 주기·크기는 실제, 궤도 위 현재 위치는 근사
 */
const DEG = Math.PI / 180
const EPS = 23.4393 * DEG

/** 적경·적위(도) → 황경·황위(라디안) */
export function eqToEcl(raDeg, decDeg) {
  const a = raDeg * DEG, d = decDeg * DEG
  const lam = Math.atan2(Math.sin(a) * Math.cos(EPS) + Math.tan(d) * Math.sin(EPS), Math.cos(a))
  const beta = Math.asin(Math.sin(d) * Math.cos(EPS) - Math.cos(d) * Math.sin(EPS) * Math.sin(a))
  return { lam, beta }
}

const ROCKY = '#c9a27e', HZ = '#6fc3a8', ICE = '#9fc6e8', GIANT = '#d8b48a', HOT = '#ff9a5c'

export const SYSTEMS = [
  {
    view: 0.075, id: 'proxima', name: '프록시마 센타우리', ra: 217.429, dec: -62.68, distLy: 4.246,
    star: { type: 'M5.5 적색왜성', radiusSun: 0.154, tempK: 3042, color: '255,140,90' },
    hz: [0.042, 0.082], compare: { label: '태양계라면 수성 궤도', au: 0.387 }, speed: 3600,
    desc: '태양에서 가장 가까운 별. 생명 가능 지대에 지구만 한 행성 b가 돌아요. 빛으로 4년 3개월.',
    planets: [
      { name: '프록시마 d', au: 0.02885, days: 5.122, re: 0.8, color: ROCKY, note: '질량 지구의 약 1/4' },
      { name: '프록시마 b', au: 0.04857, days: 11.186, re: 1.07, color: HZ, note: '지구와 비슷한 질량, 생명 가능 지대' },
    ],
  },
  {
    view: 0.066, id: 'trappist', name: '트라피스트-1', ra: 346.622, dec: -5.041, distLy: 40.7,
    star: { type: 'M8 초저온 적색왜성', radiusSun: 0.119, tempK: 2566, color: '255,120,80' },
    hz: [0.024, 0.049], compare: { label: '태양계라면 수성 궤도', au: 0.387 }, speed: 3600,
    desc: '목성만 한 작은 별에 지구 크기 행성 7개가 수성 궤도보다 훨씬 안쪽에 촘촘히 돌아요. e·f·g는 생명 가능 지대.',
    planets: [
      { name: 'b', au: 0.01154, days: 1.5109, re: 1.116, color: HOT },
      { name: 'c', au: 0.0158, days: 2.4218, re: 1.097, color: ROCKY },
      { name: 'd', au: 0.02227, days: 4.0496, re: 0.788, color: ROCKY },
      { name: 'e', au: 0.02925, days: 6.0996, re: 0.92, color: HZ, note: '생명 가능 지대' },
      { name: 'f', au: 0.03849, days: 9.2067, re: 1.045, color: HZ, note: '생명 가능 지대' },
      { name: 'g', au: 0.04683, days: 12.3529, re: 1.129, color: HZ, note: '생명 가능 지대' },
      { name: 'h', au: 0.06189, days: 18.7673, re: 0.755, color: ICE },
    ],
  },
  {
    view: 0.42, id: '51peg', name: '51 페가시', ra: 344.367, dec: 20.769, distLy: 50.6,
    star: { type: 'G2 태양형 별', radiusSun: 1.15, tempK: 5768, color: '255,236,190' },
    hz: [1.1, 2.0], compare: { label: '태양계라면 수성 궤도', au: 0.387 }, speed: 3600,
    desc: '1995년 태양 같은 별에서 처음 확인된 외계행성(노벨상). 목성급 행성이 4일마다 별을 한 바퀴 — "뜨거운 목성".',
    planets: [
      { name: '디미디움 (51 Peg b)', au: 0.0527, days: 4.2308, re: 13.4, color: HOT, note: '목성 질량의 약 절반, 표면 1000°C 이상' },
    ],
  },
  {
    view: 72, id: 'hr8799', name: 'HR 8799', ra: 346.87, dec: 21.134, distLy: 134.7,
    star: { type: 'A5 젊은 별(약 3천만 살)', radiusSun: 1.44, tempK: 7430, color: '220,232,255' },
    hz: [3.5, 7.0], compare: { label: '태양계라면 해왕성 궤도', au: 30.07 }, speed: 86400 * 365.25,
    desc: '행성 4개를 망원경으로 직접 찍은 행성계. 모두 목성보다 5~10배 무거운 거대 가스 행성이에요.',
    planets: [
      { name: 'e', au: 16.4, days: 45 * 365.25, re: 13, color: GIANT, note: '목성 질량의 약 7배' },
      { name: 'd', au: 26.7, days: 100 * 365.25, re: 13, color: GIANT, note: '목성 질량의 약 9배' },
      { name: 'c', au: 41, days: 190 * 365.25, re: 13, color: GIANT, note: '목성 질량의 약 8배' },
      { name: 'b', au: 68, days: 460 * 365.25, re: 13, color: GIANT, note: '목성 질량의 약 6배' },
    ],
  },
  {
    view: 1.25, id: 'kepler90', name: '케플러-90', ra: 284.433, dec: 49.305, distLy: 2800,
    star: { type: 'G0 태양형 별', radiusSun: 1.2, tempK: 6080, color: '255,240,210' },
    hz: [1.0, 1.9], compare: { label: '태양계라면 지구 궤도', au: 1.0 }, speed: 86400,
    desc: '행성이 8개 — 우리 태양계와 개수가 같은 행성계. 안쪽은 작은 암석 행성, 바깥은 거대 행성인 것도 닮았어요(다만 모두 지구 궤도 안쪽).',
    planets: [
      { name: 'b', au: 0.074, days: 7.008, re: 1.31, color: HOT },
      { name: 'c', au: 0.089, days: 8.719, re: 1.18, color: HOT },
      { name: 'i', au: 0.107, days: 14.449, re: 1.32, color: ROCKY, note: '2017년 구글 AI가 찾아낸 행성' },
      { name: 'd', au: 0.32, days: 59.737, re: 2.88, color: ICE },
      { name: 'e', au: 0.42, days: 91.939, re: 2.67, color: ICE },
      { name: 'f', au: 0.48, days: 124.914, re: 2.89, color: ICE },
      { name: 'g', au: 0.71, days: 210.607, re: 8.13, color: GIANT },
      { name: 'h', au: 1.01, days: 331.601, re: 11.32, color: GIANT, note: '지구 궤도와 비슷한 거리의 거대 행성' },
    ],
  },
]

const hashPhase = (s) => {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h >>> 0) / 4294967296) * Math.PI * 2
}

/** 행성계의 행성 상태 (moonStates 와 같은 모양) */
export function exoStates(sys, date = new Date()) {
  const days = date.getTime() / 86400000 + 2440587.5 - 2451545.0
  return sys.planets.map((p) => ({
    name: p.name.length <= 2 ? `${sys.name} ${p.name}` : p.name,
    short: p.name,
    distKm: p.au * 1.495978707e8,
    au: p.au,
    radiusKm: p.re * 6371,
    re: p.re,
    color: p.color,
    note: p.note,
    angle: hashPhase(sys.id + p.name) + (2 * Math.PI * days) / p.days,
    periodDays: p.days,
    exact: false,
  }))
}
