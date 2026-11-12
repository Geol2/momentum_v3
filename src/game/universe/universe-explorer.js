/**
 * 우리 우주 탐험 — Momentum 숨겨진 게임
 *
 * 지구에서 출발해 관측 가능한 우주 끝까지 줌아웃하며 12개 지점을 발견하는 게임.
 * 의존성 없음 (Vanilla JS + Canvas 2D). 어떤 프레임워크에도 붙일 수 있음.
 *
 *   import { mountUniverseExplorer } from './universe-explorer.js';
 *   const game = mountUniverseExplorer(document.getElementById('host'), {
 *     onClose: () => game.destroy(),
 *     storageKey: 'momentum.universe.v1',
 *   });
 */

import { createEarthRenderer, solarElevation } from './earth.js';
import sdfUrl from './earth-sdf.webp';
import { createEarthGL, canUseWebGL } from './earth-gl.js';
import { planetPositions, orbitPoints, earthSeason, PERIOD_DAYS } from './planets.js';
import { MOONS, PLANET_INFO, moonStates } from './moons.js';
import { SYSTEMS, exoStates, eqToEcl, catalogToSystem, linkFeatured, teffColor } from './exoplanets.js';
import catalogUrl from './exo-catalog.json?url';
import skyUrl from './sky-catalog.json?url';
import { loadDeepStars, deepSpect, starId, bvRgb } from './deep-stars.js';
import { createGaiaTiles, bpColorKo, GAIA_ATTRIB } from './gaia-tiles.js';
import { createSatellites, azKo } from './sats.js';
import { createSound } from './sound.js';
import { photoTitle, getPhoto } from './photos.js';
import { loadSmallBodies, CLASS_KO, CLASS_COL, diamKm, orbitLine, jdNow } from './small-bodies.js';
import { plutoHelio, DWARFS, PROBES, probeDistanceAU } from './outer.js';
import dayUrl from './earth-day.webp';
import reliefUrl from './earth-relief.webp';
import moonUrl from './moon-map.webp';

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

// ───────────────────────── 절차적 데이터 생성 ─────────────────────────
class Cloud {
  constructor() { this.groups = new Map(); }
  add(color, x, y) {
    let g = this.groups.get(color);
    if (!g) { g = []; this.groups.set(color, g); }
    g.push(x, y);
  }
}

function buildWorld(seed = 20261109) {
  const rnd = mulberry32(seed);
  const gauss = () => {
    let u = 0; while (!u) u = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  const inDisk = (R) => P(R * Math.sqrt(rnd()), rnd() * Math.PI * 2);

  // 행성
  const planets = [
    ['수성', 0.387, 2.44e6, '#b9b2a8'], ['금성', 0.723, 6.05e6, '#e8cf9a'],
    ['지구', 1, 6.371e6, '#4a90e2'], ['화성', 1.524, 3.39e6, '#d1603d'],
    ['목성', 5.2, 6.99e7, '#d8b48a'], ['토성', 9.58, 5.82e7, '#e5d29f'],
    ['천왕성', 19.2, 2.54e7, '#9fd8e0'], ['해왕성', 30.05, 2.46e7, '#5b7fe0'],
  ].map(([name, a, r, color]) => {
    const hp = PLANET_POS[name].pos;
    const orbitPath = orbitPoints(name, TODAY).map(([x, y]) => [SUN[0] + x * AU, SUN[1] + y * AU]);
    return { name, orbit: a * AU, r, color, pos: [SUN[0] + hp[0] * AU, SUN[1] + hp[1] * AU], orbitPath };
  });

  // 소행성대 (2.1~3.3 AU)
  const asteroids = new Cloud();
  for (let i = 0; i < 1600; i++) {
    const r = (2.1 + Math.pow(rnd(), 0.8) * 1.2 + gauss() * 0.05) * AU;
    const [x, y] = P(r, rnd() * Math.PI * 2, SUN);
    asteroids.add(rnd() < 0.7 ? 'rgba(190,175,150,0.75)' : 'rgba(150,140,125,0.6)', x, y);
  }
  // 카이퍼 벨트 (고전 벨트 42~48 AU 밀집, 30~50 AU) + 산란 원반(50~150 AU)
  const kuiper = new Cloud();
  for (let i = 0; i < 2600; i++) {
    const core = rnd() < 0.6;
    const r = (core ? 42 + rnd() * 6 : 30 + rnd() * 20) * AU;
    const [x, y] = P(r, rnd() * Math.PI * 2, SUN);
    kuiper.add(core ? 'rgba(170,200,255,0.75)' : 'rgba(150,180,235,0.55)', x, y);
  }
  for (let i = 0; i < 380; i++) {
    const r = (50 + Math.pow(rnd(), 2.2) * 100) * AU;
    const [x, y] = P(r, rnd() * Math.PI * 2, SUN);
    kuiper.add('rgba(160,170,220,0.45)', x, y);
  }
  // 오르트 구름: 내부(힐스 구름, 2천~2만 AU, 더 빽빽) + 외부(2만~10만 AU, 구형, 듬성) + 가장자리(~20만 AU)
  const oort = new Cloud();
  for (let i = 0; i < 2200; i++) {
    const r = Math.pow(10, 3.3 + rnd() * 1.0) * AU;
    const [x, y] = P(r, rnd() * Math.PI * 2, SUN);
    oort.add(rnd() < 0.6 ? 'rgba(160,205,255,0.7)' : 'rgba(210,230,255,0.45)', x, y);
  }
  for (let i = 0; i < 2600; i++) {
    const r = Math.pow(10, 4.3 + rnd() * 0.7) * AU;
    const [x, y] = P(r, rnd() * Math.PI * 2, SUN);
    oort.add(rnd() < 0.5 ? 'rgba(190,215,255,0.45)' : 'rgba(225,235,255,0.3)', x, y);
  }
  for (let i = 0; i < 500; i++) {
    const r = Math.pow(10, 5.0 + rnd() * 0.3) * AU;
    const [x, y] = P(r, rnd() * Math.PI * 2, SUN);
    oort.add('rgba(200,215,255,0.22)', x, y);
  }
  // 장주기 혜성 궤도(근일점 ~1 AU, 원일점 수천~수만 AU)
  const comets = [];
  for (let i = 0; i < 9; i++) {
    const Q = Math.pow(10, 3.5 + rnd() * 1.2) * AU, q = (0.5 + rnd() * 2) * AU;
    const a = (Q + q) / 2, e = (Q - q) / (Q + q), w = rnd() * Math.PI * 2;
    const pts = [];
    for (let k = 0; k <= 200; k++) {
      const E = (k / 200) * Math.PI * 2;
      const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
      pts.push([SUN[0] + xp * Math.cos(w) - yp * Math.sin(w), SUN[1] + xp * Math.sin(w) + yp * Math.cos(w)]);
    }
    comets.push(pts);
  }
  // 명왕성(실제 위치·궤도), 왜행성, 탐사선
  const pl = plutoHelio(TODAY);
  const pluto = { pos: [SUN[0] + pl.pos[0] * AU, SUN[1] + pl.pos[1] * AU], r: pl.r, path: pl.path.map(([x, y]) => [SUN[0] + x * AU, SUN[1] + y * AU]) };
  const dwarfPlanets = DWARFS.map(([name, ra, dec, au, desc]) => ({ name, au, desc, pos: skyPosM(ra, dec, au * AU) }));
  const probes = PROBES.map(([name, ra, dec, base, per, desc, alive]) => {
    const au = probeDistanceAU(base, per, TODAY);
    return { name, au, desc, alive, pos: skyPosM(ra, dec, au * AU) };
  });

  // 이웃 별
  // 실제 하늘 위치(적경·적위)·거리 → 황도면 투영 (태양 기준)
  const skyPos = (raDeg, decDeg, ly) => skyPosM(raDeg, decDeg, ly * LY);
  const systems = SYSTEMS.map((sys) => ({ sys, pos: skyPos(sys.ra, sys.dec, sys.distLy) }));
  // (가짜 무작위 별은 없앰 — 실제 별 목록은 sky-catalog.json 에서 불러옴)

  // 우리은하 (나선팔)
  const galaxy = new Cloud();
  const pitch = Math.tan((13 * Math.PI) / 180);
  for (let i = 0; i < 7000; i++) {
    let x, y, col;
    if (rnd() < 0.17) {
      const bx = gauss() * 4200 * LY, by = gauss() * 2600 * LY, rot = 0.45;
      x = bx * Math.cos(rot) - by * Math.sin(rot);
      y = bx * Math.sin(rot) + by * Math.cos(rot);
      col = rnd() < 0.6 ? 'rgba(255,214,150,0.75)' : 'rgba(255,190,120,0.55)';
    } else {
      const arm = (rnd() * 4) | 0;
      let r = 2500 * LY - Math.log(rnd()) * 12000 * LY;
      if (r > 56000 * LY) r = 2500 * LY + rnd() * 50000 * LY;
      const th = (arm * Math.PI) / 2 + Math.log(r / (2500 * LY)) / pitch + gauss() * 0.17;
      r += gauss() * 900 * LY;
      x = r * Math.cos(th); y = r * Math.sin(th);
      const k = rnd();
      col = k < 0.06 ? 'rgba(255,120,170,0.75)' : k < 0.55 ? 'rgba(170,200,255,0.65)' : 'rgba(235,240,255,0.5)';
    }
    galaxy.add(col, x + GC[0], y + GC[1]);
  }

  // 국부은하군
  const lgGalaxies = [
    { name: '우리은하', pos: GC, r: 50000 * LY, rot: 0.3, ar: 0.9, color: '255,225,190' },
    { name: '안드로메다', pos: ANDROMEDA, r: 110000 * LY, rot: 0.9, ar: 0.35, color: '230,225,255' },
    { name: '삼각형자리 은하', pos: M33, r: 30000 * LY, rot: -0.4, ar: 0.6, color: '200,215,255' },
    { name: '대마젤란 은하', pos: LMC, r: 7000 * LY, rot: 0.2, ar: 0.7, color: '220,230,255', small: true },
    { name: '소마젤란 은하', pos: SMC, r: 3500 * LY, rot: 0.8, ar: 0.6, color: '220,230,255', small: true },
  ];
  // 국부은하군의 실제 위성은하·왜소은하 [이름, 적경, 적위, 거리(천 광년), 설명]
  const lgDwarfs = [
    ['궁수자리 왜소은하', 283.83, -30.55, 70, '우리은하에 잡아먹히는 중인 위성은하'],
    ['큰곰자리 II 왜소은하', 132.87, 63.13, 98, '아주 희미한 초저광도 왜소은하'],
    ['목동자리 I 왜소은하', 210.02, 14.50, 197, '별이 매우 적은 오래된 왜소은하'],
    ['작은곰자리 왜소은하', 227.29, 67.22, 200, '별 생성이 일찍 멈춘 위성은하'],
    ['용자리 왜소은하', 260.06, 57.92, 260, '암흑물질이 아주 많은 위성은하'],
    ['조각가자리 왜소은하', 15.04, -33.71, 290, '1937년 처음 발견된 왜소 타원체 은하'],
    ['육분의자리 왜소은하', 153.26, -1.61, 290, '넓게 퍼진 희미한 위성은하'],
    ['용골자리 왜소은하', 100.40, -50.97, 330, '별 생성이 여러 번 일어난 위성은하'],
    ['컵자리 II 왜소은하', 177.31, -18.41, 380, '2016년 발견 · 크지만 아주 희미함'],
    ['공기펌프자리 2 왜소은하', 143.89, -36.77, 430, '2018년 Gaia로 발견된 유령 같은 은하'],
    ['화로자리 왜소은하', 39.99, -34.45, 460, '구상성단 6개를 거느린 위성은하'],
    ['사자자리 II 왜소은하', 168.37, 22.15, 690, '먼 거리의 위성은하'],
    ['사자자리 I 왜소은하', 152.12, 12.31, 820, '레굴루스 바로 옆에 보이는 은하'],
    ['M32', 10.674, 40.865, 2490, '안드로메다의 작은 타원은하'],
    ['M110', 10.092, 41.685, 2690, '안드로메다의 왜소 타원은하'],
    ['NGC 185', 9.742, 48.337, 2010, '안드로메다의 위성은하'],
    ['NGC 147', 8.300, 48.509, 2530, '안드로메다의 위성은하'],
    ['안드로메다 I', 11.416, 38.04, 2400, '안드로메다의 왜소 타원체 은하'],
    ['안드로메다 II', 19.12, 33.42, 2130, '안드로메다의 왜소 타원체 은하'],
    ['IC 10', 5.07, 59.30, 2200, '국부은하군 유일의 폭발적 별 생성 은하'],
    ['IC 1613', 16.20, 2.12, 2380, '먼지가 거의 없는 왜소 불규칙은하'],
    ['바너드 은하 (NGC 6822)', 296.24, -14.80, 1630, '가까운 왜소 불규칙은하'],
    ['WLM 은하', 0.49, -15.46, 3040, '국부은하군 가장자리의 외톨이 은하'],
    ['봉황자리 왜소은하', 27.78, -44.44, 1440, '왜소 불규칙-타원체 전이형 은하'],
    ['큰부리새자리 왜소은하', 340.46, -64.42, 2870, '고립된 왜소 타원체 은하'],
    ['사자자리 A', 149.86, 30.75, 2600, '아주 어린 별이 많은 왜소은하'],
    ['페가수스 왜소 불규칙은하', 352.15, 14.74, 3000, '국부은하군의 왜소 불규칙은하'],
    ['물병자리 왜소은하', 311.72, -12.85, 3200, '국부은하군 가장자리의 왜소은하'],
    ['육분의자리 A', 152.75, -4.69, 4310, '국부은하군 바로 바깥의 왜소은하'],
  ].map(([name, ra, dec, kly, desc]) => ({ name, desc, ra, dec, ly: kly * 1000, pos: skyPosM(ra, dec, kly * 1000 * LY) }));

  // 실제 은하군·은하단·거대 구조 [이름, 종류, 적경, 적위, 거리(백만 광년), 설명]
  // 종류: grp 은하군, cl 은하단, sc 초은하단, wall 거대 구조, void 보이드, far 가장 먼 천체 (공동 거리)
  const deepSpace = [
    ['마페이 은하군', 'grp', 39.15, 59.65, 9.8, '은하수 먼지 뒤에 숨은 가까운 은하군'],
    ['조각가자리 은하군', 'grp', 11.888, -25.288, 11.4, '조각가자리 은하(NGC 253) 중심의 이웃 은하군'],
    ['M81 은하군', 'grp', 148.888, 69.065, 11.7, 'M81·M82가 서로 당기는 은하군'],
    ['센타우루스 A / M83 은하군', 'grp', 201.365, -43.019, 12, '거대 전파은하 센타우루스 A의 은하군'],
    ['사냥개자리 은하군', 'grp', 192.721, 41.12, 13, 'M94 주변의 느슨한 은하군'],
    ['M101 은하군', 'grp', 210.802, 54.349, 21, '바람개비 은하(M101) 은하군'],
    ['사자자리 I 은하군 (M96)', 'grp', 161.69, 11.82, 35, '사자자리 삼중은하와 이웃한 은하군'],
    ['사자자리 삼중은하', 'grp', 170.06, 12.99, 35, 'M65·M66·NGC 3628'],
    ['처녀자리 은하단', 'cl', 187.706, 12.391, 54, '은하 1300~2000개 · 중심 M87 블랙홀(2019 첫 사진)'],
    ['큰곰자리 은하단', 'cl', 178.9, 53.4, 55, '나선은하가 많은 느슨한 은하단'],
    ['화로자리 은하단', 'cl', 54.62, -35.45, 62, '남쪽 하늘의 가까운 은하단'],
    ['에리다누스 은하군', 'grp', 55.05, -18.58, 75, '화로자리 은하단과 이어진 은하군'],
    ['국부 보이드', 'void', 285, 15, 75, '국부은하군 옆의 텅 빈 공간 · 우리를 밀어냄'],
    ['히드라 은하단', 'cl', 159.18, -27.53, 158, '라니아케아 안의 큰 은하단'],
    ['센타우루스 은하단', 'cl', 192.2, -41.3, 170, '라니아케아 안의 큰 은하단'],
    ['공작-인디언 은하군', 'grp', 304.2, -70.86, 190, '거대 인력체 쪽으로 흘러가는 은하군'],
    ['직각자자리 은하단 (거대 인력체)', 'cl', 243.59, -60.87, 220, '라니아케아 중력의 중심 · 은하수에 가려 있음'],
    ['페르세우스 은하단', 'cl', 49.95, 41.51, 240, '페르세우스-물고기자리 초은하단의 중심 · X선이 가장 밝음'],
    ['사자자리 은하단 (Abell 1367)', 'cl', 176.2, 19.7, 300, '머리털자리 초은하단의 일부'],
    ['머리털자리 은하단', 'cl', 194.95, 27.98, 321, '은하 1000개 이상 · 1933년 암흑물질 첫 단서'],
    ['M87* 블랙홀', 'bh', 187.706, 12.391, 54, '태양 질량 65억 배 · 2019년 인류 최초의 블랙홀 사진 · 탭하면 블랙홀 체험'],
    ['센타우루스 A 블랙홀', 'bh', 201.365, -43.019, 12, '태양 질량 5,500만 배 · 거대한 제트를 뿜는 가장 가까운 전파은하 · 탭하면 블랙홀 체험'],
    ['홈베리 15A 블랙홀', 'bh', 10.46, -9.30, 700, '태양 질량 약 400억 배 — 직접 잰 것 중 최대급 · 탭하면 블랙홀 체험'],
    ['TON 618 블랙홀', 'bh', 187.104, 31.477, 18300, '태양 질량 400억~660억 배 퀘이사 · 빛이 108억 년 걸려 옴(공동 거리 약 183억 광년) · 탭하면 블랙홀 체험'],
    ['IC 1101', 'gal', 227.733, 5.745, 1045, '가장 큰 은하 중 하나 · 별빛 지름 약 400만 광년 (우리은하의 40배)'],
    ['알키오네우스', 'gal', 122.0, 52.0, 3000, '2022년 발견 · 전파 제트 길이 약 1600만 광년의 거대 전파은하 (위치는 대략)'],
    ['헤라클레스 은하단', 'cl', 241.15, 17.72, 500, '충돌 중인 은하가 많은 은하단'],
    ['섀플리 초은하단', 'sc', 201.98, -31.5, 650, '근처 우주에서 가장 무거운 구조'],
    ['목동자리 보이드', 'void', 218, 46, 700, '지름 약 3억 광년의 거대한 빈 공간'],
    ['CfA2 장성', 'wall', 195, 28, 300, '1989년 발견된 은하의 장벽 · 길이 약 5억 광년'],
    ['슬론 장성', 'wall', 195, 1, 1370, '2003년 발견 · 길이 약 14억 광년'],
    ['거대 호 (Giant Arc)', 'wall', 162.5, 20, 9200, '2021년 발견된 33억 광년 길이의 호'],
    ['빅 링 (Big Ring)', 'wall', 222, 25, 9200, '2024년 발견된 지름 13억 광년의 고리'],
    ['헤라클레스-북쪽왕관자리 장성', 'wall', 245, 30, 10000, '알려진 가장 큰 구조 후보 · 약 100억 광년 길이'],
    ['에렌델', 'far', 24.355, -8.457, 28000, '가장 먼 단일 별(2022, 중력렌즈) · 빛이 129억 년 걸림'],
    ['GN-z11', 'far', 189.106, 62.242, 32000, '2016년 당시 가장 먼 은하 · 블랙홀 활동 확인(2024)'],
    ['JADES-GS-z14-0', 'far', 53.083, -27.890, 33800, '2024년 JWST · 빅뱅 2.9억 년 뒤의 은하'],
    ['MoM-z14', 'far', 150.093, 2.273, 33900, '2025년 JWST · 현재 가장 먼 은하 (빅뱅 2.8억 년 뒤)'],
  ].map(([name, kind, ra, dec, mly, desc]) => ({ name, kind, desc, mly, pos: skyPosM(ra, dec, mly * MLY) }));

  // 라니아케아
  const laniR = (th) => 270 * MLY * (1 + 0.1 * Math.sin(3 * th + 1) + 0.06 * Math.cos(5 * th));
  const laniBoundary = [];
  for (let i = 0; i <= 120; i++) {
    const th = (i / 120) * Math.PI * 2;
    laniBoundary.push(P(laniR(th), th, LANI));
  }
  const flows = [];
  for (let f = 0; f < 46; f++) {
    const th = rnd() * Math.PI * 2;
    let [x, y] = P(laniR(th) * (0.75 + rnd() * 0.2), th, LANI);
    const line = [x, y];
    const swirl = (rnd() - 0.5) * 0.9;
    for (let k = 0; k < 140; k++) {
      const dx = GA[0] - x, dy = GA[1] - y, d = Math.hypot(dx, dy);
      if (d < 12 * MLY) break;
      const step = 5 * MLY;
      x += (dx / d - (dy / d) * swirl * (d / (270 * MLY))) * step;
      y += (dy / d + (dx / d) * swirl * (d / (270 * MLY))) * step;
      line.push(x, y);
    }
    flows.push(line);
  }

  // 코스믹 웹
  const nodes = [];
  for (let i = 0; i < 420; i++) nodes.push(inDisk(R_OBS * 0.97));
  nodes.push(LANI);
  const webEdges = [];
  const seen = new Set();
  for (let i = 0; i < nodes.length; i++) {
    const near = nodes
      .map((p, j) => [j, (p[0] - nodes[i][0]) ** 2 + (p[1] - nodes[i][1]) ** 2])
      .filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3);
    for (const [j] of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      webEdges.push([nodes[i], nodes[j]]);
    }
  }

  // 지구 대륙 (지구 반지름 기준 상대 좌표)
  const continents = [];
  for (let i = 0; i < 9; i++) continents.push([gauss() * 0.45, gauss() * 0.45, 0.12 + rnd() * 0.22, 0.08 + rnd() * 0.16, rnd() * Math.PI]);

  return { planets, asteroids, kuiper, oort, comets, pluto, dwarfPlanets, probes, systems, galaxy, lgGalaxies, lgDwarfs, deepSpace, laniBoundary, flows, webEdges, continents };
}

// ───────────────────────── 포맷 ─────────────────────────
function trimNum(v) {
  if (v >= 100) return Math.round(v).toLocaleString('ko-KR');
  if (v >= 10) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(2).replace(/\.?0+$/, '');
}
function fmtKo(n) {
  if (n >= 1e8) return trimNum(n / 1e8) + '억';
  if (n >= 1e4) return trimNum(n / 1e4) + '만';
  return trimNum(n);
}
function fmtLy(ly) {
  return ly < 100 ? `${trimNum(ly)}광년` : `${fmtKo(Math.round(ly))}광년`;
}
function fmtMly(mly) { // 백만 광년 단위 → 한국어
  return mly < 100 ? `${fmtKo(mly * 100)}만 광년` : `${trimNum(Math.round(mly / 10) / 10)}억 광년`;
}
// 태양계 행성 [평균 온도, 자전·하루]
const PLANET_PHYS = {
  수성: ['평균 167°C (밤 -173°C ~ 낮 427°C)', '자전 58.6일 · 하루(해 뜨고 다시 뜨기까지) 176일'],
  금성: ['평균 464°C (납이 녹는 온도, 밤낮 비슷)', '자전 243일 (거꾸로) · 하루 117일'],
  지구: ['평균 15°C', '자전 23시간 56분 · 하루 24시간'],
  화성: ['평균 -63°C (여름 낮 20°C ~ 밤 -140°C)', '자전 24시간 37분 · 하루 24시간 40분'],
  목성: ['구름 꼭대기 약 -110°C', '자전 9시간 56분 (태양계에서 가장 빠름)'],
  토성: ['구름 꼭대기 약 -140°C', '자전 10시간 33분'],
  천왕성: ['구름 꼭대기 약 -195°C (가장 추운 대기 -224°C)', '자전 17시간 14분 · 98° 누워서 거꾸로'],
  해왕성: ['구름 꼭대기 약 -200°C', '자전 16시간 6분'],
};
// 주요 위성 평균 표면 온도(°C, 대략)
const MOON_TEMP = { 포보스: -40, 데이모스: -40, 이오: -143, 유로파: -160, 가니메데: -163, 칼리스토: -139, 미마스: -209, 엔켈라두스: -198, 테티스: -187, 디오네: -186, 레아: -195, 타이탄: -179, 이아페투스: -160, 미란다: -187, 아리엘: -213, 움브리엘: -198, 티타니아: -203, 오베론: -198, 트리톤: -235, 네레이드: -222 };
const DSO_KO = { neb: '발광 성운', pn: '행성상 성운', snr: '초신성 잔해', oc: '산개성단', gc: '구상성단', bh: '블랙홀', psr: '펄서', mag: '마그네타', ns: '중성자별', bd: '갈색왜성', star: '특이한 별', cloud: '별 구름', planet: '외계 행성' };
const DEEP_KO = { bh: '초대질량 블랙홀', grp: '은하군', cl: '은하단', sc: '초은하단', wall: '거대 구조', void: '보이드(빈 공간)', far: '가장 먼 천체', gal: '거대 은하' };
// 분광형 → "적색 초거성" 같은 한국어 설명
function starTypeKo(sp) {
  if (!sp) return '별';
  const u = sp.toUpperCase();
  if (/^D[ABOQZC]?/.test(u)) return '백색왜성';
  if (u.startsWith('W')) return '볼프-레이에 별';
  if (u.startsWith('C') || u.startsWith('N') || u.startsWith('R')) return '탄소별';
  const sd = u.startsWith('SD');
  const m = (sd ? u.slice(2) : u).match(/^([OBAFGKMS])/);
  if (!m) return '별';
  const col = { O: '청색', B: '청백색', A: '백색', F: '황백색', G: '황색', K: '주황색', M: '적색', S: '적색' }[m[1]];
  if (sd) return `${col} 준왜성`;
  const rest = u.slice(1).replace(/^[0-9.\-/]*/, '');
  const lc = rest.match(/(III|II|IV|VI|V|I(?:AB|A|B)?|0)/);
  const lum = !lc ? '별' : lc[1] === 'V' ? '주계열성' : lc[1] === 'IV' ? '준거성' : lc[1] === 'III' ? '거성' : lc[1] === 'II' ? '밝은 거성' : lc[1] === 'VI' ? '준왜성' : '초거성';
  return `${col} ${lum}`;
}
function fmtLength(m) {
  if (m < 1e12) return fmtKo(m / 1000) + ' km';
  if (m < 6e15) return fmtKo(m / AU) + ' AU';
  return fmtKo(m / LY) + ' 광년';
}
function fmtLightTime(m) {
  const t = m / C;
  if (t < 60) return trimNum(t) + '초';
  if (t < 3600) return trimNum(t / 60) + '분';
  if (t < 86400) return trimNum(t / 3600) + '시간';
  if (t < 365.25 * 86400) return trimNum(t / 86400) + '일';
  return fmtKo(t / (365.25 * 86400)) + '년';
}
function fmtDuration(ms) {
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

// ───────────────────────── 스타일 ─────────────────────────
const STYLE_ID = 'mu-universe-style';
const CSS = `
.mu-root{--g:#3dff8f;--g2:rgba(61,255,143,.55);--g3:rgba(61,255,143,.18);--gd:#a6ffcb;
  --glow:0 0 4px rgba(61,255,143,.9),0 0 12px rgba(61,255,143,.45);
  position:absolute;inset:0;overflow:hidden;background:#010604;color:var(--gd);
  font-family:"SF Mono",Menlo,Consolas,"D2Coding","Apple SD Gothic Neo","Noto Sans KR",monospace;
  user-select:none;-webkit-user-select:none;touch-action:none}
.mu-root::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:5;
  background:repeating-linear-gradient(0deg,rgba(61,255,143,.035) 0 1px,transparent 1px 3px),
  radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.55) 100%)}
.mu-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.mu-overlay{cursor:crosshair;touch-action:none}
.mu-overlay:active{cursor:grabbing}
.mu-frame{position:relative;background:
  linear-gradient(var(--g),var(--g)) left top/14px 2px no-repeat,linear-gradient(var(--g),var(--g)) left top/2px 14px no-repeat,
  linear-gradient(var(--g),var(--g)) right top/14px 2px no-repeat,linear-gradient(var(--g),var(--g)) right top/2px 14px no-repeat,
  linear-gradient(var(--g),var(--g)) left bottom/14px 2px no-repeat,linear-gradient(var(--g),var(--g)) left bottom/2px 14px no-repeat,
  linear-gradient(var(--g),var(--g)) right bottom/14px 2px no-repeat,linear-gradient(var(--g),var(--g)) right bottom/2px 14px no-repeat,
  rgba(1,18,9,.62);
  border:1px solid var(--g3);box-shadow:inset 0 0 22px rgba(61,255,143,.08),0 0 14px rgba(61,255,143,.12);backdrop-filter:blur(3px)}
.mu-top{position:absolute;top:10px;left:10px;right:58px;padding:7px 10px 8px;pointer-events:none;z-index:6;max-width:400px}
.mu-title{font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--g);text-shadow:var(--glow)}
.mu-step{display:inline-block;font-size:10px;font-weight:700;padding:1px 6px;margin-right:8px;letter-spacing:.12em;
  border:1px solid var(--g2);color:var(--g);vertical-align:3px;text-shadow:var(--glow)}
.mu-desc{margin-top:6px;font-size:10.5px;line-height:1.45;color:var(--gd);opacity:.92;text-shadow:0 0 6px rgba(61,255,143,.35)}
.mu-close{position:absolute;top:10px;right:10px;width:38px;height:38px;z-index:6;border:1px solid var(--g2);
  background:rgba(1,18,9,.7);color:var(--g);font-weight:700;font-size:12px;cursor:pointer;text-shadow:var(--glow);
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);box-shadow:inset 0 0 10px rgba(61,255,143,.25)}
.mu-3d{position:absolute;top:56px;right:10px;width:38px;height:38px;z-index:6;border:1px solid var(--g2);padding:0;
  background:rgba(1,18,9,.7);color:var(--g);font-family:inherit;font-weight:800;font-size:11px;cursor:pointer;text-shadow:var(--glow);
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);box-shadow:inset 0 0 10px rgba(61,255,143,.25);
  animation:mu3dpulse 2.4s ease-in-out infinite}
.mu-3d[hidden]{display:none}
.mu-more{top:148px;animation:none;font-size:10.5px}
.mu-snd{top:102px;animation:none;font-size:12px;opacity:.6}
.mu-sky{top:194px;animation:none;font-size:10px;letter-spacing:.02em}
.mu-trip{top:240px;animation:none;font-size:10px;letter-spacing:0}
.mu-today{top:286px;animation:none;font-size:10px;letter-spacing:0}
.mu-find{top:332px;animation:none;font-size:10px;letter-spacing:0}
.mu-menu{position:absolute;top:56px;right:10px;width:38px;height:38px;z-index:7;border:1px solid var(--g2);padding:0;
  background:rgba(1,18,9,.7);color:var(--g);font-family:inherit;font-weight:800;font-size:15px;cursor:pointer;text-shadow:var(--glow);
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);box-shadow:inset 0 0 10px rgba(61,255,143,.25)}
.mu-menu.on{background:rgba(61,255,143,.3);color:#eafff2}
.mu-menu.ping::after{content:'';position:absolute;top:5px;right:5px;width:6px;height:6px;background:var(--g);box-shadow:0 0 6px var(--g)}
.mu-tools{position:absolute;top:102px;right:10px;z-index:7;display:flex;flex-flow:column wrap;align-items:flex-end;align-content:flex-end;gap:6px;max-height:calc(100% - 230px)}
.mu-tools:not(.open){display:none}
.mu-tools .mu-3d{position:relative;top:auto;right:auto;width:auto;min-width:38px;height:34px;padding:0 10px;animation:none;opacity:1;font-size:10.5px;letter-spacing:.02em;white-space:nowrap}
.mu-tools .mu-3d::after{content:attr(data-label);margin-left:6px;font-weight:700;color:#cfffe2}
.mu-findbox{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:min(340px,calc(100% - 120px));z-index:9;padding:8px}
.mu-findbox[hidden]{display:none}
.mu-findbox input{width:100%;box-sizing:border-box;background:rgba(0,0,0,.5);border:1px solid var(--g2);color:#eafff2;font:inherit;font-size:12px;padding:7px 8px;outline:none}
.mu-findlist{max-height:260px;overflow:auto;margin-top:6px}
.mu-findlist button{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid rgba(61,255,143,.12);color:var(--g);font:inherit;font-size:11px;padding:6px 4px;cursor:pointer}
.mu-findlist button span{color:var(--gd);font-size:10px;margin-left:6px}
.mu-findlist .none{color:var(--gd);font-size:10.5px;padding:6px 4px}
.mu-photo{position:absolute;z-index:7;width:180px;padding:4px 4px 3px;pointer-events:none;background:rgba(1,18,9,.92)}
.mu-photo[hidden]{display:none}
.mu-photo img{display:block;width:100%;max-height:180px;object-fit:cover;border:1px solid rgba(61,255,143,.35)}
.mu-photo span{display:block;font-size:10px;color:rgba(166,255,203,.7);margin-top:2px;text-align:right}
.mu-warp{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(150px + env(safe-area-inset-bottom));z-index:8;border:1px solid var(--g);background:rgba(61,255,143,.22);
  color:#eafff2;font-family:inherit;font-weight:800;font-size:11px;letter-spacing:.08em;padding:9px 16px;cursor:pointer;text-shadow:var(--glow);
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);animation:mu3dpulse 1.6s ease-in-out infinite}
.mu-warp[hidden]{display:none}
.mu-snd.on{opacity:1;background:rgba(61,255,143,.3);color:#eafff2}
.mu-more.on{background:rgba(61,255,143,.3);color:#eafff2}
@keyframes mu3dpulse{50%{box-shadow:inset 0 0 14px rgba(61,255,143,.55),0 0 12px rgba(61,255,143,.5)}}
.mu-bottom{position:absolute;left:0;right:0;bottom:0;padding:0 12px calc(12px + env(safe-area-inset-bottom));z-index:6;
  background:linear-gradient(transparent,rgba(1,6,4,.9) 45%)}
.mu-focusbar{display:flex;justify-content:center;gap:6px;margin-bottom:6px}
.mu-focusbar[hidden]{display:none}
.mu-focusbar button,.mu-controls button,.mu-card button{border:1px solid var(--g2);background:rgba(1,22,11,.75);color:var(--g);
  font-family:inherit;font-weight:700;font-size:11px;letter-spacing:.06em;cursor:pointer;text-shadow:var(--glow);touch-action:none;
  clip-path:polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px);box-shadow:inset 0 0 10px rgba(61,255,143,.2)}
.mu-focusbar button{padding:5px 11px;font-size:10.5px}
.mu-focusbar button:active,.mu-controls button:active,.mu-card button:active{background:rgba(61,255,143,.25)}
.mu-credit{font-size:10px;line-height:1.35;color:rgba(166,255,203,.55);text-align:center;margin:0 auto 6px;max-width:400px}
.mu-credit a{color:rgba(166,255,203,.8)}
.mu-scale{font-size:10.5px;color:var(--gd);opacity:.85;margin-bottom:8px;text-align:center;font-variant-numeric:tabular-nums;letter-spacing:.04em}
.mu-scale b{color:var(--g);font-weight:700;text-shadow:var(--glow)}
.mu-controls{display:flex;align-items:flex-end;gap:5px;max-width:440px;margin:0 auto}
.mu-controls>button{flex:none;width:36px;height:30px;font-size:12px}
.mu-slider{flex:1;accent-color:#3dff8f;height:28px;filter:drop-shadow(0 0 4px rgba(61,255,143,.6))}
.mu-where{margin-top:5px;font-size:10px;line-height:1.4;color:#9ff0d6;letter-spacing:.02em;text-shadow:0 0 4px rgba(61,255,143,.4)}
.mu-where b{color:var(--g);font-weight:700}
.mu-ladder{position:relative;flex:1;min-width:0;display:flex;gap:2px;padding-top:7px;touch-action:none;cursor:ew-resize}
.mu-lv{flex:1;min-width:0;height:23px;pointer-events:none;padding:0;border:1px solid var(--g3);background:rgba(1,18,9,.7);color:rgba(61,255,143,.45);font:inherit;font-size:10px;font-weight:700;cursor:pointer;font-variant-numeric:tabular-nums}
.mu-lv.found{background:rgba(61,255,143,.16);color:var(--g);border-color:var(--g2)}
.mu-lv.cur{background:rgba(61,255,143,.42);color:#eafff2;border-color:var(--g);box-shadow:0 0 8px rgba(61,255,143,.6);text-shadow:0 0 3px #000}
.mu-lvmark{position:absolute;top:0;left:0;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--g);filter:drop-shadow(0 0 3px var(--g));transform:translateX(-5px);transition:left .12s linear}
.mu-lvtext{max-width:440px;margin:0 auto 5px;font-size:10px;text-align:center;color:var(--gd);letter-spacing:.03em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mu-lvtext b{color:var(--g)}
.mu-progress{position:relative;max-width:400px;margin:10px auto 0;height:16px;border:1px solid var(--g2);background:rgba(1,18,9,.7);overflow:hidden}
.mu-progress-fill{position:absolute;top:2px;bottom:2px;left:2px;width:0;transition:width .5s;
  background:repeating-linear-gradient(90deg,var(--g) 0 9px,transparent 9px 12px);box-shadow:0 0 10px rgba(61,255,143,.6)}
.mu-progress span{position:absolute;inset:0;font-size:10px;line-height:14px;text-align:center;color:#eafff2;font-weight:700;letter-spacing:.12em;
  text-shadow:0 0 3px #000,0 0 6px #000}
.mu-toast{position:absolute;left:50%;bottom:calc(112px + env(safe-area-inset-bottom));transform:translate(-50%,10px);opacity:0;transition:all .3s;z-index:25;
  padding:9px 16px;font-size:11px;font-weight:700;color:var(--g);letter-spacing:.03em;text-shadow:var(--glow);
  width:max-content;max-width:calc(100% - 32px);white-space:normal;text-align:center;pointer-events:none}
.mu-toast::before{content:'> ';opacity:.8}
.mu-toast.show{opacity:1;transform:translate(-50%,0)}
.mu-hint{position:absolute;left:50%;bottom:calc(112px + env(safe-area-inset-bottom));transform:translateX(-50%);font-size:10.5px;color:var(--g);z-index:6;
  padding:8px 14px;pointer-events:none;transition:opacity .6s;width:max-content;max-width:calc(100% - 24px);text-align:center;text-shadow:var(--glow)}
.mu-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,6,3,.7);z-index:8}
.mu-modal[hidden]{display:none}
.mu-card{width:min(360px,calc(100% - 32px));padding:22px 20px;text-align:center}
.mu-card h2{margin:0 0 4px;font-size:12px;color:var(--g);letter-spacing:.08em;text-shadow:var(--glow)}
.mu-card p{margin:0 0 14px;font-size:11px;color:var(--gd)}
.mu-addr{text-align:left;font-size:11px;line-height:1.9;padding:10px 14px;border:1px solid var(--g3);background:rgba(61,255,143,.04);margin-bottom:16px}
.mu-addr div{display:flex;gap:8px;color:var(--gd)}
.mu-addr div::before{content:'>';color:var(--g)}
.mu-addr .me{color:var(--g);font-weight:700;text-shadow:var(--glow)}
.mu-card button{margin:0 4px;padding:10px 14px}
.mu-card button.primary{background:var(--g);color:#012;text-shadow:none}
.mu-card .mu-reset{display:block;margin:12px auto 0;background:none;border:0;clip-path:none;box-shadow:none;color:rgba(166,255,203,.5);font-size:10px;text-decoration:underline;cursor:pointer}
`;

// ───────────────────────── 메인 ─────────────────────────
export function mountUniverseExplorer(container, opts = {}) {
  const { onClose, storageKey = 'momentum.universe.v1', location: fixedLocation, geolocate = true } = opts;

  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID; st.textContent = CSS;
    document.head.appendChild(st);
  }
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  const root = document.createElement('div');
  root.className = 'mu-root';
  root.innerHTML = `
    <canvas class="mu-canvas"></canvas>
    <canvas class="mu-canvas mu-overlay"></canvas>
    <div class="mu-top mu-frame">
      <div class="mu-title"><span class="mu-step"></span><span class="mu-name"></span></div>
      <div class="mu-desc"></div>
      <div class="mu-where"></div>
    </div>
    <button class="mu-close" aria-label="닫기">✕</button>
    <button class="mu-3d mu-g3" hidden aria-label="3D로 은하 보기">3D</button>
    <button class="mu-3d mu-trip" hidden aria-label="탐사선 여행" title="보이저·뉴호라이즌스가 실제로 날아간 길">TRIP</button>
    <button class="mu-3d mu-today" aria-label="오늘의 우주" title="오늘의 천문 사진 · 우주 뉴스 · 오늘 밤 하늘">NEWS</button>
    <button class="mu-3d mu-find" aria-label="천체 찾기" title="이름으로 천체 찾기">찾기</button>
    <div class="mu-findbox mu-frame" hidden><input type="search" placeholder="천체 이름 (예: 트라피스트, 시리우스, M87)" autocomplete="off"><div class="mu-findlist"></div></div>
    <button class="mu-3d mu-sky" hidden aria-label="밤하늘 모드" title="내 위치에서 지금 올려다본 하늘">SKY</button>
    <div class="mu-photo mu-frame" hidden><img alt=""><span></span></div>
    <button class="mu-warp" hidden>▶▶ 광속 이동</button>
    <button class="mu-3d mu-snd" aria-label="소리 켜기" title="우주 소리 (펄서·플라스마·블랙홀)">♪</button>
    <button class="mu-3d mu-more" hidden aria-label="Gaia 별 약 985만 개 켜기" title="Gaia DR3 별 약 985만 개 (보이는 곳만 받기)">G★</button>
    <div class="mu-toast mu-frame"></div>
    <div class="mu-hint mu-frame">드래그로 이동 · 핀치·휠로 가리킨 곳 확대 · 두 번 탭하면 그곳으로</div>
    <div class="mu-bottom">
      <div class="mu-focusbar" hidden>
        <button class="mu-back">← 태양계로</button>
        <button class="mu-speed">SPD · 1초=1시간</button>
        <button class="mu-sys3d" hidden>3D로 보기</button>
      </div>
      <div class="mu-credit" hidden>위성 영상: <a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless - https://s2maps.eu</a> by <a href="https://eox.at" target="_blank" rel="noopener">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2016 &amp; 2017) · 지형 음영: AWS Terrain Tiles (SRTM 등) · 야경: NASA Black Marble · 구름: NASA GIBS VIIRS (어제 영상)</div>
      <div class="mu-lvtext"></div>
      <div class="mu-controls">
        <button data-zoom="-1" aria-label="가까이">＋</button>
        <div class="mu-ladder" role="slider" aria-label="배율 (1~12단계)"><div class="mu-lvmark"></div>${LEVELS.map((l, i) => `<button class="mu-lv" data-i="${i}" title="${l.name}" tabindex="-1">${i + 1}</button>`).join('')}</div>
        <button data-zoom="1" aria-label="멀리">－</button>
        <button class="mu-home" aria-label="지구로 귀환">⌂</button>
      </div>
    </div>
    <div class="mu-modal" hidden>
      <div class="mu-card mu-frame">
        <h2>// 우리 우주 주소 완성</h2>
        <p class="mu-time"></p>
        <div class="mu-addr"></div>
        <button class="primary mu-go-home">지구로 귀환</button>
        <button class="mu-stay">더 둘러보기</button>
        <button class="mu-reset">기록 초기화하고 처음부터</button>
      </div>
    </div>`;
  container.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const canvas = $('.mu-canvas');
  const overlay = $('.mu-overlay');
  const baseCtx = canvas.getContext('2d');
  const octx = overlay.getContext('2d');
  let ctx = baseCtx; // 지구보다 위에 그릴 것은 octx 로 바꿔서 그린다
  const ui = {
    step: $('.mu-step'), name: $('.mu-name'), desc: $('.mu-desc'),
    ladder: $('.mu-ladder'), lvMark: $('.mu-lvmark'), lvText: $('.mu-lvtext'), where: $('.mu-where'),
    credit: $('.mu-credit'), toast: $('.mu-toast'), focusbar: $('.mu-focusbar'), speed: $('.mu-speed'), hint: $('.mu-hint'), modal: $('.mu-modal'), time: $('.mu-time'), addr: $('.mu-addr'),
  };

  const world = buildWorld();
  // 전체 외계 행성계 카탈로그(비동기)
  let catalog = null; // { rows, x, y, groups: Map(color → idx[]) }
  const sysCache = new Map(); // 카탈로그 행성계 모델 캐시
  let nearCtx = null; // 자동 상세 보기 중인(화면 중앙 근처) 행성/행성계
  fetch(catalogUrl).then((r) => r.json()).then((rows) => {
    if (destroyed) return;
    const byName = new Map(rows.map((r) => [r[0], r]));
    linkFeatured(byName);
    const featuredNames = new Set(SYSTEMS.map((q) => q.catalog));
    const x = new Float64Array(rows.length), y = new Float64Array(rows.length);
    const groups = new Map();
    rows.forEach((r, i) => {
      const p = skyPosM(r[1], r[2], r[3] * LY);
      x[i] = p[0]; y[i] = p[1];
      const col = `rgba(${teffColor(r[4])},0.9)`;
      if (!groups.has(col)) groups.set(col, []);
      groups.get(col).push(i);
    });
    const nPlanets = rows.reduce((a, r) => a + r[7].length, 0);
    catalog = { rows, x, y, groups, featuredNames, nPlanets };
  }).catch(() => { /* 오프라인 등 — 추천 행성계 5곳만 표시 */ });
  // 실제 별(AT-HYG v3.2 · Gaia DR3 거리) + 성운·성단·블랙홀·펄서
  let sky = null;
  fetch(skyUrl).then((r) => r.json()).then((d) => {
    if (destroyed) return;
    const n = d.stars.length;
    const x = new Float64Array(n), y = new Float64Array(n);
    const buckets = new Map();
    d.stars.forEach((r, i) => {
      const p = skyPosM(r[2], r[3], r[4] * LY);
      x[i] = p[0]; y[i] = p[1];
      const bv = r[7] == null ? 0.6 : r[7];
      const teff = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
      const am = r[6] == null ? 2 : r[6];
      const size = am <= -5 ? 3.2 : am <= -2 ? 2.6 : am <= 1 ? 2.1 : am <= 4 ? 1.6 : 1.2;
      const key = `${teffColor(teff)}|${size}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(i);
    });
    const dso = d.dso.map(([name, kind, ra, dec, ly, desc]) => ({ name, kind, ly, desc, radec: [ra, dec], pos: skyPosM(ra, dec, ly * LY) }));
    sky = { rows: d.stars, con: d.con, conKeys: d.conKeys || Object.keys(d.con), x, y, buckets: [...buckets].map(([k, idx]) => { const [rgb, sz] = k.split('|'); return { rgb, size: +sz, idx }; }), dso };
  }).catch(() => {});
  // 맨눈 밖의 별: 기본 약 11만 개(이웃 별 단계에서 자동) + Gaia DR3 약 985만 개(보이는 구역만 받기)
  const starLayers = []; // { d, x, y (광년, 월드), cb, box? }
  let deepReq = false, deepA = 0, layerVer = 0, gaiaOn = false;
  const g3Listeners = new Set();
  // 색 팔레트(B-V 32단계) · 밝기(등급 → 빛의 양)
  const BV_PAL = new Float32Array(32 * 3);
  for (let k = 0; k < 32; k++) { const [r, g, b] = bvRgb(-0.4 + (k / 31) * 2.4); BV_PAL[k * 3] = r / 255; BV_PAL[k * 3 + 1] = g / 255; BV_PAL[k * 3 + 2] = b / 255; }
  const FLUX = new Float32Array(256);
  for (let m = 0; m < 256; m++) FLUX[m] = Math.min(2.5, Math.pow(10, -0.4 * (m / 10 - 7.2)));
  const sunLyX = SUN[0] / LY, sunLyY = SUN[1] / LY;
  function addStarLayer(d) {
    const x = new Float32Array(d.N), y = new Float32Array(d.N), cb = new Uint8Array(d.N);
    for (let i = 0; i < d.N; i++) {
      if (d.gaia) { x[i] = sunLyX + d.ex[i]; y[i] = sunLyY + d.ey[i]; }
      else { const p = skyPosM(d.ra[i], d.dec[i], d.ly[i] * LY); x[i] = p[0] / LY; y[i] = p[1] / LY; } // 광년 단위(Float32 정밀도)
      cb[i] = Math.max(0, Math.min(31, Math.round(((d.bv[i] / 50 + 0.4) / 2.4) * 31)));
    }
    const L = { d, x, y, cb, box: d.box ? [sunLyX + d.box[0], sunLyY + d.box[1], sunLyX + d.box[2], sunLyY + d.box[3]] : null };
    starLayers.push(L);
    layerVer++;
    for (const f of g3Listeners) f(d, 'add');
    return L;
  }
  function removeStarLayer(d) {
    const i = starLayers.findIndex((L) => L.d === d);
    if (i >= 0) { starLayers.splice(i, 1); layerVer++; }
    for (const f of g3Listeners) f(d, 'remove');
  }
  function requestDeep() {
    if (deepReq) return;
    deepReq = true;
    loadDeepStars().then((d) => { if (!destroyed) addStarLayer(d); }).catch(() => { deepReq = false; });
  }
  const gaia = createGaiaTiles({ onLoad: (d) => { if (!destroyed && gaiaOn) addStarLayer(d); }, onEvict: (d) => removeStarLayer(d) });
  function toggleGaia() {
    gaiaOn = !gaiaOn;
    btnMore.classList.toggle('on', gaiaOn);
    if (gaiaOn) {
      if (gaia.failed) { gaiaOn = false; btnMore.classList.remove('on'); toast('Gaia 별 목록을 불러올 수 없어요'); return; }
      for (const d of gaia.layers()) if (!starLayers.some((L) => L.d === d)) addStarLayer(d);
      toast(`Gaia DR3 별 ${gaia.total ? gaia.total.toLocaleString('ko-KR') : '약 985만'}개 — 보이는 곳만 받아요. 확대할수록 더 어두운 별까지`);
    } else {
      for (const L of starLayers.slice()) if (L.d.gaia) removeStarLayer(L.d);
      toast('Gaia 별 끔 — 기본 별 약 11만 9천 개만 표시');
    }
  }
  /** 화면 영역(월드 m)에 맞춰 Gaia 칸 요청 */
  function gaiaView(cxw, cyw, halfW, halfH) {
    if (!gaiaOn) return;
    const x = cxw / LY - sunLyX, y = cyw / LY - sunLyY, hw = halfW / LY, hh = halfH / LY;
    gaia.update(x - hw, x + hw, y - hh, y + hh, Math.max(hw, hh) * 0.75);
  }
  const deepCv = document.createElement('canvas');
  const deepCtx = deepCv.getContext('2d');
  let deepImg = null, deepBuf = null, deepAcc = null, deepCacheKey = '';
  function drawDeep(a, camX, camY, mpp) {
    deepA = a;
    if (a > 0.02) gaiaView(camX, camY, (W / 2) * mpp, (H / 2) * mpp);
    if (!starLayers.length || a < 0.02) return;
    const Wd = Math.max(1, Math.round(W * dpr)), Hd = Math.max(1, Math.round(H * dpr));
    const key = `${Wd}|${Hd}|${camX}|${camY}|${mpp}|${layerVer}`;
    if (key !== deepCacheKey) { // 화면이 바뀔 때만 다시 그림 — 빛을 더해 쌓기(빽빽한 곳은 은하수처럼 번짐)
      deepCacheKey = key;
      const Wc = Math.max(1, Math.round(W)), Hc = Math.max(1, Math.round(H));
      if (deepCv.width !== Wc || deepCv.height !== Hc) { deepCv.width = Wc; deepCv.height = Hc; deepImg = null; }
      if (!deepImg) { deepImg = deepCtx.createImageData(Wc, Hc); deepBuf = new Uint32Array(deepImg.data.buffer); deepAcc = new Float32Array(Wc * Hc * 3); }
      deepAcc.fill(0);
      const k = LY / mpp, ox = W / 2, oy = H / 2;
      const cX = camX / LY, cY = camY / LY;
      const vx0 = cX - (W / 2) / k, vx1 = cX + (W / 2) / k, vy0 = cY - (H / 2) / k, vy1 = cY + (H / 2) / k;
      const gLim = gaiaOn ? gaia.magLimit(vx0 - sunLyX, vx1 - sunLyX, vy0 - sunLyY, vy1 - sunLyY) : 255;
      for (const { x, y, cb, d, box } of starLayers) {
        if (box && (box[2] < vx0 || box[0] > vx1 || box[3] < vy0 || box[1] > vy1)) continue; // 화면 밖 칸은 건너뜀
        const mag = d.mag, lim = d.gaia ? gLim : 255;
        for (let i = 0, n = x.length; i < n; i++) {
          if (mag[i] > lim) continue;
          const X = (ox + (x[i] - cX) * k) | 0;
          if (X < 0 || X >= Wc) continue;
          const Y = (oy - (y[i] - cY) * k) | 0;
          if (Y < 0 || Y >= Hc) continue;
          const j = (Y * Wc + X) * 3, f = FLUX[mag[i]], c = cb[i] * 3;
          deepAcc[j] += BV_PAL[c] * f; deepAcc[j + 1] += BV_PAL[c + 1] * f; deepAcc[j + 2] += BV_PAL[c + 2] * f;
        }
      }
      for (let p = 0, n = Wc * Hc; p < n; p++) {
        const j = p * 3, r = deepAcc[j], g = deepAcc[j + 1], b = deepAcc[j + 2];
        if (r + g + b === 0) { deepBuf[p] = 0; continue; }
        const R = 255 * (1 - Math.exp(-r * 1.4)), G = 255 * (1 - Math.exp(-g * 1.4)), B = 255 * (1 - Math.exp(-b * 1.4));
        const A = Math.max(R, G, B);
        deepBuf[p] = ((A << 24) | ((B * 255 / A) << 16) | ((G * 255 / A) << 8) | (R * 255 / A)) >>> 0;
      }
      deepCtx.putImageData(deepImg, 0, 0);
    }
    ctx.globalAlpha = a;
    ctx.drawImage(deepCv, 0, 0, W, H);
  }
  let deepPickCache = { t: 0, px: -1, py: -1, hit: null };
  function pickDeep(px, py, r) {
    if (!starLayers.length || deepA < 0.3) return null;
    const now = performance.now();
    const c = deepPickCache;
    if (c.px === px && c.py === py && now - c.t < 250) return c.hit;
    const [camX, camY] = getCam(s), m = mppAt(s) / LY;
    const cX = camX / LY, cY = camY / LY;
    let best = null, bd = r * r;
    const rx = r * m;
    for (const L of starLayers) {
      const { x, y, box } = L;
      if (box) { const wx = cX + (px - W / 2) * m, wy = cY - (py - H / 2) * m; if (wx < box[0] - rx || wx > box[2] + rx || wy < box[1] - rx || wy > box[3] + rx) continue; }
      for (let i = 0, n = x.length; i < n; i++) {
        const dx = W / 2 + (x[i] - cX) / m - px;
        if (dx > r || dx < -r) continue;
        const dy = H / 2 - (y[i] - cY) / m - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = { L, i }; }
      }
    }
    const hit = best && { deepStar: best, hoverOnly: true, x: W / 2 + (best.L.x[best.i] - cX) / m, y: H / 2 - (best.L.y[best.i] - cY) / m, wx: best.L.x[best.i] * LY, wy: best.L.y[best.i] * LY };
    deepPickCache = { t: now, px, py, hit };
    return hit;
  }
  function deepInfo(d, i) {
    if (d.gaia) {
      const m = d.mag[i] / 10;
      return ['Gaia DR3 별', `${fmtLy(d.ly[i])} · ${bpColorKo(d.bv[i])}`, `G ${m.toFixed(1)}등급 · 망원경으로만 보여요 · 거리는 연주시차 기준`];
    }
    const con = sky ? sky.con[sky.conKeys[d.con[i]]] || '' : '';
    const m = d.mag[i] / 10;
    return [starId(d, i), `${fmtLy(d.ly[i])} · ${starTypeKo(deepSpect(d.sp[i]))}`, `${con ? con + ' · ' : ''}${m.toFixed(1)}등급 · ${m > 8.5 ? '망원경으로만' : '쌍안경으로'} 보여요`];
  }
  const seasonInfo = earthSeason(TODAY);
  // 3D(WebGL2) 지구 — 안 되면 2D 지구로 자동 전환
  let earth = null;
  if (canUseWebGL()) {
    try { earth = createEarthGL(root, { sdfUrl, dayUrl, reliefUrl, moonUrl, before: overlay }); } catch (err) { console.warn('3D 지구 초기화 실패, 2D로 전환', err); }
  }
  if (!earth) earth = createEarthRenderer({ sdfUrl });

  // ── 내 위치 ──
  let destroyed = false;
  // 기본값은 서울. 브라우저 위치 권한이 허용되면 실제 위치로 바꾼다.
  const DEFAULT_LOC = { lat: 37.5665, lon: 126.978, label: '서울', approx: true };
  let myLoc = fixedLocation ? { approx: false, label: '내 위치', ...fixedLocation } : DEFAULT_LOC;
  earth.setView(myLoc.lat, myLoc.lon);
  if (!fixedLocation && geolocate && navigator.geolocation) {
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (destroyed) return;
          myLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: '내 위치', approx: false };
          earth.setView(myLoc.lat, myLoc.lon);
          toast('위치 신호 수신 완료');
        },
        () => { /* 거부·실패 → 서울 기본값 유지 */ },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60 * 1000 },
      );
    } catch { /* 샌드박스 등에서 차단 */ }
  }

  // ── 저장 상태 ──
  const load = () => {
    try { return JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { return {}; }
  };
  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(store)); } catch { /* 저장 불가 환경 무시 */ }
  };
  const store = Object.assign({ found: [], bestMs: null }, load());
  const found = new Set(store.found);
  found.add('earth');
  let sessionStart = performance.now();
  let completedThisSession = found.size === LEVELS.length;

  // ── 카메라 상태 ──
  let s = S_START, targetS = S_START, zoomVel = 0;
  let W = 0, H = 0, dpr = 1;
  let raf = 0, last = performance.now();
  let interacted = false;

  function resize() {
    const r = root.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = overlay.width = Math.round(W * dpr);
    canvas.height = overlay.height = Math.round(H * dpr);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  const setTarget = (v) => { targetS = clamp(v, S_MIN, S_MAX); };
  const markInteracted = () => {
    if (!interacted) { interacted = true; ui.hint.style.opacity = '0'; }
  };

  // ── 자유 카메라: 기본 경로(camAt) + 사용자 이동(pan) ──
  let pan = [0, 0];
  let panVel = [0, 0];
  let anchor = null; // 가리킨 지점으로 확대: { mode:'pan'|'earth', x, y, wx, wy, R }
  const mppAt = (sv) => Math.pow(10, sv) / Math.min(W, H);
  function baseCam(sv) {
    let [x, y] = camAt(sv);
    if (focus) { const t = smooth(0, 1, focus.blend); x += (focus.pos[0] - x) * t; y += (focus.pos[1] - y) * t; }
    return [x, y];
  }
  function getCam(sv) { const b = baseCam(sv); return [b[0] + pan[0], b[1] + pan[1]]; }
  function setAnchor(x, y) {
    const er = earthRadiusPx();
    if (canSpin()) {
      const [cxw, cyw] = getCam(s), m = mppAt(s);
      const ex = W / 2 - cxw / m, ey = H / 2 + cyw / m; // 지구 중심 화면 위치
      anchor = { mode: 'earth', dx: x - ex, dy: y - ey, R: er };
    } else {
      const [cxw, cyw] = getCam(s), m = mppAt(s);
      // 자석: 손가락 근처(40px)에 천체가 있으면 그 천체를 붙잡고 확대 → 확대해도 화면에 남음
      let mag = null;
      for (const t of lastPlanetScreen) {
        if (t.wx === undefined) continue;
        const d = Math.hypot(t.x - x, t.y - y);
        if (d < 40 && (!mag || d < mag.d)) mag = { d, t };
      }
      anchor = mag ? { mode: 'pan', x: mag.t.x, y: mag.t.y, wx: mag.t.wx, wy: mag.t.wy } : { mode: 'pan', x, y, wx: cxw + (x - W / 2) * m, wy: cyw - (y - H / 2) * m };
    }
    panVel = [0, 0];
  }
  function applyAnchor() {
    if (!anchor) return;
    if (anchor.mode === 'pan') {
      const m = mppAt(s), b = baseCam(s);
      pan = [anchor.wx - (anchor.x - W / 2) * m - b[0], anchor.wy + (anchor.y - H / 2) * m - b[1]];
    } else if (earth.gl) {
      // 가리킨 지점이 손가락 아래에 머물도록 지구를 돌림
      const R2 = earthRadiusPx();
      if (R2 > 1 && anchor.R > 1) {
        const k = 1 / anchor.R - 1 / R2;
        earth.rotateBy(-anchor.dx * k, -anchor.dy * k);
        anchor.R = R2;
      }
    }
    if (Math.abs(targetS - s) < 0.002 && pointers.size < 2) anchor = null;
  }

  // ── 입력: 휠 ──
  const onWheel = (e) => {
    e.preventDefault(); markInteracted();
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const r = root.getBoundingClientRect();
    setAnchor(e.clientX - r.left, e.clientY - r.top);
    setTarget(targetS + d * 0.0018);
  };
  overlay.addEventListener('wheel', onWheel, { passive: false });

  // ── 입력: 드래그(1손가락) / 핀치(2손가락) ──
  const pointers = new Map();
  let lastPinch = 0;
  const pinchDist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  // ── 행성 포커스(위성 보기) ──
  const SPEEDS = [[1, '실시간'], [3600, '1초=1시간'], [86400, '1초=1일'], [86400 * 365.25, '1초=1년']];
  let speedIdx = 1;
  let simAnchor = { real: performance.now(), sim: Date.now() };
  const simDate = () => new Date(simAnchor.sim + (performance.now() - simAnchor.real) * SPEEDS[speedIdx][0]);
  let focus = null; // { name, pos, rKm, sView, blend, on }
  const lastPlanetScreen = [];
  const lastMoonScreen = [];
  function enterFocus(name) {
    const p = world.planets.find((q) => q.name === name);
    if (!p) return;
    const ms = MOONS[name] || [];
    const info = PLANET_INFO[name];
    const reach = ms.length ? Math.max(...ms.map((m) => m[1])) * 1000 : info.radiusKm * 1000 * 12;
    const sView = Math.log10(reach * 2 * 1.35);
    simAnchor = { real: performance.now(), sim: Date.now() };
    pan = [0, 0]; panVel = [0, 0]; anchor = null;
    focus = { kind: 'planet', name, pos: p.pos, rKm: info.radiusKm, sView, blend: focus ? focus.blend : 0, on: true, returnS: s };
    setTarget(sView);
    if (speedIdx > 2) setSpeedIdx(1);
    $('.mu-back').textContent = '← 태양계로';
    $('.mu-sys3d').hidden = true;
    ui.focusbar.hidden = false;
  }
  function setSpeedIdx(i) {
    simAnchor = { real: performance.now(), sim: simDate().getTime() };
    speedIdx = i;
    ui.speed.textContent = `SPD · ${SPEEDS[speedIdx][1]}`;
  }
  // 외계 행성계로 이동
  function enterSystem(id) {
    const ws = world.systems.find((q) => q.sys.id === id);
    if (ws) enterSystemModel(ws.sys, ws.pos);
  }
  function enterCatalog(i) {
    const row = catalog.rows[i];
    const feat = world.systems.find((q) => q.sys.catalog === row[0]);
    if (feat) return enterSystemModel(feat.sys, feat.pos);
    enterSystemModel(catalogToSystem(row), [catalog.x[i], catalog.y[i]]);
  }
  function enterSystemModel(sys, pos) {
    const ws = { sys, pos };
    const reach = (sys.view || Math.max(...sys.planets.map((p) => p.au))) * 1.496e11; // 행성계마다 보기 좋은 반경(AU)
    const sView = Math.log10(reach * 2 * 1.3);
    simAnchor = { real: performance.now(), sim: Date.now() };
    const returnS = focus && focus.on ? focus.returnS : s;
    pan = [0, 0]; panVel = [0, 0]; anchor = null;
    focus = { kind: 'star', sys, name: sys.name, pos: ws.pos, sView, blend: focus ? focus.blend : 0, on: true, returnS,
      toEarth: Math.atan2(SUN[1] - ws.pos[1], SUN[0] - ws.pos[0]) };
    setTarget(sView);
    setSpeedIdx(Math.max(0, SPEEDS.findIndex(([k]) => k === sys.speed)));
    $('.mu-back').textContent = '← 돌아가기';
    $('.mu-sys3d').hidden = false;
    ui.focusbar.hidden = false;
  }
  function exitFocus() {
    if (!focus) return;
    focus.on = false;
    // 돌아갈 때 카메라가 튀지 않도록 지금 위치를 pan 으로 넘김
    { const cur = getCam(s); pan = [0, 0]; const b = baseCam(s); pan = [cur[0] - b[0], cur[1] - b[1]]; anchor = null; }
    setTarget(focus.returnS || (focus.kind === 'star' ? 17.6 : 12.4));
    ui.focusbar.hidden = true;
  }
  $('.mu-back').addEventListener('click', exitFocus);
  $('.mu-sys3d').addEventListener('click', () => openSys3D());
  ui.speed.addEventListener('click', () => setSpeedIdx((speedIdx + 1) % SPEEDS.length));
  const fmtPeriod = (d) => (d < 2 ? `${(d * 24).toFixed(1)}시간` : d < 1000 ? `${d.toFixed(1)}일` : `${Math.round(d / 365.25)}년`);
  function handleTap(x, y) {
    const body = lastMoonScreen.find((m) => Math.hypot(m.x - x, m.y - y) < 22);
    if (body && !(focus && focus.on)) {
      toast(bodyInfo(body));
      return;
    }
    if (focus && focus.on) {
      const hit = body;
      if (hit && hit.kind === 'exo' && focus.kind === 'star') {
        const pl = focus.sys.planets.find((p) => hit.name === p.name || hit.name.endsWith(' ' + p.name) || hit.short === p.name);
        openSys3D(pl ? pl.name : null);
      } else if (hit && hit.kind === 'exo') {
        const size = hit.reKnown ? `지구 크기의 ${hit.re}배` : `크기 추정 지구의 ${hit.re}배`;
        toast(`${hit.name} · 별에서 ${hit.au} AU · 공전 ${fmtPeriod(hit.periodDays)} · ${size}${hit.teq ? ` · 약 ${Math.round(hit.teq - 273)}°C` : ''}${hit.note ? ' · ' + hit.note : ''}${hit.exact ? ' · 📍실제 위치' : ''}`);
      } else if (hit) {
        toast(`${hit.name} · ${focus.name}에서 ${fmtKo(hit.distKm)} km · 공전 ${fmtPeriod(hit.periodDays)}${hit.retro ? ' (역행)' : ''}`);
      }
      return;
    }
    let best = null;
    for (const p of lastPlanetScreen) {
      if (p.hoverOnly) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < (p.cat !== undefined ? 8 : 30) && (!best || d < best.d - (p.sys ? 6 : 0))) best = { ...p, d };
    }
    if (best && best.probe) {
      const pr = best.probe;
      soundFor(best);
      const tripId = { '보이저 1호': 'v1', '보이저 2호': 'v2', 뉴호라이즌스: 'nh', '파이어니어 10호': 'p10', '파이어니어 11호': 'p11' }[pr.name];
      if (tripId) setTimeout(() => openTrip(tripId), 900);
      toast(`${pr.name} · 태양에서 약 ${Math.round(pr.au)} AU · 빛으로 ${(pr.au * 1.496e11 / 2.998e8 / 3600).toFixed(1)}시간 · ${pr.desc}`);
    } else if (best && best.sys) enterSystem(best.sys);
    else if (best && best.cat !== undefined) enterCatalog(best.cat);
    else if (best) enterFocus(best.name);
    else if (infoTap(x, y)) { /* 정보 표시 */ }
    else {
      // 빈 곳 두 번 탭 → 그 지점으로 한 단계 확대
      const now = performance.now();
      if (lastTap && now - lastTap.t < 350 && Math.hypot(lastTap.x - x, lastTap.y - y) < 30) {
        setAnchor(x, y);
        setTarget(targetS - 0.8);
        lastTap = null;
      } else lastTap = { x, y, t: now };
    }
  }
  let lastTap = null;
  let tapStart = null;
  function bodyInfo(hit) {
    if (hit.kind === 'exo') {
      const size = hit.reKnown ? `지구 크기의 ${hit.re}배` : `크기 추정 지구의 ${hit.re}배`;
      return `${hit.name} · 별에서 ${hit.au} AU · 공전 ${fmtPeriod(hit.periodDays)} · ${size}${hit.teq ? ` · 약 ${Math.round(hit.teq - 273)}°C` : ''}${hit.note ? ' · ' + hit.note : ''}${hit.exact ? ' · 📍실제 위치' : ''}`;
    }
    return `${hit.name} · ${hit.parent}에서 ${fmtKo(hit.distKm)} km · 공전 ${fmtPeriod(hit.periodDays)}${hit.retro ? ' (역행)' : ''}`;
  }

  // ── 호버(마우스) / 꾹 누르기(터치): 강조 테두리 + 이름 ──
  let hoverPt = null;
  let holdTimer = 0;
  function hoverLabel(t) {
    if (t.kind === 'exo') {
      // 평형 온도: 목록 값, 없으면 별 온도·반지름·거리로 추정 (반사율 0.3)
      let T = t.teq, est = false;
      if (!T && t.starT && t.au) { T = t.starT * Math.sqrt(((t.starR || 1) * 6.957e8) / (2 * t.au * 1.496e11)) * 0.915; est = true; }
      const tTxt = T ? `온도 약 ${Math.round(T - 273)}°C${est ? ' (추정)' : ''}` : '온도 미상';
      const size = t.reKnown && t.re ? (t.re > 6 ? `목성의 ${(t.re / 11.21).toFixed(1)}배 크기` : `지구의 ${t.re.toFixed(1)}배 크기`) : '크기 미상';
      const spin = t.periodDays < 10 ? '자전 = 공전 (조석 고정 추정 · 한쪽만 낮)' : '자전 주기 미상';
      return [t.name, `공전 ${fmtPeriod(t.periodDays)} · 별에서 ${t.au} AU · ${size}`, `${tTxt} · ${spin}`, focus && focus.on ? '탭하면 3D로 가까이' : ''];
    }
    if (t.kind === 'moon') {
      const temp = MOON_TEMP[t.name];
      const spin = t.name === '네레이드' ? '자전 약 11.6시간' : '자전 = 공전 (조석 고정 · 늘 같은 면)';
      return [t.name, `${t.parent}의 위성 · 공전 ${fmtPeriod(t.periodDays)}${t.retro ? ' (역행)' : ''} · 반지름 ${fmtKo(Math.round(t.radiusKm))}km`, `${temp !== undefined ? `평균 약 ${temp}°C · ` : ''}${spin}`];
    }
    if (t.cat !== undefined && catalog) {
      const r = catalog.rows[t.cat];
      const dist = r[3] < 1000 ? `${r[3]}광년` : `${fmtKo(Math.round(r[3]))}광년`;
      return [r[0], `${dist} · 행성 ${r[7].length}개 · 탭하면 방문`];
    }
    if (t.sys) { const q = SYSTEMS.find((z) => z.id === t.sys); return [q.name, `${q.distLy}광년 · 행성 ${q.planets.length}개 · 탭하면 방문`]; }
    if (t.probe) return [t.probe.name, `태양에서 약 ${Math.round(t.probe.au)} AU`];
    if (t.sky !== undefined && sky) {
      const r = sky.rows[t.sky];
      const con = sky.con[r[9]] || r[9];
      return [r[0] ? `${r[0]}${r[1] ? ' · ' + r[1] : ''}` : r[1] || '이름 없는 별',
        `${fmtLy(r[4])} · ${starTypeKo(r[8])}`,
        `${con} · ${r[5].toFixed(1)}등급${r[10] ? ' · 거리: Gaia DR3' : ''}`];
    }
    if (t.deepStar) return deepInfo(t.deepStar.L.d, t.deepStar.i);
    if (t.sat !== undefined && satSys) return [...satInfo(t.sat), '탭하면 생김새 보기'];
    if (t.lgal) {
      const B = { 우리은하: ['궁수자리 A* · 태양 질량 430만 배', '탭하면 블랙홀 체험'], 안드로메다: ['M31* · 태양 질량 약 1억 4천만 배', '탭하면 블랙홀 체험'],
        '삼각형자리 은하': ['중심 블랙홀이 없어요! (있어도 태양의 1,500배 이하)', '큰 은하인데 초대질량 블랙홀이 없는 드문 예'], '대마젤란 은하': ['약 60만 배 블랙홀 (2025년 발견)', '튕겨 나온 초고속 별로 찾아냄 · 탭하면 블랙홀 체험'],
        '소마젤란 은하': ['중심 블랙홀은 아직 못 찾았어요', ''] }[t.lgal.name] || ['', ''];
      return [t.lgal.name, `중심: ${B[0]}`, B[1]];
    }
    if (t.earthMoon) { const mi = earth.moon; const km = Math.round(Math.hypot(...mi.pos) * 6371); return ['달', `${mi.phase} · 밝은 면 ${Math.round(mi.illum * 100)}% · 지금 ${km.toLocaleString('ko-KR')}km (빛으로 ${(km / 299792).toFixed(2)}초)`, '늘 같은 면이 지구를 향해요(조석 고정) — 자전·공전 모두 27.3일 · 매년 3.8cm씩 멀어지는 중']; }
    if (t.small) return smallInfo(t.small);
    if (t.comet) { const c = t.comet; return [c.name, `${c.kind === 'iso' ? '성간 천체 · 태양계 밖에서 옴' : '혜성'} · 지금 태양에서 ${c.r.toFixed(1)} AU`, c.desc]; }
    if (t.dso) return [t.dso.name, `${fmtLy(t.dso.ly)} · ${DSO_KO[t.dso.kind]}${t.dso.kind === 'bh' || t.dso.name === '오메가 센타우리' ? ' · 탭하면 블랙홀 체험' : (t.dso.kind === 'psr' || t.dso.kind === 'mag') && sound.on ? ' · ♪ 신호음' : ''}`, t.dso.desc];
    if (t.gal) return [t.gal.name, `${fmtLy(t.gal.ly)} · 국부은하군`, t.gal.desc];
    if (t.deep && t.deep.kind === 'bh') return [t.deep.name, `${fmtMly(t.deep.mly)}${t.deep.mly > 5000 ? ' (공동 거리)' : ''} · 초대질량 블랙홀`, t.deep.desc];
    if (t.deep) return [t.deep.name, `${fmtMly(t.deep.mly)}${t.deep.kind === 'far' || t.deep.mly > 5000 ? ' (공동 거리)' : ''} · ${DEEP_KO[t.deep.kind]}`, t.deep.desc];
    if (t.name) {
      const d = PERIOD_DAYS[t.name], ph = PLANET_PHYS[t.name];
      if (ph) return [t.name, `공전 ${fmtPeriod(d)} · ${ph[1]}`, `${ph[0]}${MOONS[t.name] ? ' · 탭하면 위성 보기' : ''}`];
      return [t.name, d ? `공전 ${fmtPeriod(d)}${MOONS[t.name] ? ' · 탭하면 위성 보기' : ''}` : ''];
    }
    return null;
  }
  // 정보만 있는 천체(별·성운 등) 탭 → 토스트로 정보
  function infoTap(x, y) {
    let best = null;
    for (const p of lastPlanetScreen) {
      if (!p.hoverOnly) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 18 && (!best || d < best.d)) best = { p, d };
    }
    const hit = best ? best.p : pickSat(x, y, 12) || pickSmall(x, y, 10) || pickDeep(x, y, 10);
    if (hit && hit.sat !== undefined) { soundFor(hit); toast(satInfo(hit.sat).filter(Boolean).join(' · ')); openSat3D(hit.sat); return true; }
    if (hit && hit.dso && hit.dso.kind === 'bh') { openBH(bhTarget(hit.dso.name)); return true; }
    if (hit && hit.deep && hit.deep.kind === 'bh') { openBH(bhTarget(hit.deep.name)); return true; }
    if (hit && hit.lgal) { const k = { 우리은하: 'sgra', 안드로메다: 'm31', '대마젤란 은하': 'lmc' }[hit.lgal.name]; if (k) { openBH(k); return true; } }
    if (hit && hit.dso && hit.dso.name === '오메가 센타우리') { toast('오메가 센타우리 중심에 중간질량 블랙홀(태양의 8,200배 이상) — 블랙홀 체험으로'); openBH('omegacen'); return true; }
    soundFor(hit);
    const lab = hit && hoverLabel(hit);
    if (!lab) return false;
    toast(lab.filter(Boolean).join(' · '));
    offerWarp(hit);
    clearTimeout(photoTimer); showPhoto(hit, null); photoTimer = setTimeout(() => { photoTimer = 0; photoEl.hidden = true; photoKey = ''; }, 5000);
    return true;
  }
  function pickHover() {
    if (!hoverPt) return null;
    let best = null;
    const consider = (t, r) => {
      const d = Math.hypot(t.x - hoverPt.x, t.y - hoverPt.y);
      if (d < r && (!best || d < best.d)) best = { t, d };
    };
    for (const t of lastMoonScreen) consider(t, 16);
    if (!best) for (const t of lastPlanetScreen) consider(t, t.cat !== undefined || t.sky !== undefined ? 10 : 20);
    if (!best) { const st = pickSat(hoverPt.x, hoverPt.y, 7) || pickSmall(hoverPt.x, hoverPt.y, 6); if (st) return st; }
    if (!best) return pickDeep(hoverPt.x, hoverPt.y, 6);
    return best && best.t;
  }
  let lastSoundKey = '';
  function drawHover(time) {
    const t = pickHover();
    if (!t && photoKey && !photoTimer) { photoEl.hidden = true; photoKey = ''; }
    const sk = t ? (t.dso ? t.dso.name : t.probe ? t.probe.name : '') : '';
    if (sk !== lastSoundKey) { lastSoundKey = sk; soundFor(t); }
    overlay.style.cursor = t ? 'pointer' : '';
    if (!t) return;
    const lab = hoverLabel(t);
    if (!lab) return;
    const g = octx;
    const r = 10 + 1.5 * Math.sin(time * 5);
    g.globalAlpha = 1;
    // 네온 조준 링 + 십자선
    g.strokeStyle = '#3dff8f'; g.lineWidth = 1.6;
    g.shadowColor = 'rgba(61,255,143,.9)'; g.shadowBlur = 10;
    g.beginPath(); g.arc(t.x, t.y, r, 0, Math.PI * 2); g.stroke();
    g.beginPath();
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.moveTo(t.x + ax * (r + 3), t.y + ay * (r + 3)); g.lineTo(t.x + ax * (r + 8), t.y + ay * (r + 8)); }
    g.stroke();
    g.shadowBlur = 0;
    const MONO = '"SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace';
    // 줄바꿈(화면 폭에 맞춤)
    const maxW = Math.min(360, W - 40);
    const lines = [{ text: lab[0], font: `700 12px ${MONO}`, color: '#3dff8f' }];
    lab.slice(1).filter(Boolean).forEach((txt, k) => {
      const font = `500 10.5px ${MONO}`;
      g.font = font;
      let cur = '';
      for (const word of txt.split(' ')) {
        const tryS = cur ? cur + ' ' + word : word;
        if (cur && g.measureText(tryS).width > maxW) { lines.push({ text: cur, font, color: k ? '#7fdcaa' : '#a6ffcb' }); cur = word; } else cur = tryS;
      }
      if (cur) lines.push({ text: cur, font, color: k ? '#7fdcaa' : '#a6ffcb' });
    });
    let bw = 0;
    for (const L of lines) { g.font = L.font; bw = Math.max(bw, g.measureText(L.text).width); }
    bw += 16;
    const bh = 10 + lines.length * 14;
    let bx = t.x + 16, by = t.y - bh - 8;
    if (bx + bw > W - 6) bx = t.x - bw - 16;
    bx = Math.max(6, Math.min(W - bw - 6, bx)); // 화면 밖으로 안 나가게
    if (by < 6) by = t.y + 14;
    // 각진 네온 패널 + 연결선
    const ch = 6;
    g.beginPath();
    g.moveTo(bx + ch, by); g.lineTo(bx + bw, by); g.lineTo(bx + bw, by + bh - ch); g.lineTo(bx + bw - ch, by + bh); g.lineTo(bx, by + bh); g.lineTo(bx, by + ch); g.closePath();
    g.fillStyle = 'rgba(1,18,9,.9)'; g.fill();
    g.strokeStyle = 'rgba(61,255,143,.8)'; g.lineWidth = 1; g.shadowColor = 'rgba(61,255,143,.7)'; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
    g.strokeStyle = 'rgba(61,255,143,.5)'; g.beginPath(); g.moveTo(t.x, t.y); g.lineTo(bx < t.x ? bx + bw : bx, by + bh / 2); g.stroke();
    g.textAlign = 'left';
    g.shadowColor = 'rgba(61,255,143,.9)'; g.shadowBlur = 6;
    lines.forEach((L, i) => { g.font = L.font; g.fillStyle = L.color; g.fillText(L.text, bx + 8, by + 16 + i * 14); });
    g.shadowBlur = 0;
    showPhoto(t, { x: bx, y: by, w: bw, h: bh });
  }

  // 지구가 화면을 크게 차지할 때: 1손가락 드래그 = 지구 회전 (관성 포함)
  let spin = { vx: 0, vy: 0 };
  const earthRadiusPx = () => 6.371e6 / (Math.pow(10, s) / Math.min(W, H));
  const canSpin = () => earth.gl && !focus && earthRadiusPx() > 40 && s < 9.6 && Math.hypot(pan[0], pan[1]) < mppAt(s) * Math.min(W, H) * 0.4;
  overlay.addEventListener('pointerleave', () => { if (pointers.size === 0) hoverPt = null; });
  overlay.addEventListener('pointerdown', (e) => {
    overlay.setPointerCapture(e.pointerId);
    if (e.pointerType !== 'mouse') {
      // 꾹 누르기(0.35초) → 이름 보기
      const r0 = root.getBoundingClientRect();
      const pt = { x: e.clientX - r0.left, y: e.clientY - r0.top };
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => { if (pointers.size === 1) hoverPt = pt; }, 350);
    }
    spin = { vx: 0, vy: 0 };
    tapStart = pointers.size === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    panVel = [0, 0];
    if (pointers.size === 2) { lastPinch = pinchDist(); anchor = null; }
    markInteracted();
  });
  overlay.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && pointers.size === 0) {
      const r0 = root.getBoundingClientRect();
      hoverPt = { x: e.clientX - r0.left, y: e.clientY - r0.top };
    }
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (e.pointerType !== 'mouse' && tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 8) { clearTimeout(holdTimer); hoverPt = null; }
    if (pointers.size === 1) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (canSpin()) {
        const r = earthRadiusPx();
        earth.rotateBy(dx / r, dy / r);
        spin = { vx: dx / r, vy: dy / r };
      } else {
        // 드래그 = 이동 (손가락을 따라 우주가 움직임)
        const m = mppAt(s);
        pan = [pan[0] - dx * m, pan[1] + dy * m];
        panVel = [-dx * m, dy * m];
        anchor = null;
      }
    }
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) {
      const d = pinchDist();
      if (lastPinch > 0 && d > 0) {
        const [a, b] = [...pointers.values()];
        const r = root.getBoundingClientRect();
        if (!anchor) setAnchor((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        setTarget(targetS - Math.log10(d / lastPinch) * 2.2);
      }
      lastPinch = d;
    }
  });
  const endPointer = (e) => { pointers.delete(e.pointerId); lastPinch = pointers.size === 2 ? pinchDist() : 0; };
  overlay.addEventListener('pointerup', (e) => {
    clearTimeout(holdTimer);
    if (e.pointerType !== 'mouse' && hoverPt) { hoverPt = null; tapStart = null; endPointer(e); return; } // 꾹 누르기 후엔 탭 동작 안 함
    const wasSingle = pointers.size === 1;
    endPointer(e);
    if (wasSingle && tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 8 && performance.now() - tapStart.t < 450) {
      const r = root.getBoundingClientRect();
      handleTap(e.clientX - r.left, e.clientY - r.top);
    }
    tapStart = null;
  });
  overlay.addEventListener('pointercancel', (e) => { endPointer(e); spin = { vx: 0, vy: 0 }; });

  // ── 입력: 버튼 길게 누르기 ──
  root.querySelectorAll('[data-zoom]').forEach((btn) => {
    const dir = Number(btn.dataset.zoom);
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); markInteracted(); zoomVel = dir * 2.4; setTarget(targetS + dir * 0.15); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, () => { zoomVel = 0; }));
  });
  // 안내 상자는 처음 몇 초만
  setTimeout(() => { if (!destroyed) ui.hint.style.opacity = '0'; }, 6000);
  $('.mu-home').addEventListener('click', () => {
    setTarget(S_START); spin = { vx: 0, vy: 0 }; earth.setView(myLoc.lat, myLoc.lon);
    pan = [0, 0]; panVel = [0, 0]; anchor = null;
    if (focus) exitFocus();
  });

  // ── 키보드 ──
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') { setTarget(targetS - 0.25); markInteracted(); }
    if (e.key === '-' || e.key === '_' || e.key === 'ArrowDown') { setTarget(targetS + 0.25); markInteracted(); }
  };
  window.addEventListener('keydown', onKey);

  // ── 모달 ──
  $('.mu-close').addEventListener('click', () => close());
  // 소리
  const sound = createSound();
  const btnSnd = $('.mu-snd');
  btnSnd.addEventListener('click', () => { const on = sound.toggle(); btnSnd.classList.toggle('on', on); toast(on ? '소리 켬 — 펄서·보이저에 올리면 실제 주기로 재현한 소리, 블랙홀에선 중력파 처프' : '소리 끔'); });
  function soundFor(t) {
    if (!sound.on) return;
    if (t && t.dso) sound.hover(t.dso.kind, t.dso.name);
    else if (t && t.probe && /보이저 1/.test(t.probe.name)) sound.hover('voyager');
    else sound.hover(null);
  }
  // 실제 사진
  const photoEl = $('.mu-photo'), photoImg = photoEl.querySelector('img'), photoCap = photoEl.querySelector('span');
  let photoKey = '', photoTimer = 0;
  function photoName(t) {
    if (!t) return null;
    if (t.dso) return t.dso.name; if (t.gal) return t.gal.name; if (t.deep) return t.deep.name; if (t.comet) return t.comet.name;
    if (t.sat !== undefined && satSys) return satSys.sats[t.sat].name;
    if (t.sys) { const q = SYSTEMS.find((z) => z.id === t.sys); return q && q.name; }
    if (t.earthMoon) return '달';
    if (t.kind === 'moon' || t.name) return t.name;
    return null;
  }
  function showPhoto(t, rect) {
    const title = photoTitle(photoName(t));
    if (!title) { photoEl.hidden = true; photoKey = ''; return; }
    const place = () => {
      const w = 180, h = photoEl.offsetHeight || 150;
      let x = rect ? rect.x : W / 2 - w / 2, y = rect ? rect.y + rect.h + 6 : 70;
      if (y + h > H - 150) y = rect ? rect.y - h - 6 : 70;
      photoEl.style.left = `${Math.max(6, Math.min(W - w - 6, x))}px`; photoEl.style.top = `${Math.max(6, y)}px`;
    };
    if (photoKey === title) { place(); return; }
    photoKey = title;
    getPhoto(title).then((ph) => {
      if (photoKey !== title) return;
      if (!ph) { photoEl.hidden = true; return; }
      photoImg.onload = () => { if (photoKey === title) { photoEl.hidden = false; place(); } };
      photoImg.src = ph.src; photoCap.textContent = '실제 사진 · Wikipedia/Wikimedia Commons';
    });
    place();
  }
  // 빛의 속도로 여행
  const btnWarp = $('.mu-warp');
  let warpTarget = null, warpHideT = 0;
  function warpCandidate(t) {
    if (!t) return null;
    if (t.sky !== undefined && sky) { const r = sky.rows[t.sky]; return { name: r[0] || r[1] || '별', ly: r[4], wx: t.wx, wy: t.wy, s: 17.0 }; }
    if (t.deepStar) { const d = t.deepStar.L.d, i = t.deepStar.i; return { name: deepInfo(d, i)[0], ly: d.ly[i], wx: t.wx, wy: t.wy, s: 17.2 }; }
    if (t.dso) return { name: t.dso.name, ly: t.dso.ly, wx: t.dso.pos[0], wy: t.dso.pos[1], s: t.dso.ly > 20000 ? 19.6 : 18.2 };
    if (t.gal) return { name: t.gal.name, ly: t.gal.ly, wx: t.gal.pos[0], wy: t.gal.pos[1], s: 21.4 };
    if (t.deep) return { name: t.deep.name, ly: t.deep.mly * 1e6, wx: t.deep.pos[0], wy: t.deep.pos[1], s: Math.log10(t.deep.mly * MLY) - 0.2 };
    if (t.cat !== undefined && catalog) { const r = catalog.rows[t.cat]; return { name: r[0], ly: r[3], wx: catalog.x[t.cat], wy: catalog.y[t.cat], s: 17.0 }; }
    return null;
  }
  function offerWarp(t) {
    const c = warpCandidate(t);
    if (!c || !(c.ly > 0)) return;
    warpTarget = c;
    btnWarp.textContent = `▶▶ 광속으로 ${c.name.replace(/ \(.*\)$/, '')}까지`;
    btnWarp.hidden = false;
    clearTimeout(warpHideT); warpHideT = setTimeout(() => { btnWarp.hidden = true; }, 9000);
  }
  let warping = null, arrival = null;
  function drawArrival(time) {
    if (!arrival) return;
    const age = (performance.now() - arrival.t0) / 1000;
    if (age > 10) { arrival = null; return; }
    const [cx0, cy0] = getCam(s), m = mppAt(s);
    const X = W / 2 + (arrival.wx - cx0) / m, Y = H / 2 - (arrival.wy - cy0) / m;
    const g = octx, a = Math.min(1, (10 - age) / 2);
    g.globalAlpha = a; g.strokeStyle = '#3dff8f'; g.lineWidth = 1.5; g.shadowColor = 'rgba(61,255,143,.9)'; g.shadowBlur = 10;
    for (const k of [0, 0.5]) { const r = 8 + (((age + k) % 1) * 26); g.globalAlpha = a * (1 - ((age + k) % 1)); g.beginPath(); g.arc(X, Y, r, 0, Math.PI * 2); g.stroke(); }
    g.globalAlpha = a; g.fillStyle = '#eafff2'; g.beginPath(); g.arc(X, Y, 3, 0, Math.PI * 2); g.fill();
    g.font = '700 12px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; g.textAlign = 'center'; g.fillStyle = '#3dff8f';
    g.fillText(`도착 · ${arrival.name}`, X, Y - 30); g.shadowBlur = 0;
  }
  btnWarp.addEventListener('click', async () => {
    if (!warpTarget || warping) return;
    const tg = warpTarget; btnWarp.hidden = true;
    const { warpTo } = await import('./warp.js');
    warping = warpTo(root, { name: tg.name, ly: tg.ly, onArrive: () => {
      warping = null;
      arriveAt(tg);
      toast(`${tg.name} 도착 · 지구에서 ${fmtLy(tg.ly)} — 실제 광속이면 ${tg.ly < 1 ? Math.round(tg.ly * 365) + '일' : fmtLy(tg.ly).replace('광년', '년')} 걸려요`);
    } });
  });
  function arriveAt(tg) {
    if (focus) { exitFocus(); focus = null; }
    s = targetS = tg.s;
    const b = baseCam(s); pan = [tg.wx - b[0], tg.wy - b[1]]; panVel = [0, 0]; anchor = null;
    arrival = { wx: tg.wx, wy: tg.wy, name: tg.name.replace(/ \(.*\)$/, ''), t0: performance.now() };
  }
  // ── 이름으로 찾기 ──
  const findBox = $('.mu-findbox'), findIn = findBox.querySelector('input'), findList = findBox.querySelector('.mu-findlist');
  const norm = (t) => String(t || '').toLowerCase().replace(/[\s\-·()_.,']/g, '');
  const bigrams = (t) => { const a = []; for (let i = 0; i < t.length - 1; i++) a.push(t.slice(i, i + 2)); return a; };
  let findIdx = null;
  function buildFindIndex() {
    const idx = [], seen = new Set();
    const add = (names, label, sub, go, w = 0) => {
      const keys = names.filter(Boolean).map(norm).filter(Boolean);
      if (!keys.length || seen.has(label + sub)) return; seen.add(label + sub);
      idx.push({ keys, label, sub, go, w });
    };
    for (const n of Object.keys(PLANET_INFO)) add([n], n, '태양계 행성', () => enterFocus(n), 5);
    for (const ws of world.systems) add([ws.sys.name, ws.sys.catalog, ws.sys.id], ws.sys.name, `외계 행성계 · ${ws.sys.distLy}광년 · 행성 ${ws.sys.planets.length}개`, () => enterSystem(ws.sys.id), 4);
    const featCat = new Set(world.systems.map((ws) => ws.sys.catalog));
    if (catalog) catalog.rows.forEach((r, i) => !featCat.has(r[0]) && add([r[0]], r[0], `외계 행성계 · ${r[3] < 1000 ? r[3] : fmtKo(Math.round(r[3]))}광년 · 행성 ${r[7].length}개`, () => enterCatalog(i), 1));
    for (const g of world.lgGalaxies) add([g.name], g.name, '국부은하군 은하', () => arriveAt({ name: g.name, ly: 0, wx: g.pos[0], wy: g.pos[1], s: 21.4 }), 3);
    for (const d of world.lgDwarfs || []) if (d.pos) add([d.name], d.name, '왜소은하', () => arriveAt({ name: d.name, ly: d.ly || 0, wx: d.pos[0], wy: d.pos[1], s: 21.4 }), 1);
    for (const d of world.deepSpace) add([d.name], d.name, `${DEEP_KO[d.kind] || '천체'} · ${fmtLy(d.mly * 1e6)}`, () => arriveAt({ name: d.name, ly: d.mly * 1e6, wx: d.pos[0], wy: d.pos[1], s: Math.log10(d.mly * MLY) - 0.2 }), 2);
    if (sky) {
      for (const d of sky.dso) add([d.name, DSO_KO?.[d.kind]], d.name, `${DSO_KO?.[d.kind] || '천체'} · ${fmtLy(d.ly)}`, () => arriveAt({ name: d.name, ly: d.ly, wx: d.pos[0], wy: d.pos[1], s: d.ly > 20000 ? 19.6 : 18.2 }), 2);
      sky.rows.forEach((r, i) => { if (r[0] || r[1]) add([r[0], r[1]], (r[0] || r[1]).replace(/ \(.*\)$/, ''), `별 · ${fmtLy(r[4])}`, () => arriveAt({ name: r[0] || r[1], ly: r[4], wx: sky.x[i], wy: sky.y[i], s: 17.0 }), r[5] < 2 ? 2 : 0); });
    }
    return idx;
  }
  function findSearch(q) {
    const k = norm(q); if (!k) return [];
    const kb = bigrams(k);
    const out = [];
    for (const e of findIdx) {
      let best = 0;
      for (const key of e.keys) {
        let sc = 0;
        if (key === k) sc = 100; else if (key.startsWith(k)) sc = 80; else if (key.includes(k)) sc = 60;
        else if (kb.length) { const b = bigrams(key); const hit = kb.filter((x) => b.includes(x)).length; const dice = (2 * hit) / (kb.length + b.length); if (dice >= 0.4) sc = dice * 50; }
        best = Math.max(best, sc);
      }
      if (best) out.push([best + e.w, e]);
    }
    return out.sort((a, b) => b[0] - a[0]).slice(0, 10).map((x) => x[1]);
  }
  function renderFind() {
    const res = findSearch(findIn.value);
    findList.innerHTML = '';
    if (findIn.value.trim() && !res.length) { findList.innerHTML = '<div class="none">찾는 천체가 없어요</div>'; return; }
    for (const e of res) {
      const b = document.createElement('button'); b.textContent = e.label;
      const sp = document.createElement('span'); sp.textContent = e.sub; b.appendChild(sp);
      b.onclick = () => { findBox.hidden = true; findIn.blur(); e.go(); toast(`${e.label} · ${e.sub}`); };
      findList.appendChild(b);
    }
  }
  $('.mu-find').addEventListener('click', () => {
    findBox.hidden = !findBox.hidden;
    if (!findBox.hidden) { findIdx = buildFindIndex(); findIn.value = ''; renderFind(); setTimeout(() => findIn.focus(), 30); }
  });
  findIn.addEventListener('input', renderFind);
  findIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') findList.querySelector('button')?.click(); if (e.key === 'Escape') findBox.hidden = true; });
  for (const ev of ['pointerdown', 'wheel', 'touchstart']) findBox.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  // 탐사선 여행
  // ── 오른쪽 도구 메뉴 (열고 닫기) ──
  const menuBtn = document.createElement('button');
  menuBtn.className = 'mu-menu'; menuBtn.textContent = '≡'; menuBtn.setAttribute('aria-label', '메뉴 열기');
  const tools = document.createElement('div'); tools.className = 'mu-tools';
  const TOOL_LABEL = [['.mu-find', ''], ['.mu-g3', '은하 보기'], ['.mu-sky', '밤하늘'], ['.mu-more', 'Gaia 별'], ['.mu-trip', '탐사선 여행'], ['.mu-today', '오늘의 우주'], ['.mu-snd', '소리']];
  for (const [sel, lab] of TOOL_LABEL) { const b = root.querySelector(sel); if (!b) continue; b.dataset.label = lab; tools.appendChild(b); }
  root.querySelector('.mu-close').after(menuBtn, tools);
  const setMenu = (open) => { tools.classList.toggle('open', open); menuBtn.classList.toggle('on', open); menuBtn.textContent = '≡'; menuBtn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기'); if (open) menuBtn.classList.remove('ping'); };
  menuBtn.addEventListener('click', () => setMenu(!tools.classList.contains('open')));
  tools.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.matches('.mu-snd,.mu-more')) setMenu(false); });
  root.addEventListener('pointerdown', (e) => { if (tools.classList.contains('open') && !tools.contains(e.target) && e.target !== menuBtn) setMenu(false); }, true);
  // 새 버튼(3D·밤하늘 등)이 생기면 메뉴에 점 표시
  let toolSig = '';
  const watchTools = () => { const sig = [...tools.children].filter((b) => !b.hidden).map((b) => b.className).join('|'); if (toolSig && sig !== toolSig && sig.length > toolSig.length && !tools.classList.contains('open')) menuBtn.classList.add('ping'); toolSig = sig; };
  const btnTrip = $('.mu-trip');
  let tripView = null;
  async function openTrip(id = 'v1') {
    if (tripView) return;
    tripView = 'loading';
    try {
      const { openJourneys } = await import('./journeys.js');
      if (destroyed) return;
      cancelAnimationFrame(raf);
      tripView = openJourneys(root, { start: id, sound, onClose: () => { tripView = null; if (!destroyed && !g3) { last = performance.now(); raf = requestAnimationFrame(frame); } } });
    } catch (e) { tripView = null; toast('탐사선 여행을 열 수 없어요'); }
  }
  btnTrip.addEventListener('click', () => openTrip('v1'));
  // 오늘의 우주 카드 (하루 한 번 자동)
  const btnToday = $('.mu-today');
  async function showToday() {
    try { const { openToday } = await import('./today.js'); if (!destroyed) openToday(root, { loc: myLoc }); } catch { /* */ }
  }
  btnToday.addEventListener('click', showToday);
  try {
    const key = 'momentum.universe.today', d = new Date().toDateString();
    if (localStorage.getItem(key) !== d) { localStorage.setItem(key, d); setTimeout(() => { if (!destroyed) showToday(); }, 1200); }
  } catch { /* */ }
  // 밤하늘 모드
  const btnSky = $('.mu-sky');
  let skyView = null;
  btnSky.addEventListener('click', async () => {
    if (skyView) return;
    skyView = 'loading';
    try {
      const { openNightSky } = await import('./nightsky.js');
      if (destroyed) return;
      cancelAnimationFrame(raf);
      const base = starLayers.find((L) => !L.d.gaia);
      skyView = openNightSky(root, { sky, deep: base && base.d, loc: myLoc, sats: satSys, describeStar: (i) => hoverLabel({ sky: i }),
        onClose: () => { skyView = null; if (!destroyed && !g3) { last = performance.now(); raf = requestAnimationFrame(frame); } } });
    } catch (e) { skyView = null; toast('밤하늘 모드를 열 수 없어요'); }
  });
  // 블랙홀 체험
  let bhView = null;
  // 가까이 보기(행성계 3D · 인공위성 생김새)
  let cuView = null;
  async function openCloseup(fn, opts) {
    if (cuView || bhView) return;
    cuView = 'loading';
    try {
      const mod = await import('./closeup.js');
      if (destroyed) return;
      const paused = !g3;
      if (paused) cancelAnimationFrame(raf);
      cuView = mod[fn](root, { ...opts, onClose: () => { cuView = null; if (paused && !destroyed && !g3) { last = performance.now(); raf = requestAnimationFrame(frame); } } });
    } catch (e) { cuView = null; toast('가까이 보기를 열 수 없어요'); }
  }
  function openSys3D(planetName = null) {
    if (!focus || focus.kind !== 'star') return;
    const sys = focus.sys;
    const st = exoStates(sys, simDate(), focus.toEarth || 0);
    const phases = {}; sys.planets.forEach((p, i) => { phases[p.name] = st[i].angle; });
    openCloseup('openSystem3D', { sys, focusPlanet: planetName, phases });
  }
  function openSat3D(i) {
    const q = satSys.sats[i];
    openCloseup('openObject3D', { q: { ...q, alt: satSys.alt[i], vel: satSys.vel[i], desc: q.kind === 'debris' ? satSys.debrisKo(q.group) : `NORAD ${q.id}${q.year ? ` · ${q.year}년 발사` : ''}` } });
  }
  async function openBH(target) {
    if (bhView) return;
    bhView = 'loading';
    try {
      const { openBlackHole } = await import('./blackhole.js');
      if (destroyed) return;
      const paused = !g3; // 3D가 열려 있으면 2D는 이미 멈춤
      if (paused) cancelAnimationFrame(raf);
      bhView = openBlackHole(root, { target, sound, onClose: () => { bhView = null; if (paused && !destroyed && !g3) { last = performance.now(); raf = requestAnimationFrame(frame); } } });
    } catch (e) { bhView = null; toast('블랙홀 체험을 열 수 없어요'); }
  }
  const bhTarget = (name) => (/궁수자리 A/.test(name) ? 'sgra' : /백조자리 X-1|V404|GRS|A0620/.test(name) ? 'cygx1' : /가이아/.test(name) ? 'gaiabh3' : /M87/.test(name) ? 'm87'
    : /센타우루스 A/.test(name) ? 'cena' : /홈베리/.test(name) ? 'holm15a' : /TON 618/.test(name) ? 'ton618' : 'sgra');
  // 3D 은하 보기 (필요할 때만 불러옴)
  let g3 = null;
  const btn3d = $('.mu-g3');
  const btnMore = $('.mu-more');
  btnMore.addEventListener('click', () => toggleGaia());
  btn3d.addEventListener('click', async () => {
    if (g3) return;
    g3 = 'loading';
    const preset = s < 19.6 ? 'sun' : s < 22.2 ? 'mw' : s < 23.8 ? 'lg' : 'cosmos';
    try {
      const { openGalaxy3D } = await import('./galaxy3d.js');
      if (destroyed) return;
      cancelAnimationFrame(raf); // 2D 화면은 잠시 멈춤
      g3 = openGalaxy3D(root, {
        sky, exo: catalog, layers: starLayers.map((L) => L.d), describeDeep: deepInfo, subscribe: (f) => { g3Listeners.add(f); return () => g3Listeners.delete(f); },
        gaia: { toggle: () => toggleGaia(), get on() { return gaiaOn; }, view: (x0, x1, y0, y1, cell) => { if (gaiaOn) gaia.update(x0, x1, y0, y1, cell); } }, dwarfs: world.lgDwarfs, preset, dsoKo: DSO_KO,
        describeStar: (i) => hoverLabel({ sky: i }), openBH: (k) => openBH(k), photoFor: (name) => getPhoto(photoTitle(name)),
        onClose: () => { g3 = null; if (!destroyed) { last = performance.now(); raf = requestAnimationFrame(frame); } },
      });
    } catch (e) { g3 = null; toast('3D 보기를 열 수 없어요'); }
  });
  $('.mu-go-home').addEventListener('click', () => { ui.modal.hidden = true; setTarget(S_START); });
  $('.mu-stay').addEventListener('click', () => { ui.modal.hidden = true; });
  $('.mu-reset').addEventListener('click', () => {
    found.clear(); found.add('earth');
    store.found = [...found]; save();
    completedThisSession = false; sessionStart = performance.now();
    ui.modal.hidden = true; s = targetS = S_START;
  });

  function close() {
    if (onClose) onClose(); else destroy();
  }

  // ── 발견 처리 ──
  let toastTimer = 0;
  function toast(msg) {
    ui.hint.style.opacity = '0';
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
  }
  function checkDiscoveries() {
    // 정해진 경로(내 위치 중심) 근처에서만 단계 발견 — 다른 천체로 날아가 확대한 경우 제외
    if (focus || nearCtx || Math.hypot(pan[0], pan[1]) > mppAt(s) * Math.min(W, H) * 0.6) return;
    let newly = null;
    for (const lv of LEVELS) {
      if (s >= lv.at && !found.has(lv.id)) { found.add(lv.id); newly = lv; }
    }
    if (!newly) return;
    store.found = [...found]; save();
    toast(`새 구역 발견 · ${newly.name} [${found.size}/${LEVELS.length}]`);
    if (found.size === LEVELS.length && !completedThisSession) {
      completedThisSession = true;
      const ms = performance.now() - sessionStart;
      const isBest = store.bestMs == null || ms < store.bestMs;
      if (isBest) { store.bestMs = ms; save(); }
      setTimeout(() => showComplete(ms, isBest), 900);
    }
  }
  function showComplete(ms, isBest) {
    ui.time.textContent = `탐험 시간 ${fmtDuration(ms)}${isBest ? ' · 최고 기록 갱신' : ` · 최고 ${fmtDuration(store.bestMs)}`}`;
    const addr = LEVELS.filter((l) => l.addr).map((l) => l.addr).reverse();
    ui.addr.innerHTML = addr.map((a) => `<div>${a}</div>`).join('') + '<div class="me">나 (여기)</div>';
    ui.modal.hidden = false;
  }

  // ── HUD 갱신 ──
  const hudCache = {};
  const setText = (key, el, v, html = false) => { if (hudCache[key] !== v) { hudCache[key] = v; if (html) el.innerHTML = v; else el.textContent = v; } };
  // 화면 가운데에서 가장 가까운 이름 있는 천체 (배율에 맞는 종류만)
  function nearestNamed(c, span) {
    let best = null, bd = span * 0.18;
    const test = (name, x, y) => { const d = Math.hypot(c[0] - x, c[1] - y); if (d < bd) { bd = d; best = name; } };
    if (s >= 15.5 && s < 20.6) {
      test('태양', SUN[0], SUN[1]);
      if (sky) {
        for (let i = 0; i < sky.rows.length; i++) { const r = sky.rows[i]; if (r[0]) test(r[0].replace(/ \(.*\)$/, ''), sky.x[i], sky.y[i]); }
        if (s > 17.4) for (const d of sky.dso) test(d.name.replace(/ \(.*\)$/, ''), d.pos[0], d.pos[1]);
      }
    } else if (s >= 20.6 && s < 23.2) {
      if (Math.hypot(c[0] - GC[0], c[1] - GC[1]) < 60000 * LY) return null; // 우리은하 안이면 '우리은하'로 충분
      for (const g of world.lgGalaxies) test(g.name, g.pos[0], g.pos[1]);
      for (const d of world.lgDwarfs || []) if (d.pos) test(d.name, d.pos[0], d.pos[1]);
    } else if (s >= 23.2) {
      for (const d of world.deepSpace) test(d.name.replace(/ \(.*\)$/, ''), d.pos[0], d.pos[1]);
    }
    return best;
  }
  // 지금 화면 가운데가 우주의 어디인지 (큰 구조 → 작은 구조)
  function whereLine() {
    const c = getCam(s);
    const d = (p) => Math.hypot(c[0] - p[0], c[1] - p[1]);
    // [이름, 크기(반지름 m)] — 화면 폭에 비해 너무 작은 곳은 빼고 보여 줌
    const chain = [['관측 가능한 우주', Infinity]];
    if (d(LANI) < 260 * MLY) chain.push(['라니아케아 초은하단', 260 * MLY]);
    if (d(VIRGO) < 62 * MLY) chain.push(['처녀자리 초은하단', 55 * MLY]);
    if (d(VIRGO) < 7 * MLY) chain.push(['처녀자리 은하단', 7 * MLY]);
    if (d(LG_CENTER) < 5 * MLY) chain.push(['국부은하군', 5 * MLY]);
    const dGC = d(GC), dSun = d(SUN);
    if (dGC < 60000 * LY) {
      chain.push(['우리은하', 50000 * LY]);
      if (dGC < 4000 * LY) chain.push(['은하 중심부', 4000 * LY]);
      else if (dSun < 3000 * LY) chain.push(['오리온 팔', 3000 * LY]);
    } else if (d(ANDROMEDA) < 120000 * LY) chain.push(['안드로메다 은하', 110000 * LY]);
    else if (d(M33) < 40000 * LY) chain.push(['삼각형자리 은하', 30000 * LY]);
    else if (d(LMC) < 15000 * LY) chain.push(['대마젤란 은하', 15000 * LY]);
    else if (d(SMC) < 8000 * LY) chain.push(['소마젤란 은하', 8000 * LY]);
    if (focus && focus.on && focus.kind === 'star') {
      if (focus.sys.distLy < 50) chain.push(['태양 이웃', 50 * LY]);
      chain.push([`${focus.name} 행성계`, Infinity]);
    } else if (dSun < 50 * LY) {
      chain.push(['태양 이웃', 50 * LY]);
      if (dSun < 1.6 * LY) {
        if (dSun > 2000 * AU) chain.push(['오르트 구름', 1.6 * LY]);
        else if (dSun > 120 * AU) { chain.push(['태양계', 1.6 * LY]); chain.push(['태양권 바깥', 1000 * AU]); }
        else {
          chain.push(['태양계', 60 * AU]);
          if (focus && focus.on && focus.kind === 'planet') chain.push([focus.name, Infinity]);
          else if (Math.hypot(c[0], c[1]) < 1.2e9) chain.push(s < 8.7 ? ['지구', 6.4e6] : ['지구와 달', 4e8]);
        }
      }
    }
    const span = Math.pow(10, s);
    const vis = chain.filter(([, r], i) => i === 0 || r >= span * 0.12).map(([n]) => n);
    const near = !(focus && focus.on) && nearestNamed(c, span);
    if (near && !vis.includes(near)) vis.push(`${near} 근처`);
    const shown = vis.length > 5 ? ['…', ...vis.slice(-4)] : vis;
    return '위치 · ' + shown.map((t, i) => (i === shown.length - 1 ? `<b>${t}</b>` : t)).join(' › ');
  }
  // 1~12 단계 바 = 배율 슬라이더: 끌면 연속 확대·축소, 숫자를 탭하면 그 단계로
  const ladderS = (clientX) => {
    const r = ui.ladder.getBoundingClientRect();
    const f = Math.max(0, Math.min(0.9999, (clientX - r.left) / r.width)) * LEVELS.length;
    const i = Math.floor(f), a = i === 0 ? S_MIN : LEVELS[i].at, b = i + 1 < LEVELS.length ? LEVELS[i + 1].at : S_MAX;
    return { i, s: a + (f - i) * (b - a) };
  };
  let ladDrag = null;
  ui.ladder.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); ui.ladder.setPointerCapture(e.pointerId); ladDrag = { x: e.clientX, moved: false }; markInteracted(); });
  ui.ladder.addEventListener('pointermove', (e) => {
    if (!ladDrag) return;
    if (!ladDrag.moved && Math.abs(e.clientX - ladDrag.x) < 5) return;
    ladDrag.moved = true; setTarget(ladderS(e.clientX).s);
  });
  const ladUp = (e) => {
    if (!ladDrag) return;
    if (!ladDrag.moved) {
      const i = ladderS(e.clientX).i;
      if (focus) exitFocus();
      pan = [0, 0]; panVel = [0, 0]; anchor = null;
      const a = LEVELS[i].at, nx = i + 1 < LEVELS.length ? LEVELS[i + 1].at : S_MAX;
      setTarget(i === 0 ? S_START : Math.min(S_MAX, a + Math.min(0.6, (nx - a) * 0.4)));
    }
    ladDrag = null;
  };
  ui.ladder.addEventListener('pointerup', ladUp); ui.ladder.addEventListener('pointercancel', () => { ladDrag = null; });
  function updateHud() {
    btn3d.hidden = s < 16.5;
    btnSky.hidden = s > 12.5;
    btnTrip.hidden = s < 10.5 || s > 17.5;
    btnMore.hidden = s < 16.5 || s > 21.8;
    let idx = 0;
    for (let i = 0; i < LEVELS.length; i++) if (s >= LEVELS[i].at) idx = i;
    // 지구에서 멀리 벗어나 있으면 지구·달 단계 설명 대신 태양계 단계로
    if (idx < 2 && !focus && Math.hypot(pan[0], pan[1]) > mppAt(s) * Math.min(W, H) * 0.6) idx = 2;
    const lv = LEVELS[idx];
    const fmtCoord = (v, pos, neg) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`;
    let locLine = '';
    if (idx === 0) {
      const now = new Date();
      const elev = solarElevation(myLoc.lat, myLoc.lon, now);
      const phase = elev > 0 ? '낮' : elev > -6 ? '해질녘·새벽' : elev > -18 ? '어스름' : '밤';
      const hhmm = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
      locLine = ` · ${myLoc.label}${myLoc.approx ? '(기본값)' : ''} ${fmtCoord(myLoc.lat, 'N', 'S')}, ${fmtCoord(myLoc.lon, 'E', 'W')} · ${hhmm} ${phase} (태양 고도 ${elev.toFixed(0)}°)`;
    }
    const showCredit = !!earth.detailActive;
    if (hudCache.credit !== showCredit) { hudCache.credit = showCredit; ui.credit.hidden = !showCredit; }
    let extra = '';
    if (lv.id === 'solar' && seasonInfo) {
      const si = seasonInfo;
      const dateTxt = `${TODAY.getMonth() + 1}월 ${TODAY.getDate()}일`;
      extra = ` · 행성 배치는 오늘(${dateTxt}) 실제 위치 · 지구는 태양에서 ${fmtKo(si.distKm)} km, 초속 ${si.speedKms.toFixed(1)}km로 공전 중 · 북반구 ${si.season} · ${si.next.label}까지 ${si.next.days}일, 근일점까지 ${si.toPeri}일`;
    }
    if (lv.id === 'moon' && earth.gl && earth.moon) {
      const m = earth.moon;
      extra = ` · 오늘은 ${m.phase} (밝기 ${Math.round(m.illum * 100)}%) · 지금 거리 ${Math.round(m.distKm).toLocaleString('ko-KR')}km`;
    }
    if (lv.id === 'solar') extra += ' · 행성을 탭하면 위성이 보여요';
    if (lv.id === 'stars') extra += catalog ? ` · 확인된 외계 행성계 ${catalog.rows.length.toLocaleString('ko-KR')}곳(행성 ${catalog.nPlanets.toLocaleString('ko-KR')}개)이 점으로 찍혀 있어요 — 아무 별이나 탭해 방문 (데이터: Open Exoplanet Catalogue)` : ' · 표시된 별을 탭하면 그 행성계로 날아가요';
    if (lv.id === 'helio') {
      const v1 = world.probes[0];
      extra += ` · 보이저 1호는 지금 약 ${Math.round(v1.au)} AU (빛으로 ${(v1.au * 1.496e11 / 2.998e8 / 3600).toFixed(1)}시간) — 이미 태양권 밖 성간 공간이에요`;
    }
    if (lv.id === 'oort') {
      const v1 = world.probes[0];
      const yrs = Math.round((2000 - v1.au) / 3.58);
      extra += ` · 혜성의 고향. 보이저 1호도 안쪽 경계(약 2천 AU)까지 ${yrs}년, 바깥 끝(약 10만 AU)까지는 약 3만 년이 걸려요`;
    }
    const hud = focus && focus.on ? focus : nearCtx;
    if (!(focus && focus.on)) {
      // 가까이 다가가 보는 중: 배속 버튼만 보이기
      const want = !!nearCtx;
      if (hudCache.nearBar !== want) {
        hudCache.nearBar = want;
        ui.focusbar.hidden = !want;
        $('.mu-back').style.display = want ? 'none' : '';
      }
    } else if (hudCache.nearBar) { hudCache.nearBar = false; $('.mu-back').style.display = ''; }
    if (hud && hud.kind === 'star') {
      const sys = hud.sys;
      const sd = simDate();
      const when = sd.toLocaleString('ko-KR', { year: speedIdx === 3 ? 'numeric' : undefined, month: 'numeric', day: 'numeric', hour: speedIdx === 3 ? undefined : '2-digit', minute: speedIdx === 3 ? undefined : '2-digit', hour12: false });
      const dist = sys.distLy < 1000 ? `${sys.distLy}광년` : `약 ${fmtKo(sys.distLy)}광년`;
      setText('step', ui.step, 'SYS');
      setText('name', ui.name, `${sys.name} 행성계`);
      const nEx = sys.planets.filter((q) => q.t0).length;
      const posNote = nEx === sys.planets.length ? '행성 위치는 통과 관측 기반 실제 위치' : nEx ? `${nEx}개 행성은 실제 위치, 나머지는 근사` : '궤도 위 위치는 근사';
      setText('desc', ui.desc, `${dist} · ${sys.star.type}. ${sys.desc} (궤도 거리·주기는 실제, ${posNote}) · T ${when} (${SPEEDS[speedIdx][1]}) · 행성을 탭하면 정보가 나와요`);
    } else if (hud) {
      const info = PLANET_INFO[hud.name];
      const ms = MOONS[hud.name];
      const exactNote = hud.name === '목성' ? '' : ms ? ' (위성 거리·주기는 실제, 위치는 근사)' : '';
      const sd = simDate();
      const when = sd.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
      setText('step', ui.step, 'ORB');
      setText('name', ui.name, ms ? `${hud.name}과 위성들` : hud.name);
      setText('desc', ui.desc, `${info.moons}${exactNote} · T ${when} (${SPEEDS[speedIdx][1]})${ms ? ' · 위성을 탭하면 정보가 나와요' : ''}`);
    } else {
      setText('step', ui.step, `${String(idx + 1).padStart(2, '0')}/${LEVELS.length}`);
      setText('name', ui.name, lv.name);
      setText('desc', ui.desc, idx === 0 ? lv.desc + locLine : lv.desc + extra);
    }
    const span = Math.pow(10, s);
    // 12단계 사다리: 지금 단계 · 발견한 단계 · 연속 위치 표시
    const ladderKey = idx + ':' + [...found].join(',');
    if (hudCache.ladder !== ladderKey) {
      hudCache.ladder = ladderKey;
      ui.ladder.querySelectorAll('.mu-lv').forEach((b, i) => { b.classList.toggle('cur', i === idx); b.classList.toggle('found', found.has(LEVELS[i].id)); });
    }
    let frac = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      const a = i === 0 ? S_MIN : LEVELS[i].at, b = i + 1 < LEVELS.length ? LEVELS[i + 1].at : S_MAX;
      if (s >= a && (s < b || i === LEVELS.length - 1)) { frac = i + Math.min(1, Math.max(0, (s - a) / (b - a))); break; }
    }
    const lvW = ui.ladder.clientWidth;
    if (lvW) ui.lvMark.style.left = `${(frac / LEVELS.length) * lvW}px`;
    const lvName = hud && hud.kind === 'star' ? `${hud.sys.name} 행성계` : hud ? hud.name : `${String(idx + 1).padStart(2, '0')} ${LEVELS[idx].name}`;
    setText('lv', ui.lvText, `<b>${lvName}</b> · 폭 <b>${fmtLength(span)}</b> · 빛으로 ${fmtLightTime(span)} · 발견 ${found.size}/${LEVELS.length}`, true);
    setText('where', ui.where, whereLine(), true);
    watchTools();
  }

  // ── 도시 라벨 (확대할수록 더 많이) ──
  // [이름, 위도, 경도, 단계] 단계 1: 세계 주요 도시, 2: 국내·지역 도시
  const CITIES = [
    ['서울', 37.57, 126.98, 1], ['부산', 35.18, 129.08, 1], ['도쿄', 35.68, 139.69, 1], ['오사카', 34.69, 135.5, 1],
    ['베이징', 39.9, 116.4, 1], ['상하이', 31.23, 121.47, 1], ['홍콩', 22.32, 114.17, 1], ['타이베이', 25.03, 121.57, 1],
    ['마닐라', 14.6, 120.98, 1], ['싱가포르', 1.35, 103.82, 1], ['방콕', 13.76, 100.5, 1], ['하노이', 21.03, 105.85, 1],
    ['뭄바이', 19.08, 72.88, 1], ['델리', 28.61, 77.21, 1], ['두바이', 25.2, 55.27, 1], ['모스크바', 55.76, 37.62, 1],
    ['이스탄불', 41.01, 28.98, 1], ['카이로', 30.04, 31.24, 1], ['라고스', 6.52, 3.38, 1], ['나이로비', -1.29, 36.82, 1],
    ['요하네스버그', -26.2, 28.05, 1], ['런던', 51.51, -0.13, 1], ['파리', 48.86, 2.35, 1], ['베를린', 52.52, 13.4, 1],
    ['로마', 41.9, 12.5, 1], ['마드리드', 40.42, -3.7, 1], ['뉴욕', 40.71, -74.0, 1], ['시카고', 41.88, -87.63, 1],
    ['로스앤젤레스', 34.05, -118.24, 1], ['샌프란시스코', 37.77, -122.42, 1], ['밴쿠버', 49.28, -123.12, 1],
    ['멕시코시티', 19.43, -99.13, 1], ['상파울루', -23.55, -46.63, 1], ['부에노스아이레스', -34.6, -58.38, 1],
    ['리마', -12.05, -77.04, 1], ['시드니', -33.87, 151.21, 1], ['멜버른', -37.81, 144.96, 1], ['오클랜드', -36.85, 174.76, 1],
    ['자카르타', -6.21, 106.85, 1], ['블라디보스토크', 43.12, 131.89, 1], ['평양', 39.04, 125.76, 1],
    ['인천', 37.46, 126.71, 2], ['수원', 37.26, 127.03, 2], ['춘천', 37.88, 127.73, 2], ['강릉', 37.75, 128.88, 2],
    ['대전', 36.35, 127.38, 2], ['청주', 36.64, 127.49, 2], ['전주', 35.82, 127.15, 2], ['광주', 35.16, 126.85, 2],
    ['대구', 35.87, 128.6, 2], ['울산', 35.54, 129.31, 2], ['포항', 36.02, 129.34, 2], ['창원', 35.23, 128.68, 2],
    ['목포', 34.81, 126.39, 2], ['여수', 34.76, 127.66, 2], ['제주', 33.5, 126.53, 2], ['서귀포', 33.25, 126.56, 2],
    ['울릉도', 37.48, 130.9, 2], ['독도', 37.24, 131.87, 2], ['후쿠오카', 33.59, 130.4, 2], ['나고야', 35.18, 136.91, 2],
    ['삿포로', 43.06, 141.35, 2], ['다롄', 38.91, 121.6, 2], ['칭다오', 36.07, 120.38, 2], ['선양', 41.8, 123.43, 2],
  ];
  function drawCities(X, Y, R) {
    const t1 = smooth(320, 520, R), t2 = smooth(2600, 4200, R);
    if (t1 < 0.02) return;
    const pin = earth.project(myLoc.lat, myLoc.lon, X, Y, R);
    ctx.font = '600 11px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
    ctx.textAlign = 'left';
    for (const [name, la, lo, tier] of CITIES) {
      const a = tier === 1 ? t1 : t2;
      if (a < 0.02) continue;
      const p = earth.project(la, lo, X, Y, R);
      if (p.z < 0.12 || p.x < -40 || p.x > W + 40 || p.y < -20 || p.y > H + 20) continue;
      if (Math.hypot(p.x - pin.x, p.y - pin.y) < 34) continue; // 내 위치 핀과 겹치면 생략
      const al = a * smooth(0.12, 0.3, p.z);
      ctx.globalAlpha = al;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.strokeText(name, p.x + 5, p.y + 4);
      ctx.fillStyle = 'rgba(235,240,255,.95)';
      ctx.fillText(name, p.x + 5, p.y + 4);
    }
    ctx.globalAlpha = 1;
  }

  // 외계 행성계 카탈로그 점 찍기 (+ 탭 대상 등록)
  function drawCatalog(alpha, tappable, tint) {
    const mppNow = Math.pow(10, s) / Math.min(W, H);
    const [cx0, cy0] = getCam(s);
    const hw = W / 2, hh = H / 2;
    ctx.globalAlpha = alpha;
    for (const [col, idx] of catalog.groups) {
      ctx.fillStyle = tint ? `rgba(${tint},0.85)` : col;
      for (const i of idx) {
        const X = hw + (catalog.x[i] - cx0) / mppNow, Y = hh - (catalog.y[i] - cy0) / mppNow;
        if (X < -2 || X > W + 2 || Y < -2 || Y > H + 2) continue;
        ctx.fillRect(X - 0.9, Y - 0.9, 1.8, 1.8);
        if (tappable) lastPlanetScreen.push({ cat: i, x: X, y: Y, wx: catalog.x[i], wy: catalog.y[i] });
      }
    }
  }

  // ───────────── 소행성 · 혜성 · 성간 천체 ─────────────
  let small = null, smallReq = false, smallA = 0, smallKey = '', smallSel = null;
  const smallCv = document.createElement('canvas'), smallCtx = smallCv.getContext('2d');
  let smallImg = null, smallBuf = null;
  const CLASS_U32 = CLASS_COL.map((c) => { const m = c.match(/[\d.]+/g).map(Number); return ((255 << 24) | (m[2] << 16) | (m[1] << 8) | m[0]) >>> 0; });
  function drawSmall(a, camX, camY, mpp, time) {
    smallA = a;
    if (a < 0.02) return;
    if (!smallReq) { smallReq = true; loadSmallBodies().then((d) => { if (!destroyed) small = d; }).catch(() => { smallReq = false; }); }
    if (!small) return;
    const k = AU / mpp, ox = W / 2 - (camX - SUN[0]) / mpp, oy = H / 2 + (camY - SUN[1]) / mpp;
    const Wc = Math.max(1, Math.round(W * dpr)), Hc = Math.max(1, Math.round(H * dpr));
    const key = `${Wc}|${Hc}|${ox}|${oy}|${k}`;
    if (key !== smallKey) {
      smallKey = key;
      if (smallCv.width !== Wc || smallCv.height !== Hc) { smallCv.width = Wc; smallCv.height = Hc; smallImg = null; }
      if (!smallImg) { smallImg = smallCtx.createImageData(Wc, Hc); smallBuf = new Uint32Array(smallImg.data.buffer); }
      smallBuf.fill(0);
      const { x, y, cls } = small, kd = k * dpr, oxd = ox * dpr, oyd = oy * dpr, big = dpr >= 1.5;
      for (let i = 0; i < small.N; i++) {
        const X = (oxd + x[i] * kd) | 0, Y = (oyd - y[i] * kd) | 0;
        if (X < 0 || Y < 0 || X >= Wc - 1 || Y >= Hc - 1) continue;
        const j = Y * Wc + X, c = CLASS_U32[cls[i]];
        smallBuf[j] = c; if (big) { smallBuf[j + 1] = c; smallBuf[j + Wc] = c; smallBuf[j + Wc + 1] = c; }
      }
      smallCtx.putImageData(smallImg, 0, 0);
    }
    ctx.globalAlpha = a * 0.9;
    ctx.drawImage(smallCv, 0, 0, W, H);
    // 근지구 소행성(위험 천체는 더 밝게)
    for (const n of small.neos) {
      const X = ox + n.x * k, Y = oy - n.y * k;
      if (X < -3 || X > W + 3 || Y < -3 || Y > H + 3) continue;
      ctx.globalAlpha = a; ctx.fillStyle = n.pha ? '#ff4d5e' : '#ff9a7a';
      ctx.fillRect(X - 1.2, Y - 1.2, 2.4, 2.4);
    }
    // 선택한 천체 궤도
    if (smallSel && smallSel.line) {
      ctx.globalAlpha = a * 0.8; ctx.strokeStyle = '#3dff8f'; ctx.lineWidth = 1;
      ctx.beginPath(); smallSel.line.forEach(([px, py], i) => (i ? ctx.lineTo(ox + px * k, oy - py * k) : ctx.moveTo(ox + px * k, oy - py * k))); ctx.stroke();
    }
    // 혜성 · 성간 천체: 궤도선 + 현재 위치
    for (const c of small.comets) {
      const col = c.kind === 'iso' ? '255,110,255' : '120,230,255';
      ctx.globalAlpha = a * 0.45; ctx.strokeStyle = `rgb(${col})`; ctx.lineWidth = 1; ctx.setLineDash(c.kind === 'iso' ? [5, 4] : []);
      ctx.beginPath(); c.line.forEach(([px, py], i) => (i ? ctx.lineTo(ox + px * k, oy - py * k) : ctx.moveTo(ox + px * k, oy - py * k))); ctx.stroke(); ctx.setLineDash([]);
      const X = ox + c.x * k, Y = oy - c.y * k;
      if (X < -40 || X > W + 40 || Y < -20 || Y > H + 20) continue;
      ctx.globalAlpha = a; ctx.fillStyle = `rgb(${col})`;
      ctx.beginPath(); ctx.arc(X, Y, 2.6, 0, Math.PI * 2); ctx.fill();
      // 꼬리: 태양 반대쪽 (가까울수록 길게)
      if (c.r < 6) { const ux = c.x / c.r, uy = c.y / c.r, L = 26 / Math.max(0.6, c.r); ctx.globalAlpha = a * 0.6; ctx.strokeStyle = `rgb(${col})`; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + ux * L, Y - uy * L); ctx.stroke(); }
      ctx.globalAlpha = a; ctx.font = '600 10.5px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; ctx.textAlign = 'left';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(c.name, X + 6, Y - 5); ctx.fillStyle = `rgb(${col})`; ctx.fillText(c.name, X + 6, Y - 5);
      if (a > 0.3) lastPlanetScreen.push({ comet: c, hoverOnly: true, x: X, y: Y });
    }
    if (a > 0.3) {
      const txt = `소행성 ${small.N.toLocaleString('ko-KR')} · 근지구 ${small.neos.length.toLocaleString('ko-KR')} · 혜성·성간 천체 ${small.comets.length}`;
      ctx.globalAlpha = a * 0.8; ctx.font = '600 10.5px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(txt, W / 2, H - 170); ctx.fillStyle = '#d8c8a8'; ctx.fillText(txt, W / 2, H - 170);
    }
  }
  let smallPickC = { t: 0, px: -1, py: -1, hit: null };
  function pickSmall(px, py, r) {
    if (!small || smallA < 0.3) return null;
    const now = performance.now();
    if (smallPickC.px === px && smallPickC.py === py && now - smallPickC.t < 250) return smallPickC.hit;
    const [camX, camY] = getCam(s), mpp = mppAt(s), k = AU / mpp;
    const ox = W / 2 - (camX - SUN[0]) / mpp, oy = H / 2 + (camY - SUN[1]) / mpp;
    let best = null, bd = r * r;
    for (const n of small.neos) { const dx = ox + n.x * k - px, dy = oy - n.y * k - py, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = { neo: n }; } }
    const { x, y } = small;
    for (let i = 0; i < small.N; i++) {
      const dx = ox + x[i] * k - px; if (dx > r || dx < -r) continue;
      const dy = oy - y[i] * k - py, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = { ast: i }; }
    }
    let hit = null;
    if (best) {
      const bx = best.neo ? best.neo.x : x[best.ast], by = best.neo ? best.neo.y : y[best.ast];
      hit = { small: best, hoverOnly: true, x: ox + bx * k, y: oy - by * k };
    }
    smallPickC = { t: now, px, py, hit };
    return hit;
  }
  function smallInfo(b) {
    const fmtD = (km) => (km >= 1 ? `${km < 10 ? km.toFixed(1) : Math.round(km)}km` : `${Math.round(km * 1000)}m`);
    if (b.neo) {
      const n = b.neo;
      const per = Math.pow(n.a, 1.5);
      const next = (small.cad || []).find((c) => c.des === n.pdes && c.jd > jdNow());
      const cls = { APO: '아폴로형', ATE: '아텐형', AMO: '아모르형', IEO: '아티라형' }[n.klass] || '';
      smallSel = { line: orbitLine(n.el ? { ...n.el, q: n.a * (1 - n.e) } : n, 200) };
      return [n.name === n.pdes ? n.pdes : `${n.name} (${n.pdes})`, `근지구 소행성 · ${cls}${n.pha ? ' · 잠재적 위험 천체' : ''} · 지름 약 ${fmtD(n.diam || diamKm(n.H))}`,
        `궤도 ${n.a.toFixed(2)} AU · 공전 ${per.toFixed(2)}년${n.moidLd ? ` · 지구 궤도와 최소 ${n.moidLd.toFixed(1)}달거리` : ''}${next ? ` · 다음 근접 ${next.cd.slice(0, 11)} (${(next.dist * 389).toFixed(1)}달거리)` : ''}`];
    }
    const i = b.ast, a = small.a[i], e = small.e[i], Hm = small.H[i] / 10, cls = classifyIdx(i);
    smallSel = null;
    return [small.names[i] || `소행성 #${i + 1}`, `${CLASS_KO[cls]} · 지름 약 ${fmtD(diamKm(Hm))} · 궤도 ${a.toFixed(2)} AU`, `공전 ${Math.pow(a, 1.5).toFixed(1)}년 · 이심률 ${e.toFixed(2)} · 위치: 행성 중력 반영해 2026년 11월로 갱신`];
  }
  const classifyIdx = (i) => small.cls[i];

  // ───────────── 인공위성 ─────────────
  let satSys = null, satA = 0, satSX = new Float32Array(0), satSY = new Float32Array(0), satVis = new Uint8Array(0);
  let satKinds = null, satKindsN = -1, issPath = null, issPathAt = 0, issPasses = null, issPassAt = 0;
  const SAT_STYLE = { station: ['#3dff8f', 2.6], active: ['rgba(235,240,255,0.95)', 1.6], starlink: ['rgba(130,205,255,0.85)', 1.3], debris: ['rgba(255,140,90,0.9)', 1.4] };
  const SAT_KO = { station: '우주정거장', active: '인공위성', starlink: '스타링크 위성', debris: '우주쓰레기(파편)' };
  function drawSats(X, Y, R, a, time) {
    if (!satSys) satSys = createSatellites();
    const S = satSys, n = S.count;
    if (!n) return;
    S.step(5);
    if (satKindsN !== n) { // 종류별 인덱스
      satKinds = { station: [], starlink: [], active: [], debris: [] };
      S.sats.forEach((q, i) => satKinds[q.kind].push(i));
      satKindsN = n;
      satSX = new Float32Array(n); satSY = new Float32Array(n); satVis = new Uint8Array(n);
    }
    const v = earth.getView(), la = v.lat * DEG, lo = v.lon * DEG;
    const C = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)], E = [-Math.sin(lo), Math.cos(lo), 0], Nn = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
    const P = S.pos, ok = S.ok;
    const pr = (x, y, z) => [X + (x * E[0] + y * E[1] + z * E[2]) * R, Y - (x * Nn[0] + y * Nn[1] + z * Nn[2]) * R, x * C[0] + y * C[1] + z * C[2]];
    // ISS 궤도선
    const iss = S.sats.findIndex((q) => /^ISS/.test(q.name));
    if (iss >= 0 && ok[iss]) {
      if (!issPath || performance.now() - issPathAt > 15000) { issPath = S.orbitPath(iss); issPathAt = performance.now(); }
      ctx.globalAlpha = a * 0.55; ctx.strokeStyle = '#3dff8f'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); let pen = false;
      for (const [x, y, z] of issPath) { const q = pr(x, y, z); const hidden = q[2] < 0 && (q[0] - X) ** 2 + (q[1] - Y) ** 2 < R * R; if (hidden) { pen = false; continue; } if (!pen) { ctx.moveTo(q[0], q[1]); pen = true; } else ctx.lineTo(q[0], q[1]); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    for (const kind of ['debris', 'active', 'starlink', 'station']) {
      const [col, sz] = SAT_STYLE[kind];
      ctx.globalAlpha = a; ctx.fillStyle = col;
      const h = sz / 2;
      for (const i of satKinds[kind]) {
        satVis[i] = 0;
        if (!ok[i]) continue;
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const sx2 = X + (x * E[0] + y * E[1] + z * E[2]) * R, sy2 = Y - (x * Nn[0] + y * Nn[1] + z * Nn[2]) * R;
        if (sx2 < -4 || sx2 > W + 4 || sy2 < -4 || sy2 > H + 4) continue;
        const zz = x * C[0] + y * C[1] + z * C[2];
        if (zz < 0 && (sx2 - X) ** 2 + (sy2 - Y) ** 2 < R * R) continue; // 지구 뒤
        ctx.fillRect(sx2 - h, sy2 - h, sz, sz);
        satSX[i] = sx2; satSY[i] = sy2; satVis[i] = 1;
      }
    }
    // 정거장 라벨
    for (const i of satKinds.station) {
      if (!satVis[i]) continue;
      const nm = S.sats[i].name;
      const lab = /^ISS/.test(nm) ? 'ISS 국제우주정거장' : /CSS|TIANHE/.test(nm) ? '톈궁 우주정거장' : null;
      if (!lab) continue;
      ctx.globalAlpha = a; ctx.strokeStyle = '#3dff8f'; ctx.lineWidth = 1.2;
      const r2 = 5 + Math.sin(time * 4) * 1.2;
      ctx.beginPath(); ctx.arc(satSX[i], satSY[i], r2, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '700 11px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; ctx.textAlign = 'left';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(lab, satSX[i] + 9, satSY[i] - 6);
      ctx.fillStyle = '#a6ffcb'; ctx.fillText(lab, satSX[i] + 9, satSY[i] - 6);
    }
    // 범례
    if (a > 0.3 && S.ready) {
      const c = S.counts;
      const txt = `실시간 · 위성 ${(c.active + c.station).toLocaleString('ko-KR')} · 스타링크 ${c.starlink.toLocaleString('ko-KR')} · 우주쓰레기 ${c.debris.toLocaleString('ko-KR')} (CelesTrak)`;
      ctx.globalAlpha = a * 0.85; ctx.font = '600 10.5px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; const ly = Math.min(H - 170, Y + R * 1.08 + 18);
      ctx.strokeText(txt, W / 2, ly); ctx.fillStyle = '#a6ffcb'; ctx.fillText(txt, W / 2, ly);
    }
  }
  function pickSat(px, py, r) {
    if (!satSys || satA < 0.3) return null;
    let best = -1, bd = r * r;
    for (let i = 0; i < satVis.length; i++) {
      if (!satVis[i]) continue;
      const dx = satSX[i] - px, dy = satSY[i] - py, d2 = dx * dx + dy * dy;
      if (d2 < bd || (satSys.sats[i].kind === 'station' && d2 < bd * 2.5)) { bd = d2; best = i; }
    }
    return best < 0 ? null : { sat: best, hoverOnly: true, x: satSX[best], y: satSY[best] };
  }
  function satInfo(i) {
    const S = satSys, q = S.sats[i];
    const l2 = `${SAT_KO[q.kind]} · 고도 ${fmtKo(Math.round(S.alt[i]))}km · 초속 ${S.vel[i].toFixed(2)}km`;
    let l3 = q.kind === 'debris' ? S.debrisKo(q.group) : `NORAD ${q.id}${q.year ? ` · ${q.year}년 발사` : ''}`;
    if (/^ISS/.test(q.name)) {
      if (!issPasses || Date.now() - issPassAt > 10 * 60000) { issPasses = S.passes(i, myLoc.lat, myLoc.lon, (d) => solarElevation(myLoc.lat, myLoc.lon, d)); issPassAt = Date.now(); }
      const p = issPasses[0];
      const f = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
      l3 = p ? `${myLoc.label}에서 맨눈으로: ${f(p.start)} · 최고 ${Math.round(p.maxEl)}° · ${azKo(p.azStart)}→${azKo(p.azEnd)} (약 ${Math.max(1, Math.round((p.end - p.start) / 60000))}분)` : `${myLoc.label}에서 48시간 안에 맨눈으로 보이는 통과 없음`;
    }
    return [q.name, l2, l3];
  }

  // ───────────── 렌더링 ─────────────
  function render(time) {
    ctx = baseCtx;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#03040a';
    ctx.fillRect(0, 0, W, H);

    const mpp = Math.pow(10, s) / Math.min(W, H);
    const [camX, camY] = getCam(s);
    lastPlanetScreen.length = 0;
    lastMoonScreen.length = 0;
    const cx = W / 2, cy = H / 2;
    const sx = (x) => cx + (x - camX) / mpp;
    const sy = (y) => cy - (y - camY) / mpp;
    const onScreen = (x, y, m = 40) => x > -m && x < W + m && y > -m && y < H + m;

    const label = (text, x, y, a, { dy = -12, color = '#e8ecff', size = 12, align = 'center' } = {}) => {
      if (a < 0.05) return;
      const X = sx(x), Y = sy(y);
      if (!onScreen(X, Y, 80)) return;
      ctx.globalAlpha = a;
      ctx.font = `600 ${size}px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace`;
      ctx.textAlign = align;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.strokeText(text, X, Y + dy);
      // 기본 라벨은 야광 초록, 지정 색 라벨도 은은한 발광
      ctx.fillStyle = color === '#e8ecff' ? '#a6ffcb' : color;
      ctx.shadowColor = color === '#e8ecff' ? 'rgba(61,255,143,.8)' : color; ctx.shadowBlur = 5;
      ctx.fillText(text, X, Y + dy);
      ctx.shadowBlur = 0;
    };
    const circle = (x, y, rWorld, a, stroke, dash = null, lw = 1) => {
      const R = rWorld / mpp;
      if (a < 0.02 || R < 2 || R > 2e5) return;
      ctx.globalAlpha = a;
      ctx.strokeStyle = stroke; ctx.lineWidth = lw;
      ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.arc(sx(x), sy(y), R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    };
    const glow = (x, y, rPx, a, rgb) => {
      if (a < 0.02 || rPx < 0.5) return;
      const X = sx(x), Y = sy(y);
      if (!onScreen(X, Y, rPx)) return;
      const g = ctx.createRadialGradient(X, Y, 0, X, Y, rPx);
      g.addColorStop(0, `rgba(${rgb},1)`);
      g.addColorStop(0.25, `rgba(${rgb},0.45)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.globalAlpha = a; ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(X, Y, rPx, 0, Math.PI * 2); ctx.fill();
    };
    const drawCloud = (cloud, a, size = 1.5) => {
      if (a < 0.02) return;
      ctx.globalAlpha = a;
      for (const [color, pts] of cloud.groups) {
        ctx.fillStyle = color;
        for (let i = 0; i < pts.length; i += 2) {
          const X = cx + (pts[i] - camX) / mpp, Y = cy - (pts[i + 1] - camY) / mpp;
          if (X < -2 || X > W + 2 || Y < -2 || Y > H + 2) continue;
          ctx.fillRect(X, Y, size, size);
        }
      }
    };

    // 라벨 겹침 방지 배치
    const placedLabels = [];
    const tryLabel = (text, X, Y, a, color, size = 10, dy = -9) => {
      const w = text.length * size * 0.75 + 6, h = size + 4;
      const bx = X - w / 2, by = Y + dy - h;
      if (placedLabels.some((q) => bx < q.x + q.w && bx + w > q.x && by < q.y + q.h && by + h > q.y)) return false;
      placedLabels.push({ x: bx, y: by, w, h });
      ctx.globalAlpha = a;
      ctx.font = `600 ${size}px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(text, X, Y + dy);
      ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 4; ctx.fillText(text, X, Y + dy); ctx.shadowBlur = 0;
      return true;
    };
    const DSO_COL = { neb: '255,122,182', pn: '122,240,255', snr: '255,176,90', oc: '191,227,255', gc: '255,224,138', bh: '199,140,255', psr: '90,255,255', mag: '255,110,255', ns: '160,255,255', bd: '200,140,100', star: '255,154,106', cloud: '230,230,240', planet: '120,255,200' };
    const dsoIcon = (d, X, Y, a) => {
      const c = DSO_COL[d.kind];
      ctx.globalAlpha = a; ctx.strokeStyle = `rgba(${c},0.95)`; ctx.fillStyle = `rgba(${c},0.95)`; ctx.lineWidth = 1.2;
      const ring = (r, dash) => { ctx.setLineDash(dash || []); ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); };
      switch (d.kind) {
        case 'neb': case 'cloud': {
          const g = ctx.createRadialGradient(X, Y, 0, X, Y, 9);
          g.addColorStop(0, `rgba(${c},0.8)`); g.addColorStop(1, `rgba(${c},0)`);
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, 9, 0, Math.PI * 2); ctx.fill();
          if (d.kind === 'neb') ring(6, [2, 2]);
          break;
        }
        case 'pn': ring(4); ctx.fillRect(X - 0.7, Y - 0.7, 1.4, 1.4); break;
        case 'snr': ring(5.5, [3, 2]); break;
        case 'oc': for (let k = 0; k < 5; k++) { const an = k * 1.2566 + 0.3; ctx.fillRect(X + Math.cos(an) * 4 - 0.8, Y + Math.sin(an) * 4 - 0.8, 1.6, 1.6); } break;
        case 'gc': { const g = ctx.createRadialGradient(X, Y, 0, X, Y, 6); g.addColorStop(0, `rgba(${c},1)`); g.addColorStop(1, `rgba(${c},0)`); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, 6, 0, Math.PI * 2); ctx.fill(); break; }
        case 'bh': ctx.lineWidth = 2; ring(5); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(X, Y, 3.4, 0, Math.PI * 2); ctx.fill(); break;
        case 'psr': case 'mag': case 'ns': {
          ctx.fillRect(X - 1.3, Y - 1.3, 2.6, 2.6);
          if (d.kind !== 'ns') { const an = time * (d.kind === 'psr' ? 4 : 1.5); ctx.beginPath(); ctx.moveTo(X - Math.cos(an) * 8, Y - Math.sin(an) * 8); ctx.lineTo(X + Math.cos(an) * 8, Y + Math.sin(an) * 8); ctx.stroke(); }
          break;
        }
        case 'planet': ring(3.5); ctx.beginPath(); ctx.ellipse(X, Y, 6.5, 2, -0.4, 0, Math.PI * 2); ctx.stroke(); break;
        default: ctx.fillRect(X - 1.5, Y - 1.5, 3, 3); ctx.beginPath(); ctx.moveTo(X - 6, Y); ctx.lineTo(X + 6, Y); ctx.moveTo(X, Y - 6); ctx.lineTo(X, Y + 6); ctx.stroke();
      }
    };
    // 실제 별 + 성운·성단·블랙홀
    function drawSky() {
      if (!sky) return;
      const fk = focus ? 1 - focus.blend : 1;
      const aS = band(s, 16.2, 21.0) * fk;
      if (s > 15.8) requestDeep();
      drawDeep(aS * 0.9, camX, camY, mpp);
      if (aS > 0.02) {
        for (const b of sky.buckets) {
          ctx.globalAlpha = aS * (b.size >= 2.1 ? 1 : 0.8);
          ctx.fillStyle = `rgb(${b.rgb})`;
          const h = b.size / 2;
          for (const i of b.idx) {
            const X = cx + (sky.x[i] - camX) / mpp, Y = cy - (sky.y[i] - camY) / mpp;
            if (X < -4 || X > W + 4 || Y < -4 || Y > H + 4) continue;
            ctx.fillRect(X - h, Y - h, b.size, b.size);
            if (aS > 0.3) lastPlanetScreen.push({ sky: i, hoverOnly: true, x: X, y: Y, wx: sky.x[i], wy: sky.y[i] });
          }
        }
        // 고정 라벨(여기 · 추천 행성계) 자리는 비워 둠
        const keep = (wx, wy, w, dy) => { const X = sx(wx), Y = sy(wy); placedLabels.push({ x: X - w / 2, y: Y + dy - 14, w, h: 16 }); };
        keep(0, 0, 70, 22); keep(0, 0, 40, -6);
        for (const { sys, pos } of world.systems) keep(pos[0], pos[1], sys.name.length * 11 + 60, -13);
        // 밝은 별 반짝임 + 이름(겹치지 않게, 밝은 순)
        let nLab = 0;
        for (let i = 0; i < sky.rows.length && nLab < 26; i++) {
          const r = sky.rows[i];
          if (!r[0] || r[5] > 3.0) continue;
          const X = cx + (sky.x[i] - camX) / mpp, Y = cy - (sky.y[i] - camY) / mpp;
          if (!onScreen(X, Y, 0)) continue;
          if (r[5] < 1.6) glow(sky.x[i], sky.y[i], 6, aS * 0.8, '255,245,230');
          if (tryLabel(r[0].replace(/ \(.*\)$/, ''), X, Y, aS * 0.9, '#a6ffcb')) nLab++;
        }
      }
      const aD = band(s, 17.4, 22.4) * fk;
      if (aD > 0.02) {
        for (const d of sky.dso) {
          const X = sx(d.pos[0]), Y = sy(d.pos[1]);
          if (!onScreen(X, Y, 10)) continue;
          dsoIcon(d, X, Y, aD);
          if (aD > 0.3) lastPlanetScreen.push({ dso: d, hoverOnly: true, x: X, y: Y, wx: d.pos[0], wy: d.pos[1] });
        }
        for (const d of sky.dso) {
          const X = sx(d.pos[0]), Y = sy(d.pos[1]);
          if (onScreen(X, Y, 0)) tryLabel(d.name.replace(/ \(.*\)$/, ''), X, Y, aD * 0.85, `rgb(${DSO_COL[d.kind]})`, 10, -11);
        }
      }
    }
    // 은하군·은하단·거대 구조·가장 먼 천체 — 각자 어울리는 배율에서만 보임
    function drawDeepSpace() {
      const aAll = band(s, 22.6, 28);
      if (aAll < 0.02) return;
      const span = Math.max(W, H);
      for (const d of world.deepSpace) {
        const R = (d.mly * MLY) / mpp;
        const a = aAll * smooth(14, 40, R) * (1 - smooth(span * 1.2, span * 3, R));
        if (a < 0.03) continue;
        const X = sx(d.pos[0]), Y = sy(d.pos[1]);
        if (!onScreen(X, Y, 60)) continue;
        const col = { bh: '199,140,255', grp: '200,215,255', cl: '255,230,200', sc: '255,209,102', wall: '183,168,255', void: '120,140,200', far: '255,106,90', gal: '255,190,240' }[d.kind];
        ctx.globalAlpha = a; ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 1.2;
        if (d.kind === 'void') {
          const rv = (d.name.startsWith('목동') ? 165 : 60) * MLY / mpp;
          ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.arc(X, Y, Math.max(8, rv), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        } else if (d.kind === 'wall') {
          const len = ({ 'CfA2 장성': 500, '슬론 장성': 1370, '거대 호 (Giant Arc)': 3300, '빅 링 (Big Ring)': 1300, '헤라클레스-북쪽왕관자리 장성': 10000 }[d.name] || 1000) * MLY / mpp;
          ctx.setLineDash([3, 4]); ctx.beginPath();
          if (d.name.startsWith('빅 링')) ctx.arc(X, Y, Math.max(6, len / 2), 0, Math.PI * 2);
          else ctx.ellipse(X, Y, Math.max(8, len / 2), Math.max(3, len / 12), 0.6, 0, Math.PI * 2);
          ctx.stroke(); ctx.setLineDash([]);
        } else {
          glow(d.pos[0], d.pos[1], d.kind === 'cl' || d.kind === 'sc' ? 12 : 7, a, col);
          if (d.kind === 'bh') { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(X, Y, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(X, Y, 5.5, 0, Math.PI * 2); ctx.stroke(); }
          if (d.kind === 'far') { ctx.beginPath(); ctx.moveTo(X - 9, Y); ctx.lineTo(X - 4, Y); ctx.moveTo(X + 4, Y); ctx.lineTo(X + 9, Y); ctx.moveTo(X, Y - 9); ctx.lineTo(X, Y - 4); ctx.moveTo(X, Y + 4); ctx.lineTo(X, Y + 9); ctx.stroke(); }
          if (d.kind === 'sc') { ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(X, Y, 16, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
        }
        if (a > 0.3) lastPlanetScreen.push({ deep: d, hoverOnly: true, x: X, y: Y, wx: d.pos[0], wy: d.pos[1] });
        tryLabel(d.name.replace(/ \(.*\)$/, ''), X, Y, a * 0.9, `rgb(${col})`, 10, -13);
      }
    }

    // ── 관측 가능한 우주의 끝 (우주 배경 복사) ──
    const aObs = band(s, 26.0, 99);
    if (aObs > 0.02) {
      const R = R_OBS / mpp, X = sx(0), Y = sy(0);
      const g = ctx.createRadialGradient(X, Y, R * 0.94, X, Y, R * 1.08);
      g.addColorStop(0, 'rgba(255,140,70,0)');
      g.addColorStop(0.45, 'rgba(255,130,60,0.55)');
      g.addColorStop(0.7, 'rgba(160,40,30,0.45)');
      g.addColorStop(1, 'rgba(12,4,6,0.95)');
      ctx.globalAlpha = aObs; ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      label('관측 가능한 우주의 끝 · 우주 배경 복사', 0, R_OBS * 1.02, aObs, { dy: -6, color: '#ffb38a', size: 12 });
    }

    // ── 코스믹 웹 ──
    const aWeb = band(s, 25.0, 99);
    if (aWeb > 0.02) { // 필라멘트 구조(통계적 재현) — 선으로만
      ctx.globalAlpha = aWeb * 0.22; ctx.strokeStyle = '#8f7bff'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [a, b] of world.webEdges) { ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(b[0]), sy(b[1])); }
      ctx.stroke();
      label('코스믹 웹 필라멘트 (모양은 통계적 재현)', 0, -R_OBS * 0.55, aWeb * 0.7 * (1 - smooth(26.8, 27.1, s)), { color: '#b7a8ff', size: 10 });
    }
    drawDeepSpace(time);

    // ── 라니아케아 ──
    const aLani = band(s, 24.0, 26.4);
    if (aLani > 0.02) {
      ctx.globalAlpha = aLani * 0.35; ctx.strokeStyle = '#6fd3ff'; ctx.lineWidth = 1;
      for (const line of world.flows) {
        ctx.beginPath();
        for (let i = 0; i < line.length; i += 2) {
          const X = sx(line[i]), Y = sy(line[i + 1]);
          i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = aLani * 0.6; ctx.strokeStyle = '#ffd166'; ctx.setLineDash([6, 6]); ctx.beginPath();
      world.laniBoundary.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(sx(x), sy(y)) : ctx.lineTo(sx(x), sy(y))));
      ctx.stroke(); ctx.setLineDash([]);
      glow(GA[0], GA[1], 18, aLani * 0.8, '150,210,255');
      label('거대 인력체 (Great Attractor)', GA[0], GA[1], aLani * smooth(24.8, 25.0, s) * (1 - smooth(25.6, 25.9, s)), { dy: -16, color: '#9fdcff' });
      label('라니아케아 초은하단', LANI[0], LANI[1] + 285 * MLY, aLani * (1 - smooth(25.6, 25.9, s)), { color: '#ffd166', size: 13 });
    }

    // ── 처녀자리 초은하단 ──
    const aVir = band(s, 23.0, 25.6);
    if (aVir > 0.02) {
      glow(VIRGO[0], VIRGO[1], 22, aVir * 0.7, '255,230,200');
      label('처녀자리 은하단', VIRGO[0], VIRGO[1], aVir * (1 - smooth(24.5, 24.9, s)), { dy: -20 });
      label('국부은하군', 0, 0, aVir * smooth(23.8, 24.1, s) * (1 - smooth(24.4, 24.8, s)), { dy: 46, color: '#b7bfdc', size: 11 });
    }

    // ── 국부은하군 ──
    const aLG = band(s, 21.4, 24.6);
    if (aLG > 0.02) {
      for (const d of world.lgDwarfs) {
        const X = sx(d.pos[0]), Y = sy(d.pos[1]);
        if (!onScreen(X, Y, 10)) continue;
        glow(d.pos[0], d.pos[1], 4, aLG * 0.9, '200,215,255');
        if (aLG > 0.3) lastPlanetScreen.push({ gal: d, hoverOnly: true, x: X, y: Y, wx: d.pos[0], wy: d.pos[1] });
      }
      for (const g of world.lgGalaxies) {
        const rPx = g.r / mpp;
        const X = sx(g.pos[0]), Y = sy(g.pos[1]);
        if (!onScreen(X, Y, rPx * 2 + 20)) continue;
        const isMW = g.name === '우리은하';
        const a = aLG * (isMW ? smooth(21.8, 22.6, s) : 1);
        if (a > 0.3) lastPlanetScreen.push({ lgal: g, hoverOnly: true, x: X, y: Y, wx: g.pos[0], wy: g.pos[1] });
        if (rPx > 1) {
          ctx.save();
          ctx.translate(X, Y); ctx.rotate(g.rot); ctx.scale(1, g.ar);
          const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rPx * 1.2);
          gr.addColorStop(0, `rgba(${g.color},0.95)`);
          gr.addColorStop(0.3, `rgba(${g.color},0.35)`);
          gr.addColorStop(1, `rgba(${g.color},0)`);
          ctx.globalAlpha = a; ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(0, 0, rPx * 1.2, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        } else {
          glow(g.pos[0], g.pos[1], 5, a, g.color);
        }
        const showLabel = !g.small || rPx > 2;
        if (showLabel) label(g.name, g.pos[0], g.pos[1], aLG * (1 - smooth(23.4, 23.9, s)), { dy: -Math.max(16, rPx * g.ar + 10), size: 12 });
      }
    }

    // ── 우리은하 ──
    const aMW = band(s, 19.2, 23.0);
    if (aMW > 0.02) {
      glow(GC[0], GC[1], (55000 * LY) / mpp, aMW * 0.35, '200,190,255');
      drawCloud(world.galaxy, aMW * 0.55, 1.1);
      if (catalog) {
        const aC = aMW * (1 - smooth(21.6, 22.2, s)) * (focus ? 1 - focus.blend : 1);
        drawCatalog(aC, aC > 0.15, '120,255,210');
        label(`외계 행성계 ${catalog.rows.length.toLocaleString('ko-KR')}곳 — 지금까지 찾은 범위`, SUN[0], SUN[1] - 9000 * LY, aC * smooth(20.0, 20.5, s), { color: '#7ee0c3', size: 11 });
      }
      glow(GC[0], GC[1], (6000 * LY) / mpp, aMW * 0.7, '255,220,160');
      label('은하 중심 (궁수자리 A*)', GC[0], GC[1], aMW * (1 - smooth(21.8, 22.3, s)), { dy: -14, color: '#ffe0a8', size: 11 });
      glow(SUN[0], SUN[1], 4, aMW * smooth(20.4, 20.8, s), '255,240,200');
      label('태양 · 오리온 팔', SUN[0], SUN[1], aMW * smooth(20.4, 20.8, s) * (1 - smooth(21.8, 22.3, s)), { dy: -9, color: '#ffe8a8', size: 10 });
      label('우리은하', GC[0], GC[1] + 60000 * LY, aMW * (1 - smooth(21.8, 22.3, s)), { dy: 0, size: 14 });
    }

    // ── 이웃 별들 ──
    const aStars = band(s, 16.2, 20.2);
    drawSky(time);
    if (aStars > 0.02) {
      // 외계 행성계 (탭하면 이동)
      const aSys = aStars * (focus ? 1 - focus.blend : 1);
      if (catalog && aSys > 0.02) drawCatalog(aSys, aSys > 0.15);
      const placed = []; // 라벨 겹침 방지(위로 쌓기)
      for (const { sys, pos } of world.systems) {
        const X = sx(pos[0]), Y = sy(pos[1]);
        if (!onScreen(X, Y, 20) || aSys < 0.02) continue;
        glow(pos[0], pos[1], 9, aSys, sys.star.color);
        const pulse = 7 + 2 * Math.sin(time * 2.4 + sys.distLy);
        ctx.globalAlpha = aSys * 0.8; ctx.strokeStyle = '#7ee0c3'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(X, Y, pulse, 0, Math.PI * 2); ctx.stroke();
        let dy = -13;
        while (placed.some((q) => Math.abs(q.x - X) < 110 && Math.abs(q.y - (Y + dy)) < 14)) dy -= 14;
        placed.push({ x: X, y: Y + dy });
        if (dy < -13) { // 쌓인 라벨은 가는 선으로 별과 연결
          ctx.globalAlpha = aSys * 0.5; ctx.strokeStyle = '#7ee0c3'; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(X, Y - 8); ctx.lineTo(X, Y + dy + 4); ctx.stroke();
        }
        label(`◆ ${sys.name} 행성계`, pos[0], pos[1], aSys, { dy, color: '#9ff0d6', size: 11 });
        if (aSys > 0.3) lastPlanetScreen.push({ name: sys.name, sys: sys.id, x: X, y: Y, wx: pos[0], wy: pos[1] });
      }
    }

    // ── 오르트 구름 ──
    const aOort = band(s, 14.6, 18.2) * (focus ? 1 - focus.blend : 1);
    if (aOort > 0.02) {
      ctx.globalAlpha = aOort * 0.13 * smooth(14.9, 15.4, s); ctx.strokeStyle = '#9fc8ff'; ctx.lineWidth = 1;
      for (const pts of world.comets) {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
        ctx.stroke();
      }
      drawCloud(world.oort, aOort, 1.6);
      const aL = aOort * smooth(15.4, 15.9, s);
      circle(SUN[0], SUN[1], 2000 * AU, aL * 0.5, '#9fc8ff', [3, 5]);
      circle(SUN[0], SUN[1], 20000 * AU, aL * 0.45, '#9fc8ff', [3, 5]);
      circle(SUN[0], SUN[1], 100000 * AU, aL * 0.4, '#9fc8ff', [3, 5]);
      circle(SUN[0], SUN[1], 125000 * AU, aL * 0.5, '#ffd166', [2, 6]);
      label('내부 오르트 구름(힐스 구름) · 2천~2만 AU', SUN[0], SUN[1] + 2000 * AU, aL * (1 - smooth(15.9, 16.2, s)), { dy: -6, color: '#aad2ff', size: 11 });
      label('외부 오르트 구름 · 2만~10만 AU (약 1.6광년)', SUN[0], SUN[1] + 20000 * AU, aL * smooth(16.1, 16.4, s) * (1 - smooth(17.1, 17.4, s)), { dy: -6, color: '#aad2ff', size: 11 });
      label('태양 중력이 이기는 경계 · 약 2광년', SUN[0], SUN[1] - 125000 * AU, aL * smooth(16.6, 16.9, s) * (1 - smooth(17.1, 17.4, s)), { dy: 14, color: '#ffd166', size: 11 });
      label('장주기 혜성 궤도', world.comets[0][100][0], world.comets[0][100][1], aL * 0.8 * (1 - smooth(16.8, 17.2, s)), { dy: -6, color: '#9fc8ff', size: 10 });
    }
    // ── 소행성대 · 카이퍼 벨트 · 왜행성 · 탐사선 ──
    const aAst = band(s, 10.6, 13.2) * (focus ? 1 - focus.blend : 1);
    if (aAst > 0.02) {
      drawSmall(Math.max(aAst, band(s, 12.4, 15.6) * (focus ? 1 - focus.blend : 1)), camX, camY, mpp, time);
      label('소행성대 · 2.1~3.3 AU', SUN[0], SUN[1] - 3.3 * AU, aAst * smooth(11.4, 11.7, s), { dy: -6, color: '#d8c8a8', size: 10 });
    }
    const aKui = band(s, 12.4, 15.6) * (focus ? 1 - focus.blend : 1);
    if (aKui > 0.02) {
      if (aAst <= 0.02) drawSmall(aKui, camX, camY, mpp, time);
      label('카이퍼 벨트 · 30~50 AU', SUN[0], SUN[1] - 50 * AU, aKui * smooth(13.0, 13.3, s) * (1 - smooth(14.8, 15.2, s)), { dy: -6, color: '#aac4ff', size: 11 });
      // 명왕성 (실제 위치·궤도)
      ctx.globalAlpha = aKui * 0.35; ctx.strokeStyle = '#c6b3a0'; ctx.lineWidth = 1;
      ctx.beginPath(); world.pluto.path.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)))); ctx.stroke();
      glow(world.pluto.pos[0], world.pluto.pos[1], 5, aKui, '230,210,190');
      label(`명왕성 · ${world.pluto.r.toFixed(1)} AU`, world.pluto.pos[0], world.pluto.pos[1], aKui * (1 - smooth(14.0, 14.3, s)), { dy: -9, color: '#e8d8c8', size: 10 });
      for (const d of world.dwarfPlanets) {
        glow(d.pos[0], d.pos[1], 4, aKui, '220,220,235');
        label(`${d.name} · ${Math.round(d.au)} AU`, d.pos[0], d.pos[1], aKui * smooth(13.2, 13.5, s) * (1 - smooth(14.0, 14.3, s)), { dy: -8, color: '#d8dcef', size: 10 });
      }
    }
    const aPrb = band(s, 12.6, 16.2) * (focus ? 1 - focus.blend : 1);
    if (aPrb > 0.02) {
      for (const pr of world.probes) {
        const X = sx(pr.pos[0]), Y = sy(pr.pos[1]);
        if (!onScreen(X, Y, 40)) continue;
        // 태양에서 탐사선까지 지나온 길
        ctx.globalAlpha = aPrb * 0.25; ctx.strokeStyle = pr.alive ? '#ffd166' : '#aaa'; ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx(SUN[0]), sy(SUN[1])); ctx.lineTo(X, Y); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = aPrb; ctx.fillStyle = pr.alive ? '#ffd166' : '#bbbbbb';
        ctx.beginPath(); ctx.moveTo(X, Y - 4); ctx.lineTo(X + 4, Y); ctx.lineTo(X, Y + 4); ctx.lineTo(X - 4, Y); ctx.closePath(); ctx.fill();
        label(`▲ ${pr.name} · ${Math.round(pr.au)} AU${pr.alive ? '' : ' (교신 종료)'}`, pr.pos[0], pr.pos[1], aPrb * smooth(13.6, 13.9, s) * (1 - smooth(14.1, 14.4, s)), { dy: -9, color: pr.alive ? '#ffe08a' : '#c8c8c8', size: 10 });
        if (aPrb > 0.3) lastPlanetScreen.push({ name: pr.name, probe: pr, x: X, y: Y, wx: pr.pos[0], wy: pr.pos[1] });
      }
    }
    const aHelio = band(s, 12.8, 16.4) * (focus ? 1 - focus.blend : 1);
    circle(SUN[0], SUN[1], 120 * AU, aHelio * 0.7, '#7fd1ff', [4, 5], 1.2);
    label('태양권계면', SUN[0], SUN[1] + 120 * AU, aHelio * smooth(13.6, 14.0, s) * (1 - smooth(15.2, 15.6, s)), { dy: -6, color: '#7fd1ff', size: 11 });

    // ── 태양계 ──
    const aSol = band(s, 10.3, 15.6) * (focus ? 1 - focus.blend : 1); // 행성 포커스 중엔 숨김
    if (aSol > 0.02) {
      // 실제 궤도(타원) — 지구 궤도는 조금 더 밝게
      for (const p of world.planets) {
        const op = p.orbit / mpp;
        if (op < 3 || op > 2e5) continue;
        ctx.globalAlpha = aSol * (p.name === '지구' ? 0.55 : 0.3);
        ctx.strokeStyle = p.name === '지구' ? '#7fb6ff' : '#8fa2d8'; ctx.lineWidth = 1;
        ctx.beginPath();
        p.orbitPath.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
        ctx.stroke();
      }
      const sunR = 6.96e8 / mpp;
      glow(SUN[0], SUN[1], Math.max(sunR * 4, 14), aSol, '255,200,90');
      if (sunR > 1) {
        ctx.globalAlpha = aSol; ctx.fillStyle = '#ffe08a';
        ctx.beginPath(); ctx.arc(sx(SUN[0]), sy(SUN[1]), sunR, 0, Math.PI * 2); ctx.fill();
      }
      label('태양', SUN[0], SUN[1], aSol * (1 - smooth(13.6, 14.0, s)), { dy: -Math.max(16, sunR + 8), color: '#ffe08a' });
      for (const p of world.planets) {
        if (p.name === '지구') continue;
        const orbitPx = p.orbit / mpp;
        if (orbitPx < 6) continue;
        const rPx = Math.max(2, p.r / mpp);
        if (aSol > 0.25) lastPlanetScreen.push({ name: p.name, x: sx(p.pos[0]), y: sy(p.pos[1]), wx: p.pos[0], wy: p.pos[1] });
        ctx.globalAlpha = aSol; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(sx(p.pos[0]), sy(p.pos[1]), rPx, 0, Math.PI * 2); ctx.fill();
        if (orbitPx > 28) {
          const d = PERIOD_DAYS[p.name];
          const per = d < 1000 ? `${Math.round(d)}일` : `${(d / 365.25).toFixed(1)}년`;
          label(orbitPx > 70 ? `${p.name} · 공전 ${per}` : p.name, p.pos[0], p.pos[1], aSol, { dy: -Math.max(9, rPx + 6), size: 11, color: '#cfd6f5' });
        }
      }
    }

    // ── 행성계 상세: 탭해서 들어갔을 때(포커스) + 가까이 다가갔을 때(자동) ──
    const drawStarSystem = (sys, pos, fa, toEarth, starTarget) => {
      const X = sx(pos[0]), Y = sy(pos[1]);
      const AUpx = 1.495978707e11 / mpp;
      // 생명 가능 지대
      const h0 = sys.hz[0] * AUpx, h1 = sys.hz[1] * AUpx;
      if (h1 > 3) {
        ctx.globalAlpha = fa * 0.16; ctx.fillStyle = '#4fd1a5';
        ctx.beginPath(); ctx.arc(X, Y, h1, 0, Math.PI * 2); ctx.arc(X, Y, h0, 0, Math.PI * 2, true); ctx.fill();
        if (h1 > 40) label('생명 가능 지대', pos[0], pos[1] - ((sys.hz[0] + sys.hz[1]) / 2) * 1.495978707e11, fa * 0.9, { dy: 4, color: '#7ee0c3', size: 10 });
      }
      // 비교용: 우리 태양계 궤도
      const cr = sys.compare.au * AUpx;
      if (cr > 6 && cr < 4 * Math.max(W, H)) {
        ctx.globalAlpha = fa * 0.5; ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.arc(X, Y, cr, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        const ly = Y + cr * 0.71, lx = X - cr * 0.71;
        if (lx > 4 && ly < H - 160) {
          ctx.globalAlpha = fa * 0.85; ctx.font = '600 10px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
          ctx.textAlign = 'right'; ctx.fillStyle = '#ffd166'; ctx.fillText(sys.compare.label, lx - 4, ly + 12);
        }
      }
      const planets = exoStates(sys, simDate(), toEarth);
      for (const p of planets) {
        const orr = p.au * AUpx;
        if (orr < 3 || orr > 3e5) continue;
        ctx.globalAlpha = fa * 0.3; ctx.strokeStyle = '#9fb0e0'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(X, Y, orr, 0, Math.PI * 2); ctx.stroke();
      }
      // 별
      const starR = Math.max(8, (sys.star.radiusSun * 6.957e8) / mpp);
      glow(pos[0], pos[1], starR * 3.5, fa, sys.star.color);
      ctx.globalAlpha = fa; ctx.fillStyle = `rgb(${sys.star.color})`;
      ctx.beginPath(); ctx.arc(X, Y, starR, 0, Math.PI * 2); ctx.fill();
      label(sys.name, pos[0], pos[1], fa, { dy: -starR - 12, size: 13, color: '#fff2c8' });
      if (starTarget) lastPlanetScreen.push({ ...starTarget, x: X, y: Y, wx: pos[0], wy: pos[1] });
      // 행성
      ctx.font = '600 11px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
      ctx.textAlign = 'left';
      for (const p of planets) {
        const orr = p.au * AUpx;
        if (orr < starR + 2) continue;
        const mx = X + orr * Math.cos(p.angle), my = Y - orr * Math.sin(p.angle);
        if (mx < -30 || mx > W + 30 || my < -30 || my > H + 30) continue;
        const pr = Math.max(p.re > 4 ? 4.5 : 3, (p.radiusKm * 1000) / mpp);
        const ux = -Math.cos(p.angle), uy = Math.sin(p.angle); // 별 쪽
        ctx.globalAlpha = fa;
        const g2 = ctx.createRadialGradient(mx + ux * pr * 0.45, my + uy * pr * 0.45, 0, mx, my, pr);
        g2.addColorStop(0, '#ffffff'); g2.addColorStop(0.3, p.color); g2.addColorStop(1, 'rgba(14,14,26,1)');
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(mx, my, pr, 0, Math.PI * 2); ctx.fill();
        lastMoonScreen.push({ ...p, kind: 'exo', parent: sys.name, starT: sys.star.tempK, starR: sys.star.radiusSun, x: mx, y: my });
        if (orr > 16) {
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)';
          ctx.strokeText(p.short, mx + pr + 4, my + 4);
          ctx.fillStyle = p.color === '#6fc3a8' ? '#9ff0d6' : '#dfe6ff';
          ctx.fillText(p.short, mx + pr + 4, my + 4);
        }
      }
    };
    const drawPlanetSystem = (name, pos, fa) => {
      const pl = world.planets.find((q) => q.name === name);
      const X = sx(pos[0]), Y = sy(pos[1]);
      const pr = Math.max(7, (PLANET_INFO[name].radiusKm * 1000) / mpp);
      // 태양 방향(화면)
      const sd0 = [SUN[0] - pos[0], SUN[1] - pos[1]];
      const sl = Math.hypot(...sd0) || 1;
      const ux = sd0[0] / sl, uy = -sd0[1] / sl;
      const moons = moonStates(name, simDate());
      // 위성 궤도
      for (const m of moons) {
        const orr = (m.distKm * 1000) / mpp;
        if (orr < pr + 2 || orr > 3e5) continue;
        ctx.globalAlpha = fa * 0.28; ctx.strokeStyle = '#8fa2d8'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(X, Y, orr, 0, Math.PI * 2); ctx.stroke();
      }
      // 토성 고리(뒤쪽 절반)
      const ring = PLANET_INFO[name].rings;
      const drawRing = (a0, a1) => {
        ctx.globalAlpha = fa * 0.75;
        for (const [k, col, w] of [[1.55, 'rgba(210,190,150,0.8)', 0.35], [1.95, 'rgba(230,215,180,0.9)', 0.4], [2.2, 'rgba(190,175,140,0.6)', 0.12]]) {
          ctx.strokeStyle = col; ctx.lineWidth = pr * w;
          ctx.beginPath(); ctx.ellipse(X, Y, pr * k, pr * k * 0.42, -0.35, a0, a1); ctx.stroke();
        }
      };
      if (ring) drawRing(Math.PI, Math.PI * 2);
      // 행성 본체(태양 쪽이 밝게)
      ctx.globalAlpha = fa;
      const g = ctx.createRadialGradient(X + ux * pr * 0.45, Y + uy * pr * 0.45, pr * 0.1, X, Y, pr);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, pl.color); g.addColorStop(1, 'rgba(10,12,24,1)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(X, Y, pr, 0, Math.PI * 2); ctx.fill();
      if (name === '목성' && pr > 10) {
        ctx.save(); ctx.beginPath(); ctx.arc(X, Y, pr, 0, Math.PI * 2); ctx.clip();
        ctx.globalAlpha = fa * 0.35; ctx.fillStyle = '#8a5a3a';
        for (const [yy, hh] of [[-0.45, 0.1], [-0.18, 0.12], [0.12, 0.1], [0.38, 0.08]]) ctx.fillRect(X - pr, Y + yy * pr, pr * 2, hh * pr);
        ctx.restore();
      }
      if (ring) drawRing(0, Math.PI);
      label(pl.name, pos[0], pos[1], fa, { dy: -(ring ? pr * 1.2 : pr) - 10, size: 13, color: '#ffe8b0' });
      if (fa > 0.3) lastPlanetScreen.push({ name, x: X, y: Y, wx: pos[0], wy: pos[1] });
      // 위성
      ctx.font = '600 11px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
      ctx.textAlign = 'left';
      for (const m of moons) {
        const orr = (m.distKm * 1000) / mpp;
        if (orr < pr + 2) continue;
        const mx = X + orr * Math.cos(m.angle), my = Y - orr * Math.sin(m.angle);
        if (mx < -30 || mx > W + 30 || my < -30 || my > H + 30) continue;
        const mr = Math.max(2.4, (m.radiusKm * 1000) / mpp);
        ctx.globalAlpha = fa;
        const mg = ctx.createRadialGradient(mx + ux * mr * 0.4, my + uy * mr * 0.4, 0, mx, my, mr);
        mg.addColorStop(0, '#ffffff'); mg.addColorStop(0.3, m.color); mg.addColorStop(1, 'rgba(20,20,30,1)');
        ctx.fillStyle = mg;
        ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
        lastMoonScreen.push({ ...m, kind: 'moon', parent: name, x: mx, y: my });
        if (orr > 22) {
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)';
          ctx.strokeText(m.name, mx + mr + 4, my + 4);
          ctx.fillStyle = m.exact ? '#ffe08a' : '#dfe6ff';
          ctx.fillText(m.name, mx + mr + 4, my + 4);
        }
      }
    };
    if (focus && focus.kind === 'star' && focus.blend > 0.02) drawStarSystem(focus.sys, focus.pos, focus.blend, focus.toEarth, null);
    if (focus && focus.kind !== 'star' && focus.blend > 0.02) drawPlanetSystem(focus.name, focus.pos, focus.blend);
    {
      const autoA = 1 - (focus ? focus.blend : 0);
      let nearBest = null;
      const centerR = Math.min(W, H) * 0.35;
      // 행성에 다가가면: 행성 본체·고리·위성
      const aPl = (1 - smooth(10.4, 11.3, s)) * autoA;
      if (aPl > 0.02) {
        for (const p of world.planets) {
          if (p.name === '지구') continue;
          if (!onScreen(sx(p.pos[0]), sy(p.pos[1]), 250)) continue;
          drawPlanetSystem(p.name, p.pos, aPl);
          const d = Math.hypot(sx(p.pos[0]) - W / 2, sy(p.pos[1]) - H / 2);
          if (aPl > 0.5 && d < centerR && (!nearBest || d < nearBest.d)) nearBest = { kind: 'planet', name: p.name, d };
        }
      }
      // (행성 근처 판정은 아래 별 판정 뒤에 확정)
      // 별에 다가가면: 그 별의 행성계 (화면 근처 최대 6곳)
      const aEx = (1 - smooth(15.5, 16.6, s)) * autoA;
      if (aEx > 0.02) {
        const cand = [];
        const near = (wx, wy) => { const X = sx(wx), Y = sy(wy); return onScreen(X, Y, 300) ? Math.hypot(X - W / 2, Y - H / 2) : -1; };
        for (const ws of world.systems) { const d = near(ws.pos[0], ws.pos[1]); if (d >= 0) cand.push({ d, sys: ws.sys, pos: ws.pos, target: { sys: ws.sys.id } }); }
        if (catalog) {
          for (let i = 0; i < catalog.rows.length; i++) {
            const d = near(catalog.x[i], catalog.y[i]);
            if (d < 0 || catalog.featuredNames.has(catalog.rows[i][0])) continue;
            cand.push({ d, i, pos: [catalog.x[i], catalog.y[i]], target: { cat: i } });
          }
        }
        cand.sort((a, b) => a.d - b.d);
        for (const cd of cand.slice(0, 6)) {
          let sys = cd.sys;
          if (!sys) { sys = sysCache.get(cd.i); if (!sys) { sys = catalogToSystem(catalog.rows[cd.i]); sysCache.set(cd.i, sys); } }
          drawStarSystem(sys, cd.pos, aEx, Math.atan2(SUN[1] - cd.pos[1], SUN[0] - cd.pos[0]), cd.target);
          if (aEx > 0.5 && cd.d < centerR && (!nearBest || cd.d < nearBest.d)) nearBest = { kind: 'star', sys, d: cd.d };
        }
      }
      nearCtx = nearBest;
    }

    // ── 달 ──
    const aMoon = band(s, 6.0, 11.0);
    if (aMoon > 0.02 && !earth.gl) {
      circle(0, 0, 3.844e8, aMoon * 0.35, '#8fa2d8');
      const mr = Math.max(1.5, 1.737e6 / mpp);
      ctx.globalAlpha = aMoon; ctx.fillStyle = '#c9c9c9';
      ctx.beginPath(); ctx.arc(sx(MOON[0]), sy(MOON[1]), mr, 0, Math.PI * 2); ctx.fill();
      label('달', MOON[0], MOON[1], aMoon * smooth(8.4, 8.8, s), { dy: -Math.max(10, mr + 6), size: 11 });
    }

    // ── 지구 ──
    const er = 6.371e6 / mpp;
    const moonVisible = earth.gl && aMoon > 0.02;
    if (er >= 0.6 || moonVisible) {
      const X = sx(0), Y = sy(0);
      if (onScreen(X, Y, er * 1.2) || moonVisible) {
        ctx.globalAlpha = 1;
        if (earth.gl) {
          // 3D: 대기광은 바닥 레이어에, 지구·달은 WebGL 레이어에, 라벨은 오버레이에
          earth.draw(baseCtx, X, Y, er, time, dpr, W, H, false, { moonAlpha: aMoon * 0.35 });
          ctx = octx;
          if (er < 1.5) { ctx.globalAlpha = 1; ctx.fillStyle = '#5fa8ff'; ctx.beginPath(); ctx.arc(X, Y, 1.2, 0, Math.PI * 2); ctx.fill(); }
          if (aMoon > 0.02) {
            const m = earth.moonScreen(X, Y, er);
            if (aMoon > 0.3 && !(m.z < 0 && (m.x - X) ** 2 + (m.y - Y) ** 2 < er * er)) lastPlanetScreen.push({ earthMoon: true, hoverOnly: true, x: m.x, y: m.y });
            if (m.r < 1.5) { ctx.globalAlpha = aMoon; ctx.fillStyle = '#c9c9c9'; ctx.beginPath(); ctx.arc(m.x, m.y, 1.5, 0, Math.PI * 2); ctx.fill(); }
            const la = aMoon * smooth(8.4, 8.8, s);
            if (la > 0.05 && m.x > -60 && m.x < W + 60 && m.y > -30 && m.y < H + 30) {
              ctx.globalAlpha = la;
              ctx.font = '600 11px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
              ctx.textAlign = 'center';
              ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
              const ty = m.y - Math.max(10, m.r + 6);
              ctx.strokeText('달', m.x, ty); ctx.fillStyle = '#e8ecff'; ctx.fillText('달', m.x, ty);
            }
          }
        }
        if (er > 5) {
          if (!earth.gl) earth.draw(ctx, X, Y, er, time, dpr, W, H, Math.abs(targetS - s) > 0.003 || zoomVel !== 0);
          ctx = octx;
          drawCities(X, Y, er);
          // 📍 내 위치 핀
          const p = earth.project(myLoc.lat, myLoc.lon, X, Y, er);
          const pa = smooth(-0.02, 0.18, p.z);
          if (pa > 0.02 && er > 14) {
            const pulse = 1 + 0.5 * ((time * 1.2) % 1);
            ctx.globalAlpha = pa * (1.5 - pulse);
            ctx.strokeStyle = '#ff5d73'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(p.x, p.y, 7 * pulse, 0, Math.PI * 2); ctx.stroke();
            ctx.globalAlpha = pa;
            ctx.fillStyle = '#ff5d73';
            ctx.beginPath(); ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
            if (er > 40) {
              // 핀에서 위로 짧은 선 + 라벨
              const lx = p.x, ly = p.y - 26;
              ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(lx, ly + 6); ctx.stroke();
              const txt = `◉ ${myLoc.label}`;
              ctx.font = '700 13px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
              ctx.textAlign = 'center';
              ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)';
              ctx.strokeText(txt, lx, ly);
              ctx.fillStyle = '#fff'; ctx.fillText(txt, lx, ly);
            }
          }
        } else if (!earth.gl) {
          ctx.fillStyle = '#5fa8ff';
          ctx.beginPath(); ctx.arc(X, Y, Math.max(er, 1), 0, Math.PI * 2); ctx.fill();
        }
        // ── 인공위성 · 우주쓰레기 (실시간) ──
        const aSat = smooth(5.3, 5.9, s) * (1 - smooth(8.7, 9.3, s)) * (focus ? 1 - focus.blend : 1);
        satA = aSat;
        if (aSat > 0.02 && er > 2) drawSats(X, Y, er, aSat, time);
      }
    }
    earth.endFrame?.();
    ctx = octx; // 이후(여기 마커)는 지구 위에

    // ── "여기" 마커 ──
    const aHere = smooth(8.0, 8.8, s);
    if (aHere > 0.02) {
      const X = sx(0), Y = sy(0);
      if (onScreen(X, Y, 20)) {
        const pulse = 9 + 3 * Math.sin(time * 3);
        ctx.globalAlpha = aHere;
        ctx.strokeStyle = '#3dff8f'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(X, Y, pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = aHere * 0.35;
        ctx.beginPath(); ctx.arc(X, Y, pulse + 7, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = aHere; ctx.fillStyle = '#3dff8f';
        ctx.beginPath(); ctx.arc(X, Y, 2.2, 0, Math.PI * 2); ctx.fill();
        const txt = s > 26.6 ? '여기 = 관측 가능한 우주의 중심' : '여기';
        label(txt, 0, 0, aHere, { dy: 30, color: '#3dff8f', size: 12 });
      }
    }
    drawArrival(time);
    drawHover(time);
    ctx.globalAlpha = 1;
  }

  // ───────────── 루프 ─────────────
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (zoomVel) setTarget(targetS + zoomVel * dt);
    if (pointers.size === 0 && (Math.abs(spin.vx) + Math.abs(spin.vy)) > 1e-5 && canSpin()) {
      earth.rotateBy(spin.vx, spin.vy);
      spin.vx *= 0.93; spin.vy *= 0.93;
    }
    s += (targetS - s) * Math.min(1, dt * 7);
    applyAnchor();
    if (pointers.size === 0 && !anchor && (Math.abs(panVel[0]) + Math.abs(panVel[1])) > 0) {
      pan = [pan[0] + panVel[0], pan[1] + panVel[1]];
      panVel = [panVel[0] * 0.9, panVel[1] * 0.9];
      if (Math.hypot(...panVel) < mppAt(s) * 0.05) panVel = [0, 0];
    }
    // 지구 근처로 들어오면(가리킨 확대가 아닐 때) 이동한 것을 서서히 되돌려 지구를 화면 중앙에
    if (!anchor && pointers.size === 0 && targetS < 9.3 && !focus && (pan[0] || pan[1])) {
      const k = Math.min(1, dt * 3);
      pan = [pan[0] * (1 - k), pan[1] * (1 - k)];
      if (Math.hypot(...pan) < mppAt(s) * 0.5) pan = [0, 0];
    }
    if (focus) {
      focus.blend += ((focus.on ? 1 : 0) - focus.blend) * Math.min(1, dt * 3);
      if (focus.on && targetS > focus.sView + 2.6) exitFocus(); // 충분히 멀어지면 자동 해제
      if (!focus.on && focus.blend < 0.02) focus = null;
    }
    if (Math.abs(targetS - s) < 1e-4) s = targetS;
    checkDiscoveries();
    render(now / 1000);
    updateHud();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function destroy() {
    destroyed = true;
    if (g3 && g3 !== 'loading') g3.destroy();
    if (bhView && bhView !== 'loading') bhView.destroy();
    if (skyView && skyView !== 'loading') skyView.destroy();
    if (tripView && tripView !== 'loading') tripView.destroy();
    warping?.cancel();
    sound.destroy();
    cancelAnimationFrame(raf);
    clearTimeout(toastTimer);
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
    earth.destroy?.();
    root.remove();
  }

  return {
    destroy,
    /** 테스트/디버그용: 특정 배율로 이동 */
    zoomTo: (v) => setTarget(v),
    /** 테스트/디버그용: 행성 포커스 */
    focusPlanet: (name) => enterFocus(name),
    focusSystem: (id) => enterSystem(id),
    sys3d: (p) => openSys3D(p),
    find: (q) => { findIdx = buildFindIndex(); return findSearch(q).map((e) => e.label + ' | ' + e.sub); },
    closeup: (fn, o) => openCloseup(fn, o),
    get scale() { return s; },
    get camInfo() { return { s, targetS, cam: getCam(s), pan, LY }; },
    get gaiaInfo() { return { on: gaiaOn, loaded: gaia.loadedCount, loading: gaia.loading, ready: gaia.ready, failed: gaia.failed, layers: starLayers.length }; },
  };
}
