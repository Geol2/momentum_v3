// 우주 탐험 — universe-explorer.js에서 분리한 모듈 (동작 동일)
import { planetPositions } from './planets.js';
import { eqToEcl } from './exoplanets.js';

// ───────────────────────── 단위 / 상수 ─────────────────────────
const LY = 9.4607e15;          // 1광년 (m)
const AU = 1.496e11;           // 1천문단위 (m)
const MLY = 1e6 * LY;          // 100만 광년
const R_OBS = 46.5e9 * LY;     // 관측 가능한 우주 반지름
const C = 2.998e8;             // 빛의 속도
const DEG = Math.PI / 180;

// s = log10(화면 짧은 변이 담는 실제 길이, m)
const S_MIN = 3.8;   // 약 6 km (동네까지 확대 — 위성 타일 10m 해상도)
const S_MAX = 27.35; // 관측 가능한 우주 지름의 약 2.5배
const S_START = 7.45;

// ───────────────────────── 유틸 ─────────────────────────
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const band = (s, a, b, soft = 0.5) =>
  smooth(a - soft, a + soft, s) * (1 - smooth(b - soft, b + soft, s));
const P = (r, a, o = [0, 0]) => [o[0] + r * Math.cos(a), o[1] + r * Math.sin(a)];
const lerp2 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const scale2 = (p, k) => [p[0] * k, p[1] * k];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────── 월드 기준점 (지구 = 원점) ─────────────────────────
// 오늘 날짜의 실제 행성 배치 (지구 = 원점, 황도면을 위에서 내려다봄: x = 춘분점 방향)
const TODAY = new Date();
const PLANET_POS = planetPositions(TODAY);
const SUN = [-PLANET_POS.지구.pos[0] * AU, -PLANET_POS.지구.pos[1] * AU];
// 실제 하늘 위치(적경·적위)·거리 → 황도면 투영 월드 좌표 (태양 기준). distM: 미터
function skyPosM(raDeg, decDeg, distM) {
  const { lam, beta } = eqToEcl(raDeg, decDeg);
  const d = distM * Math.cos(beta);
  return [SUN[0] + d * Math.cos(lam), SUN[1] + d * Math.sin(lam)];
}
const MOON = P(3.844e8, 0.6);
// 은하 규모 기준점도 실제 하늘 방향(적경·적위)·거리로 배치 → 별·성운과 같은 좌표계
const GC = skyPosM(266.417, -29.008, 26670 * LY);      // 우리은하 중심 (궁수자리 A*)
const ANDROMEDA = skyPosM(10.685, 41.269, 2.5 * MLY);
const M33 = skyPosM(23.462, 30.660, 2.73 * MLY);
const LMC = skyPosM(80.894, -69.756, 160e3 * LY);
const SMC = skyPosM(13.187, -72.829, 200e3 * LY);
const LG_CENTER = scale2(ANDROMEDA, 0.45);
const VIRGO = skyPosM(187.706, 12.391, 54 * MLY);       // 처녀자리 은하단 (M87)
const GA = skyPosM(243.590, -60.870, 220 * MLY);        // 거대 인력체 (직각자자리 은하단 부근)
const LANI = scale2(GA, 0.82);              // 라니아케아 중심(대략)

// 카메라 초점 키프레임 [s, 초점]. 같은 점이 연속이면 그 구간은 고정.
const CAM_KEYS = [
  [11.6, [0, 0]], [12.6, SUN],
  [20.8, SUN], [21.6, GC],
  [22.4, GC], [23.2, LG_CENTER],
  [23.8, LG_CENTER], [24.4, scale2(VIRGO, 0.5)],
  [24.6, scale2(VIRGO, 0.5)], [25.2, scale2(LANI, 0.7)],
  [25.8, scale2(LANI, 0.7)], [26.6, [0, 0]],
];
function camAt(s) {
  if (s <= CAM_KEYS[0][0]) return CAM_KEYS[0][1];
  for (let i = 0; i < CAM_KEYS.length - 1; i++) {
    const [s0, p0] = CAM_KEYS[i];
    const [s1, p1] = CAM_KEYS[i + 1];
    if (s <= s1) return lerp2(p0, p1, smooth(s0, s1, s));
  }
  return CAM_KEYS[CAM_KEYS.length - 1][1];
}

// ───────────────────────── 발견 단계 ─────────────────────────
const LEVELS = [
  { id: 'earth', at: -Infinity, name: '지구', addr: '지구', desc: '지름 12,742km. 우리가 사는 파란 행성.' },
  { id: 'moon', at: 9.0, name: '달', desc: '지구에서 약 38만 km. 빛으로 1.3초 거리.' },
  { id: 'solar', at: 12.4, name: '태양계', addr: '태양계', desc: '태양에서 해왕성까지 약 45억 km. 빛으로 약 4시간.' },
  { id: 'helio', at: 14.3, name: '태양권', desc: '태양풍이 닿는 경계(약 120 AU). 보이저 1호가 2012년에 넘어섰어요.' },
  { id: 'oort', at: 16.3, name: '오르트 구름', desc: '혜성의 고향으로 추정되는 얼음 천체 무리. 최대 약 10만 AU까지.' },
  { id: 'stars', at: 17.4, name: '이웃 별들', desc: '가장 가까운 별 프록시마 센타우리까지 4.24광년.' },
  { id: 'mw', at: 20.9, name: '우리은하', addr: '우리은하', desc: '지름 약 10만 광년, 별 1000억~4000억 개. 태양은 중심에서 약 2.6만 광년.' },
  { id: 'lg', at: 22.8, name: '국부은하군', addr: '국부은하군', desc: '은하 수십 개의 무리. 이웃 안드로메다 은하까지 250만 광년.' },
  { id: 'virgo', at: 24.0, name: '처녀자리 초은하단', addr: '처녀자리 초은하단', desc: '지름 약 1억 1천만 광년. 처녀자리 은하단까지 약 5400만 광년.' },
  { id: 'lani', at: 25.05, name: '라니아케아 초은하단', addr: '라니아케아', desc: '지름 약 5억 2천만 광년, 은하 약 10만 개. 하와이어로 "헤아릴 수 없는 하늘".' },
  { id: 'web', at: 26.1, name: '코스믹 웹', addr: '코스믹 웹', desc: '초은하단이 실처럼 이어지고, 그 사이엔 텅 빈 보이드가 펼쳐져요.' },
  { id: 'obs', at: 27.0, name: '관측 가능한 우주', addr: '관측 가능한 우주', desc: '반지름 약 465억 광년. 그리고 그 중심은… 언제나 관측자, 바로 여기.' },
];

export { LY, AU, MLY, R_OBS, C, DEG, S_MIN, S_MAX, S_START, clamp, smooth, band, P, lerp2, scale2, mulberry32, TODAY, PLANET_POS, SUN, skyPosM, MOON, GC, ANDROMEDA, M33, LMC, SMC, LG_CENTER, VIRGO, GA, LANI, CAM_KEYS, camAt, LEVELS };
