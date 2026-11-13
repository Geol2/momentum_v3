// 내 주변 도로 — OpenFreeMap 벡터 타일(OpenMapTiles 스키마, OSM 데이터)에서 도로 선만 꺼냄
// CDN에 올려진 정적 타일이라 Overpass 같은 공용 질의 서버보다 빠르고 잘 안 막힘.
// 의존성 없이 쓰려고 Mapbox Vector Tile(protobuf) 해석기를 직접 작게 구현.

const td = new TextDecoder()

// 필요한 레이어(transportation)의 선만 [x,y,...] (타일 좌표)로 꺼냄
export function readRoadLines(buf, layerName = 'transportation') {
  const d = new Uint8Array(buf)
  let p = 0
  const varint = () => {
    let r = 0, s = 1, b
    do { b = d[p++]; r += (b & 0x7f) * s; s *= 128 } while (b & 0x80)
    return r
  }
  const skip = (wt) => {
    if (wt === 0) varint()
    else if (wt === 1) p += 8
    else if (wt === 2) { const l = varint(); p += l }
    else if (wt === 5) p += 4
    else throw new Error('mvt wire ' + wt)
  }
  const packed = (end) => { const a = []; while (p < end) a.push(varint()); return a }
  const zz = (n) => (n % 2 ? -(n + 1) / 2 : n / 2)
  const out = []
  while (p < d.length) {
    const tag = varint(), f = Math.floor(tag / 8), wt = tag & 7
    if (f !== 3 || wt !== 2) { skip(wt); continue }
    const end = varint() + p
    let name = '', extent = 4096
    const keys = [], vals = [], feats = []
    while (p < end) {
      const t = varint(), lf = t >> 3, lw = t & 7
      if (lf === 1) { const l = varint(); name = td.decode(d.subarray(p, p + l)); p += l }
      else if (lf === 2) { const l = varint(); feats.push([p, p + l]); p += l }
      else if (lf === 3) { const l = varint(); keys.push(td.decode(d.subarray(p, p + l))); p += l }
      else if (lf === 4) {
        const e = varint() + p
        let v = null
        while (p < e) { const vt = varint(); if (vt >> 3 === 1) { const l = varint(); v = td.decode(d.subarray(p, p + l)); p += l } else skip(vt & 7) }
        vals.push(v)
      } else if (lf === 5) extent = varint()
      else skip(lw)
    }
    if (name === layerName) {
      const save = end, ci = keys.indexOf('class')
      for (const [s, e] of feats) {
        p = s
        let tags = [], type = 0, geom = null
        while (p < e) {
          const t = varint(), ff = t >> 3, fw = t & 7
          if (ff === 2 && fw === 2) tags = packed(varint() + p)
          else if (ff === 3) type = varint()
          else if (ff === 4 && fw === 2) geom = packed(varint() + p)
          else skip(fw)
        }
        if (type !== 2 || !geom) continue
        let cls = null
        for (let k = 0; k < tags.length; k += 2) if (tags[k] === ci) { cls = vals[tags[k + 1]]; break }
        // 선 꺼내기 (MoveTo=1, LineTo=2, ClosePath=7, 지그재그 부호)
        let x = 0, y = 0, line = null, i = 0
        while (i < geom.length) {
          const c = geom[i++], cmd = c & 7, cnt = c >> 3
          if (cmd === 7) continue
          for (let k = 0; k < cnt; k++) {
            x += zz(geom[i++]); y += zz(geom[i++])
            if (cmd === 1) { if (line && line.length > 2) out.push({ cls, pts: line, extent }); line = [x, y] }
            else line.push(x, y)
          }
        }
        if (line && line.length > 2) out.push({ cls, pts: line, extent })
      }
      p = save
    }
    p = end
  }
  return out
}

// 화면 폭 단계별로 받을 확대 수준과 도로 등급
const LV = [
  { z: 10, maj: ['motorway', 'trunk', 'primary'], min: [] },
  { z: 12, maj: ['motorway', 'trunk', 'primary', 'secondary'], min: ['tertiary'] },
  { z: 14, maj: ['motorway', 'trunk', 'primary', 'secondary'], min: ['tertiary', 'minor'] },
]

let tpl = null
async function template() {
  if (tpl) return tpl
  const r = await fetch('https://tiles.openfreemap.org/planet', { signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error('openfreemap ' + r.status)
  const j = await r.json()
  tpl = j.tiles[0]
  return tpl
}

const tileCache = new Map() // 'z/x/y' → 해석된 선 (최근 것만)
const cachePut = (k, v) => { tileCache.delete(k); tileCache.set(k, v); while (tileCache.size > 160) tileCache.delete(tileCache.keys().next().value) }

const lon2x = (lon, n) => ((lon + 180) / 360) * n
const lat2y = (lat, n) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * n

// 상자 [lon0, lat0, lon1, lat1] 안의 도로 → { maj: [Float32Array(lon,lat,...)], min: [...] }
export async function fetchRoads(b, lvl, isDead) {
  const L = LV[lvl]
  let z = L.z, x0, x1, y0, y1
  // 타일이 너무 많으면 한 단계 낮춤
  for (;;) {
    const n = 2 ** z
    x0 = Math.floor(lon2x(b[0], n)); x1 = Math.floor(lon2x(b[2], n))
    y0 = Math.floor(lat2y(b[3], n)); y1 = Math.floor(lat2y(b[1], n))
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 36 || z <= 8) break
    z--
  }
  const url = await template()
  const n = 2 ** z
  const jobs = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y])
  const res = { maj: [], min: [] }
  const majS = new Set(L.maj), minS = new Set(L.min)
  let ok = 0
  const one = async ([x, y]) => {
    const key = `${z}/${x}/${y}`
    let lines = tileCache.get(key)
    if (!lines) {
      const r = await fetch(url.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal: AbortSignal.timeout(20000) })
      if (r.status === 204 || r.status === 404) lines = []
      else if (!r.ok) throw new Error('tile ' + r.status)
      else lines = readRoadLines(await r.arrayBuffer())
      cachePut(key, lines)
    }
    ok++
    for (const { cls, pts, extent } of lines) {
      const c = cls && cls.replace(/_construction$/, '')
      const dst = majS.has(c) ? res.maj : minS.has(c) ? res.min : null
      if (!dst) continue
      const a = new Float32Array(pts.length)
      for (let k = 0; k < pts.length; k += 2) {
        a[k] = ((x + pts[k] / extent) / n) * 360 - 180
        const yy = (y + pts[k + 1] / extent) / n
        a[k + 1] = (Math.atan(Math.sinh(Math.PI * (1 - 2 * yy))) * 180) / Math.PI
      }
      dst.push(a)
    }
  }
  // 동시에 6개씩
  let qi = 0, lastErr = null
  await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, async () => {
    while (qi < jobs.length && !isDead()) { const j = jobs[qi++]; try { await one(j) } catch (e) { lastErr = e } }
  }))
  if (!ok && lastErr) throw lastErr
  return res
}
