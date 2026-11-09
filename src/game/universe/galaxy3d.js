// 우리은하 · 국부은하군 3D 보기 (three.js)
// 단위: 1 = 1광년. 은하 중심 좌표계(은하 중심 = 원점, x = 태양→은하 중심 방향, y = 은하 회전 방향, z = 북쪽 은하극)
// three 좌표 = (x, z, -y) → 은하 원반이 수평면.
// 실제 데이터: 별(AT-HYG · Gaia DR3), 성운·성단·블랙홀(OpenNGC 등), 외계 행성계(Open Exoplanet Catalogue),
// 위성은하. 나선팔·막대·팽대부는 최신 연구(막대 길이 약 5 kpc · 기울기 약 27° · 나선 기울기 약 12°)를 따른 모형.
import * as THREE from 'three';
import { bvRgb } from './deep-stars.js';
import { eclToEq, eqToEclXYZ } from './gaia-tiles.js';
import galUrl from './galaxies-2mrs.bin?url';

const R0 = 26670;           // 태양 ~ 은하 중심 거리 (광년, GRAVITY 2019 ~ 8.18 kpc)
const Z0 = 66;              // 태양의 원반 위 높이
const KPC = 3261.56;

// 적도좌표(J2000) → 은하좌표 회전 행렬
const T = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];
/** 적경·적위(도)·거리(광년) → three 좌표 [x, y, z] */
export function eqTo3(ra, dec, ly) {
  const a = (ra * Math.PI) / 180, d = (dec * Math.PI) / 180;
  const e = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const g = T.map((r) => r[0] * e[0] + r[1] * e[1] + r[2] * e[2]);
  const gx = g[0] * ly - R0, gy = g[1] * ly, gz = g[2] * ly + Z0;
  return [gx, gz, -gy];
}
const gal3 = (gx, gy, gz) => [gx, gz, -gy];
/** 태양 중심 적도 직교(광년) → three 좌표 */
function eqXYZTo3(ex, ey, ez) {
  const gx = T[0][0] * ex + T[0][1] * ey + T[0][2] * ez, gy = T[1][0] * ex + T[1][1] * ey + T[1][2] * ez, gz = T[2][0] * ex + T[2][1] * ey + T[2][2] * ez;
  return [gx - R0, gz + Z0, -gy];
}
/** three 좌표 → 태양 중심 황도 직교(광년) */
function threeToEcl(x, y, z) {
  const gx = x + R0, gy = -z, gz = y - Z0;
  const ex = T[0][0] * gx + T[1][0] * gy + T[2][0] * gz, ey = T[0][1] * gx + T[1][1] * gy + T[2][1] * gz, ez = T[0][2] * gx + T[1][2] * gy + T[2][2] * gz;
  return eqToEclXYZ(ex, ey, ez);
}

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 점 구름 버퍼 ──
class PointBuf {
  constructor() { this.p = []; this.c = []; this.s = []; }
  add(x, y, z, r, g, b, size) { this.p.push(x, y, z); this.c.push(r, g, b); this.s.push(size); }
  get count() { return this.s.length; }
  build(material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(this.s, 1));
    geo.computeBoundingSphere();
    const pts = new THREE.Points(geo, material);
    pts.frustumCulled = false;
    return pts;
  }
}

function pointMaterial({ additive = true, opacity = 1, minPx = 0.6, maxPx = 26, fade = [0, 0] } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uScale: { value: 600 }, uOpacity: { value: opacity }, uMin: { value: minPx }, uMax: { value: maxPx }, uFade: { value: new THREE.Vector2(...fade) } },
    vertexShader: `
      attribute float size; attribute vec3 color; varying vec3 vColor; varying float vFade;
      uniform float uScale, uMin, uMax; uniform vec2 uFade;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        float px = size * uScale / max(1.0, -mv.z);
        vFade = clamp(px / max(uMin, 0.001), 0.0, 1.0);   // 아주 작으면 흐리게(깜빡임 방지)
        // 모형 입자는 카메라에 가까워지면 사라짐(가까이선 실제 별을 보여 줌)
        if (uFade.y > 0.0) vFade *= smoothstep(uFade.x, uFade.y, -mv.z);
        gl_PointSize = clamp(px, uMin, uMax);
        vColor = color;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vFade; uniform float uOpacity; uniform vec2 uFade;
      void main(){
        vec2 d = gl_PointCoord - 0.5; float r = length(d);
        if (r > 0.5) discard;
        float a = smoothstep(0.5, 0.0, r); a = a * a;
        gl_FragColor = vec4(vColor, a * uOpacity * (0.35 + 0.65 * vFade) * (uFade.y > 0.0 ? vFade : 1.0));
      }`,
  });
}

// ── 은하 모형 생성기 ──
// 은하 자체 좌표(원반 = xy, 법선 = z)에서 만들고, 마지막에 방향·위치를 입힘
function makeGalaxy(o, seed) {
  const R = rng(seed);
  const gauss = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };
  const stars = new PointBuf(), dust = new PointBuf();
  const tanP = Math.tan((o.pitch * Math.PI) / 180);
  const put = (buf, x, y, z, col, size) => buf.add(x, y, z, col[0], col[1], col[2], size);
  const OLD = [1.0, 0.86, 0.66], DISK = [0.86, 0.88, 1.0], YOUNG = [0.55, 0.72, 1.0], HII = [1.0, 0.35, 0.6], CORE = [1.0, 0.8, 0.5];
  const k = o.scale || 1;
  // 원반(지수 분포)
  for (let i = 0; i < o.nDisk * k; i++) {
    let r = -o.hR * Math.log(R() * R() + 1e-9) * 0.7;
    if (r > o.rMax) r = R() * o.rMax;
    const th = R() * Math.PI * 2;
    put(stars, r * Math.cos(th), r * Math.sin(th), gauss() * o.hZ, R() < 0.5 ? DISK : OLD, o.starSize * (0.6 + R() * 0.8));
  }
  // 나선팔
  for (const arm of o.arms || []) {
    const n = arm.n * k;
    for (let i = 0; i < n; i++) {
      const r = arm.rIn + Math.pow(R(), 0.8) * (arm.rOut - arm.rIn);
      const th = arm.th0 + Math.log(r / arm.r0) / tanP + gauss() * (o.armSpread || 0.06) + (o.flocc ? Math.sin(r * 0.0009 + arm.th0 * 3) * 0.25 : 0);
      const w = arm.width * (0.6 + 0.4 * (r / arm.rOut));
      const dr = gauss() * w;
      const x = (r + dr) * Math.cos(th), y = (r + dr) * Math.sin(th);
      const q = R();
      const col = q < 0.04 ? HII : q < (arm.major ? 0.45 : 0.7) ? YOUNG : DISK;
      put(stars, x, y, gauss() * o.hZ * 0.5, col, o.starSize * (col === HII ? 2.6 : 1.1 + R() * 0.8));
      // 먼지띠(팔 안쪽 가장자리)
      if (o.dust && R() < 0.35) {
        const rd = r - w * 0.9 + gauss() * w * 0.4;
        dust.add(rd * Math.cos(th), rd * Math.sin(th), gauss() * o.hZ * 0.25, 0.09, 0.05, 0.03, o.starSize * 2.2);
      }
    }
  }
  // 고리(안드로메다의 10 kpc 고리 등)
  if (o.ring) {
    for (let i = 0; i < o.ring.n * k; i++) {
      const th = R() * Math.PI * 2, r = o.ring.r + gauss() * o.ring.w;
      put(stars, r * Math.cos(th), r * Math.sin(th), gauss() * o.hZ * 0.5, R() < 0.08 ? HII : YOUNG, o.starSize * 1.4);
      if (o.dust && R() < 0.4) { const rd = r + gauss() * o.ring.w * 0.5; dust.add(rd * Math.cos(th), rd * Math.sin(th), gauss() * 40, 0.09, 0.05, 0.03, o.starSize * 2.4); }
    }
  }
  // 막대
  if (o.bar) {
    const ca = Math.cos(o.bar.angle), sa = Math.sin(o.bar.angle);
    for (let i = 0; i < o.bar.n * k; i++) {
      const u = (R() * 2 - 1) * o.bar.len * Math.sqrt(R());
      const v = gauss() * o.bar.len * 0.22, w = gauss() * o.bar.len * 0.12;
      put(stars, u * ca - v * sa + (o.bar.ox || 0), u * sa + v * ca + (o.bar.oy || 0), w, R() < 0.7 ? OLD : CORE, o.starSize * 1.3);
    }
  }
  // 팽대부
  if (o.bulge) {
    for (let i = 0; i < o.bulge.n * k; i++) {
      const r = Math.abs(gauss()) * o.bulge.r;
      const th = R() * Math.PI * 2, ph = Math.acos(2 * R() - 1);
      put(stars, r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph) * (o.bulge.flat || 0.6), R() < 0.5 ? CORE : OLD, o.starSize * 1.5);
    }
    for (let i = 0; i < 600 * k; i++) put(stars, gauss() * o.bulge.r * 0.08, gauss() * o.bulge.r * 0.08, gauss() * o.bulge.r * 0.05, [1, 0.92, 0.75], o.starSize * 2);
  }
  // 헤일로
  for (let i = 0; i < (o.nHalo || 0) * k; i++) {
    const r = o.rMax * (0.3 + Math.pow(R(), 0.6) * 1.6);
    const th = R() * Math.PI * 2, ph = Math.acos(2 * R() - 1);
    put(stars, r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph), [0.75, 0.75, 0.85], o.starSize * 0.8);
  }
  // 덩어리(불규칙 은하·별 탄생 구역)
  for (const c of o.clumps || []) {
    for (let i = 0; i < c.n * k; i++) put(stars, c.x + gauss() * c.r, c.y + gauss() * c.r, gauss() * c.r * 0.4, c.col || HII, o.starSize * (c.size || 1.8));
  }
  return { stars, dust };
}

// 은하 자체 좌표 → 월드 좌표: 원반 법선 n(월드)·위치
function orient(buf, normal, pos, spin = 0) {
  const n = new THREE.Vector3(...normal).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  const qs = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin);
  q.multiply(qs);
  const v = new THREE.Vector3();
  for (let i = 0; i < buf.p.length; i += 3) {
    v.set(buf.p[i], buf.p[i + 1], buf.p[i + 2]).applyQuaternion(q);
    buf.p[i] = v.x + pos[0]; buf.p[i + 1] = v.y + pos[1]; buf.p[i + 2] = v.z + pos[2];
  }
}
// 시선 방향(우리→은하)과 경사각으로 원반 법선 만들기
function normalFor(pos, inclDeg, paDeg) {
  const los = new THREE.Vector3(...pos).normalize();
  const up = Math.abs(los.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(los, up).normalize();
  const e2 = new THREE.Vector3().crossVectors(los, e1).normalize();
  const pa = (paDeg * Math.PI) / 180, inc = (inclDeg * Math.PI) / 180;
  const perp = e1.multiplyScalar(Math.cos(pa)).add(e2.multiplyScalar(Math.sin(pa)));
  return los.clone().multiplyScalar(-Math.cos(inc)).add(perp.multiplyScalar(Math.sin(inc))).toArray();
}

const CSS3D = `
.g3-root{position:absolute;inset:0;z-index:20;background:#000;overflow:hidden;touch-action:none}
.g3-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab}
.g3-root canvas:active{cursor:grabbing}
.g3-labels{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.g3-lab{position:absolute;left:0;top:0;white-space:nowrap;font-size:10.5px;font-weight:700;letter-spacing:.03em;
  transform:translate(-50%,-140%);text-shadow:0 0 3px #000,0 0 6px currentColor;opacity:0;transition:opacity .25s}
.g3-lab.big{font-size:12.5px}
.g3-top{position:absolute;top:10px;left:10px;right:58px;max-width:600px;padding:10px 12px 11px;z-index:3;pointer-events:none}
.g3-top h3{margin:0;font-size:16px;color:var(--g);letter-spacing:.06em;text-shadow:var(--glow)}
.g3-top p{margin:6px 0 0;font-size:11.5px;line-height:1.55;color:var(--gd)}
.g3-bar{position:absolute;left:0;right:0;bottom:0;z-index:3;padding:8px 10px calc(10px + env(safe-area-inset-bottom));
  display:flex;flex-wrap:wrap;gap:6px;justify-content:center;background:linear-gradient(transparent,rgba(1,6,4,.92) 40%)}
.g3-bar button,.g3-close{border:1px solid var(--g2);background:rgba(1,22,11,.78);color:var(--g);font-family:inherit;font-weight:700;
  font-size:11.5px;letter-spacing:.04em;cursor:pointer;text-shadow:var(--glow);padding:7px 10px;
  clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px);box-shadow:inset 0 0 10px rgba(61,255,143,.2)}
.g3-bar button.on{background:rgba(61,255,143,.28);color:#eafff2}
.g3-close{position:absolute;top:10px;right:10px;width:38px;height:38px;padding:0;z-index:4;font-size:13px}
.g3-info{position:absolute;z-index:4;pointer-events:none;padding:7px 10px 8px;max-width:min(320px,calc(100% - 24px));
  background:rgba(1,18,9,.92);border:1px solid rgba(61,255,143,.8);box-shadow:0 0 10px rgba(61,255,143,.5);
  clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px);display:none}
.g3-info b{display:block;color:var(--g);font-size:12px;text-shadow:var(--glow)}
.g3-info span{display:block;color:var(--gd);font-size:10.5px;line-height:1.45;margin-top:2px}
.g3-ring{position:absolute;z-index:3;width:22px;height:22px;margin:-11px 0 0 -11px;border:1.6px solid var(--g);border-radius:50%;
  box-shadow:0 0 10px rgba(61,255,143,.9);pointer-events:none;display:none}
.g3-scale{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(92px + env(safe-area-inset-bottom));z-index:3;font-size:10.5px;color:var(--gd);
  text-shadow:0 0 4px #000;pointer-events:none;white-space:nowrap}
@media (max-width:520px){.g3-bar button{font-size:10.5px;padding:6px 8px}.g3-scale{bottom:calc(118px + env(safe-area-inset-bottom))}}
`;

const fmtLy = (ly) => {
  if (ly < 100) return `${Math.round(ly * 10) / 10}광년`;
  if (ly < 1e4) return `${Math.round(ly).toLocaleString('ko-KR')}광년`;
  if (ly < 1e8) return `${(Math.round(ly / 1e3) / 10).toLocaleString('ko-KR')}만 광년`;
  return `${(Math.round(ly / 1e7) / 10).toLocaleString('ko-KR')}억 광년`;
};

/**
 * 3D 은하 보기 열기
 * @param {HTMLElement} host .mu-root
 * @param {{ sky?:any, exo?:any, dwarfs?:Array, preset?:string, describeStar?:Function, dsoKo?:Object, onClose?:Function }} opts
 */
export function openGalaxy3D(host, opts = {}) {
  const { sky, exo, layers = [], subscribe, gaia, openBH, photoFor, describeDeep, dwarfs = [], preset = 'mw', describeStar, dsoKo = {}, onClose } = opts;
  if (!document.getElementById('g3-style')) {
    const st = document.createElement('style'); st.id = 'g3-style'; st.textContent = CSS3D; document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.className = 'g3-root';
  root.innerHTML = `
    <div class="g3-labels"></div>
    <div class="g3-top mu-frame"><h3></h3><p></p></div>
    <button class="g3-close" aria-label="3D 보기 닫기">✕</button>
    <div class="g3-ring"></div><div class="g3-info"><b></b><span></span><span></span><img alt="" style="display:none;width:100%;max-height:170px;object-fit:cover;margin-top:5px;border:1px solid rgba(61,255,143,.35)"></div>
    <div class="g3-scale"></div>
    <div class="g3-bar"></div>`;
  host.appendChild(root);
  const $ = (q) => root.querySelector(q);

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 1);
  root.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 1, 1e8);

  const mats = [];
  const addPoints = (buf, matOpts) => { const m = pointMaterial(matOpts); mats.push(m); const p = buf.build(m); scene.add(p); return p; };

  // ── 우리은하 ──
  const barAngle = Math.PI - (27 * Math.PI) / 180; // 은하 중심→태양 방향(-x)에서 회전 방향으로 27°
  const MW_ARMS = [
    // r0: 태양 방위(θ=180°)에서의 반지름 → 4팔 로그 나선 (나선 기울기 12°)
    { name: '노르마 팔 → 바깥 팔', r0: 3.65 * KPC, major: false },
    { name: '방패-센타우루스 팔', r0: 5.1 * KPC, major: true },
    { name: '궁수-용골 팔', r0: 7.16 * KPC, major: false },
    { name: '페르세우스 팔', r0: 10.0 * KPC, major: true },
  ].map((a) => ({ ...a, th0: Math.PI, rIn: 4.2 * KPC, rOut: 17 * KPC, width: 650, n: a.major ? 26000 : 15000 }));
  // 은하 회전은 θ 감소 방향 → 바깥으로 갈수록 θ 증가(뒤처지는 팔). 은하 자체 좌표 = 은하 좌표 (x,y)
  const mw = makeGalaxy({
    pitch: 12, nDisk: 38000, hR: 8500, rMax: 52000, hZ: 330, starSize: 60, dust: true,
    arms: [...MW_ARMS, { name: '오리온 돌기', th0: Math.PI, r0: R0, rIn: R0 - 2600, rOut: R0 + 3800, width: 380, n: 5000 }].map((a) => a),
    bar: { len: 5 * KPC, angle: barAngle, n: 14000 }, bulge: { r: 2600, n: 14000, flat: 0.55 }, nHalo: 2500,
    clumps: [{ x: 0, y: 0, r: 260, n: 1400, col: [1, 0.45, 0.35], size: 1.2 }], // 중심 분자대(CMZ)
  }, 7);
  // 은하 좌표(x,y,z) → three 좌표(x,z,-y)
  const toThree = (buf) => { for (let i = 0; i < buf.p.length; i += 3) { const y = buf.p[i + 1], z = buf.p[i + 2]; buf.p[i + 1] = z; buf.p[i + 2] = -y; } };
  // 오리온 돌기는 피치가 달라서(약 10°) 따로 살짝 비틂 — 위치만 맞으면 충분
  toThree(mw.stars); toThree(mw.dust);
  addPoints(mw.stars, { opacity: 0.9, maxPx: 16, fade: [900, 5000] });
  addPoints(mw.dust, { additive: false, opacity: 0.55, maxPx: 30, fade: [900, 5000] }).renderOrder = 2; // 먼지는 별 위에 덮어야 어두워짐

  // 페르미 거품 (은하 중심 위·아래 약 2.5만 광년)
  const bubbleMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Color(0.75, 0.35, 1.0) }, uA: { value: 1 } },
    vertexShader: `varying float vF; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vec3 n = normalize(normalMatrix*normal);
      vF = 1.0 - abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying float vF; uniform vec3 uCol; uniform float uA; void main(){ gl_FragColor = vec4(uCol, pow(vF,3.0)*0.22*uA); }`,
  });
  for (const sgn of [1, -1]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), bubbleMat);
    m.scale.set(11000, 13000, 11000); m.position.set(0, sgn * 13000, 0);
    scene.add(m);
  }

  // ── 국부은하군 은하들 (실제 방향·거리) ──
  const M31 = eqTo3(10.685, 41.269, 2.5e6), M33 = eqTo3(23.462, 30.660, 2.73e6);
  const LMC = eqTo3(80.894, -69.756, 160000), SMC = eqTo3(13.187, -72.829, 200000);
  const m31 = makeGalaxy({ pitch: 8, nDisk: 30000, hR: 17000, rMax: 110000, hZ: 600, starSize: 140, dust: true,
    arms: [{ th0: 0, r0: 30000, rIn: 15000, rOut: 90000, width: 2600, n: 9000, major: true }, { th0: Math.PI, r0: 30000, rIn: 15000, rOut: 90000, width: 2600, n: 9000, major: true }],
    ring: { r: 32600, w: 2200, n: 9000 }, bulge: { r: 9000, n: 16000, flat: 0.75 }, nHalo: 1500 }, 31);
  orient(m31.stars, normalFor(M31, 77, 38), M31, 0.4); orient(m31.dust, normalFor(M31, 77, 38), M31, 0.4);
  addPoints(m31.stars, { opacity: 0.85 }); addPoints(m31.dust, { additive: false, opacity: 0.45, maxPx: 40 }).renderOrder = 2;
  const m33 = makeGalaxy({ pitch: 18, nDisk: 9000, hR: 6000, rMax: 30000, hZ: 300, starSize: 90, flocc: true, armSpread: 0.15,
    arms: [{ th0: 0, r0: 6000, rIn: 1500, rOut: 26000, width: 1300, n: 6000 }, { th0: Math.PI, r0: 6000, rIn: 1500, rOut: 26000, width: 1300, n: 6000 }],
    clumps: [{ x: 9000, y: 6000, r: 400, n: 300 }], bulge: { r: 900, n: 1200, flat: 0.8 } }, 33);
  orient(m33.stars, normalFor(M33, 55, 23), M33); addPoints(m33.stars, { opacity: 0.85 });
  const lmc = makeGalaxy({ pitch: 20, nDisk: 7000, hR: 4500, rMax: 16000, hZ: 400, starSize: 40,
    arms: [{ th0: 0.5, r0: 4000, rIn: 3000, rOut: 14000, width: 1100, n: 2500 }],
    bar: { len: 4500, angle: 0.3, n: 5000, ox: -1200, oy: 600 }, clumps: [{ x: 5500, y: 3000, r: 350, n: 700 }] }, 41);
  orient(lmc.stars, normalFor(LMC, 35, 150), LMC); addPoints(lmc.stars, { opacity: 0.9 });
  const smc = makeGalaxy({ pitch: 20, nDisk: 4000, hR: 3000, rMax: 9000, hZ: 1500, starSize: 40,
    bar: { len: 4000, angle: 1.0, n: 2500 }, clumps: [{ x: 1500, y: -1000, r: 300, n: 300 }] }, 42);
  orient(smc.stars, normalFor(SMC, 60, 45), SMC); addPoints(smc.stars, { opacity: 0.85 });
  // 마젤란 흐름: 마젤란 구름에서 남쪽 은하극을 지나 길게 뻗은 가스
  {
    const R = rng(5), buf = new PointBuf();
    const a = new THREE.Vector3(...LMC), b = new THREE.Vector3(...gal3(0, -60000, -180000)), c = new THREE.Vector3(...gal3(40000, -150000, -60000));
    for (let i = 0; i < 4000; i++) {
      const t = R(), u = 1 - t;
      const p = a.clone().multiplyScalar(u * u).add(b.clone().multiplyScalar(2 * u * t)).add(c.clone().multiplyScalar(t * t));
      buf.add(p.x + (R() - 0.5) * 9000, p.y + (R() - 0.5) * 9000, p.z + (R() - 0.5) * 9000, 0.35, 0.55, 0.9, 260);
    }
    addPoints(buf, { opacity: 0.35 });
  }

  // ── 실제 천체 점 ──
  const picks = []; // { pos:Vector3, title, l2, l3, min, max }
  const addPick = (pos, title, l2, l3, min = 0, max = Infinity) => picks.push({ pos: new THREE.Vector3(...pos), title, l2, l3, min, max });
  if (sky) {
    const buf = new PointBuf();
    sky.rows.forEach((r, i) => {
      const p = eqTo3(r[2], r[3], r[4]);
      const bv = r[7] == null ? 0.6 : r[7];
      const col = bv < 0 ? [0.7, 0.8, 1] : bv < 0.4 ? [0.9, 0.93, 1] : bv < 0.8 ? [1, 0.95, 0.82] : bv < 1.3 ? [1, 0.8, 0.6] : [1, 0.62, 0.45];
      const am = r[6] == null ? 2 : r[6];
      buf.add(p[0], p[1], p[2], col[0], col[1], col[2], am < -4 ? 3.5 : am < 0 ? 2.4 : am < 3 ? 1.6 : 1.1);
      const info = describeStar ? describeStar(i) : null;
      if (info) addPick(p, info[0], info[1], info[2], 0, 6000);
    });
    addPoints(buf, { opacity: 1, minPx: 1.2, maxPx: 10 });
    for (const d of sky.dso) {
      const p = eqTo3(...d.radec, d.ly);
      addPick(p, d.name, `${fmtLy(d.ly)} · ${dsoKo[d.kind] || ''}`, d.desc, 0, 400000);
    }
  }
  // 맨눈 밖의 별 (기본 11만 + 불러온 묶음들, 실제 위치)
  const deepSets = []; // { d, pos, pts }
  function addLayer(d) {
    const N = d.N, pos = new Float32Array(N * 3), colA = new Float32Array(N * 3), size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = d.gaia ? eqXYZTo3(...eclToEq(d.ex[i], d.ey[i], d.ez[i])) : eqTo3(d.ra[i], d.dec[i], d.ly[i]);
      pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
      const [r, g, b] = bvRgb(d.bv[i] / 50);
      const k = Math.max(0.1, Math.min(1, Math.pow(10, -0.2 * (d.mag[i] / 10 - 7)))); // 어두운 별은 흐리게(빽빽하면 빛이 쌓임)
      colA[i * 3] = (r / 255) * k; colA[i * 3 + 1] = (g / 255) * k; colA[i * 3 + 2] = (b / 255) * k;
      size[i] = 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const m = pointMaterial({ opacity: 0.85, minPx: 1.0, maxPx: 6 }); mats.push(m);
    m.uniforms.uScale.value = mats[0].uniforms.uScale.value;
    const pts = new THREE.Points(geo, m); pts.frustumCulled = false; scene.add(pts);
    deepSets.push({ d, pos, pts, m });
  }
  function removeLayer(d) {
    const i = deepSets.findIndex((q) => q.d === d);
    if (i < 0) return;
    const q = deepSets[i]; deepSets.splice(i, 1);
    scene.remove(q.pts); q.pts.geometry.dispose(); q.m.dispose(); mats.splice(mats.indexOf(q.m), 1);
  }
  layers.forEach(addLayer);
  const unsub = subscribe ? subscribe((d, op) => (op === 'remove' ? removeLayer(d) : addLayer(d))) : null;
  if (exo) {
    const buf = new PointBuf();
    exo.rows.forEach((r) => {
      const p = eqTo3(r[1], r[2], r[3]);
      buf.add(p[0], p[1], p[2], 0.45, 1, 0.75, 1.4);
      addPick(p, r[0], `${fmtLy(r[3])} · 외계 행성 ${r[7].length}개`, '', 0, 20000);
    });
    addPoints(buf, { opacity: 0.9, minPx: 1.1, maxPx: 6 });
  }
  for (const d of dwarfs) {
    const p = eqTo3(d.ra, d.dec, d.ly);
    const buf = new PointBuf(); const R = rng(Math.round(d.ly));
    const rr = d.ly > 1e6 ? 2500 : 900;
    for (let i = 0; i < 260; i++) buf.add(p[0] + (R() - 0.5) * rr, p[1] + (R() - 0.5) * rr, p[2] + (R() - 0.5) * rr, 0.85, 0.88, 1, 120);
    addPoints(buf, { opacity: 0.6 });
    addPick(p, d.name, `${fmtLy(d.ly)} · 위성·왜소은하`, d.desc, 20000, Infinity);
  }

  // ── 라벨 ──
  const labLayer = $('.g3-labels');
  const labels = [];
  const addLabel = (pos, text, color, min, max, prio = 1, big = false) => {
    const el = document.createElement('div');
    el.className = 'g3-lab' + (big ? ' big' : ''); el.textContent = text; el.style.color = color;
    labLayer.appendChild(el);
    labels.push({ el, pos: new THREE.Vector3(...pos), min, max, prio, w: 0 });
  };
  const SUN = gal3(-R0, 0, Z0);
  addLabel(SUN, '태양 · 여기', '#3dff8f', 0, 400000, 10, true);
  addLabel([0, 0, 0], '궁수자리 A* · 은하 중심', '#ffe0a8', 0, 400000, 9, true);
  addLabel([0, 0, 0], '우리은하', '#ffe8c0', 400000, 1.5e7, 9, true);
  addPick(SUN, '태양 (우리 태양계)', '은하 중심에서 약 2만 6,670광년', '오리온 돌기(국부 팔) 안쪽 · 은하를 한 바퀴 도는 데 약 2억 3천만 년');
  addPick([0, 0, 0], '궁수자리 A*', '태양 질량 430만 배 블랙홀', '주위를 S2 별이 16년마다 공전 · 2022년 EHT가 그림자 촬영');
  // 팔 이름
  const tanP = Math.tan((12 * Math.PI) / 180);
  const armPt = (r0, r) => { const th = Math.PI + Math.log(r / r0) / tanP; return gal3(r * Math.cos(th), r * Math.sin(th), 0); };
  addLabel(armPt(10 * KPC, 11 * KPC), '페르세우스 팔', '#9fc8ff', 15000, 500000, 5);
  addLabel(armPt(7.16 * KPC, 6.4 * KPC), '궁수-용골 팔', '#9fc8ff', 15000, 500000, 5);
  addLabel(armPt(5.1 * KPC, 5.4 * KPC), '방패-센타우루스 팔', '#9fc8ff', 15000, 500000, 5);
  addLabel(armPt(3.65 * KPC, 4.6 * KPC), '노르마 팔', '#9fc8ff', 15000, 500000, 4);
  addLabel(armPt(3.65 * KPC, 14.5 * KPC), '바깥 팔', '#9fc8ff', 15000, 500000, 4);
  addLabel(gal3(-R0 - 500, -2200, 0), '오리온 돌기 (국부 팔)', '#b8ffd6', 1500, 60000, 6);
  addLabel(gal3(Math.cos(barAngle) * 4.6 * KPC, Math.sin(barAngle) * 4.6 * KPC, 0), '중심 막대 (약 3.2만 광년)', '#ffd08a', 8000, 300000, 4);
  addLabel([0, 0, 900], '중심 분자대 (CMZ)', '#ff9a8a', 200, 12000, 6);
  addLabel([0, 26000, 0], '페르미 거품 (감마선)', '#d8a0ff', 30000, 700000, 3);
  addPick([0, 26000, 0], '페르미 거품', '은하 중심 위·아래로 약 2.5만 광년씩', '수백만 년 전 중심 블랙홀의 폭발 흔적으로 추정 · 2010년 페르미 망원경 발견');
  addLabel(M31, '안드로메다 은하 (M31)', '#e6ddff', 300000, 1.2e7, 8, true);
  addPick(M31, '안드로메다 은하 (M31)', '250만 광년 · 지름 약 22만 광년', '별 약 1조 개 · 약 45억 년 뒤 우리은하와 충돌 가능성(최근 연구로는 약 50%)');
  addLabel(M33, '삼각형자리 은하 (M33)', '#cfe0ff', 300000, 1.2e7, 7);
  addPick(M33, '삼각형자리 은하 (M33)', '273만 광년 · 지름 약 6만 광년', '국부은하군 3번째로 큰 은하 · 솜털 같은 나선팔');
  addLabel(LMC, '대마젤란 은하', '#cfe0ff', 40000, 3e6, 7);
  addPick(LMC, '대마젤란 은하', '16만 광년 · 지름 약 3만 2천 광년', '타란툴라 성운 · 1987년 초신성 · 우리은하와 합쳐질 예정(약 25억 년 뒤)');
  addLabel(SMC, '소마젤란 은하', '#cfe0ff', 40000, 3e6, 6);
  addPick(SMC, '소마젤란 은하', '20만 광년 · 지름 약 1만 9천 광년', '대마젤란 은하에 끌려 찢어지는 중');
  addLabel(gal3(0, -60000, -180000), '마젤란 흐름 (가스)', '#8fb8ff', 80000, 3e6, 3);
  if (sky) {
    for (const d of sky.dso) {
      const col = { bh: '#c78cff', neb: '#ff7ab6', pn: '#7af0ff', snr: '#ffb05a', oc: '#bfe3ff', gc: '#ffe08a', psr: '#5affff', mag: '#ff6eff', planet: '#78ffc8' }[d.kind] || '#cfe';
      addLabel(eqTo3(...d.radec, d.ly), d.name.replace(/ \(.*\)$/, ''), col, d.ly < 3000 ? 300 : 3000, 220000, d.kind === 'bh' ? 3 : 2);
    }
    sky.rows.forEach((r, i) => { if (r[0] && r[5] < 1.6) addLabel(eqTo3(r[2], r[3], r[4]), r[0].replace(/ \(.*\)$/, ''), '#a6ffcb', 0, 3500, 2); });
  }
  for (const d of dwarfs) addLabel(eqTo3(d.ra, d.dec, d.ly), d.name, '#c8d4ff', d.ly < 1e6 ? 150000 : 600000, 1.2e7, 1);

  // ── 근처 우주: 2MRS 은하 약 4만 3천 개(실제 방향·거리) + 초은하 좌표계(초은하단·벽·보이드) ──
  const MLY = 1e6;
  const gvec = (lDeg, bDeg) => { const l = (lDeg * Math.PI) / 180, b = (bDeg * Math.PI) / 180; return new THREE.Vector3(Math.cos(b) * Math.cos(l), Math.sin(b), -Math.cos(b) * Math.sin(l)); };
  const SGZ = gvec(47.37, 6.32);                 // 초은하 북극
  const SGX = gvec(137.37, 0);                   // 초은하 경도 0°
  const SGY = new THREE.Vector3().crossVectors(SGZ, SGX).normalize();
  const sunV = new THREE.Vector3(...SUN);
  const sgPoint = (sgl, sgb, d) => { const l = (sgl * Math.PI) / 180, b = (sgb * Math.PI) / 180;
    return sunV.clone().addScaledVector(SGX, d * Math.cos(b) * Math.cos(l)).addScaledVector(SGY, d * Math.cos(b) * Math.sin(l)).addScaledVector(SGZ, d * Math.sin(b)); };
  const cosmos = new THREE.Group(); scene.add(cosmos);
  // 기준면 고리(1억·2억·3억·5억 광년) + 경도축
  const ringMat = new THREE.LineBasicMaterial({ color: 0x2a3cff, transparent: true, opacity: 0.75 });
  for (const r of [100, 200, 300, 500]) {
    const pts = []; for (let k = 0; k <= 128; k++) pts.push(sgPoint((k / 128) * 360, 0, r * MLY));
    cosmos.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
    addLabel(sgPoint(0, 0, r * MLY).toArray(), `${r < 100 ? r : r / 100 + '억'} 광년`.replace('1억', '1억').replace(/^(\d)억/, '$1억'), '#6f7dff', 6e7, 3e10, 2);
  }
  for (const a of [0, 90, 180, 270]) {
    cosmos.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([sunV, sgPoint(a, 0, 500 * MLY)]), ringMat));
    addLabel(sgPoint(a, 0, 530 * MLY).toArray(), `${a}°`, '#6f7dff', 2e8, 3e10, 2);
  }
  // 은하 점: 비동기
  fetch(galUrl).then((r) => r.arrayBuffer()).then((buf) => {
    if (destroyed) return;
    const N = new DataView(buf).getUint32(0, true);
    let o = 4;
    const ra = new Uint16Array(buf, o, N); o += 2 * N; const dec = new Int16Array(buf, o, N); o += 2 * N;
    const ds = new Uint16Array(buf, o, N); o += 2 * N; const lum = new Uint8Array(buf, o, N);
    const b = new PointBuf();
    for (let i = 0; i < N; i++) {
      const dly = (ds[i] / 30) * MLY;
      const p = eqTo3((ra[i] / 65535) * 360, (dec[i] / 32767) * 90, dly);
      const k = 0.55 + Math.min(0.45, lum[i] / 400);
      const warm = lum[i] > 170;
      b.add(p[0], p[1], p[2], k, k * (warm ? 0.92 : 0.97), k * (warm ? 0.8 : 1), 900000 * (0.7 + lum[i] / 255));
    }
    const pts = addPoints(b, { opacity: 1, minPx: 2.0, maxPx: 6 });
    cosmos.add(pts);
  }).catch(() => {});
  // 이름 붙은 구조 [이름, 종류(sc 초은하단·cl 은하단·wall 벽·void 보이드), 적경, 적위, 거리(백만 광년), 설명]
  const STRUCT = [
    ['처녀자리 초은하단 (국부 초은하단)', 'sc', 187.7, 12.4, 54, '우리은하가 속한 초은하단 · 중심은 처녀자리 은하단'],
    ['라니아케아 (거대 인력체)', 'sc', 243.6, -60.9, 220, '우리가 속한 더 큰 초은하단의 중력 중심 쪽'],
    ['히드라-센타우루스 초은하단', 'sc', 192.2, -41.3, 170, '센타우루스·히드라 은하단을 품은 초은하단'],
    ['공작-인디언 초은하단', 'sc', 304.2, -70.9, 190, '라니아케아 안의 초은하단'],
    ['페르세우스-물고기 초은하단', 'sc', 49.95, 41.5, 240, '은하 사슬이 길게 이어진 초은하단 · 라니아케아 바깥'],
    ['머리털자리 초은하단', 'sc', 194.95, 28.0, 321, '머리털자리·사자자리 은하단 · CfA2 장성의 중심'],
    ['헤라클레스 초은하단', 'sc', 241.2, 17.7, 500, '헤라클레스 은하단들의 모임'],
    ['섀플리 초은하단', 'sc', 202.0, -31.5, 650, '근처 우주에서 가장 무거운 구조'],
    ['뱀주인자리 초은하단', 'sc', 258.1, -23.4, 390, '은하수 뒤에 가려진 초은하단'],
    ['사자자리 초은하단', 'sc', 176.2, 19.7, 300, '사자자리 은하단(Abell 1367) 주변'],
    ['CfA2 장성 (머리털자리 벽)', 'wall', 195, 28, 300, '1989년 발견된 은하의 벽 · 길이 약 5억 광년'],
    ['조각가자리 벽', 'wall', 5, -35, 300, '남쪽 하늘의 은하 벽'],
    ['국부 보이드', 'void', 285, 15, 75, '우리 바로 옆의 텅 빈 공간 · 우리를 밀어내는 중'],
    ['목동자리 보이드', 'void', 218, 46, 700, '지름 약 3억 광년의 거대한 빈 공간'],
  ];
  const lineSolid = new THREE.LineBasicMaterial({ color: 0x22b8c8, transparent: true, opacity: 0.7 });
  const lineDash = new THREE.LineDashedMaterial({ color: 0x22b8c8, transparent: true, opacity: 0.45, dashSize: 4e6, gapSize: 4e6 });
  for (const [name, kind, ra, dec, mly, desc] of STRUCT) {
    const p = new THREE.Vector3(...eqTo3(ra, dec, mly * MLY));
    const rel = p.clone().sub(sunV), h = rel.dot(SGZ);
    const foot = p.clone().addScaledVector(SGZ, -h);
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, foot]), h >= 0 ? lineSolid : lineDash);
    if (h < 0) ln.computeLineDistances();
    cosmos.add(ln);
    const col = kind === 'void' ? '#ff5a6e' : kind === 'wall' ? '#ffe45a' : '#5ae8ff';
    addLabel(p.toArray(), name.replace(/ \(.*\)$/, ''), col, 4e7, 3e10, kind === 'sc' ? 4 : 3);
    addPick(p.toArray(), name, `${mly >= 100 ? (mly / 100).toFixed(1).replace('.0', '') + '억' : mly * 100 + '만'} 광년 · ${{ sc: '초은하단', cl: '은하단', wall: '은하 벽', void: '보이드(빈 공간)' }[kind]}`, desc, 4e7, Infinity);
    if (kind === 'void') { // 보이드는 붉은 점선 구
      const r = (name.startsWith('목동') ? 160 : 60) * MLY;
      const g = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(r, 1));
      const m = new THREE.LineDashedMaterial({ color: 0xff5a6e, transparent: true, opacity: 0.16, dashSize: r * 0.05, gapSize: r * 0.05 });
      const v = new THREE.LineSegments(g, m); v.position.copy(p); v.computeLineDistances(); cosmos.add(v);
    }
  }
  addLabel(SUN, '우리은하 · 여기', '#3dff8f', 4e7, 3e10, 10, true);

  // ── 카메라 (궤도 조작) ──
  const target = new THREE.Vector3();
  let dist = 90000, yaw = -0.6, pitch = 0.9;
  let goal = null; // { target, dist, yaw?, pitch? }
  let autoRot = true;
  // 궤도 기준틀: 평소엔 은하면이 수평, '근처 우주'에선 초은하면이 수평
  const idQ = new THREE.Quaternion();
  const sgQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(SGX, SGZ, SGX.clone().cross(SGZ)));
  const frameQ = new THREE.Quaternion();
  let goalFrame = idQ;
  const view = (n, tilt = 0.45) => { // 원반 법선에서 살짝 기울여 보기
    const v3 = new THREE.Vector3(...n).normalize();
    const pitchN = Math.asin(Math.max(-1, Math.min(1, v3.y))), yawN = Math.atan2(v3.x, v3.z);
    return { pitch: Math.max(-1.45, Math.min(1.45, pitchN - tilt * Math.sign(pitchN || 1))), yaw: yawN };
  };
  const vM31 = view(normalFor(M31, 77, 38)), vM33 = view(normalFor(M33, 55, 23)), vLMC = view(normalFor(LMC, 35, 150));
  const PRESETS = {
    mw: { t: [0, 0, 0], d: 95000, pitch: 0.95, title: '우리은하 3D', desc: '막대 나선 은하 · 지름 약 10만 광년 · 별 1000억~4000억 개. 드래그로 돌리고, 휠·핀치로 확대. 점 위에 올리거나 탭하면 정보.' },
    side: { t: [0, 0, 0], d: 80000, pitch: 0.04, title: '옆에서 본 우리은하', desc: '원반 두께는 약 1천 광년(얇은 원반)으로 지름의 1%. 가운데가 땅콩 모양 팽대부, 위아래 보라색은 페르미 거품.' },
    gc: { t: [0, 0, 0], d: 16000, pitch: 0.55, title: '은하 중심부', desc: '중심 막대와 팽대부의 늙은 별들, 붉은 중심 분자대, 그 한가운데 블랙홀 궁수자리 A*. 아치스·5중 성단은 여기서 가장 무거운 젊은 별들의 무리.' },
    sun: { t: SUN, d: 2600, pitch: 0.6, title: '태양 주변 (실제 별)', desc: '실제 별 약 11만 9천 개(Gaia DR3 거리 · 맨눈 별 9,105개 + 망원경 별 11만 개)와 외계 행성계 3,688곳(초록). 은하 전체에 비하면 아주 작은 동네예요.' },
    lmc: { t: LMC, d: 60000, ...vLMC, title: '대마젤란 은하', desc: '우리은하의 가장 큰 위성은하. 한쪽으로 치우친 막대와 거대한 별 탄생 구역 타란툴라 성운(분홍).' },
    m31: { t: M31, d: 270000, ...vM31, title: '안드로메다 은하', desc: '국부은하군에서 가장 큰 은하. 큰 팽대부와 1만 광년대 먼지 고리. 지금도 초속 약 110km로 다가오는 중.' },
    m33: { t: M33, d: 95000, ...vM33, title: '삼각형자리 은하', desc: '안드로메다의 동반 은하로 추정. 팽대부가 거의 없고 나선팔이 솜털처럼 흩어진 은하.' },
    lg: { t: [M31[0] * 0.4, M31[1] * 0.4, M31[2] * 0.4], d: 4.6e6, pitch: 0.55, title: '국부은하군 3D', desc: '우리은하·안드로메다·삼각형자리 은하와 위성은하 수십 개. 실제 방향과 거리로 배치했어요.' },
    cosmos: { t: SUN, d: 1.45e9, pitch: 0.42, yaw: 0.35, frame: 'sg', title: '근처 우주 · 초은하단 지도', desc: '2MASS 적외선 하늘 탐사(2MRS)로 거리를 잰 실제 은하 약 4만 3천 개. 파란 원반은 초은하면(1억~5억 광년), 하늘색=초은하단 · 노랑=은하 벽 · 빨강=보이드. 가운데 빈 띠는 은하수에 가려 못 보는 곳(회피 영역).' },
  };
  const ORDER = [['mw', '우리은하'], ['side', '옆모습'], ['gc', '은하 중심'], ['sun', '태양 주변'], ['lmc', '대마젤란'], ['m31', '안드로메다'], ['m33', '삼각형자리'], ['lg', '국부은하군'], ['cosmos', '근처 우주'], ['bh', '블랙홀 체험'], ['gaia', 'Gaia 별 985만'], ['rot', '자동회전']];
  const bar = $('.g3-bar');
  for (const [k, name] of ORDER) {
    const b = document.createElement('button'); b.textContent = name; b.dataset.k = k;
    b.addEventListener('click', () => { if (k === 'bh') { openBH?.('sgra'); } else if (k === 'gaia') { gaia?.toggle(); b.classList.toggle('on', !!gaia?.on); if (gaia?.on && dist > 30000) go('sun'); } else if (k === 'rot') { autoRot = !autoRot; b.classList.toggle('on', autoRot); } else go(k); });
    bar.appendChild(b);
  }
  bar.querySelector('[data-k="rot"]').classList.add('on');
  if (gaia?.on) bar.querySelector('[data-k="gaia"]').classList.add('on');
  let lastGaiaT = 0;
  function go(k, instant = false) {
    const p = PRESETS[k];
    $('.g3-top h3').textContent = p.title; $('.g3-top p').textContent = p.desc;
    bar.querySelectorAll('button').forEach((b) => b.dataset.k !== 'rot' && b.dataset.k !== 'gaia' && b.dataset.k !== 'bh' && b.classList.toggle('on', b.dataset.k === k));
    goal = { target: new THREE.Vector3(...p.t), dist: p.d, pitch: p.pitch, yaw: p.yaw };
    goalFrame = p.frame === 'sg' ? sgQ : idQ;
    if (p.yaw !== undefined) autoRot = false, bar.querySelector('[data-k="rot"]')?.classList.remove('on');
    if (instant) { target.copy(goal.target); dist = goal.dist; pitch = goal.pitch; if (p.yaw !== undefined) yaw = p.yaw; frameQ.copy(goalFrame); goal = null; }
  }
  go(PRESETS[preset] ? preset : 'mw', true);

  // 입력
  const cv = renderer.domElement;
  const ptrs = new Map();
  let lastPinch = 0, moved = 0, downAt = 0, hoverPt = null, lastTapT = 0;
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; downAt = performance.now(); autoRotPause = performance.now(); });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect();
    hoverPt = e.pointerType === 'mouse' ? [e.clientX - r.left, e.clientY - r.top] : hoverPt;
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) {
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
      moved += Math.abs(dx) + Math.abs(dy);
      yaw -= dx * 0.006; pitch = Math.max(-1.5, Math.min(1.5, pitch + dy * 0.006));
      goal = goal && { ...goal, pitch: undefined, yaw: undefined };
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (lastPinch) zoomBy(lastPinch / d);
      lastPinch = d; moved += 10;
    }
    autoRotPause = performance.now();
  });
  const up = (e) => {
    ptrs.delete(e.pointerId); if (ptrs.size < 2) lastPinch = 0;
    if (moved < 6 && performance.now() - downAt < 400) {
      const r = cv.getBoundingClientRect();
      const pt = [e.clientX - r.left, e.clientY - r.top];
      const hit = pick(pt);
      const now = performance.now();
      if (hit && now - lastTapT < 350) { goal = { target: hit.pos.clone(), dist: Math.max(60, Math.min(dist, hit.pos.distanceTo(camera.position) * 0.35)) }; }
      lastTapT = now;
      tapHit = hit; tapPt = pt;
    }
  };
  let tapHit = null, tapPt = null, autoRotPause = 0;
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { hoverPt = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.exp(e.deltaY * 0.0015)); autoRotPause = performance.now(); }, { passive: false });
  function zoomBy(k) { dist = Math.max(25, Math.min(6e9, dist * k)); if (goal) goal.dist = undefined; }

  // 화면 투영
  const v = new THREE.Vector3();
  let W = 1, H = 1;
  const project = (p) => { v.copy(p).project(camera); return v.z < 1 ? [(v.x + 1) * W / 2, (1 - v.y) * H / 2] : null; };
  const vp = new THREE.Matrix4();
  function pickDeep(pt) {
    if (!deepSets.length || dist > 12000) return null;
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = vp.elements;
    let best = -1, bd = 7 * 7, bestSet = null;
    for (const set of deepSets) {
    const deepPos = set.pos;
    for (let i = 0, n = deepPos.length / 3; i < n; i++) {
      const x = deepPos[i * 3], y = deepPos[i * 3 + 1], z = deepPos[i * 3 + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 0) continue;
      const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w + 1) * W / 2;
      const dx = sx - pt[0]; if (dx > 7 || dx < -7) continue;
      const sy = (1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * H / 2;
      const d2 = dx * dx + (sy - pt[1]) ** 2;
      if (d2 < bd) { bd = d2; best = i; bestSet = set; }
    }
    }
    if (best < 0 || !describeDeep) return null;
    const [title, l2, l3] = describeDeep(bestSet.d, best);
    const P = bestSet.pos;
    return { pos: new THREE.Vector3(P[best * 3], P[best * 3 + 1], P[best * 3 + 2]), title, l2, l3 };
  }
  function pick(pt) {
    let best = null;
    for (const t of picks) {
      if (dist < t.min || dist > t.max) continue;
      const s = project(t.pos); if (!s) continue;
      const d = Math.hypot(s[0] - pt[0], s[1] - pt[1]);
      if (d < 14 && (!best || d < best.d)) best = { ...t, d, s };
    }
    if (!best) { const h = pickDeep(pt); if (h) { const s2 = project(h.pos); if (s2) best = { ...h, s: s2 }; } }
    return best;
  }

  function resize() {
    W = root.clientWidth || 1; H = root.clientHeight || 1;
    renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
    for (const m of mats) m.uniforms.uScale.value = H * 0.9 * Math.min(2, window.devicePixelRatio || 1) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
  const ro = new ResizeObserver(resize); ro.observe(root); resize();

  const info = $('.g3-info'), ring = $('.g3-ring');
  function showInfo(hit) {
    if (!hit) { info.style.display = 'none'; ring.style.display = 'none'; return; }
    info.children[0].textContent = hit.title; info.children[1].textContent = hit.l2 || ''; info.children[2].textContent = hit.l3 || '';
    const img = info.children[3];
    if (photoFor && img.dataset.k !== hit.title) {
      img.dataset.k = hit.title; img.style.display = 'none';
      photoFor(hit.title).then((ph) => { if (img.dataset.k === hit.title && ph) { img.onload = () => { if (img.dataset.k === hit.title) img.style.display = 'block'; }; img.src = ph.src; } });
    }
    info.style.display = 'block'; ring.style.display = 'block';
    ring.style.left = `${hit.s[0]}px`; ring.style.top = `${hit.s[1]}px`;
    const bw = info.offsetWidth, bh = info.offsetHeight;
    let x = hit.s[0] + 18, y = hit.s[1] - bh - 10;
    if (x + bw > W - 6) x = hit.s[0] - bw - 18;
    x = Math.max(6, Math.min(W - bw - 6, x)); if (y < 6) y = hit.s[1] + 16;
    info.style.left = `${x}px`; info.style.top = `${y}px`;
  }

  let raf = 0, last = performance.now(), destroyed = false, lastPickT = 0, hoverHit = null;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (goal) {
      const k = Math.min(1, dt * 2.6);
      target.lerp(goal.target, k);
      if (goal.dist !== undefined) dist = Math.exp(Math.log(dist) + (Math.log(goal.dist) - Math.log(dist)) * k);
      if (goal.pitch !== undefined) pitch += (goal.pitch - pitch) * k;
      if (goal.yaw !== undefined) { let dy = goal.yaw - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); yaw += dy * k; }
      if (target.distanceTo(goal.target) < dist * 0.002 && (goal.dist === undefined || Math.abs(Math.log(dist / goal.dist)) < 0.01)) goal = null;
    }
    if (autoRot && ptrs.size === 0 && now - autoRotPause > 2500) yaw += dt * 0.05;
    frameQ.slerp(goalFrame, Math.min(1, dt * 2.6));
    const off = new THREE.Vector3(dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw)).applyQuaternion(frameQ);
    camera.position.copy(target).add(off);
    camera.up.set(0, 1, 0).applyQuaternion(frameQ);
    cosmos.visible = dist > 2e7;
    camera.near = Math.max(0.5, dist * 0.002); camera.far = dist * 60 + 3e7;
    camera.updateProjectionMatrix();
    camera.lookAt(target);
    if (gaia?.on && now - lastGaiaT > 300 && dist < 40000) { // 보는 곳 주변의 Gaia 칸 요청
      lastGaiaT = now;
      const [ex, ey] = threeToEcl(target.x, target.y, target.z);
      gaia.view(ex - dist, ex + dist, ey - dist, ey + dist, dist * 0.6);
    }
    bubbleMat.uniforms.uA.value = Math.min(1, Math.max(0, (camera.position.length() - 26000) / 30000));
    renderer.render(scene, camera);

    // 라벨 배치 (우선순위 높은 것부터, 겹치면 숨김)
    const boxes = [];
    const order = labels.slice().sort((a, b) => b.prio - a.prio);
    let shown = 0;
    for (const L of order) {
      let vis = false;
      if (dist >= L.min && dist <= L.max && shown < 40) {
        const s = project(L.pos);
        if (s && s[0] > -40 && s[0] < W + 40 && s[1] > 0 && s[1] < H) {
          if (!L.w) L.w = L.el.offsetWidth || 60;
          const bx = s[0] - L.w / 2, by = s[1] - 22;
          if (!boxes.some((q) => bx < q[0] + q[2] && bx + L.w > q[0] && by < q[1] + 15 && by + 15 > q[1])) {
            boxes.push([bx, by, L.w]); vis = true; shown++;
            L.el.style.transform = `translate(${s[0]}px,${s[1]}px) translate(-50%,-140%)`;
          }
        }
      }
      L.el.style.opacity = vis ? '1' : '0';
    }
    // 호버/탭 정보
    let hit = null;
    if (hoverPt) {
      if (now - lastPickT > 90) { hoverHit = pick(hoverPt) || 0; lastPickT = now; }
      if (hoverHit) { const s2 = project(hoverHit.pos); hit = s2 ? { ...hoverHit, s: s2 } : null; }
    }
    else if (tapHit) { const s = project(tapHit.pos); hit = s ? { ...tapHit, s } : null; }
    showInfo(hit);
    $('.g3-scale').textContent = `시점 거리 ≈ ${fmtLy(dist)} · 드래그 회전 · 휠/핀치 확대 · 두 번 탭하면 그곳으로`;
    if (!destroyed) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function destroy() {
    if (destroyed) return;
    destroyed = true; cancelAnimationFrame(raf); ro.disconnect(); unsub?.();
    scene.traverse((o) => { o.geometry?.dispose(); });
    mats.forEach((m) => m.dispose()); bubbleMat.dispose();
    renderer.dispose(); root.remove();
    onClose?.();
  }
  $('.g3-close').addEventListener('click', destroy);
  return { destroy, go };
}
