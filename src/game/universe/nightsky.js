// 밤하늘 모드: 내 위치·지금 시각에서 올려다본 하늘 (입체 투영)
// 별: AT-HYG(Gaia DR3 거리) · 별자리 선/은하수: d3-celestial (BSD-3) · 행성/달/해: 궤도 계산
import linesUrl from './sky-lines.json?url';
import { planetPositions } from './planets.js';
import { sunDirection, moonState } from './astro.js';
import { bvRgb } from './deep-stars.js';

const D = Math.PI / 180;
const EPS = 23.4393 * D;
const PLANET_KO = ['수성', '금성', '화성', '목성', '토성', '천왕성', '해왕성'];
const PLANET_COL = { 수성: '#c8bfb4', 금성: '#fff3c4', 화성: '#ff8a5c', 목성: '#f2d7a8', 토성: '#f0dc9c', 천왕성: '#a8e6ef', 해왕성: '#8fa8ff' };

const gmst = (d) => { const n = d.getTime() / 86400000 + 2440587.5 - 2451545.0; return ((280.46061837 + 360.98564736629 * n) % 360 + 360) % 360; };
const eqVec = (raDeg, decDeg) => { const a = raDeg * D, b = decDeg * D; return [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)]; };

const CSS = `
.ns-root{position:absolute;inset:0;z-index:22;background:#000;touch-action:none;overflow:hidden}
.ns-root canvas{position:absolute;inset:0;width:100%;height:100%;cursor:grab}
.ns-top{position:absolute;top:10px;left:10px;right:58px;max-width:560px;padding:10px 12px;z-index:2;pointer-events:none}
.ns-top h3{margin:0;color:var(--g);font-size:16px;letter-spacing:.05em;text-shadow:var(--glow)}
.ns-top p{margin:5px 0 0;color:var(--gd);font-size:11.5px;line-height:1.5}
.ns-bar{position:absolute;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px 10px calc(10px + env(safe-area-inset-bottom));z-index:2;background:linear-gradient(transparent,rgba(1,6,4,.9) 40%)}
.ns-bar button,.ns-close{border:1px solid var(--g2);background:rgba(1,22,11,.78);color:var(--g);font-family:inherit;font-weight:700;font-size:11.5px;cursor:pointer;text-shadow:var(--glow);padding:7px 10px;
  clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}
.ns-bar button.on{background:rgba(61,255,143,.28);color:#eafff2}
.ns-close{position:absolute;top:10px;right:10px;width:38px;height:38px;padding:0;z-index:3}
.ns-info{position:absolute;z-index:3;pointer-events:none;padding:7px 10px 8px;max-width:min(300px,calc(100% - 24px));background:rgba(1,18,9,.92);border:1px solid rgba(61,255,143,.8);
  box-shadow:0 0 10px rgba(61,255,143,.5);display:none}
.ns-info b{display:block;color:var(--g);font-size:12px}.ns-info span{display:block;color:var(--gd);font-size:10.5px;line-height:1.45;margin-top:2px}
`;

export function openNightSky(host, { sky, deep, loc, sats, onClose, describeStar } = {}) {
  if (!document.getElementById('ns-style')) { const st = document.createElement('style'); st.id = 'ns-style'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div'); root.className = 'ns-root';
  root.innerHTML = `<canvas></canvas><div class="ns-top mu-frame"><h3>밤하늘 모드</h3><p></p></div><button class="ns-close" aria-label="닫기">✕</button><div class="ns-info"><b></b><span></span><span></span></div><div class="ns-bar"></div>`;
  host.appendChild(root);
  const cv = root.querySelector('canvas'), g = cv.getContext('2d');
  const info = root.querySelector('.ns-info');
  let W = 1, H = 1, dpr = 1;
  let az = 180, alt = 35, fov = 100; // 남쪽 하늘부터
  let tOff = 0, atmo = true, lines = null, gyro = false, showDeep = true;
  const lat = loc.lat * D, lon = loc.lon * D;
  const E = [-Math.sin(lon), Math.cos(lon), 0], N = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)], U = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  // 은하수: 윤곽 다각형을 적경·적위 지도(0.5°/px)에 겹쳐 칠하고 흐리게 → 화면 픽셀마다 거꾸로 찾아 부드럽게 그림
  let mwMap = null; const MW_W = 720, MW_H = 360;
  fetch(linesUrl).then((r) => r.json()).then((j) => {
    lines = j;
    const c = document.createElement('canvas'); c.width = MW_W; c.height = MW_H;
    const cg = c.getContext('2d');
    cg.fillStyle = '#fff';
    for (const lvl of j.mw) {
      cg.globalAlpha = 0.22;
      for (const poly of lvl.p) {
        // 적경이 0/360을 넘나드는 곳은 이어 붙이고 세 번(±360°) 그려서 경계 처리
        let prev = null; const pts = [];
        for (const [ra, de] of poly) { let x = ra; if (prev !== null) { while (x - prev > 180) x -= 360; while (prev - x > 180) x += 360; } pts.push([x, de]); prev = x; }
        for (const off of [-360, 0, 360]) {
          cg.beginPath();
          pts.forEach(([x, de], k) => { const X = (x + off) * 2, Y = (90 - de) * 2; k ? cg.lineTo(X, Y) : cg.moveTo(X, Y); });
          cg.closePath(); cg.fill();
        }
      }
    }
    const c2 = document.createElement('canvas'); c2.width = MW_W; c2.height = MW_H;
    const g2 = c2.getContext('2d'); g2.filter = 'blur(5px)'; g2.drawImage(c, 0, 0); g2.filter = 'none';
    const d = g2.getImageData(0, 0, MW_W, MW_H).data;
    mwMap = new Float32Array(MW_W * MW_H);
    for (let i = 0; i < mwMap.length; i++) mwMap[i] = d[i * 4 + 3] / 255 * (d[i * 4] / 255);
  }).catch(() => {});
  const mwCv = document.createElement('canvas'), mwG = mwCv.getContext('2d');
  let mwImg = null;

  // 별 단위벡터(적도) 미리 계산
  const stars = [];
  if (sky) sky.rows.forEach((r, i) => stars.push({ v: eqVec(r[2], r[3]), mag: r[5], bv: r[7] ?? 0.6, name: r[0], i }));
  const faint = [];
  if (deep) for (let i = 0; i < deep.N; i++) { const m = deep.mag[i] / 10; if (m <= 7.6) faint.push({ v: eqVec(deep.ra[i], deep.dec[i]), mag: m, bv: deep.bv[i] / 50 }); }
  for (const s of [...stars, ...faint]) { const [r, gg, b] = bvRgb(s.bv); s.col = `rgb(${r | 0},${gg | 0},${b | 0})`; }

  // 바
  const bar = root.querySelector('.ns-bar');
  const btn = (k, label, fn) => { const b = document.createElement('button'); b.textContent = label; b.dataset.k = k; b.onclick = () => fn(b); bar.appendChild(b); return b; };
  btn('m1', '-1시간', () => { tOff -= 3600000; });
  btn('now', '지금', () => { tOff = 0; });
  btn('p1', '+1시간', () => { tOff += 3600000; });
  btn('atmo', '대기 끄기', (b) => { atmo = !atmo; b.classList.toggle('on', !atmo); });
  btn('deep', '어두운 별', (b) => { showDeep = !showDeep; b.classList.toggle('on', showDeep); }).classList.add('on');
  for (const [k, label, a0] of [['n', '북', 0], ['e', '동', 90], ['s', '남', 180], ['w', '서', 270]]) btn(k, label, () => { az = a0; gyro = false; gyroB.classList.remove('on'); });
  const gyroB = btn('gyro', '폰을 하늘에', async (b) => {
    if (!gyro) {
      try { if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) { const p = await DeviceOrientationEvent.requestPermission(); if (p !== 'granted') return; } } catch { return; }
      gyro = true; b.classList.add('on');
    } else { gyro = false; b.classList.remove('on'); }
  });
  const onOri = (e) => {
    if (!gyro || e.beta == null) return;
    const heading = e.webkitCompassHeading != null ? e.webkitCompassHeading : e.absolute ? 360 - e.alpha : null;
    if (heading == null) return;
    // 휴대폰 뒷면이 가리키는 방향: 세로로 들고 위로 기울이면 beta 90 → 수평, 180 → 천정
    alt = Math.max(-30, Math.min(89, e.beta - 90)); // 세로로 들고 위로 젖히면 beta 90→180
    az = (heading + 360) % 360;
  };
  window.addEventListener('deviceorientationabsolute', onOri);
  window.addEventListener('deviceorientation', onOri);

  // 입력
  const ptr = new Map(); let pinch = 0, hover = null, tap = null;
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY, 0]); });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect();
    if (e.pointerType === 'mouse') hover = [e.clientX - r.left, e.clientY - r.top];
    if (!ptr.has(e.pointerId)) return;
    const p = ptr.get(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY, p[2] + Math.abs(e.clientX - p[0]) + Math.abs(e.clientY - p[1])]);
    if (ptr.size === 1) { const k = fov / H; az = (az - (e.clientX - p[0]) * k + 360) % 360; alt = Math.max(-20, Math.min(89.9, alt + (e.clientY - p[1]) * k)); gyro = false; gyroB.classList.remove('on'); }
    else { const [a, b] = [...ptr.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) fov = Math.max(20, Math.min(160, fov * (pinch / d))); pinch = d; }
  });
  const up = (e) => { const p = ptr.get(e.pointerId); ptr.delete(e.pointerId); if (ptr.size < 2) pinch = 0; if (p && p[2] < 6) { const r = cv.getBoundingClientRect(); tap = [e.clientX - r.left, e.clientY - r.top]; } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { hover = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); fov = Math.max(20, Math.min(160, fov * Math.exp(e.deltaY * 0.001))); }, { passive: false });

  function resize() { W = root.clientWidth || 1; H = root.clientHeight || 1; dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; }
  const ro = new ResizeObserver(resize); ro.observe(root); resize();

  let raf = 0, dead = false;
  function frame() {
    const date = new Date(Date.now() + tOff);
    const th = gmst(date) * D, ct = Math.cos(th), st = Math.sin(th);
    // 적도 → ECEF → ENU 결합 행렬
    const toEcef = (v) => [v[0] * ct + v[1] * st, -v[0] * st + v[1] * ct, v[2]];
    const enuOf = (e) => [e[0] * E[0] + e[1] * E[1] + e[2] * E[2], e[0] * N[0] + e[1] * N[1] + e[2] * N[2], e[0] * U[0] + e[1] * U[1] + e[2] * U[2]];
    const eqToEnu = (v) => enuOf(toEcef(v));
    // 시선 기준
    const a0 = az * D, h0 = alt * D;
    const f = [Math.sin(a0) * Math.cos(h0), Math.cos(a0) * Math.cos(h0), Math.sin(h0)];
    const rgt = [Math.cos(a0), -Math.sin(a0), 0];
    const upv = [rgt[1] * f[2] - rgt[2] * f[1], rgt[2] * f[0] - rgt[0] * f[2], rgt[0] * f[1] - rgt[1] * f[0]];
    const scale = (W / 2) / (2 * Math.tan((fov * D) / 4));
    const proj = (v) => {
      const z = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
      if (z < -0.3) return null;
      const k = 2 / (1 + z);
      return [W / 2 + (v[0] * rgt[0] + v[1] * rgt[1] + v[2] * rgt[2]) * k * scale, H / 2 - (v[0] * upv[0] + v[1] * upv[1] + v[2] * upv[2]) * k * scale];
    };
    // 해·달
    const sunEnu = enuOf(sunDirection(date));
    const sunAlt = Math.asin(sunEnu[2]) / D;
    const ms = moonState(date);
    const mp = ms.pos, mr = Math.hypot(...mp);
    const mTopo = [mp[0] - U[0], mp[1] - U[1], mp[2] - U[2]], mtl = Math.hypot(...mTopo);
    const moonEnu = enuOf(mTopo.map((x) => x / mtl));
    // 하늘색
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const day = atmo ? Math.max(0, Math.min(1, (sunAlt + 8) / 14)) : 0;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, `rgb(${2 + 40 * day | 0},${6 + 90 * day | 0},${14 + 170 * day | 0})`);
    grd.addColorStop(1, `rgb(${6 + 120 * day | 0},${10 + 140 * day | 0},${20 + 190 * day | 0})`);
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    const starA = 1 - day * 0.97;
    // 은하수 (저해상도로 계산 후 부드럽게 확대)
    if (mwMap && starA > 0.05) {
      const step = 5, lw = Math.ceil(W / step), lh = Math.ceil(H / step);
      if (mwCv.width !== lw || mwCv.height !== lh) { mwCv.width = lw; mwCv.height = lh; mwImg = mwG.createImageData(lw, lh); }
      const px = mwImg.data;
      for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
        const u = ((i + 0.5) * step - W / 2) / scale, v = -((j + 0.5) * step - H / 2) / scale;
        const r2 = u * u + v * v, z = (4 - r2) / (4 + r2), k = (1 + z) / 2;
        const X = u * k, Y = v * k;
        const e0 = X * rgt[0] + Y * upv[0] + z * f[0], e1 = X * rgt[1] + Y * upv[1] + z * f[1], e2 = X * rgt[2] + Y * upv[2] + z * f[2];
        // ENU → ECEF → 적도
        const x = e0 * E[0] + e1 * N[0] + e2 * U[0], y = e0 * E[1] + e1 * N[1] + e2 * U[1], zz = e0 * E[2] + e1 * N[2] + e2 * U[2];
        const qx = x * ct - y * st, qy = x * st + y * ct;
        let ra = Math.atan2(qy, qx) / D; if (ra < 0) ra += 360;
        const de = Math.asin(Math.max(-1, Math.min(1, zz))) / D;
        const mx = Math.min(MW_W - 1, (ra * 2) | 0), my = Math.min(MW_H - 1, ((90 - de) * 2) | 0);
        const lum = mwMap[my * MW_W + mx];
        const o = (j * lw + i) * 4;
        px[o] = 190; px[o + 1] = 205; px[o + 2] = 255; px[o + 3] = Math.min(255, lum * 230 * starA * (e2 < 0 ? 0.3 : 1));
      }
      mwG.putImageData(mwImg, 0, 0);
      g.globalAlpha = 1; g.imageSmoothingEnabled = true; g.drawImage(mwCv, 0, 0, W, H);
    }
    // 별자리 선
    if (lines && starA > 0.05) {
      g.globalAlpha = starA * 0.45; g.strokeStyle = '#3dff8f'; g.lineWidth = 0.8;
      g.beginPath();
      for (const segs of Object.values(lines.lines)) for (const seg of segs) {
        let prev = null;
        for (const [ra, de] of seg) { const p = proj(eqToEnu(eqVec(ra, de))); if (p && prev) { g.moveTo(prev[0], prev[1]); g.lineTo(p[0], p[1]); } prev = p; }
      }
      g.stroke();
      g.globalAlpha = starA * 0.7; g.fillStyle = '#7fdcaa'; g.font = '600 10px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; g.textAlign = 'center';
      for (const [id, [ra, de, rank]] of Object.entries(lines.cen)) {
        if (rank > (fov > 110 ? 1 : fov > 60 ? 2 : 3)) continue;
        const p = proj(eqToEnu(eqVec(ra, de))); if (!p) continue;
        g.fillText(sky?.con?.[id] || id, p[0], p[1]);
      }
    }
    // 별
    const picks = [];
    const magLim = Math.min(7.6, 4.5 + (160 - fov) / 30) - day * 5;
    const drawStar = (s, pick) => {
      if (s.mag > magLim) return;
      const v = eqToEnu(s.v);
      const p = proj(v); if (!p || p[0] < -5 || p[0] > W + 5 || p[1] < -5 || p[1] > H + 5) return;
      const r = Math.max(0.5, (magLim + 1.5 - s.mag) * 0.55 * (100 / fov) ** 0.3);
      g.globalAlpha = Math.min(1, starA * (0.35 + (magLim - s.mag) * 0.2)) * (v[2] < 0 ? 0.25 : 1);
      g.fillStyle = s.col; g.beginPath(); g.arc(p[0], p[1], r, 0, Math.PI * 2); g.fill();
      if (pick) picks.push({ p, s, kind: 'star', alt: Math.asin(v[2]) / D, az: (Math.atan2(v[0], v[1]) / D + 360) % 360 });
    };
    if (showDeep) for (const s of faint) drawStar(s, false);
    for (const s of stars) drawStar(s, true);
    // 이름표(밝은 별)
    g.globalAlpha = starA; g.font = '600 10.5px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; g.textAlign = 'left'; g.fillStyle = '#a6ffcb';
    for (const q of picks) if (q.s.name && q.s.mag < (fov > 100 ? 1.0 : fov > 50 ? 2.0 : 3.2)) g.fillText(q.s.name.replace(/ \(.*\)$/, ''), q.p[0] + 5, q.p[1] - 4);
    // 행성
    const pp = planetPositions(date), earth = pp['지구'].pos;
    for (const name of PLANET_KO) {
      const hp = pp[name].pos, ge = [hp[0] - earth[0], hp[1] - earth[1], (hp[2] || 0) - (earth[2] || 0)];
      const v = [ge[0], ge[1] * Math.cos(EPS) - ge[2] * Math.sin(EPS), ge[1] * Math.sin(EPS) + ge[2] * Math.cos(EPS)];
      const L = Math.hypot(...v); const enu = eqToEnu(v.map((x) => x / L));
      const p = proj(enu); if (!p) continue;
      g.globalAlpha = enu[2] < 0 ? 0.35 : 1; g.fillStyle = PLANET_COL[name];
      g.beginPath(); g.arc(p[0], p[1], 3.2, 0, Math.PI * 2); g.fill();
      g.font = '700 11px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; g.fillText(name, p[0] + 6, p[1] - 5);
      picks.push({ p, kind: 'planet', name, dist: L, alt: Math.asin(enu[2]) / D, az: (Math.atan2(enu[0], enu[1]) / D + 360) % 360 });
    }
    // 달
    {
      const p = proj(moonEnu);
      if (p) {
        const R = Math.max(5, (0.26 * D / (fov * D)) * W * 2.5);
        g.globalAlpha = moonEnu[2] < 0 ? 0.35 : 1;
        g.fillStyle = '#2a2e38'; g.beginPath(); g.arc(p[0], p[1], R, 0, Math.PI * 2); g.fill();
        // 밝은 쪽: 해 방향
        const sp = proj(sunEnu) || [p[0] + (sunEnu[0] - moonEnu[0]) * 1000, p[1] - (sunEnu[2] - moonEnu[2]) * 1000];
        const ang = Math.atan2(sp[1] - p[1], sp[0] - p[0]);
        const k = 1 - 2 * ms.illum; // 1 = 삭, -1 = 망
        g.save(); g.translate(p[0], p[1]); g.rotate(ang);
        g.fillStyle = '#f2f0e6'; g.beginPath(); g.arc(0, 0, R, -Math.PI / 2, Math.PI / 2); g.ellipse(0, 0, R * Math.abs(k), R, 0, Math.PI / 2, -Math.PI / 2, k > 0); g.fill();
        g.restore();
        g.fillStyle = '#e8ecff'; g.font = '700 11px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; g.fillText(`달 · ${ms.phase}`, p[0] + R + 5, p[1] - 4);
        picks.push({ p, kind: 'moon', alt: Math.asin(moonEnu[2]) / D, az: (Math.atan2(moonEnu[0], moonEnu[1]) / D + 360) % 360 });
      }
      const s = proj(sunEnu);
      if (s && sunEnu[2] > -0.05) { g.globalAlpha = 1; const gr = g.createRadialGradient(s[0], s[1], 0, s[0], s[1], 40); gr.addColorStop(0, '#fffbe8'); gr.addColorStop(0.2, 'rgba(255,240,180,.8)'); gr.addColorStop(1, 'rgba(255,220,150,0)'); g.fillStyle = gr; g.beginPath(); g.arc(s[0], s[1], 40, 0, Math.PI * 2); g.fill(); }
    }
    // 국제우주정거장
    if (sats && sats.count) {
      const i = sats.sats.findIndex((q) => /^ISS/.test(q.name));
      if (i >= 0 && sats.ok[i]) {
        const P = sats.pos, t = [P[i * 3] - U[0], P[i * 3 + 1] - U[1], P[i * 3 + 2] - U[2]], tl = Math.hypot(...t);
        const enu = enuOf(t.map((x) => x / tl));
        if (enu[2] > 0) { const p = proj(enu); if (p) { g.globalAlpha = 1; g.fillStyle = '#3dff8f'; g.beginPath(); g.arc(p[0], p[1], 3, 0, Math.PI * 2); g.fill(); g.fillText('ISS', p[0] + 6, p[1] - 4); picks.push({ p, kind: 'iss', alt: Math.asin(enu[2]) / D, az: (Math.atan2(enu[0], enu[1]) / D + 360) % 360, km: tl * 6371 }); } }
      }
    }
    // 땅: 입체 투영에서 지평선은 원(또는 직선) → 세 점으로 원을 구해 칠함
    g.globalAlpha = 1;
    const projAll = (v) => { const z = v[0] * f[0] + v[1] * f[1] + v[2] * f[2]; if (z < -0.999) return null; const k = 2 / (1 + z);
      return [W / 2 + (v[0] * rgt[0] + v[1] * rgt[1] + v[2] * rgt[2]) * k * scale, H / 2 - (v[0] * upv[0] + v[1] * upv[1] + v[2] * upv[2]) * k * scale]; };
    const hp = [0, 120, 240].map((a) => projAll([Math.sin(a * D), Math.cos(a * D), 0])).filter(Boolean);
    const groundCol = atmo ? `rgba(4,${14 + 30 * day | 0},8,0.94)` : 'rgba(2,10,5,0.6)';
    if (hp.length === 3) {
      const [A, B, C2] = hp;
      const dd = 2 * (A[0] * (B[1] - C2[1]) + B[0] * (C2[1] - A[1]) + C2[0] * (A[1] - B[1]));
      if (Math.abs(dd) > 1e-6) {
        const sq = (q) => q[0] * q[0] + q[1] * q[1];
        const ux = (sq(A) * (B[1] - C2[1]) + sq(B) * (C2[1] - A[1]) + sq(C2) * (A[1] - B[1])) / dd, uy = (sq(A) * (C2[0] - B[0]) + sq(B) * (A[0] - C2[0]) + sq(C2) * (B[0] - A[0])) / dd;
        const R = Math.hypot(A[0] - ux, A[1] - uy);
        const nadir = projAll([0, 0, -1]);
        const inside = nadir ? Math.hypot(nadir[0] - ux, nadir[1] - uy) < R : false;
        g.fillStyle = groundCol; g.beginPath();
        if (inside) g.arc(ux, uy, R, 0, Math.PI * 2);
        else { g.rect(0, 0, W, H); g.arc(ux, uy, R, 0, Math.PI * 2, true); }
        g.fill('evenodd');
        g.strokeStyle = '#3dff8f'; g.lineWidth = 1.2; g.beginPath(); g.arc(ux, uy, R, 0, Math.PI * 2); g.stroke();
      }
    }
    g.fillStyle = '#3dff8f'; g.font = '800 13px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; g.textAlign = 'center';
    for (const [lab, a] of [['북', 0], ['북동', 45], ['동', 90], ['남동', 135], ['남', 180], ['남서', 225], ['서', 270], ['북서', 315]]) {
      const v = [Math.sin(a * D), Math.cos(a * D), 0]; if (v[0] * f[0] + v[1] * f[1] < 0.05) continue;
      const p = proj(v); if (p) g.fillText(lab, p[0], p[1] + 16);
    }
    // 상단 설명
    const hh = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    root.querySelector('.ns-top p').textContent = `${loc.label} ${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}° · ${date.getMonth() + 1}월 ${date.getDate()}일 ${hh}${tOff ? ' (시간 이동 중)' : ''} · 해 고도 ${sunAlt.toFixed(0)}° · 달 ${ms.phase} · 보는 방향 ${dirKo(az)} ${alt.toFixed(0)}° · 시야 ${fov.toFixed(0)}°${day > 0.5 && atmo ? ' · 낮이라 별이 안 보여요 — 「대기 끄기」' : ''}`;
    // 호버·탭 정보
    const pt = hover || tap;
    let best = null, bd = 14 * 14;
    if (pt) for (const q of picks) { const d2 = (q.p[0] - pt[0]) ** 2 + (q.p[1] - pt[1]) ** 2; if (d2 < bd) { bd = d2; best = q; } }
    if (best) {
      let lab;
      const where = `${dirKo(best.az)} 고도 ${best.alt.toFixed(0)}°${best.alt < 0 ? ' (지평선 아래)' : ''}`;
      if (best.kind === 'star') lab = describeStar ? describeStar(best.s.i) : [best.s.name || '별', '', ''];
      else if (best.kind === 'planet') lab = [best.name, `지구에서 ${best.dist.toFixed(2)} AU · 빛으로 ${(best.dist * 8.317).toFixed(0)}분`, ''];
      else if (best.kind === 'moon') lab = ['달', `${ms.phase} · 밝은 면 ${(ms.illum * 100).toFixed(0)}%`, ''];
      else lab = ['국제우주정거장 ISS', `거리 약 ${Math.round(best.km).toLocaleString('ko-KR')}km`, '맨눈으로 빠르게 움직이는 밝은 점'];
      info.children[0].textContent = lab[0]; info.children[1].textContent = [lab[1], where].filter(Boolean).join(' · '); info.children[2].textContent = lab[2] || '';
      info.style.display = 'block';
      const x = Math.min(W - info.offsetWidth - 8, best.p[0] + 14), y = Math.max(8, best.p[1] - info.offsetHeight - 10);
      info.style.left = `${x}px`; info.style.top = `${y}px`;
    } else info.style.display = 'none';
    if (!dead) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  function destroy() {
    if (dead) return; dead = true; cancelAnimationFrame(raf); ro.disconnect();
    window.removeEventListener('deviceorientationabsolute', onOri); window.removeEventListener('deviceorientation', onOri);
    root.remove(); onClose?.();
  }
  root.querySelector('.ns-close').onclick = destroy;
  return { destroy };
}
const DIRS = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
const dirKo = (a) => DIRS[Math.round(a / 22.5) % 16];
