import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// 카메라와 캐릭터 사이를 가로막는 지형지물을 화면 좌표 기준으로 도려낸다.
//
// 핵심은 "캐릭터보다 카메라 쪽에 있는 픽셀만 지운다"는 것 — 가리는 게 없으면
// 지울 픽셀 자체가 안 생기므로, 무엇이 가리고 있는지 찾는 레이캐스트가 필요 없다.
// 항상 켜둬도 공짜다.
//
// 알파 블렌딩 대신 디더 discard 를 쓰는 이유: 나무 캐노피처럼 면이 겹치는
// 오브젝트를 transparent 로 돌리면 정렬이 깨져 안쪽 면이 뚫려 보인다. discard 는
// Opaque 큐에 그대로 머무르므로 그 문제가 없다.
// ─────────────────────────────────────────────────────────────────────────────

const CHEST_Y = 1.4           // 마스크 중심 높이 (카메라 lookAt 타깃과 맞춤)
const MASK_WORLD_RADIUS = 1.5 // 구멍 반경을 "월드 단위"로 정의 → 줌에 맞춰 자동 스케일

// 모든 머티리얼이 이 객체들을 그대로 공유한다. 프레임당 한 번만 갱신하면 끝.
export const maskUniforms = {
  uCenter: { value: new THREE.Vector2(-9999, -9999) }, // drawing-buffer 픽셀
  uRadius: { value: 100 },
  uSoft: { value: 50 },
  uDepth: { value: 1 },   // gl_FragCoord.z 기준 [0,1]
  uAmount: { value: 1 },  // 0 이면 완전히 끔
}

const HEAD = /* glsl */ `
uniform vec2  uCenter;
uniform float uRadius;
uniform float uSoft;
uniform float uDepth;
uniform float uAmount;

// Interleaved Gradient Noise — 픽셀마다 값이 고정이라 카메라가 움직여도
// 지글거림이 적다. 4x4 Bayer 보다 뭉침이 덜하다.
float occIGN(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`

const BODY = /* glsl */ `
if (uAmount > 0.001 && gl_FragCoord.z < uDepth) {
  // 세로로 살짝 길쭉한 타원 — 캐릭터가 서 있는 형태라 원보다 자연스럽다.
  vec2 d = (gl_FragCoord.xy - uCenter) / vec2(1.0, 1.35);
  float keep = mix(1.0, smoothstep(uRadius, uRadius + uSoft, length(d)), uAmount);
  if (keep < occIGN(gl_FragCoord.xy)) discard;
}
`

// 모듈 레벨 함수라 모든 머티리얼의 customProgramCacheKey(기본값 = 이 함수의
// toString)가 동일해져서 셰이더 프로그램이 재사용된다.
function patch(shader) {
  Object.assign(shader.uniforms, maskUniforms)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + HEAD)
    .replace(
      '#include <clipping_planes_fragment>',
      BODY + '\n#include <clipping_planes_fragment>',
    )
}

export function applyOcclusionMask(material) {
  for (const m of Array.isArray(material) ? material : [material]) {
    if (!m || m.userData.__occluder) continue
    m.userData.__occluder = true
    m.onBeforeCompile = patch
    m.needsUpdate = true
  }
}

/**
 * 자식으로 들어온 모든 메시를 "가릴 수 있는 물체"로 등록한다.
 * 바닥/지형과 캐릭터·적은 절대 감싸지 말 것 — 바닥을 넣으면 경사면에서
 * 하늘로 구멍이 뚫린다.
 */
export function Occluders({ children }) {
  const ref = useRef()
  useLayoutEffect(() => {
    ref.current?.traverse((o) => {
      // Points(Sparkles 등)는 커스텀 셰이더라 위 include 가 없다 → 건너뛴다.
      if (o.isMesh && o.material) applyOcclusionMask(o.material)
    })
  }, [])
  return <group ref={ref}>{children}</group>
}

const _center = new THREE.Vector3()
const _edge = new THREE.Vector3()
const _right = new THREE.Vector3()
const _size = new THREE.Vector2()

/**
 * 카메라 위치·회전이 확정된 직후에 호출해야 한다(= camera.lookAt 바로 다음).
 * @param {THREE.Camera} camera
 * @param {THREE.WebGLRenderer} gl
 * @param {{x:number,y:number,z:number}} playerPos
 */
export function updateOcclusionMask(camera, gl, playerPos) {
  // lookAt() 으로 방금 바뀐 회전을 반영해야 project() 가 한 프레임 밀리지 않는다.
  camera.updateMatrixWorld()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()

  _center.set(playerPos.x, playerPos.y + CHEST_Y, playerPos.z)
  // 캐릭터 옆으로 MASK_WORLD_RADIUS 만큼 떨어진 점을 같이 투영해서 픽셀 반경을
  // 역산한다. 이러면 줌인/줌아웃(dist 7~34)에 따라 구멍 크기가 알아서 따라간다.
  _right.setFromMatrixColumn(camera.matrixWorld, 0)
  _edge.copy(_center).addScaledVector(_right, MASK_WORLD_RADIUS)

  _center.project(camera)
  _edge.project(camera)

  gl.getDrawingBufferSize(_size)
  const cx = (_center.x * 0.5 + 0.5) * _size.x
  const cy = (_center.y * 0.5 + 0.5) * _size.y
  const ex = (_edge.x * 0.5 + 0.5) * _size.x
  const ey = (_edge.y * 0.5 + 0.5) * _size.y

  // 최소 반경은 픽셀 고정이 아니라 화면 높이 비율로 — DPR/해상도에 안 흔들린다.
  const r = Math.max(_size.y * 0.045, Math.hypot(ex - cx, ey - cy))

  maskUniforms.uCenter.value.set(cx, cy)
  maskUniforms.uRadius.value = r
  maskUniforms.uSoft.value = r * 0.5
  maskUniforms.uDepth.value = _center.z * 0.5 + 0.5
}
