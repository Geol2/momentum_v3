/**
 * 행성별 주요 위성
 *  - 거리(km)·공전 주기(일)·반지름(km)은 실제 값
 *  - 목성 갈릴레이 위성 4개는 Meeus『Astronomical Algorithms』44장 저정밀 식으로 실제 위치(±1° 수준)
 *  - 나머지는 위상 근사(주기는 실제) — 화면에 "위치는 근사"로 안내
 */
import { planetPositions } from './planets.js'

const DEG = Math.PI / 180

// [이름, 궤도반지름 km, 공전주기 일(음수 = 역행), 반지름 km, 색]
export const MOONS = {
  화성: [
    ['포보스', 9376, 0.31891, 11.3, '#a99a8c'],
    ['데이모스', 23463, 1.26244, 6.2, '#b8a898'],
  ],
  목성: [
    ['이오', 421700, 1.769138, 1821.6, '#f2d36b'],
    ['유로파', 671034, 3.551181, 1560.8, '#d9cbb5'],
    ['가니메데', 1070412, 7.154553, 2634.1, '#a99c8a'],
    ['칼리스토', 1882709, 16.689018, 2410.3, '#7d7366'],
  ],
  토성: [
    ['미마스', 185539, 0.942422, 198.2, '#cfcfcf'],
    ['엔켈라두스', 237948, 1.370218, 252.1, '#f4f8ff'],
    ['테티스', 294619, 1.887802, 531.1, '#e2e2e2'],
    ['디오네', 377396, 2.736915, 561.4, '#d6d6d6'],
    ['레아', 527108, 4.518212, 763.8, '#cccccc'],
    ['타이탄', 1221870, 15.945421, 2574.7, '#e0a855'],
    ['이아페투스', 3560820, 79.3215, 734.5, '#9b8f80'],
  ],
  천왕성: [
    ['미란다', 129390, 1.413479, 235.8, '#c4c8cc'],
    ['아리엘', 191020, 2.520379, 578.9, '#d0d4d8'],
    ['움브리엘', 266000, 4.144177, 584.7, '#8e9296'],
    ['티타니아', 435910, 8.705872, 788.4, '#c2c0bc'],
    ['오베론', 583520, 13.463239, 761.4, '#aaa59f'],
  ],
  해왕성: [
    ['트리톤', 354759, -5.876854, 1353.4, '#e8d4cc'],
    ['네레이드', 5513818, 360.1362, 170, '#a4a4a4'],
  ],
}

// 행성 정보(반지름 km, 고리 여부, 위성 수 안내)
export const PLANET_INFO = {
  수성: { radiusKm: 2439.7, moons: '위성이 없어요.' },
  금성: { radiusKm: 6051.8, moons: '위성이 없어요. 하루(자전 243일)가 1년(공전 225일)보다 길어요.' },
  화성: { radiusKm: 3389.5, moons: '작은 위성 2개. 포보스는 화성에 점점 가까워져 수천만 년 뒤 부서질 운명이에요.' },
  목성: { radiusKm: 69911, moons: '위성 90개 이상. 갈릴레이 4대 위성은 오늘 실제 위치예요 — 쌍안경으로도 보이는 그 배치!' },
  토성: { radiusKm: 58232, rings: true, moons: '위성 270개 이상. 엔켈라두스는 얼음 아래 바다에서 물기둥을 뿜어요.' },
  천왕성: { radiusKm: 25362, moons: '위성 28개 이상. 자전축이 98° 누워 있어서 위성들도 옆으로 돌아요.' },
  해왕성: { radiusKm: 24622, moons: '위성 16개. 트리톤은 거꾸로(역행) 도는 유일한 큰 위성이에요.' },
}

const hashPhase = (s) => {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h >>> 0) / 4294967296) * Math.PI * 2
}

// 갈릴레이 위성: 지구에서 본 "하합(행성 앞) 기준" 각 u (도)
function galileanU(date) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0
  const V = (172.74 + 0.00111588 * d) * DEG
  const M = (357.529 + 0.9856003 * d) * DEG
  const N = (20.02 + 0.0830853 * d + 0.329 * Math.sin(V)) * DEG
  const J = 66.115 + 0.9025179 * d - 0.329 * Math.sin(V)
  const A = 1.915 * Math.sin(M) + 0.02 * Math.sin(2 * M)
  const B = 5.555 * Math.sin(N) + 0.168 * Math.sin(2 * N)
  const K = (J + A - B) * DEG
  const R = 1.00014 - 0.01671 * Math.cos(M) - 0.00014 * Math.cos(2 * M)
  const r = 5.20872 - 0.25208 * Math.cos(N) - 0.00611 * Math.cos(2 * N)
  const delta = Math.sqrt(r * r + R * R - 2 * r * R * Math.cos(K))
  const psi = Math.asin((R / delta) * Math.sin(K)) / DEG
  const t = d - delta / 173
  return [
    163.8069 + 203.4058646 * t + psi - B,
    358.414 + 101.2916335 * t + psi - B,
    5.7176 + 50.234518 * t + psi - B,
    224.8092 + 21.48798 * t + psi - B,
  ]
}

/**
 * 날짜의 위성 위치. 반환: [{ name, distKm, radiusKm, color, angle(rad, 황도면에서 행성 기준), periodDays, exact }]
 * 각도 기준: 황도 좌표 x축(춘분점 방향)에서 반시계
 */
export function moonStates(planet, date = new Date()) {
  const list = MOONS[planet]
  if (!list) return []
  const days = date.getTime() / 86400000 + 2440587.5 - 2451545.0
  let galilean = null
  if (planet === '목성') {
    const pp = planetPositions(date)
    const j = pp.목성.pos, e = pp.지구.pos
    const toEarth = Math.atan2(e[1] - j[1], e[0] - j[0]) // 목성에서 지구 방향
    galilean = galileanU(date).map((u) => toEarth + u * DEG)
  }
  return list.map(([name, distKm, period, radiusKm, color], i) => {
    const exact = !!galilean
    const angle = exact ? galilean[i] : hashPhase(name) + (2 * Math.PI * days) / period
    return { name, distKm, radiusKm, color, angle, periodDays: Math.abs(period), retro: period < 0, exact }
  })
}
