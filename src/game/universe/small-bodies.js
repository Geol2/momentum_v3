// 태양계 작은 천체: 소행성(astorb, Lowell 천문대) 15만 개 · 근지구 소행성(JPL, 2026-07) · 혜성 · 성간 천체
// 위치는 궤도 요소로 2체 문제(케플러) 계산 — 오래된 요소(2013)는 행성 섭동 때문에 몇 도 어긋날 수 있어요.
import binUrl from './small-bodies.bin?url';
import jsonUrl from './small-bodies.json?url';

const K = 0.01720209895; // 가우스 중력 상수 (rad/day, AU)
const D2R = Math.PI / 180;
export const jdNow = (d = new Date()) => d.getTime() / 86400000 + 2440587.5;

/** 궤도 요소 → 태양 중심 황도 좌표(AU) */
export function keplerPos({ a, e, i, om, w, M, q, tp }, jd) {
  let r, nu;
  if (e < 1) {
    const aa = a ?? q / (1 - e);
    let Mm = M !== undefined ? M : (K / Math.pow(aa, 1.5)) * (jd - tp);
    Mm = ((Mm % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let E = e < 0.8 ? Mm : Math.PI;
    for (let k = 0; k < 12; k++) { const dE = (E - e * Math.sin(E) - Mm) / (1 - e * Math.cos(E)); E -= dE; if (Math.abs(dE) < 1e-9) break; }
    r = aa * (1 - e * Math.cos(E));
    nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  } else {
    const aa = q / (1 - e); // 음수
    const Mm = (K / Math.pow(-aa, 1.5)) * (jd - tp);
    let H = Math.asinh(Mm / e);
    for (let k = 0; k < 30; k++) { const dH = (e * Math.sinh(H) - H - Mm) / (e * Math.cosh(H) - 1); H -= dH; if (Math.abs(dH) < 1e-10) break; }
    r = aa * (1 - e * Math.cosh(H));
    nu = 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(H / 2));
  }
  return orbXYZ(r, nu, i, om, w);
}
function orbXYZ(r, nu, i, om, w) {
  const u = w + nu, cO = Math.cos(om), sO = Math.sin(om), ci = Math.cos(i);
  return [r * (cO * Math.cos(u) - sO * Math.sin(u) * ci), r * (sO * Math.cos(u) + cO * Math.sin(u) * ci), r * Math.sin(u) * Math.sin(i)];
}
/** 궤도선 점들 (AU) */
export function orbitLine(el, n = 240, rMax = 60) {
  const { e, i, om, w } = el;
  const q = el.q ?? el.a * (1 - e);
  const p = q * (1 + e);
  const out = [];
  const lim = e < 1 ? Math.PI : Math.acos(-1 / e) - 0.02;
  for (let k = 0; k <= n; k++) {
    const nu = -lim + (2 * lim * k) / n;
    const r = p / (1 + e * Math.cos(nu));
    if (r > rMax || r < 0) continue;
    out.push(orbXYZ(r, nu, i, om, w));
  }
  return out;
}

// 혜성·성간 천체 (각도: 도, tp: 근일점 통과 율리우스일)
const deg = (o) => ({ ...o, i: o.i * D2R, om: o.om * D2R, w: o.w * D2R });
export const COMETS = [
  { name: "1I/'오우무아무아", kind: 'iso', q: 0.2552, e: 1.2011, i: 122.74, om: 24.60, w: 241.81, tp: 2458006.0, desc: '2017년 처음 발견된 성간 천체 · 시가 모양, 혜성 꼬리 없이 가속' },
  { name: '2I/보리소프', kind: 'iso', q: 2.0066, e: 3.3565, i: 44.05, om: 308.15, w: 209.12, tp: 2458826.05, desc: '2019년 발견된 첫 성간 혜성 · 아마추어 천문가가 발견' },
  { name: '3I/ATLAS', kind: 'iso', q: 1.35648, e: 6.14135, i: 175.1165, om: 322.1696, w: 128.0229, tp: 2460977.9953, desc: '2025년 7월 발견된 세 번째 성간 천체 · 태양계보다 오래됐을 수도(최대 70억 년) · 2025.10.29 근일점' },
  { name: '1P/핼리 혜성', kind: 'comet', q: 0.5860, e: 0.96714, i: 162.26, om: 58.42, w: 111.33, tp: 2446470.95, desc: '약 76년 주기 · 다음 근일점 2061년 7월' },
  { name: '2P/엥케 혜성', kind: 'comet', q: 0.336, e: 0.8471, i: 11.78, om: 334.57, w: 186.54, tp: 2460239.4, desc: '3.3년으로 주기가 가장 짧은 혜성 중 하나' },
  { name: '67P/추류모프-게라시멘코', kind: 'comet', q: 1.211, e: 0.6497, i: 3.87, om: 36.33, w: 22.15, tp: 2459520.2, desc: '로제타 탐사선이 2014년 착륙한 혜성 · 6.4년 주기 (궤도 근사)' },
  { name: 'C/1995 O1 헤일-밥', kind: 'comet', q: 0.9141, e: 0.99511, i: 89.43, om: 282.47, w: 130.59, tp: 2450539.64, desc: '1997년 18개월 동안 맨눈으로 보인 대혜성 · 주기 약 2,500년' },
  { name: 'C/2023 A3 쯔진산-ATLAS', kind: 'comet', q: 0.3914, e: 1.0001, i: 139.11, om: 21.56, w: 308.49, tp: 2460581.2, desc: '2024년 가을 맨눈 혜성 · 태양계를 떠나는 중' },
].map(deg);

export async function loadSmallBodies() {
  const [buf, js] = await Promise.all([fetch(binUrl).then((r) => r.arrayBuffer()), fetch(jsonUrl).then((r) => r.json())]);
  const dv = new DataView(buf);
  const N = dv.getUint32(0, true), ep = dv.getFloat64(4, true);
  let o = 12;
  const take = (T, b) => { const a = new T(buf.slice(o, o + N * b)); o += N * b; return a; };
  const a = take(Float32Array, 4), e = take(Float32Array, 4), iU = take(Uint16Array, 2), omU = take(Uint16Array, 2), wU = take(Uint16Array, 2), mU = take(Uint16Array, 2), H = take(Uint8Array, 1);
  const jd = jdNow();
  const x = new Float32Array(N), y = new Float32Array(N), cls = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const el = { a: a[k], e: e[k], i: (iU[k] / 65535) * Math.PI, om: (omU[k] / 65535) * 2 * Math.PI, w: (wU[k] / 65535) * 2 * Math.PI };
    const n = K / Math.pow(el.a, 1.5);
    el.M = (mU[k] / 65535) * 2 * Math.PI + n * (jd - ep);
    const p = keplerPos(el, jd);
    x[k] = p[0]; y[k] = p[1];
    cls[k] = classify(el.a, el.e);
  }
  // 근지구 소행성
  const neos = js.neos.map(([name, pdes, klass, pha, h, diam, epoch, aa, ee, ii, om, w, ma, moidLd]) => {
    const el = { a: aa, e: ee, i: ii * D2R, om: om * D2R, w: w * D2R };
    el.M = ma * D2R + (K / Math.pow(aa, 1.5)) * (jd - epoch);
    const p = keplerPos(el, jd);
    return { name, pdes, klass, pha: !!pha, H: h, diam, a: aa, e: ee, el, moidLd, x: p[0], y: p[1] };
  });
  const comets = COMETS.map((c) => { const p = keplerPos(c, jd); return { ...c, x: p[0], y: p[1], r: Math.hypot(...p), line: orbitLine(c, 300, c.kind === 'iso' ? 40 : 60) }; });
  return { N, a, e, H, x, y, cls, names: js.astNames, astEpoch: ep, neos, neoSnapshot: js.neoSnapshot, cad: js.cad, comets };
}
// 0 주 소행성대, 1 근지구, 2 힐다, 3 트로이, 4 켄타우루스, 5 해왕성 바깥(TNO), 6 기타
export function classify(a, e) {
  const q = a * (1 - e);
  if (q < 1.3) return 1;
  if (a > 30) return 5;
  if (a > 5.5) return 4;
  if (a > 5.05 && a < 5.35) return 3;
  if (a > 3.7 && a < 4.2) return 2;
  if (a > 2.0 && a < 3.4) return 0;
  return 6;
}
export const CLASS_KO = ['주 소행성대', '근지구 소행성', '힐다 군', '목성 트로이 소행성', '켄타우루스 천체', '해왕성 바깥 천체(TNO)', '소행성'];
export const CLASS_COL = ['rgba(215,195,160,0.85)', 'rgba(255,90,80,0.95)', 'rgba(255,215,120,0.9)', 'rgba(255,160,80,0.9)', 'rgba(140,240,170,0.9)', 'rgba(140,190,255,0.95)', 'rgba(190,190,200,0.8)'];
export const diamKm = (H, p = 0.14) => (1329 / Math.sqrt(p)) * Math.pow(10, -H / 5);
