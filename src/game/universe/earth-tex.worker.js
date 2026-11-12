// 지구 기본 텍스처(기후대 색·바다·도시 불빛 등)를 메인 스레드 밖에서 생성 — 첫 진입 시 화면이 멈추지 않게
import { buildTextures } from './earth.js'
self.onmessage = () => {
  const t = buildTextures()
  const bufs = [t.landCol, t.oceanCol, t.ice, t.lights, t.cityLights, t.nearTex, t.clouds, t.sdf.data].map((a) => a.buffer)
  self.postMessage(t, bufs)
}
