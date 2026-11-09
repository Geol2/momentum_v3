/**
 * 3D 지구 + 달 렌더러 (three.js / WebGL2)
 *
 *  - 지구: GPU 셰이더로 픽셀마다 실제 낮/밤, 고해상도 해안선(SDF)+프랙탈 디테일, 도시 불빛, 구름, 바다 반사, 대기 테두리
 *  - 달: 오늘 실제 위치(지구 고정 좌표)와 위상, 실제 궤도선
 *  - 드래그로 지구 회전 (시점 = 화면 정면에 오는 위도·경도, 북쪽이 위)
 *
 * 2D 레이어와 정확히 겹치도록 픽셀 단위 정사영 카메라를 쓴다.
 * (X, Y) = 지구 중심의 화면 좌표(css px), R = 지구 반지름(css px)
 */
import * as THREE from 'three'
import { buildTextures, TW, TH, CW, CH, LW, LH, CLOUD_PERIOD } from './earth.js'
import { sunDirection, moonState } from './astro.js'

const DEG = Math.PI / 180
const SUN_REFRESH_MS = 30 * 1000

const NOISE_GLSL = /* glsl */ `
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`

const EARTH_VERT = /* glsl */ `
out vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const EARTH_FRAG = /* glsl */ `
precision highp float;
in vec3 vObj;
out vec4 outColor;
uniform sampler2D uSdf, uLand, uOcean, uBaseLights, uCity, uClouds, uDay, uRelief;
uniform float uHasDay, uHasRelief;
uniform sampler2D uDetail;
uniform vec4 uDetailBox; // lon0, lat0(남), lon1, lat1(북) — 도
uniform float uDetailA;
uniform vec2 uSdfSize;
uniform float uSdfK;
uniform vec3 uSun, uView;
uniform float uR, uCloudShift, uHiSdf;
const float PI = 3.14159265358979;
${NOISE_GLSL}

// 경도 이음매(±180°)에서 밉맵이 튀지 않게: 두 가지 u 중 미분이 작은 쪽으로 샘플
vec4 seamless(sampler2D t, float u, float u2, float v) {
  vec2 dx = vec2(dFdx(u), dFdx(v)), dy = vec2(dFdy(u), dFdy(v));
  vec2 dx2 = vec2(dFdx(u2), dFdx(v)), dy2 = vec2(dFdy(u2), dFdy(v));
  if (max(abs(dx2.x), abs(dy2.x)) < max(abs(dx.x), abs(dy.x))) { dx = dx2; dy = dy2; }
  return textureGrad(t, vec2(u, v), dx, dy);
}

void main() {
  vec3 P = normalize(vObj);
  float lat = asin(clamp(P.z, -1.0, 1.0));
  float u = atan(P.y, P.x) / (2.0 * PI) + 0.5;
  float u2 = fract(u + 0.5) - 0.5;
  float v = 0.5 - lat / PI;

  // ── 해안선 (SDF + 확대 시 프랙탈) ──
  float unit = 127.0 / uSdfK;
  float d = seamless(uSdf, u, u2, v).r * 255.0;
  float texPerPx = max(fwidth(u2 * uSdfSize.x), fwidth(v * uSdfSize.y)) + 1e-6;
  float texelPx = 1.0 / texPerPx;
  float fD = uSdfSize.x / (2.0 * PI) * 1.3;
  float n1 = vnoise(P * fD);
  float n2 = vnoise(P * fD * 2.7);
  float nfine = n1 * 0.6 + n2 * 0.4;
  float detailAmp = uHiSdf * unit * 0.9 * smoothstep(1.2, 5.0, texelPx);
  d += ((n1 - 0.5) * 2.0 + (n2 - 0.5)) * detailAmp;
  float edgeW = max(0.6, unit * texPerPx);
  float landA = clamp((d - 128.0) / edgeW + 0.5, 0.0, 1.0);

  // ── 지표·바다 색 ──
  vec4 land = seamless(uLand, u, u2, v);   // rgb: 육지색, a: 해안 근접도
  vec4 ocean = seamless(uOcean, u, u2, v); // rgb: 바다색, a: 해빙
  float ice = ocean.a;
  float climatePx = 1.0 / (max(fwidth(u2 * ${TW}.0), fwidth(v * ${TH}.0)) + 1e-6);
  float zoomDetail = smoothstep(2.0, 10.0, climatePx);
  float shallow = max(smoothstep(30.0, 128.0, d) * 0.85, smoothstep(0.04, 0.5, land.a) * 0.55) * (1.0 - ice);
  vec3 oc = mix(ocean.rgb, vec3(30.0, 104.0, 146.0) / 255.0, shallow);
  // NASA Blue Marble 위성 사진 (로드되면 서서히 교체)
  vec3 day = seamless(uDay, u, u2, v).rgb;
  // 해안 근처 바다는 위성 텍셀이 육지색으로 채워져 있으므로 절차적 얕은 바다를 쓴다
  float coastW = smoothstep(128.0 - unit * 7.0, 128.0 - unit * 4.5, d);
  vec3 dayOcean = mix(day * vec3(0.92, 1.0, 1.08), oc, coastW);
  oc = mix(oc, dayOcean, uHasDay);
  vec3 lc0 = mix(land.rgb, day * 1.08, uHasDay);
  // 산맥 음영(기복도) + 확대 시 프랙탈 질감
  float rel = (seamless(uRelief, u, u2, v).r - 0.5) * 2.0;
  lc0 *= 1.0 + rel * 0.85 * uHasRelief;
  float tex1 = 1.0 + (nfine - 0.5) * 0.5 * zoomDetail;
  float field = (nfine - 0.5) * 46.0 / 255.0 * zoomDetail * (1.0 - 0.6 * uHasDay);
  vec3 lc = lc0 * tex1 + vec3(field, field * 0.6, 0.0);
  vec3 col = mix(oc, lc, landA);

  // ── 확대 시 고해상도 위성 타일(Sentinel-2 cloudless) ──
  if (uDetailA > 0.001) {
    float lonD = u * 360.0 - 180.0;
    if (lonD < uDetailBox.x) lonD += 360.0;
    float latD = lat * 180.0 / PI;
    vec2 duv = vec2((lonD - uDetailBox.x) / (uDetailBox.z - uDetailBox.x), (uDetailBox.w - latD) / (uDetailBox.w - uDetailBox.y));
    vec4 det = texture(uDetail, clamp(duv, 0.0, 1.0));
    float inside = step(0.0, duv.x) * step(duv.x, 1.0) * step(0.0, duv.y) * step(duv.y, 1.0);
    float edge = smoothstep(0.0, 0.03, min(min(duv.x, 1.0 - duv.x), min(duv.y, 1.0 - duv.y)));
    col = mix(col, det.rgb * 1.12, det.a * inside * edge * uDetailA);
  }

  // ── 조명 (실제 태양 방향) ──
  float nd = dot(P, uSun);
  float dl = smoothstep(-0.1, 0.2, nd) * (0.22 + 0.78 * max(nd, 0.0));
  float nightK = 1.0 - smoothstep(-0.12, 0.03, nd);
  col *= dl;
  float wet = (1.0 - landA) * (1.0 - ice);
  vec3 H = normalize(uSun + uView);
  col += vec3(1.0, 1.0, 0.95) * pow(max(dot(P, H), 0.0), 48.0) * smoothstep(-0.05, 0.2, nd) * 0.86 * wet;

  // ── 구름 ──
  float cloudFade = 1.0 - 0.75 * smoothstep(1500.0, 9000.0, uR);
  float cu = u - uCloudShift;
  float ca = seamless(uClouds, fract(cu), fract(cu + 0.5) - 0.5, v).r * cloudFade * (0.45 + 0.55 * smoothstep(-0.15, 0.1, nd));

  // ── 도시 불빛 ──
  float litBoost = 1.35 + 1.6 * (1.0 - smoothstep(140.0, 700.0, uR));
  float lightDetail = smoothstep(3500.0, 16000.0, uR);
  float li = seamless(uBaseLights, u, u2, v).r * (1.0 - 0.6 * zoomDetail) + seamless(uCity, u, u2, v).r;
  li = min(li * litBoost, 1.0) * landA * nightK * (1.0 - ca * 0.6);
  float nlit = n2 * 0.7 + vnoise(P * fD * 7.3) * 0.3;
  li *= 1.0 - lightDetail + lightDetail * (0.25 + smoothstep(0.42, 0.7, nlit) * 1.35);
  col += li * vec3(1.1, 0.82, 0.4);

  float cl = 0.96 * (0.05 + dl * 1.05);
  col = mix(col, vec3(cl, cl, cl * 1.02), ca);

  // ── 대기 테두리 ──
  float t = 1.0 - max(dot(P, uView), 0.0);
  float rm = t * t * sqrt(t) * (0.12 + 0.88 * smoothstep(-0.3, 0.3, nd));
  col += vec3(70.0, 140.0, 255.0) / 255.0 * rm;

  outColor = vec4(min(col, vec3(1.0)), 1.0);
}
`

const MOON_FRAG = /* glsl */ `
precision highp float;
in vec3 vObj;
out vec4 outColor;
uniform vec3 uSun;
${NOISE_GLSL}
void main() {
  vec3 P = normalize(vObj);
  // 바다(어두운 현무암 평원) + 크레이터 느낌
  float maria = smoothstep(0.52, 0.62, vnoise(P * 2.2 + 3.1) * 0.7 + vnoise(P * 5.0) * 0.3);
  float crater = vnoise(P * 18.0) * 0.5 + vnoise(P * 45.0) * 0.3 + vnoise(P * 110.0) * 0.2;
  float alb = mix(0.78, 0.45, maria) * (0.82 + crater * 0.36);
  float nd = dot(P, uSun);
  float lit = smoothstep(-0.02, 0.08, nd) * (0.15 + 0.85 * max(nd, 0.0));
  vec3 col = vec3(alb) * vec3(1.0, 0.98, 0.94) * lit + vec3(0.02, 0.025, 0.035);
  outColor = vec4(col, 1.0);
}
`

function dataTex(data, w, h, format) {
  const t = new THREE.DataTexture(data, w, h, format, THREE.UnsignedByteType)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.ClampToEdgeWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.flipY = false
  t.unpackAlignment = 1
  t.needsUpdate = true
  return t
}

function packRGBA(rgb, a, n) {
  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    out[i * 4] = rgb[i * 3]; out[i * 4 + 1] = rgb[i * 3 + 1]; out[i * 4 + 2] = rgb[i * 3 + 2]; out[i * 4 + 3] = a[i]
  }
  return out
}

/** WebGL2 사용 가능 여부 */
export function canUseWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!c.getContext('webgl2')
  } catch { return false }
}

/**
 * @param {HTMLElement} host  — 캔버스를 넣을 부모
 * @param {Element} before    — 이 요소 앞에 캔버스를 끼워 넣음(2D 오버레이 아래)
 */
export function createEarthGL(host, { sdfUrl, dayUrl, reliefUrl, before } = {}) {
  const canvas = document.createElement('canvas')
  canvas.className = 'mu-gl'
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
  host.insertBefore(canvas, before || null)
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true })
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -1, 1)
  const group = new THREE.Group()
  group.matrixAutoUpdate = false
  scene.add(group)

  // ── 텍스처 ──
  const tex = buildTextures()
  const N = TW * TH
  const landT = dataTex(packRGBA(tex.landCol, tex.nearTex, N), TW, TH, THREE.RGBAFormat)
  const oceanT = dataTex(packRGBA(tex.oceanCol, tex.ice, N), TW, TH, THREE.RGBAFormat)
  const baseLightsT = dataTex(tex.lights, TW, TH, THREE.RedFormat)
  const cityT = dataTex(tex.cityLights, LW, LH, THREE.RedFormat)
  const cloudsT = dataTex(tex.clouds, CW, CH, THREE.RedFormat)
  const lowSdfT = dataTex(tex.sdf.data, tex.sdf.w, tex.sdf.h, THREE.RedFormat)

  const uniforms = {
    uSdf: { value: lowSdfT }, uSdfSize: { value: new THREE.Vector2(tex.sdf.w, tex.sdf.h) }, uSdfK: { value: tex.sdf.K },
    uHiSdf: { value: 0 },
    uLand: { value: landT }, uOcean: { value: oceanT }, uBaseLights: { value: baseLightsT }, uCity: { value: cityT }, uClouds: { value: cloudsT },
    uSun: { value: new THREE.Vector3(1, 0, 0) }, uView: { value: new THREE.Vector3(0, 0, 1) },
    uR: { value: 100 }, uCloudShift: { value: 0 },
    uDay: { value: landT }, uRelief: { value: landT }, uHasDay: { value: 0 }, uHasRelief: { value: 0 },
    uDetail: { value: landT }, uDetailBox: { value: new THREE.Vector4(0, 0, 1, 1) }, uDetailA: { value: 0 },
  }
  const earthMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG })
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), earthMat)
  group.add(earth)

  // 고해상도 해안선 SDF(이미지) 로드
  if (sdfUrl) {
    new THREE.TextureLoader().load(sdfUrl, (t) => {
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.ClampToEdgeWrapping
      t.flipY = false
      t.colorSpace = THREE.NoColorSpace
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.magFilter = THREE.LinearFilter
      t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
      t.needsUpdate = true
      uniforms.uSdf.value = t
      uniforms.uSdfSize.value.set(t.image.width, t.image.height)
      uniforms.uSdfK.value = 6
      uniforms.uHiSdf.value = 1
      lowSdfT.dispose()
    })
  }

  // 위성 사진·기복도 로드 → 0.8초에 걸쳐 서서히 전환
  const fades = []
  const loadImageTex = (url, onReady) => {
    if (!url) return
    new THREE.TextureLoader().load(url, (t) => {
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.ClampToEdgeWrapping
      t.flipY = false
      t.colorSpace = THREE.NoColorSpace
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.magFilter = THREE.LinearFilter
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      t.needsUpdate = true
      onReady(t)
    })
  }
  loadImageTex(dayUrl, (t) => { uniforms.uDay.value = t; fades.push({ u: uniforms.uHasDay, t0: performance.now() }) })
  loadImageTex(reliefUrl, (t) => { uniforms.uRelief.value = t; fades.push({ u: uniforms.uHasRelief, t0: performance.now() }) })

  // ── 고해상도 위성 타일 (EOX Sentinel-2 cloudless 2016, CC BY 4.0, EPSG:4326 WMTS) ──
  // 레벨 z: 타일 1장 = 180/2^z 도, 256px. 레벨 13 ≈ 10m/px
  const TILE_URL = (z, r, cl) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless/default/WGS84/${z}/${r}/${cl}.jpg`
  const MAX_Z = 13, MAX_TILES = 80
  const tileCache = new Map() // url → Image(로드 완료)
  const pending = new Map() // url → Image(로딩 중)
  let inflight = 0
  const canvases = [document.createElement('canvas'), document.createElement('canvas')]
  let cur = null // { z, r0, c0, nr, nc, box:[lon0,lat0,lon1,lat1], canvas, gen }
  let gen = 0
  let wantKey = '', wantSince = 0, want = null
  let texDirty = false, lastUpload = 0, detailDrawn = false
  const detailTex = new THREE.CanvasTexture(canvases[0])
  detailTex.flipY = false
  detailTex.colorSpace = THREE.NoColorSpace
  detailTex.generateMipmaps = false
  detailTex.minFilter = THREE.LinearFilter
  detailTex.magFilter = THREE.LinearFilter
  uniforms.uDetail.value = detailTex

  function cacheTile(url, img) {
    tileCache.set(url, img)
    if (tileCache.size > 160) tileCache.delete(tileCache.keys().next().value)
  }
  function drawTile(m, r, cl, img) {
    const g = m.canvas.getContext('2d')
    g.drawImage(img, (cl - m.c0) * 256, (r - m.r0) * 256, 256, 256)
    texDirty = true
    detailDrawn = true
  }
  const queue = []
  function pump() {
    while (inflight < 8 && queue.length) {
      const job = queue.shift()
      if (job.gen !== gen) continue
      const url = TILE_URL(job.z, job.r, job.wrapC)
      if (tileCache.has(url)) { drawTile(cur, job.r, job.c, tileCache.get(url)); continue }
      if (pending.has(url)) continue
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.decoding = 'async'
      pending.set(url, img)
      inflight++
      const done = (ok) => {
        inflight--
        pending.delete(url)
        if (ok && img.naturalWidth === 256) {
          cacheTile(url, img)
          if (job.gen === gen && cur) drawTile(cur, job.r, job.c, img)
        }
        pump()
      }
      img.onload = () => done(true)
      img.onerror = () => done(false)
      img.src = url
    }
  }

  // 화면에 보이는 위경도 범위(시점 기준으로 경도 펼침)
  function visibleBox(X, Y, R, W, H) {
    let lonMin = 1e9, lonMax = -1e9, latMin = 90, latMax = -90, any = false
    const { E, N, C } = basis
    const G = 9
    for (let i = 0; i <= G; i++) for (let j = 0; j <= G; j++) {
      const x = ((i / G) * W - X) / R, y = -((j / G) * H - Y) / R
      const r2 = x * x + y * y
      if (r2 > 1) continue
      const z = Math.sqrt(1 - r2)
      const px = x * E[0] + y * N[0] + z * C[0], py = x * E[1] + y * N[1] + z * C[1], pz = x * E[2] + y * N[2] + z * C[2]
      const la = Math.asin(Math.max(-1, Math.min(1, pz))) / DEG
      let lo = Math.atan2(py, px) / DEG
      lo = view.lon + ((((lo - view.lon) % 360) + 540) % 360) - 180
      lonMin = Math.min(lonMin, lo); lonMax = Math.max(lonMax, lo)
      latMin = Math.min(latMin, la); latMax = Math.max(latMax, la)
      any = true
    }
    // 화면 중앙(시점)도 포함
    lonMin = Math.min(lonMin, view.lon); lonMax = Math.max(lonMax, view.lon)
    latMin = Math.min(latMin, view.lat); latMax = Math.max(latMax, view.lat)
    return any ? { lonMin, lonMax, latMin, latMax } : null
  }

  function planDetail(X, Y, R, W, H, ratio) {
    const box = visibleBox(X, Y, R, W, H)
    if (!box) return null
    let z = Math.ceil(Math.log2((R * ratio * Math.PI) / 256))
    z = Math.max(3, Math.min(MAX_Z, z))
    for (; z >= 3; z--) {
      const sp = 180 / 2 ** z
      const c0 = Math.floor((box.lonMin + 180) / sp) - 1, c1 = Math.floor((box.lonMax + 180) / sp) + 1
      const r0 = Math.max(0, Math.floor((90 - box.latMax) / sp) - 1), r1 = Math.min(2 ** z - 1, Math.floor((90 - box.latMin) / sp) + 1)
      const nc = c1 - c0 + 1, nr = r1 - r0 + 1
      if (nc * nr <= MAX_TILES && nc <= 12 && nr <= 12) return { z, c0, r0, nc, nr, sp }
    }
    return null
  }

  function applyPlan(p) {
    gen++
    const prev = cur
    const canvas = prev && prev.canvas === canvases[0] ? canvases[1] : canvases[0]
    canvas.width = p.nc * 256; canvas.height = p.nr * 256
    const g = canvas.getContext('2d')
    g.clearRect(0, 0, canvas.width, canvas.height)
    const box = [p.c0 * p.sp - 180, 90 - (p.r0 + p.nr) * p.sp, (p.c0 + p.nc) * p.sp - 180, 90 - p.r0 * p.sp]
    // 새 타일이 오기 전까지 이전 모자이크를 늘려서 깔아 둔다
    if (prev && detailDrawn) {
      const [a0, b0, a1, b1] = prev.box
      const sx = canvas.width / (box[2] - box[0]), sy = canvas.height / (box[3] - box[1])
      let off = 0
      if (a0 - box[0] > 180) off = -360; else if (box[0] - a0 > 180) off = 360
      g.imageSmoothingEnabled = true
      g.drawImage(prev.canvas, (a0 + off - box[0]) * sx, (box[3] - b1) * sy, (a1 - a0) * sx, (b1 - b0) * sy)
    }
    cur = { ...p, box, canvas, gen }
    detailTex.image = canvas
    detailTex.needsUpdate = true
    uniforms.uDetailBox.value.set(...box)
    // 화면 중앙 가까운 타일부터
    const cr = p.r0 + p.nr / 2, cc = p.c0 + p.nc / 2
    queue.length = 0
    const jobs = []
    const ncols = 2 ** (p.z + 1)
    for (let r = p.r0; r < p.r0 + p.nr; r++) for (let cl = p.c0; cl < p.c0 + p.nc; cl++) {
      jobs.push({ z: p.z, r, c: cl, wrapC: ((cl % ncols) + ncols) % ncols, gen, d: (r - cr) ** 2 + (cl - cc) ** 2 })
    }
    jobs.sort((a, b) => a.d - b.d)
    queue.push(...jobs)
    pump()
  }

  function updateDetail(X, Y, R, W, H, ratio) {
    const a = smoothstep01(900, 2500, R)
    uniforms.uDetailA.value = a
    if (a <= 0.001) return
    const p = planDetail(X, Y, R, W, H, ratio)
    if (!p) return
    const key = `${p.z}|${p.c0}|${p.r0}|${p.nc}|${p.nr}`
    // 현재 모자이크가 이미 이 범위를 같은 레벨로 덮고 있으면 유지
    if (cur && cur.z === p.z && p.c0 >= cur.c0 && p.r0 >= cur.r0 && p.c0 + p.nc <= cur.c0 + cur.nc && p.r0 + p.nr <= cur.r0 + cur.nr) return
    const now = performance.now()
    if (key !== wantKey) { wantKey = key; wantSince = now; want = p; return }
    if (now - wantSince > 180) applyPlan(want) // 줌·회전이 잠깐 멈추면 갱신
  }
  const smoothstep01 = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }

  // ── 달 ──
  const moonUniforms = { uSun: uniforms.uSun }
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1737.4 / 6371, 96, 48),
    new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: moonUniforms, vertexShader: EARTH_VERT, fragmentShader: MOON_FRAG }),
  )
  group.add(moon)
  const orbitGeo = new THREE.BufferGeometry()
  orbitGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(129 * 3), 3))
  const orbitMat = new THREE.LineBasicMaterial({ color: 0x8fa2d8, transparent: true, opacity: 0.35, depthWrite: false })
  const orbit = new THREE.Line(orbitGeo, orbitMat)
  group.add(orbit)

  // ── 상태 ──
  let view = { lat: 37.5665, lon: 126.978 }
  let sunAt = 0
  let moonInfo = null
  let W = 1, H = 1, dpr = 1
  let drawnThisFrame = false, cleared = true
  const basis = { E: [1, 0, 0], N: [0, 0, 1], C: [0, 1, 0] }

  function updateBasis() {
    const la = view.lat * DEG, lo = view.lon * DEG
    basis.C = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]
    basis.E = [-Math.sin(lo), Math.cos(lo), 0]
    basis.N = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)]
    uniforms.uView.value.set(...basis.C)
  }
  updateBasis()

  function updateAstro() {
    const now = Date.now()
    if (now - sunAt < SUN_REFRESH_MS) return
    sunAt = now
    const d = new Date(now)
    uniforms.uSun.value.set(...sunDirection(d))
    moonInfo = moonState(d)
    moon.position.set(...moonInfo.pos)
    const pa = orbitGeo.attributes.position
    pa.array.set(moonInfo.orbit)
    pa.needsUpdate = true
  }

  function resize(w, h, ratio) {
    if (w === W && h === H && ratio === dpr) return
    W = w; H = h; dpr = ratio
    renderer.setPixelRatio(dpr)
    renderer.setSize(W, H, false)
    camera.left = 0; camera.right = W; camera.top = 0; camera.bottom = -H
  }

  const toScreen = (p, X, Y, R) => {
    const { E, N, C } = basis
    const x = p[0] * E[0] + p[1] * E[1] + p[2] * E[2]
    const y = p[0] * N[0] + p[1] * N[1] + p[2] * N[2]
    const z = p[0] * C[0] + p[1] * C[1] + p[2] * C[2]
    return { x: X + x * R, y: Y - y * R, z }
  }

  return {
    gl: true,
    setView(lat, lon) { view = { lat, lon }; updateBasis() },
    getView() { return { ...view } },
    rotateBy(dx, dy) {
      view = { lat: Math.max(-89, Math.min(89, view.lat + dy / DEG)), lon: ((view.lon - dx / DEG + 540) % 360) - 180 }
      updateBasis()
    },
    get moon() { updateAstro(); return moonInfo },
    /** 고해상도 위성 타일이 화면에 쓰이는 중인지 (출처 표시용) */
    get detailActive() { return uniforms.uDetailA.value > 0.05 && detailDrawn },
    /** 달의 화면 위치·반지름 */
    moonScreen(X, Y, R) {
      updateAstro()
      const s = toScreen(moonInfo.pos, X, Y, R)
      return { ...s, r: (1737.4 / 6371) * R }
    },
    /**
     * glowCtx: 대기광을 그릴 2D 컨텍스트(지구 아래 레이어)
     * opts.moonAlpha: 달 궤도선 투명도
     */
    draw(glowCtx, X, Y, R, time, ratio = 1, w = 1, h = 1, _moving = false, opts = {}) {
      updateAstro()
      resize(w, h, Math.min(ratio, 2))
      if (glowCtx && R < Math.max(w, h) * 2) {
        const g = glowCtx.createRadialGradient(X, Y, R * 0.98, X, Y, R * 1.12)
        g.addColorStop(0, 'rgba(110,170,255,0.55)')
        g.addColorStop(1, 'rgba(110,170,255,0)')
        glowCtx.globalAlpha = 1
        glowCtx.fillStyle = g
        glowCtx.beginPath(); glowCtx.arc(X, Y, R * 1.12, 0, Math.PI * 2); glowCtx.fill()
      }
      const { E, N, C } = basis
      const m = new THREE.Matrix4().set(
        E[0], E[1], E[2], 0,
        N[0], N[1], N[2], 0,
        C[0], C[1], C[2], 0,
        0, 0, 0, 1,
      )
      const sm = new THREE.Matrix4().makeScale(R, R, R)
      const tm = new THREE.Matrix4().makeTranslation(X, -Y, 0)
      group.matrix.copy(tm.multiply(sm).multiply(m))
      group.matrixWorldNeedsUpdate = true
      const depth = 70 * R + 10
      camera.near = -depth; camera.far = depth
      camera.updateProjectionMatrix()

      for (let i = fades.length - 1; i >= 0; i--) {
        const k = Math.min(1, (performance.now() - fades[i].t0) / 800)
        fades[i].u.value = k
        if (k >= 1) fades.splice(i, 1)
      }
      updateDetail(X, Y, R, w, h, Math.min(ratio, 2))
      if (texDirty && performance.now() - lastUpload > 150) { detailTex.needsUpdate = true; texDirty = false; lastUpload = performance.now() }
      uniforms.uR.value = R
      uniforms.uCloudShift.value = ((Math.floor(time / 10) * 10) / CLOUD_PERIOD) % 1
      orbitMat.opacity = opts.moonAlpha ?? 0
      orbit.visible = orbitMat.opacity > 0.01
      moon.visible = (opts.moonAlpha ?? 0) > 0.01 || (1737.4 / 6371) * R > 1.5
      renderer.render(scene, camera)
      drawnThisFrame = true
      cleared = false
    },
    /** 이번 프레임에 그리지 않았다면 캔버스를 비운다 */
    endFrame() {
      if (!drawnThisFrame && !cleared) { renderer.clear(); cleared = true }
      drawnThisFrame = false
    },
    project(latDeg, lonDeg, X, Y, R) {
      const la = latDeg * DEG, lo = lonDeg * DEG
      return toScreen([Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)], X, Y, R)
    },
    destroy() {
      renderer.dispose()
      gen++; queue.length = 0
      ;[landT, oceanT, baseLightsT, cityT, cloudsT, detailTex, uniforms.uSdf.value, uniforms.uDay.value, uniforms.uRelief.value].forEach((t) => t.dispose?.())
      canvas.remove()
    },
  }
}
