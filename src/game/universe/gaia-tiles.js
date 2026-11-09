// Gaia DR3 별 약 985만 개 — '보이는 구역만' 받는 쿼드트리 타일 (public/gaia/)
// 좌표: 태양 중심 황도 직교좌표(광년). 칸마다 그 칸의 가장 밝은 별 K개 → 확대할수록 깊은 칸을 더 받음.
// 데이터: Gaia DR3 (ESA/Gaia/DPAC, CC BY-SA 3.0 IGO) · 밝은 별 1,000만 개 추출본: cosmoscout/gaia-stars

const EPS = (23.4392911 * Math.PI) / 180;
export const GAIA_ATTRIB = 'Gaia DR3 (ESA/Gaia/DPAC)';

export function createGaiaTiles({ base = '/gaia/', budget = 2600000, onLoad, onEvict } = {}) {
  let index = null, failed = false;
  const loaded = new Map(); // key → layer
  const pending = new Map();
  let total = 0, version = 0, tick = 0;
  const queue = [];
  let active = 0;
  fetch(base + 'index.json').then((r) => { if (!r.ok) throw new Error('index'); return r.json(); }).then((j) => { index = j; }).catch(() => { failed = true; });

  function decode(buf, L, cx, cy) {
    const N = new DataView(buf).getUint32(0, true);
    const cs = (2 * index.R) / (1 << L), x0 = -index.R + cx * cs, y0 = -index.R + cy * cs;
    let o = 4;
    const lx = new Uint16Array(buf, o, N); o += N * 2;
    const ly = new Uint16Array(buf, o, N); o += N * 2;
    const zz = new Int16Array(buf, o, N); o += N * 2;
    const mag = new Uint8Array(buf, o, N); o += N;
    const bp = new Int8Array(buf, o, N);
    const ex = new Float32Array(N), ey = new Float32Array(N), ez = new Float32Array(N), dist = new Float32Array(N), bv = new Int8Array(N);
    for (let i = 0; i < N; i++) {
      ex[i] = x0 + (lx[i] / 65535) * cs; ey[i] = y0 + (ly[i] / 65535) * cs; ez[i] = 10 * Math.sinh(zz[i] / index.zk);
      dist[i] = Math.hypot(ex[i], ey[i], ez[i]);
      bv[i] = Math.round(bp[i] * 0.8); // BP-RP → B-V 근사 (×50 단위 유지)
    }
    let maxMag = 0; for (let i = 0; i < N; i++) if (mag[i] > maxMag) maxMag = mag[i];
    const kids = [];
    if (L < index.maxL) for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) { const k = `${L + 1}/${cx * 2 + a}-${cy * 2 + b}`; if (index.nodes[k]) kids.push(k); }
    return { gaia: true, N, ex, ey, ez, ly: dist, mag, bv, maxMag, kids, key: `${L}/${cx}-${cy}`, L, box: [x0, y0, x0 + cs, y0 + cs] };
  }
  function pump() {
    while (active < 6 && queue.length) {
      queue.sort((a, b) => a.L - b.L);
      const job = queue.shift();
      active++;
      fetch(`${base}${job.key}.bin`).then((r) => { if (!r.ok) throw new Error(job.key); return r.arrayBuffer(); })
        .then((buf) => {
          const d = decode(buf, job.L, job.cx, job.cy);
          d.used = tick;
          loaded.set(job.key, d); total += d.N; version++;
          onLoad?.(d);
          evict();
        })
        .catch(() => {})
        .finally(() => { pending.delete(job.key); active--; pump(); });
    }
  }
  function evict() {
    if (total <= budget) return;
    const arr = [...loaded.values()].filter((d) => d.L > 3).sort((a, b) => a.used - b.used);
    for (const d of arr) {
      if (total <= budget * 0.85) break;
      if (d.used >= tick - 1) continue; // 지금 보이는 칸은 유지
      loaded.delete(d.key); total -= d.N; version++;
      onEvict?.(d);
    }
  }
  /** 보이는 영역(태양 중심 황도 x,y 광년)과 원하는 칸 크기 → 필요한 칸 요청 */
  function update(xmin, xmax, ymin, ymax, cellTarget) {
    if (!index) return;
    tick++;
    const R = index.R;
    let maxL = 0;
    while (maxL < index.maxL && (2 * R) / (1 << (maxL + 1)) >= cellTarget) maxL++;
    for (let L = 0; L <= maxL; L++) {
      const n = 1 << L, cs = (2 * R) / n;
      const i0 = Math.max(0, Math.floor((xmin + R) / cs)), i1 = Math.min(n - 1, Math.floor((xmax + R) / cs));
      const j0 = Math.max(0, Math.floor((ymin + R) / cs)), j1 = Math.min(n - 1, Math.floor((ymax + R) / cs));
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) continue;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const key = `${L}/${i}-${j}`;
        if (!index.nodes[key]) continue;
        const d = loaded.get(key);
        if (d) { d.used = tick; continue; }
        if (pending.has(key)) continue;
        pending.set(key, true);
        queue.push({ key, L, cx: i, cy: j });
      }
    }
    pump();
  }
  return {
    update,
    get ready() { return !!index; },
    get failed() { return failed; },
    get total() { return index ? index.total : 0; },
    get loadedCount() { return total; },
    get loading() { return active + queue.length; },
    get version() { return version; },
    layers: () => loaded.values(),
    /** 보이는 영역에서 빈틈 없이 다 받은 등급 한계(×10) — 칸 경계가 네모나게 보이지 않도록 이보다 어두운 별은 숨김 */
    magLimit(xmin, xmax, ymin, ymax) {
      let lim = 255;
      for (const d of loaded.values()) {
        const b = d.box;
        if (b[2] < xmin || b[0] > xmax || b[3] < ymin || b[1] > ymax) continue;
        if (!d.kids.length) continue;
        if (d.kids.every((k) => loaded.has(k))) continue;
        if (d.maxMag < lim) lim = d.maxMag;
      }
      return lim;
    },
  };
}

/** 황도 직교 → 적도 직교 */
export function eclToEq(x, y, z) {
  return [x, y * Math.cos(EPS) - z * Math.sin(EPS), y * Math.sin(EPS) + z * Math.cos(EPS)];
}
/** 적도 직교 → 황도 직교 */
export function eqToEclXYZ(x, y, z) {
  return [x, y * Math.cos(EPS) + z * Math.sin(EPS), -y * Math.sin(EPS) + z * Math.cos(EPS)];
}
/** B-P - R-P 색 → 한국어 */
export function bpColorKo(bv50) {
  const bv = bv50 / 50;
  return bv < 0 ? '청백색 별' : bv < 0.3 ? '백색 별' : bv < 0.6 ? '황백색 별' : bv < 0.85 ? '황색 별' : bv < 1.3 ? '주황색 별' : '적색 별';
}
