/**
 * Even Hub 패키지용 G2 빌드 + .ehpk 패킹.
 *
 *   npm run build:g2          → dist-g2/ 빌드
 *   npm run pack:g2           → 빌드 후 evenhub/momentum-g2.ehpk 생성 (evenhub CLI 필요)
 *
 * 환경 변수를 셸마다 다르게 넣지 않도록(Windows/macOS) Node에서 G2_ONLY를 켜고
 * Vite JS API로 빌드합니다.
 */
import { build } from 'vite'

process.env.G2_ONLY = '1'
await build()
