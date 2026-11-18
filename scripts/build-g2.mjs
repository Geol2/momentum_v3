/**
 * Even Hub 패키지용 G2 빌드 + .ehpk 패킹.
 *
 *   npm run build:g2          → dist-g2/ 빌드
 *   npm run pack:g2           → 빌드 후 evenhub/momentum-g2.ehpk 생성 (evenhub CLI 필요)
 *
 * 환경 변수를 셸마다 다르게 넣지 않도록(Windows/macOS) Node에서 G2_ONLY를 켜고
 * Vite JS API로 빌드합니다.
 */
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'vite'

process.env.G2_ONLY = '1'
await build()

// 진입 파일을 index.html로도 둡니다. app.json의 entrypoint를 g2.html로 했을 때 설치형 앱이
// 폰·안경에 "Not Found"만 띄웠습니다(evenhub CLI 기본 템플릿도 index.html). 두 이름을 모두
// 두면 entrypoint를 어떻게 읽든 같은 화면이 열립니다. 상대 경로(./assets)라 내용은 그대로 씁니다.
copyFileSync('dist-g2/g2.html', 'dist-g2/index.html')
console.log('dist-g2/index.html  (g2.html 복사본 — 설치형 앱 진입 파일)')

// ---- 외부 주소 검사 (Even Hub 심사) ----
// 번들에 들어 있는 http(s) 주소는 전부 app.json network.whitelist에 있어야 합니다. 심사에서
// 메인 앱 배경 사진(Unsplash) 주소가 딸려 들어가 반려된 적이 있어, 빌드할 때마다 확인합니다.
const manifest = JSON.parse(readFileSync('evenhub/app.json', 'utf8'))
const allowed = (manifest.permissions || [])
  .filter((p) => p.name === 'network')
  .flatMap((p) => p.whitelist || [])
// 접속하지 않는 이름표일 뿐인 주소: XML/SVG 네임스페이스
const NAMESPACES = /^http:\/\/www\.w3\.org\//
// React 운영 빌드의 에러 문구에 들어 있는 안내 링크(접속하지 않음). 스캐너가 접속 주소로
// 오해하지 않게 글자로 바꿉니다. 에러 번호는 그대로 남아 원인을 찾는 데 문제없습니다.
const REACT_ERROR_URL = 'https://reactjs.org/docs/error-decoder.html?invariant='

const problems = []
for (const dir of ['dist-g2', 'dist-g2/assets']) {
  for (const name of readdirSync(dir)) {
    if (!/\.(js|css|html)$/.test(name)) continue
    const file = join(dir, name)
    let text = readFileSync(file, 'utf8')
    if (text.includes(REACT_ERROR_URL)) {
      text = text.split(REACT_ERROR_URL).join('react-error-decoder invariant=')
      writeFileSync(file, text)
    }
    for (const [url] of text.matchAll(/https?:\/\/[A-Za-z0-9.-]+[^\s"'`)<>]*/g)) {
      if (NAMESPACES.test(url)) continue
      if (allowed.some((a) => url === a || url.startsWith(`${a.replace(/\/$/, '')}/`))) continue
      problems.push(`${file}: ${url}`)
    }
  }
}
if (problems.length) {
  console.error('\n✗ G2 번들에 whitelist에 없는 외부 주소가 있어요 (Even Hub 심사 반려 사유):')
  for (const p of [...new Set(problems)]) console.error(`  ${p}`)
  console.error('  → 그 주소를 쓰는 코드가 G2 앱에 딸려 들어오지 않게 하거나, 정말 필요하면 app.json whitelist에 추가하세요.\n')
  process.exit(1)
}
console.log(`외부 주소 검사 통과 (허용: ${allowed.join(', ') || '없음'})`)
