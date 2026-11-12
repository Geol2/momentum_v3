// 우주 탐험 — universe-explorer.js에서 분리한 모듈 (동작 동일)
import { orbitPoints } from './planets.js';
import { SYSTEMS } from './exoplanets.js';
import { plutoHelio, DWARFS, PROBES, probeDistanceAU } from './outer.js';
import { LY, AU, MLY, R_OBS, P, mulberry32, TODAY, PLANET_POS, SUN, skyPosM, GC, ANDROMEDA, M33, LMC, SMC, GA, LANI } from './ux-consts.js';

// ───────────────────────── 절차적 데이터 생성 ─────────────────────────
class Cloud {
  constructor() { this.groups = new Map(); }
  add(color, x, y) {
    let g = this.groups.get(color);
    if (!g) { g = []; this.groups.set(color, g); }
    g.push(x, y);
  }
}

function buildWorld(seed = 20261109) {
  const rnd = mulberry32(seed);
  const gauss = () => {
    let u = 0; while (!u) u = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  const inDisk = (R) => P(R * Math.sqrt(rnd()), rnd() * Math.PI * 2);

  // 행성
  const planets = [
    ['수성', 0.387, 2.44e6, '#b9b2a8'], ['금성', 0.723, 6.05e6, '#e8cf9a'],
    ['지구', 1, 6.371e6, '#4a90e2'], ['화성', 1.524, 3.39e6, '#d1603d'],
    ['목성', 5.2, 6.99e7, '#d8b48a'], ['토성', 9.58, 5.82e7, '#e5d29f'],
    ['천왕성', 19.2, 2.54e7, '#9fd8e0'], ['해왕성', 30.05, 2.46e7, '#5b7fe0'],
  ].map(([name, a, r, color]) => {
    const hp = PLANET_POS[name].pos;
    const orbitPath = orbitPoints(name, TODAY).map(([x, y]) => [SUN[0] + x * AU, SUN[1] + y * AU]);
    return { name, orbit: a * AU, r, color, pos: [SUN[0] + hp[0] * AU, SUN[1] + hp[1] * AU], orbitPath };
  });

  // 소행성대 (2.1~3.3 AU)
  const asteroids = new Cloud();
  for (let i = 0; i < 1600; i++) {
    const r = (2.1 + Math.pow(rnd(), 0.8) * 1.2 + gauss() * 0.05) * AU;
    const [x, y] = P(r, rnd() * Math.PI * 2, SUN);
    asteroids.add(rnd() < 0.7 ? 'rgba(190,175,150,0.75)' : 'rgba(150,140,125,0.6)', x, y);
  }
  // 카이퍼 벨트 (고전 벨트 42~48 AU 밀집, 30~50 AU) + 산란 원반(50~150 AU)
  const kuiper = new Cloud();
  for (let i = 0; i < 2600; i++) {
    const core = rnd() < 0.6;
    const r = (core ? 42 + rnd() * 6 : 30 + rnd() * 20) * AU;
    const [x, y] = P(r, rnd() * Math.PI * 2, SUN);
    kuiper.add(core ? 'rgba(170,200,255,0.75)' : 'rgba(150,180,235,0.55)', x, y);
  }
  for (let i = 0; i < 380; i++) {
    const r = (50 + Math.pow(rnd(), 2.2) * 100) * AU;
    const [x, y] = P(r, rnd() * Math.PI * 2, SUN);
    kuiper.add('rgba(160,170,220,0.45)', x, y);
  }
  // 오르트 구름: 내부(힐스 구름, 2천~2만 AU, 더 빽빽) + 외부(2만~10만 AU, 구형, 듬성) + 가장자리(~20만 AU)
  const oort = new Cloud();
  for (let i = 0; i < 2200; i++) {
    const r = Math.pow(10, 3.3 + rnd() * 1.0) * AU;
    const [x, y] = P(r, rnd() * Math.PI * 2, SUN);
    oort.add(rnd() < 0.6 ? 'rgba(160,205,255,0.7)' : 'rgba(210,230,255,0.45)', x, y);
  }
  for (let i = 0; i < 2600; i++) {
    const r = Math.pow(10, 4.3 + rnd() * 0.7) * AU;
    const [x, y] = P(r, rnd() * Math.PI * 2, SUN);
    oort.add(rnd() < 0.5 ? 'rgba(190,215,255,0.45)' : 'rgba(225,235,255,0.3)', x, y);
  }
  for (let i = 0; i < 500; i++) {
    const r = Math.pow(10, 5.0 + rnd() * 0.3) * AU;
    const [x, y] = P(r, rnd() * Math.PI * 2, SUN);
    oort.add('rgba(200,215,255,0.22)', x, y);
  }
  // 장주기 혜성 궤도(근일점 ~1 AU, 원일점 수천~수만 AU)
  const comets = [];
  for (let i = 0; i < 9; i++) {
    const Q = Math.pow(10, 3.5 + rnd() * 1.2) * AU, q = (0.5 + rnd() * 2) * AU;
    const a = (Q + q) / 2, e = (Q - q) / (Q + q), w = rnd() * Math.PI * 2;
    const pts = [];
    for (let k = 0; k <= 200; k++) {
      const E = (k / 200) * Math.PI * 2;
      const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
      pts.push([SUN[0] + xp * Math.cos(w) - yp * Math.sin(w), SUN[1] + xp * Math.sin(w) + yp * Math.cos(w)]);
    }
    comets.push(pts);
  }
  // 명왕성(실제 위치·궤도), 왜행성, 탐사선
  const pl = plutoHelio(TODAY);
  const pluto = { pos: [SUN[0] + pl.pos[0] * AU, SUN[1] + pl.pos[1] * AU], r: pl.r, path: pl.path.map(([x, y]) => [SUN[0] + x * AU, SUN[1] + y * AU]) };
  const dwarfPlanets = DWARFS.map(([name, ra, dec, au, desc]) => ({ name, au, desc, pos: skyPosM(ra, dec, au * AU) }));
  const probes = PROBES.map(([name, ra, dec, base, per, desc, alive]) => {
    const au = probeDistanceAU(base, per, TODAY);
    return { name, au, desc, alive, pos: skyPosM(ra, dec, au * AU) };
  });

  // 이웃 별
  // 실제 하늘 위치(적경·적위)·거리 → 황도면 투영 (태양 기준)
  const skyPos = (raDeg, decDeg, ly) => skyPosM(raDeg, decDeg, ly * LY);
  const systems = SYSTEMS.map((sys) => ({ sys, pos: skyPos(sys.ra, sys.dec, sys.distLy) }));
  // (가짜 무작위 별은 없앰 — 실제 별 목록은 sky-catalog.json 에서 불러옴)

  // 우리은하 (나선팔)
  const galaxy = new Cloud();
  const pitch = Math.tan((13 * Math.PI) / 180);
  for (let i = 0; i < 7000; i++) {
    let x, y, col;
    if (rnd() < 0.17) {
      const bx = gauss() * 4200 * LY, by = gauss() * 2600 * LY, rot = 0.45;
      x = bx * Math.cos(rot) - by * Math.sin(rot);
      y = bx * Math.sin(rot) + by * Math.cos(rot);
      col = rnd() < 0.6 ? 'rgba(255,214,150,0.75)' : 'rgba(255,190,120,0.55)';
    } else {
      const arm = (rnd() * 4) | 0;
      let r = 2500 * LY - Math.log(rnd()) * 12000 * LY;
      if (r > 56000 * LY) r = 2500 * LY + rnd() * 50000 * LY;
      const th = (arm * Math.PI) / 2 + Math.log(r / (2500 * LY)) / pitch + gauss() * 0.17;
      r += gauss() * 900 * LY;
      x = r * Math.cos(th); y = r * Math.sin(th);
      const k = rnd();
      col = k < 0.06 ? 'rgba(255,120,170,0.75)' : k < 0.55 ? 'rgba(170,200,255,0.65)' : 'rgba(235,240,255,0.5)';
    }
    galaxy.add(col, x + GC[0], y + GC[1]);
  }

  // 국부은하군
  const lgGalaxies = [
    { name: '우리은하', pos: GC, r: 50000 * LY, rot: 0.3, ar: 0.9, color: '255,225,190' },
    { name: '안드로메다', pos: ANDROMEDA, r: 110000 * LY, rot: 0.9, ar: 0.35, color: '230,225,255' },
    { name: '삼각형자리 은하', pos: M33, r: 30000 * LY, rot: -0.4, ar: 0.6, color: '200,215,255' },
    { name: '대마젤란 은하', pos: LMC, r: 7000 * LY, rot: 0.2, ar: 0.7, color: '220,230,255', small: true },
    { name: '소마젤란 은하', pos: SMC, r: 3500 * LY, rot: 0.8, ar: 0.6, color: '220,230,255', small: true },
  ];
  // 국부은하군의 실제 위성은하·왜소은하 [이름, 적경, 적위, 거리(천 광년), 설명]
  const lgDwarfs = [
    ['궁수자리 왜소은하', 283.83, -30.55, 70, '우리은하에 잡아먹히는 중인 위성은하'],
    ['큰곰자리 II 왜소은하', 132.87, 63.13, 98, '아주 희미한 초저광도 왜소은하'],
    ['목동자리 I 왜소은하', 210.02, 14.50, 197, '별이 매우 적은 오래된 왜소은하'],
    ['작은곰자리 왜소은하', 227.29, 67.22, 200, '별 생성이 일찍 멈춘 위성은하'],
    ['용자리 왜소은하', 260.06, 57.92, 260, '암흑물질이 아주 많은 위성은하'],
    ['조각가자리 왜소은하', 15.04, -33.71, 290, '1937년 처음 발견된 왜소 타원체 은하'],
    ['육분의자리 왜소은하', 153.26, -1.61, 290, '넓게 퍼진 희미한 위성은하'],
    ['용골자리 왜소은하', 100.40, -50.97, 330, '별 생성이 여러 번 일어난 위성은하'],
    ['컵자리 II 왜소은하', 177.31, -18.41, 380, '2016년 발견 · 크지만 아주 희미함'],
    ['공기펌프자리 2 왜소은하', 143.89, -36.77, 430, '2018년 Gaia로 발견된 유령 같은 은하'],
    ['화로자리 왜소은하', 39.99, -34.45, 460, '구상성단 6개를 거느린 위성은하'],
    ['사자자리 II 왜소은하', 168.37, 22.15, 690, '먼 거리의 위성은하'],
    ['사자자리 I 왜소은하', 152.12, 12.31, 820, '레굴루스 바로 옆에 보이는 은하'],
    ['M32', 10.674, 40.865, 2490, '안드로메다의 작은 타원은하'],
    ['M110', 10.092, 41.685, 2690, '안드로메다의 왜소 타원은하'],
    ['NGC 185', 9.742, 48.337, 2010, '안드로메다의 위성은하'],
    ['NGC 147', 8.300, 48.509, 2530, '안드로메다의 위성은하'],
    ['안드로메다 I', 11.416, 38.04, 2400, '안드로메다의 왜소 타원체 은하'],
    ['안드로메다 II', 19.12, 33.42, 2130, '안드로메다의 왜소 타원체 은하'],
    ['IC 10', 5.07, 59.30, 2200, '국부은하군 유일의 폭발적 별 생성 은하'],
    ['IC 1613', 16.20, 2.12, 2380, '먼지가 거의 없는 왜소 불규칙은하'],
    ['바너드 은하 (NGC 6822)', 296.24, -14.80, 1630, '가까운 왜소 불규칙은하'],
    ['WLM 은하', 0.49, -15.46, 3040, '국부은하군 가장자리의 외톨이 은하'],
    ['봉황자리 왜소은하', 27.78, -44.44, 1440, '왜소 불규칙-타원체 전이형 은하'],
    ['큰부리새자리 왜소은하', 340.46, -64.42, 2870, '고립된 왜소 타원체 은하'],
    ['사자자리 A', 149.86, 30.75, 2600, '아주 어린 별이 많은 왜소은하'],
    ['페가수스 왜소 불규칙은하', 352.15, 14.74, 3000, '국부은하군의 왜소 불규칙은하'],
    ['물병자리 왜소은하', 311.72, -12.85, 3200, '국부은하군 가장자리의 왜소은하'],
    ['육분의자리 A', 152.75, -4.69, 4310, '국부은하군 바로 바깥의 왜소은하'],
  ].map(([name, ra, dec, kly, desc]) => ({ name, desc, ra, dec, ly: kly * 1000, pos: skyPosM(ra, dec, kly * 1000 * LY) }));

  // 실제 은하군·은하단·거대 구조 [이름, 종류, 적경, 적위, 거리(백만 광년), 설명]
  // 종류: grp 은하군, cl 은하단, sc 초은하단, wall 거대 구조, void 보이드, far 가장 먼 천체 (공동 거리)
  const deepSpace = [
    ['마페이 은하군', 'grp', 39.15, 59.65, 9.8, '은하수 먼지 뒤에 숨은 가까운 은하군'],
    ['조각가자리 은하군', 'grp', 11.888, -25.288, 11.4, '조각가자리 은하(NGC 253) 중심의 이웃 은하군'],
    ['M81 은하군', 'grp', 148.888, 69.065, 11.7, 'M81·M82가 서로 당기는 은하군'],
    ['센타우루스 A / M83 은하군', 'grp', 201.365, -43.019, 12, '거대 전파은하 센타우루스 A의 은하군'],
    ['사냥개자리 은하군', 'grp', 192.721, 41.12, 13, 'M94 주변의 느슨한 은하군'],
    ['M101 은하군', 'grp', 210.802, 54.349, 21, '바람개비 은하(M101) 은하군'],
    ['사자자리 I 은하군 (M96)', 'grp', 161.69, 11.82, 35, '사자자리 삼중은하와 이웃한 은하군'],
    ['사자자리 삼중은하', 'grp', 170.06, 12.99, 35, 'M65·M66·NGC 3628'],
    ['처녀자리 은하단', 'cl', 187.706, 12.391, 54, '은하 1300~2000개 · 중심 M87 블랙홀(2019 첫 사진)'],
    ['큰곰자리 은하단', 'cl', 178.9, 53.4, 55, '나선은하가 많은 느슨한 은하단'],
    ['화로자리 은하단', 'cl', 54.62, -35.45, 62, '남쪽 하늘의 가까운 은하단'],
    ['에리다누스 은하군', 'grp', 55.05, -18.58, 75, '화로자리 은하단과 이어진 은하군'],
    ['국부 보이드', 'void', 285, 15, 75, '국부은하군 옆의 텅 빈 공간 · 우리를 밀어냄'],
    ['히드라 은하단', 'cl', 159.18, -27.53, 158, '라니아케아 안의 큰 은하단'],
    ['센타우루스 은하단', 'cl', 192.2, -41.3, 170, '라니아케아 안의 큰 은하단'],
    ['공작-인디언 은하군', 'grp', 304.2, -70.86, 190, '거대 인력체 쪽으로 흘러가는 은하군'],
    ['직각자자리 은하단 (거대 인력체)', 'cl', 243.59, -60.87, 220, '라니아케아 중력의 중심 · 은하수에 가려 있음'],
    ['페르세우스 은하단', 'cl', 49.95, 41.51, 240, '페르세우스-물고기자리 초은하단의 중심 · X선이 가장 밝음'],
    ['사자자리 은하단 (Abell 1367)', 'cl', 176.2, 19.7, 300, '머리털자리 초은하단의 일부'],
    ['머리털자리 은하단', 'cl', 194.95, 27.98, 321, '은하 1000개 이상 · 1933년 암흑물질 첫 단서'],
    ['M87* 블랙홀', 'bh', 187.706, 12.391, 54, '태양 질량 65억 배 · 2019년 인류 최초의 블랙홀 사진 · 탭하면 블랙홀 체험'],
    ['센타우루스 A 블랙홀', 'bh', 201.365, -43.019, 12, '태양 질량 5,500만 배 · 거대한 제트를 뿜는 가장 가까운 전파은하 · 탭하면 블랙홀 체험'],
    ['홈베리 15A 블랙홀', 'bh', 10.46, -9.30, 700, '태양 질량 약 400억 배 — 직접 잰 것 중 최대급 · 탭하면 블랙홀 체험'],
    ['TON 618 블랙홀', 'bh', 187.104, 31.477, 18300, '태양 질량 400억~660억 배 퀘이사 · 빛이 108억 년 걸려 옴(공동 거리 약 183억 광년) · 탭하면 블랙홀 체험'],
    ['IC 1101', 'gal', 227.733, 5.745, 1045, '가장 큰 은하 중 하나 · 별빛 지름 약 400만 광년 (우리은하의 40배)'],
    ['알키오네우스', 'gal', 122.0, 52.0, 3000, '2022년 발견 · 전파 제트 길이 약 1600만 광년의 거대 전파은하 (위치는 대략)'],
    ['헤라클레스 은하단', 'cl', 241.15, 17.72, 500, '충돌 중인 은하가 많은 은하단'],
    ['섀플리 초은하단', 'sc', 201.98, -31.5, 650, '근처 우주에서 가장 무거운 구조'],
    ['목동자리 보이드', 'void', 218, 46, 700, '지름 약 3억 광년의 거대한 빈 공간'],
    ['CfA2 장성', 'wall', 195, 28, 300, '1989년 발견된 은하의 장벽 · 길이 약 5억 광년'],
    ['슬론 장성', 'wall', 195, 1, 1370, '2003년 발견 · 길이 약 14억 광년'],
    ['거대 호 (Giant Arc)', 'wall', 162.5, 20, 9200, '2021년 발견된 33억 광년 길이의 호'],
    ['빅 링 (Big Ring)', 'wall', 222, 25, 9200, '2024년 발견된 지름 13억 광년의 고리'],
    ['헤라클레스-북쪽왕관자리 장성', 'wall', 245, 30, 10000, '알려진 가장 큰 구조 후보 · 약 100억 광년 길이'],
    ['에렌델', 'far', 24.355, -8.457, 28000, '가장 먼 단일 별(2022, 중력렌즈) · 빛이 129억 년 걸림'],
    ['GN-z11', 'far', 189.106, 62.242, 32000, '2016년 당시 가장 먼 은하 · 블랙홀 활동 확인(2024)'],
    ['JADES-GS-z14-0', 'far', 53.083, -27.890, 33800, '2024년 JWST · 빅뱅 2.9억 년 뒤의 은하'],
    ['MoM-z14', 'far', 150.093, 2.273, 33900, '2025년 JWST · 현재 가장 먼 은하 (빅뱅 2.8억 년 뒤)'],
  ].map(([name, kind, ra, dec, mly, desc]) => ({ name, kind, desc, mly, pos: skyPosM(ra, dec, mly * MLY) }));

  // 라니아케아
  const laniR = (th) => 270 * MLY * (1 + 0.1 * Math.sin(3 * th + 1) + 0.06 * Math.cos(5 * th));
  const laniBoundary = [];
  for (let i = 0; i <= 120; i++) {
    const th = (i / 120) * Math.PI * 2;
    laniBoundary.push(P(laniR(th), th, LANI));
  }
  const flows = [];
  for (let f = 0; f < 46; f++) {
    const th = rnd() * Math.PI * 2;
    let [x, y] = P(laniR(th) * (0.75 + rnd() * 0.2), th, LANI);
    const line = [x, y];
    const swirl = (rnd() - 0.5) * 0.9;
    for (let k = 0; k < 140; k++) {
      const dx = GA[0] - x, dy = GA[1] - y, d = Math.hypot(dx, dy);
      if (d < 12 * MLY) break;
      const step = 5 * MLY;
      x += (dx / d - (dy / d) * swirl * (d / (270 * MLY))) * step;
      y += (dy / d + (dx / d) * swirl * (d / (270 * MLY))) * step;
      line.push(x, y);
    }
    flows.push(line);
  }

  // 코스믹 웹
  const nodes = [];
  for (let i = 0; i < 420; i++) nodes.push(inDisk(R_OBS * 0.97));
  nodes.push(LANI);
  const webEdges = [];
  const seen = new Set();
  for (let i = 0; i < nodes.length; i++) {
    const near = nodes
      .map((p, j) => [j, (p[0] - nodes[i][0]) ** 2 + (p[1] - nodes[i][1]) ** 2])
      .filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3);
    for (const [j] of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      webEdges.push([nodes[i], nodes[j]]);
    }
  }

  // 지구 대륙 (지구 반지름 기준 상대 좌표)
  const continents = [];
  for (let i = 0; i < 9; i++) continents.push([gauss() * 0.45, gauss() * 0.45, 0.12 + rnd() * 0.22, 0.08 + rnd() * 0.16, rnd() * Math.PI]);

  return { planets, asteroids, kuiper, oort, comets, pluto, dwarfPlanets, probes, systems, galaxy, lgGalaxies, lgDwarfs, deepSpace, laniBoundary, flows, webEdges, continents };
}

export { buildWorld };
