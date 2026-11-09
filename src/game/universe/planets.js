/**
 * 행성 실제 위치 (NASA JPL "Keplerian Elements for Approximate Positions of the Major Planets", 1800–2050)
 * 좌표: 태양 중심 황도 좌표계, 단위 AU. x = 춘분점 방향, y = 황경 90°, z = 황도 북쪽
 * 정확도: 내행성 수 각분, 외행성 0.1° 이내 — 시각화에 충분
 */
const DEG = Math.PI / 180

// [a, e, I, L, 근일점경도 ϖ, 승교점경도 Ω] 와 세기당 변화율
const ELEMENTS = {
  수성: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  금성: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  지구: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  화성: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  목성: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  토성: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  천왕성: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  해왕성: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
}
export const PLANET_NAMES = Object.keys(ELEMENTS)
const GM_SUN = 1.32712440018e20 // m³/s²
const AU_M = 1.495978707e11
// 공전 주기(일) — 표시용
export const PERIOD_DAYS = { 수성: 87.97, 금성: 224.7, 지구: 365.26, 화성: 686.98, 목성: 4332.6, 토성: 10759, 천왕성: 30687, 해왕성: 60190 }

const centuries = (date) => (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525

function elementsAt(name, T) {
  const [e0, r] = ELEMENTS[name]
  const [a, e, I, L, wbar, O] = e0.map((v, i) => v + r[i] * T)
  return { a, e, I: I * DEG, L, wbar, O: O * DEG }
}

function solveKepler(M, e) {
  let E = M + e * Math.sin(M)
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
  return E
}

// 궤도면 좌표(x', y') → 황도 좌표
function toEcliptic(xp, yp, w, O, I) {
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I)
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ]
}

/** 날짜의 행성 위치 { 이름: { pos:[x,y,z] AU, r AU, speed m/s } } */
export function planetPositions(date = new Date()) {
  const T = centuries(date)
  const out = {}
  for (const name of PLANET_NAMES) {
    const { a, e, I, L, wbar, O } = elementsAt(name, T)
    const w = wbar * DEG - O
    let M = ((((L - wbar) % 360) + 540) % 360 - 180) * DEG
    const E = solveKepler(M, e)
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E)
    const pos = toEcliptic(xp, yp, w, O, I)
    const r = Math.hypot(...pos)
    const speed = Math.sqrt(GM_SUN * (2 / (r * AU_M) - 1 / (a * AU_M)))
    out[name] = { pos, r, speed }
  }
  return out
}

/** 궤도 타원 점들 (AU, 황도면) */
export function orbitPoints(name, date = new Date(), n = 160) {
  const { a, e, I, wbar, O } = elementsAt(name, centuries(date))
  const w = wbar * DEG - O
  const pts = []
  for (let i = 0; i <= n; i++) {
    const E = (i / n) * Math.PI * 2
    pts.push(toEcliptic(a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E), w, O, I))
  }
  return pts
}

/** 오늘 지구의 공전·계절 정보 (북반구 기준) */
export function earthSeason(date = new Date()) {
  const p = planetPositions(date).지구
  // 지구에서 본 태양의 황경 = 지구 일심 황경 + 180°
  const helioLon = Math.atan2(p.pos[1], p.pos[0]) / DEG
  const sunLon = (((helioLon + 180) % 360) + 360) % 360
  const seasons = ['봄', '여름', '가을', '겨울']
  const season = seasons[Math.floor(sunLon / 90)]
  const marks = [[0, '춘분'], [90, '하지'], [180, '추분'], [270, '동지']]
  const rate = 0.98565 // 하루에 황경 약 0.9856°
  let next = null
  for (const [lon, label] of marks) {
    const d = ((((lon - sunLon) % 360) + 360) % 360) / rate
    if (d > 0.5 && (!next || d < next.days)) next = { label, days: Math.round(d) }
  }
  // 근일점: 태양 황경 약 282.9° (1월 초), 원일점: 102.9° (7월 초)
  const toPeri = Math.round(((((282.94 - sunLon) % 360) + 360) % 360) / rate)
  const toAph = Math.round(((((102.94 - sunLon) % 360) + 360) % 360) / rate)
  return { distKm: p.r * AU_M / 1000, speedKms: p.speed / 1000, sunLon, season, next, toPeri, toAph }
}
