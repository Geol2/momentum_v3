# 별빛 투두 (Byeolbit Todo)

별이 빛나는 밤 테마의 할 일 · 다이어리 대시보드. React + Vite로 구현했습니다.

## 기능

- **실시간 시계 / 인사말** — 1초마다 갱신, 시간대별 인사말, 24시간 / 오전·오후 전환
- **날씨** — wttr.in에서 서울 실시간 날씨 (°C / °F 전환)
- **명언** — 새로고침 버튼으로 랜덤 명언
- **캘린더 + 다이어리** — 날짜 클릭 → 일기 작성/조회, 기분 선택, 기록 있는 날 표시
- **할 일** — 추가 / 완료 / 삭제
- **메모** — 추가하면 드래그 가능한 포스트잇으로 화면에 부착
- **설정** — 이름, 시간 형식, 초 표시, 온도 단위, 명언 표시
- **저장** — 모든 데이터는 브라우저 localStorage에 자동 저장

## 실행

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:5173)
npm run build    # 프로덕션 빌드 → dist/
npm run preview  # 빌드 결과 미리보기
```

## 구조

```
src/
  main.jsx              진입점
  App.jsx               상태 오케스트레이션 (시계, 날씨, 다이어리 CRUD)
  index.css             전역 스타일 · 애니메이션 · 배경
  lib/
    data.js             명언 · 기분 · 날씨 아이콘 · 유틸
    useLocalStorage.js  localStorage 동기화 훅
  components/
    StarField.jsx       반짝이는 별 배경 (canvas)
    Clock.jsx           대형 시계
    Calendar.jsx        캘린더 + 날짜별 기록 패널
    WeatherQuote.jsx    날씨 · 명언 위젯
    TodoSection.jsx     할 일 목록
    MemoSection.jsx     메모 입력
    StickyNotes.jsx     드래그 가능한 포스트잇
    DiaryModal.jsx      다이어리 모달 (보기/편집)
    Settings.jsx        설정 기어 + 팝오버
```

## 참고

- 배경은 오프라인 동작을 위해 원본의 Unsplash 이미지 대신 CSS 그라디언트 + canvas 별로 대체했습니다.
- 원본 디자인의 마법 커서 효과와 숨겨진 RPG 게임은 이 버전에서 제외했습니다.
