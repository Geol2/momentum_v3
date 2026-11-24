// 지구 근접 소행성 — 백엔드 /api/space/neo (NASA JPL Close-Approach Data + 궤도 요소)
// 궤적: 궤도 요소로 2체 계산한 태양 중심 위치 − 지구 위치. 최근접 거리는 JPL 값에 맞춰 보정(근사 궤적).
import { spaceApi } from '../../lib/api.js'
import { planetPositions } from './planets.js'
import { eclToEcef, daysJ2000 } from './astro.js'

const DEG = Math.PI / 180
const AU_RE = 149597870.7 / 6371 // 1 AU = 지구 반지름 23,481배
export const LD_AU = 0.002569 // 지구~달 평균 거리
const K = 0.01720209895 // 가우스 중력 상수 (AU^1.5/일)

let data = null, loading = null, failed = false
export function loadNeo() {
  if (data || loading || failed) return loading
  loading = spaceApi.neo().then((d) => {
    data = (d.items || []).map((it) => ({ ...it, t: (it.jd - 2440587.5) * 86400000 }))
    data.sort((a, b) => a.t - b.t)
  }).catch(() => { failed = true }).finally(() => { loading = null })
  return loading
}
export const neoList = () => data

// 케플러: 궤도 요소 → 태양 중심 황도 좌표(AU)
function helio(o, jd) {
  const n = K / Math.pow(o.a, 1.5)
  let M = (o.ma * DEG + n * (jd - o.epoch)) % (2 * Math.PI)
  let E = M
  for (let i = 0; i < 30; i++) { const d = (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-12) break }
  const xv = o.a * (Math.cos(E) - o.e), yv = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E)
  const v = Math.atan2(yv, xv), r = Math.hypot(xv, yv)
  const O = o.om * DEG, w = o.w * DEG, I = o.i * DEG, u = v + w
  return [r * (Math.cos(O) * Math.cos(u) - Math.sin(O) * Math.sin(u) * Math.cos(I)),
    r * (Math.sin(O) * Math.cos(u) + Math.cos(O) * Math.sin(u) * Math.cos(I)),
    r * Math.sin(u) * Math.sin(I)]
}
const geo = (o, ms) => {
  const jd = ms / 86400000 + 2440587.5
  const a = helio(o, jd), e = planetPositions(new Date(ms))['지구'].pos
  return [a[0] - e[0], a[1] - e[1], a[2] - e[2]]
}

// 최근접 ±3일 궤적(지구 중심 황도, AU) — JPL 최소 거리에 맞게 옮김
function pathOf(it) {
  if (it._path !== undefined) return it._path
  if (!it.orbit) return (it._path = null)
  const p0 = geo(it.orbit, it.t), r0 = Math.hypot(...p0) || 1
  const k = it.distAu / r0, off = [p0[0] * k - p0[0], p0[1] * k - p0[1], p0[2] * k - p0[2]]
  // 보정이 너무 크면(궤도 요소가 오래됐거나 2체 근사 한계) 그리지 않음
  if (Math.hypot(...off) > Math.max(0.01, it.distAu * 3)) return (it._path = null)
  const pts = []
  for (let s = -72; s <= 72; s += 2) { const g = geo(it.orbit, it.t + s * 3600000); pts.push([g[0] + off[0], g[1] + off[1], g[2] + off[2], s]) }
  return (it._path = pts)
}

// 황도 벡터(AU) → 지구 고정 좌표(지구 반지름) : 지금 시각의 자전 각도로 한 번에 돌림(달 궤도와 같은 방식)
function toEcef(p, n) {
  const r = Math.hypot(p[0], p[1], p[2])
  const lam = Math.atan2(p[1], p[0]) / DEG, bet = Math.asin(p[2] / r) / DEG
  const u = eclToEcef(lam, bet, n)
  return [u[0] * r * AU_RE, u[1] * r * AU_RE, u[2] * r * AU_RE]
}

export function sizeText(it) {
  if (it.diameterKm) return it.diameterKm >= 1 ? `약 ${it.diameterKm.toFixed(1)}km` : `약 ${Math.round(it.diameterKm * 1000)}m`
  if (it.h == null) return '크기 모름'
  // 밝기(H)로 추정 — 반사율 0.25~0.05
  const d = (p) => (1329 / Math.sqrt(p)) * Math.pow(10, -it.h / 5) * 1000
  const lo = d(0.25), hi = d(0.05), f = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)
  return `약 ${f(lo)}~${f(hi)}`
}
export function whenText(it, now = Date.now()) {
  const dd = (it.t - now) / 86400000
  const d = new Date(it.t)
  const ds = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (Math.abs(dd) < 0.5) return `${ds} · 지금 근처`
  return dd > 0 ? `${ds} · ${Math.ceil(dd)}일 뒤` : `${ds} · ${Math.ceil(-dd)}일 전 지나감`
}

// 지구·달 단계 위 궤적 그리기. selected: 강조할 des
export function drawNeo(ctx, earth, X, Y, R, W, H, now, selected) {
  if (!data || !earth.projectP) return
  const n = daysJ2000(new Date(now))
  ctx.save()
  ctx.font = '600 10.5px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif'
  for (const it of data) {
    // 지금 ±10일 안 근접만 (선택한 건 언제든)
    if (it.des !== selected && Math.abs(it.t - now) > 10 * 86400000) continue
    const P = pathOf(it)
    if (!P) continue
    const sel = it.des === selected
    const col = it.pha ? '255,120,90' : '255,206,110'
    ctx.strokeStyle = `rgba(${col},${sel ? 0.95 : 0.55})`; ctx.lineWidth = sel ? 2 : 1.2
    ctx.setLineDash(sel ? [] : [4, 4])
    ctx.beginPath()
    let started = false, ca = null
    for (const q of P) {
      const e = toEcef(q, n), s = earth.projectP(e[0], e[1], e[2], X, Y, R)
      if (!isFinite(s.x) || Math.abs(s.x) > 1e5 || Math.abs(s.y) > 1e5) { started = false; continue }
      if (started) ctx.lineTo(s.x, s.y); else { ctx.moveTo(s.x, s.y); started = true }
      if (q[3] === 0) ca = s
    }
    ctx.stroke(); ctx.setLineDash([])
    // 지금 위치(궤적 창 안일 때)
    const hrs = (now - it.t) / 3600000
    if (Math.abs(hrs) <= 72) {
      const g = geo(it.orbit, now), off0 = P[36] // 보정량은 최근접 지점과 같게
      const g0 = geo(it.orbit, it.t), k = [off0[0] - g0[0], off0[1] - g0[1], off0[2] - g0[2]]
      const e = toEcef([g[0] + k[0], g[1] + k[1], g[2] + k[2]], n), s = earth.projectP(e[0], e[1], e[2], X, Y, R)
      ctx.fillStyle = `rgb(${col})`; ctx.beginPath(); ctx.arc(s.x, s.y, sel ? 4 : 3, 0, Math.PI * 2); ctx.fill()
    }
    if (ca && ca.x > -50 && ca.x < W + 50 && ca.y > -50 && ca.y < H + 50) {
      ctx.strokeStyle = `rgb(${col})`; ctx.lineWidth = 1.2
      ctx.beginPath(); ctx.arc(ca.x, ca.y, 5, 0, Math.PI * 2); ctx.stroke()
      const lab = `${it.name.replace(/^\(|\)$/g, '')} · 달 거리 ×${(it.distAu / LD_AU).toFixed(1)}`
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(lab, ca.x + 8, ca.y - 6)
      ctx.fillStyle = `rgb(${col})`; ctx.fillText(lab, ca.x + 8, ca.y - 6)
    }
  }
  ctx.restore()
}
