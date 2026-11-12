// 탐사선 여행 재현: 실제 발사·근접 비행 날짜에 그날의 행성 위치를 이어 궤적을 그림(위에서 본 황도면)
// 행성 위치: JPL 궤도 요소 근사 · 지금 위치: 탐사선 방향(적경·적위)과 거리
import { planetPositions, orbitPoints } from './planets.js';
import { plutoHelio, PROBES, probeDistanceAU } from './outer.js';
import { eqToEcl } from './exoplanets.js';

const T = (s) => new Date(s + 'T12:00:00Z').getTime();
const PLANETS = ['수성', '금성', '지구', '화성', '목성', '토성', '천왕성', '해왕성'];
const PCOL = { 수성: '#b9b2a8', 금성: '#e8cf9a', 지구: '#4a90e2', 화성: '#d1603d', 목성: '#d8b48a', 토성: '#e5d29f', 천왕성: '#9fd8e0', 해왕성: '#5b7fe0' };

// way: [날짜, 기준(행성 이름 | 'pluto' | {r}), 사건 설명]
const MISSIONS = [
  { id: 'v1', name: '보이저 1호', probe: '보이저 1호', way: [
    ['1977-09-05', '지구', '발사 — 타이탄 IIIE 로켓, 금 레코드판을 싣고 출발'],
    ['1979-03-05', '목성', '목성 근접 — 이오에서 지구 밖 첫 활화산 발견'],
    ['1980-11-12', '토성', '토성·타이탄 근접 — 이후 황도면 위쪽으로 튕겨 나감'],
  ], events: [
    ['1990-02-14', '「창백한 푸른 점」 — 60억 km 밖에서 뒤돌아 지구를 찍음'],
    ['1998-02-17', '파이어니어 10호를 앞질러 인류가 만든 가장 먼 물체가 됨'],
    ['2004-12-16', '말단 충격파 통과 — 태양풍이 갑자기 느려지는 경계'],
    ['2012-08-25', '태양권계면 통과 — 인류 최초로 성간 공간 진입'],
    ['2023-11-14', '컴퓨터 고장으로 데이터가 끊김 → 2024년 4월 원격 수리 성공'],
  ] },
  { id: 'v2', name: '보이저 2호', probe: '보이저 2호', way: [
    ['1977-08-20', '지구', '발사 — 보이저 1호보다 16일 먼저'],
    ['1979-07-09', '목성', '목성 근접 — 고리와 유로파의 얼음 표면'],
    ['1981-08-25', '토성', '토성 근접 — 고리 속 구조 촬영'],
    ['1986-01-24', '천왕성', '천왕성 근접 — 지금까지 유일한 방문, 위성 10개 새로 발견'],
    ['1989-08-25', '해왕성', '해왕성 근접 — 대흑점·트리톤의 간헐천, 행성 4개를 모두 지난 유일한 탐사선'],
  ], events: [
    ['2007-08-30', '말단 충격파 통과'],
    ['2018-11-05', '태양권계면 통과 — 두 번째로 성간 공간 진입'],
  ] },
  { id: 'nh', name: '뉴호라이즌스', probe: '뉴호라이즌스', way: [
    ['2006-01-19', '지구', '발사 — 역대 가장 빠른 발사 속도(초속 16.26km)'],
    ['2007-02-28', '목성', '목성 중력으로 가속'],
    ['2015-07-14', 'pluto', '명왕성 근접 — 하트 모양 「톰보 지역」 발견'],
    ['2019-01-01', { r: 43.4 }, '아로코스 근접 — 가장 먼 천체 방문, 눈사람 모양 원시 천체'],
  ], events: [] },
  { id: 'p10', name: '파이어니어 10호', probe: '파이어니어 10호', way: [
    ['1972-03-03', '지구', '발사 — 소행성대를 처음 건넌 탐사선'],
    ['1973-12-04', '목성', '목성 첫 근접 — 강한 방사선대 측정'],
  ], events: [
    ['1983-06-13', '해왕성 궤도 너머로 — 행성 영역을 벗어난 첫 인공물'],
    ['2003-01-23', '마지막 신호 수신'],
  ] },
  { id: 'p11', name: '파이어니어 11호', probe: '파이어니어 11호', way: [
    ['1973-04-06', '지구', '발사'],
    ['1974-12-03', '목성', '목성 근접 — 대적점 근접 촬영'],
    ['1979-09-01', '토성', '토성 첫 근접 — 새 고리(F 고리) 발견'],
  ], events: [['1995-09-30', '교신 종료']] },
];

function wayPos(ref, t, finalLam) {
  if (typeof ref === 'string' && ref !== 'pluto') { const p = planetPositions(new Date(t))[ref].pos; return [p[0], p[1]]; }
  if (ref === 'pluto') { const p = plutoHelio(new Date(t)).pos; return [p[0], p[1]]; }
  return [ref.r * Math.cos(finalLam), ref.r * Math.sin(finalLam)];
}
function buildPath(m) {
  const pr = PROBES.find((q) => q[0] === m.probe);
  const now = Date.now();
  const { lam, beta } = eqToEcl(pr[1], pr[2]);
  const rNow = probeDistanceAU(pr[3], pr[4], new Date(now)) * Math.cos(beta);
  const pts = m.way.map(([d, ref, txt]) => { const t = T(d); const p = wayPos(ref, t, lam); return { t, x: p[0], y: p[1], txt }; });
  pts.push({ t: now, x: rNow * Math.cos(lam), y: rNow * Math.sin(lam), txt: null, last: true });
  return { pts, lam, rNow, rNow3d: probeDistanceAU(pr[3], pr[4], new Date(now)), alive: pr[6] };
}
/** 시각 t의 탐사선 위치(AU) */
function posAt(path, t) {
  const P = path.pts;
  if (t <= P[0].t) return [P[0].x, P[0].y];
  for (let k = 0; k < P.length - 1; k++) {
    const a = P[k], b = P[k + 1];
    if (t > b.t) continue;
    const u = (t - a.t) / (b.t - a.t);
    const ra = Math.hypot(a.x, a.y), rb = Math.hypot(b.x, b.y);
    const ta = Math.atan2(a.y, a.x), tb = Math.atan2(b.y, b.x);
    let d = tb - ta;
    let ang;
    if (b.last) { d = Math.atan2(Math.sin(d), Math.cos(d)); ang = ta + d * Math.min(1, u / 0.12); } // 마지막: 방향을 틀고 곧게
    else { d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); ang = ta + d * u; }   // 행성 사이: 태양 둘레를 순행
    const r = ra + (rb - ra) * (b.last ? u : 0.5 - 0.5 * Math.cos(Math.PI * u));
    return [r * Math.cos(ang), r * Math.sin(ang)];
  }
  const L = P[P.length - 1]; return [L.x, L.y];
}

const CSS = `
.jr-root{position:absolute;inset:0;z-index:22;background:#020504;overflow:hidden;touch-action:none}
.jr-root canvas{position:absolute;inset:0;width:100%;height:100%}
.jr-top{position:absolute;top:10px;left:10px;right:58px;max-width:400px;padding:7px 10px;z-index:2;pointer-events:none}
.jr-top h3{margin:0;color:var(--g);font-size:12px;letter-spacing:.05em;text-shadow:var(--glow)}
.jr-top .st{margin-top:6px;color:var(--gd);font-size:10.5px;line-height:1.6;font-variant-numeric:tabular-nums}
.jr-ev{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(150px + env(safe-area-inset-bottom));z-index:2;max-width:calc(100% - 30px);width:max-content;padding:9px 14px;
  color:#eafff2;font-size:11px;font-weight:700;text-shadow:var(--glow);opacity:0;transition:opacity .4s;pointer-events:none}
.jr-ev.show{opacity:1}
.jr-bar{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:8px 10px calc(10px + env(safe-area-inset-bottom));background:linear-gradient(transparent,rgba(1,6,4,.92) 35%)}
.jr-row{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:6px}
.jr-bar button,.jr-close{border:1px solid var(--g2);background:rgba(1,22,11,.78);color:var(--g);font-family:inherit;font-weight:700;font-size:10.5px;cursor:pointer;text-shadow:var(--glow);padding:7px 10px;
  clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}
.jr-bar button.on{background:rgba(61,255,143,.28);color:#eafff2}
.jr-bar input{width:min(380px,100%);display:block;margin:0 auto;accent-color:#3dff8f}
.jr-close{position:absolute;top:10px;right:10px;width:38px;height:38px;padding:0;z-index:3}
`;

export function openJourneys(host, { start = 'v1', sound, onClose } = {}) {
  if (!document.getElementById('jr-style')) { const st = document.createElement('style'); st.id = 'jr-style'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div'); root.className = 'jr-root';
  root.innerHTML = `<canvas></canvas><div class="jr-top mu-frame"><h3></h3><div class="st"></div></div><div class="jr-ev mu-frame"></div><button class="jr-close" aria-label="닫기">✕</button>
    <div class="jr-bar"><input type="range" min="0" max="1000" step="1"><div class="jr-row jr-pr"></div><div class="jr-row jr-ct"></div></div>`;
  host.appendChild(root);
  const cv = root.querySelector('canvas'), g = cv.getContext('2d');
  const evEl = root.querySelector('.jr-ev'), slider = root.querySelector('input');
  let W = 1, H = 1;
  const resize = () => { W = root.clientWidth; H = root.clientHeight; const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
  const ro = new ResizeObserver(resize); ro.observe(root); resize();
  let m = null, path = null, t = 0, playing = true, speedIdx = 1, view = 8, lastEv = '', evTimer = 0, plasmaOn = false;
  const SPEEDS = [['1초=1달', 30.4], ['1초=6달', 182.6], ['1초=2년', 730.5]];
  const prRow = root.querySelector('.jr-pr'), ctRow = root.querySelector('.jr-ct');
  for (const q of MISSIONS) { const b = document.createElement('button'); b.textContent = q.name; b.dataset.k = q.id; b.onclick = () => pick(q.id); prRow.appendChild(b); }
  const playB = document.createElement('button'); playB.onclick = () => { playing = !playing; if (t >= Date.now()) t = path.pts[0].t; upd(); }; ctRow.appendChild(playB);
  const spdB = document.createElement('button'); spdB.onclick = () => { speedIdx = (speedIdx + 1) % SPEEDS.length; upd(); }; ctRow.appendChild(spdB);
  const nowB = document.createElement('button'); nowB.textContent = '지금 위치로'; nowB.onclick = () => { t = Date.now(); playing = false; upd(); }; ctRow.appendChild(nowB);
  function upd() { playB.textContent = playing ? '❚❚ 멈춤' : '▶ 재생'; spdB.textContent = `속도 ${SPEEDS[speedIdx][0]}`; }
  function pick(id) {
    m = MISSIONS.find((q) => q.id === id); path = buildPath(m);
    t = path.pts[0].t; playing = true; view = 3; lastEv = '';
    root.querySelector('h3').textContent = `탐사선 여행 · ${m.name}`;
    prRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === id));
    upd();
  }
  slider.addEventListener('input', () => { const a = path.pts[0].t; t = a + (Date.now() - a) * (slider.value / 1000); playing = false; upd(); });
  function showEv(txt) { evEl.textContent = txt; evEl.classList.add('show'); clearTimeout(evTimer); evTimer = setTimeout(() => evEl.classList.remove('show'), 4200); }
  let raf = 0, dead = false, last = performance.now();
  pick(start);
  // 배터리 절약: 2.5초간 손대지 않으면 초당 약 15장
  const __busy = () => playing;
  let __lastIn = performance.now(), __lastDraw = 0;
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) root.addEventListener(ev, () => { __lastIn = performance.now(); }, { capture: true, passive: true });
  function frame(now) {
    {const __n = performance.now(); if (__n - __lastIn > 2500 && __n - __lastDraw < 66 && !__busy()) { if (!dead) raf = requestAnimationFrame(frame); return; } __lastDraw = __n;}

    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (playing) { t += dt * SPEEDS[speedIdx][1] * 86400000; if (t >= Date.now()) { t = Date.now(); playing = false; upd(); } }
    slider.value = String(Math.round(((t - path.pts[0].t) / (Date.now() - path.pts[0].t)) * 1000));
    const date = new Date(t);
    const [px, py] = posAt(path, t);
    const r = Math.hypot(px, py);
    // 시점: 탐사선이 들어오게 서서히 확대/축소
    const want = Math.max(1.8, r * 1.35, m.way.some((w) => w[1] === '해왕성' || w[1] === 'pluto') && r > 20 ? 40 : 0);
    view += (want - view) * Math.min(1, dt * 2.2);
    const k = (Math.min(W, H) * 0.45) / view, cx = W / 2, cy = H / 2 - 20;
    const X = (x) => cx + x * k, Y = (y) => cy - y * k;
    g.fillStyle = '#020504'; g.fillRect(0, 0, W, H);
    // 태양권(약 120 AU)
    if (view > 50) { g.globalAlpha = 0.5; g.strokeStyle = '#ffd166'; g.setLineDash([4, 6]); g.beginPath(); g.arc(cx, cy, 121 * k, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#ffd166'; g.font = '600 10.5px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; g.textAlign = 'center'; g.fillText('태양권계면 (약 120 AU) — 여기부터 성간 공간', cx, cy - 121 * k - 6); }
    // 행성 궤도·위치 (그날의 위치)
    const pp = planetPositions(date);
    for (const n of PLANETS) {
      const a = { 수성: 0.39, 금성: 0.72, 지구: 1, 화성: 1.52, 목성: 5.2, 토성: 9.58, 천왕성: 19.2, 해왕성: 30.05 }[n];
      if (a * k < 3) continue;
      g.globalAlpha = 0.3; g.strokeStyle = PCOL[n]; g.lineWidth = 1;
      g.beginPath(); orbitPoints(n, date, 120).forEach((q, i) => (i ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1])))); g.stroke();
      const q = pp[n].pos; g.globalAlpha = 1; g.fillStyle = PCOL[n];
      g.beginPath(); g.arc(X(q[0]), Y(q[1]), n === '목성' || n === '토성' ? 4 : 3, 0, Math.PI * 2); g.fill();
      if (a * k > 18) { g.font = '600 10.5px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; g.textAlign = 'left'; g.fillText(n, X(q[0]) + 6, Y(q[1]) - 5); }
    }
    if (m.way.some((w) => w[1] === 'pluto')) { const q = plutoHelio(date).pos; g.fillStyle = '#e8d8c8'; g.beginPath(); g.arc(X(q[0]), Y(q[1]), 2.5, 0, Math.PI * 2); g.fill(); g.fillText('명왕성', X(q[0]) + 6, Y(q[1]) - 5); }
    // 태양
    const sg = g.createRadialGradient(cx, cy, 0, cx, cy, 14); sg.addColorStop(0, '#fff7d6'); sg.addColorStop(0.3, '#ffd166'); sg.addColorStop(1, 'rgba(255,209,102,0)');
    g.globalAlpha = 1; g.fillStyle = sg; g.beginPath(); g.arc(cx, cy, 14, 0, Math.PI * 2); g.fill();
    // 지나온 길 + 앞으로 갈 길(희미하게)
    const t0 = path.pts[0].t, tEnd = Date.now();
    g.lineWidth = 1.6;
    for (const [ta, tb, al, dash] of [[t0, t, 0.95, null], [t, tEnd, 0.18, [3, 5]]]) {
      if (tb <= ta) continue;
      g.globalAlpha = al; g.strokeStyle = '#3dff8f'; g.setLineDash(dash || []); g.beginPath();
      for (let i = 0; i <= 400; i++) { const q = posAt(path, ta + ((tb - ta) * i) / 400); i ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1])); }
      g.stroke(); g.setLineDash([]);
    }
    // 근접 비행 지점
    g.font = '600 10px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace';
    for (const w of path.pts) { if (w.last || w.t > t) continue; g.globalAlpha = 0.85; g.strokeStyle = '#a6ffcb'; g.beginPath(); g.arc(X(w.x), Y(w.y), 5, 0, Math.PI * 2); g.stroke(); }
    // 탐사선
    const pulse = 6 + 2 * Math.sin(now / 200);
    g.globalAlpha = 1; g.fillStyle = '#eafff2'; g.beginPath(); g.arc(X(px), Y(py), 3, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3dff8f'; g.shadowColor = 'rgba(61,255,143,.9)'; g.shadowBlur = 10; g.beginPath(); g.arc(X(px), Y(py), pulse, 0, Math.PI * 2); g.stroke(); g.shadowBlur = 0;
    g.fillStyle = '#3dff8f'; g.font = '700 12px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; g.textAlign = 'left'; g.fillText(m.name, X(px) + 10, Y(py) - 8);
    // 상태
    const d2 = new Date(t + 86400000 * 30); const [qx, qy] = posAt(path, Math.min(Date.now(), d2.getTime()));
    const kms = (Math.hypot(qx - px, qy - py) * 1.496e8) / (Math.max(1, Math.min(Date.now(), d2.getTime()) - t) / 1000);
    const lightH = (r * 1.496e8) / 299792 / 3600;
    const ymd = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
    root.querySelector('.st').textContent = `${ymd} · 태양에서 ${r < 10 ? r.toFixed(2) : r.toFixed(1)} AU(위에서 본 거리) · 빛으로 ${lightH < 1 ? Math.round(lightH * 60) + '분' : lightH.toFixed(1) + '시간'} · 태양 기준 초속 약 ${kms > 0 && kms < 80 ? kms.toFixed(1) : '-'}km${t >= Date.now() - 86400000 ? ` · 지금 실제 거리 ${path.rNow3d.toFixed(1)} AU${path.alive ? ' · 교신 중' : ' · 교신 끊김'}` : ''}`;
    // 사건
    const evs = [...m.way.map((w) => [w[0], w[2]]), ...m.events].filter(([d]) => T(d) <= t).sort((a, b) => T(a[0]) - T(b[0]));
    const cur = evs[evs.length - 1];
    if (cur && cur[0] !== lastEv && t - T(cur[0]) < 86400000 * 400) { lastEv = cur[0]; showEv(`${cur[0].replace(/-/g, '.')} · ${cur[1]}`); }
    // 소리: 보이저 1호가 성간 공간에 들어가면 플라스마 소리
    const inter = m.id === 'v1' && t > T('2012-08-25');
    if (sound && sound.on && inter !== plasmaOn) { plasmaOn = inter; sound.hover(inter ? 'voyager' : null); }
    if (!dead) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  function destroy() { if (dead) return; dead = true; cancelAnimationFrame(raf); ro.disconnect(); if (plasmaOn) sound?.hover(null); root.remove(); onClose?.(); }
  root.querySelector('.jr-close').onclick = destroy;
  return { destroy };
}
