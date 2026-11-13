// 3D 동네 — 지금 보고 있는 곳 반경 약 1.2km의 건물을 OpenStreetMap 높이로 세워서 보여줌
// 건물·도로: OpenFreeMap 벡터 타일(OpenMapTiles 스키마) · 그림자: 지금 이 시각의 실제 해 방향
// 땅밑: 서울교통공사 역사심도 자료로 지하철 승강장 깊이를 기둥으로 (땅을 반투명하게, 아래에서 올려다볼 수 있음)
import * as THREE from 'three'
import { makeShell } from './closeup.js'
import { template, decodeTile } from './roads-mvt.js'
import { depthNear } from './ux-subway.js'

const DEG = Math.PI / 180
const RADIUS = 1200 // m

// 해 위치 (고도·방위각) — 간단한 천문 공식, 그림자 방향용으로 충분 (오차 1° 안팎)
function sunAltAz(lat, lon, date) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0
  const g = (357.529 + 0.98560028 * d) * DEG
  const q = 280.459 + 0.98564736 * d
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG
  const e = (23.439 - 0.00000036 * d) * DEG
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L))
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24) * 15 * DEG
  const H = gmst + lon * DEG - ra, la = lat * DEG
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H))
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(H))
  return { alt, az }
}

const lon2x = (lon, n) => ((lon + 180) / 360) * n
const lat2y = (lat, n) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * n

export function openCity3D(host, { lat, lon, my = null, date = new Date(), onClose } = {}) {
  const S = makeShell(host, 'city', onClose)
  const { scene, st, renderer } = S
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const cosL = Math.cos(lat * DEG)
  const toXZ = (la, lo) => [(lo - lon) * 111320 * cosL, -(la - lat) * 110574]

  // 하늘·빛: 실제 해 방향
  const sun = sunAltAz(lat, lon, date)
  const day = sun.alt > -0.02
  const sunV = new THREE.Vector3(Math.cos(sun.alt) * Math.sin(sun.az), Math.sin(sun.alt), -Math.cos(sun.alt) * Math.cos(sun.az))
  renderer.setClearColor(day ? new THREE.Color().setHSL(0.58, 0.45, 0.06 + 0.12 * Math.max(0, Math.sin(sun.alt))) : 0x02040a, 1)
  scene.fog = new THREE.Fog(day ? 0x0b1a26 : 0x02040a, 1800, 4200)
  scene.add(new THREE.HemisphereLight(day ? 0x9fc4ff : 0x223355, 0x0a1a10, day ? 0.9 : 0.35))
  const light = new THREE.DirectionalLight(day ? 0xfff1d6 : 0x6677aa, day ? 2.4 : 0.35)
  const lp = (day ? sunV : new THREE.Vector3(0.3, 0.8, 0.4)).clone().normalize()
  if (day && lp.y < 0.08) lp.y = 0.08 // 해 질 녘 아주 긴 그림자 방지
  light.position.copy(lp.normalize().multiplyScalar(2500))
  light.castShadow = true
  light.shadow.mapSize.set(2048, 2048)
  Object.assign(light.shadow.camera, { left: -1400, right: 1400, top: 1400, bottom: -1400, near: 10, far: 6000 })
  light.shadow.bias = -0.0004
  scene.add(light)

  // 땅 (반투명 — 아래로 내려가면 지하철 깊이가 보임)
  const ground = new THREE.Mesh(new THREE.CircleGeometry(RADIUS * 1.15, 96), new THREE.MeshStandardMaterial({ color: day ? 0x10241a : 0x050c08, roughness: 1, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false }))
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground)
  const grid = new THREE.PolarGridHelper(RADIUS * 1.15, 8, 6, 64, 0x1c5a35, 0x123a24); grid.position.y = 0.3; grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid)

  S.info('3D 동네', '불러오는 중…', [])
  S.root.querySelector('.cu-note').textContent = '드래그로 돌리기 · 핀치/휠로 확대 · 건물 탭하면 높이 · 아래로 기울이면 땅밑'
  st.dist = 1700; st.minD = 40; st.maxD = 4200; st.pitch = 0.62; st.yaw = 0.5

  const bView = [
    S.button('위에서', () => { st.goalD = 1700; st.pitch = 0.62; on(0) }),
    S.button('가까이', () => { st.goalD = 380; st.pitch = 0.32; on(1) }),
    S.button('땅밑', () => { st.goalD = 900; st.pitch = -0.35; on(2) }),
  ]
  const on = (k) => bView.forEach((b, i) => b.classList.toggle('on', i === k))
  on(0)

  // 내 위치 핀
  if (my) {
    const [mx, mz] = toXZ(my.lat, my.lon)
    if (Math.hypot(mx, mz) < RADIUS) {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 80, 12), new THREE.MeshBasicMaterial({ color: 0xff5d73 }))
      pin.position.set(mx, 40, mz); scene.add(pin)
      const o = new THREE.Object3D(); o.position.set(mx, 84, mz); S.addLabel(o, '◉ 내 위치', '#ff8d9c')
    }
  }

  const buildings = [] // 탭 정보: { t0, t1, h, levels, name }
  let mesh = null, dead = false
  S.disposers.push(() => { dead = true })

  ;(async () => {
    let n0 = 0, est = 0
    try {
      const url = await template()
      const z = 14, n = 2 ** z
      const dLat = RADIUS / 110574, dLon = RADIUS / (111320 * cosL)
      const x0 = Math.floor(lon2x(lon - dLon, n)), x1 = Math.floor(lon2x(lon + dLon, n))
      const y0 = Math.floor(lat2y(lat + dLat, n)), y1 = Math.floor(lat2y(lat - dLat, n))
      const jobs = []
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y])
      const tiles = await Promise.all(jobs.map(async ([x, y]) => {
        try {
          const r = await fetch(url.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal: AbortSignal.timeout(20000) })
          if (!r.ok) return null
          return { x, y, L: decodeTile(await r.arrayBuffer(), new Set(['building', 'transportation'])) }
        } catch { return null }
      }))
      if (dead) return
      const pos = [], col = [], roofLines = [], roadLines = []
      const cTall = new THREE.Color(0x35d88a), cLow = new THREE.Color(day ? 0x7f93a8 : 0x1d2a38), c = new THREE.Color()
      const tileLL = (x, y, px, py, ext) => {
        const lo = ((x + px / ext) / n) * 360 - 180
        const yy = (y + py / ext) / n
        const la = (Math.atan(Math.sinh(Math.PI * (1 - 2 * yy))) * 180) / Math.PI
        return toXZ(la, lo)
      }
      for (const t of tiles) {
        if (!t) continue
        // 건물
        for (const f of t.L.building || []) {
          if (f.type !== 3 || f.props.hide_3d) continue
          const h = Math.max(2, +f.props.render_height || 5), h0 = Math.max(0, +f.props.render_min_height || 0)
          if (!f.props.render_height) est++
          // 링 → 미터 좌표, 바깥 링(면적 +)마다 새 건물
          const polys = []
          for (const r of f.rings) {
            const pts = []
            for (let k = 0; k < r.length; k += 2) pts.push(tileLL(t.x, t.y, r[k], r[k + 1], f.extent))
            if (pts.length < 3) continue
            let area = 0
            for (let k = 0; k < r.length; k += 2) { const k2 = (k + 2) % r.length; area += r[k] * r[k2 + 1] - r[k2] * r[k + 1] }
            if (area > 0 || !polys.length) polys.push({ outer: pts, holes: [] })
            else polys[polys.length - 1].holes.push(pts)
          }
          for (const P of polys) {
            const [cx, cz] = P.outer[0]
            if (Math.hypot(cx, cz) > RADIUS) continue
            const t0 = pos.length / 9
            const tc = Math.min(1, Math.pow(h / 150, 0.8))
            c.copy(cLow).lerp(cTall, tc)
            const push = (ax, ay, az) => { pos.push(ax, ay, az); col.push(c.r, c.g, c.b) }
            // 벽
            for (const ring of [P.outer, ...P.holes]) {
              for (let k = 0; k < ring.length; k++) {
                const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length]
                push(ax, h0, az); push(bx, h0, bz); push(bx, h, bz)
                push(ax, h0, az); push(bx, h, bz); push(ax, h, az)
                roofLines.push(ax, h, az, bx, h, bz)
              }
            }
            // 지붕
            try {
              const o2 = P.outer.map(([x, z2]) => new THREE.Vector2(x, z2)), h2 = P.holes.map((hh) => hh.map(([x, z2]) => new THREE.Vector2(x, z2)))
              const tris = THREE.ShapeUtils.triangulateShape(o2, h2)
              const all = o2.concat(...h2)
              const rc = c.clone().multiplyScalar(1.15)
              for (const [a, b, d] of tris) for (const v of [a, b, d]) { pos.push(all[v].x, h, all[v].y); col.push(rc.r, rc.g, rc.b) }
            } catch { /* 이상한 도형은 지붕 생략 */ }
            buildings.push({ t0, t1: pos.length / 9, h, levels: f.props.render_height ? null : null, cx, cz })
            n0++
          }
        }
        // 도로 (땅 위 네온 선)
        for (const f of t.L.transportation || []) {
          if (f.type !== 2 || !/^(motorway|trunk|primary|secondary|tertiary|minor)$/.test(f.props.class || '')) continue
          for (const r of f.rings) {
            for (let k = 0; k + 3 < r.length; k += 2) {
              const [ax, az] = tileLL(t.x, t.y, r[k], r[k + 1], f.extent), [bx, bz] = tileLL(t.x, t.y, r[k + 2], r[k + 3], f.extent)
              if (Math.hypot(ax, az) > RADIUS * 1.1) continue
              roadLines.push(ax, 0.6, az, bx, 0.6, bz)
            }
          }
        }
      }
      if (!pos.length && !roadLines.length) throw new Error('empty')
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
      g.computeVertexNormals()
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1, side: THREE.DoubleSide, emissive: day ? 0x000000 : 0x0b2a1a }))
      mesh.castShadow = true; mesh.receiveShadow = true
      scene.add(mesh)
      const rl = new THREE.BufferGeometry(); rl.setAttribute('position', new THREE.Float32BufferAttribute(roofLines, 3))
      scene.add(new THREE.LineSegments(rl, new THREE.LineBasicMaterial({ color: 0x3dff8f, transparent: true, opacity: day ? 0.35 : 0.7 })))
      const rd = new THREE.BufferGeometry(); rd.setAttribute('position', new THREE.Float32BufferAttribute(roadLines, 3))
      scene.add(new THREE.LineSegments(rd, new THREE.LineBasicMaterial({ color: day ? 0x9effc8 : 0xffc070, transparent: true, opacity: 0.75 })))
    } catch {
      if (!dead) S.info('3D 동네', '건물 자료를 불러오지 못했어요 (지도 서버 응답 없음)', ['잠시 뒤 닫았다가 다시 열어 보세요'])
      return
    }
    // 땅밑: 지하철 승강장 깊이
    let nSt = 0
    try {
      const sts = await depthNear(lat, lon, RADIUS)
      if (dead) return
      const mat = new THREE.MeshBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.85 })
      for (const stn of sts) {
        if (!stn.depths.length) continue
        const [sx, sz] = toXZ(stn.lat, stn.lon)
        const dep = Math.max(...stn.depths.map((d) => Math.max(0, d.dep - 1.1)))
        if (dep < 1) continue
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, dep, 16, 1, true), mat)
        shaft.position.set(sx, -dep / 2, sz); scene.add(shaft)
        const plat = new THREE.Mesh(new THREE.BoxGeometry(160, 3, 18), mat)
        plat.position.set(sx, -dep, sz); scene.add(plat)
        const o = new THREE.Object3D(); o.position.set(sx, -dep - 6, sz)
        S.addLabel(o, `${stn.name} 승강장 지하 ${Math.round(dep)}m`, '#d9c2ff')
        nSt++
      }
    } catch { /* */ }
    S.info('3D 동네', `반경 ${(RADIUS / 1000).toFixed(1)}km · 건물 ${n0.toLocaleString('ko-KR')}동 · 그림자는 지금 해 방향 (${day ? `해 고도 ${Math.round(sun.alt / DEG)}°` : '밤'})`, [
      '높이: OpenStreetMap 높이·층수 기록, 기록이 없으면 5m로 추정',
      est ? `높이 기록 없는 건물이 많으면 낮게 보여요 (이 동네 추정 ${Math.round((est / Math.max(1, n0)) * 100)}% 안팎)` : '',
      nSt ? `땅밑: 지하철역 ${nSt}곳 승강장 깊이 (서울교통공사 자료)` : '',
    ].filter(Boolean))
  })()

  // 건물 탭 → 높이
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
  let picked = null
  const pickMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false })
  S.loop((dt) => {
    if (st.tap && mesh) {
      const [W, H] = S.size()
      ndc.set((st.tap[0] / W) * 2 - 1, -(st.tap[1] / H) * 2 + 1)
      ray.setFromCamera(ndc, S.camera)
      const hit = ray.intersectObject(mesh, false)[0]
      if (picked) { scene.remove(picked); picked.geometry.dispose(); picked = null }
      if (hit) {
        const b = buildings.find((bb) => hit.faceIndex >= bb.t0 && hit.faceIndex < bb.t1)
        if (b) {
          const g = new THREE.BufferGeometry()
          g.setAttribute('position', new THREE.Float32BufferAttribute(mesh.geometry.attributes.position.array.slice(b.t0 * 9, b.t1 * 9), 3))
          picked = new THREE.Mesh(g, pickMat); scene.add(picked)
          const fl = Math.max(1, Math.round(b.h / 3.3))
          S.root.querySelector('.cu-note').textContent = `이 건물 높이 약 ${Math.round(b.h)}m (약 ${fl}층) · 다른 건물 탭`
          st.goalT = (() => { const v = new THREE.Vector3(b.cx, 0, b.cz); return () => v })()
        }
      }
      st.tap = null
    }
    S.updateCamera(dt)
  })
  return S
}
