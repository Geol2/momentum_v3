/**
 * Even Hub 패키지용 G2 빌드 + .ehpk 패킹.
 *
 *   npm run build:g2          → dist-g2/ 빌드
 *   npm run pack:g2           → 빌드 후 evenhub/momentum-g2.ehpk 생성 (evenhub CLI 필요)
 *
 * 환경 변수를 셸마다 다르게 넣지 않도록(Windows/macOS) Node에서 G2_ONLY를 켜고
 * Vite JS API로 빌드합니다.
 */
import { copyFileSync } from 'node:fs'
import { build } from 'vite'

process.env.G2_ONLY = '1'
await build()

// 진입 파일을 index.html로도 둡니다. app.json의 entrypoint를 g2.html로 했을 때 설치형 앱이
// 폰·안경에 "Not Found"만 띄웠습니다(evenhub CLI 기본 템플릿도 index.html). 두 이름을 모두
// 두면 entrypoint를 어떻게 읽든 같은 화면이 열립니다. 상대 경로(./assets)라 내용은 그대로 씁니다.
copyFileSync('dist-g2/g2.html', 'dist-g2/index.html')
console.log('dist-g2/index.html  (g2.html 복사본 — 설치형 앱 진입 파일)')
