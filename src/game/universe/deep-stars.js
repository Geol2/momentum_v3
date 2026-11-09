// 맨눈 밖의 별 약 11만 개 (AT-HYG v3.2 HYGLike · Gaia DR3 거리 · CC BY-SA 4.0) — 바이너리로 압축 저장
// 형식(리틀 엔디언): Uint32 N | Float32 ly[N] | Uint32 id[N] | Uint16 ra[N] | Int16 dec[N] |
//                   Uint8 mag×10[N] | Int8 bv×50[N] | Uint8 con[N] | Uint8 sp[N] | Uint8 idKind[N]
import deepUrl from './stars-deep.bin?url';

let promise = null;
export function loadDeepStars() {
  if (!promise) {
    promise = fetch(deepUrl).then((r) => { if (!r.ok) throw new Error('deep stars'); return r.arrayBuffer(); }).then((buf) => {
      const N = new DataView(buf).getUint32(0, true);
      let o = 4;
      const take = (T, bytes) => { const a = new T(buf, o, N); o += N * bytes; return a; };
      const ly = take(Float32Array, 4), id = take(Uint32Array, 4);
      const raU = take(Uint16Array, 2), decI = take(Int16Array, 2);
      const mag = take(Uint8Array, 1), bv = take(Int8Array, 1), con = take(Uint8Array, 1), sp = take(Uint8Array, 1), kind = take(Uint8Array, 1);
      const ra = new Float32Array(N), dec = new Float32Array(N);
      for (let i = 0; i < N; i++) { ra[i] = (raU[i] / 65535) * 360; dec[i] = (decI[i] / 32767) * 90; }
      return { N, ly, id, ra, dec, mag, bv, con, sp, kind };
    });
    promise.catch(() => { promise = null; });
  }
  return promise;
}

const CLS = 'OBAFGKMD';
const LUM = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
/** 분광 코드 → 분광형 비슷한 문자열 (starTypeKo 에 넘기기용) */
export function deepSpect(code) {
  if (code === 255) return '';
  const c = CLS[(code / 8) | 0] || '', l = code % 8;
  if (c === 'D') return 'DA';
  if (l === 6) return 'sd' + c;
  return c + (LUM[l] || '');
}
export function deepName(d, i) {
  return d.kind[i] === 1 ? `HIP ${d.id[i]}` : d.kind[i] === 2 ? `HD ${d.id[i]}` : `AT-HYG ${d.id[i]}`;
}
/** B-V 색지수 → [r,g,b] 0~255 */
export function bvRgb(bv) {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  // 간단한 흑체 근사
  const k = t / 100;
  let r, g, b;
  if (k <= 66) { r = 255; g = 99.47 * Math.log(k) - 161.12; b = k <= 19 ? 0 : 138.52 * Math.log(k - 10) - 305.04; }
  else { r = 329.7 * Math.pow(k - 60, -0.1332); g = 288.12 * Math.pow(k - 60, -0.0755); b = 255; }
  const c = (x) => Math.max(0, Math.min(255, x));
  return [c(r), c(g), c(b)];
}

// ── 수백만 개: AT-HYG v3.2 전체 중 나머지 약 237만 개 (밝은 순 6개 묶음, 필요할 때만) ──
// 형식: Uint32 N | Uint16 ra | Int16 dec | Uint16 log10(광년)/6 | Uint16 tyc1 | Uint16 tyc2 | Uint8 mag×10 | Int8 bv×50 | Uint8 sp | Uint8 con | Uint8 tyc3
import mega1 from './stars-mega-1.bin?url';
import mega2 from './stars-mega-2.bin?url';
import mega3 from './stars-mega-3.bin?url';
import mega4 from './stars-mega-4.bin?url';
import mega5 from './stars-mega-5.bin?url';
import mega6 from './stars-mega-6.bin?url';
export const MEGA_URLS = [mega1, mega2, mega3, mega4, mega5, mega6];
export const MEGA_TOTAL = 2372675;
export const MEGA_MB = 26;
export async function loadMegaChunk(k) {
  const r = await fetch(MEGA_URLS[k]);
  if (!r.ok) throw new Error('mega ' + k);
  const buf = await r.arrayBuffer();
  const N = new DataView(buf).getUint32(0, true);
  let o = 4;
  const take = (T, bytes) => { const a = new T(buf, o, N); o += N * bytes; return a; };
  const raU = take(Uint16Array, 2), decI = take(Int16Array, 2), lyU = take(Uint16Array, 2), t1 = take(Uint16Array, 2), t2 = take(Uint16Array, 2);
  const mag = take(Uint8Array, 1), bv = take(Int8Array, 1), sp = take(Uint8Array, 1), con = take(Uint8Array, 1), t3 = take(Uint8Array, 1);
  const ra = new Float32Array(N), dec = new Float32Array(N), ly = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    ra[i] = (raU[i] / 65535) * 360; dec[i] = (decI[i] / 32767) * 90; ly[i] = Math.pow(10, (lyU[i] / 65535) * 6);
  }
  return { N, ra, dec, ly, mag, bv, sp, con, t1, t2, t3, mega: true };
}
/** 묶음/기본 목록 공통 이름 */
export function starId(d, i) {
  if (d.mega) return d.t1[i] ? `TYC ${d.t1[i]}-${d.t2[i]}-${d.t3[i]}` : 'Gaia 별';
  return deepName(d, i);
}
