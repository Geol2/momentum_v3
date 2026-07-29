# 프로젝트 안내 (달빛 서랍 프론트엔드)

**이 프로젝트는 Next.js가 아니라 Vite + React 18 SPA입니다.**
(과거 create-next-app 스캐폴딩에서 시작했지만 Next는 완전히 걷어냈습니다 — `next`는 의존성에 없습니다.)

## 스택

- 빌드: **Vite 5** (`vite.config.js`), 진입점은 `index.html` → `src/main.jsx`
- UI: **React 18** (`.jsx`, 함수형 컴포넌트 + 훅). TypeScript는 쓰지 않습니다.
- 3D: three.js / @react-three (`src/game/`)
- 데이터: 계정별로 [통합 API 백엔드](https://github.com/geol2/integration-api-backend)에 저장 (JWT 인증)

## 규칙

- API 호출은 항상 `src/lib/api.js`의 `apiFetch` / 리소스 API를 통해서 합니다 (토큰·에러·세션만료 처리 포함).
- 비밀 값을 `VITE_*` 환경 변수나 프론트 코드에 두지 마세요 — 빌드 시 번들에 인라인되어 공개됩니다.
- 새 UI 문자열·주석은 한국어를 기본으로 합니다(기존 코드 컨벤션).
- 개발 서버 API 프록시 대상은 백엔드 `http://localhost:9090` 입니다.
