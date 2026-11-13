// 땅밑 — 지하철역과 깊이
// 깊이: 서울교통공사_역사심도정보(서울 열린데이터광장, 공공누리 1유형) — 1~8호선 지하역 선로 기준 깊이(지반고 - 레일면고)
//       승강장 깊이는 공식 정의대로 선로 기준 - 1.1m
// 그 밖의 역(신분당선·경기·코레일 등)은 OpenStreetMap 역 위치만 있고 깊이는 없음

let DEPTH = null, loading = null
export function loadDepth() {
  if (DEPTH) return Promise.resolve()
  if (loading) return loading
  return loading = import('./subway-depth.json').then((m) => {
    // [호선, 역명, 층수, 선로 깊이 m, 위도, 경도]
    DEPTH = m.default.map(([line, name, floor, dep, lat, lon]) => ({ line, name, floor, dep, lat, lon, key: norm(name) }))
  }).catch(() => { loading = null })
}

// 3D 동네용: 반경 안 역들 (같은 역 여러 호선 묶음)
export async function depthNear(lat, lon, r) {
  await loadDepth()
  return stationList([]).filter((st) => distM(lat, lon, st.lat, st.lon) < r)
}

const norm = (n) => (n || '').replace(/\(.*?\)/g, '').replace(/역$/, '').replace(/\s/g, '')
const distM = (a, b, c, d) => {
  const R = 6371000, toR = Math.PI / 180
  const x = (d - b) * toR * Math.cos(((a + c) / 2) * toR), y = (c - a) * toR
  return Math.hypot(x, y) * R
}
const platform = (dep) => Math.max(0, dep - 1.1)

// 이름이 같고 가까운(800m) 공식 깊이 자료 — 환승역이면 여러 호선
function depthsFor(name, lat, lon) {
  if (!DEPTH) return []
  const k = norm(name)
  return DEPTH.filter((d) => d.key === k && distM(lat, lon, d.lat, d.lon) < 800)
}

// 화면에 그릴 역 목록: 공식 자료 역(호선별 묶음) + 자료에 없는 OSM 역
function stationList(osm) {
  const out = new Map()
  if (DEPTH) for (const d of DEPTH) {
    const k = d.key
    const e = out.get(k)
    if (e && distM(e.lat, e.lon, d.lat, d.lon) < 800) { e.depths.push(d); e.lines.add(d.line + '호선') }
    else if (!e) out.set(k, { name: d.name, lat: d.lat, lon: d.lon, depths: [d], lines: new Set([d.line + '호선']) })
  }
  for (const st of osm || []) {
    const k = norm(st.name)
    const e = out.get(k)
    if (e && distM(e.lat, e.lon, st.lat, st.lon) < 800) { if (st.line) e.lines.add(st.line); continue }
    const k2 = e ? k + '|' + st.lat.toFixed(2) : k
    const e2 = out.get(k2)
    if (e2) { if (st.line) e2.lines.add(st.line); continue }
    out.set(k2, { name: norm(st.name), lat: st.lat, lon: st.lon, depths: [], lines: new Set(st.line ? [st.line] : []) })
  }
  return [...out.values()]
}

function depthText(depths) {
  if (!depths.length) return ''
  const ps = depths.map((d) => platform(d.dep))
  const lo = Math.round(Math.min(...ps)), hi = Math.round(Math.max(...ps))
  if (hi < 1) return '지상'
  return lo === hi ? `지하 ${hi}m` : `지하 ${lo}~${hi}m`
}

// 내 위치에서 가장 가까운 역 (2.5km 안)
export function nearestStation(lat, lon, osm) {
  let best = null
  for (const st of stationList(osm)) {
    const dm = distM(lat, lon, st.lat, st.lon)
    if (dm < 2500 && (!best || dm < best.dist)) best = { ...st, dist: dm }
  }
  if (!best) return null
  const dt = depthText(best.depths)
  const lines = [...best.lines].join('·')
  return `가까운 역 ${best.name}${lines ? `(${lines})` : ''} ${best.dist < 1000 ? Math.round(best.dist / 10) * 10 + 'm' : (best.dist / 1000).toFixed(1) + 'km'}${dt ? ` · 승강장 ${dt === '지상' ? '지상' : dt.replace('지하', '지하 약')}` : ' · 깊이 자료 없음'}`
}

// 확대한 지도 위 역 표시 (화면 폭 15km 이하)
export function drawStations(ctx, earth, X, Y, R, W, H, viewKm, alpha) {
  if (alpha < 0.02) return
  const list = stationList(earth.stations)
  ctx.font = '600 10.5px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif'
  ctx.textAlign = 'left'
  const placed = []
  // 깊은 역부터 (라벨이 겹치면 얕은 쪽 생략)
  list.sort((a, b) => (b.depths[0]?.dep || -1) - (a.depths[0]?.dep || -1))
  for (const st of list) {
    const p = earth.project(st.lat, st.lon, X, Y, R)
    if (p.z < 0.1 || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue
    ctx.globalAlpha = alpha
    ctx.strokeStyle = '#c99bff'; ctx.lineWidth = 1.6
    ctx.fillStyle = 'rgba(20,6,40,.85)'
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    // 화면 폭 7km 넘게 넓으면 점만 (글자가 너무 빽빽해짐)
    if (viewKm > 7) continue
    if (placed.some((q) => Math.abs(q.x - p.x) < 80 && Math.abs(q.y - p.y) < 15)) continue
    placed.push(p)
    const dt = depthText(st.depths)
    const txt = dt ? `${st.name} · ${dt}` : st.name
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'
    ctx.strokeText(txt, p.x + 7, p.y + 4)
    ctx.fillStyle = dt ? '#e2ccff' : 'rgba(225,215,245,.85)'
    ctx.fillText(txt, p.x + 7, p.y + 4)
  }
  ctx.globalAlpha = 1
}
