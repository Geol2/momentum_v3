// 오늘의 우주 카드: NASA 오늘의 천문 사진(APOD) · 최신 우주 뉴스(Spaceflight News API) · 오늘 밤 내 하늘
import { planetPositions } from './planets.js';
import { moonState, sunDirection } from './astro.js';

const D = Math.PI / 180, EPS = 23.4393 * D;
const gmst = (d) => { const n = d.getTime() / 86400000 + 2440587.5 - 2451545.0; return ((280.46061837 + 360.98564736629 * n) % 360 + 360) % 360; };

async function cached(key, ms, fn) {
  try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < ms) return c.v; } catch { /* */ }
  const v = await fn();
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch { /* */ }
  return v;
}
const apod = () => cached('momentum.apod', 3 * 3600000, async () => {
  const r = await fetch('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&thumbs=true'); // DEMO_KEY: NASA 공개 체험용 키(비밀 아님)
  if (!r.ok) throw new Error('apod');
  const j = await r.json();
  return { title: j.title, date: j.date, text: j.explanation, img: j.media_type === 'image' ? j.url : j.thumbnail_url, copyright: j.copyright, video: j.media_type !== 'image' ? j.url : null };
});
const news = () => cached('momentum.spacenews', 3600000, async () => {
  const r = await fetch('https://api.spaceflightnewsapi.net/v4/articles/?limit=5&ordering=-published_at');
  if (!r.ok) throw new Error('news');
  const j = await r.json();
  return j.results.map((a) => ({ title: a.title, url: a.url, site: a.news_site, at: a.published_at }));
});

/** 오늘 밤 21시(현지) 보이는 행성 · 달 */
export function tonight(loc) {
  const d = new Date(); d.setHours(21, 0, 0, 0);
  const lat = loc.lat * D, lon = loc.lon * D;
  const th = gmst(d) * D;
  const alt = (v) => { // 적도 단위벡터 → 고도
    const x = v[0] * Math.cos(th) + v[1] * Math.sin(th), y = -v[0] * Math.sin(th) + v[1] * Math.cos(th), z = v[2];
    const U = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    return Math.asin(x * U[0] + y * U[1] + z * U[2]) / D;
  };
  const pp = planetPositions(d), e = pp['지구'].pos;
  const vis = [];
  for (const n of ['수성', '금성', '화성', '목성', '토성']) {
    const h = pp[n].pos, g = [h[0] - e[0], h[1] - e[1], (h[2] || 0) - (e[2] || 0)];
    const v = [g[0], g[1] * Math.cos(EPS) - g[2] * Math.sin(EPS), g[1] * Math.sin(EPS) + g[2] * Math.cos(EPS)], L = Math.hypot(...v);
    const a = alt(v.map((q) => q / L));
    if (a > 8) vis.push(`${n}(${Math.round(a)}°)`);
  }
  const ms = moonState(d);
  const sunUp = (() => { const s = sunDirection(d); const U = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]; return Math.asin(s[0] * U[0] + s[1] * U[1] + s[2] * U[2]) / D; })();
  return { vis, moon: `${ms.phase} (${Math.round(ms.illum * 100)}%)`, sunAlt: sunUp };
}

const CSS = `
.td-wrap{position:absolute;inset:0;z-index:26;display:flex;align-items:center;justify-content:center;background:rgba(0,6,3,.7)}
.td-card{width:min(440px,calc(100% - 24px));max-height:calc(100% - 40px);overflow:auto;padding:14px 14px 12px}
.td-card h2{margin:0 0 8px;font-size:15px;color:var(--g);letter-spacing:.08em;text-shadow:var(--glow)}
.td-card h4{margin:12px 0 5px;font-size:12px;color:var(--g);letter-spacing:.06em}
.td-card img{display:block;width:100%;max-height:240px;object-fit:cover;border:1px solid rgba(61,255,143,.35)}
.td-card .cap{font-size:12px;color:#eafff2;margin-top:6px;font-weight:700}
.td-card .txt{font-size:11px;color:var(--gd);line-height:1.55;margin-top:4px;max-height:5.2em;overflow:hidden}
.td-card a{color:#a6ffcb}
.td-card ul{margin:0;padding-left:16px;font-size:11.5px;line-height:1.55;color:var(--gd)}
.td-card li{margin:3px 0}
.td-card .sm{font-size:10px;opacity:.7}
.td-card button{margin-top:12px;width:100%;border:1px solid var(--g2);background:rgba(61,255,143,.2);color:#eafff2;font-family:inherit;font-weight:700;padding:9px;cursor:pointer}
`;
export function openToday(host, { loc, onClose } = {}) {
  if (!document.getElementById('td-style')) { const st = document.createElement('style'); st.id = 'td-style'; st.textContent = CSS; document.head.appendChild(st); }
  const wrap = document.createElement('div'); wrap.className = 'td-wrap';
  const tn = tonight(loc);
  const today = new Date();
  wrap.innerHTML = `<div class="td-card mu-frame"><h2>// 오늘의 우주 · ${today.getMonth() + 1}월 ${today.getDate()}일</h2>
    <div class="apod"><div class="sm">NASA 오늘의 천문 사진 불러오는 중…</div></div>
    <h4>오늘 밤 ${loc.label} 하늘 (21시)</h4>
    <ul><li>달: ${tn.moon}</li><li>보이는 행성: ${tn.vis.length ? tn.vis.join(' · ') : '없음(낮게 있거나 해 근처)'}</li></ul>
    <h4>최신 우주 뉴스 <span class="sm">(영문 · Spaceflight News API)</span></h4><ul class="news"><li class="sm">불러오는 중…</li></ul>
    <button>우주로 들어가기</button></div>`;
  host.appendChild(wrap);
  const close = () => { wrap.remove(); onClose?.(); };
  wrap.querySelector('button').onclick = close;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  apod().then((a) => {
    wrap.querySelector('.apod').innerHTML = `${a.img ? `<img src="${esc(a.img)}" alt="">` : ''}<div class="cap">${esc(a.title)}</div>
      <div class="txt">${esc(a.text)}</div><div class="sm">NASA APOD ${esc(a.date)}${a.copyright ? ` · © ${esc(a.copyright.trim())}` : ''} · <a href="https://apod.nasa.gov/apod/astropix.html" target="_blank" rel="noopener">원문 보기</a></div>`;
  }).catch(() => { wrap.querySelector('.apod').innerHTML = '<div class="sm">오늘의 천문 사진을 불러오지 못했어요 (요청 한도 초과일 수 있어요)</div>'; });
  news().then((list) => {
    wrap.querySelector('.news').innerHTML = list.map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="sm">· ${esc(n.site)} · ${new Date(n.at).toLocaleDateString('ko-KR')}</span></li>`).join('');
  }).catch(() => { wrap.querySelector('.news').innerHTML = '<li class="sm">뉴스를 불러오지 못했어요</li>'; });
  return { close };
}
