/**
 * 상세 지구 렌더러 — 실시간
 *  - 실제 대륙 윤곽(Natural Earth) + 기후대 기반 지형 색(빙하·툰드라·사막·열대우림·온대림)
 *  - 현재 시각으로 태양 직하점(적위·경도)을 계산해 실제 낮/밤을 그대로 표현
 *  - 바다 반사광, 대기 산란 테두리, 밤쪽 도시 불빛, 천천히 흐르는 구름
 *  - 화면은 관측자 위치(내 위치)를 정면에 두는 정사영(북쪽이 위)
 *
 * 화면에 보이는 영역만 픽셀 단위로 그린다(확대해도 선명).
 * 해안선은 1:10m 지도에서 만든 4096×2048 거리장(SDF) + 확대 시 프랙탈 디테일.
 * 시점·크기·태양·구름이 그대로면 이전 결과를 재사용한다.
 */
import { LAND_W, LAND_H, LAND_RLE_B64 } from './earth-data.js'

const TW = LAND_W
const TH = LAND_H
const CW = 1024 // 구름 텍스처
const CH = 512
const CLOUD_PERIOD = 6 * 3600 // 구름이 한 바퀴 흐르는 시간(초) — 분위기용
const SUN_REFRESH_MS = 30 * 1000
const DEG = Math.PI / 180

/** 현재 시각의 태양 직하점(위도·경도, 도) — NOAA 근사식, 오차 약 0.1° 수준 */
export function subsolarPoint(date = new Date()) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0 // J2000 기준 일수
  const L = (280.46 + 0.9856474 * n) % 360
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG // 황경
  const eps = (23.439 - 0.0000004 * n) * DEG // 황도 경사
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam))
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam))
  const gmst = (280.46061837 + 360.98564736629 * n) % 360
  let lon = ra / DEG - gmst
  lon = ((((lon + 180) % 360) + 360) % 360) - 180
  return { lat: dec / DEG, lon }
}

/** 지점(lat, lon)의 태양 고도(도) */
export function solarElevation(lat, lon, date = new Date()) {
  const s = subsolarPoint(date)
  const a = vec(lat, lon), b = vec(s.lat, s.lon)
  return Math.asin(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / DEG
}

function vec(latDeg, lonDeg) {
  const la = latDeg * DEG, lo = lonDeg * DEG
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]
}

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

// ───────── 대도시권 불빛 (위도, 경도, 인구[백만], 밝기계수) ─────────
// 밝기계수: 같은 인구라도 전력·조명 사정에 따라 실제 야간 밝기가 다름
const METROS = [
  // 한국
  [37.55, 126.99, 26, 1.1], [35.15, 129.05, 3.4, 1.05], [35.87, 128.6, 2.4, 1], [36.35, 127.38, 1.5, 1], [35.16, 126.85, 1.5, 1],
  [35.54, 129.31, 1.1, 1.05], [35.23, 128.68, 1, 1], [36.64, 127.49, 0.85, 1], [36.81, 127.15, 0.7, 1], [35.82, 127.15, 0.65, 1],
  [36.02, 129.34, 0.5, 1], [33.5, 126.53, 0.5, 1], [37.34, 127.92, 0.36, 1], [37.88, 127.73, 0.28, 1], [37.75, 128.88, 0.21, 1],
  [34.81, 126.39, 0.22, 1], [34.76, 127.66, 0.28, 1], [35.94, 126.71, 0.27, 1], [36.43, 127.13, 0.3, 1], [35.84, 129.21, 0.25, 1],
  // 북한(실제로 매우 어두움)
  [39.04, 125.76, 3, 0.18], [39.92, 127.54, 0.7, 0.08], [41.8, 129.78, 0.6, 0.06],
  // 일본
  [35.68, 139.69, 37, 1.1], [34.69, 135.5, 19, 1.1], [35.18, 136.91, 9, 1.1], [33.59, 130.4, 5.5, 1.05], [43.06, 141.35, 2.6, 1],
  [38.27, 140.87, 2.3, 1], [34.39, 132.46, 2, 1], [33.88, 130.88, 1.4, 1], [34.7, 137.73, 1.1, 1], [37.9, 139.02, 0.8, 1],
  [31.6, 130.56, 0.6, 1], [26.21, 127.68, 0.8, 1],
  // 중국·대만·홍콩
  [31.23, 121.47, 28, 1], [39.9, 116.4, 21, 1], [23.13, 113.26, 19, 1], [22.54, 114.06, 17, 1.05], [29.56, 106.55, 16, 0.85],
  [30.66, 104.07, 16, 0.85], [39.13, 117.2, 14, 0.9], [30.59, 114.3, 11, 0.9], [34.34, 108.94, 9, 0.85], [30.27, 120.15, 10, 0.95],
  [32.06, 118.8, 9, 0.95], [41.8, 123.43, 8, 0.8], [34.75, 113.62, 8, 0.85], [28.23, 112.94, 6, 0.85], [36.65, 117.0, 6, 0.85],
  [45.8, 126.53, 6, 0.75], [36.07, 120.38, 6, 0.9], [38.91, 121.6, 5, 0.9], [25.04, 102.71, 5, 0.8], [24.48, 118.09, 4, 0.95],
  [26.07, 119.3, 4, 0.9], [43.82, 125.32, 4, 0.75], [31.82, 117.23, 5, 0.85], [22.82, 108.37, 4, 0.8], [26.65, 106.63, 4, 0.75],
  [38.04, 114.51, 5, 0.8], [37.87, 112.55, 4, 0.75], [36.06, 103.83, 3.5, 0.7], [43.83, 87.62, 3.5, 0.7], [31.3, 120.6, 7, 0.95],
  [22.32, 114.17, 7.5, 1.1], [25.03, 121.57, 7, 1.1], [22.63, 120.3, 2.7, 1.05], [24.15, 120.67, 2.8, 1.05],
  // 동남아·남아시아
  [14.6, 120.98, 24, 0.8], [13.76, 100.5, 17, 0.85], [10.82, 106.63, 13, 0.8], [21.03, 105.85, 8, 0.75], [1.35, 103.82, 6, 1.1],
  [3.14, 101.69, 8, 0.9], [-6.21, 106.85, 33, 0.75], [-7.25, 112.75, 9, 0.7], [16.87, 96.2, 6, 0.4], [11.56, 104.92, 2.3, 0.5],
  [19.08, 72.88, 25, 0.6], [28.61, 77.21, 32, 0.65], [22.57, 88.36, 15, 0.55], [12.97, 77.59, 13, 0.6], [13.08, 80.27, 11, 0.6],
  [17.39, 78.49, 10, 0.6], [23.02, 72.57, 8, 0.6], [18.52, 73.86, 7, 0.6], [23.81, 90.41, 22, 0.45], [24.86, 67.0, 17, 0.5],
  [31.55, 74.34, 13, 0.5], [6.93, 79.85, 2.3, 0.5],
  // 중동·러시아·유럽
  [25.2, 55.27, 3.5, 1.1], [24.47, 54.37, 1.5, 1.1], [24.71, 46.68, 7.5, 1], [21.49, 39.19, 4.5, 0.95], [35.69, 51.39, 15, 0.8],
  [33.31, 44.36, 7, 0.6], [41.01, 28.98, 16, 0.9], [39.93, 32.86, 5, 0.85], [32.08, 34.78, 4, 1], [30.04, 31.24, 22, 0.7],
  [55.76, 37.62, 17, 1], [59.94, 30.31, 5.5, 0.95], [56.84, 60.6, 1.5, 0.8], [55.03, 82.92, 1.6, 0.8], [43.12, 131.89, 0.6, 0.8],
  [51.51, -0.13, 14, 1], [48.86, 2.35, 12, 1], [52.52, 13.4, 6, 0.95], [40.42, -3.7, 6.7, 1], [41.39, 2.17, 5.5, 1],
  [41.9, 12.5, 4.3, 0.95], [45.46, 9.19, 5, 1], [52.37, 4.9, 2.5, 1.05], [51.22, 6.78, 10, 1.05], [50.85, 4.35, 2, 1.05],
  [48.21, 16.37, 2.9, 0.95], [52.23, 21.01, 3.1, 0.9], [50.45, 30.52, 3.5, 0.7], [47.5, 19.04, 3, 0.9], [44.43, 26.1, 2.2, 0.85],
  [37.98, 23.73, 3.6, 0.95], [38.72, -9.14, 3, 1], [53.48, -2.24, 3, 1], [52.49, -1.89, 2.9, 1], [59.33, 18.07, 2.4, 1],
  [55.68, 12.57, 2, 1], [53.35, -6.26, 1.9, 1], [48.14, 11.58, 2.9, 1], [50.11, 8.68, 2.5, 1.05], [53.55, 9.99, 3.2, 1],
  // 아프리카
  [6.52, 3.38, 15, 0.45], [-26.2, 28.05, 10, 0.75], [-33.92, 18.42, 4.7, 0.8], [-1.29, 36.82, 5, 0.4], [-4.44, 15.27, 15, 0.25],
  [5.6, -0.19, 4, 0.45], [9.03, 38.74, 5, 0.3], [33.57, -7.59, 4, 0.8], [36.75, 3.06, 3, 0.8], [-6.79, 39.21, 7, 0.35],
  [15.5, 32.56, 6, 0.4], [14.69, -17.44, 3.3, 0.5], [-8.84, 13.23, 9, 0.45], [36.81, 10.18, 2.4, 0.8],
  // 아메리카
  [40.71, -74.0, 20, 1.15], [34.05, -118.24, 13, 1.15], [41.88, -87.63, 9.5, 1.15], [29.76, -95.37, 7, 1.15], [32.78, -96.8, 7.5, 1.15],
  [38.9, -77.04, 6.3, 1.1], [25.76, -80.19, 6.1, 1.15], [33.75, -84.39, 6, 1.1], [42.36, -71.06, 4.9, 1.1], [39.95, -75.17, 6, 1.1],
  [37.77, -122.42, 6.7, 1.1], [33.45, -112.07, 4.9, 1.15], [47.61, -122.33, 4, 1.05], [44.98, -93.27, 3.7, 1.05], [32.72, -117.16, 3.3, 1.1],
  [39.74, -104.99, 3, 1.1], [36.17, -115.14, 2.3, 1.2], [42.33, -83.05, 4.3, 1.05], [38.63, -90.2, 2.8, 1.05], [27.95, -82.46, 3.2, 1.1],
  [43.65, -79.38, 6.5, 1.05], [45.5, -73.57, 4.3, 1.05], [49.28, -123.12, 2.6, 1.05], [51.05, -114.07, 1.5, 1.05],
  [19.43, -99.13, 22, 0.85], [20.67, -103.35, 5.3, 0.85], [25.69, -100.32, 5.3, 0.9], [-23.55, -46.63, 22, 0.85], [-22.91, -43.17, 13, 0.85],
  [-34.6, -58.38, 15, 0.85], [-12.05, -77.04, 11, 0.7], [4.71, -74.07, 11, 0.7], [-33.45, -70.67, 7, 0.85], [10.48, -66.9, 3, 0.55],
  [-15.79, -47.88, 4.7, 0.85], [-19.92, -43.94, 6, 0.8], [-30.03, -51.23, 4, 0.8], [-3.12, -60.02, 2.2, 0.7], [23.11, -82.37, 2.1, 0.35],
  // 오세아니아
  [-33.87, 151.21, 5.3, 1.05], [-37.81, 144.96, 5.1, 1.05], [-27.47, 153.03, 2.6, 1.05], [-31.95, 115.86, 2.1, 1.05], [-34.93, 138.6, 1.4, 1.05],
  [-36.85, 174.76, 1.7, 1.05], [-41.29, 174.78, 0.4, 1],
]
const LW = 4096, LH = 2048 // 도시 불빛 고해상도 텍스처

function splatMetros() {
  const f = new Float32Array(LW * LH)
  for (const [la, lo, pop, k] of METROS) {
    const rDeg = 0.05 + 0.05 * Math.sqrt(pop) // 도시권 반경(도) — 서울권 약 0.3°
    const peak = (110 + 30 * Math.sqrt(pop)) * k
    const ry = (rDeg / 180) * LH, rx = ry / Math.max(0.2, Math.cos(la * DEG))
    const cx = ((lo + 180) / 360) * LW, cy = ((90 - la) / 180) * LH
    const ex = Math.ceil(rx * 2.6), ey = Math.ceil(ry * 2.6)
    for (let y = Math.floor(cy - ey); y <= cy + ey; y++) {
      if (y < 0 || y >= LH) continue
      for (let xx = Math.floor(cx - ex); xx <= cx + ex; xx++) {
        const dx = (xx + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry
        const d2 = dx * dx + dy * dy
        if (d2 > 6.8) continue
        const x = ((xx % LW) + LW) % LW
        // 중심은 밝고 바깥은 듬성듬성(교외)
        const grain = 0.45 + 0.55 * hash3(x, y, 3, 77)
        f[y * LW + x] += peak * Math.exp(-d2) * grain
      }
    }
  }
  const out = new Uint8Array(LW * LH)
  for (let i = 0; i < out.length; i++) out[i] = f[i] > 255 ? 255 : f[i]
  return out
}

// ───────── 텍스처 생성 (1024×512 기후/색 텍스처) ─────────
// 육지색·바다색을 모든 텍셀에 대해 따로 만들어 두고,
// 실제 육지/바다 구분은 고해상도 해안선 거리장(SDF)으로 픽셀마다 정한다.
function buildTextures() {
  const land = decodeLand()
  const near = blur(land, TW, TH, 5) // 해안 근접도(내륙일수록 ↑)
  const nB = sphereNoise(TW / 2, TH / 2, 3.2, 11, 5)
  const nP = sphereNoise(TW / 2, TH / 2, 9, 29, 3)
  const sampleHalf = (arr, i, j) => arr[(j >> 1) * (TW / 2) + (i >> 1)]
  const N = TW * TH
  const landCol = new Uint8Array(N * 3)
  const oceanCol = new Uint8Array(N * 3)
  const ice = new Uint8Array(N)
  const lights = new Uint8Array(N)
  const nearTex = new Uint8Array(N)
  const clampB = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

  for (let j = 0; j < TH; j++) {
    const lat = 90 - ((j + 0.5) / TH) * 180
    const a = Math.abs(lat)
    for (let i = 0; i < TW; i++) {
      const lon = ((i + 0.5) / TW) * 360 - 180
      const k = j * TW + i
      const n = sampleHalf(nB, i, j)
      nearTex[k] = near[k] * 255
      // 바다(깊은 곳 기준색) + 극지 해빙
      const ic = smooth(0.62, 0.7, (a - 60) / 30 + (n - 0.5) * 0.5)
      ice[k] = ic * 255
      oceanCol[k * 3] = clampB(mix(8 + n * 10, 215, ic))
      oceanCol[k * 3 + 1] = clampB(mix(32 + n * 14, 228, ic))
      oceanCol[k * 3 + 2] = clampB(mix(78 + n * 16, 238, ic))
      // 육지
      const inland = near[k]
      let dry = Math.exp(-(((a - 24) / 11) ** 2)) * 0.85 + (inland - 0.6) * 0.5 + (n - 0.5) * 0.9
      const rg = (cl, cn, rl, rn) => Math.exp(-(((lat - cl) / rl) ** 2) - (((lon - cn) / rn) ** 2))
      dry += 0.45 * rg(22, 12, 10, 28) // 사하라
      dry += 0.35 * rg(24, 47, 8, 12) // 아라비아
      dry += 0.35 * rg(-25, 133, 8, 15) // 호주 내륙
      dry += 0.3 * rg(42, 95, 6, 18) // 타클라마칸·고비
      dry -= 0.9 * rg(20, 100, 12, 30) // 인도·동남아·중국 남부 몬순
      dry -= 0.35 * rg(-5, -60, 14, 18) // 아마존
      const desert = smooth(0.45, 0.7, dry)
      const tropic = 1 - smooth(8, 22, a)
      const boreal = smooth(45, 60, a)
      let r = mix(mix(70, 30, tropic), 48, boreal)
      let g = mix(mix(118, 88, tropic), 82, boreal)
      let b = mix(mix(52, 38, tropic), 58, boreal)
      r = mix(r, mix(214, 178, n), desert)
      g = mix(g, mix(184, 138, n), desert)
      b = mix(b, mix(128, 92, n), desert)
      const mount = smooth(0.66, 0.8, n)
      r = mix(r, 122, mount * 0.6); g = mix(g, 104, mount * 0.6); b = mix(b, 82, mount * 0.6)
      const tundra = smooth(58, 68, a + (n - 0.5) * 8)
      r = mix(r, 128, tundra); g = mix(g, 124, tundra); b = mix(b, 100, tundra)
      let snow = smooth(68, 76, a + (n - 0.5) * 6)
      if (lat < -60) snow = 1
      if (lat > 60 && lon > -60 && lon < -15) snow = Math.max(snow, 0.95) // 그린란드
      r = mix(r, 240, snow); g = mix(g, 244, snow); b = mix(b, 248, snow)
      r += (n - 0.5) * 18; g += (n - 0.5) * 18; b += (n - 0.5) * 14
      landCol[k * 3] = clampB(r); landCol[k * 3 + 1] = clampB(g); landCol[k * 3 + 2] = clampB(b)
      // 도시 불빛 밀도
      const coast = 1 - smooth(0.55, 0.95, inland)
      const p = sampleHalf(nP, i, j) * (1 - desert * 0.85) * (1 - snow) * (1 - tundra * 0.8) * (0.35 + coast * 0.9) * (1 - tropic * 0.35)
      // 실제로 밤에 매우 어두운 지역(북한·중앙아프리카·시베리아 내륙·아마존 등)
      const dark = Math.min(1,
        0.95 * rg(40, 127, 1.7, 1.6) + 0.8 * rg(2, 22, 12, 14) + 0.7 * rg(62, 105, 9, 35) +
        0.7 * rg(-6, -62, 10, 12) + 0.6 * rg(-22, 128, 9, 14) + 0.6 * rg(47, 100, 4, 12))
      const glowField = smooth(0.4, 0.66, p) * 12
      const sparkle = p > 0.42 && hash3(i, j, 7, 3) < (p - 0.42) * 1.6 ? 25 + hash3(i, j, 9, 5) * 45 : 0
      lights[k] = Math.min(255, (glowField + sparkle) * (1 - dark))
    }
  }

  // 구름
  const nc = sphereNoise(CW, CH, 4.2, 53, 7, 1.6)
  const clouds = new Uint8Array(CW * CH)
  for (let j = 0; j < CH; j++) {
    const lat = Math.abs(90 - ((j + 0.5) / CH) * 180)
    const bias = 0.06 * Math.exp(-((lat / 8) ** 2)) + 0.07 * Math.exp(-(((lat - 52) / 12) ** 2)) - 0.06 * Math.exp(-(((lat - 25) / 8) ** 2))
    for (let i = 0; i < CW; i++) clouds[j * CW + i] = Math.pow(smooth(0.47, 0.74, nc[j * CW + i] + bias), 1.4) * 235
  }

  // 고해상도 SDF가 오기 전까지 쓸 저해상도 해안선 거리장
  const lo = blur(land, TW, TH, 1, 2)
  const sdfLow = new Uint8Array(N)
  for (let k = 0; k < N; k++) sdfLow[k] = clampB(128 + (lo[k] - 0.5) * 230)

  return { landCol, oceanCol, ice, lights, cityLights: splatMetros(), nearTex, clouds, sdf: { w: TW, h: TH, data: sdfLow, K: 1.6 } }
}

// 순환(가로)·클램프(세로) 바이리니어 샘플 — 1채널
function bil1(arr, w, h, fx, fy) {
  let x0 = Math.floor(fx); const wx = fx - x0
  let y0 = Math.floor(fy); const wy = fy - y0
  x0 = ((x0 % w) + w) % w
  const x1 = x0 + 1 === w ? 0 : x0 + 1
  if (y0 < 0) y0 = 0
  const y1 = y0 + 1 >= h ? h - 1 : y0 + 1
  if (y0 >= h) y0 = h - 1
  const a = arr[y0 * w + x0], b = arr[y0 * w + x1], c = arr[y1 * w + x0], d = arr[y1 * w + x1]
  return (a + (b - a) * wx) * (1 - wy) + (c + (d - c) * wx) * wy
}
// 3채널 바이리니어 → out[0..2]
function bil3(arr, w, h, fx, fy, out) {
  let x0 = Math.floor(fx); const wx = fx - x0
  let y0 = Math.floor(fy); const wy = fy - y0
  x0 = ((x0 % w) + w) % w
  const x1 = x0 + 1 === w ? 0 : x0 + 1
  if (y0 < 0) y0 = 0
  const y1 = y0 + 1 >= h ? h - 1 : y0 + 1
  if (y0 >= h) y0 = h - 1
  const i00 = (y0 * w + x0) * 3, i01 = (y0 * w + x1) * 3, i10 = (y1 * w + x0) * 3, i11 = (y1 * w + x1) * 3
  for (let c = 0; c < 3; c++) {
    const a = arr[i00 + c], b = arr[i01 + c], cc = arr[i10 + c], d = arr[i11 + c]
    out[c] = (a + (b - a) * wx) * (1 - wy) + (cc + (d - cc) * wx) * wy
  }
}

export function createEarthRenderer({ sdfUrl } = {}) {
  let tex = null
  let view = { lat: 37.5665, lon: 126.978 }
  let sunAt = 0, sun = null, S = [1, 0, 0]
  let canvas = null, cctx = null, img = null
  let lastKey = ''
  let sdfVersion = 0
  let hiSdf = null

  // 고해상도 해안선 거리장(4096×2048) 비동기 로드
  if (sdfUrl && typeof Image !== 'undefined') {
    const im = new Image()
    im.decoding = 'async'
    im.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = im.naturalWidth; c.height = im.naturalHeight
        const g = c.getContext('2d', { willReadFrequently: true })
        g.drawImage(im, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height).data
        const a = new Uint8Array(c.width * c.height)
        for (let i = 0; i < a.length; i++) a[i] = d[i * 4]
        hiSdf = { w: c.width, h: c.height, data: a, K: 6 }
        sdfVersion++
      } catch { /* 실패 시 저해상도 유지 */ }
    }
    im.src = sdfUrl
  }

  function updateSun() {
    const now = Date.now()
    if (now - sunAt > SUN_REFRESH_MS) {
      sun = subsolarPoint(new Date(now))
      S = vec(sun.lat, sun.lon)
      sunAt = now
    }
  }

  function paint(X, Y, R, bx, by, bw, bh, q, iw, ih, cloudShift) {
    if (!canvas) { canvas = document.createElement('canvas'); cctx = canvas.getContext('2d') }
    if (canvas.width !== iw || canvas.height !== ih) {
      canvas.width = iw; canvas.height = ih
      img = cctx.createImageData(iw, ih)
    }
    const out = img.data
    const { landCol, oceanCol, ice, lights, cityLights, nearTex, clouds } = tex
    const sdf = hiSdf || tex.sdf
    const sw = sdf.w, sh = sdf.h, sd = sdf.data
    const unit = 127 / sdf.K // SDF 값 1텍셀당 단위
    const texelPx = (R * 2 * Math.PI) / sw // SDF 1텍셀의 화면 크기(css px, 적도 기준)
    const edgeW = Math.max(0.8, unit / Math.max(1e-6, texelPx * q))
    const detailAmp = hiSdf ? unit * 0.9 * smooth(1.2, 5, texelPx) : 0
    const fD = (sw / (2 * Math.PI)) * 1.3
    const zoomDetail = smooth(2, 10, (R * 2 * Math.PI) / TW) // 기후 텍스처가 확대돼 보일 때 질감 추가
    const cloudFade = 1 - 0.75 * smooth(1500, 9000, R)
    const litBoost = 1.35 + 1.6 * (1 - smooth(140, 700, R))
    const lightDetail = smooth(3500, 16000, R) // 아주 가까이서만 동네 단위 점묘 // 멀리서 볼 땐 작은 도시 불빛이 묻히지 않게

    const la = view.lat * DEG, lo = view.lon * DEG
    const C = vec(view.lat, view.lon)
    const E0 = -Math.sin(lo), E1 = Math.cos(lo)
    const N0 = -Math.sin(la) * Math.cos(lo), N1 = -Math.sin(la) * Math.sin(lo), N2 = Math.cos(la)
    let H0 = S[0] + C[0], H1 = S[1] + C[1], H2 = S[2] + C[2]
    const hl = Math.hypot(H0, H1, H2) || 1; H0 /= hl; H1 /= hl; H2 /= hl
    const lc = [0, 0, 0], oc = [0, 0, 0]
    const TWO_PI = Math.PI * 2

    for (let j = 0; j < ih; j++) {
      const y = -(by + (j + 0.5) / q - Y) / R
      for (let i = 0; i < iw; i++) {
        const o = (j * iw + i) * 4
        const x = (bx + (i + 0.5) / q - X) / R
        const r2 = x * x + y * y
        if (r2 > 1) {
          const dd = Math.sqrt(r2)
          if (dd > 1 + 1 / (R * q)) { out[o + 3] = 0; continue }
        }
        const z = Math.sqrt(Math.max(0, 1 - r2))
        const Px = x * E0 + y * N0 + z * C[0]
        const Py = x * E1 + y * N1 + z * C[1]
        const Pz = y * N2 + z * C[2]
        const lat = Math.asin(Pz > 1 ? 1 : Pz < -1 ? -1 : Pz)
        const u = Math.atan2(Py, Px) / TWO_PI + 0.5
        const v = 0.5 - lat / Math.PI

        // 해안선: 고해상도 SDF + 확대 시 프랙탈 디테일
        let d = bil1(sd, sw, sh, u * sw - 0.5, v * sh - 0.5)
        let nfine = 0.5, nlit = 0.5
        if (detailAmp > 0) {
          const n1 = vnoise3(Px * fD, Py * fD, Pz * fD, 101)
          const n2 = vnoise3(Px * fD * 2.7, Py * fD * 2.7, Pz * fD * 2.7, 131)
          d += ((n1 - 0.5) * 2 + (n2 - 0.5)) * detailAmp
          nfine = n1 * 0.6 + n2 * 0.4
          nlit = n2 * 0.7 + vnoise3(Px * fD * 7.3, Py * fD * 7.3, Pz * fD * 7.3, 151) * 0.3
        }
        let landA = (d - 128) / edgeW + 0.5
        landA = landA < 0 ? 0 : landA > 1 ? 1 : landA

        const tx = u * TW - 0.5, ty = v * TH - 0.5
        bil3(landCol, TW, TH, tx, ty, lc)
        bil3(oceanCol, TW, TH, tx, ty, oc)
        const ic = bil1(ice, TW, TH, tx, ty) / 255
        // 얕은 바다: 해안 가까이 + 대륙붕
        const nearO = bil1(nearTex, TW, TH, tx, ty) / 255
        let shallow = Math.max(smooth(30, 128, d) * 0.85, smooth(0.04, 0.5, nearO) * 0.55) * (1 - ic)
        const or = oc[0] + (30 - oc[0]) * shallow, og = oc[1] + (104 - oc[1]) * shallow, ob = oc[2] + (146 - oc[2]) * shallow
        // 확대 시 지표 질감
        const tex1 = 1 + (nfine - 0.5) * 0.5 * zoomDetail
        const field = (nfine - 0.5) * 46 * zoomDetail // 들판(황록)·숲(진녹) 얼룩
        let r = or + (lc[0] * tex1 + field - or) * landA
        let g = og + (lc[1] * tex1 + field * 0.6 - og) * landA
        let b = ob + (lc[2] * tex1 - og * 0 - ob) * landA

        // 조명
        const nd = Px * S[0] + Py * S[1] + Pz * S[2]
        const dl = smooth(-0.1, 0.2, nd) * (0.22 + 0.78 * (nd > 0 ? nd : 0))
        const nightK = 1 - smooth(-0.12, 0.03, nd)
        r *= dl; g *= dl; b *= dl
        const wet = (1 - landA) * (1 - ic)
        if (wet > 0.01) {
          const nh = Px * H0 + Py * H1 + Pz * H2
          if (nh > 0.85) {
            const sp = Math.pow(nh, 48) * smooth(-0.05, 0.2, nd) * 220 * wet
            r += sp; g += sp; b += sp * 0.95
          }
        }
        // 구름
        // 밤쪽 구름은 옅게(달빛 수준) — 도시 불빛이 구름 사이로 비치게
        const ca = (bil1(clouds, CW, CH, (u - cloudShift) * CW - 0.5, v * CH - 0.5) / 255) * cloudFade * (0.45 + 0.55 * smooth(-0.15, 0.1, nd))
        // 도시 불빛
        if (nightK > 0.01 && landA > 0.01) {
          let li = bil1(lights, TW, TH, tx, ty) * (1 - 0.6 * zoomDetail) + bil1(cityLights, LW, LH, u * LW - 0.5, v * LH - 0.5)
          li *= litBoost
          li = (li > 255 ? 255 : li) * landA * nightK * (1 - ca * 0.6)
          // 확대하면 불빛이 동네 단위 점들로 쪼개져 보이게
          if (lightDetail > 0) li *= 1 - lightDetail + lightDetail * (0.25 + smooth(0.42, 0.7, nlit) * 1.35)
          r += li * 1.1; g += li * 0.82; b += li * 0.4
        }
        const cl = 245 * (0.05 + dl * 1.05)
        r += (cl - r) * ca; g += (cl - g) * ca; b += (cl * 1.02 - b) * ca
        // 대기 테두리
        const t = 1 - z
        const rm = t * t * Math.sqrt(t) * (0.12 + 0.88 * smooth(-0.3, 0.3, nd))
        r += 70 * rm; g += 140 * rm; b += 255 * rm

        out[o] = r > 255 ? 255 : r
        out[o + 1] = g > 255 ? 255 : g
        out[o + 2] = b > 255 ? 255 : b
        let ea = (1 - Math.sqrt(r2)) * R * q + 0.5
        out[o + 3] = ea >= 1 ? 255 : ea <= 0 ? 0 : ea * 255
      }
    }
    cctx.putImageData(img, 0, 0)
  }

  return {
    /** 화면 정면에 둘 지점(관측자 위치) */
    setView(lat, lon) { view = { lat, lon }; lastKey = '' },
    /** 현재 계산된 태양 직하점 */
    get sun() { return sun || subsolarPoint() },
    /**
     * (X, Y): 지구 중심(화면 css px), R: 반지름(css px), time: 초,
     * W/H: 화면 크기(css px), moving: 줌 중이면 해상도를 낮춰 부드럽게
     */
    draw(ctx, X, Y, R, time, dpr = 1, W = 1e4, H = 1e4, moving = false) {
      if (!tex) tex = buildTextures()
      updateSun()
      const bx = Math.max(0, Math.floor(X - R - 1)), by = Math.max(0, Math.floor(Y - R - 1))
      const ex = Math.min(W, Math.ceil(X + R + 1)), ey = Math.min(H, Math.ceil(Y + R + 1))
      const bw = ex - bx, bh = ey - by
      if (bw <= 0 || bh <= 0) return
      const maxPix = moving ? 110000 : 360000
      const q = Math.min(dpr, Math.sqrt(maxPix / (bw * bh)))
      const iw = Math.max(1, Math.ceil(bw * q)), ih = Math.max(1, Math.ceil(bh * q))
      // 구름은 아주 천천히(10초 단위로) 흐름
      const cloudShift = ((Math.floor(time / 10) * 10) / CLOUD_PERIOD) % 1

      if (R < Math.max(W, H) * 2) {
        const glow = ctx.createRadialGradient(X, Y, R * 0.98, X, Y, R * 1.12)
        glow.addColorStop(0, 'rgba(110,170,255,0.55)')
        glow.addColorStop(1, 'rgba(110,170,255,0)')
        ctx.fillStyle = glow
        ctx.beginPath(); ctx.arc(X, Y, R * 1.12, 0, Math.PI * 2); ctx.fill()
      }
      const key = [X.toFixed(1), Y.toFixed(1), R.toFixed(2), iw, ih, sunAt, cloudShift, sdfVersion, view.lat, view.lon].join('|')
      if (key !== lastKey) {
        paint(X, Y, R, bx, by, bw, bh, q, iw, ih, cloudShift)
        lastKey = key
      }
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(canvas, 0, 0, iw, ih, bx, by, bw, bh)
    },
    /** 위도·경도(도)를 화면 좌표로. z<0 이면 지구 뒤편 */
    project(latDeg, lonDeg, X, Y, R) {
      const p = vec(latDeg, lonDeg)
      const lo = view.lon * DEG, la = view.lat * DEG
      const C = vec(view.lat, view.lon)
      const E = [-Math.sin(lo), Math.cos(lo), 0]
      const Nn = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)]
      const x = p[0] * E[0] + p[1] * E[1] + p[2] * E[2]
      const y = p[0] * Nn[0] + p[1] * Nn[1] + p[2] * Nn[2]
      const z = p[0] * C[0] + p[1] * C[1] + p[2] * C[2]
      return { x: X + x * R, y: Y - y * R, z }
    },
    warmup() { if (!tex) tex = buildTextures() },
  }
}
