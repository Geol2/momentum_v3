// 우주 탐험 — universe-explorer.js에서 분리한 모듈 (동작 동일)
import { LY, AU, C } from './ux-consts.js';

// ───────────────────────── 포맷 ─────────────────────────
function trimNum(v) {
  if (v >= 100) return Math.round(v).toLocaleString('ko-KR');
  if (v >= 10) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(2).replace(/\.?0+$/, '');
}
function fmtKo(n) {
  if (n >= 1e8) return trimNum(n / 1e8) + '억';
  if (n >= 1e4) return trimNum(n / 1e4) + '만';
  return trimNum(n);
}
function fmtLy(ly) {
  return ly < 100 ? `${trimNum(ly)}광년` : `${fmtKo(Math.round(ly))}광년`;
}
function fmtMly(mly) { // 백만 광년 단위 → 한국어
  return mly < 100 ? `${fmtKo(mly * 100)}만 광년` : `${trimNum(Math.round(mly / 10) / 10)}억 광년`;
}
// 태양계 행성 [평균 온도, 자전·하루]
const PLANET_PHYS = {
  수성: ['평균 167°C (밤 -173°C ~ 낮 427°C)', '자전 58.6일 · 하루(해 뜨고 다시 뜨기까지) 176일'],
  금성: ['평균 464°C (납이 녹는 온도, 밤낮 비슷)', '자전 243일 (거꾸로) · 하루 117일'],
  지구: ['평균 15°C', '자전 23시간 56분 · 하루 24시간'],
  화성: ['평균 -63°C (여름 낮 20°C ~ 밤 -140°C)', '자전 24시간 37분 · 하루 24시간 40분'],
  목성: ['구름 꼭대기 약 -110°C', '자전 9시간 56분 (태양계에서 가장 빠름)'],
  토성: ['구름 꼭대기 약 -140°C', '자전 10시간 33분'],
  천왕성: ['구름 꼭대기 약 -195°C (가장 추운 대기 -224°C)', '자전 17시간 14분 · 98° 누워서 거꾸로'],
  해왕성: ['구름 꼭대기 약 -200°C', '자전 16시간 6분'],
};
// 주요 위성 평균 표면 온도(°C, 대략)
const MOON_TEMP = { 포보스: -40, 데이모스: -40, 이오: -143, 유로파: -160, 가니메데: -163, 칼리스토: -139, 미마스: -209, 엔켈라두스: -198, 테티스: -187, 디오네: -186, 레아: -195, 타이탄: -179, 이아페투스: -160, 미란다: -187, 아리엘: -213, 움브리엘: -198, 티타니아: -203, 오베론: -198, 트리톤: -235, 네레이드: -222 };
const DSO_KO = { neb: '발광 성운', pn: '행성상 성운', snr: '초신성 잔해', oc: '산개성단', gc: '구상성단', bh: '블랙홀', psr: '펄서', mag: '마그네타', ns: '중성자별', bd: '갈색왜성', star: '특이한 별', cloud: '별 구름', planet: '외계 행성' };
const DEEP_KO = { bh: '초대질량 블랙홀', grp: '은하군', cl: '은하단', sc: '초은하단', wall: '거대 구조', void: '보이드(빈 공간)', far: '가장 먼 천체', gal: '거대 은하' };
// 분광형 → "적색 초거성" 같은 한국어 설명
function starTypeKo(sp) {
  if (!sp) return '별';
  const u = sp.toUpperCase();
  if (/^D[ABOQZC]?/.test(u)) return '백색왜성';
  if (u.startsWith('W')) return '볼프-레이에 별';
  if (u.startsWith('C') || u.startsWith('N') || u.startsWith('R')) return '탄소별';
  const sd = u.startsWith('SD');
  const m = (sd ? u.slice(2) : u).match(/^([OBAFGKMS])/);
  if (!m) return '별';
  const col = { O: '청색', B: '청백색', A: '백색', F: '황백색', G: '황색', K: '주황색', M: '적색', S: '적색' }[m[1]];
  if (sd) return `${col} 준왜성`;
  const rest = u.slice(1).replace(/^[0-9.\-/]*/, '');
  const lc = rest.match(/(III|II|IV|VI|V|I(?:AB|A|B)?|0)/);
  const lum = !lc ? '별' : lc[1] === 'V' ? '주계열성' : lc[1] === 'IV' ? '준거성' : lc[1] === 'III' ? '거성' : lc[1] === 'II' ? '밝은 거성' : lc[1] === 'VI' ? '준왜성' : '초거성';
  return `${col} ${lum}`;
}
function fmtLength(m) {
  if (m < 1e12) return fmtKo(m / 1000) + ' km';
  if (m < 6e15) return fmtKo(m / AU) + ' AU';
  return fmtKo(m / LY) + ' 광년';
}
function fmtLightTime(m) {
  const t = m / C;
  if (t < 60) return trimNum(t) + '초';
  if (t < 3600) return trimNum(t / 60) + '분';
  if (t < 86400) return trimNum(t / 3600) + '시간';
  if (t < 365.25 * 86400) return trimNum(t / 86400) + '일';
  return fmtKo(t / (365.25 * 86400)) + '년';
}
function fmtDuration(ms) {
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

export { trimNum, fmtKo, fmtLy, fmtMly, PLANET_PHYS, MOON_TEMP, DSO_KO, DEEP_KO, starTypeKo, fmtLength, fmtLightTime, fmtDuration };
