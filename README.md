# 달빛 서랍 (Moonlight Drawer)

별이 빛나는 밤 테마의 할 일 · 다이어리 대시보드. **React + Vite**로 만든 PWA이며,
모든 데이터는 계정별로 [통합 API 백엔드](https://github.com/geol2/integration-api-backend)에 저장됩니다.

> 초기 버전은 브라우저 localStorage에만 저장했지만, 지금은 로그인(JWT) 후
> 다이어리·할일·메모·설정·플레이리스트를 서버에 저장해 기기 간에 공유됩니다.

## 기능

- **로그인 / 회원가입** — 이메일 인증코드로 가입, 이후 stateless JWT 인증 (`Login.jsx`)
- **실시간 시계 / 인사말** — 1초마다 갱신, 시간대별 인사말, 24시간 / 오전·오후 전환
- **날씨** — wttr.in에서 서울 실시간 날씨 (°C / °F 전환)
- **명언** — 새로고침 버튼으로 랜덤 명언
- **캘린더 + 다이어리** — 날짜 클릭 → 일기 작성/조회, 기분 선택, 기록 있는 날 표시
- **할 일** — 그날 할 일 추가 / 완료 / 삭제, 시간·장소 지정 시 약속 전 **Web Push 알림**
- **메모** — 드래그 가능한 포스트잇, 날짜별 표시 · 고정(핀) · 폭 조절
- **통합 검색** — 일기 · 할일 · 메모를 한 번에 검색 (기간 · 타입 필터, `Search.jsx`)
- **음악 플레이어** — 유튜브 트랙 플레이리스트, 재생 위치 저장 (`MusicPlayer.jsx`)
- **회의록 녹음** — 녹음 후 서버(`/api/recordings`)를 거쳐 n8n으로 업로드 (`MeetingRecorder.jsx`)
- **설정** — 이름, 시간 형식, 초 표시, 온도 단위, 명언 표시, 알림 리드타임
- **PWA** — 홈 화면 설치, 서비스워커, iOS 홈 화면 설치 시 Web Push 지원
- **숨겨진 3D 게임** — three.js 기반 이스터에그 (`game/`)

## 실행

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:5173)
npm run build    # 프로덕션 빌드 → dist/
npm run preview  # 빌드 결과 미리보기
```

개발 중 API 호출(`/api/*`)은 Vite dev 프록시가 백엔드(`http://localhost:9090`)로
전달합니다(`vite.config.js`) — CORS 걱정 없이 상대경로로 호출할 수 있습니다.

### 환경 변수

| 변수 | 설명 |
|------|------|
| `VITE_API_BASE_URL` | API 베이스 URL. 비우면 same-origin(상대경로) 호출. 개발 시엔 비워두고 Vite 프록시 사용, 운영은 `.env.production` 참고 |

> `VITE_*` 값은 빌드 시 번들에 인라인되어 **누구나 읽을 수 있습니다** — 비밀 키를 두지 마세요.
> n8n 웹훅 주소·키, VAPID 키 등은 프론트가 아니라 백엔드에만 있습니다.

## 구조

```
index.html              진입점(Vite) · SEO/OG 메타 · 로딩 인트로
src/
  main.jsx              부트스트랩 · 서비스워커 등록 · 인앱 브라우저 리다이렉트
  App.jsx               상태 오케스트레이션 (시계, CRUD, 인증 게이팅)
  index.css             전역 스타일 · 애니메이션 · 배경
  lib/
    api.js              apiFetch + 리소스별 API (todos/tracks/notes/diaries/settings/push/search)
    useAuth.js          로그인 상태 · 세션 만료 처리
    data.js             명언 · 기분 · 날씨 아이콘 · 날짜 유틸
    push.js             Web Push 구독 등록
    uploadRecording.js  회의록 녹음 업로드
    useIsMobile.js      뷰포트 훅
    inAppBrowser.js     카카오/인스타 등 인앱 브라우저 감지
  components/
    StarField.jsx       반짝이는 별 배경 (canvas)
    Clock.jsx           대형 시계
    Calendar.jsx        캘린더 + 날짜별 기록 패널
    WeatherQuote.jsx    날씨 · 명언 위젯
    TodoSection.jsx     할 일 목록 (시간·장소·알림)
    MemoSection.jsx     메모 입력
    StickyNotes.jsx     드래그 가능한 포스트잇
    DiaryModal.jsx      다이어리 모달 (보기/편집)
    Settings.jsx        설정 기어 + 팝오버
    Search.jsx          통합 검색
    MusicPlayer.jsx     유튜브 음악 플레이어
    MeetingRecorder.jsx 회의록 녹음
    Login.jsx           로그인 / 회원가입
    Notice.jsx          공지 배너
  game/
    HiddenGame.jsx      숨겨진 게임 진입
    Game3D.jsx          three.js 3D 게임
public/
  manifest.webmanifest  PWA 매니페스트
  sw.js                 서비스워커 (Web Push · 오프라인)
```

## 참고

- 배경은 오프라인 동작을 위해 Unsplash 이미지 대신 CSS 그라디언트 + canvas 별로 대체했습니다.
- 인앱 브라우저(카카오톡 등)는 cross-origin API 호출을 막습니다. Android는 Chrome으로
  자동 리다이렉트하고(`main.jsx`), iOS는 Safari로 열도록 안내 배너를 띄웁니다. Cloudflare
  same-origin 프록시(`momentum.geol2.com/api/*`)가 뜨면 `VITE_API_BASE_URL`을 비워
  same-origin으로 전환해 인앱 브라우저에서도 동작하게 할 수 있습니다.
