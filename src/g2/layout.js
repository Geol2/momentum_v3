// G2 화면 한 장(page)을 표현하는 공통 모델.
//
// 안경은 HTML을 그리지 못하고 SDK 컨테이너(텍스트/리스트/이미지)를 좌표로 배치만 할 수
// 있습니다. 그래서 화면은 전부 이 모델로 만들고, 같은 모델을
//   - 브라우저에서는 Preview.jsx가 576×288 초록 화면으로 흉내 내고
//   - Even 앱 WebView에서는 bridge.js가 SDK 컨테이너로 바꿔 안경에 보냅니다.
// 이렇게 해야 PC에서 본 화면과 안경 화면이 어긋나지 않습니다.
//
// page = {
//   texts: [{ name, x, y, w, h, content, level?, border? }],  // 최대 8개
//   capture: 'name',   // 제스처를 받을 텍스트 컨테이너 이름 (정확히 하나)
// }
// level: 밝기 0~4 (SDK textColor). 생략하면 4(가장 밝음).

export const SCREEN_W = 576
export const SCREEN_H = 288

// SDK 제한 (hub.evenrealities.com/docs/build/display 기준)
export const LIMITS = {
  maxTexts: 8,
  maxPageChars: 1000, // createStartUp/rebuild 한 번에 보낼 수 있는 글자 수
}

// 한 줄 텍스트 블록을 쉽게 만들기 위한 도우미
export function text(name, x, y, w, h, content, opts = {}) {
  return { name, x, y, w, h, content: String(content ?? ''), ...opts }
}

// 미리보기에서 경고로 띄울 제한 위반 목록
export function validatePage(page) {
  const problems = []
  const texts = page.texts || []
  if (texts.length > LIMITS.maxTexts) problems.push(`텍스트 컨테이너 ${texts.length}개 (최대 ${LIMITS.maxTexts})`)
  const total = texts.reduce((n, t) => n + t.content.length, 0)
  if (total > LIMITS.maxPageChars) problems.push(`글자 수 ${total}자 (한 번에 최대 ${LIMITS.maxPageChars}자)`)
  if (!texts.some((t) => t.name === page.capture)) problems.push('제스처를 받을 컨테이너(capture)가 없음')
  for (const t of texts) {
    if (t.x < 0 || t.y < 0 || t.x + t.w > SCREEN_W || t.y + t.h > SCREEN_H) {
      problems.push(`'${t.name}'이 화면(576×288) 밖으로 나감`)
    }
  }
  return problems
}

// 모델 → SDK createStartUpPageContainer / rebuildPageContainer 인자
export function toSdkContainer(page) {
  const textObject = page.texts.map((t, i) => ({
    xPosition: t.x,
    yPosition: t.y,
    width: t.w,
    height: t.h,
    containerID: i + 1,
    containerName: t.name,
    content: t.content,
    zOrderIndex: i + 1,
    isEventCapture: t.name === page.capture ? 1 : 0,
    ...(t.level != null ? { textColor: t.level } : {}),
    ...(t.border ? { borderWidth: 1, borderColor: 4, borderRadius: 6, paddingLength: 6 } : {}),
  }))
  return { containerTotalNum: textObject.length, textObject }
}

// 긴 목록에서 커서 주변만 잘라 보여줄 때 쓰는 창 계산
export function windowAround(items, cursor, size) {
  if (items.length <= size) return { start: 0, slice: items }
  const start = Math.min(Math.max(0, cursor - Math.floor(size / 2)), items.length - size)
  return { start, slice: items.slice(start, start + size) }
}
