# 우주 탐험 위치 정확도 검사

JPL DE421 천체력(skyfield)과 앱의 계산(`planets.js`, `astro.js`)을 2020~2032년 39개 시각에서 비교합니다.

```bash
pip install skyfield skyfield-data
mkdir -p /tmp/acc && for f in planets astro; do cp src/game/universe/$f.js /tmp/acc/$f.mjs; done
sed -i "s#from './\([a-z-]*\).js'#from './\1.mjs'#g" /tmp/acc/*.mjs
cp scripts/accuracy/*.mjs scripts/accuracy/*.py /tmp/acc/ && cd /tmp/acc
node dump.mjs > js.json && python3 cmp.py
```

2026-11-12 결과 (지구에서 본 방향 오차):

| 천체 | 평균 | 최대 |
|---|---|---|
| 수성 | 0.003° | 0.009° |
| 금성 | 0.003° | 0.017° |
| 지구(태양 중심 위치) | 0.002° | 0.007° |
| 화성 | 0.005° | 0.024° |
| 목성 | 0.033° | 0.085° |
| 토성 | 0.062° | 0.083° |
| 천왕성 | 0.012° | 0.031° |
| 해왕성 | 0.006° | 0.014° |
| 해 | 0.005° | 0.011° |
| 달 | 0.082° | 0.196° |
| 달 거리 | 250 km | 606 km |

참고: 달의 겉보기 지름은 약 0.5°. 소행성은 `scripts/propagate_asteroids.py` 참고(근지구 소행성 6개 기준 0.01~0.1°).
