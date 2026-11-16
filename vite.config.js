import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import sitemap from 'vite-plugin-sitemap'

export default defineConfig({
  plugins: [
    react(),
      sitemap({
        hostname: 'https://momentum.geol2.com',
        // 이 플러그인은 출력 폴더의 .html을 전부 페이지로 봅니다. 그대로 두면
        // 구글 소유권 인증 파일(public/google….html)까지 sitemap에 실려서,
        // 구글에 "빈 페이지"를 색인해 달라고 제출하는 꼴이 됩니다.
        // /g2 는 안경용 화면이라 검색에 노출할 이유가 없습니다.
        exclude: ['/google135f6838a3bdab5f', '/g2'],
        // 단일 페이지 앱이라 매일 바뀐다고 알릴 이유가 없습니다.
        changefreq: 'weekly',
      })
  ],
  build: {
    rollupOptions: {
      // g2.html: Even G2 안경용 화면 (src/g2/). 메인 앱과 번들을 나눠 서로 영향이 없게 합니다.
      input: {
        main: 'index.html',
        g2: 'g2.html',
      },
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
