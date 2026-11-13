// 다른 행성·위성에 서서 보는 하늘 — 관측 위치(천체)별 자전축·지평 좌표계와 겉모습
// 좌표: 적도 좌표계(J2000, 단위벡터) · 위치는 태양 중심 AU
import { planetPositions } from './planets.js';
import { moonStates } from './moons.js';
import { moonEcl } from './astro.js';

const D = Math.PI / 180;
const EPS = 23.4393 * D;
const AU_KM = 1.495978707e8;
const eclToEq = (v) => [v[0], v[1] * Math.cos(EPS) - v[2] * Math.sin(EPS), v[1] * Math.sin(EPS) + v[2] * Math.cos(EPS)];
const radec = (a, d) => [Math.cos(d * D) * Math.cos(a * D), Math.cos(d * D) * Math.sin(a * D), Math.sin(d * D)];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// 자전축(IAU WGCCRE): 북극 적경·적위, 본초 자오선 W = W0 + Wd·d (d: J2000부터 일)
const POLE = {
  수성: [281.0103, 61.4155, 329.5988, 6.1385108],
  금성: [272.76, 67.16, 160.2, -1.4813688],
  화성: [317.269202, 54.432516, 176.049863, 350.891982443297],
  달: [269.9949, 66.5392],
  목성: [268.056595, 64.495303],
  토성: [40.589, 83.537],
  천왕성: [257.311, -15.175],
  해왕성: [299.36, 43.46],
  명왕성: [132.993, -6.163],
};
const PLANET_R = { 수성: 2439.7, 금성: 6051.8, 지구: 6371, 화성: 3389.5, 목성: 69911, 토성: 58232, 천왕성: 25362, 해왕성: 24622, 카론: 606, 명왕성: 1188 };
const PLANET_COL = { 지구: '#6fa8ff', 목성: '#e8cfa4', 토성: '#ecd9a0', 화성: '#d0714c', 천왕성: '#a8e6ef', 해왕성: '#6f8fff', 카론: '#b3aca2' };

/** 관측 장소 목록 */
export const SITES = [
  { id: 'earth', name: '지구', site: '내 위치' },
  { id: 'moon', name: '달', site: '아폴로 11호 착륙지(고요의 바다)', lat: 0.67, lon: 23.47, tidal: '지구', pole: '달',
    sky: null, ground: 'rgba(58,58,62,0.96)', note: '공기가 없어 낮에도 하늘이 까맣고 별이 보여요 · 지구는 늘 같은 자리에 떠서 위상만 바뀌어요' },
  { id: 'mercury', name: '수성', site: '적도', lat: 0, lon: 0, iau: '수성', sky: null, ground: 'rgba(70,64,58,0.96)', note: '해가 지구에서보다 2.5배 크게 보여요 · 하루(해 뜨고 다시 뜰 때까지)가 지구의 176일' },
  { id: 'venus', name: '금성', site: '구름 위 약 70km(땅에선 하늘이 안 보여요)', lat: 0, lon: 0, iau: '금성',
    sky: { top: [210, 190, 130], bot: [240, 220, 160], haze: 0.35 }, ground: 'rgba(225,205,150,0.97)', note: '해가 서쪽에서 떠서 동쪽으로 져요(거꾸로 자전) · 땅에서는 짙은 구름 때문에 하늘이 안 보여요' },
  { id: 'mars', name: '화성', site: '예제로 크레이터(퍼서비어런스 착륙지)', lat: 18.44, lon: 77.45, iau: '화성',
    sky: { top: [150, 110, 80], bot: [210, 165, 115], dusk: [90, 130, 190], haze: 0 }, ground: 'rgba(120,58,30,0.96)', note: '낮 하늘은 먼지 때문에 누런 주황, 해 질 녘엔 해 주변이 파래요 · 지구는 밝은 샛별처럼 보여요' },
  { id: 'io', name: '이오', site: '목성 쪽 반구', lat: 20, lon: 0, tidal: '목성', pole: '목성', ground: 'rgba(170,150,60,0.96)', sky: null,
    note: '목성이 하늘의 약 19°를 차지해요(보름달의 약 38배) · 화산이 400개 넘는 가장 활발한 천체' },
  { id: 'europa', name: '유로파', site: '목성 쪽 반구', lat: 20, lon: 0, tidal: '목성', pole: '목성', ground: 'rgba(205,200,190,0.96)', sky: null,
    note: '목성이 하늘의 약 12°를 차지해요 · 얼음 껍질 아래 바다가 있어 생명 후보지' },
  { id: 'phobos', name: '포보스', site: '화성 쪽 반구', lat: 20, lon: 0, tidal: '화성', pole: '화성', ground: 'rgba(70,62,56,0.96)', sky: null,
    note: '화성이 하늘의 약 42°를 덮어요(보름달의 80배) · 하루에 세 번 화성을 돌아요 · 언젠가 화성에 부서져 고리가 될 운명' },
  { id: 'ganymede', name: '가니메데', site: '목성 쪽 반구', lat: 20, lon: 0, tidal: '목성', pole: '목성', ground: 'rgba(150,140,125,0.96)', sky: null,
    note: '태양계에서 가장 큰 위성(수성보다 큼) · 목성이 하늘의 약 7.5°' },
  { id: 'callisto', name: '칼리스토', site: '목성 쪽 반구', lat: 20, lon: 0, tidal: '목성', pole: '목성', ground: 'rgba(95,88,80,0.96)', sky: null,
    note: '충돌구로 빽빽한 가장 오래된 표면 · 목성 방사선대 밖이라 사람이 기지를 짓기 좋은 후보' },
  { id: 'titan', name: '타이탄', site: '토성 쪽 반구', lat: 10, lon: 20, tidal: '토성', pole: '토성', ground: 'rgba(90,60,30,0.97)',
    sky: { top: [120, 70, 25], bot: [170, 110, 45], haze: 0.93, night: 0.18 }, note: '짙은 주황 안개 때문에 실제로는 토성도 별도 안 보여요 — 「대기 끄기」로 안개를 걷어 보세요' },
  { id: 'enceladus', name: '엔켈라두스', site: '토성 쪽 반구', lat: -20, lon: 0, tidal: '토성', pole: '토성', ground: 'rgba(228,236,245,0.96)', sky: null,
    note: '고리 안쪽을 도는 위성이라 고리가 옆면(가는 선)으로 보여요 · 남극에서 얼음 물기둥이 뿜어져요' },
  { id: 'miranda', name: '미란다', site: '천왕성 쪽 반구', lat: 20, lon: 0, tidal: '천왕성', pole: '천왕성', ground: 'rgba(170,172,176,0.96)', sky: null, approx: true,
    note: '천왕성이 하늘의 약 22° · 높이 20km의 절벽 베로나 루페스(떨어지는 데 12분) · 천왕성은 옆으로 누워 자전' },
  { id: 'triton', name: '트리톤', site: '해왕성 쪽 반구', lat: 20, lon: 0, tidal: '해왕성', pole: '해왕성', ground: 'rgba(225,205,195,0.96)', sky: null, approx: true,
    note: '해왕성이 하늘의 약 8° · 거꾸로 도는 위성(붙잡혀 온 카이퍼 벨트 천체) · 질소 간헐천' },
  { id: 'pluto', name: '명왕성', site: '카론 쪽 반구(스푸트니크 평원 근처)', lat: 20, lon: 0, tidal: '카론', pole: '명왕성', ground: 'rgba(210,195,175,0.96)',
    sky: { top: [8, 14, 30], bot: [20, 40, 80], haze: 0.05 }, approx: true,
    note: '카론이 하늘의 약 3.5°에 늘 같은 자리에 떠 있어요(서로 마주 보고 도는 짝) · 해는 아주 밝은 별 정도' },
];

/** 명왕성 태양 중심 위치(황도, AU) — JPL 근사 궤도 요소 */
export function plutoHelio3(date) {
  const T = (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525;
  const a = 39.48211675 - 0.00031596 * T, e = 0.2488273 + 0.0000517 * T, I = (17.14001206 + 0.00004818 * T) * D;
  const L = 238.92903833 + 145.20780515 * T, wbar = 224.06891629 - 0.04062942 * T, O = (110.30393684 - 0.01183482 * T) * D;
  const w = wbar * D - O, M = ((((L - wbar) % 360) + 540) % 360 - 180) * D;
  let E = M + e * Math.sin(M); for (let i = 0; i < 10; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return [(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp, (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp, sw * sI * xp + cw * sI * yp];
}

/** 어떤 위성의 태양 중심 위치(적도, AU) */
function moonHelioEq(parent, name, date, pp) {
  const st = moonStates(parent, date).find((m) => m.name === name);
  const P = eclToEq(pp[parent].pos), Eh = eclToEq(pp['지구'].pos);
  if (st.pos3) return add(P, eclToEq(st.pos3)); // 토성 위성: TASS 1.7 실제 3D 위치
  const pole = radec(POLE[parent][0], POLE[parent][1]);
  // 행성 적도면 기준: A = 행성→지구 방향을 적도면에 투영, B = 극 × A
  const toE = sub(Eh, P); const A = norm(sub(toE, mul(pole, dot(toE, pole)))); const B = cross(pole, A);
  const ppE = pp['지구'].pos, ppP = pp[parent].pos;
  const lonToEarth = Math.atan2(ppE[1] - ppP[1], ppE[0] - ppP[0]);
  const rel = st.angle - lonToEarth, d = st.distKm / AU_KM;
  return add(P, add(mul(A, Math.cos(rel) * d), mul(B, Math.sin(rel) * d)));
}
/** 지구의 달 위치(적도, 태양 중심 AU) */
function earthMoonHelioEq(date, pp) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const { lam, beta, distKm } = moonEcl(n);
  const g = eclToEq([Math.cos(beta * D) * Math.cos(lam * D), Math.cos(beta * D) * Math.sin(lam * D), Math.sin(beta * D)]);
  return add(eclToEq(pp['지구'].pos), mul(g, distKm / AU_KM));
}

/**
 * 관측 장소의 좌표계와 하늘에 보이는 큰 천체
 * @returns { pos, E, N, U, bodies: [{ name, pos, rKm, col, rings, pole }], self, parent, earthMoon }
 */
export function siteFrame(id, date = new Date()) {
  const S = SITES.find((q) => q.id === id);
  const pp = planetPositions(date);
  const charonEq = () => { // 명왕성-카론: 명왕성 적도면에서 6.387일 주기 (위상 기준점은 대략)
    const P = eclToEq(plutoHelio3(date)); const pole = radec(POLE['명왕성'][0], POLE['명왕성'][1]);
    const A = norm(cross(pole, [0, 0, 1])), Bv = cross(pole, A);
    const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0, ang = (2 * Math.PI * d) / 6.38723;
    const r = 19591 / AU_KM; return add(P, add(mul(A, Math.cos(ang) * r), mul(Bv, Math.sin(ang) * r)));
  };
  const helioEq = (nm) => nm === '명왕성' ? eclToEq(plutoHelio3(date)) : nm === '카론' ? charonEq() : eclToEq(pp[nm].pos);
  let pos, X, Z, selfName;
  if (S.iau) {
    selfName = S.iau;
    pos = helioEq(S.iau);
    const [a0, d0, W0, Wd] = POLE[S.iau];
    Z = radec(a0, d0);
    const node = [Math.cos((a0 + 90) * D), Math.sin((a0 + 90) * D), 0];
    const M = cross(Z, node);
    const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
    const W = (W0 + Wd * d) * D;
    X = add(mul(node, Math.cos(W)), mul(M, Math.sin(W)));
  } else {
    // 조석 고정 위성: 경도 0°가 늘 모행성을 향함
    selfName = S.name;
    pos = S.id === 'moon' ? earthMoonHelioEq(date, pp) : S.id === 'pluto' ? helioEq('명왕성') : moonHelioEq(S.tidal, S.name, date, pp);
    const parentPos = helioEq(S.tidal);
    Z = radec(POLE[S.pole][0], POLE[S.pole][1]);
    const toP = sub(parentPos, pos);
    X = norm(sub(toP, mul(Z, dot(toP, Z))));
  }
  const Y = cross(Z, X);
  const la = S.lat * D, lo = S.lon * D;
  const U = add(add(mul(X, Math.cos(la) * Math.cos(lo)), mul(Y, Math.cos(la) * Math.sin(lo))), mul(Z, Math.sin(la)));
  const E = norm(cross(Z, U));
  const N = cross(U, E);
  // 크게 보이는 천체: 모행성(또는 달에서 본 지구)
  const bodies = [];
  if (S.tidal) {
    const nm = S.tidal;
    bodies.push({ name: nm, pos: helioEq(nm), rKm: PLANET_R[nm], col: PLANET_COL[nm], rings: nm === '토성' || nm === '천왕성', ringThin: nm === '천왕성', pole: nm === '지구' || nm === '카론' ? [0, 0, 1] : radec(POLE[nm][0], POLE[nm][1]) });
  }
  const earthMoon = S.id === 'moon' ? null : earthMoonHelioEq(date, pp);
  return { site: S, pos, E, N, U, bodies, self: selfName, parent: S.tidal || null, earthMoon, helioEq, pp };
}
