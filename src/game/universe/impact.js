// 소행성 충돌 시뮬레이터 — Collins, Melosh & Marcus (2005) "Earth Impact Effects Program" 식을 단순화
// 지도: EOX Sentinel-2 cloudless (CC BY 4.0) 타일
const G = 9.81, RHO_T = 2500, RE = 6371e3;
const TYPES = { stone: { ko: '암석', rho: 3000 }, iron: { ko: '철', rho: 7800 }, ice: { ko: '얼음(혜성)', rho: 1000 } };
export const PRESETS = [
  { name: '첼랴빈스크 (2013)', L: 19, v: 19, angle: 18, type: 'stone', note: '러시아 상공 약 30km에서 폭발 · 창문 수천 장이 깨지고 1,500명 부상' },
  { name: '퉁구스카 (1908)', L: 60, v: 15, angle: 35, type: 'stone', note: '시베리아 숲 2,000km²의 나무 8천만 그루가 쓰러짐' },
  { name: '배린저 운석공 (5만 년 전)', L: 50, v: 12.8, angle: 45, type: 'iron', note: '미국 애리조나 · 지름 1.2km 구덩이' },
  { name: '아포피스 (2029 근접)', L: 340, v: 12.6, angle: 45, type: 'stone', note: '2029년 4월 13일 정지위성보다 가까이 지나가요(충돌 아님)' },
  { name: '베누', L: 490, v: 12.7, angle: 45, type: 'stone', note: '2182년 충돌 확률 약 1/2,700 · 오시리스-렉스가 표본 회수' },
  { name: '칙술루브 (공룡 멸종)', L: 10000, v: 20, angle: 60, type: 'stone', note: '6,600만 년 전 멕시코 유카탄 · 지름 약 180km 구덩이' },
];

const rhoAtm = (z) => 1.2 * Math.exp(-z / 8000);
/** 충돌 효과 계산 (SI) */
export function simulate({ L, v, angle, type }) {
  const rho = TYPES[type].rho, vm = v * 1000, th = (angle * Math.PI) / 180;
  const m = (rho * Math.PI * L ** 3) / 6;
  const E0 = 0.5 * m * vm ** 2;
  // 대기 진입: 부서지는 고도(강도 Yi = 10^(2.107+0.0624√ρ)) → 팬케이크 모델 근사
  const Yi = Math.pow(10, 2.107 + 0.0624 * Math.sqrt(rho));
  const If = (4.07 * 1.8 * 8000 * Yi) / (rho * L * vm * vm * Math.sin(th)); // ≥1 이면 부서지지 않고 땅까지
  let zb = 0, airburst = false, vImp = vm, E = E0;
  if (If < 1) {
    const zStar = -8000 * (Math.log(Yi / (rhoAtm(0) * vm * vm)) + 1.308 - 0.314 * If - 1.303 * Math.sqrt(1 - If));
    const l = L * Math.sin(th) * Math.sqrt(rho / (1.8 * rhoAtm(zStar))); // 퍼지는 길이
    const zp = zStar - 2 * 8000 * Math.log(1 + (l / (2 * 8000)) * Math.sqrt(7 ** 2 - 1)); // 팬케이크 7배까지
    if (zp > 0) { airburst = true; zb = zp; vImp = vm * Math.exp(-0.5); E = 0.5 * m * vm * vm; } // 공중 폭발: 에너지 대부분이 공기 중에 풀림
    else vImp = vm * Math.exp((-3 * rhoAtm(0) * 1.8 * 8000) / (4 * rho * L * Math.sin(th)));
  } else {
    vImp = vm * Math.exp((-3 * rhoAtm(0) * 1.8 * 8000) / (4 * rho * L * Math.sin(th)));
  }
  if (!airburst) E = 0.5 * m * vImp ** 2;
  const Mt = E / 4.184e15;
  const res = { E, Mt, airburst, burstKm: zb / 1000, vImp: vImp / 1000 };
  // 구덩이
  if (!airburst) {
    const Dtc = 1.161 * Math.pow(rho / RHO_T, 1 / 3) * Math.pow(L, 0.78) * Math.pow(vImp, 0.44) * Math.pow(G, -0.22) * Math.pow(Math.sin(th), 1 / 3);
    const Dfr = Dtc * 1.25 < 3200 ? Dtc * 1.25 : (1.17 * Math.pow(Dtc, 1.13)) / Math.pow(3200, 0.13);
    res.crater = Dfr; res.craterDepth = Dfr < 3200 ? Dfr / 5 : 400 * Math.pow(Dfr / 1000, 0.3);
    res.quake = 0.67 * Math.log10(E) - 5.87;
  }
  // 불덩이
  res.fireball = 0.002 * Math.pow(E, 1 / 3);
  // 열복사: 2도 화상(약 25만 J/m²·Mt 보정)
  const eta = 3e-3;
  const phi = 2.5e5 * Math.pow(Math.max(Mt, 1e-6), 1 / 6);
  let rTh = Math.sqrt((eta * E) / (2 * Math.PI * phi));
  const horizon = Math.sqrt(2 * RE * Math.max(res.fireball, zb + res.fireball)); // 지평선 너머는 안 닿음
  if (airburst) rTh = Math.sqrt(Math.max(0, rTh * rTh - zb * zb)); // 땅까지의 거리
  res.thermal = Math.min(rTh, horizon * 1.2);
  if (airburst && res.fireball < zb) res.fireball = 0; // 불덩이가 땅에 닿지 않음
  // 폭풍(과압): 1kt 지표 폭발 기준 거리 스케일
  const Ekt = E / 4.184e12;
  const p = (r1) => ((75000 * 290) / (4 * r1)) * (1 + 3 * Math.pow(290 / r1, 1.3));
  const radiusFor = (P) => {
    let lo = 1, hi = 1e7;
    for (let k = 0; k < 60; k++) { const mid = Math.sqrt(lo * hi); if (p(mid) > P) lo = mid; else hi = mid; }
    const slant = lo * Math.cbrt(airburst ? Ekt * 2 : Ekt); // 공중 폭발은 땅에서 반사돼 압력이 겹침
    return airburst ? Math.sqrt(Math.max(0, slant * slant - zb * zb)) : slant;
  };
  res.blast = { heavy: radiusFor(138000), house: radiusFor(34500), window: radiusFor(3000) };
  if (airburst && Mt > 0.05) res.blast.window = Math.max(res.blast.window, 2.2 * zb); // 높은 공중 폭발: 넓게 퍼지는 약한 충격파(첼랴빈스크 관측에 맞춘 근사)
  res.everyYears = 109 * Math.pow(Math.max(Mt, 1e-6), 0.78);
  return res;
}
export function compare(Mt) {
  const kt = Mt * 1000;
  if (kt < 1) return `TNT ${Math.round(kt * 1000).toLocaleString('ko-KR')}톤`;
  if (Mt < 1) return `히로시마 원폭의 ${(kt / 15).toFixed(kt / 15 < 10 ? 1 : 0)}배`;
  if (Mt < 1e4) return `차르 봄바(인류 최대 핵폭탄 50Mt)의 ${(Mt / 50).toFixed(Mt / 50 < 10 ? 1 : 0)}배`;
  return `세계 모든 핵무기(약 6천Mt)의 ${(Mt / 6000).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}배`;
}
const km = (m) => (m < 1000 ? `${Math.round(m)}m` : m < 100000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m / 1000).toLocaleString('ko-KR')}km`);
const fmtE = (Mt) => (Mt < 0.001 ? `${(Mt * 1e6).toFixed(0)}톤` : Mt < 1 ? `${(Mt * 1000).toFixed(Mt < 0.01 ? 1 : 0)}킬로톤` : `${Mt < 100 ? Mt.toFixed(1) : Math.round(Mt).toLocaleString('ko-KR')}메가톤`);
const fmtYears = (y) => (y < 1 ? '해마다 여러 번' : y < 1e4 ? `약 ${Math.round(y).toLocaleString('ko-KR')}년에 한 번` : y < 1e8 ? `약 ${Math.round(y / 1e4).toLocaleString('ko-KR')}만 년에 한 번` : `약 ${(y / 1e8).toFixed(1)}억 년에 한 번`);

const CSS = `
.im-root{position:absolute;inset:0;z-index:24;background:#010604;overflow:hidden;touch-action:none}
.im-root canvas{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair}
.im-panel{position:absolute;top:10px;left:10px;width:min(330px,calc(100% - 68px));max-height:calc(100% - 20px);overflow:auto;padding:10px 12px;z-index:2}
.im-panel h3{margin:0 0 6px;color:var(--g);font-size:15px;letter-spacing:.05em;text-shadow:var(--glow)}
.im-panel label{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--gd);margin:5px 0}
.im-panel label span{width:58px;flex:none}.im-panel label b{width:74px;flex:none;text-align:right;color:var(--g);font-variant-numeric:tabular-nums}
.im-panel input[type=range]{flex:1;accent-color:#3dff8f}
.im-panel .row{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0}
.im-panel button{border:1px solid var(--g2);background:rgba(1,22,11,.78);color:var(--g);font-family:inherit;font-weight:700;font-size:10.5px;cursor:pointer;padding:5px 7px}
.im-panel button.on{background:rgba(61,255,143,.28);color:#eafff2}
.im-panel .go{width:100%;font-size:13px;padding:9px;margin-top:6px;background:rgba(255,80,60,.25);border-color:#ff6a5a;color:#ffd7cf;text-shadow:0 0 6px rgba(255,90,70,.8)}
.im-res{font-size:11.5px;line-height:1.6;color:var(--gd);margin-top:8px}
.im-res i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:-1px}
.im-res b{color:#eafff2}
.im-note{font-size:10.5px;color:#ffd7cf;margin-top:4px}
.im-close{position:absolute;top:10px;right:10px;width:38px;height:38px;z-index:3;border:1px solid var(--g2);background:rgba(1,22,11,.78);color:var(--g);font-weight:700;cursor:pointer}
.im-credit{position:absolute;right:8px;bottom:6px;font-size:9px;color:rgba(166,255,203,.6);z-index:2}
@media (max-width:560px){.im-panel{top:auto;bottom:10px;max-height:46%}}
`;
const TILE = (z, r, c) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless/default/WGS84/${z}/${r}/${c}.jpg`;

export function openImpact(host, { loc, preset, onClose, sound } = {}) {
  if (!document.getElementById('im-style')) { const st = document.createElement('style'); st.id = 'im-style'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div'); root.className = 'im-root';
  root.innerHTML = `<canvas></canvas><div class="im-panel mu-frame"><h3>// 소행성 충돌 시뮬레이터</h3>
    <div class="row pre"></div>
    <label><span>지름</span><input class="L" type="range" min="0" max="1000" step="1"><b class="Lv"></b></label>
    <label><span>속도</span><input class="v" type="range" min="11" max="72" step="0.5"><b class="vv"></b></label>
    <label><span>진입 각도</span><input class="a" type="range" min="10" max="90" step="1"><b class="av"></b></label>
    <div class="row typ"></div>
    <div class="im-note"></div>
    <button class="go">여기에 떨어뜨리기</button>
    <div class="im-res"></div></div>
    <button class="im-close" aria-label="닫기">✕</button><div class="im-credit">지도: Sentinel-2 cloudless by EOX (CC BY 4.0) · 계산: Collins 외(2005) 단순화</div>`;
  host.appendChild(root);
  const $ = (q) => root.querySelector(q);
  const cv = $('canvas'), g = cv.getContext('2d');
  let W = 1, H = 1;
  const resize = () => { W = root.clientWidth; H = root.clientHeight; const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
  const ro = new ResizeObserver(resize); ro.observe(root); resize();
  const st = { L: 60, v: 17, angle: 45, type: 'stone', lat: loc.lat, lon: loc.lon, label: loc.label };
  let res = null, t0 = 0, viewKm = 30, note = '';
  const Lfrom = (u) => Math.pow(10, (u / 1000) * 4.3); // 1m ~ 20km
  const Lto = (L) => (Math.log10(L) / 4.3) * 1000;
  // 프리셋 · 종류
  for (const p of PRESETS) { const b = document.createElement('button'); b.textContent = p.name; b.onclick = () => { Object.assign(st, { L: p.L, v: p.v, angle: p.angle, type: p.type }); note = p.note; sync(); fire(); }; $('.pre').appendChild(b); }
  for (const [k, t] of Object.entries(TYPES)) { const b = document.createElement('button'); b.textContent = t.ko; b.dataset.k = k; b.onclick = () => { st.type = k; note = ''; sync(); }; $('.typ').appendChild(b); }
  $('.L').oninput = (e) => { st.L = Lfrom(+e.target.value); note = ''; sync(); };
  $('.v').oninput = (e) => { st.v = +e.target.value; sync(); };
  $('.a').oninput = (e) => { st.angle = +e.target.value; sync(); };
  $('.go').onclick = fire;
  function sync() {
    $('.L').value = Lto(st.L); $('.v').value = st.v; $('.a').value = st.angle;
    $('.Lv').textContent = km(st.L); $('.vv').textContent = `초속 ${st.v}km`; $('.av').textContent = `${st.angle}°`;
    root.querySelectorAll('.typ button').forEach((b) => b.classList.toggle('on', b.dataset.k === st.type));
    $('.im-note').textContent = note;
  }
  const RINGS = [
    ['crater', '#ff3b30', '구덩이'], ['fireball', '#fff1a8', '불덩이'], ['heavy', '#ff8a3d', '콘크리트 건물 붕괴(20psi)'],
    ['thermal', '#ffd166', '2도 화상·불 붙음'], ['house', '#ff5ad1', '주택 대부분 붕괴(5psi)'], ['window', '#7ad7ff', '유리창 깨짐(약 0.4psi)'],
  ];
  const ringR = (k) => (k === 'crater' ? (res.crater || 0) / 2 : k === 'fireball' ? res.fireball : k === 'thermal' ? res.thermal : res.blast[k]);
  function fire() {
    res = simulate(st); t0 = performance.now();
    viewKm = Math.max(4, (res.blast.window / 1000) * 2.6);
    const lines = [
      `<b>${fmtE(res.Mt)}</b> · ${compare(res.Mt)}`,
      res.airburst ? `<b>공중 폭발</b> — 고도 ${res.burstKm.toFixed(1)}km에서 터짐 (땅에 구덩이 없음)` : `<b>지면 충돌</b> — 초속 ${res.vImp.toFixed(1)}km로 부딪힘 · 구덩이 지름 <b>${km(res.crater)}</b>, 깊이 ${km(res.craterDepth)} · 지진 규모 <b>${res.quake.toFixed(1)}</b>`,
      ...RINGS.filter(([k]) => ringR(k) > 0 && !(k === 'crater' && res.airburst)).map(([k, c, t]) => `<i style="background:${c}"></i>${t}: 반경 ${km(ringR(k))}`),
      `이 정도 충돌은 지구 전체에서 ${fmtYears(res.everyYears)}`,
    ];
    $('.im-res').innerHTML = lines.join('<br>');
    if (sound?.on) sound.blackhole?.(false);
  }
  // 지도 클릭으로 위치 바꾸기
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect(); const kmPerPx = viewKm / Math.min(W, H);
    const dx = (e.clientX - r.left - W / 2) * kmPerPx, dy = (e.clientY - r.top - H / 2) * kmPerPx;
    st.lat = Math.max(-85, Math.min(85, st.lat - dy / 110.57)); st.lon = st.lon + dx / (111.32 * Math.cos((st.lat * Math.PI) / 180)); st.label = '고른 곳';
    if (res) fire();
  });
  // 타일
  const imgs = new Map();
  const getTile = (z, r, c) => {
    const u = TILE(z, r, c);
    let im = imgs.get(u);
    if (!im) { im = new Image(); im.crossOrigin = 'anonymous'; im.src = u; imgs.set(u, im); if (imgs.size > 300) imgs.delete(imgs.keys().next().value); }
    return im.complete && im.naturalWidth ? im : null;
  };
  let raf = 0, dead = false;
  function frame(now) {
    const kmPerPx = viewKm / Math.min(W, H);
    const degPerPxLat = kmPerPx / 110.57, cosl = Math.cos((st.lat * Math.PI) / 180), degPerPxLon = kmPerPx / (111.32 * cosl);
    // 타일 레벨: 타일 1장(256px) = 180/2^z 도
    let z = Math.max(0, Math.min(13, Math.round(Math.log2(180 / (256 * degPerPxLat)))));
    const tdeg = 180 / 2 ** z;
    g.fillStyle = '#071510'; g.fillRect(0, 0, W, H);
    const lon0 = st.lon - (W / 2) * degPerPxLon, lon1 = st.lon + (W / 2) * degPerPxLon, lat0 = st.lat - (H / 2) * degPerPxLat, lat1 = st.lat + (H / 2) * degPerPxLat;
    const c0 = Math.floor((lon0 + 180) / tdeg), c1 = Math.floor((lon1 + 180) / tdeg), r0 = Math.floor((90 - lat1) / tdeg), r1 = Math.floor((90 - lat0) / tdeg);
    if ((c1 - c0 + 1) * (r1 - r0 + 1) < 120) {
      for (let r = Math.max(0, r0); r <= Math.min(2 ** z - 1, r1); r++) for (let c = c0; c <= c1; c++) {
        const cc = ((c % (2 ** (z + 1))) + 2 ** (z + 1)) % 2 ** (z + 1);
        const im = getTile(z, r, cc); if (!im) continue;
        const x = W / 2 + (c * tdeg - 180 - st.lon) / degPerPxLon, y = H / 2 - (90 - r * tdeg - st.lat) / degPerPxLat;
        g.drawImage(im, x, y, tdeg / degPerPxLon + 0.5, tdeg / degPerPxLat + 0.5);
      }
    }
    g.fillStyle = 'rgba(0,10,5,0.25)'; g.fillRect(0, 0, W, H);
    // 효과 원
    const cx = W / 2, cy = H / 2;
    if (res) {
      const age = (now - t0) / 1000;
      // 들어오는 불빛
      if (age < 1.2) {
        const u = age / 1.2, sx = cx - (1 - u) * W * 0.6, sy = cy - (1 - u) * H * 0.7;
        g.strokeStyle = 'rgba(255,220,160,.9)'; g.lineWidth = 3; g.beginPath(); g.moveTo(sx - 60 * (1 - u), sy - 70 * (1 - u)); g.lineTo(sx, sy); g.stroke();
      } else {
        const grow = Math.min(1, (age - 1.2) / 2.5);
        if (age < 1.6) { g.fillStyle = `rgba(255,255,240,${1 - (age - 1.2) / 0.4})`; g.fillRect(0, 0, W, H); }
        for (const [k, col, lab] of RINGS.slice().reverse()) {
          const R = ringR(k); if (!R || (k === 'crater' && res.airburst)) continue;
          const rp = (R / 1000 / kmPerPx) * (k === 'window' || k === 'house' || k === 'heavy' ? grow : Math.min(1, grow * 2));
          if (rp < 1) continue;
          g.globalAlpha = 0.16; g.fillStyle = col; g.beginPath(); g.arc(cx, cy, rp, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 0.9; g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, rp, 0, Math.PI * 2); g.stroke();
          if (grow >= 1 && rp > 18) { g.fillStyle = col; g.font = '700 11px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; g.textAlign = 'center'; g.fillText(`${lab} ${km(R)}`, cx, cy - rp - 4); }
        }
        g.globalAlpha = 1;
      }
    }
    // 과녁
    g.strokeStyle = '#3dff8f'; g.lineWidth = 1.2; g.globalAlpha = 1;
    g.beginPath(); g.moveTo(cx - 10, cy); g.lineTo(cx + 10, cy); g.moveTo(cx, cy - 10); g.lineTo(cx, cy + 10); g.stroke();
    g.fillStyle = '#3dff8f'; g.font = '700 11px "SF Mono",Menlo,Consolas,"Apple SD Gothic Neo","Noto Sans KR",monospace'; g.textAlign = 'left';
    g.fillText(`${st.label} ${st.lat.toFixed(2)}°, ${st.lon.toFixed(2)}° · 화면 폭 ${km(viewKm * 1000 * (W / Math.min(W, H)))}`, 10, H - 10);
    if (!dead) raf = requestAnimationFrame(frame);
  }
  if (preset) { Object.assign(st, preset); note = preset.note || ''; }
  sync();
  if (preset) fire();
  raf = requestAnimationFrame(frame);
  function destroy() { if (dead) return; dead = true; cancelAnimationFrame(raf); ro.disconnect(); root.remove(); onClose?.(); }
  $('.im-close').onclick = destroy;
  return { destroy };
}
