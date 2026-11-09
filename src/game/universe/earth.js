/**
 * 상세 지구 렌더러
 *  - 실제 대륙 윤곽(Natural Earth) + 위도/노이즈 기반 지형 색(빙하·툰드라·사막·열대우림·온대림)
 *  - 자전(자전축 23.4° 기울기), 따로 흐르는 구름층
 *  - 태양 방향 조명: 낮/밤 경계(터미네이터), 바다 반사광, 대기 산란 테두리
 *  - 밤쪽 도시 불빛
 *
 * 비싼 계산(위도·경도 역투영, 조명)은 화면 크기별로 한 번만 하고,
 * 매 프레임에는 "경도 + 자전각"으로 텍스처를 조회만 한다.
 */
import { LAND_W, LAND_H, LAND_RLE_B64 } from './earth-data.js'

const TW = LAND_W
const TH = LAND_H
const CW = 1024 // 구름 텍스처
const CH = 512
const TILT = (23.4 * Math.PI) / 180
const MAX_D = 560 // 오프스크린 최대 해상도(px)
const ROT_PERIOD = 120 // 자전 1바퀴(초) — 실제보다 훨씬 빠르게
const CLOUD_DRIFT = 0.12 // 구름이 지표보다 조금 더 빠르게 흐름

// ───────── 노이즈 ─────────
function hash3(x, y, z, seed) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + seed * 2246822519) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function vnoise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = x - xi, yf = y - yi, zf = z - zi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf)
  const l = (a, b, t) => a + (b - a) * t
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed)
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  )
}
function fbm3(x, y, z, seed, oct = 5) {
  let a = 0.5, f = 1, s = 0, n = 0
  for (let i = 0; i < oct; i++) {
    s += a * vnoise3(x * f, y * f, z * f, seed + i * 17)
    n += a; a *= 0.5; f *= 2.03
  }
  return s / n
}
// 구면 위에서 노이즈를 뽑아 경도 이음매가 없게 한다
function sphereNoise(w, h, scale, seed, oct, stretchX = 1) {
  const out = new Float32Array(w * h)
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI
    const cl = Math.cos(lat), sl = Math.sin(lat)
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * Math.PI * 2
      out[j * w + i] = fbm3(Math.cos(lon) * cl * scale * stretchX, Math.sin(lon) * cl * scale * stretchX, sl * scale, seed, oct)
    }
  }
  return out
}

const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const mix = (a, b, t) => a + (b - a) * t

// ───────── 육지 마스크 디코딩 ─────────
function decodeLand() {
  const bin = atob(LAND_RLE_B64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const mask = new Uint8Array(TW * TH)
  let p = 0
  for (let row = 0; row < TH; row++) {
    let x = 0, land = 0
    while (x < TW) {
      let n = 0, shift = 0, b
      do { b = bytes[p++]; n |= (b & 127) << shift; shift += 7 } while (b & 128)
      if (land) mask.fill(1, row * TW + x, row * TW + x + n)
      x += n; land ^= 1
    }
  }
  return mask
}

// 박스 블러(가로 순환, 세로 클램프) — 해안 근접도 계산용
function blur(src, w, h, r, passes = 2) {
  let a = Float32Array.from(src), b = new Float32Array(w * h)
  const k = 1 / (2 * r + 1)
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += a[y * w + ((i + w) % w)]
      for (let x = 0; x < w; x++) {
        b[y * w + x] = s * k
        s += a[y * w + ((x + r + 1) % w)] - a[y * w + ((x - r + w) % w)]
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += b[Math.max(0, Math.min(h - 1, i)) * w + x]
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s * k
        s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]
      }
    }
  }
  return a
}

// ───────── 텍스처 생성 ─────────
function buildTextures() {
  const land = decodeLand()
  const near = blur(land, TW, TH, 5) // 바다: 해안에 가까울수록 ↑ / 육지: 내륙일수록 ↑
  const nB = sphereNoise(TW / 2, TH / 2, 3.2, 11, 5) // 지형 색 변화
  const nP = sphereNoise(TW / 2, TH / 2, 9, 29, 3) // 인구(도시 불빛)
  const sampleHalf = (arr, i, j) => arr[(j >> 1) * (TW / 2) + (i >> 1)]

  const color = new Uint8Array(TW * TH * 3)
  const lights = new Uint8Array(TW * TH)
  const isOcean = new Uint8Array(TW * TH)

  for (let j = 0; j < TH; j++) {
    const lat = 90 - ((j + 0.5) / TH) * 180
    const a = Math.abs(lat)
    for (let i = 0; i < TW; i++) {
      const lon = ((i + 0.5) / TW) * 360 - 180
      const k = j * TW + i
      const n = sampleHalf(nB, i, j)
      let r, g, b
      if (!land[k]) {
        // 바다: 깊은 남색 → 해안 근처 청록
        const shallow = smooth(0.05, 0.55, near[k])
        r = mix(8, 28, shallow) + n * 10
        g = mix(32, 98, shallow) + n * 14
        b = mix(78, 140, shallow) + n * 16
        // 극지 해빙
        const ice = smooth(0.62, 0.7, (a - 60) / 30 + (n - 0.5) * 0.5)
        if (ice > 0) { r = mix(r, 215, ice); g = mix(g, 228, ice); b = mix(b, 238, ice) }
        else isOcean[k] = 1
      } else {
        const inland = near[k]
        // 건조도: 아열대 고압대(위도 ~23°) + 내륙 + 노이즈
        let dry = Math.exp(-(((a - 24) / 11) ** 2)) * 0.85 + (inland - 0.6) * 0.5 + (n - 0.5) * 0.9
        // 지역 보정(부드러운 가우시안)
        const rg = (cl, cn, rl, rn) => Math.exp(-(((lat - cl) / rl) ** 2) - (((lon - cn) / rn) ** 2))
        dry += 0.45 * rg(22, 12, 10, 28) // 사하라
        dry += 0.35 * rg(24, 47, 8, 12) // 아라비아
        dry += 0.35 * rg(-25, 133, 8, 15) // 호주 내륙
        dry += 0.3 * rg(42, 95, 6, 18) // 타클라마칸·고비
        dry -= 0.9 * rg(20, 100, 12, 30) // 인도·동남아·중국 남부 몬순
        dry -= 0.35 * rg(-5, -60, 14, 18) // 아마존
        const desert = smooth(0.45, 0.7, dry)
        // 식생: 열대(진녹) → 온대(녹) → 냉대(짙은 청록)
        const tropic = 1 - smooth(8, 22, a)
        const boreal = smooth(45, 60, a)
        r = mix(mix(70, 30, tropic), 48, boreal)
        g = mix(mix(118, 88, tropic), 82, boreal)
        b = mix(mix(52, 38, tropic), 58, boreal)
        // 사막
        r = mix(r, mix(214, 178, n), desert)
        g = mix(g, mix(184, 138, n), desert)
        b = mix(b, mix(128, 92, n), desert)
        // 산악 느낌(고노이즈 → 갈색)
        const mount = smooth(0.66, 0.8, n)
        r = mix(r, 122, mount * 0.6); g = mix(g, 104, mount * 0.6); b = mix(b, 82, mount * 0.6)
        // 툰드라 → 빙하 (그린란드·남극 포함)
        const tundra = smooth(58, 68, a + (n - 0.5) * 8)
        r = mix(r, 128, tundra); g = mix(g, 124, tundra); b = mix(b, 100, tundra)
        let snow = smooth(68, 76, a + (n - 0.5) * 6)
        if (lat < -60) snow = 1
        if (lat > 60 && lon > -60 && lon < -15) snow = Math.max(snow, 0.95) // 그린란드
        r = mix(r, 240, snow); g = mix(g, 244, snow); b = mix(b, 248, snow)
        r += (n - 0.5) * 18; g += (n - 0.5) * 18; b += (n - 0.5) * 14
        // 도시 불빛: 해안·온대·저사막·저빙하 지역에 점점이
        const coast = 1 - smooth(0.55, 0.95, inland)
        const pop = sampleHalf(nP, i, j)
        const habitable = (1 - desert * 0.85) * (1 - snow) * (1 - tundra * 0.8) * (0.35 + coast * 0.9) * (1 - tropic * 0.35)
        const p = pop * habitable
        const glowField = smooth(0.36, 0.62, p) * 70 // 도시권의 은은한 빛
        const sparkle = p > 0.4 && hash3(i, j, 7, 3) < (p - 0.4) * 3.2 ? 120 + hash3(i, j, 9, 5) * 135 : 0
        lights[k] = Math.min(255, glowField + sparkle)
      }
      color[k * 3] = Math.max(0, Math.min(255, r))
      color[k * 3 + 1] = Math.max(0, Math.min(255, g))
      color[k * 3 + 2] = Math.max(0, Math.min(255, b))
    }
  }

  // 구름: 적도 수렴대 + 중위도 폭풍대가 조금 더 많게
  const nc = sphereNoise(CW, CH, 4.2, 53, 7, 1.6)
  const clouds = new Uint8Array(CW * CH)
  for (let j = 0; j < CH; j++) {
    const lat = Math.abs(90 - ((j + 0.5) / CH) * 180)
    const bias = 0.06 * Math.exp(-((lat / 8) ** 2)) + 0.07 * Math.exp(-(((lat - 52) / 12) ** 2)) - 0.06 * Math.exp(-(((lat - 25) / 8) ** 2))
    for (let i = 0; i < CW; i++) {
      const v = nc[j * CW + i] + bias
      clouds[j * CW + i] = Math.pow(smooth(0.47, 0.74, v), 1.4) * 235
    }
  }
  return { color, lights, isOcean, clouds }
}

// ───────── 화면 크기별 역투영/조명 캐시 ─────────
function buildProjection(D) {
  const N = D * D
  const inside = new Uint8Array(N)
  const texY = new Uint16Array(N)
  const cloudYf = new Float32Array(N)
  const lon0 = new Float32Array(N) // 0..1 (자전 전)
  const day = new Float32Array(N) // 낮 정도(디퓨즈 포함)
  const night = new Float32Array(N) // 밤 정도(불빛 표시용)
  const spec = new Float32Array(N)
  const rim = new Float32Array(N)
  const edge = new Float32Array(N) // 가장자리 안티앨리어싱 알파

  // 태양은 화면 왼쪽(태양계에서 태양이 지구의 -x 방향) + 살짝 앞쪽
  let L = [-0.82, 0.18, 0.55]
  const ll = Math.hypot(...L); L = L.map((v) => v / ll)
  let Hh = [L[0], L[1], L[2] + 1]
  const hl = Math.hypot(...Hh); Hh = Hh.map((v) => v / hl)
  const ct = Math.cos(TILT), st = Math.sin(TILT)
  const R = D / 2

  for (let py = 0; py < D; py++) {
    for (let px = 0; px < D; px++) {
      const k = py * D + px
      const x = (px + 0.5 - R) / R
      const y = -(py + 0.5 - R) / R
      const d = Math.hypot(x, y)
      if (d > 1 + 1 / R) continue
      inside[k] = 1
      edge[k] = Math.max(0, Math.min(1, (1 - d) * R + 0.5))
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y))
      // 자전축 기울기: 화면 z축 기준으로 되돌려 지구 고정 좌표로
      const ex = x * ct + y * st
      const ey = -x * st + y * ct
      const lat = Math.asin(Math.max(-1, Math.min(1, ey)))
      const lon = Math.atan2(ex, z)
      texY[k] = Math.min(TH - 1, Math.floor((0.5 - lat / Math.PI) * TH))
      cloudYf[k] = Math.max(0, Math.min(CH - 1, (0.5 - lat / Math.PI) * CH - 0.5))
      lon0[k] = lon / (Math.PI * 2) + 0.5
      const nd = x * L[0] + y * L[1] + z * L[2]
      day[k] = smooth(-0.1, 0.25, nd) * (0.25 + 0.75 * Math.max(0, nd))
      night[k] = 1 - smooth(-0.15, 0.05, nd)
      const nh = Math.max(0, x * Hh[0] + y * Hh[1] + z * Hh[2])
      spec[k] = Math.pow(nh, 48) * smooth(-0.05, 0.2, nd)
      rim[k] = Math.pow(1 - z, 2.4) * (0.15 + 0.85 * smooth(-0.3, 0.3, nd))
    }
  }
  return { D, inside, texY, cloudYf, lon0, day, night, spec, rim, edge }
}

export function createEarthRenderer() {
  let tex = null
  let proj = null
  let canvas = null, cctx = null, img = null
  let lastRot = -1

  function ensure(D) {
    if (!tex) tex = buildTextures()
    if (!proj || proj.D !== D) {
      proj = buildProjection(D)
      canvas = document.createElement('canvas')
      canvas.width = canvas.height = D
      cctx = canvas.getContext('2d')
      img = cctx.createImageData(D, D)
      lastRot = -1
    }
  }

  function paint(rot) {
    const { D, inside, texY, cloudYf, lon0, day, night, spec, rim, edge } = proj
    const { color, lights, isOcean, clouds } = tex
    const out = img.data
    const cRot = rot * (1 + CLOUD_DRIFT)
    for (let k = 0, N = D * D; k < N; k++) {
      const o = k * 4
      if (!inside[k]) { out[o + 3] = 0; continue }
      let u = lon0[k] + rot; u -= Math.floor(u)
      const ti = texY[k] * TW + ((u * TW) | 0)
      let cu = lon0[k] + cRot; cu -= Math.floor(cu)
      const fx = cu * CW - 0.5, x0 = fx < 0 ? CW - 1 : fx | 0, x1 = x0 + 1 === CW ? 0 : x0 + 1, wx = fx - Math.floor(fx)
      const fy = cloudYf[k], y0 = fy | 0, y1 = Math.min(CH - 1, y0 + 1), wy = fy - y0
      const ca = ((clouds[y0 * CW + x0] * (1 - wx) + clouds[y0 * CW + x1] * wx) * (1 - wy) +
        (clouds[y1 * CW + x0] * (1 - wx) + clouds[y1 * CW + x1] * wx) * wy) / 255

      const dl = day[k]
      let r = color[ti * 3] * dl, g = color[ti * 3 + 1] * dl, b = color[ti * 3 + 2] * dl
      if (isOcean[ti]) { const sp = spec[k] * 220; r += sp; g += sp; b += sp * 0.95 }
      // 밤쪽 도시 불빛 (구름에 조금 가려짐)
      const li = lights[ti] * night[k] * (1 - ca * 0.7)
      r += li * 1.1; g += li * 0.82; b += li * 0.4
      // 구름
      const cl = 245 * (0.06 + dl * 1.05)
      r = r + (cl - r) * ca; g = g + (cl - g) * ca; b = b + (cl * 1.02 - b) * ca
      // 대기 산란 테두리
      const rm = rim[k]
      r += 70 * rm; g += 140 * rm; b += 255 * rm

      out[o] = r > 255 ? 255 : r
      out[o + 1] = g > 255 ? 255 : g
      out[o + 2] = b > 255 ? 255 : b
      out[o + 3] = edge[k] * 255
    }
    cctx.putImageData(img, 0, 0)
  }

  return {
    /** (X, Y): 화면 중심, R: 화면 반지름(px), time: 초, dpr: 기기 픽셀 비율 */
    draw(ctx, X, Y, R, time, dpr = 1) {
      const D = Math.max(16, Math.min(MAX_D, Math.round(R * 2 * dpr)))
      ensure(D)
      const rot = (time / ROT_PERIOD) % 1
      // 1px도 안 움직였으면 다시 그리지 않음
      if (lastRot < 0 || Math.abs(rot - lastRot) * Math.PI * D > 0.35) {
        paint(rot)
        lastRot = rot
      }
      // 바깥 대기광
      const glow = ctx.createRadialGradient(X, Y, R * 0.98, X, Y, R * 1.12)
      glow.addColorStop(0, 'rgba(110,170,255,0.55)')
      glow.addColorStop(1, 'rgba(110,170,255,0)')
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(X, Y, R * 1.12, 0, Math.PI * 2); ctx.fill()
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(canvas, X - R, Y - R, R * 2, R * 2)
    },
    /** 무거운 텍스처를 미리 만들어 두기(선택) */
    warmup() { if (!tex) tex = buildTextures() },
  }
}
