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
  const { waitForEvenAppBridge, OsEventTypeList, StartUpPageCreateResult, AudioInputSource } =
    await import('@evenrealities/even_hub_sdk')
  const bridge = await waitForEvenAppBridge()
  let started = false

  // 같은 화면을 다시 보내지 않도록 마지막으로 보낸 내용을 기억합니다.
  // (화면 전체 갱신은 수백 ms가 걸려서, 불필요한 rebuild는 깜빡임으로 보입니다.)
  let lastSent = ''
  let lastPayload = null
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
      } else if (!(await upgradeTexts(lastPayload, payload))) {
        const ok = await bridge.rebuildPageContainer(payload)
        if (!ok) console.warn('[g2] rebuild 실패')
      }
      lastPayload = payload
    }).catch((e) => console.error('[g2] 화면 전송 오류', e))
    return queue
  }

  // 배치는 그대로고 글자만 바뀌었으면(쪽 넘김, 진행 상황, 카드 넘기기) 바뀐 글 상자만 고칩니다.
  // 화면 전체를 다시 만드는 것보다 훨씬 빨라서, 연달아 쓸어도 반응이 끊기지 않습니다.
  // 배치가 달라졌거나 고치기에 실패하면 false → 전체 다시 그리기.
  async function upgradeTexts(prev, next) {
    if (!prev || !sameLayout(prev, next)) return false
    for (let i = 0; i < next.textObject.length; i++) {
      const a = prev.textObject[i]
      const b = next.textObject[i]
      if (a.content === b.content && a.textColor === b.textColor) continue
      const ok = await bridge.textContainerUpgrade({
        containerID: b.containerID,
        containerName: b.containerName,
        content: b.content,
        ...(b.textColor != null ? { textColor: b.textColor } : {}),
      })
      if (!ok) return false
    }
    return true
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

  // 홈(루트) 화면에서 두 번 누르면 호출합니다. Even Hub 심사 규칙상 모드 1(시스템이
  // 종료 확인을 띄움)이어야 하고, 모드 0이나 앱 자체 종료 대화상자는 반려됩니다.
  function close() {
    return bridge.shutDownPageContainer(1)
  }

  // 안경 마이크. 소리는 audioEvent로 100ms씩 들어옵니다(PCM 16bit little-endian 모노, 16kHz).
  // 화면(startup page)을 만든 뒤에만 켤 수 있어서, show()가 한 번 끝난 다음에 부릅니다.
  let offAudio = null
  async function startMic(onChunk) {
    await queue
    const ok = await bridge.audioControl(true, AudioInputSource.Glasses)
    if (!ok) throw new Error('안경 마이크를 켜지 못했어요')
    offAudio?.()
    offAudio = bridge.onEvenHubEvent((event) => {
      const pcm = event.audioEvent?.audioPcm
      if (pcm) onChunk(toBytes(pcm))
    })
  }
  async function stopMic() {
    offAudio?.()
    offAudio = null
    await bridge.audioControl(false)
  }

  return { show, onGesture, close, startMic, stopMic }
}

// 글자(content)와 밝기(textColor) 말고 모두 같으면 같은 배치입니다.
function sameLayout(a, b) {
  if (a.containerTotalNum !== b.containerTotalNum || a.textObject.length !== b.textObject.length) return false
  const strip = ({ content, textColor, ...rest }) => JSON.stringify(rest)
  return a.textObject.every((t, i) => strip(t) === strip(b.textObject[i]))
}

// 호스트가 PCM을 Uint8Array, 숫자 배열, base64 문자열 중 하나로 줍니다(SDK 문서).
function toBytes(pcm) {
  if (pcm instanceof Uint8Array) return pcm
  if (Array.isArray(pcm)) return Uint8Array.from(pcm)
  if (typeof pcm === 'string') {
    const bin = atob(pcm)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new Uint8Array(0)
}
