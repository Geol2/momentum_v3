// 관측 가능한 우주 전체 — 실측(2MRS, 약 15억 광년 안) 바깥을 모형 코스믹 웹으로 채우고, 맨 끝에 우주배경복사(CMB)
// 거리는 모두 "지금 거리(공변 거리)". 우주론: Planck 2018 (H0 67.66, Ωm 0.311, ΩΛ 0.689, Ωr 9.1e-5)
import * as THREE from 'three'

const C_H0_LY = (299792.458 / 67.66) * 3.26156e6 // c/H0 (광년) ≈ 144.5억
const OM = 0.3111, OL = 0.6889, OR = 9.1e-5
const E = (z) => Math.sqrt(OR * (1 + z) ** 4 + OM * (1 + z) ** 3 + OL)
const H0_YR = 1 / (67.66 / 3.0857e19 * 3.15576e7) // 1/H0 (년)

// 적색편이 z → 지금 거리 D(광년)·빛이 출발한 때(몇 년 전) 표
const TBL = (() => {
  const zs = [0], D = [0], T = [0]
  let z = 0, d = 0, t = 0
  while (z < 1200) {
    const dz = Math.max(1e-4, z * 0.004)
    const zm = z + dz / 2
    d += (dz / E(zm)) * C_H0_LY
    t += (dz / ((1 + zm) * E(zm))) * H0_YR
    z += dz
    zs.push(z); D.push(d); T.push(t)
  }
  return { zs, D, T }
})()
export function atDistance(ly) {
  const { zs, D, T } = TBL
  let lo = 0, hi = D.length - 1
  if (ly >= D[hi]) return { z: zs[hi], t: T[hi] }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (D[m] < ly) lo = m; else hi = m }
  const f = (ly - D[lo]) / (D[hi] - D[lo] || 1)
  return { z: zs[lo] + (zs[hi] - zs[lo]) * f, t: T[lo] + (T[hi] - T[lo]) * f }
}
export function distanceAtZ(z) {
  const { zs, D } = TBL
  let lo = 0, hi = zs.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (zs[m] < z) lo = m; else hi = m }
  return D[lo] + (D[hi] - D[lo]) * ((z - zs[lo]) / (zs[hi] - zs[lo] || 1))
}
export function distanceAtLookback(yr) {
  const { T, D } = TBL
  let lo = 0, hi = T.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] < yr) lo = m; else hi = m }
  return D[lo] + (D[hi] - D[lo]) * ((yr - T[lo]) / (T[hi] - T[lo] || 1))
}
export const R_CMB = distanceAtZ(1090)      // 우주배경복사 (지금 거리 약 457억 광년)
export const R_FIRST = distanceAtZ(15)      // 첫 은하들 (z≈15, 약 340억 광년)

const fmtG = (ly) => (ly >= 1e9 ? `${(ly / 1e9).toFixed(ly >= 1e10 ? 0 : 1)}0억`.replace(/\.(\d)0억/, '.$1') : `${Math.round(ly / 1e8)}억`)
export const fmtYi = (ly) => { const e = ly / 1e8; return e >= 100 ? `${Math.round(e).toLocaleString('ko-KR')}억` : `${e.toFixed(e < 10 ? 1 : 0)}억` }
void fmtG

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

// 모형 코스믹 웹: 은하단(마디)을 공간에 흩고, 가까운 마디끼리 필라멘트로 이음 (보이드는 저절로 생김)
// 실제 구조 하나(수억 광년)를 이 화면에서 다 그릴 수 없어서, 마디 간격을 크게 잡은 "모양 흉내"임
export function buildWeb(PointBuf, sun, { rIn = 1.5e9, rOut = R_FIRST, nodes = 9000, seed = 20261113 } = {}) {
  const r = rng(seed)
  const P = []
  for (let i = 0; i < nodes; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, q = Math.sqrt(1 - u * u)
    const rad = Math.cbrt(rIn ** 3 + r() * (rOut ** 3 - rIn ** 3))
    P.push([rad * q * Math.cos(th), rad * q * Math.sin(th), rad * u, 0.4 + r() * 1.6])
  }
  // 격자로 가까운 마디 찾기
  const cell = (rOut * 2) / 28, key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`
  const grid = new Map()
  P.forEach((p, i) => { const k = key(p[0], p[1], p[2]); (grid.get(k) || grid.set(k, []).get(k)).push(i) })
  const near = (i, k) => {
    const [x, y, z] = P[i], cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell)
    const c = []
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
      for (const j of grid.get(`${cx + a},${cy + b},${cz + d}`) || []) if (j !== i) c.push([j, (P[j][0] - x) ** 2 + (P[j][1] - y) ** 2 + (P[j][2] - z) ** 2])
    }
    return c.sort((m, n) => m[1] - n[1]).slice(0, k).map((m) => m[0])
  }
  const buf = new PointBuf()
  const col = (rad) => {
    // 가까운 쪽 따뜻한 흰색 → 먼(과거) 쪽 젊고 푸른 은하
    const f = Math.min(1, (rad - rIn) / (rOut - rIn))
    return [0.95 - 0.4 * f, 0.88 - 0.25 * f, 0.72 + 0.28 * f, 1 - 0.55 * f]
  }
  const add = (x, y, z, s) => { const rad = Math.hypot(x, y, z), [cr, cg, cb, k] = col(rad); buf.add(sun[0] + x, sun[1] + y, sun[2] + z, cr * k, cg * k, cb * k, s) }
  const done = new Set()
  for (let i = 0; i < P.length; i++) {
    const [x, y, z, w] = P[i]
    // 은하단: 마디 둘레 뭉친 점
    for (let k = 0; k < 5; k++) add(x + (r() - 0.5) * 1.2e8 * w, y + (r() - 0.5) * 1.2e8 * w, z + (r() - 0.5) * 1.2e8 * w, 3e8 * w)
    for (const j of near(i, 3)) {
      const kk = i < j ? `${i}-${j}` : `${j}-${i}`
      if (done.has(kk)) continue
      done.add(kk)
      const [x2, y2, z2] = P[j]
      const L = Math.hypot(x2 - x, y2 - y, z2 - z)
      if (L > cell * 1.4) continue
      const n = Math.max(4, Math.round(L / 2.5e8))
      // 살짝 휜 필라멘트
      const mx = (r() - 0.5) * L * 0.25, my = (r() - 0.5) * L * 0.25, mz = (r() - 0.5) * L * 0.25
      for (let s = 1; s < n; s++) {
        const t = s / n, bend = 4 * t * (1 - t)
        add(x + (x2 - x) * t + mx * bend + (r() - 0.5) * 4e7, y + (y2 - y) * t + my * bend + (r() - 0.5) * 4e7, z + (z2 - z) * t + mz * bend + (r() - 0.5) * 4e7, 1.4e8)
      }
    }
  }
  return buf
}

// 우주배경복사 껍질: 하늘 방향별 미세한 온도 얼룩(모형 — 실제 Planck 지도 모양은 아님)
export function cmbShell(sun) {
  const g = new THREE.SphereGeometry(R_CMB, 96, 48)
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    uniforms: { uA: { value: 0 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      varying vec3 vD; uniform float uA;
      float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        vec3 p = vD * 6.0;
        float v = n3(p)*0.5 + n3(p*2.1)*0.25 + n3(p*4.3)*0.15 + n3(p*9.0)*0.1;
        vec3 cold = vec3(0.08,0.22,0.75), hot = vec3(0.95,0.45,0.12);
        vec3 c = mix(cold, hot, smoothstep(0.3, 0.7, v));
        gl_FragColor = vec4(c * 0.22 * uA, 1.0);
      }`,
  })
  const mesh = new THREE.Mesh(g, m)
  mesh.position.set(sun[0], sun[1], sun[2])
  mesh.frustumCulled = false
  return mesh
}

// 실제로 발견된 거대 구조·가장 먼 천체 (방향: 적경·적위, 거리: 적색편이 → 지금 거리)
export const LANDMARKS = [
  { name: '에리다누스 슈퍼보이드', ra: 48.75, dec: -19.6, z: 0.22, desc: 'CMB 한랭점 방향의 거대한 빈 곳(후보) · 지름 약 6억~10억 광년' },
  { name: '거대 LQG (Huge-LQG)', ra: 162.4, dec: 14.4, z: 1.27, desc: '퀘이사 73개가 모인 구조 · 길이 약 40억 광년 (2013)' },
  { name: '헤르쿨레스-북쪽왕관자리 장성', ra: 255, dec: 27, z: 1.9, desc: '감마선 폭발 분포로 찾은 가장 큰 구조 후보 · 약 100억 광년 (논쟁 중)' },
  { name: 'GN-z11', ra: 189.106, dec: 62.242, z: 10.6, desc: '허블·JWST로 확인한 초기 은하 · 빛이 약 134억 년 전 출발' },
  { name: 'JADES-GS-z14-0', ra: 53.0828, dec: -27.8556, z: 14.32, desc: 'JWST가 확인한 가장 먼 은하 중 하나(2024) · 빅뱅 후 약 3억 년' },
]
