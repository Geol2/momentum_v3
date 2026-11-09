// 인공위성·우주쓰레기 실시간 위치 (CelesTrak GP 궤도 자료 + SGP4)
// 궤도 자료: CelesTrak (https://celestrak.org) — 2시간마다 갱신되므로 브라우저에 2시간 캐시
import { twoline2satrec, propagate, gstime, eciToEcf, ecfToLookAngles, degreesToRadians } from 'satellite.js';

const RE = 6371;
const CACHE_MS = 2 * 3600 * 1000;
// [그룹, 종류]
const GROUPS = [
  ['stations', 'station'],
  ['active', 'active'],
  ['fengyun-1c-debris', 'debris'],
  ['cosmos-2251-debris', 'debris'],
  ['iridium-33-debris', 'debris'],
  ['cosmos-1408-debris', 'debris'],
];
const DEBRIS_KO = {
  'fengyun-1c-debris': '중국 펑윈-1C 위성 파편 (2007년 미사일 요격 실험)',
  'cosmos-2251-debris': '코스모스 2251 파편 (2009년 이리듐 33과 충돌)',
  'iridium-33-debris': '이리듐 33 파편 (2009년 코스모스 2251과 충돌)',
  'cosmos-1408-debris': '코스모스 1408 파편 (2021년 러시아 요격 실험)',
};

async function fetchGroup(g) {
  const key = `momentum.tle.${g}`;
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && Date.now() - c.t < CACHE_MS) return c.txt;
  } catch { /* 저장소 없음 */ }
  const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`);
  if (!r.ok) throw new Error(g);
  const txt = await r.text();
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), txt })); } catch { /* 용량 초과 등 */ }
  return txt;
}

export function createSatellites() {
  const sats = []; // { name, satrec, kind, group, id, year }
  const seen = new Set();
  let pos = new Float32Array(0); // ECEF / 지구 반지름
  let alt = new Float32Array(0), vel = new Float32Array(0);
  let ok = new Uint8Array(0);
  let ready = false, failed = false, cursor = 0, lastFull = 0;
  const counts = { station: 0, starlink: 0, active: 0, debris: 0 };

  (async () => {
    for (const [g, kind] of GROUPS) {
      let txt;
      try { txt = await fetchGroup(g); } catch { if (g === 'stations') failed = true; continue; }
      const lines = txt.split(/\r?\n/);
      for (let i = 0; i + 2 < lines.length; i += 3) {
        const name = lines[i].trim(), l1 = lines[i + 1], l2 = lines[i + 2];
        if (!l1 || !l1.startsWith('1 ')) continue;
        const id = l1.slice(2, 7).trim();
        const orb = l2.slice(8, 63); // 같은 궤도(정거장 모듈 등)는 하나만
        if (seen.has(id) || seen.has(orb)) continue;
        seen.add(id); seen.add(orb);
        let satrec;
        try { satrec = twoline2satrec(l1, l2); } catch { continue; }
        const yy = parseInt(l1.slice(9, 11), 10);
        const k = kind === 'station' ? (/^(ISS|CSS)/.test(name) ? 'station' : 'active') : kind === 'active' && /STARLINK/.test(name) ? 'starlink' : kind;
        sats.push({ name, satrec, kind: k, group: g, id, year: Number.isFinite(yy) ? (yy < 57 ? 2000 + yy : 1900 + yy) : null });
        counts[k]++;
      }
      grow();
    }
    ready = sats.length > 0;
  })();

  function grow() {
    const n = sats.length;
    const p2 = new Float32Array(n * 3); p2.set(pos.subarray(0, Math.min(pos.length, n * 3))); pos = p2;
    const a2 = new Float32Array(n); a2.set(alt.subarray(0, Math.min(alt.length, n))); alt = a2;
    const v2 = new Float32Array(n); v2.set(vel.subarray(0, Math.min(vel.length, n))); vel = v2;
    const o2 = new Uint8Array(n); o2.set(ok.subarray(0, Math.min(ok.length, n))); ok = o2;
    lastFull = 0;
  }
  function propOne(i, date, gmst) {
    const s = sats[i];
    const pv = propagate(s.satrec, date);
    if (!pv || !pv.position || typeof pv.position === 'boolean') { ok[i] = 0; return; }
    const e = eciToEcf(pv.position, gmst);
    pos[i * 3] = e.x / RE; pos[i * 3 + 1] = e.y / RE; pos[i * 3 + 2] = e.z / RE;
    const r = Math.hypot(e.x, e.y, e.z);
    alt[i] = r - RE;
    vel[i] = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
    ok[i] = r > RE * 0.99 && r < RE * 60 ? 1 : 0;
  }
  /** 매 프레임: 일정 수씩 나눠 계산(전부 약 1.5초마다 새로) */
  function step(budgetMs = 5) {
    const n = sats.length;
    if (!n) return;
    const date = new Date();
    const gmst = gstime(date);
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      propOne(cursor, date, gmst);
      cursor = (cursor + 1) % n;
      if (cursor === 0) lastFull = performance.now();
    }
    // 정거장은 매 프레임 정확히
    for (let i = 0; i < Math.min(n, 40); i++) if (sats[i].kind === 'station') propOne(i, date, gmst);
  }
  /** 궤도선(앞뒤 반 바퀴씩, ECEF가 아니라 '지금 지구' 기준 관성 궤도) */
  function orbitPath(i, steps = 120) {
    const s = sats[i];
    const periodMin = (2 * Math.PI) / s.satrec.no; // no: rad/min
    const now = Date.now(), gmst = gstime(new Date(now));
    const out = [];
    for (let k = 0; k <= steps; k++) {
      const t = new Date(now + ((k / steps) - 0.5) * periodMin * 60000);
      const pv = propagate(s.satrec, t);
      if (!pv || !pv.position || typeof pv.position === 'boolean') continue;
      const e = eciToEcf(pv.position, gmst); // 지금 시각의 회전으로 고정 → 궤도 고리 모양
      out.push([e.x / RE, e.y / RE, e.z / RE]);
    }
    return out;
  }
  /** 내 위치에서 보이는 ISS 통과 예보 (다음 48시간, 해 진 뒤 + ISS에 햇빛) */
  function passes(i, lat, lon, sunAltFn, hours = 48) {
    const s = sats[i];
    const obs = { longitude: degreesToRadians(lon), latitude: degreesToRadians(lat), height: 0.05 };
    const out = [];
    let cur = null;
    const t0 = Date.now();
    for (let t = t0; t < t0 + hours * 3600000; t += 20000) {
      const d = new Date(t);
      const pv = propagate(s.satrec, d);
      if (!pv || !pv.position || typeof pv.position === 'boolean') continue;
      const gmst = gstime(d);
      const ecf = eciToEcf(pv.position, gmst);
      const look = ecfToLookAngles(obs, ecf);
      const el = (look.elevation * 180) / Math.PI;
      if (el > 10) {
        const az = ((look.azimuth * 180) / Math.PI + 360) % 360;
        if (!cur) cur = { start: t, maxEl: el, azStart: az, azEnd: az, dark: sunAltFn(d) < -6, lit: false };
        cur.end = t; cur.azEnd = az;
        if (el > cur.maxEl) cur.maxEl = el;
        if (!cur.lit) cur.lit = sunlit(pv.position, d);
      } else if (cur) { out.push(cur); cur = null; }
    }
    return out.filter((p) => p.dark && p.lit);
  }
  return {
    get ready() { return ready; }, get failed() { return failed; }, get count() { return sats.length; }, counts,
    sats, step, orbitPath, passes,
    get pos() { return pos; }, get ok() { return ok; }, get alt() { return alt; }, get vel() { return vel; },
    debrisKo: (g) => DEBRIS_KO[g] || '',
  };
}

// 태양 방향(ECI, 대략) — 위성이 지구 그림자 밖인지
function sunEci(d) {
  const n = d.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = ((280.46 + 0.9856474 * n) % 360) * (Math.PI / 180);
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lam = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
  const eps = 23.439 * (Math.PI / 180);
  return [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
}
function sunlit(p, d) {
  const s = sunEci(d);
  const dot = p.x * s[0] + p.y * s[1] + p.z * s[2];
  if (dot > 0) return true;
  const perp = Math.hypot(p.x - dot * s[0], p.y - dot * s[1], p.z - dot * s[2]);
  return perp > RE;
}
const DIR16 = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
export const azKo = (az) => DIR16[Math.round(az / 22.5) % 16];
