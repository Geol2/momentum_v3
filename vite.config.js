import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import sitemap from 'vite-plugin-sitemap'

// G2_ONLY=1 (npm run build:g2 → scripts/build-g2.mjs): Even Hub 패키지(.ehpk)용으로
// g2.html만 dist-g2/에 빌드합니다. 메인 앱 빌드에는 영향이 없습니다.
const G2_ONLY = process.env.G2_ONLY === '1'

export default defineConfig({
  plugins: [
    react(),
    // 안경 앱 패키지에는 sitemap이 필요 없습니다.
    !G2_ONLY && sitemap({
      hostname: 'https://momentum.geol2.com',
      // 이 플러그인은 출력 폴더의 .html을 전부 페이지로 봅니다. 그대로 두면
      // 구글 소유권 인증 파일(public/google….html)까지 sitemap에 실려서,
      // 구글에 "빈 페이지"를 색인해 달라고 제출하는 꼴이 됩니다.
      // /g2 는 안경용 화면이라 검색에 노출할 이유가 없습니다.
      exclude: ['/google135f6838a3bdab5f', '/g2'],
      // 단일 페이지 앱이라 매일 바뀐다고 알릴 이유가 없습니다.
      changefreq: 'weekly',
    }),
  ],
  ...(G2_ONLY ? {
    // .ehpk 안에서는 사이트 루트가 아니라 패키지 폴더 기준으로 열리므로 상대 경로로 빌드합니다.
    base: './',
    // public/(gaia 별 데이터 수십 MB 등)은 안경 앱에 필요 없으므로 복사하지 않습니다.
    publicDir: false,
  } : {}),
  build: {
    ...(G2_ONLY ? { outDir: 'dist-g2', emptyOutDir: true } : {}),
    rollupOptions: {
      // g2.html: Even G2 안경용 화면 (src/g2/). 메인 앱과 번들을 나눠 서로 영향이 없게 합니다.
      input: G2_ONLY
        ? { g2: 'g2.html' }
        : { main: 'index.html', g2: 'g2.html' },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:9090',
        changeOrigin: true,
      },
    },
  },
})
