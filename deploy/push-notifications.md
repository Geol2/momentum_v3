# 알림 (Web Push) 설정

두 종류의 푸시를 보냅니다 — **약속 알림**(시간이 지정된 할 일)과 **습관 알림**(하루 두 번).
앱이 꺼져 있어도 백엔드 스케줄러가 직접 푸시를 쏘기 때문에 도착합니다.

동작 흐름:

```
브라우저: 설정 → "시간 알림 받기" 토글
   → 알림 권한 허용 → PushSubscription 생성 (VAPID 공개키 사용)
   → POST /api/push/subscriptions 로 endpoint 등록

백엔드: ReminderScheduler (매분 실행)
   → 시간이 있고 아직 안 보낸 미완료 할 일 조회
   → (약속시간 − 미리알림분) 이 지났으면 push

백엔드: HabitReminderScheduler (매분 실행)
   → 구독이 있는 계정 중 습관 알림이 켜진 사람
   → 아침 시각(기본 07:00)에 오늘 체크할 습관 예고
   → 밤 시각(기본 22:00)에 아직 체크 안 한 습관 확인
   → 하루 한 번 (settings.habit_*_sent_on 에 발송한 날짜를 남겨 중복 방지)

   → 둘 다 public/sw.js 의 push 핸들러가 OS 알림으로 표시
```

습관 알림은 **보낼 게 있을 때만** 나갑니다. 습관이 하나도 없거나 그날 전부 체크했으면
푸시를 건너뜁니다(발송 표시는 남기므로 남은 시간 동안 다시 조회하지 않습니다).

## 1. VAPID 키 생성 (환경당 1회)

```bash
cd integration-api-backend
./gradlew -q vapidKeys
```

출력된 두 값을 백엔드 환경변수로 설정합니다.

> **키를 함부로 바꾸지 마세요.** 공개키가 바뀌면 기존 구독이 전부 무효가 되어
> 모든 사용자가 알림을 다시 켜야 합니다.

## 2. 백엔드 환경변수

| 변수 | 필수 | 설명 |
|---|---|---|
| `VAPID_PUBLIC_KEY` | ✅ | 1단계 출력값. 미설정 시 알림 기능 전체가 비활성(앱은 정상 기동) |
| `VAPID_PRIVATE_KEY` | ✅ | 1단계 출력값. 절대 커밋 금지 |
| `VAPID_SUBJECT` | | 푸시 서비스가 문제 시 연락할 주소. 기본 `mailto:big9401@gmail.com` |
| `PUSH_APP_URL` | | 알림 탭 시 열 주소. prod 기본 `https://momentum.geol2.com` |
| `PUSH_ZONE` | | 기본 `Asia/Seoul`. 할 일의 날짜·시간을 해석하는 시간대 |
| `PUSH_LEAD_MINUTES` | | 사용자가 직접 고르지 않았을 때의 기본 미리알림(기본 10분) |
| `PUSH_GRACE_MINUTES` | | 서버 재시작 등으로 놓친 알림을 늦게라도 보낼 허용 시간(기본 30분) |
| `PUSH_HABIT_MORNING` | | 습관 아침 예고 기본 시각(기본 `07:00`). 사용자가 설정에서 바꿀 수 있음 |
| `PUSH_HABIT_EVENING` | | 습관 밤 확인 기본 시각(기본 `22:00`). 사용자가 설정에서 바꿀 수 있음 |
| `PUSH_HABIT_GRACE` | | 습관 알림을 늦게라도 보낼 허용 시간(기본 60분) |

## 3. DB

`ddl-auto: update` 라서 별도 마이그레이션 없이 기동 시 자동 반영됩니다.

- 새 테이블 `push_subscriptions`
- `todos.reminded_at` (알림 발송 시각, 중복 발송 방지)
- `settings.remind_lead_minutes` (사용자별 미리알림 분)
- `settings.habit_remind` (습관 알림 on/off, null = 켜짐)
- `settings.habit_morning_time` / `habit_evening_time` (사용자별 "HH:mm")
- `settings.habit_morning_sent_on` / `habit_evening_sent_on` (마지막 발송 날짜, 하루 한 번 보장)

## 4. 프론트엔드

`public/` 의 정적 파일이 **사이트 루트**에서 서빙되어야 합니다.

- `/sw.js` — 서비스워커. 루트에서 서빙돼야 scope 가 `/` 가 됩니다
- `/manifest.webmanifest`, `/icon-192.png`, `/icon-512.png`, `/apple-touch-icon.png`

`npm run build` 결과에 모두 포함되므로 기존 배포 방식 그대로면 추가 작업 없습니다.
아이콘을 다시 만들려면 `node scripts/generate-icons.mjs`.

Cloudflare Worker(`cloudflare-api-proxy.js`)는 `/api/*` 만 프록시하므로 수정 불필요합니다.

## 5. 아이폰 주의사항

iOS 는 **홈 화면에 추가한 PWA 에서만** 웹 푸시를 허용합니다. Safari 탭에서는
구독 자체가 불가능합니다. 설정 화면이 이 상태를 감지해서
`아이폰은 공유 → "홈 화면에 추가"로 설치한 뒤...` 안내를 띄웁니다.

안드로이드 Chrome 은 설치 없이도 동작합니다.

## 6. 확인

1. HTTPS(또는 localhost)로 접속 — 보안 컨텍스트가 아니면 푸시 API 자체가 없습니다
2. 설정 → 약속 알림 → 토글 ON → 권한 허용
3. **테스트 알림 보내기** 로 즉시 확인
4. 실제 검증: 지금부터 12분 뒤 시간으로 할 일을 만들면 (기본 10분 전 설정) 약 2분 뒤 알림

습관 알림은 하루 두 번이라 그대로 기다리기 어렵습니다. 검증하려면 설정에서 시각을
곧 다가올 시간으로 바꾸거나(선택지는 6·7·8시 / 9·10·11시), DB에서 직접 당기세요.

```sql
-- 아침 알림을 1분 뒤로 당겨 확인 (오늘 이미 보냈다면 발송 표시도 지워야 다시 옵니다)
update settings set habit_morning_time = '09:31', habit_morning_sent_on = null where user_id = 1;
```

알림이 안 오면 백엔드 로그를 확인하세요.

- 약속: `Reminder for todo ... → N endpoint(s)`
- 습관: `Habit reminder (morning|evening) for user ... → N endpoint(s)`

`N=0` 이면 구독이 등록되지 않은 것이고, 로그 자체가 없으면 VAPID 키 미설정입니다.
습관 알림 로그만 없다면 ① 습관 알림이 꺼져 있거나 ② 그날 습관을 이미 다 체크했거나
③ 등록된 습관이 없는 경우입니다(셋 다 "보낼 게 없음"이라 정상 동작입니다).
