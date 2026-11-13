// 내 주변 도로 — OpenFreeMap 벡터 타일(OpenMapTiles 스키마, OSM 데이터)에서 도로 선만 꺼냄
// CDN에 올려진 정적 타일이라 Overpass 같은 공용 질의 서버보다 빠르고 잘 안 막힘.
// 의존성 없이 쓰려고 Mapbox Vector Tile(protobuf) 해석기를 직접 작게 구현.

const td = new TextDecoder()

// transportation 레이어의 선(도로·철도)과 poi 레이어의 역(점)을 타일 좌표로 꺼냄
// 선: { cls, sub, tunnel, pts, extent } / 역: { station: true, name, sub, pts:[x,y], extent }
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
    const isPoi = name === 'poi'
    if (name === layerName || isPoi) {
      const save = end, ci = keys.indexOf('class'), si = keys.indexOf('subclass'), bi = keys.indexOf('brunnel')
      const ni = keys.indexOf('name:ko'), n0 = keys.indexOf('name')
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
        if (!geom || (isPoi ? type !== 1 : type !== 2)) continue
        let cls = null, sub = null, br = null, nm = null, nm0 = null
        for (let k = 0; k < tags.length; k += 2) {
          const kk = tags[k], vv = vals[tags[k + 1]]
          if (kk === ci) cls = vv; else if (kk === si) sub = vv; else if (kk === bi) br = vv
          else if (kk === ni) nm = vv; else if (kk === n0) nm0 = vv
        }
        if (isPoi) {
          // 지하철·전철역만
          if (cls !== 'railway' || !/^(subway|station|halt|light_rail)$/.test(sub || '') || geom.length < 3) continue
          out.push({ station: true, name: nm || nm0, sub, pts: [zz(geom[1]), zz(geom[2])], extent })
          continue
        }
        // 선 꺼내기 (MoveTo=1, LineTo=2, ClosePath=7, 지그재그 부호)
        let x = 0, y = 0, line = null, i = 0
        while (i < geom.length) {
          const c = geom[i++], cmd = c & 7, cnt = c >> 3
          if (cmd === 7) continue
          for (let k = 0; k < cnt; k++) {
            x += zz(geom[i++]); y += zz(geom[i++])
            if (cmd === 1) { if (line && line.length > 2) out.push({ cls, sub, tunnel: br === 'tunnel', pts: line, extent }); line = [x, y] }
            else line.push(x, y)
          }
        }
        if (line && line.length > 2) out.push({ cls, sub, tunnel: br === 'tunnel', pts: line, extent })
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
export async function template() {
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
  const res = { maj: [], min: [], rail: [], stations: [] }
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
    const toLL = (pts, extent) => {
      const a = new Float32Array(pts.length)
      for (let k = 0; k < pts.length; k += 2) {
        a[k] = ((x + pts[k] / extent) / n) * 360 - 180
        const yy = (y + pts[k + 1] / extent) / n
        a[k + 1] = (Math.atan(Math.sinh(Math.PI * (1 - 2 * yy))) * 180) / Math.PI
      }
      return a
    }
    for (const L of lines) {
      if (L.station) { if (L.name) { const a = toLL(L.pts, L.extent); res.stations.push({ name: L.name, sub: L.sub, lon: a[0], lat: a[1] }) } continue }
      const c = L.cls && L.cls.replace(/_construction$/, '')
      // 지하철(지하 구간) — 지하세계 표시용
      if ((c === 'transit' || c === 'rail') && (L.sub === 'subway' || L.tunnel)) { res.rail.push(toLL(L.pts, L.extent)); continue }
      const dst = majS.has(c) ? res.maj : minS.has(c) ? res.min : null
      if (dst) dst.push(toLL(L.pts, L.extent))
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

// 범용: 원하는 레이어들의 도형(선·면·점)과 속성을 타일 좌표로 꺼냄 (3D 건물용)
// 반환: { 레이어명: [{ type, props, rings: [[x,y,...], ...], extent }] }
export function decodeTile(buf, want) {
  const d = new Uint8Array(buf)
  let p = 0
  const varint = () => { let r = 0, s = 1, b; do { b = d[p++]; r += (b & 0x7f) * s; s *= 128 } while (b & 0x80); return r }
  const skip = (wt) => { if (wt === 0) varint(); else if (wt === 1) p += 8; else if (wt === 2) { const l = varint(); p += l } else if (wt === 5) p += 4; else throw new Error('mvt wire ' + wt) }
  const packed = (end) => { const a = []; while (p < end) a.push(varint()); return a }
  const zz = (n) => (n % 2 ? -(n + 1) / 2 : n / 2)
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
  const out = {}
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
        while (p < e) {
          const vt = varint(), vf = vt >> 3, vw = vt & 7
          if (vf === 1) { const l = varint(); v = td.decode(d.subarray(p, p + l)); p += l }
          else if (vf === 2) { v = dv.getFloat32(p, true); p += 4 }
          else if (vf === 3) { v = dv.getFloat64(p, true); p += 8 }
          else if (vf === 4 || vf === 5) v = varint()
          else if (vf === 6) v = zz(varint())
          else if (vf === 7) v = !!varint()
          else skip(vw)
        }
        vals.push(v)
      } else if (lf === 5) extent = varint()
      else skip(lw)
    }
    if (want.has(name)) {
      const list = out[name] || (out[name] = [])
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
        if (!geom) continue
        const props = {}
        for (let k = 0; k < tags.length; k += 2) props[keys[tags[k]]] = vals[tags[k + 1]]
        const rings = []
        let x = 0, y = 0, ring = null, i = 0
        while (i < geom.length) {
          const c = geom[i++], cmd = c & 7, cnt = c >> 3
          if (cmd === 7) { if (ring) { rings.push(ring); ring = null } continue }
          for (let k = 0; k < cnt; k++) {
            x += zz(geom[i++]); y += zz(geom[i++])
            if (cmd === 1) { if (ring && ring.length >= 2) rings.push(ring); ring = [x, y] } else ring.push(x, y)
          }
        }
        if (ring && ring.length >= 2) rings.push(ring)
        list.push({ type, props, rings, extent })
      }
    }
    p = end
  }
  return out
}
