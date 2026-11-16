// Even 앱 WebView 안에서 실행될 때만 실제 안경과 연결합니다.
// 일반 브라우저에서는 SDK 네이티브 호출이 불가능하므로(Flutter handler 없음)
// null을 돌려주고, 화면은 Preview.jsx 미리보기로만 확인합니다.
import { toSdkContainer } from './layout.js'

export function isInEvenApp() {
  return typeof window !== 'undefined' && !!window.flutter_inappwebview?.callHandler
}

// 제스처 이름 (미리보기 키보드와 안경 입력이 같은 이름을 씁니다)
//   tap: 한 번 누르기 · double: 두 번 누르기 · up/down: 위/아래로 쓸기 · long: 길게 누르기
export const GESTURES = ['tap', 'double', 'up', 'down', 'long']

export async function connectGlasses() {
  if (!isInEvenApp()) return null

  // SDK는 WebView에서만 쓰므로 동적 import — 일반 미리보기 번들에는 영향이 없습니다.
  const { waitForEvenAppBridge, OsEventTypeList, StartUpPageCreateResult } =
    await import('@evenrealities/even_hub_sdk')
  const bridge = await waitForEvenAppBridge()
  let started = false

  // 같은 화면을 다시 보내지 않도록 마지막으로 보낸 내용을 기억합니다.
  // (화면 전체 갱신은 수백 ms가 걸려서, 불필요한 rebuild는 깜빡임으로 보입니다.)
  let lastSent = ''
  let queue = Promise.resolve()

  function show(page) {
    const payload = toSdkContainer(page)
    const key = JSON.stringify(payload)
    if (key === lastSent) return queue
    lastSent = key
    // 컨테이너 호출이 겹치면 안 되므로 순서대로 보냅니다.
    queue = queue.then(async () => {
      if (!started) {
        const res = await bridge.createStartUpPageContainer(payload)
        if (res !== StartUpPageCreateResult.success) console.warn('[g2] startup 실패', res)
        started = true
      } else {
        const ok = await bridge.rebuildPageContainer(payload)
        if (!ok) console.warn('[g2] rebuild 실패')
      }
    }).catch((e) => console.error('[g2] 화면 전송 오류', e))
    return queue
  }

  function onGesture(cb) {
    return bridge.onEvenHubEvent((event) => {
      const ev = event.textEvent || event.listEvent || event.sysEvent
      if (!ev) return
      // CLICK_EVENT는 값이 0이라 protobuf JSON에서 필드 자체가 빠져 올 수 있습니다.
      const type = ev.eventType ?? OsEventTypeList.CLICK_EVENT
      const name = {
        [OsEventTypeList.CLICK_EVENT]: 'tap',
        [OsEventTypeList.DOUBLE_CLICK_EVENT]: 'double',
        [OsEventTypeList.SCROLL_TOP_EVENT]: 'up',
        [OsEventTypeList.SCROLL_BOTTOM_EVENT]: 'down',
        [OsEventTypeList.LONG_PRESS_EVENT]: 'long',
      }[type]
      if (name) cb(name)
    })
  }

  function close() {
    return bridge.shutDownPageContainer(0)
  }

  return { show, onGesture, close }
}
