// 태양계 행성 가까이 보기 — 실제 지도 텍스처(Solar System Scope, CC BY 4.0 / NASA 자료 기반)
// 자전축 기울기·자전 주기는 실제 값, 위성은 오늘(시뮬레이션 날짜) 위치와 실제 거리 비율
import * as THREE from 'three'
import { makeShell } from './closeup.js'
import { moonStates } from './moons.js'
import mercuryUrl from './planets/mercury.webp?url'
import venusUrl from './planets/venus.webp?url'
import earthUrl from './earth-day-2k.webp?url'
import marsUrl from './planets/mars.webp?url'
import jupiterUrl from './planets/jupiter.webp?url'
import saturnUrl from './planets/saturn.webp?url'
import uranusUrl from './planets/uranus.webp?url'
import neptuneUrl from './planets/neptune.webp?url'
import moonUrl from './moon-map.webp?url'

const TEX = { 수성: mercuryUrl, 금성: venusUrl, 지구: earthUrl, 화성: marsUrl, 목성: jupiterUrl, 토성: saturnUrl, 천왕성: uranusUrl, 해왕성: neptuneUrl, 달: moonUrl }

// tilt: 자전축 기울기(°), rot: 자전 주기(시간, 음수=거꾸로), atm: [색, 세기]
const P = {
  수성: { tilt: 0.03, rot: 1407.6, atm: null, km: 4879, g: 0.38, facts: ['하루(해 뜨고 다음 해 뜰 때까지)가 176일 — 1년(88일)의 두 배', '낮 430°C · 밤 -180°C (공기가 없어 열을 못 붙잡음)', '극지방 그늘진 분화구 속에 얼음'] },
  금성: { tilt: 177.4, rot: -5832.5, atm: [0xffd27a, 1.0], km: 12104, g: 0.9, facts: ['두꺼운 황산 구름 — 보이는 건 구름 꼭대기', '표면 465°C · 92기압 (바닷속 900m 압력)', '거꾸로 자전 · 하루가 1년보다 김'] },
  지구: { tilt: 23.44, rot: 23.934, atm: [0x6fa8ff, 0.9], km: 12742, g: 1, facts: ['자전축 23.4° 기울어 계절이 생김', '표면의 71%가 바다', '알려진 유일한 생명의 행성'] },
  화성: { tilt: 25.19, rot: 24.623, atm: [0xffa070, 0.45], km: 6779, g: 0.38, facts: ['올림푸스 화산 높이 약 22km (에베레스트의 2.5배)', '마리네리스 협곡 길이 약 4,000km', '평균 -63°C · 기압은 지구의 0.6%'] },
  목성: { tilt: 3.13, rot: 9.925, atm: [0xffe0b0, 0.6], km: 142984, g: 2.53, facts: ['대적점: 지구보다 큰 폭풍, 350년 넘게 관측', '하루 약 10시간 — 가장 빨리 도는 행성', '지구 1,300개가 들어가는 크기'] },
  토성: { tilt: 26.73, rot: 10.656, atm: [0xffe7b0, 0.5], km: 120536, g: 1.07, rings: [1.239, 2.27], facts: ['고리 지름 약 27만km · 두께는 대부분 10~100m', '평균 밀도가 물보다 낮음', '북극에 육각형 구름 띠'] },
  천왕성: { tilt: 97.77, rot: -17.24, atm: [0x9fe7f0, 0.7], km: 51118, g: 0.89, rings: [1.64, 2.0], faint: true, facts: ['자전축이 98° 누워 옆으로 굴러가듯 공전', '극지방은 42년 낮 · 42년 밤', '구름 꼭대기 -224°C (가장 추운 대기)'] },
  해왕성: { tilt: 28.32, rot: 16.11, atm: [0x6f8fff, 0.75], km: 49528, g: 1.14, facts: ['태양계에서 가장 센 바람 · 시속 약 2,100km', '수학 계산으로 먼저 예측하고 찾은 행성(1846)', '트리톤은 거꾸로 도는 큰 위성'] },
  달: { tilt: 6.68, rot: 655.7, atm: null, km: 3474, g: 0.17, facts: ['늘 같은 면만 지구를 봄(조석 고정)', '1년에 약 3.8cm씩 지구에서 멀어짐', '아폴로 12명이 걸었던 유일한 다른 천체'] },
}

const ATM_FRAG = `
uniform vec3 uCol; uniform float uK; uniform vec3 uSun;
varying vec3 vN; varying vec3 vW;
void main(){
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.6);
  float lit = 0.25 + 0.75 * smoothstep(-0.25, 0.4, dot(normalize(vN), uSun));
  gl_FragColor = vec4(uCol * rim * uK * lit, rim * uK);
}`
const ATM_VERT = `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`

// 토성 고리: 실제 고리 구조(C·B·카시니 간극·A·엥케 간극) 반지름 비율로 만든 띠 텍스처
function ringTexture(name, inner, outer) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 4
  const g = c.getContext('2d')
  for (let x = 0; x < 1024; x++) {
    const r = inner + ((outer - inner) * x) / 1023
    let a = 0, col = [210, 190, 150]
    if (name === '토성') {
      if (r < 1.525) a = 0.18 + 0.1 * Math.sin(r * 300)        // C 고리 (흐림)
      else if (r < 1.95) { a = 0.75 + 0.2 * Math.sin(r * 180); col = [228, 210, 170] } // B 고리 (가장 밝음)
      else if (r < 2.025) a = 0.05                              // 카시니 간극
      else if (r > 2.21 && r < 2.217) a = 0.05                  // 엥케 간극
      else a = 0.5 + 0.12 * Math.sin(r * 220)                   // A 고리
    } else {
      a = [1.64, 1.67, 1.7, 1.76, 1.79, 1.84, 2.0].some((q) => Math.abs(r - q) < 0.006) ? 0.6 : 0.02
      col = [170, 200, 210]
    }
    g.fillStyle = `rgba(${col.join(',')},${Math.max(0, Math.min(1, a))})`; g.fillRect(x, 0, 1, 4)
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function openPlanet3D(host, { name, date = new Date(), onClose } = {}) {
  const D = P[name]
  if (!D) return null
  const S = makeShell(host, 'planet', onClose)
  const { scene, st } = S
  S.renderer.setClearColor(0x000000, 1)
  const sunDir = new THREE.Vector3(1, 0.12, -0.25).normalize() // 옆에서 비춰 낮·밤 경계가 보이게
  scene.add(new THREE.AmbientLight(0xffffff, 0.06))
  const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.copy(sunDir).multiplyScalar(50); scene.add(sun)

  // 자전축 기울인 틀 (위성·고리도 적도면을 따름)
  const frame = new THREE.Group(); frame.rotation.z = (-D.tilt * Math.PI) / 180; scene.add(frame)
  const tex = new THREE.TextureLoader().load(TEX[name]); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }))
  frame.add(body)
  if (D.atm) {
    const am = new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Color(D.atm[0]) }, uK: { value: D.atm[1] }, uSun: { value: sunDir } }, vertexShader: ATM_VERT, fragmentShader: ATM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide })
    frame.add(new THREE.Mesh(new THREE.SphereGeometry(1.025, 64, 48), am))
  }
  if (D.rings) {
    const [ri, ro] = D.rings
    const g = new THREE.RingGeometry(ri, ro, 256, 1)
    const pos = g.attributes.position, uv = g.attributes.uv
    for (let i = 0; i < pos.count; i++) { const r = Math.hypot(pos.getX(i), pos.getY(i)); uv.setXY(i, (r - ri) / (ro - ri), 0.5) }
    const ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: ringTexture(name, ri, ro), transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: D.faint ? 0.7 : 1 }))
    ring.rotation.x = -Math.PI / 2; frame.add(ring)
  }

  // 위성: 실제 거리 비율(행성 반지름 단위) · 오늘 위치
  const R = D.km / 2
  const moons = moonStates(name, date)
  let far = 3
  for (const m of moons) {
    const d = m.distKm / R
    far = Math.max(far, d)
    const pts = []; for (let k = 0; k <= 128; k++) { const a = (k / 128) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d)) }
    frame.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x2c6a48, transparent: true, opacity: 0.55 })))
    const mr = Math.max(m.radiusKm / R, 0.004)
    const mm = new THREE.Mesh(new THREE.SphereGeometry(mr, 24, 16), new THREE.MeshStandardMaterial({ color: new THREE.Color(m.color || '#bbbbbb'), roughness: 1 }))
    mm.position.set(Math.cos(m.angle) * d, 0, Math.sin(m.angle) * d)
    frame.add(mm)
    const lab = S.addLabel(mm, m.name, '#cfe8ff'); lab.rad = mr
  }

  const fmt = (n) => n.toLocaleString('ko-KR')
  const day = Math.abs(D.rot) < 48 ? `${Math.abs(D.rot).toFixed(1)}시간` : `${(Math.abs(D.rot) / 24).toFixed(1)}일`
  S.info(name, `지름 ${fmt(D.km)} km · 중력 ${D.g}g · 자전 ${day}${D.rot < 0 ? ' (거꾸로)' : ''} · 자전축 ${D.tilt}°`, [
    ...D.facts,
    moons.length ? `위성 ${moons.length}개 표시 — 오늘 위치, 거리·크기 실제 비율` : '',
  ].filter(Boolean))
  S.root.querySelector('.cu-note').textContent = '드래그로 돌리기 · 핀치/휠로 확대 · 자전은 1초에 1시간'

  const home = D.rings ? 7.2 : 6.2
  st.dist = home; st.minD = 1.08; st.maxD = Math.max(12, far * 3); st.pitch = 0.25; st.yaw = 0.8
  const views = [
    S.button('행성', () => { st.goalD = home; st.pitch = 0.25; on(0) }),
    S.button('표면 가까이', () => { st.goalD = 1.35; st.pitch = 0.1; on(1) }),
  ]
  if (moons.length) views.push(S.button('위성까지', () => { st.goalD = far * 2.4; st.pitch = 0.55; on(2) }))
  const on = (k) => views.forEach((b, i) => b.classList.toggle('on', i === k))
  on(0)

  let spin = 1
  S.button('자전 빠르게', (b) => { spin = spin === 1 ? 20 : 1; (b?.target || b)?.classList?.toggle?.('on', spin > 1) })
  S.loop((dt) => {
    body.rotation.y += (dt * spin * 2 * Math.PI) / D.rot // 1초 = 1시간
    S.updateCamera(dt)
  })
  return S
}
