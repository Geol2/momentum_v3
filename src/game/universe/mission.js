// 비행 계획 — 행성에서 행성으로 가는 실제 궤도 계산
// · 행성 위치: JPL 궤도 요소 근사(planets.js) · 탄도: 램버트 문제(두 위치·비행 시간 → 궤도) 2체 근사
// · 출발 Δv: 출발 행성 낮은 원궤도에서 탈출, 도착 Δv: 도착 행성 타원 궤도(근점 1.05R, 원점 50R)로 붙잡히기
// · 스윙바이: 실제 탐사선의 발사·근접 비행 날짜에 행성 위치를 램버트로 이음(패치드 코닉 근사)
import * as THREE from 'three'
import { makeShell } from './closeup.js'
import { planetPositions, orbitPoints, PERIOD_DAYS } from './planets.js'
import { plutoHelio3 as plutoHelio } from './bodies.js'

const MU = 2.959122082855911e-4 // 태양 GM, AU³/일²
const KMS = 1731.456836 // AU/일 → km/s
const DAY = 86400000
const PL = ['수성', '금성', '지구', '화성', '목성', '토성', '천왕성', '해왕성']
const PCOL = { 수성: 0xb9b2a8, 금성: 0xe8cf9a, 지구: 0x4a90e2, 화성: 0xd1603d, 목성: 0xd8b48a, 토성: 0xe5d29f, 천왕성: 0x9fd8e0, 해왕성: 0x5b7fe0, 명왕성: 0xc9b9a0 }
// 행성 GM(km³/s²)·반지름(km)
const GMP = { 수성: [22032, 2440], 금성: [324859, 6052], 지구: [398600, 6371], 화성: [42828, 3390], 목성: [126686534, 69911], 토성: [37931187, 58232], 천왕성: [5793939, 25362], 해왕성: [6836529, 24622], 명왕성: [870, 1188] }

// 실제 탐사선 참고(직행)
const REF = {
  '지구>화성': '참고: 퍼서비어런스 2020-07-30 출발 → 2021-02-18 도착 (203일)',
  '지구>금성': '참고: 비너스 익스프레스 2005-11-09 출발 → 2006-04-11 도착 (153일)',
  '지구>목성': '참고: 실제 목성 탐사선은 대부분 스윙바이로 연료를 아낌 (주노 5년)',
  '지구>토성': '참고: 카시니는 금성·금성·지구·목성 스윙바이로 6.7년',
  '지구>수성': '참고: 수성은 태양 쪽으로 깊이 떨어져 속도를 줄여야 해서 가장 비싼 곳 — 메신저는 스윙바이 6번',
}

// 스윙바이 예시: 실제 날짜 [날짜, 천체, 설명]
const ASSISTS = [
  { id: 'v2', name: '보이저 2호', legs: [['1977-08-20', '지구', '발사'], ['1979-07-09', '목성', '목성 스윙바이'], ['1981-08-25', '토성', '토성 스윙바이'], ['1986-01-24', '천왕성', '천왕성 스윙바이'], ['1989-08-25', '해왕성', '해왕성 근접 — 행성 4개 그랜드 투어']] },
  { id: 'v1', name: '보이저 1호', legs: [['1977-09-05', '지구', '발사'], ['1979-03-05', '목성', '목성 스윙바이'], ['1980-11-12', '토성', '토성·타이탄 근접 → 황도면 위로 튕겨 나감']] },
  { id: 'p11', name: '파이어니어 11호', legs: [['1973-04-06', '지구', '발사'], ['1974-12-03', '목성', '목성 스윙바이 (거꾸로 휘어 토성 쪽으로)'], ['1979-09-01', '토성', '토성 첫 근접']] },
  { id: 'nh', name: '뉴호라이즌스', legs: [['2006-01-19', '지구', '발사 — 역대 가장 빠른 출발 속도'], ['2007-02-28', '목성', '목성 스윙바이로 3년 단축'], ['2015-07-14', '명왕성', '명왕성 근접']] },
  { id: 'm10', name: '매리너 10호', legs: [['1973-11-03', '지구', '발사'], ['1974-02-05', '금성', '금성 스윙바이 — 인류 첫 스윙바이'], ['1974-03-29', '수성', '수성 첫 근접']] },
  { id: 'cas', name: '카시니 (지구 스윙바이 이후)', legs: [['1999-08-18', '지구', '지구 스윙바이 (그 전 금성 2번)'], ['2000-12-30', '목성', '목성 스윙바이'], ['2004-07-01', '토성', '토성 궤도 진입']] },
]

// ── 벡터 ──
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a) => Math.hypot(a[0], a[1], a[2])
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

// 날짜(일 단위 JD 비슷한 정수 키)별 행성 위치 캐시
const posCache = new Map()
function bodyPos(name, t) {
  const k = name + '|' + Math.round(t / 3600000)
  let p = posCache.get(k)
  if (!p) {
    const d = new Date(t)
    p = name === '명왕성' ? plutoHelio(d) : planetPositions(d)[name].pos
    if (posCache.size > 60000) posCache.clear()
    posCache.set(k, p)
  }
  return p
}
const bodyVel = (name, t) => mul(sub(bodyPos(name, t + DAY / 2), bodyPos(name, t - DAY / 2)), 1) // AU/일

// ── 램버트 (범용 변수, 한 바퀴 안, 순행) ──
function stumpC(z) { if (z > 1e-8) return (1 - Math.cos(Math.sqrt(z))) / z; if (z < -1e-8) return (Math.cosh(Math.sqrt(-z)) - 1) / -z; return 0.5 }
function stumpS(z) { if (z > 1e-8) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s) } if (z < -1e-8) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s) } return 1 / 6 }
export function lambert(r1, r2, dt) {
  const R1 = len(r1), R2 = len(r2)
  let th = Math.acos(Math.max(-1, Math.min(1, dot(r1, r2) / (R1 * R2))))
  if (cross(r1, r2)[2] < 0) th = 2 * Math.PI - th // 순행(반시계)
  const A = Math.sin(th) * Math.sqrt((R1 * R2) / (1 - Math.cos(th)))
  if (!isFinite(A) || Math.abs(A) < 1e-9) return null
  const y = (z) => R1 + R2 + (A * (z * stumpS(z) - 1)) / Math.sqrt(stumpC(z))
  const F = (z) => { const yy = y(z); if (yy < 0) return NaN; return Math.pow(yy / stumpC(z), 1.5) * stumpS(z) + A * Math.sqrt(yy) - Math.sqrt(MU) * dt }
  let lo = -1000, hi = 4 * Math.PI * Math.PI - 1e-6
  // y > 0 인 곳까지 아래 경계 올리기 (y는 z에 대해 증가)
  if (!(y(lo) > 0)) {
    let a = lo, b = hi
    if (!(y(b) > 0)) return null
    for (let i = 0; i < 80; i++) { const m = (a + b) / 2; if (y(m) > 0) b = m; else a = m }
    lo = b
  }
  if (!(F(lo) < 0) || !(F(hi) > 0)) return null
  let z = 0
  for (let i = 0; i < 80; i++) { z = (lo + hi) / 2; const f = F(z); if (!isFinite(f)) { lo = z; continue } if (f > 0) hi = z; else lo = z }
  const yy = y(z)
  const f = 1 - yy / R1, g = A * Math.sqrt(yy / MU), gd = 1 - yy / R2
  return { v1: mul(sub(r2, mul(r1, f)), 1 / g), v2: mul(sub(mul(r2, gd), r1), 1 / g) }
}

// 출발 Δv(낮은 원궤도 → 탈출), 도착 Δv(타원 궤도로 포획)
function departDv(name, vinf) { const [mu, R] = GMP[name], rp = R * (name === '지구' ? 1 + 200 / 6371 : 1.05); return Math.sqrt(vinf * vinf + (2 * mu) / rp) - Math.sqrt(mu / rp) }
function captureDv(name, vinf) { const [mu, R] = GMP[name], rp = R * 1.05, ra = R * 50; return Math.sqrt(vinf * vinf + (2 * mu) / rp) - Math.sqrt(mu * (2 / rp - 2 / (rp + ra))) }

function transfer(from, to, tDep, tof) {
  const r1 = bodyPos(from, tDep), r2 = bodyPos(to, tDep + tof * DAY)
  const L = lambert(r1, r2, tof)
  if (!L) return null
  const vi1 = len(sub(L.v1, bodyVel(from, tDep))) * KMS, vi2 = len(sub(L.v2, bodyVel(to, tDep + tof * DAY))) * KMS
  const d1 = departDv(from, vi1), d2 = captureDv(to, vi2)
  return { r1, r2, v1: L.v1, v2: L.v2, vi1, vi2, d1, d2, dv: d1 + d2, tDep, tof }
}

// 2체 궤도 따라 점 찍기 (RK4)
function propagate(r, v, days, n = 360) {
  const pts = [r.slice()]
  const steps = n * 8, h = days / steps
  let x = r.slice(), u = v.slice()
  const acc = (p) => { const d = len(p); return mul(p, -MU / (d * d * d)) }
  for (let i = 1; i <= steps; i++) {
    const k1v = acc(x), k1x = u
    const k2v = acc(add(x, mul(k1x, h / 2))), k2x = add(u, mul(k1v, h / 2))
    const k3v = acc(add(x, mul(k2x, h / 2))), k3x = add(u, mul(k2v, h / 2))
    const k4v = acc(add(x, mul(k3x, h))), k4x = add(u, mul(k3v, h))
    x = add(x, mul(add(add(k1x, mul(k2x, 2)), add(mul(k3x, 2), k4x)), h / 6))
    u = add(u, mul(add(add(k1v, mul(k2v, 2)), add(mul(k3v, 2), k4v)), h / 6))
    if (i % 8 === 0) pts.push(x.slice())
  }
  return pts
}

const fmtD = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` }
const fmtDur = (days) => days < 400 ? `${Math.round(days)}일` : `${(days / 365.25).toFixed(1)}년`
const T0 = (s) => new Date(s + 'T12:00:00Z').getTime()

const CSS = `
.mp-pork{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(96px + env(safe-area-inset-bottom));width:min(94vw,380px);z-index:2;padding:6px 8px 8px}
.cu-root .mp-pork canvas{position:static!important;display:block;width:100%!important;height:110px!important;cursor:crosshair;image-rendering:pixelated}
.mp-pork .ttl{font-size:10.5px;color:var(--g);margin-bottom:4px;display:flex;justify-content:space-between;gap:6px}
.mp-pork .ax{font-size:9.5px;color:var(--gd);display:flex;justify-content:space-between;margin-top:2px}
.mp-sel{border:1px solid var(--g2);background:rgba(1,22,11,.85);color:var(--g);font-family:inherit;font-weight:700;font-size:10.5px;height:30px;padding:0 6px}
.mp-pork[hidden]{display:none}
`

export function openMission(host, { onClose } = {}) {
  if (!document.getElementById('mp-style')) { const s = document.createElement('style'); s.id = 'mp-style'; s.textContent = CSS; document.head.appendChild(s) }
  const S = makeShell(host, 'plan', onClose)
  const { scene, st } = S
  S.renderer.setClearColor(0x000000, 1)
  const U = 10 // 1 AU = 10
  const toV = (p) => new THREE.Vector3(p[0] * U, p[2] * U, -p[1] * U)

  // 태양
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd27a })))
  const sunLab = new THREE.Object3D(); S.addLabel(sunLab, '태양', '#ffd27a').rad = 0.9
  const today = Date.now()
  const orbitMat = new THREE.LineBasicMaterial({ color: 0x2c6a48, transparent: true, opacity: 0.55 })
  const bodies = {}
  for (const nm of [...PL, '명왕성']) {
    let pts
    if (nm === '명왕성') { pts = []; for (let i = 0; i <= 240; i++) pts.push(plutoHelio(new Date(today + i * 248 * 365.25 * DAY / 240))) }
    else pts = orbitPoints(nm, new Date(today), 200)
    const g = new THREE.BufferGeometry().setFromPoints(pts.map(toV))
    const line = new THREE.Line(g, orbitMat); scene.add(line)
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(nm === '목성' || nm === '토성' ? 0.55 : 0.32, 16, 12), new THREE.MeshBasicMaterial({ color: PCOL[nm] }))
    scene.add(mesh)
    const lab = S.addLabel(mesh, nm, '#cfe8ff'); lab.rad = 0.4
    bodies[nm] = { mesh, line, lab }
    if (nm === '명왕성') { line.visible = false; mesh.visible = false; lab.hidden = true }
  }
  // 우주선 경로
  const pathMat = new THREE.LineBasicMaterial({ color: 0x3dff8f })
  const ghostMat = new THREE.LineDashedMaterial({ color: 0x3dff8f, dashSize: 0.4, gapSize: 0.3, transparent: true, opacity: 0.45 })
  let pathLines = []
  const ship = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }))
  scene.add(ship)
  const shipLab = S.addLabel(ship, '우주선', '#3dff8f'); shipLab.rad = 0.3
  ship.visible = false; shipLab.hidden = true

  // 현재 계획: { segs: [{ t0, t1, pts }], marks: [...], t0, t1 }
  let plan = null, simT = today, playing = false, rate = 1
  const setBodies = (t) => {
    for (const nm of [...PL, '명왕성']) bodies[nm].mesh.position.copy(toV(bodyPos(nm, t)))
  }
  setBodies(today)
  function clearPath() { for (const l of pathLines) { scene.remove(l); l.geometry.dispose() } pathLines = [] }
  function showPlan(p) {
    clearPath()
    plan = p
    for (const sg of p.segs) {
      const g = new THREE.BufferGeometry().setFromPoints(sg.pts.map(toV))
      const ghost = new THREE.Line(g, ghostMat); ghost.computeLineDistances(); scene.add(ghost); pathLines.push(ghost)
      const g2 = new THREE.BufferGeometry().setFromPoints(sg.pts.map(toV)); g2.setDrawRange(0, 0)
      const solid = new THREE.Line(g2, pathMat); scene.add(solid); pathLines.push(solid)
      sg.solid = solid
    }
    const rmax = Math.max(...p.segs.flatMap((sg) => sg.pts.map((q) => Math.hypot(q[0], q[1]))))
    st.goalT = () => new THREE.Vector3(); st.goalD = Math.max(30, rmax * U * (pork.hidden ? 2.6 : 3.8))
    simT = p.t0; playing = true
    rate = (p.t1 - p.t0) / DAY / 14 // 약 14초에 전체 비행
    ship.visible = true; shipLab.hidden = false
    const pluto = p.bodies.includes('명왕성')
    bodies['명왕성'].line.visible = pluto; bodies['명왕성'].mesh.visible = pluto; bodies['명왕성'].lab.hidden = !pluto
    playBtn.textContent = '일시정지'
  }

  // ── UI: 모드 · 출발/도착 · 포크찹 ──
  const bar = S.bar
  const mkSel = (opts, val) => { const s = document.createElement('select'); s.className = 'mp-sel'; s.innerHTML = opts.map((o) => `<option${o === val ? ' selected' : ''}>${o}</option>`).join(''); bar.appendChild(s); return s }
  const selFrom = mkSel(PL, '지구'), selTo = mkSel(PL, '화성')
  const goBtn = S.button('출발일 찾기', () => runPork())
  const asSel = document.createElement('select'); asSel.className = 'mp-sel'
  asSel.innerHTML = '<option value="">스윙바이 예시…</option>' + ASSISTS.map((a) => `<option value="${a.id}">${a.name}</option>`).join('')
  bar.appendChild(asSel)
  asSel.onchange = () => { if (asSel.value) runAssist(ASSISTS.find((a) => a.id === asSel.value)) }
  const playBtn = S.button('일시정지', () => { if (!plan) return; if (simT >= plan.t1) simT = plan.t0; playing = !playing; playBtn.textContent = playing ? '일시정지' : '재생' })

  const pork = document.createElement('div'); pork.className = 'mp-pork mu-frame'; pork.hidden = true
  pork.innerHTML = '<div class="ttl"><span class="pt"></span><span class="pv"></span></div><canvas></canvas><div class="ax"><span class="a0"></span><span>← 출발일 →</span><span class="a1"></span></div>'
  S.root.appendChild(pork)
  const pcv = pork.querySelector('canvas')
  let grid = null

  function runPork() {
    const from = selFrom.value, to = selTo.value
    if (from === to) { S.info('비행 계획', '출발과 도착을 다르게 골라 주세요', []); return }
    asSel.value = ''
    const P1 = PERIOD_DAYS[from], P2 = PERIOD_DAYS[to]
    const syn = 1 / Math.abs(1 / P1 - 1 / P2)
    const span = Math.max(500, Math.min(2600, syn * 2.2))
    const a1 = Math.cbrt(MU * (P1 / (2 * Math.PI)) ** 2), a2 = Math.cbrt(MU * (P2 / (2 * Math.PI)) ** 2)
    const tH = Math.PI * Math.sqrt(((a1 + a2) / 2) ** 3 / MU)
    const tofLo = Math.max(30, tH * 0.45), tofHi = tH * 1.6
    const NX = 80, NY = 48
    const vals = new Float32Array(NX * NY).fill(NaN)
    const tStart = Math.floor(today / DAY) * DAY
    let best = null
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      const tDep = tStart + (i / (NX - 1)) * span * DAY, tof = tofLo + (j / (NY - 1)) * (tofHi - tofLo)
      const tr = transfer(from, to, tDep, tof)
      if (!tr || !isFinite(tr.dv)) continue
      vals[j * NX + i] = tr.dv
      if (!best || tr.dv < best.dv) best = tr
    }
    grid = { from, to, NX, NY, vals, tStart, span, tofLo, tofHi }
    // 색: 최솟값 기준 상대 (밝은 초록 = 연료 적게)
    const cx = pcv.getContext('2d'); pcv.width = NX; pcv.height = NY
    const img = cx.createImageData(NX, NY)
    const vmin = best ? best.dv : 0
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      const v = vals[j * NX + i], o = ((NY - 1 - j) * NX + i) * 4
      if (!isFinite(v)) { img.data[o] = 4; img.data[o + 1] = 8; img.data[o + 2] = 6; img.data[o + 3] = 255; continue }
      const k = Math.max(0, Math.min(1, (v - vmin) / (vmin * 1.2 + 2)))
      const band = Math.floor(k * 10) % 2 ? 0.85 : 1 // 등고선 느낌의 띠
      const q = 1 - k
      img.data[o] = (8 + 90 * q * q) * band; img.data[o + 1] = (18 + 237 * q ** 1.4) * band; img.data[o + 2] = (14 + 110 * q * q) * band; img.data[o + 3] = 255
    }
    cx.putImageData(img, 0, 0)
    pork.hidden = false
    pork.querySelector('.pt').textContent = `${from} → ${to} · 필요 Δv (밝을수록 적게) · ↑ 비행 시간`
    pork.querySelector('.a0').textContent = fmtD(tStart)
    pork.querySelector('.a1').textContent = fmtD(tStart + span * DAY)
    if (best) choose(best)
  }
  pcv.addEventListener('pointerdown', (e) => {
    if (!grid) return
    const r = pcv.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left) / r.width) * (grid.NX - 1)), j = grid.NY - 1 - Math.round(((e.clientY - r.top) / r.height) * (grid.NY - 1))
    const tDep = grid.tStart + (i / (grid.NX - 1)) * grid.span * DAY, tof = grid.tofLo + (j / (grid.NY - 1)) * (grid.tofHi - grid.tofLo)
    const tr = transfer(grid.from, grid.to, tDep, tof)
    if (tr) choose(tr, true)
  })
  function drawMark(tr) {
    if (!grid) return
    const cx = pcv.getContext('2d')
    // 다시 그리지 않고 표시만: 캔버스 위 작은 사각형 (이전 표시는 다음 계산 때 지워짐)
    const i = ((tr.tDep - grid.tStart) / DAY / grid.span) * (grid.NX - 1), j = ((tr.tof - grid.tofLo) / (grid.tofHi - grid.tofLo)) * (grid.NY - 1)
    cx.strokeStyle = '#fff'; cx.lineWidth = 1; cx.strokeRect(Math.round(i) - 1.5, grid.NY - 1 - Math.round(j) - 1.5, 3, 3)
  }
  function choose(tr, picked = false) {
    drawMark(tr)
    const from = grid.from, to = grid.to
    const pts = propagate(tr.r1, tr.v1, tr.tof)
    showPlan({ t0: tr.tDep, t1: tr.tDep + tr.tof * DAY, segs: [{ t0: tr.tDep, t1: tr.tDep + tr.tof * DAY, pts }], bodies: [from, to] })
    const sig = len(tr.r2) * 149597870.7 / 299792.458 / 60
    pork.querySelector('.pv').textContent = `${fmtD(tr.tDep)} · ${fmtDur(tr.tof)}`
    S.info(`${from} → ${to}${picked ? '' : ' · 가장 적은 연료'}`, `출발 ${fmtD(tr.tDep)} → 도착 ${fmtD(tr.tDep + tr.tof * DAY)} (${fmtDur(tr.tof)})`, [
      `총 Δv ${tr.dv.toFixed(2)} km/s = 출발 ${tr.d1.toFixed(2)} + 도착 궤도 진입 ${tr.d2.toFixed(2)}`,
      `출발 행성 대비 속도(v∞) ${tr.vi1.toFixed(2)} km/s · 도착 때 ${tr.vi2.toFixed(2)} km/s`,
      `도착 때 지구까지 신호 지연 약 ${to === '지구' ? 0 : Math.round(len(sub(tr.r2, bodyPos('지구', tr.tDep + tr.tof * DAY))) * 149597870.7 / 299792.458 / 60)}분`,
      REF[`${from}>${to}`] || '그래프를 탭하면 다른 출발일·비행 시간으로 바꿔 볼 수 있어요',
    ])
    void sig
  }

  function runAssist(A) {
    pork.hidden = true; grid = null
    const segs = [], rows = []
    let prevIn = null, prevV = null
    for (let k = 0; k + 1 < A.legs.length; k++) {
      const [d0, b0] = A.legs[k], [d1, b1] = A.legs[k + 1]
      const t0 = T0(d0), t1 = T0(d1), tof = (t1 - t0) / DAY
      const r1 = bodyPos(b0, t0), r2 = bodyPos(b1, t1)
      const L = lambert(r1, r2, tof)
      if (!L) continue
      segs.push({ t0, t1, pts: propagate(r1, L.v1, tof) })
      const vb0 = bodyVel(b0, t0)
      if (k === 0) rows.push(`${d0} ${b0} 출발 · 태양 기준 속도 ${(len(L.v1) * KMS).toFixed(1)} km/s (행성 대비 v∞ ${(len(sub(L.v1, vb0)) * KMS).toFixed(1)})`)
      else {
        // 스윙바이: 행성 대비 속도 크기는 그대로, 방향만 꺾여 태양 기준 속도가 바뀜
        const vOut = len(L.v1) * KMS, vIn = len(prevV) * KMS
        const vinIn = len(sub(prevV, vb0)) * KMS, vinOut = len(sub(L.v1, vb0)) * KMS
        rows.push(`${d0} ${b0} 스윙바이 · 태양 기준 ${vIn.toFixed(1)} → ${vOut.toFixed(1)} km/s (${vOut >= vIn ? '+' : ''}${(vOut - vIn).toFixed(1)}, 연료 없이) · v∞ ${vinIn.toFixed(1)}/${vinOut.toFixed(1)}`)
      }
      prevV = L.v2; prevIn = b1
    }
    const last = A.legs[A.legs.length - 1]
    rows.push(`${last[0]} ${last[1]} 도착 · ${last[2]} · 총 ${fmtDur((T0(last[0]) - T0(A.legs[0][0])) / DAY)}`)
    void prevIn
    showPlan({ t0: segs[0].t0, t1: segs[segs.length - 1].t1, segs, bodies: A.legs.map((l) => l[1]) })
    S.info(A.name, '실제 발사·근접 비행 날짜의 행성 위치를 궤도로 이음 (2체 근사 · 중간 궤도 수정은 생략)', rows)
  }

  S.info('비행 계획', '출발·도착 행성을 고르고 「출발일 찾기」 — 또는 스윙바이 예시', [
    '앞으로 몇 년 동안 날짜별로 필요한 연료(Δv)를 계산해 가장 좋은 날을 찾아요',
    '스윙바이: 행성 옆을 스쳐 지나가며 그 행성의 공전 속도를 빌려 연료 없이 가속',
  ])
  S.root.querySelector('.cu-note').textContent = '드래그로 돌리기 · 핀치/휠로 확대'
  st.dist = 60; st.pitch = 0.9; st.minD = 2; st.maxD = 1500; st.yaw = 0

  let lastStamp = 0
  S.loop((dt) => {
    if (plan && playing) {
      simT += dt * rate * DAY
      if (simT >= plan.t1) { simT = plan.t1; playing = false; playBtn.textContent = '다시 보기' }
    }
    const t = plan ? simT : today
    setBodies(t)
    if (plan) {
      let pos = null
      for (const sg of plan.segs) {
        const f = (t - sg.t0) / (sg.t1 - sg.t0)
        const n = sg.pts.length
        sg.solid.geometry.setDrawRange(0, Math.max(0, Math.min(n, Math.ceil(f * (n - 1)) + 1)))
        if (f >= 0 && f <= 1) { const x = f * (n - 1), i = Math.min(n - 2, Math.floor(x)), u = x - i; const a = sg.pts[i], b = sg.pts[i + 1]; pos = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u] }
      }
      if (pos) ship.position.copy(toV(pos))
      if (Math.abs(t - lastStamp) > DAY) { lastStamp = t; S.root.querySelector('.cu-note').textContent = `${fmtD(t)} · 출발 후 ${fmtDur((t - plan.t0) / DAY)}` }
    }
    S.updateCamera(dt)
  })
  return S
}
