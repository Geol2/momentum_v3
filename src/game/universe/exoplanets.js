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
    view: 0.075, catalog: 'Alpha Centauri', id: 'proxima', name: '프록시마 센타우리', ra: 217.429, dec: -62.68, distLy: 4.246,
    star: { type: 'M5.5 적색왜성', radiusSun: 0.154, tempK: 3042, color: '255,140,90' },
    hz: [0.042, 0.082], compare: { label: '태양계라면 수성 궤도', au: 0.387 }, speed: 3600,
    desc: '태양에서 가장 가까운 별. 생명 가능 지대에 지구만 한 행성 b가 돌아요. 빛으로 4년 3개월.',
    planets: [
      { name: '프록시마 d', au: 0.02885, days: 5.122, re: 0.8, color: ROCKY, note: '질량 지구의 약 1/4' },
      { name: '프록시마 b', au: 0.04857, days: 11.186, re: 1.07, color: HZ, note: '지구와 비슷한 질량, 생명 가능 지대' },
    ],
  },
  {
    view: 0.066, catalog: 'TRAPPIST-1', id: 'trappist', name: '트라피스트-1', ra: 346.622, dec: -5.041, distLy: 40.7,
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
    view: 0.42, catalog: '51 Peg', id: '51peg', name: '51 페가시', ra: 344.367, dec: 20.769, distLy: 50.6,
    star: { type: 'G2 태양형 별', radiusSun: 1.15, tempK: 5768, color: '255,236,190' },
    hz: [1.1, 2.0], compare: { label: '태양계라면 수성 궤도', au: 0.387 }, speed: 3600,
    desc: '1995년 태양 같은 별에서 처음 확인된 외계행성(노벨상). 목성급 행성이 4일마다 별을 한 바퀴 — "뜨거운 목성".',
    planets: [
      { name: '디미디움 (51 Peg b)', au: 0.0527, days: 4.2308, re: 13.4, color: HOT, note: '목성 질량의 약 절반, 표면 1000°C 이상' },
    ],
  },
  {
    view: 72, catalog: 'HR 8799', id: 'hr8799', name: 'HR 8799', ra: 346.87, dec: 21.134, distLy: 134.7,
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
    view: 1.25, catalog: 'Kepler-90', id: 'kepler90', name: '케플러-90', ra: 284.433, dec: 49.305, distLy: 2800,
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

// ───────── 전체 카탈로그 (Open Exoplanet Catalogue, MIT) ─────────
// 행: [이름, 적경°, 적위°, 거리(광년), 별온도K, 별반지름(태양=1), 분광형, 행성들]
// 행성: [접미사, 궤도반지름AU, 주기(일), 반지름(지구=1)|null, 통과시각JD|null, 발견방법, 발견연도, 평형온도K|null]
const METHOD_KO = { T: '통과(트랜짓)', R: '시선속도', I: '직접 촬영', M: '미세중력렌즈', P: '펄서 타이밍', A: '위치 측정', D: '원반 운동' }

/** 별 온도 → 색 'r,g,b' */
export function teffColor(t) {
  if (!t) return '255,236,200'
  if (t < 3200) return '255,130,85'
  if (t < 4000) return '255,170,110'
  if (t < 5200) return '255,210,150'
  if (t < 6000) return '255,240,205'
  if (t < 7500) return '240,244,255'
  return '205,220,255'
}
/** 별 → 생명 가능 지대(AU, 보수적 근사) */
export function habitableZone(teff, rSun) {
  const T = teff || 5772, R = rSun || 1
  const L = R * R * (T / 5772) ** 4
  return [Math.sqrt(L / 1.1), Math.sqrt(L / 0.53)]
}
function planetColor(p, hz) {
  if (p.teq && p.teq > 900) return HOT
  if (p.au >= hz[0] && p.au <= hz[1] && (!p.re || p.re < 2.5)) return HZ
  if (p.re && p.re > 6) return GIANT
  if (p.re && p.re > 1.9) return ICE
  return ROCKY
}
function spectralKo(sp, t) {
  const c = (sp || '').trim()[0]
  const map = { M: '적색왜성(M형)', K: '주황색 별(K형)', G: '태양형 별(G형)', F: '노란 흰색 별(F형)', A: '흰색 별(A형)', B: '청백색 별(B형)', O: '청색 거성(O형)' }
  if (map[c]) return map[c]
  if (!t) return '별'
  return t < 3900 ? '적색왜성' : t < 5300 ? '주황색 별' : t < 6000 ? '태양형 별' : t < 7500 ? '노란 흰색 별' : '뜨거운 흰색 별'
}

/** 카탈로그 행 → 행성계 모델 */
export function catalogToSystem(row) {
  const [name, ra, dec, distLy, teff, rSun, sp, pls] = row
  const hz = habitableZone(teff, rSun)
  const planets = pls.map(([suf, au, days, re, t0, m, yr, teq]) => {
    const p = { name: suf, au, days, re: re || 1, reKnown: !!re, t0, method: m, year: yr, teq }
    p.color = planetColor(p, hz)
    return p
  })
  const maxA = Math.max(...planets.map((p) => p.au))
  const minP = Math.min(...planets.map((p) => p.days))
  const nHz = planets.filter((p) => p.color === HZ).length
  const years = [...new Set(planets.map((p) => p.year).filter(Boolean))].sort()
  const methods = [...new Set(planets.map((p) => METHOD_KO[p.method]).filter(Boolean))]
  const cmp = [[0.387, '수성'], [1, '지구'], [5.2, '목성'], [30.07, '해왕성']]
  const pick = cmp.filter(([au]) => au <= maxA * 1.15).pop() || cmp[0]
  const speeds = [1, 3600, 86400, 86400 * 365.25]
  const speed = speeds.find((k) => (minP * 86400) / k <= 90) || speeds[3]
  const yearTxt = years.length ? (years.length > 1 ? `${years[0]}~${years[years.length - 1]}년` : `${years[0]}년`) : ''
  return {
    id: 'cat:' + name, name, catalogName: name, ra, dec, distLy,
    star: { type: spectralKo(sp, teff) + (teff ? ` · ${Math.round(teff).toLocaleString('ko-KR')}K` : ''), radiusSun: rSun || 1, tempK: teff, color: teffColor(teff) },
    hz, compare: { label: `태양계라면 ${pick[1]} 궤도`, au: pick[0] }, speed, view: Math.max(maxA * 1.12, 0.004),
    desc: `행성 ${planets.length}개${nHz ? ` · 생명 가능 지대 후보 ${nHz}개` : ''}${yearTxt ? ` · ${yearTxt} 발견` : ''}${methods.length ? ` (${methods.join('·')})` : ''}.`,
    planets,
  }
}

/** 추천 행성계(설명 포함)에 카탈로그의 통과 시각을 붙인다 */
export function linkFeatured(byName) {
  for (const sys of SYSTEMS) {
    const row = byName.get(sys.catalog)
    if (!row) continue
    for (const p of sys.planets) {
      const suf = p.name.replace(/^.*\s/, '')
      const hit = row[7].find(([s]) => s === p.name || s === suf || s.endsWith(' ' + suf))
      if (hit && hit[4]) p.t0 = hit[4]
    }
  }
}

/**
 * 행성계의 행성 상태 (moonStates 와 같은 모양)
 * toEarth: 별에서 지구(태양) 쪽 방향각 — 통과 시각이 있으면 "통과 순간 = 지구 쪽"으로 실제 위치 계산
 */
export function exoStates(sys, date = new Date(), toEarth = 0) {
  const jd = date.getTime() / 86400000 + 2440587.5
  const days = jd - 2451545.0
  return sys.planets.map((p) => {
    const exact = !!p.t0
    const angle = exact ? toEarth + (2 * Math.PI * (jd - p.t0)) / p.days : hashPhase(sys.id + p.name) + (2 * Math.PI * days) / p.days
    const full = p.name.length <= 3 ? `${sys.name} ${p.name}` : p.name
    return {
      name: full, short: p.name.length <= 3 ? p.name : p.name.replace(sys.name, '').trim() || p.name,
      distKm: p.au * 1.495978707e8, au: p.au, radiusKm: (p.re || 1) * 6371, re: p.re, reKnown: p.reKnown !== false,
      color: p.color, note: p.note, angle, periodDays: p.days, exact, teq: p.teq,
    }
  })
}
