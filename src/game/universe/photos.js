// 실제 우주 사진: 위키백과 문서의 대표 사진(대부분 허블·JWST·ESO 등)을 호버할 때 불러옴
// 위키백과 REST API(CORS 허용)로 썸네일 주소만 받아요. 사진 저작권은 각 원본(대부분 퍼블릭 도메인/CC BY).
const WIKI = {
  // 성운·성단·초신성 잔해
  '오리온 성운 (M42)': 'Orion_Nebula', '말머리 성운': 'Horsehead_Nebula', '석호 성운 (M8)': 'Lagoon_Nebula', '독수리 성운 (M16)': 'Pillars_of_Creation',
  '오메가 성운 (M17)': 'Omega_Nebula', '삼렬 성운 (M20)': 'Trifid_Nebula', '용골자리 성운': 'Carina_Nebula', '장미 성운': 'Rosette_Nebula',
  '북아메리카 성운': 'North_America_Nebula', '고리 성운 (M57)': 'Ring_Nebula', '아령 성운 (M27)': 'Dumbbell_Nebula', '나선 성운 (헬릭스)': 'Helix_Nebula',
  '고양이 눈 성운': "Cat's_Eye_Nebula", '올빼미 성운 (M97)': 'Owl_Nebula', '게 성운 (M1)': 'Crab_Nebula', '카시오페이아 A': 'Cassiopeia_A',
  '베일 성운 (백조자리 고리)': 'Veil_Nebula', '돛자리 초신성 잔해': 'Vela_supernova_remnant', '티코 초신성 잔해': 'SN_1572', '케플러 초신성 잔해': "Kepler's_Supernova",
  '플레이아데스 (M45 · 좀생이별)': 'Pleiades', '히아데스': 'Hyades_(star_cluster)', '벌집 성단 (M44)': 'Beehive_Cluster', '페르세우스 이중성단': 'Double_Cluster',
  '들오리 성단 (M11)': 'Wild_Duck_Cluster', 'M7 (프톨레마이오스 성단)': 'Messier_7', 'M6 (나비 성단)': 'Messier_6', M35: 'Messier_35', M67: 'Messier_67',
  '오메가 센타우리': 'Omega_Centauri', '큰부리새자리 47': '47_Tucanae', '헤라클레스 구상성단 (M13)': 'Messier_13', M22: 'Messier_22', M4: 'Messier_4',
  M3: 'Messier_3', M5: 'Messier_5', M15: 'Messier_15', M92: 'Messier_92', M2: 'Messier_2', M80: 'Messier_80', M54: 'Messier_54',
  '궁수자리 A* (은하 중심 블랙홀)': 'Sagittarius_A*', '아치스 성단': 'Arches_Cluster', '5중 성단 (퀸터플렛)': 'Quintuplet_cluster', '궁수자리 B2': 'Sagittarius_B2',
  '가이아 BH1': 'Gaia_BH1', '가이아 BH3': 'Gaia_BH3', '게 펄서': 'Crab_Pulsar', 'PSR B1919+21': 'PSR_B1919+21', '게미나': 'Geminga', 'SGR 1806-20': 'SGR_1806-20',
  '루먼 16': 'Luhman_16', '에타 카리나이': 'Eta_Carinae', 'WR 104': 'WR_104', 'UY 방패자리': 'UY_Scuti', '스티븐슨 2-18': 'Stephenson_2-18',
  'HAT-P-67 b': null,
  // 은하·거대 구조
  안드로메다: 'Andromeda_Galaxy', '안드로메다 은하 (M31)': 'Andromeda_Galaxy', '삼각형자리 은하': 'Triangulum_Galaxy', '삼각형자리 은하 (M33)': 'Triangulum_Galaxy',
  '대마젤란 은하': 'Tarantula_Nebula', '소마젤란 은하': 'Small_Magellanic_Cloud', '처녀자리 은하단': 'Virgo_Cluster', '머리털자리 은하단': 'Coma_Cluster',
  'M81 은하군': 'Messier_81', '센타우루스 A / M83 은하군': 'Centaurus_A', '조각가자리 은하군': 'Sculptor_Galaxy', 'M101 은하군': 'Pinwheel_Galaxy',
  'IC 1101': 'IC_1101', 에렌델: 'Earendel_(star)', 'JADES-GS-z14-0': 'JADES-GS-z14-0', '페르미 거품': 'Fermi_bubbles', 우리은하: 'Milky_Way',
  // 태양계
  수성: 'Mercury_(planet)', 금성: 'Venus', 지구: null, 화성: 'Mars', 목성: 'Jupiter', 토성: 'Saturn', 천왕성: 'Uranus', 해왕성: 'Neptune', 달: 'Moon',
  이오: 'Io_(moon)', 유로파: 'Europa_(moon)', 가니메데: 'Ganymede_(moon)', 칼리스토: 'Callisto_(moon)', 타이탄: 'Titan_(moon)', 엔켈라두스: 'Enceladus', 트리톤: 'Triton_(moon)',
  '1P/핼리 혜성': "Halley's_Comet", 'C/1995 O1 헤일-밥': 'Comet_Hale–Bopp', '3I/ATLAS': '3I/ATLAS', '2I/보리소프': '2I/Borisov', "1I/'오우무아무아": 'ʻOumuamua',
  '67P/추류모프-게라시멘코': '67P/Churyumov–Gerasimenko', 'ISS (ZARYA)': 'International_Space_Station', 'CSS (TIANHE)': 'Tiangong_space_station',
  // 외계 행성계·별
  '트라피스트-1': 'TRAPPIST-1', 'HR 8799': 'HR_8799', '케플러-90': 'Kepler-90', '51 페가시': '51_Pegasi_b', '프록시마 센타우리': 'Proxima_Centauri',
};
const cache = new Map();
export function photoTitle(name) {
  if (!name) return null;
  if (name in WIKI) return WIKI[name];
  const k = Object.keys(WIKI).find((n) => n && WIKI[n] && (name.startsWith(n + ' ') || name.startsWith(n + ' ·')));
  return k ? WIKI[k] : null;
}
/** 사진 주소 { src, page } (없으면 null) */
export function getPhoto(title) {
  if (!title) return Promise.resolve(null);
  if (!cache.has(title)) {
    cache.set(title, fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && j.thumbnail ? { src: j.thumbnail.source, page: j.content_urls?.desktop?.page } : null))
      .catch(() => null));
  }
  return cache.get(title);
}
