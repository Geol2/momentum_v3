/**
 * Generates the PWA icons in public/ (night sky + crescent moon, matching the app's theme).
 *
 * These have to be real PNGs: iOS only offers "홈 화면에 추가" — the install step that
 * makes Web Push work at all on iPhone — with a proper apple-touch-icon, and Android's
 * install prompt requires 192px and 512px entries in the manifest. SVG won't do.
 *
 *   node scripts/generate-icons.mjs
 *
 * Pure Node (zlib + a minimal PNG encoder), so there's no image dependency to install.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// ── minimal PNG encoder ──────────────────────────────────────────────────────
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** rgba: Buffer of size w*h*4. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // colour type: RGBA
  // 10-12: compression / filter / interlace — all 0 (deflate, adaptive, none)

  // Each scanline is prefixed with its filter byte; 0 = None, which compresses fine here.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const src = y * width * 4
    const dst = y * (width * 4 + 1)
    raw[dst] = 0
    rgba.copy(raw, dst + 1, src, src + width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── the artwork ──────────────────────────────────────────────────────────────
const STARS = [
  [0.20, 0.18, 0.9], [0.78, 0.14, 0.7], [0.30, 0.74, 0.8],
  [0.86, 0.62, 0.6], [0.13, 0.50, 0.5], [0.62, 0.85, 0.55],
]

/** Colour of one pixel, sampled at fractional coordinates in the unit square. */
function shade(u, v) {
  // Night sky: deep navy, lifting slightly toward the top-left.
  const glow = Math.max(0, 1 - Math.hypot(u - 0.32, v - 0.28) * 1.15)
  let r = 10 + glow * 26
  let g = 14 + glow * 34
  let b = 34 + glow * 58

  // Stars — small soft points.
  for (const [sx, sy, mag] of STARS) {
    const d = Math.hypot(u - sx, v - sy)
    const i = Math.max(0, 1 - d / 0.035) ** 2 * mag
    r += i * 220; g += i * 232; b += i * 255
  }

  // Crescent: a moon disc with an offset disc bitten out of it.
  const inMoon = Math.hypot(u - 0.50, v - 0.50) <= 0.30
  const inBite = Math.hypot(u - 0.62, v - 0.40) <= 0.27
  if (inMoon && !inBite) {
    // Warm ivory, a touch brighter along the outer edge.
    const edge = Math.hypot(u - 0.50, v - 0.50) / 0.30
    r = 244 - edge * 14; g = 238 - edge * 18; b = 206 + edge * 10
  }

  return [Math.min(255, r), Math.min(255, g), Math.min(255, b)]
}

function render(size) {
  const SS = 3 // supersampling factor — cheap anti-aliasing on the crescent's edges
  const rgba = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [pr, pg, pb] = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)
          r += pr; g += pg; b += pb
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      rgba[i] = Math.round(r / n)
      rgba[i + 1] = Math.round(g / n)
      rgba[i + 2] = Math.round(b / n)
      rgba[i + 3] = 255 // opaque: iOS composites transparency onto black and it looks wrong
    }
  }
  return encodePng(size, size, rgba)
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(join(OUT_DIR, name), render(size))
  console.log(`wrote public/${name} (${size}×${size})`)
}
