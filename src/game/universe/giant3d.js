// 거대한 별 가까이 보기 — 실제 크기 비율로 태양·태양계 궤도와 비교
// 크기는 추정치(관측마다 차이 큼): 거리·밝기·온도에서 거꾸로 계산하기 때문
import * as THREE from 'three'
import { makeShell, NOISE, PLANET_VERT, glowTexture } from './closeup.js'

const RSUN_AU = 0.00465047 // 태양 반지름(AU)
const RSUN_KM = 695700
const AU_KM = 149597870.7

export const GIANTS = {
  '스티븐슨 2-18': { R: 2150, T: 3200, kind: '적색 초거성', note: '반지름 추정 약 2,150배 (연구에 따라 훨씬 작게 보기도 함 — 거리·온도 불확실)', where: '방패자리 · 산개성단 스티븐슨 2 안' },
  'UY 방패자리': { R: 909, T: 3365, kind: '적색 초거성', note: '반지름 약 900배 (Gaia 거리로 다시 잰 값, 예전엔 1,700배로 알려짐)', where: '방패자리' },
  '에타 카리나이': { R: 240, T: 25000, kind: '고광도 청색 변광성 쌍성의 주성', note: '두꺼운 별바람과 먼지에 싸여 크기 추정이 어려움 (60~800배까지 여러 값)', where: '용골자리 · 1840년대 대폭발로 남쪽 하늘 두 번째 밝은 별이 됨' },
  '베텔게우스': { R: 760, T: 3600, kind: '적색 초거성', note: '반지름 약 640~760배 · 2019~20년 "대감광"으로 갑자기 어두워졌던 별', where: '오리온자리 왼쪽 어깨' },
}

// 온도 → 대략의 색
function tempRgb(T) {
  const t = T / 100
  let r, g, b
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.1; b = t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305.0 }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.1 * Math.pow(t - 60, -0.0755); b = 255 }
  return [r, g, b].map((v) => Math.max(0, Math.min(255, v)) / 255)
}

// 적색 초거성 표면: 별 지름에 견줄 만큼 거대한 대류 세포 몇 개 + 주연 감광
const GIANT_FRAG = `
uniform vec3 uCol; uniform float uTime; uniform float uCell;
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
${NOISE}
void main(){
  vec3 V = normalize(cameraPosition - vW), N = normalize(vN);
  float mu = max(dot(N, V), 0.0);
  vec3 p = normalize(vObj);
  float big = fbm(p*uCell + vec3(0.0, uTime*0.01, uTime*0.006));
  float fine = fbm(p*uCell*5.0 + vec3(uTime*0.02));
  float k = 0.55 + 0.75*big + 0.18*fine;
  vec3 c = uCol * k * (0.25 + 0.75*pow(mu, 0.6));
  gl_FragColor = vec4(c*1.2, 1.0);
}`

export function openGiant3D(host, { name, ly = null, onClose } = {}) {
  const G = GIANTS[name]
  const S = makeShell(host, 'giant', onClose)
  const { scene, st } = S
  S.renderer.setClearColor(0x000000, 1)
  const R = G.R * RSUN_AU // 반지름(AU) — 장면 단위 1 = 1 AU
  // 눈에 보이는 색: 차가운 별일수록 더 진한 주황·빨강
  const col0 = tempRgb(G.T), deep = G.T < 4500 ? 1 : 0
  const col = [col0[0], col0[1] * (1 - 0.28 * deep), col0[2] * (1 - 0.55 * deep)]
  const mat = new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Vector3(...col) }, uTime: { value: 0 }, uCell: { value: G.T < 5000 ? 2.2 : 6.0 } }, vertexShader: PLANET_VERT, fragmentShader: GIANT_FRAG })
  const star = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), mat)
  scene.add(star)
  const rgbStr = col.map((v) => Math.round(v * 255)).join(',')
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(rgbStr), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }))
  glow.scale.setScalar(R * 4.2); scene.add(glow)

  // 태양계 궤도를 별 중심에 겹쳐 보기 (태양 자리에 이 별을 두면?)
  const orbitGrp = new THREE.Group(); scene.add(orbitGrp)
  const ORB = [['수성', 0.387], ['금성', 0.723], ['지구', 1], ['화성', 1.524], ['목성', 5.203], ['토성', 9.537], ['천왕성', 19.19], ['해왕성', 30.07]]
  let swallowed = []
  for (const [nm, a] of ORB) {
    const inside = a < R
    if (inside) swallowed.push(nm)
    const pts = []; for (let k = 0; k <= 160; k++) { const t = (k / 160) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(t) * a, 0, Math.sin(t) * a)) }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: inside ? 0xff6a6a : 0x3dff8f, transparent: true, opacity: inside ? 0.9 : 0.6, depthTest: !inside }))
    orbitGrp.add(line)
    const o = new THREE.Object3D(); o.position.set(a, 0, 0); orbitGrp.add(o)
    S.addLabel(o, inside ? `${nm} 궤도 (별 속)` : `${nm} 궤도`, inside ? '#ff9a9a' : '#9fffc8').rad = 0.02
  }
  // 태양 (같은 비율) — 옆에 놓으면 점 하나
  const sunR = RSUN_AU
  const sun = new THREE.Mesh(new THREE.SphereGeometry(sunR, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff1c4 }))
  sun.position.set(R * 1.35, 0, 0); scene.add(sun)
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,235,190'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  sunGlow.scale.setScalar(sunR * 30); sunGlow.position.copy(sun.position); scene.add(sunGlow)
  const sunLab = S.addLabel(sun, '◉ 태양 (같은 비율)', '#ffe7a8'); sunLab.rad = sunR * 3

  const km = G.R * RSUN_KM
  const lightLap = (2 * Math.PI * km) / 299792.458 // 초
  const planeLap = (2 * Math.PI * km) / 900 / 24 / 365.25 // 년
  const vol = G.R ** 3
  const fmtBig = (n) => n >= 1e8 ? `${Math.round(n / 1e8).toLocaleString('ko-KR')}억` : n >= 1e4 ? `${Math.round(n / 1e4).toLocaleString('ko-KR')}만` : Math.round(n).toLocaleString('ko-KR')
  S.info(name, `${G.kind} · ${G.where}${ly ? ` · ${ly.toLocaleString('ko-KR')}광년` : ''}`, [
    `반지름 태양의 약 ${G.R.toLocaleString('ko-KR')}배 = ${(R).toFixed(R < 1 ? 2 : 1)} AU (${fmtBig(km)} km)`,
    `태양 자리에 두면: ${swallowed.length ? swallowed.join('·') + ' 궤도까지 삼킴' : '수성 궤도 안쪽'}`,
    `부피는 태양의 약 ${fmtBig(vol)}배 · 표면 온도 약 ${G.T.toLocaleString('ko-KR')}K`,
    `빛으로 한 바퀴 ${lightLap >= 3600 ? (lightLap / 3600).toFixed(1) + '시간' : Math.round(lightLap / 60) + '분'} · 비행기(시속 900km)로 한 바퀴 약 ${Math.round(planeLap).toLocaleString('ko-KR')}년`,
    G.note,
  ])
  S.root.querySelector('.cu-note').textContent = '드래그로 돌리기 · 핀치/휠로 확대 · 실제 크기 비율'

  const fit = Math.max(R * 5, 70)
  st.dist = fit; st.minD = sunR * 4; st.maxD = 80; st.pitch = 0.45; st.yaw = 0.6
  const views = [
    S.button('태양계와 비교', () => { st.goalT = () => new THREE.Vector3(); st.goalD = fit; st.pitch = 0.75; on(0) }),
    S.button('표면 가까이', () => { st.goalT = () => new THREE.Vector3(); st.goalD = R * 1.6; st.pitch = 0.15; on(1) }),
    S.button('태양 옆으로', () => { st.goalT = () => sun.position.clone(); st.goalD = R * 0.22; st.pitch = 0.08; st.yaw = Math.PI / 2 - 0.35; on(2) }),
  ]
  const on = (k) => views.forEach((b, i) => b.classList.toggle('on', i === k))
  on(0)

  S.loop((dt, t) => {
    mat.uniforms.uTime.value = t / 1000
    star.rotation.y += dt * 0.01
    S.updateCamera(dt)
  })
  return S
}
