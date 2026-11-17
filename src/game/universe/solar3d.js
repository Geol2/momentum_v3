// 태양계 3D — 오늘(또는 고른 날) 실제 행성 위치·궤도, 소행성대·카이퍼 벨트, 명왕성, 보이저 1·2호
// 위치: JPL 궤도 요소 근사(planets.js) · 행성 크기만 보기 좋게 키움(실제 비율이면 점보다 작음)
import * as THREE from 'three'
import { makeShell, glowTexture } from './closeup.js'
import { planetPositions, orbitPoints } from './planets.js'
import { plutoHelio3 } from './bodies.js'
import { openPlanet3D } from './planet3d.js'

const DAY = 86400000
const U = 10 // 1 AU = 10
const PL = [
  ['수성', 0xb9b2a8, 0.16], ['금성', 0xe8cf9a, 0.24], ['지구', 0x4a90e2, 0.25], ['화성', 0xd1603d, 0.19],
  ['목성', 0xd8b48a, 0.75], ['토성', 0xe5d29f, 0.64], ['천왕성', 0x9fd8e0, 0.42], ['해왕성', 0x5b7fe0, 0.41],
]
const DEG = Math.PI / 180

// 적경·적위(°) → 황도 좌표 단위 벡터
function eqToEcl(ra, dec) {
  const e = 23.4393 * DEG, a = ra * DEG, d = dec * DEG
  const x = Math.cos(d) * Math.cos(a), y = Math.cos(d) * Math.sin(a), z = Math.sin(d)
  return [x, y * Math.cos(e) + z * Math.sin(e), -y * Math.sin(e) + z * Math.cos(e)]
}
// 보이저: 2026년 말 근사 (방향은 거의 고정, 거리는 1년에 약 3.6 / 3.2 AU씩 늘어남)
const VOY = [
  { name: '보이저 1호', ra: 257.6, dec: 12.1, au0: 167.5, rate: 3.57, note: '1977년 발사 · 2012년 태양권계면 통과 · 가장 멀리 간 인공물' },
  { name: '보이저 2호', ra: 299.9, dec: -59.3, au0: 140.0, rate: 3.2, note: '1977년 발사 · 천왕성·해왕성을 지나간 유일한 탐사선 · 2018년 태양권계면 통과' },
]

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

export function openSolar3D(host, { date = new Date(), onClose } = {}) {
  const S = makeShell(host, 'solar', onClose)
  const { scene, st } = S
  S.renderer.setClearColor(0x000000, 1)
  const toV = (p) => new THREE.Vector3(p[0] * U, p[2] * U, -p[1] * U)

  // 배경 별
  {
    const r = rng(9), pos = []
    for (let i = 0; i < 3000; i++) { const u = r() * 2 - 1, t = r() * Math.PI * 2, q = Math.sqrt(1 - u * u); pos.push(q * Math.cos(t) * 2e4, u * 2e4, q * Math.sin(t) * 2e4) }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fb4c8, size: 1.3, sizeAttenuation: false })))
  }
  // 태양
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.1, 32, 20), new THREE.MeshBasicMaterial({ color: 0xffe2a0 }))
  scene.add(sun)
  const sg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,210,130'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  sg.scale.setScalar(7); scene.add(sg)
  S.addLabel(sun, '태양', '#ffd27a').rad = 1.1
  scene.add(new THREE.AmbientLight(0xffffff, 0.12))
  scene.add(new THREE.PointLight(0xffffff, 3, 0, 0))

  // 행성·궤도
  const orbitMat = new THREE.LineBasicMaterial({ color: 0x2c6a48, transparent: true, opacity: 0.7 })
  const bodies = []
  for (const [nm, col, r] of PL) {
    const pts = orbitPoints(nm, date, 240).map(toV)
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), orbitMat))
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshStandardMaterial({ color: col, roughness: 1, emissive: col, emissiveIntensity: 0.12 }))
    scene.add(mesh)
    if (nm === '토성') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.25, r * 2.25, 48), new THREE.MeshBasicMaterial({ color: 0xd8c48f, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }))
      ring.rotation.x = -Math.PI / 2 + 0.47; mesh.add(ring)
    }
    const lab = S.addLabel(mesh, nm, '#cfe8ff'); lab.rad = r
    bodies.push({ nm, mesh, r })
  }
  // 명왕성 (궤도는 248년치 점)
  {
    const pts = []; for (let i = 0; i <= 240; i++) pts.push(toV(plutoHelio3(new Date(date.getTime() + (i / 240) * 248 * 365.25 * DAY))))
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x5a5a7a, transparent: true, opacity: 0.6 })))
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: 0xc9b9a0 }))
    scene.add(mesh); S.addLabel(mesh, '명왕성', '#c9b9a0').rad = 0.12
    bodies.push({ nm: '명왕성', mesh, r: 0.12, pluto: true })
  }
  // 소행성대(2.1~3.3 AU) · 카이퍼 벨트(30~50 AU) — 분포 모형
  const belt = (n, a0, a1, thick, col, size, seed) => {
    const r = rng(seed), pos = []
    for (let i = 0; i < n; i++) { const a = (a0 + (a1 - a0) * Math.sqrt(r())) * U, t = r() * Math.PI * 2; pos.push(a * Math.cos(t), (r() - 0.5) * 2 * thick * a, a * Math.sin(t)) }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: col, size, sizeAttenuation: false, transparent: true, opacity: 0.7 })))
  }
  belt(4000, 2.1, 3.3, 0.06, 0x9a8f7a, 1.4, 1)
  belt(5000, 30, 50, 0.08, 0x7a8fb0, 1.4, 2)
  { const o = new THREE.Object3D(); o.position.set(2.7 * U * 0.7, 0, -2.7 * U * 0.7); S.addLabel(o, '소행성대', '#b8ab90') }
  { const o = new THREE.Object3D(); o.position.set(-40 * U * 0.7, 0, 40 * U * 0.7); S.addLabel(o, '카이퍼 벨트', '#9fb4d8') }
  let helio = null
  // 태양권계면 (약 120 AU) — 태양풍이 끝나는 경계
  {
    const g = new THREE.SphereGeometry(120 * U, 48, 24)
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x3dff8f, wireframe: true, transparent: true, opacity: 0.05 }))
    scene.add(m); helio = m
    const o = new THREE.Object3D(); o.position.set(0, 120 * U * 0.72, 120 * U * 0.69); S.addLabel(o, '태양권계면 (약 120 AU)', '#3dff8f')
  }
  // 보이저
  const yrs = (date.getTime() - Date.UTC(2026, 10, 15)) / (365.25 * DAY)
  for (const v of VOY) {
    const au = v.au0 + v.rate * yrs, d = eqToEcl(v.ra, v.dec)
    const P = toV([d[0] * au, d[1] * au, d[2] * au])
    const m = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    m.position.copy(P); scene.add(m)
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), P]), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 20, gapSize: 20, transparent: true, opacity: 0.3 })).computeLineDistances())
    S.addLabel(m, `${v.name} · ${Math.round(au)} AU (빛으로 ${(au * 8.317 / 60).toFixed(1)}시간)`, '#ffffff').rad = 2.2
  }

  // 날짜·시간 흐름
  let t = date.getTime(), rate = 0 // 하루/초
  const place = () => {
    const pp = planetPositions(new Date(t))
    for (const b of bodies) b.mesh.position.copy(toV(b.pluto ? plutoHelio3(new Date(t)) : pp[b.nm].pos))
  }
  place()
  const fmtD = (x) => { const d = new Date(x); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}` }
  const views = [
    S.button('안쪽 행성', () => { st.goalT = () => new THREE.Vector3(); st.goalD = 60; st.pitch = 0.75; on(0) }),
    S.button('행성 전체', () => { st.goalT = () => new THREE.Vector3(); st.goalD = 750; st.pitch = 0.6; on(1) }),
    S.button('보이저까지', () => { st.goalT = () => new THREE.Vector3(); st.goalD = 4200; st.pitch = 0.5; on(2) }),
  ]
  const on = (k) => views.forEach((b, i) => b.classList.toggle('on', i === k))
  on(0)
  const bPlay = S.button('시간 흐르기', () => { rate = rate ? 0 : 10; bPlay.classList.toggle('on', !!rate) })
  S.button('오늘', () => { t = Date.now(); place() })

  S.info('태양계 3D', `${fmtD(t)} 실제 위치 · 행성을 탭하면 가까이`, [
    '궤도·위치는 실제 값, 행성 크기만 수천 배 키움 (실제 비율이면 점보다 작음)',
    '소행성대·카이퍼 벨트는 분포 모형 · 보이저는 2026년 말 위치 근사',
    '「시간 흐르기」: 1초에 10일 — 안쪽 행성이 빨리 도는 걸 볼 수 있어요',
  ])
  st.dist = 60; st.pitch = 0.75; st.yaw = 0.4; st.minD = 1.5; st.maxD = 6000

  // 행성 탭 → 그 행성 3D
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
  let sub = null
  S.loop((dt) => {
    if (rate) { t += dt * rate * DAY; place() }
    if (st.tap) {
      const [W, H] = S.size()
      const tp = st.tap; st.tap = null
      ndc.set((tp[0] / W) * 2 - 1, -(tp[1] / H) * 2 + 1); ray.setFromCamera(ndc, S.camera)
      // 화면에서 가까운 행성(점 크기가 작아서 반경 28px 안이면 선택)
      let best = null, bd = 28
      for (const b of bodies) {
        const p = b.mesh.position.clone().project(S.camera)
        if (p.z > 1) continue
        const d = Math.hypot((p.x * 0.5 + 0.5) * W - tp[0], (-p.y * 0.5 + 0.5) * H - tp[1])
        if (d < bd) { bd = d; best = b }
      }
      if (best && !best.pluto && !sub) sub = openPlanet3D(S.root, { name: best.nm, date: new Date(t), onClose: () => { sub = null } })
      else if (best) { st.goalT = () => best.mesh.position.clone(); st.goalD = 6 }
    }
    // 태양권계면 그물은 멀리서만 (가까이선 화면을 가로지르는 선이 됨)
    helio.visible = st.dist > 1800; helio.material.opacity = 0.05 * Math.min(1, (st.dist - 1800) / 1500)
    if (!sub) S.updateCamera(dt)
    S.root.querySelector('.cu-note').textContent = `${fmtD(t)}${rate ? ' · 1초에 10일' : ''} · 드래그로 돌리기 · 핀치/휠 확대 · 행성 탭`
  })
  return S
}
