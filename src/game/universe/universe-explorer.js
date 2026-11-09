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

// ───────────────────────── 단위 / 상수 ─────────────────────────
const LY = 9.4607e15;          // 1광년 (m)
const AU = 1.496e11;           // 1천문단위 (m)
const MLY = 1e6 * LY;          // 100만 광년
const R_OBS = 46.5e9 * LY;     // 관측 가능한 우주 반지름
const C = 2.998e8;             // 빛의 속도

// s = log10(화면 짧은 변이 담는 실제 길이, m)
const S_MIN = 5.0;   // 약 100 km (지구 표면 확대)
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
const SUN = [-AU, 0];
const MOON = P(3.844e8, 0.6);
const GC = [-26000 * LY, 0];                // 우리은하 중심
const ANDROMEDA = P(2.5 * MLY, 2.2);
const M33 = P(2.73 * MLY, 2.75);
const LMC = P(160e3 * LY, -2.0);
const SMC = P(200e3 * LY, -2.25);
const LG_CENTER = scale2(ANDROMEDA, 0.45);
const VIRGO = P(54 * MLY, 0.85);
const GA = P(250 * MLY, 0.35);              // 거대 인력체
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
    const ang = name === '지구' ? 0 : rnd() * Math.PI * 2;
    return { name, orbit: a * AU, r, color, pos: P(a * AU, ang, SUN) };
  });

  // 오르트 구름
  const oort = new Cloud();
  for (let i = 0; i < 900; i++) {
    const r = Math.pow(10, 3.3 + rnd() * 1.7) * AU;
    const [x, y] = P(r, rnd() * Math.PI * 2, SUN);
    oort.add(rnd() < 0.5 ? 'rgba(170,210,255,0.55)' : 'rgba(220,235,255,0.35)', x, y);
  }

  // 이웃 별
  const namedStars = [
    ['프록시마 센타우리', 4.24, 0.9, '#ff9d6e'], ['바너드 별', 5.96, 1.9, '#ff8a5c'],
    ['시리우스', 8.6, -1.1, '#cfe3ff'], ['베가', 25, 1.9, '#d9e8ff'], ['아크투루스', 36.7, -2.4, '#ffc58a'],
  ].map(([name, d, a, color]) => ({ name, color, pos: P(d * LY, a, SUN) }));
  const stars = new Cloud();
  const starColors = ['rgba(255,244,230,0.9)', 'rgba(200,220,255,0.9)', 'rgba(255,200,150,0.85)', 'rgba(255,170,130,0.8)'];
  for (let i = 0; i < 380; i++) {
    const [x, y] = inDisk(90 * LY);
    stars.add(starColors[(rnd() * starColors.length) | 0], x + SUN[0], y + SUN[1]);
  }

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
  const dwarfs = new Cloud();
  for (let i = 0; i < 45; i++) dwarfs.add('rgba(210,220,255,0.7)', GC[0] + gauss() * 0.35 * MLY, GC[1] + gauss() * 0.35 * MLY);
  for (let i = 0; i < 35; i++) dwarfs.add('rgba(210,220,255,0.7)', ANDROMEDA[0] + gauss() * 0.4 * MLY, ANDROMEDA[1] + gauss() * 0.4 * MLY);

  // 처녀자리 초은하단
  const virgo = new Cloud();
  const galCols = ['rgba(255,235,210,0.8)', 'rgba(200,215,255,0.8)', 'rgba(255,255,255,0.6)'];
  const gc = () => galCols[(rnd() * galCols.length) | 0];
  for (let i = 0; i < 750; i++) virgo.add(gc(), VIRGO[0] + gauss() * 5 * MLY, VIRGO[1] + gauss() * 3.5 * MLY);
  const vCenter = scale2(VIRGO, 0.55);
  for (let g = 0; g < 11; g++) {
    const [ox, oy] = inDisk(55 * MLY);
    for (let i = 0; i < 55; i++) virgo.add(gc(), vCenter[0] + ox + gauss() * 1.8 * MLY, vCenter[1] + oy + gauss() * 1.8 * MLY);
  }
  for (let i = 0; i < 500; i++) {
    const [x, y] = inDisk(62 * MLY);
    virgo.add('rgba(190,205,255,0.45)', vCenter[0] + x, vCenter[1] + y);
  }
  for (let i = 0; i < 24; i++) virgo.add(gc(), gauss() * 0.7 * MLY, gauss() * 0.7 * MLY);

  // 라니아케아
  const laniR = (th) => 270 * MLY * (1 + 0.1 * Math.sin(3 * th + 1) + 0.06 * Math.cos(5 * th));
  const laniBoundary = [];
  for (let i = 0; i <= 120; i++) {
    const th = (i / 120) * Math.PI * 2;
    laniBoundary.push(P(laniR(th), th, LANI));
  }
  const lani = new Cloud();
  const inLani = () => {
    const th = rnd() * Math.PI * 2;
    return P(laniR(th) * Math.sqrt(rnd()), th, LANI);
  };
  for (let i = 0; i < 650; i++) lani.add(gc(), GA[0] + gauss() * 13 * MLY, GA[1] + gauss() * 13 * MLY);
  for (let c = 0; c < 18; c++) {
    const [cx, cy] = inLani();
    for (let i = 0; i < 90; i++) lani.add(gc(), cx + gauss() * 6 * MLY, cy + gauss() * 6 * MLY);
  }
  for (let i = 0; i < 1300; i++) {
    const [x, y] = inLani();
    lani.add('rgba(190,205,255,0.4)', x, y);
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
  const web = new Cloud();
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
  const webCols = ['rgba(170,150,255,0.7)', 'rgba(130,190,255,0.6)', 'rgba(230,200,255,0.5)'];
  for (const [a, b] of webEdges) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(4, Math.round(len / (R_OBS / 220)));
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    for (let k = 0; k < n; k++) {
      const t = rnd(), off = gauss() * R_OBS * 0.004;
      web.add(webCols[(rnd() * 3) | 0], a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + ny * off);
    }
  }
  for (const [x, y] of nodes) {
    for (let k = 0; k < 14; k++) web.add('rgba(255,220,250,0.8)', x + gauss() * R_OBS * 0.006, y + gauss() * R_OBS * 0.006);
  }

  // 화면 고정 배경 별
  const bg = [];
  for (let i = 0; i < 220; i++) bg.push([rnd(), rnd(), rnd() * 1.3 + 0.3, rnd() * Math.PI * 2]);

  // 지구 대륙 (지구 반지름 기준 상대 좌표)
  const continents = [];
  for (let i = 0; i < 9; i++) continents.push([gauss() * 0.45, gauss() * 0.45, 0.12 + rnd() * 0.22, 0.08 + rnd() * 0.16, rnd() * Math.PI]);

  return { planets, oort, namedStars, stars, galaxy, lgGalaxies, dwarfs, virgo, laniBoundary, lani, flows, web, bg, continents };
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
.mu-root{position:absolute;inset:0;overflow:hidden;background:#03040a;color:#e8ecff;
  font-family:-apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo","Noto Sans KR",sans-serif;
  user-select:none;-webkit-user-select:none;touch-action:none}
.mu-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.mu-overlay{cursor:grab;touch-action:none}
.mu-overlay:active{cursor:grabbing}
.mu-top{position:absolute;top:0;left:0;right:0;padding:16px 56px 0 16px;pointer-events:none}
.mu-title{font-size:20px;font-weight:700;letter-spacing:-0.3px;text-shadow:0 2px 8px #000}
.mu-step{display:inline-block;font-size:11px;font-weight:600;padding:2px 7px;margin-right:6px;border-radius:99px;
  background:rgba(255,209,102,.15);color:#ffd166;vertical-align:3px}
.mu-desc{margin-top:6px;font-size:13px;line-height:1.5;color:#b7bfdc;max-width:520px;text-shadow:0 1px 6px #000}
.mu-close{position:absolute;top:12px;right:12px;width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.15);
  background:rgba(10,14,30,.6);color:#e8ecff;font-size:16px;cursor:pointer;backdrop-filter:blur(6px)}
.mu-bottom{position:absolute;left:0;right:0;bottom:0;padding:0 16px calc(14px + env(safe-area-inset-bottom));
  background:linear-gradient(transparent,rgba(3,4,10,.85) 40%)}
.mu-scale{font-size:12px;color:#9aa4c7;margin-bottom:8px;text-align:center;font-variant-numeric:tabular-nums}
.mu-scale b{color:#e8ecff;font-weight:600}
.mu-controls{display:flex;align-items:center;gap:8px;max-width:560px;margin:0 auto}
.mu-controls button{flex:none;width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.14);
  background:rgba(20,26,50,.7);color:#e8ecff;font-size:18px;cursor:pointer;touch-action:none}
.mu-controls button:active{background:rgba(60,70,120,.8)}
.mu-slider{flex:1;accent-color:#ffd166;height:28px}
.mu-progress{position:relative;max-width:560px;margin:10px auto 0;height:18px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden}
.mu-progress-fill{position:absolute;inset:0 auto 0 0;width:0;background:linear-gradient(90deg,#6a5cff,#ffd166);transition:width .5s}
.mu-progress span{position:absolute;inset:0;font-size:11px;line-height:18px;text-align:center;color:#fff;font-weight:600}
.mu-toast{position:absolute;left:50%;top:96px;transform:translate(-50%,-10px);opacity:0;transition:all .35s;
  padding:8px 14px;border-radius:99px;background:rgba(255,209,102,.95);color:#1b1500;font-size:13px;font-weight:700;
  white-space:nowrap;pointer-events:none;box-shadow:0 6px 24px rgba(255,209,102,.35)}
.mu-toast.show{opacity:1;transform:translate(-50%,0)}
.mu-hint{position:absolute;left:50%;bottom:150px;transform:translateX(-50%);font-size:13px;color:#cfd6f5;
  background:rgba(10,14,30,.6);padding:8px 14px;border-radius:99px;pointer-events:none;transition:opacity .6s;white-space:nowrap}
.mu-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(2,3,8,.6);backdrop-filter:blur(4px)}
.mu-modal[hidden]{display:none}
.mu-card{width:min(360px,calc(100% - 32px));padding:22px 20px;border-radius:20px;background:linear-gradient(160deg,#151a36,#0b0e1f);
  border:1px solid rgba(255,209,102,.3);box-shadow:0 20px 60px rgba(0,0,0,.6);text-align:center}
.mu-card h2{margin:0 0 4px;font-size:20px}
.mu-card p{margin:0 0 14px;font-size:13px;color:#9aa4c7}
.mu-addr{text-align:left;font-size:13px;line-height:1.9;padding:10px 14px;border-radius:12px;background:rgba(255,255,255,.04);margin-bottom:16px}
.mu-addr div{display:flex;gap:8px}
.mu-addr div::before{content:'›';color:#ffd166}
.mu-addr .me{color:#ffd166;font-weight:700}
.mu-card button{margin:0 4px;padding:9px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.15);
  background:rgba(255,255,255,.06);color:#e8ecff;font-size:13px;cursor:pointer}
.mu-card button.primary{background:#ffd166;color:#1b1500;border-color:#ffd166;font-weight:700}
.mu-card .mu-reset{display:block;margin:12px auto 0;background:none;border:0;color:#6c7499;font-size:11px;text-decoration:underline;cursor:pointer}
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
    <div class="mu-top">
      <div class="mu-title"><span class="mu-step"></span><span class="mu-name"></span></div>
      <div class="mu-desc"></div>
    </div>
    <button class="mu-close" aria-label="닫기">✕</button>
    <div class="mu-toast"></div>
    <div class="mu-hint">드래그로 지구 돌리기 · 핀치·휠·슬라이더로 우주 밖까지</div>
    <div class="mu-bottom">
      <div class="mu-scale"></div>
      <div class="mu-controls">
        <button data-zoom="-1" aria-label="가까이">＋</button>
        <input class="mu-slider" type="range" min="${S_MIN}" max="${S_MAX}" step="0.01" aria-label="배율">
        <button data-zoom="1" aria-label="멀리">－</button>
        <button class="mu-home" aria-label="지구로 귀환">🏠</button>
      </div>
      <div class="mu-progress"><div class="mu-progress-fill"></div><span></span></div>
    </div>
    <div class="mu-modal" hidden>
      <div class="mu-card">
        <h2>🌌 우리 우주 주소 완성!</h2>
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
    step: $('.mu-step'), name: $('.mu-name'), desc: $('.mu-desc'), scale: $('.mu-scale'),
    slider: $('.mu-slider'), fill: $('.mu-progress-fill'), progText: $('.mu-progress span'),
    toast: $('.mu-toast'), hint: $('.mu-hint'), modal: $('.mu-modal'), time: $('.mu-time'), addr: $('.mu-addr'),
  };

  const world = buildWorld();
  // 3D(WebGL2) 지구 — 안 되면 2D 지구로 자동 전환
  let earth = null;
  if (canUseWebGL()) {
    try { earth = createEarthGL(root, { sdfUrl, before: overlay }); } catch (err) { console.warn('3D 지구 초기화 실패, 2D로 전환', err); }
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
          toast('📍 현재 위치를 찾았어요');
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

  // ── 입력: 휠 ──
  const onWheel = (e) => {
    e.preventDefault(); markInteracted();
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
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
  // 지구가 화면을 크게 차지할 때: 1손가락 드래그 = 지구 회전 (관성 포함)
  let spin = { vx: 0, vy: 0 };
  const earthRadiusPx = () => 6.371e6 / (Math.pow(10, s) / Math.min(W, H));
  const canSpin = () => earth.gl && earthRadiusPx() > 40 && s < 9.6;
  overlay.addEventListener('pointerdown', (e) => {
    overlay.setPointerCapture(e.pointerId);
    spin = { vx: 0, vy: 0 };
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) lastPinch = pinchDist();
    markInteracted();
  });
  overlay.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 1) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (canSpin()) {
        const r = earthRadiusPx();
        earth.rotateBy(dx / r, dy / r);
        spin = { vx: dx / r, vy: dy / r };
      } else {
        setTarget(targetS - dy * 0.012); // 위로 끌면 멀어짐
      }
    }
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) {
      const d = pinchDist();
      if (lastPinch > 0 && d > 0) setTarget(targetS - Math.log10(d / lastPinch) * 2.2);
      lastPinch = d;
    }
  });
  const endPointer = (e) => { pointers.delete(e.pointerId); lastPinch = pointers.size === 2 ? pinchDist() : 0; };
  overlay.addEventListener('pointerup', endPointer);
  overlay.addEventListener('pointercancel', (e) => { endPointer(e); spin = { vx: 0, vy: 0 }; });

  // ── 입력: 버튼 길게 누르기 ──
  root.querySelectorAll('[data-zoom]').forEach((btn) => {
    const dir = Number(btn.dataset.zoom);
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); markInteracted(); zoomVel = dir * 2.4; setTarget(targetS + dir * 0.15); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, () => { zoomVel = 0; }));
  });
  ui.slider.addEventListener('input', () => { markInteracted(); setTarget(parseFloat(ui.slider.value)); });
  $('.mu-home').addEventListener('click', () => { setTarget(S_START); spin = { vx: 0, vy: 0 }; earth.setView(myLoc.lat, myLoc.lon); });

  // ── 키보드 ──
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') { setTarget(targetS - 0.25); markInteracted(); }
    if (e.key === '-' || e.key === '_' || e.key === 'ArrowDown') { setTarget(targetS + 0.25); markInteracted(); }
  };
  window.addEventListener('keydown', onKey);

  // ── 모달 ──
  $('.mu-close').addEventListener('click', () => close());
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
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
  }
  function checkDiscoveries() {
    let newly = null;
    for (const lv of LEVELS) {
      if (s >= lv.at && !found.has(lv.id)) { found.add(lv.id); newly = lv; }
    }
    if (!newly) return;
    store.found = [...found]; save();
    toast(`✨ 새 발견: ${newly.name} (${found.size}/${LEVELS.length})`);
    if (found.size === LEVELS.length && !completedThisSession) {
      completedThisSession = true;
      const ms = performance.now() - sessionStart;
      const isBest = store.bestMs == null || ms < store.bestMs;
      if (isBest) { store.bestMs = ms; save(); }
      setTimeout(() => showComplete(ms, isBest), 900);
    }
  }
  function showComplete(ms, isBest) {
    ui.time.textContent = `탐험 시간 ${fmtDuration(ms)}${isBest ? ' · 🏆 최고 기록!' : ` · 최고 ${fmtDuration(store.bestMs)}`}`;
    const addr = LEVELS.filter((l) => l.addr).map((l) => l.addr).reverse();
    ui.addr.innerHTML = addr.map((a) => `<div>${a}</div>`).join('') + '<div class="me">나 (여기)</div>';
    ui.modal.hidden = false;
  }

  // ── HUD 갱신 ──
  const hudCache = {};
  const setText = (key, el, v) => { if (hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; } };
  function updateHud() {
    let idx = 0;
    for (let i = 0; i < LEVELS.length; i++) if (s >= LEVELS[i].at) idx = i;
    const lv = LEVELS[idx];
    setText('step', ui.step, `${idx + 1}/${LEVELS.length}`);
    setText('name', ui.name, lv.name);
    const fmtCoord = (v, pos, neg) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`;
    let locLine = '';
    if (idx === 0) {
      const now = new Date();
      const elev = solarElevation(myLoc.lat, myLoc.lon, now);
      const phase = elev > 0 ? '☀️ 낮' : elev > -6 ? '🌆 해질녘·새벽' : elev > -18 ? '🌒 어스름' : '🌙 밤';
      const hhmm = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
      locLine = ` 📍 ${myLoc.label}${myLoc.approx ? '(기본값)' : ''} ${fmtCoord(myLoc.lat, 'N', 'S')}, ${fmtCoord(myLoc.lon, 'E', 'W')} · ${hhmm} ${phase} (태양 고도 ${elev.toFixed(0)}°)`;
    }
    let extra = '';
    if (lv.id === 'moon' && earth.gl && earth.moon) {
      const m = earth.moon;
      extra = ` 🌙 오늘은 ${m.phase} (밝기 ${Math.round(m.illum * 100)}%) · 지금 거리 ${Math.round(m.distKm).toLocaleString('ko-KR')}km`;
    }
    setText('desc', ui.desc, idx === 0 ? lv.desc + locLine : lv.desc + extra);
    const span = Math.pow(10, s);
    const sc = `화면 폭 ≈ <b>${fmtLength(span)}</b> · 빛으로 ${fmtLightTime(span)}`;
    if (hudCache.scale !== sc) { hudCache.scale = sc; ui.scale.innerHTML = sc; }
    if (document.activeElement !== ui.slider) ui.slider.value = s.toFixed(2);
    const pct = `${(found.size / LEVELS.length) * 100}%`;
    if (hudCache.pct !== pct) { hudCache.pct = pct; ui.fill.style.width = pct; }
    setText('prog', ui.progText, `발견 ${found.size}/${LEVELS.length}`);
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
    const [camX, camY] = camAt(s);
    const cx = W / 2, cy = H / 2;
    const sx = (x) => cx + (x - camX) / mpp;
    const sy = (y) => cy - (y - camY) / mpp;
    const onScreen = (x, y, m = 40) => x > -m && x < W + m && y > -m && y < H + m;

    // 배경 별 (화면 고정)
    const bgA = 0.15 + 0.75 * (1 - smooth(17, 21, s));
    for (const [u, v, r, ph] of world.bg) {
      ctx.globalAlpha = bgA * (0.55 + 0.45 * Math.sin(time * 1.3 + ph));
      ctx.fillStyle = '#dfe6ff';
      ctx.fillRect(u * W, v * H, r, r);
    }

    const label = (text, x, y, a, { dy = -12, color = '#e8ecff', size = 12, align = 'center' } = {}) => {
      if (a < 0.05) return;
      const X = sx(x), Y = sy(y);
      if (!onScreen(X, Y, 80)) return;
      ctx.globalAlpha = a;
      ctx.font = `600 ${size}px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif`;
      ctx.textAlign = align;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(text, X, Y + dy);
      ctx.fillStyle = color;
      ctx.fillText(text, X, Y + dy);
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
    drawCloud(world.web, aWeb * 0.9, 1.4);

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
      drawCloud(world.lani, aLani, 1.6);
      glow(GA[0], GA[1], 18, aLani * 0.8, '150,210,255');
      label('거대 인력체 (Great Attractor)', GA[0], GA[1], aLani * smooth(24.8, 25.0, s) * (1 - smooth(25.6, 25.9, s)), { dy: -16, color: '#9fdcff' });
      label('라니아케아 초은하단', LANI[0], LANI[1] + 285 * MLY, aLani * (1 - smooth(25.6, 25.9, s)), { color: '#ffd166', size: 13 });
    }

    // ── 처녀자리 초은하단 ──
    const aVir = band(s, 23.0, 25.6);
    if (aVir > 0.02) {
      drawCloud(world.virgo, aVir, 1.7);
      glow(VIRGO[0], VIRGO[1], 22, aVir * 0.7, '255,230,200');
      label('처녀자리 은하단', VIRGO[0], VIRGO[1], aVir * (1 - smooth(24.5, 24.9, s)), { dy: -20 });
      label('국부은하군', 0, 0, aVir * smooth(23.8, 24.1, s) * (1 - smooth(24.4, 24.8, s)), { dy: 46, color: '#b7bfdc', size: 11 });
    }

    // ── 국부은하군 ──
    const aLG = band(s, 21.4, 24.6);
    if (aLG > 0.02) {
      drawCloud(world.dwarfs, aLG, 2);
      for (const g of world.lgGalaxies) {
        const rPx = g.r / mpp;
        const X = sx(g.pos[0]), Y = sy(g.pos[1]);
        if (!onScreen(X, Y, rPx * 2 + 20)) continue;
        const isMW = g.name === '우리은하';
        const a = aLG * (isMW ? smooth(21.8, 22.6, s) : 1);
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
      drawCloud(world.galaxy, aMW, 1.3);
      glow(GC[0], GC[1], (6000 * LY) / mpp, aMW * 0.7, '255,220,160');
      label('은하 중심 (궁수자리 A*)', GC[0], GC[1], aMW * (1 - smooth(21.8, 22.3, s)), { dy: -14, color: '#ffe0a8', size: 11 });
      label('우리은하', GC[0], GC[1] + 60000 * LY, aMW * (1 - smooth(21.8, 22.3, s)), { dy: 0, size: 14 });
    }

    // ── 이웃 별들 ──
    const aStars = band(s, 16.2, 20.2);
    if (aStars > 0.02) {
      drawCloud(world.stars, aStars, 2);
      for (const st of world.namedStars) {
        glow(st.pos[0], st.pos[1], 7, aStars, '255,240,220');
        label(st.name, st.pos[0], st.pos[1], aStars, { dy: -10, color: st.color, size: 11 });
      }
    }

    // ── 오르트 구름 / 태양권 ──
    const aOort = band(s, 14.8, 18.0);
    drawCloud(world.oort, aOort, 1.6);
    label('오르트 구름', SUN[0], SUN[1] + 60000 * AU, aOort * smooth(16.0, 16.6, s) * (1 - smooth(17.0, 17.4, s)), { color: '#aad2ff' });
    const aHelio = band(s, 12.8, 16.4);
    circle(SUN[0], SUN[1], 120 * AU, aHelio * 0.7, '#7fd1ff', [4, 5], 1.2);
    label('태양권계면', SUN[0], SUN[1] + 120 * AU, aHelio * smooth(13.6, 14.0, s) * (1 - smooth(15.2, 15.6, s)), { dy: -6, color: '#7fd1ff', size: 11 });

    // ── 태양계 ──
    const aSol = band(s, 10.3, 15.6);
    if (aSol > 0.02) {
      for (const p of world.planets) circle(SUN[0], SUN[1], p.orbit, aSol * 0.3, '#8fa2d8');
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
        ctx.globalAlpha = aSol; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(sx(p.pos[0]), sy(p.pos[1]), rPx, 0, Math.PI * 2); ctx.fill();
        if (orbitPx > 28) label(p.name, p.pos[0], p.pos[1], aSol, { dy: -Math.max(9, rPx + 6), size: 11, color: '#cfd6f5' });
      }
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
              const txt = `📍 ${myLoc.label}`;
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
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(X, Y, pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = aHere * 0.35;
        ctx.beginPath(); ctx.arc(X, Y, pulse + 7, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = aHere; ctx.fillStyle = '#ffd166';
        ctx.beginPath(); ctx.arc(X, Y, 2.2, 0, Math.PI * 2); ctx.fill();
        const txt = s > 26.6 ? '여기 = 관측 가능한 우주의 중심' : '여기';
        label(txt, 0, 0, aHere, { dy: 30, color: '#ffd166', size: 12 });
      }
    }
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
    if (Math.abs(targetS - s) < 1e-4) s = targetS;
    checkDiscoveries();
    render(now / 1000);
    updateHud();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function destroy() {
    destroyed = true;
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
    get scale() { return s; },
  };
}
