/**
 * 스토어 에셋 생성기 (참고용 — 프로젝트 의존성에 넣지 않음).
 *
 *   1) 공식 시뮬레이터를 --automation-port 9898 로 띄우고 /api/screenshot/glasses 로
 *      s1-home.png, s2-vocab-front.png, s3-vocab-back.png, s6-sqld-back.png 를 한 폴더에 캡처
 *   2) npm i pngjs (임시 폴더에서) 후: node make-assets.mjs <캡처폴더> <출력폴더>
 */
// 달빛 서랍 Even Hub 스토어 에셋 생성: 아이콘(24x24), 커버, 스크린샷(회색조 버전 포함)
import { PNG } from 'pngjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
const [, , SHOTS, OUT] = process.argv
mkdirSync(join(OUT, 'screenshots'), { recursive: true })
const save = (png, name) => { writeFileSync(join(OUT, name), PNG.sync.write(png)); console.log('wrote', name, png.width + 'x' + png.height) }

// ---------- 아이콘: 12x12 그리드(초승달 + 별) → 2x 확대, 보이는 픽셀은 전부 #F4F4F4 ----------
const GRID = [
  '............',
  '....####....',
  '..####......',
  '.###.....#..',
  '.###........',
  '###.........',
  '###.........',
  '.###......#.',
  '.###........',
  '..####......',
  '....####....',
  '............',
]
const icon = new PNG({ width: 24, height: 24 })
for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
  const on = GRID[y >> 1][x >> 1] === '#'
  const i = (y * 24 + x) * 4
  icon.data.set(on ? [244, 244, 244, 255] : [0, 0, 0, 0], i)
}
save(icon, 'icon-24.png')
// 확인용 확대본(제출용 아님)
const big = new PNG({ width: 240, height: 240 })
for (let y = 0; y < 240; y++) for (let x = 0; x < 240; x++) {
  const s = ((Math.floor(y / 10) * 24) + Math.floor(x / 10)) * 4, d = (y * 240 + x) * 4
  const on = icon.data[s + 3] > 0
  big.data.set(on ? [244, 244, 244, 255] : [24, 24, 24, 255], d)
}
save(big, 'icon-preview-240.png')

// ---------- 스크린샷: 시뮬레이터 RGBA(밝기=알파) → 회색조, 검은 배경 ----------
function loadLit(file) {
  const p = PNG.sync.read(readFileSync(join(SHOTS, file)))
  const lum = new Float32Array(p.width * p.height)
  for (let i = 0; i < lum.length; i++) lum[i] = p.data[i * 4 + 3] / 255
  return { w: p.width, h: p.height, lum }
}
function toPng({ w, h, lum }, tint) {
  const p = new PNG({ width: w, height: h })
  for (let i = 0; i < lum.length; i++) {
    const v = lum[i]
    p.data.set(tint ? [0, Math.round(255 * v), 0, 255] : [Math.round(244 * v), Math.round(244 * v), Math.round(244 * v), 255], i * 4)
  }
  return p
}
const SHOT_LIST = [
  ['s1-home.png', '1-home'],
  ['s2-vocab-front.png', '2-vocab-front'],
  ['s3-vocab-back.png', '3-vocab-back'],
  ['s6-sqld-back.png', '4-sqld-back'],
]
const lits = {}
for (const [src, name] of SHOT_LIST) {
  const lit = loadLit(src.replace('-flat', ''))
  lits[name] = lit
  save(toPng(lit, false), `screenshots/${name}.png`)
  save(toPng(lit, true), `screenshots/${name}-green.png`)
}

// ---------- 커버: 1152x576 (안경 화면 2:1 비율), 회색조 ----------
const W = 1152, H = 576
const cover = new Float32Array(W * H) // 0..1 밝기
const put = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) cover[y * W + x] = Math.max(cover[y * W + x], v) }
// 별 (고정 시드)
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
for (let n = 0; n < 140; n++) {
  const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H), b = 0.25 + rnd() * 0.6, s = rnd() < 0.12 ? 2 : 1
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) put(x + dx, y + dy, b)
}
// 초승달 (안티에일리어싱)
const cx = 300, cy = 288, R = 170, ox = 70, oy = -45, R2 = 150
for (let y = cy - R - 2; y <= cy + R + 2; y++) for (let x = cx - R - 2; x <= cx + R + 2; x++) {
  const d1 = Math.hypot(x - cx, y - cy), d2 = Math.hypot(x - (cx + ox), y - (cy + oy))
  const a = Math.min(Math.max(R - d1 + 0.5, 0), 1) * Math.min(Math.max(d2 - R2 + 0.5, 0), 1)
  if (a > 0) put(x, y, 0.96 * a)
}
// 제목·메뉴: 실제 안경 화면에서 잘라 확대(안경에 보이는 글꼴 그대로)
function blit(lit, sx, sy, sw, sh, dx, dy, scale, gain = 1) {
  for (let y = 0; y < sh * scale; y++) for (let x = 0; x < sw * scale; x++) {
    const v = lit.lum[(sy + Math.floor(y / scale)) * lit.w + sx + Math.floor(x / scale)]
    if (v > 0) cover[(dy + y) * W + dx + x] = Math.min(1, v * gain)
  }
}
const home = lits['1-home']
blit(home, 0, 0, 80, 28, 560, 150, 4)          // "달빛 서랍"
blit(home, 0, 40, 120, 108, 580, 300, 2, 0.8)  // 메뉴 목록
const cp = new PNG({ width: W, height: H })
for (let i = 0; i < cover.length; i++) { const g = Math.round(cover[i] * 244); cp.data.set([g, g, g, 255], i * 4) }
save(cp, 'cover-1152x576.png')
