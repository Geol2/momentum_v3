// 날짜 도우미 — 메인 앱과 G2 안경 앱이 같이 씁니다.
// 이 파일에는 외부 URL을 두지 마세요. G2 앱 번들에 들어가는 외부 주소는 전부
// evenhub/app.json의 network.whitelist에 있어야 Even Hub 심사를 통과합니다.

export const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토']

// 하루를 가리키는 고정 키(예: 2026-11-18). 일기·할 일·메모의 날짜에 씁니다.
export function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
