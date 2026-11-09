// 빛의 속도로 여행: 별빛 꼬리가 늘어나는 연출 + "지금 그곳에 도착하는 지구의 빛은 언제 출발했나"
const EVENTS = [ // [연도, 사건] (음수 = 기원전)
  [-4.5e9, '지구가 막 태어나는 중'], [-3.8e9, '지구에 첫 생명이 나타날 무렵'], [-5.4e8, '캄브리아기 생물 대폭발'], [-2.3e8, '첫 공룡 등장'],
  [-6.6e7, '공룡 멸종 직후'], [-6e6, '인류의 조상이 침팬지와 갈라질 무렵'], [-2.5e6, '사람속(호모)이 돌로 도구를 만들기 시작'], [-3e5, '호모 사피엔스 등장'],
  [-7e4, '인류가 아프리카를 떠나 퍼져 나가던 때'], [-1.2e4, '농사가 시작될 무렵'], [-3200, '처음 문자가 쓰이던 때'], [-2600, '이집트 기자 피라미드 건설'],
  [-2333, '고조선 건국(전설)'], [-776, '첫 고대 올림픽'], [-221, '진시황이 중국 통일'], [-57, '신라 건국'], [0, '서기 1년 무렵'], [676, '신라의 삼국 통일'],
  [918, '고려 건국'], [1054, '게 성운 초신성이 하늘에 나타남'], [1392, '조선 건국'], [1446, '훈민정음 반포'], [1492, '콜럼버스 아메리카 도착'],
  [1543, '코페르니쿠스 지동설'], [1592, '임진왜란'], [1609, '갈릴레이가 망원경으로 하늘을 봄'], [1687, '뉴턴 「프린키피아」 출간'], [1776, '미국 독립 선언'],
  [1876, '벨의 전화 발명'], [1903, '라이트 형제의 첫 비행'], [1919, '3·1 운동'], [1945, '광복'], [1950, '한국전쟁'], [1957, '첫 인공위성 스푸트니크'],
  [1969, '아폴로 11호 달 착륙'], [1977, '보이저 1·2호 발사'], [1988, '서울 올림픽'], [1990, '허블 우주망원경 발사'], [1995, '첫 외계 행성 발견(51 페가시 b)'],
  [2002, '한일 월드컵'], [2007, '첫 아이폰'], [2013, '나로호 발사 성공'], [2018, '평창 동계올림픽'], [2021, '제임스 웹 우주망원경 발사'], [2022, '누리호 발사 성공'],
];
function eventFor(year) {
  let e = EVENTS[0];
  for (const x of EVENTS) if (x[0] <= year) e = x;
  return e;
}
const fmtYear = (y) => {
  if (y >= 0) return `${Math.floor(y)}년`;
  const a = -y;
  if (a >= 1e8) return `약 ${(a / 1e8).toFixed(a >= 1e9 ? 0 : 1).replace('.0', '')}억 년 전`;
  if (a >= 1e4) return `약 ${Math.round(a / 1e4).toLocaleString('ko-KR')}만 년 전`;
  return `기원전 ${Math.round(a).toLocaleString('ko-KR')}년`;
};
const fmtLy = (ly) => (ly < 100 ? `${ly.toFixed(1)}광년` : ly < 1e4 ? `${Math.round(ly).toLocaleString('ko-KR')}광년` : ly < 1e8 ? `${(ly / 1e4).toFixed(ly < 1e5 ? 1 : 0)}만 광년` : `${(ly / 1e8).toFixed(1)}억 광년`);

const CSS = `
.wp-root{position:absolute;inset:0;z-index:28;background:#000;overflow:hidden}
.wp-root canvas{position:absolute;inset:0;width:100%;height:100%}
.wp-hud{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,calc(100% - 28px));padding:16px 18px;z-index:2;text-align:left;pointer-events:none}
.wp-hud h3{margin:0 0 2px;color:var(--g);font-size:13px;letter-spacing:.14em;text-shadow:var(--glow)}
.wp-hud .to{color:#eafff2;font-size:18px;font-weight:800;text-shadow:var(--glow);margin-bottom:10px}
.wp-hud .row{display:flex;justify-content:space-between;font-size:12px;color:var(--gd);margin:3px 0;font-variant-numeric:tabular-nums}
.wp-hud .row b{color:var(--g)}
.wp-hud .bar{height:6px;border:1px solid var(--g2);margin:10px 0 8px}.wp-hud .bar i{display:block;height:100%;width:0;background:var(--g);box-shadow:0 0 10px var(--g)}
.wp-hud .note{font-size:11.5px;line-height:1.55;color:#cfffe2;margin-top:8px}
.wp-skip{position:absolute;right:12px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:3;border:1px solid var(--g2);background:rgba(1,22,11,.78);color:var(--g);font-family:inherit;font-weight:700;font-size:12px;padding:8px 12px;cursor:pointer}
`;

/**
 * @param {{ name:string, ly:number, onArrive?:Function, sound?:any }} o
 */
export function warpTo(host, { name, ly, onArrive }) {
  if (!document.getElementById('wp-style')) { const st = document.createElement('style'); st.id = 'wp-style'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div'); root.className = 'wp-root';
  const year = new Date().getFullYear() - ly;
  const ev = eventFor(year);
  root.innerHTML = `<canvas></canvas><div class="wp-hud mu-frame"><h3>// 광속 항법 · c = 299,792 km/s</h3><div class="to"></div>
    <div class="row"><span>지나온 거리</span><b class="d">0</b></div>
    <div class="row"><span>지구에서 흐른 시간</span><b class="t">0</b></div>
    <div class="row"><span>우주선 안의 시간</span><b>0초 (광속이면 시간이 멈춰요)</b></div>
    <div class="bar"><i></i></div><div class="note"></div></div><button class="wp-skip">도착 ▶</button>`;
  host.appendChild(root);
  root.querySelector('.to').textContent = `→ ${name} · ${fmtLy(ly)}`;
  root.querySelector('.note').textContent = `지금 그곳에 도착하는 지구의 빛은 ${fmtYear(year)}에 출발했어요 — 그때 지구에선 「${ev[1]}」. 반대로 오늘 우리가 보는 ${name}의 빛도 ${fmtLy(ly).replace('광년', '년')} 전의 모습이에요.`;
  const cv = root.querySelector('canvas'), g = cv.getContext('2d');
  let W = 1, H = 1;
  const resize = () => { W = root.clientWidth; H = root.clientHeight; const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
  resize();
  const stars = Array.from({ length: 700 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random() * 0.2 + 0.002, z: Math.random(), c: Math.random() }));
  const dur = 3200 + Math.min(5200, Math.log10(Math.max(1.5, ly)) * 700);
  const t0 = performance.now();
  let raf = 0, done = false;
  const dEl = root.querySelector('.d'), tEl = root.querySelector('.t'), bar = root.querySelector('.bar i');
  function frame(now) {
    const p = Math.min(1, (now - t0) / dur);
    const speed = p < 0.15 ? (p / 0.15) ** 2 : p > 0.88 ? ((1 - p) / 0.12) ** 1.5 : 1;
    g.fillStyle = `rgba(0,0,0,${0.35 + 0.4 * (1 - speed)})`; g.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = Math.hypot(W, H) / 2;
    for (const s of stars) {
      s.z -= 0.004 + speed * 0.045;
      if (s.z <= 0.01) { s.z = 1; s.a = Math.random() * Math.PI * 2; }
      const k = s.r / s.z, k2 = s.r / Math.min(1, s.z + 0.02 + speed * 0.12);
      const x1 = cx + Math.cos(s.a) * k * R, y1 = cy + Math.sin(s.a) * k * R, x0 = cx + Math.cos(s.a) * k2 * R, y0 = cy + Math.sin(s.a) * k2 * R;
      // 앞쪽은 파랗게(청색 이동), 가장자리는 붉게
      const blue = Math.min(1, speed * (1 - Math.min(1, k)));
      g.strokeStyle = `rgba(${170 - 90 * blue + 60 * s.c | 0},${210 + 30 * blue | 0},255,${Math.min(1, 0.3 + k)})`;
      g.lineWidth = Math.min(2.4, 0.6 + k * 2);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    // 진행 표시
    const e = p < 0.15 ? 0.5 * (p / 0.15) ** 2 * 0.15 : p > 0.88 ? 1 - 0.5 * ((1 - p) / 0.12) ** 2 * 0.12 : p; // 대략 등속
    const dly = ly * e;
    dEl.textContent = fmtLy(dly);
    tEl.textContent = dly < 1 ? `${Math.round(dly * 365)}일` : `${dly < 100 ? dly.toFixed(1) : Math.round(dly).toLocaleString('ko-KR')}년`;
    bar.style.width = `${e * 100}%`;
    if (p < 1 && !done) raf = requestAnimationFrame(frame); else finish();
  }
  function finish() {
    if (done) return; done = true; cancelAnimationFrame(raf);
    root.style.transition = 'opacity .5s'; root.style.opacity = '0';
    onArrive?.();
    setTimeout(() => root.remove(), 520);
  }
  root.querySelector('.wp-skip').onclick = finish;
  raf = requestAnimationFrame(frame);
  return { cancel: finish };
}
