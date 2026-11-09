/**
 * 간단 천문 계산 (오차 약 0.5~1° 수준 — 시각화용)
 *  - 좌표계: 지구 고정(ECEF) 단위계. x = 경도 0°, y = 경도 90°E, z = 북극. 길이 단위는 지구 반지름.
 */
const DEG = Math.PI / 180
export const EARTH_RADIUS_KM = 6371

const daysJ2000 = (date) => date.getTime() / 86400000 + 2440587.5 - 2451545.0
const gmstDeg = (n) => (((280.46061837 + 360.98564736629 * n) % 360) + 360) % 360

/** 태양의 황경(도) */
function sunEclLon(n) {
  const L = (280.46 + 0.9856474 * n) % 360
  const g = (((357.528 + 0.9856003 * n) % 360) * DEG)
  return L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)
}

/** 황도 좌표(λ, β) → 지구 고정 단위벡터 */
function eclToEcef(lamDeg, betaDeg, n) {
  const eps = (23.439 - 0.0000004 * n) * DEG
  const l = lamDeg * DEG, b = betaDeg * DEG
  const xe = Math.cos(b) * Math.cos(l), ye = Math.cos(b) * Math.sin(l), ze = Math.sin(b)
  const xq = xe
  const yq = ye * Math.cos(eps) - ze * Math.sin(eps)
  const zq = ye * Math.sin(eps) + ze * Math.cos(eps)
  const th = gmstDeg(n) * DEG
  return [xq * Math.cos(th) + yq * Math.sin(th), -xq * Math.sin(th) + yq * Math.cos(th), zq]
}

/** 태양 방향(지구 고정 단위벡터) */
export function sunDirection(date = new Date()) {
  const n = daysJ2000(date)
  return eclToEcef(sunEclLon(n), 0, n)
}

/** 달 위치(지구 고정, 지구 반지름 단위)와 위상 */
export function moonState(date = new Date()) {
  const n = daysJ2000(date)
  const L = 218.316 + 13.176396 * n
  const M = (134.963 + 13.064993 * n) * DEG
  const F = (93.272 + 13.22935 * n) * DEG
  const lam = L + 6.289 * Math.sin(M)
  const beta = 5.128 * Math.sin(F)
  const distKm = 385001 - 20905 * Math.cos(M)
  const u = eclToEcef(lam, beta, n)
  const k = distKm / EARTH_RADIUS_KM
  // 위상: 태양과의 황경 차(이각)
  const elong = ((((lam - sunEclLon(n)) % 360) + 360) % 360)
  const illum = (1 - Math.cos(elong * DEG)) / 2
  const names = ['삭(신월)', '초승달', '상현달', '차오르는 달', '보름달', '기우는 달', '하현달', '그믐달']
  const phase = names[Math.floor(((elong + 22.5) % 360) / 45)]
  // 궤도선: 현재 위치에서 황경을 한 바퀴 돌리며 β 변화 반영
  const orbit = []
  for (let i = 0; i <= 128; i++) {
    const dl = (i / 128) * 360
    const b = 5.128 * Math.sin(F + dl * DEG)
    const p = eclToEcef(lam + dl, b, n)
    orbit.push(p[0] * 60.27, p[1] * 60.27, p[2] * 60.27)
  }
  return { pos: [u[0] * k, u[1] * k, u[2] * k], distKm, illum, phase, elong, orbit }
}
