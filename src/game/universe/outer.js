/**
 * 바깥 태양계: 왜행성 · 먼 탐사선 (시각화용 근사)
 *  - 명왕성: JPL 궤도 요소(3000BC–3000AD)로 실제 위치
 *  - 에리스·세드나·마케마케·하우메아: 2026년 무렵 하늘 위치·거리(근사, 수십 년 동안 거의 안 움직임)
 *  - 탐사선: 2025-01-01 기준 위치 + 연간 이동 거리로 오늘 거리 추정
 */
const DEG = Math.PI / 180

export function plutoHelio(date = new Date()) {
  const T = (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525
  const a = 39.48211675 - 0.00031596 * T, e = 0.2488273 + 0.0000517 * T
  const I = (17.14001206 + 0.00004818 * T) * DEG
  const L = 238.92903833 + 145.20780515 * T, wbar = 224.06891629 - 0.04062942 * T, O = (110.30393684 - 0.01183482 * T) * DEG
  const w = wbar * DEG - O
  const M = ((((L - wbar) % 360) + 540) % 360 - 180) * DEG
  let E = M + e * Math.sin(M)
  for (let i = 0; i < 10; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E)
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I)
  const x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp
  const y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp
  // 궤도선
  const path = []
  for (let k = 0; k <= 160; k++) {
    const EE = (k / 160) * Math.PI * 2
    const xx = a * (Math.cos(EE) - e), yy = a * Math.sqrt(1 - e * e) * Math.sin(EE)
    path.push([(cw * cO - sw * sO * cI) * xx + (-sw * cO - cw * sO * cI) * yy, (cw * sO + sw * cO * cI) * xx + (-sw * sO + cw * cO * cI) * yy])
  }
  return { pos: [x, y], r: Math.hypot(x, y), path }
}

// [이름, 적경°, 적위°, 거리 AU, 설명]
export const DWARFS = [
  ['에리스', 26.5, -1.7, 95.9, '명왕성보다 무거운 왜행성. 명왕성이 "행성"에서 빠지는 계기가 됐어요.'],
  ['세드나', 53.0, 7.9, 83.5, '태양에서 76~900 AU를 오가는 아주 길쭉한 궤도. 한 바퀴에 약 1만 1천 년.'],
  ['마케마케', 195.0, 25.0, 52.6, '카이퍼 벨트의 붉은 왜행성.'],
  ['하우메아', 215.0, 15.0, 49.5, '4시간마다 한 바퀴 도는 럭비공 모양 왜행성.'],
]

// [이름, 적경°, 적위°, 2025.0 거리 AU, 연간 AU, 설명, 교신 중]
export const PROBES = [
  ['보이저 1호', 258.3, 12.0, 164.6, 3.58, '1977년 발사. 인류가 만든 가장 먼 물체. 2012년 태양권을 벗어났어요.', true],
  ['보이저 2호', 301.4, -58.6, 137.6, 3.22, '1977년 발사. 목성·토성·천왕성·해왕성을 모두 지나간 유일한 탐사선.', true],
  ['뉴호라이즌스', 289.0, -20.3, 60.8, 2.86, '2015년 명왕성을 처음 근접 촬영.', true],
  ['파이어니어 10호', 77.4, 26.0, 136.0, 2.5, '1972년 발사. 2003년 교신 종료.', false],
  ['파이어니어 11호', 284.0, -8.5, 115.0, 2.35, '1973년 발사. 1995년 교신 종료.', false],
]

export function probeDistanceAU(base, perYear, date = new Date()) {
  const years = (date.getTime() - Date.UTC(2025, 0, 1)) / (365.25 * 86400000)
  return base + perYear * years
}
