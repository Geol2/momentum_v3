import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Stars, Sparkles } from '@react-three/drei'
import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// 달빛 원정 — a hidden WoW-style third-person 3D RPG easter egg.
//   • WASD : 이동 (카메라 기준)
//   • 마우스 드래그 : 카메라 회전 / 휠 : 줌
//   • 좌클릭 / Space : 공격 · Shift : 질주 · ESC : 종료
// Everything renders from primitives — zero external assets, so it works offline.
// ─────────────────────────────────────────────────────────────────────────────

const WORLD_RADIUS = 60
const PLAYER_SPEED = 7
const SPRINT_MULT = 1.7
const ATTACK_RANGE = 3.2
const ATTACK_COOLDOWN = 420 // ms
// dodge roll
const ROLL_TIME = 0.42   // seconds
const ROLL_SPEED = 17    // burst speed
const ROLL_COOL = 0.75   // cooldown after a roll
const ROLL_IFRAME = 0.12 // roll ends its i-frames this many seconds before finishing
// enemy combat
const ENEMY_AGGRO = 15
const ENEMY_REACH = 2.0     // gets this close, then telegraphs an attack
const ENEMY_WINDUP = 0.6    // telegraph duration (time to dodge)
const ENEMY_STRIKE = 0.22   // strike/lunge duration
const ENEMY_HITRANGE = 2.6  // must still be this close at the strike to get hit
const ENEMY_RECOVER = 0.55

// Reused scratch vectors — the player's useFrame runs 60×/s, so allocating fresh
// Vector3s each frame would churn the GC and cause periodic hitches (felt most
// during busy moments like a kill). Mutating these shared temps allocates nothing.
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _move = new THREE.Vector3()
const _target = new THREE.Vector3()
const _off = new THREE.Vector3()
const _desired = new THREE.Vector3()
const _rollDir = new THREE.Vector3()

export default function Game3D({ onExit }) {
  // ALL live game state lives on this mutable bus. Mutating it never triggers a
  // React render, so collecting / attacking / killing can't reconcile the <Canvas>
  // subtree — that reconcile was the source of the per-event hitch. The HUD reads
  // the bus on its own rAF loop (see GameHud) and only re-renders when a *shown*
  // value actually changes.
  const bus = useRef({
    playerPos: new THREE.Vector3(0, 0, 0),
    camera: { yaw: 0, pitch: 0.62, dist: 12 },
    keys: {},
    attackAt: 0,       // timestamp of last swing, consumed by enemies
    attackSeq: 0,      // increments each swing
    dodgeSeq: 0,       // increments each dodge roll
    invuln: false,     // true during roll i-frames — enemy strikes pass through
    hp: 100, score: 0, kills: 0, dead: false,
    toast: '', toastAt: 0,
  }).current

  const api = useMemo(() => ({
    addScore: (n) => { bus.score += n },
    heal: (n) => { bus.hp = Math.min(100, bus.hp + n) },
    onKill: () => { bus.kills += 1; bus.toast = '처치! +50'; bus.toastAt = performance.now() },
    damage: (n) => {
      bus.hp = Math.max(0, bus.hp - n)
      if (bus.hp === 0) bus.dead = true
    },
  }), [bus])

  // Keyboard + swing input.
  useEffect(() => {
    const down = (e) => {
      if (e.code === 'Escape') { onExit(); return }
      bus.keys[e.code] = true
      if (e.code === 'Space') {
        e.preventDefault()
        bus.dodgeAt = performance.now(); bus.dodgeSeq++ // dodge roll
      }
    }
    const up = (e) => { bus.keys[e.code] = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [bus, onExit])

  // Camera drag + zoom on the canvas wrapper.
  const dragging = useRef(false)
  const last = useRef({ x: 0, y: 0 })
  const onPointerDown = (e) => { dragging.current = true; last.current = { x: e.clientX, y: e.clientY } }
  const onPointerUp = () => { dragging.current = false }
  const onPointerMove = (e) => {
    if (!dragging.current) return
    const dx = e.clientX - last.current.x
    const dy = e.clientY - last.current.y
    last.current = { x: e.clientX, y: e.clientY }
    bus.camera.yaw -= dx * 0.005
    bus.camera.pitch = THREE.MathUtils.clamp(bus.camera.pitch + dy * 0.004, 0.12, 1.35)
  }
  const onWheel = (e) => {
    bus.camera.dist = THREE.MathUtils.clamp(bus.camera.dist + Math.sign(e.deltaY) * 1.1, 5, 26)
  }
  const onClickAttack = () => {
    if (bus.dead) return
    bus.attackAt = performance.now(); bus.attackSeq++
  }

  const respawn = () => { bus.hp = 100; bus.dead = false; bus.playerPos.set(0, 0, 0) }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#05060f', cursor: 'grab' }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onPointerMove={onPointerMove}
      onWheel={onWheel}
    >
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ fov: 55, near: 0.1, far: 400, position: [0, 8, 12] }}
        onClick={onClickAttack}
      >
        <World bus={bus} api={api} />
      </Canvas>

      {/* HUD is a sibling of the Canvas and owns its own state, so its updates
          never re-render the 3D scene. */}
      <GameHud bus={bus} onExit={onExit} onRespawn={respawn} />
    </div>
  )
}

// Polls the bus each frame and re-renders only when a displayed value changes —
// this is the ONLY React state that updates during gameplay, and it touches
// nothing inside the <Canvas>.
function GameHud({ bus, onExit, onRespawn }) {
  const [ui, setUi] = useState({ hp: 100, score: 0, kills: 0, dead: false, toast: '' })
  useEffect(() => {
    let raf
    let prev = { hp: -1, score: -1, kills: -1, dead: null, toast: null }
    const tick = () => {
      const toast = bus.toastAt && performance.now() - bus.toastAt < 1400 ? bus.toast : ''
      if (bus.hp !== prev.hp || bus.score !== prev.score || bus.kills !== prev.kills || bus.dead !== prev.dead || toast !== prev.toast) {
        prev = { hp: bus.hp, score: bus.score, kills: bus.kills, dead: bus.dead, toast }
        setUi(prev)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [bus])

  return (
    <>
      <Hud hp={ui.hp} score={ui.score} kills={ui.kills} toast={ui.toast} onExit={onExit} />
      {ui.dead && <DeathScreen score={ui.score} kills={ui.kills} onRespawn={onRespawn} onExit={onExit} />}
    </>
  )
}

// ── The scene ────────────────────────────────────────────────────────────────
function World({ bus, api }) {
  const decorations = useMemo(() => buildDecorations(), [])
  const stars = useMemo(() => buildStars(), [])
  const enemies = useMemo(() => buildEnemies(), [])

  return (
    <>
      <color attach="background" args={['#060811']} />
      <fog attach="fog" args={['#0a0e1c', 28, 115]} />

      {/* Moonlit lighting */}
      <ambientLight intensity={0.4} color="#5a6bb0" />
      <hemisphereLight args={['#33477e', '#05060c', 0.65]} />
      <directionalLight
        position={[30, 55, 20]} intensity={1.2} color="#cdd6ff"
        castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-80} shadow-camera-right={80}
        shadow-camera-top={80} shadow-camera-bottom={-80}
      />
      {/* cool rim light from the moon side */}
      <directionalLight position={[-45, 25, -60]} intensity={0.5} color="#7f9bff" />

      <Stars radius={180} depth={60} count={4500} factor={5} saturation={0} fade speed={0.6} />
      <Moon />

      <Ground />
      {decorations.map((d, i) => <Decoration key={i} {...d} />)}
      {stars.map((s) => <Collectible key={s.id} data={s} bus={bus} api={api} />)}
      {enemies.map((e) => <Enemy key={e.id} data={e} bus={bus} api={api} />)}

      {/* fireflies drifting across the whole clearing */}
      <Sparkles count={130} scale={[WORLD_RADIUS * 2, 7, WORLD_RADIUS * 2]} position={[0, 3.5, 0]} size={2.6} speed={0.3} opacity={0.7} color="#bcd0ff" />
      <Sparkles count={40} scale={[WORLD_RADIUS * 1.4, 2, WORLD_RADIUS * 1.4]} position={[0, 0.8, 0]} size={3.5} speed={0.15} opacity={0.55} color="#ffe6a8" />

      <Player bus={bus} />
    </>
  )
}

// ── Player + WoW camera rig ──────────────────────────────────────────────────
function Player({ bus }) {
  const group = useRef()
  const bob = useRef()
  const swordPivot = useRef()
  const leftLeg = useRef()
  const rightLeg = useRef()
  const leftArm = useRef()
  const walkPhase = useRef(0)
  const swing = useRef({ seq: 0, t: 1 })
  const roll = useRef({ seq: 0, t: 0, cool: 0 })
  const facing = useRef(Math.PI)
  const { camera } = useThree()

  // A flat arrow that lies on the ground pointing out the character's front — the
  // clearest "which way am I looking" cue in a top-down WoW-style view.
  const arrowShape = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(0, 0.8); s.lineTo(-0.36, 0.05); s.lineTo(-0.14, 0.05)
    s.lineTo(-0.14, -0.5); s.lineTo(0.14, -0.5); s.lineTo(0.14, 0.05)
    s.lineTo(0.36, 0.05); s.closePath()
    return s
  }, [])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const g = group.current
    if (!g) return

    // Desired move (camera-relative), frozen while dead.
    const k = bus.keys
    const yaw = bus.camera.yaw
    const fwd = _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw))
    const right = _right.set(Math.cos(yaw), 0, -Math.sin(yaw))
    const move = _move.set(0, 0, 0)
    if (!bus.dead) {
      if (k['KeyW'] || k['ArrowUp']) move.add(fwd)
      if (k['KeyS'] || k['ArrowDown']) move.sub(fwd)
      if (k['KeyD'] || k['ArrowRight']) move.add(right)
      if (k['KeyA'] || k['ArrowLeft']) move.sub(right)
    }
    const wantMove = move.lengthSq() > 0
    if (wantMove) move.normalize()

    // Start a dodge roll (Space), if off cooldown.
    if (bus.dodgeSeq !== roll.current.seq) {
      roll.current.seq = bus.dodgeSeq
      if (!bus.dead && roll.current.t <= 0 && roll.current.cool <= 0) {
        roll.current.t = ROLL_TIME
        roll.current.cool = ROLL_TIME + ROLL_COOL
        if (wantMove) _rollDir.copy(move)
        else _rollDir.set(Math.sin(facing.current), 0, Math.cos(facing.current)) // roll forward
      }
    }
    if (roll.current.cool > 0) roll.current.cool -= dt

    const rolling = roll.current.t > 0
    let moving = false
    if (rolling) {
      roll.current.t -= dt
      const k2 = Math.max(0, roll.current.t) / ROLL_TIME
      bus.playerPos.addScaledVector(_rollDir, ROLL_SPEED * (0.35 + k2 * 0.65) * dt)
      facing.current = Math.atan2(_rollDir.x, _rollDir.z)
      bus.invuln = roll.current.t > ROLL_IFRAME // i-frames for most of the roll
    } else {
      bus.invuln = false
      if (wantMove) {
        const speed = PLAYER_SPEED * ((k['ShiftLeft'] || k['ShiftRight']) ? SPRINT_MULT : 1)
        bus.playerPos.addScaledVector(move, speed * dt)
        facing.current = Math.atan2(move.x, move.z)
        moving = true
      }
    }
    // keep inside the world
    const r = Math.hypot(bus.playerPos.x, bus.playerPos.z)
    if (r > WORLD_RADIUS) { bus.playerPos.x *= WORLD_RADIUS / r; bus.playerPos.z *= WORLD_RADIUS / r }

    g.position.copy(bus.playerPos)
    // smooth turn toward facing
    let d = facing.current - g.rotation.y
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    g.rotation.y += d * Math.min(1, dt * 12)
    // roll tumble takes over the body; otherwise run the walk cycle
    if (rolling) {
      if (bob.current) {
        bob.current.rotation.x = (1 - Math.max(0, roll.current.t) / ROLL_TIME) * Math.PI * 2
        bob.current.position.y = Math.sin((1 - roll.current.t / ROLL_TIME) * Math.PI) * 0.18
      }
    } else {
      if (bob.current) bob.current.rotation.x *= 0.6 // settle out of a tumble
      if (moving) {
        walkPhase.current += dt * 9
        const a = Math.sin(walkPhase.current) * 0.5
        if (leftLeg.current) leftLeg.current.rotation.x = a
        if (rightLeg.current) rightLeg.current.rotation.x = -a
        if (leftArm.current) leftArm.current.rotation.x = -a * 0.8
        if (bob.current) bob.current.position.y = Math.abs(Math.sin(walkPhase.current)) * 0.08
      } else {
        if (leftLeg.current) leftLeg.current.rotation.x *= 0.85
        if (rightLeg.current) rightLeg.current.rotation.x *= 0.85
        if (leftArm.current) leftArm.current.rotation.x *= 0.85
        if (bob.current) bob.current.position.y *= 0.85
      }
    }

    // sword swing — the whole right arm + blade sweep across the FRONT (+Z), never behind
    const sp = swordPivot.current
    if (sp) {
      if (bus.attackSeq !== swing.current.seq) { swing.current.seq = bus.attackSeq; swing.current.t = 0 }
      if (swing.current.t < 1) {
        swing.current.t = Math.min(1, swing.current.t + dt * 3.2)
        const t = swing.current.t
        const s = 1 - Math.pow(1 - t, 2) // ease-out
        sp.rotation.y = 1.15 - s * 2.05 // +1.15 (front-right) → −0.9 (front-left)
        sp.rotation.x = 0.5 - Math.sin(t * Math.PI) * 0.5 // dip through the middle
      } else {
        // ease back to the resting guard pose
        sp.rotation.y += (0.45 - sp.rotation.y) * Math.min(1, dt * 10)
        sp.rotation.x += (0.5 - sp.rotation.x) * Math.min(1, dt * 10)
      }
    }

    // WoW camera: orbit behind the player.
    const { pitch, dist } = bus.camera
    const target = _target.set(bus.playerPos.x, bus.playerPos.y + 1.4, bus.playerPos.z)
    _off.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)).multiplyScalar(dist)
    _desired.set(target.x + _off.x, target.y + _off.y, target.z + _off.z)
    camera.position.lerp(_desired, Math.min(1, dt * 10))
    camera.lookAt(target)
  })

  return (
    <group ref={group}>
      <group ref={bob}>
        {/* ===== LEGS (swing while walking) ===== */}
        <group ref={leftLeg} position={[-0.13, 0.56, 0]}>
          <mesh castShadow position={[0, -0.26, 0]}>
            <capsuleGeometry args={[0.09, 0.34, 4, 8]} />
            <meshStandardMaterial color="#2a3566" roughness={0.7} />
          </mesh>
          <mesh castShadow position={[0, -0.5, 0.06]}>
            <boxGeometry args={[0.16, 0.13, 0.3]} />
            <meshStandardMaterial color="#141a34" roughness={0.85} />
          </mesh>
        </group>
        <group ref={rightLeg} position={[0.13, 0.56, 0]}>
          <mesh castShadow position={[0, -0.26, 0]}>
            <capsuleGeometry args={[0.09, 0.34, 4, 8]} />
            <meshStandardMaterial color="#2a3566" roughness={0.7} />
          </mesh>
          <mesh castShadow position={[0, -0.5, 0.06]}>
            <boxGeometry args={[0.16, 0.13, 0.3]} />
            <meshStandardMaterial color="#141a34" roughness={0.85} />
          </mesh>
        </group>

        {/* ===== HIPS · BELT · TORSO ===== */}
        <mesh castShadow position={[0, 0.64, 0]}>
          <boxGeometry args={[0.42, 0.22, 0.28]} />
          <meshStandardMaterial color="#222a52" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.75, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.1, 18]} />
          <meshStandardMaterial color="#6b5320" metalness={0.5} roughness={0.5} />
        </mesh>
        <mesh castShadow position={[0, 1.02, 0]}>
          <capsuleGeometry args={[0.27, 0.4, 6, 14]} />
          <meshStandardMaterial color="#3a4d8f" metalness={0.35} roughness={0.5} />
        </mesh>
        {/* chest gem */}
        <mesh position={[0, 1.08, 0.24]}>
          <octahedronGeometry args={[0.09, 0]} />
          <meshStandardMaterial color="#7fe0ff" emissive="#4fd0ff" emissiveIntensity={2} toneMapped={false} />
        </mesh>

        {/* ===== CAPE on the BACK (−Z) ===== */}
        <mesh castShadow position={[0, 1.0, -0.24]} rotation={[0.14, 0, 0]}>
          <boxGeometry args={[0.52, 1.0, 0.04]} />
          <meshStandardMaterial color="#20264d" side={THREE.DoubleSide} roughness={0.85} />
        </mesh>

        {/* ===== PAULDRONS ===== */}
        <mesh castShadow position={[-0.34, 1.32, 0]}>
          <sphereGeometry args={[0.16, 14, 14]} />
          <meshStandardMaterial color="#2c3a72" metalness={0.4} roughness={0.5} />
        </mesh>
        <mesh castShadow position={[0.34, 1.32, 0]}>
          <sphereGeometry args={[0.16, 14, 14]} />
          <meshStandardMaterial color="#2c3a72" metalness={0.4} roughness={0.5} />
        </mesh>

        {/* ===== LEFT ARM (swings while walking) ===== */}
        <group ref={leftArm} position={[-0.34, 1.28, 0]}>
          <mesh castShadow position={[0, -0.24, 0]}>
            <capsuleGeometry args={[0.075, 0.34, 4, 8]} />
            <meshStandardMaterial color="#33427d" roughness={0.6} />
          </mesh>
          <mesh castShadow position={[0, -0.47, 0.02]}>
            <sphereGeometry args={[0.09, 10, 10]} />
            <meshStandardMaterial color="#e6d3b8" roughness={0.7} />
          </mesh>
        </group>

        {/* ===== NECK · HELMET · FACE ===== */}
        <mesh position={[0, 1.44, 0]}>
          <cylinderGeometry args={[0.1, 0.13, 0.12, 10]} />
          <meshStandardMaterial color="#e6d3b8" roughness={0.7} />
        </mesh>
        <mesh castShadow position={[0, 1.58, 0]}>
          <sphereGeometry args={[0.2, 18, 18]} />
          <meshStandardMaterial color="#3a4d8f" metalness={0.45} roughness={0.45} />
        </mesh>
        {/* dark visor slit on the front (+Z) */}
        <mesh position={[0, 1.56, 0.13]}>
          <boxGeometry args={[0.27, 0.07, 0.12]} />
          <meshStandardMaterial color="#080b18" roughness={1} />
        </mesh>
        {/* glowing eyes — instantly read the facing direction up close */}
        <mesh position={[-0.07, 1.56, 0.2]}>
          <sphereGeometry args={[0.03, 10, 10]} />
          <meshStandardMaterial color="#bfeaff" emissive="#5fd0ff" emissiveIntensity={2.6} toneMapped={false} />
        </mesh>
        <mesh position={[0.07, 1.56, 0.2]}>
          <sphereGeometry args={[0.03, 10, 10]} />
          <meshStandardMaterial color="#bfeaff" emissive="#5fd0ff" emissiveIntensity={2.6} toneMapped={false} />
        </mesh>
        {/* helmet crest / plume */}
        <mesh castShadow position={[0, 1.75, -0.02]} rotation={[0.25, 0, 0]}>
          <boxGeometry args={[0.045, 0.26, 0.2]} />
          <meshStandardMaterial color="#7fe0ff" emissive="#4fd0ff" emissiveIntensity={1.1} toneMapped={false} />
        </mesh>

        {/* ===== RIGHT ARM + SWORD (whole arm swings on the shoulder pivot) ===== */}
        <group ref={swordPivot} position={[0.34, 1.3, 0.02]} rotation={[0.5, 0.45, 0]}>
          {/* upper→fore arm reaching forward to the grip */}
          <mesh castShadow position={[0, -0.1, 0.2]} rotation={[1.15, 0, 0]}>
            <capsuleGeometry args={[0.075, 0.4, 4, 8]} />
            <meshStandardMaterial color="#33427d" roughness={0.6} />
          </mesh>
          {/* gauntlet hand */}
          <mesh castShadow position={[0, -0.15, 0.42]}>
            <sphereGeometry args={[0.1, 10, 10]} />
            <meshStandardMaterial color="#cbd6ee" metalness={0.5} roughness={0.5} />
          </mesh>
          {/* crossguard */}
          <mesh position={[0, -0.15, 0.5]}>
            <boxGeometry args={[0.32, 0.07, 0.08]} />
            <meshStandardMaterial color="#8a6b3a" metalness={0.6} roughness={0.4} />
          </mesh>
          {/* blade extends forward (+Z) */}
          <mesh castShadow position={[0, -0.15, 1.02]}>
            <boxGeometry args={[0.08, 0.08, 1.04]} />
            <meshStandardMaterial color="#dbe8ff" emissive="#3a5fd0" emissiveIntensity={0.6} metalness={0.7} roughness={0.3} />
          </mesh>
          {/* glowing tip */}
          <mesh position={[0, -0.15, 1.56]}>
            <sphereGeometry args={[0.08, 10, 10]} />
            <meshStandardMaterial color="#bcd4ff" emissive="#5f8bff" emissiveIntensity={2.2} toneMapped={false} />
          </mesh>
        </group>
      </group>

      <SwingArc bus={bus} />

      {/* ground facing-arrow — rotation +π/2 about X lays it flat with the tip
          (shape's +Y) pointing to world +Z, i.e. the character's true front. */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.04, 0.5]}>
        <shapeGeometry args={[arrowShape]} />
        <meshBasicMaterial color="#93baff" transparent opacity={0.72} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      {/* selection ring under the feet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.52, 0.7, 40]} />
        <meshBasicMaterial color="#4f74d8" transparent opacity={0.42} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// A crescent slash that flashes in front along the blade's path, then fades fast.
// It hugs the character (fixed radius) instead of ballooning outward like the old
// shockwave ring — so it reads as a sword arc, not a wind blast.
function SwingArc({ bus }) {
  const ref = useRef()
  const mat = useRef()
  const seen = useRef(0)
  const t = useRef(1)
  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    if (bus.attackSeq !== seen.current) { seen.current = bus.attackSeq; t.current = 0 }
    if (t.current < 1) {
      t.current = Math.min(1, t.current + dt * 4.5) // ~0.22s, snappy
      const e = 1 - Math.pow(1 - t.current, 2)
      g.visible = true
      g.scale.setScalar(0.9 + e * 0.2) // barely grows
      if (mat.current) mat.current.opacity = 0.85 * (1 - t.current) ** 1.4
    } else {
      g.visible = false
    }
  })
  return (
    <group ref={ref} visible={false} position={[0, 1.05, 0]}>
      {/* wide-but-thin arc. rotation +π/2 about X maps the ring's centre (local +Y)
          to world +Z, so the slash lands in FRONT of the character — matching the
          blade sweep and the facing arrow. (−π/2 put it behind, toward the camera.) */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.85, 1.28, 48, 1, Math.PI / 2 - 0.9, 1.8]} />
        <meshBasicMaterial ref={mat} color="#cfe4ff" transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

// ── Enemies — shadow wisps that stalk, telegraph a lunge, then strike ─────────
// Dark-Souls-style: they DON'T hurt you by touching. They wind up a visible
// attack (glow + red ground ring); if you're still in range when the strike
// lands you take damage — dodge-roll or step out during the wind-up to avoid it.
function Enemy({ data, bus, api }) {
  const group = useRef()
  const core = useRef()
  const bar = useRef()
  const tele = useRef()
  const teleMat = useRef()
  const state = useRef({
    hp: data.hp, alive: true, x: data.x, z: data.z, seen: 0, hurtT: 0,
    mode: 'roam', timer: 0, cool: 0, struck: false, lx: 0, lz: 0,
  })

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const s = state.current
    const g = group.current
    if (!g || !s.alive) return

    const p = bus.playerPos
    const dx = p.x - s.x, dz = p.z - s.z
    const dist = Math.hypot(dx, dz) || 0.0001
    const nx = dx / dist, nz = dz / dist
    if (s.cool > 0) s.cool -= dt

    // ── combat state machine ──
    if (s.mode === 'windup') {
      s.timer -= dt
      s.x += nx * 0.5 * dt; s.z += nz * 0.5 * dt // creep in a touch
      if (s.timer <= 0) { s.mode = 'strike'; s.timer = ENEMY_STRIKE; s.struck = false; s.lx = nx; s.lz = nz }
    } else if (s.mode === 'strike') {
      s.x += s.lx * 9.5 * dt; s.z += s.lz * 9.5 * dt // lunge along the locked direction
      if (!s.struck) {
        s.struck = true
        // damage lands ONLY here, and only if still in range and not mid-dodge
        if (dist < ENEMY_HITRANGE && !bus.invuln && !bus.dead) api.damage(16)
      }
      s.timer -= dt
      if (s.timer <= 0) { s.mode = 'recover'; s.timer = ENEMY_RECOVER; s.cool = ENEMY_RECOVER + 0.5 }
    } else if (s.mode === 'recover') {
      s.timer -= dt
      if (s.timer <= 0) s.mode = 'chase'
    } else if (dist < ENEMY_AGGRO) {
      if (dist > ENEMY_REACH) { s.x += nx * 3.4 * dt; s.z += nz * 3.4 * dt; s.mode = 'chase' }
      else if (s.cool <= 0) { s.mode = 'windup'; s.timer = ENEMY_WINDUP } // in range → telegraph
      else s.mode = 'chase'
    } else {
      s.mode = 'roam'
      s.x += Math.sin(performance.now() * 0.0004 + data.id) * 0.6 * dt
      s.z += Math.cos(performance.now() * 0.0005 + data.id) * 0.6 * dt
    }

    // player attacking this enemy
    if (bus.attackSeq !== s.seen && performance.now() - bus.attackAt < 200) {
      s.seen = bus.attackSeq
      if (dist < ATTACK_RANGE) {
        s.hp -= 34; s.hurtT = 1
        if (s.hp <= 0) { s.alive = false; g.visible = false; api.addScore(50); api.onKill(); return }
      }
    }

    // ── visuals ──
    const bobY = 1.1 + Math.sin(performance.now() * 0.003 + data.id) * 0.22
    g.position.set(s.x, bobY, s.z)
    g.rotation.y += dt * (s.mode === 'windup' ? 5 : 1.5) // spin up while charging
    if (bar.current) {
      bar.current.scale.x = Math.max(0.001, s.hp / data.hp)
      bar.current.parent.lookAt(p.x, bobY, p.z)
    }
    // core glow: ramp up on wind-up (the tell), flare on strike, flash on hurt
    if (core.current) {
      let ei = 1.3
      if (s.mode === 'windup') ei = 1.3 + (1 - s.timer / ENEMY_WINDUP) * 2.4
      else if (s.mode === 'strike') ei = 3.8
      if (s.hurtT > 0) { s.hurtT -= dt * 3; ei += s.hurtT * 2.5 }
      core.current.material.emissiveIntensity = ei
    }
    // red danger ring on the ground during wind-up / strike
    if (tele.current) {
      tele.current.position.y = 0.05 - bobY // pin to the ground despite the bob
      if (s.mode === 'windup') {
        tele.current.visible = true
        const w = 1 - s.timer / ENEMY_WINDUP
        tele.current.scale.setScalar(0.7 + w * 0.7)
        if (teleMat.current) teleMat.current.opacity = 0.18 + w * 0.5
      } else if (s.mode === 'strike') {
        tele.current.visible = true
        tele.current.scale.setScalar(1.4)
        if (teleMat.current) teleMat.current.opacity = 0.6
      } else {
        tele.current.visible = false
      }
    }
  })

  return (
    <group ref={group} position={[data.x, 1.1, data.z]}>
      <mesh ref={core} castShadow>
        <icosahedronGeometry args={[0.55, 0]} />
        {/* strong emissive (no per-enemy light) so killing/hiding it never changes
            the scene light count → no shader recompile hitch on kill. */}
        <meshStandardMaterial color="#2a1140" emissive="#7b2fd6" emissiveIntensity={1.3} roughness={0.4} toneMapped={false} />
      </mesh>
      {/* spiky aura */}
      <mesh>
        <icosahedronGeometry args={[0.75, 0]} />
        <meshStandardMaterial color="#b060ff" wireframe transparent opacity={0.4} toneMapped={false} />
      </mesh>
      {/* telegraph danger ring (shown only while winding up / striking) */}
      <mesh ref={tele} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.15, 1.25, 36]} />
        <meshBasicMaterial ref={teleMat} color="#ff3b3b" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* health bar (billboarded group) */}
      <group position={[0, 1.05, 0]}>
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[1, 0.12]} />
          <meshBasicMaterial color="#1a0a26" />
        </mesh>
        <mesh ref={bar} position={[0, 0, 0]}>
          <planeGeometry args={[1, 0.12]} />
          <meshBasicMaterial color="#ff5a7a" />
        </mesh>
      </group>
    </group>
  )
}

// ── Collectible moon-shards ──────────────────────────────────────────────────
function Collectible({ data, bus, api }) {
  const ref = useRef()
  const got = useRef(false)
  useFrame((_, dt) => {
    const m = ref.current
    if (!m || got.current) return
    m.rotation.y += dt * 1.5
    m.position.y = data.y + Math.sin(performance.now() * 0.003 + data.id) * 0.25
    const dx = bus.playerPos.x - data.x, dz = bus.playerPos.z - data.z
    if (Math.hypot(dx, dz) < 1.3) {
      got.current = true; m.visible = false
      api.addScore(10); api.heal(4)
    }
  })
  return (
    <group ref={ref} position={[data.x, data.y, data.z]}>
      <mesh>
        <octahedronGeometry args={[0.32, 0]} />
        <meshStandardMaterial color="#ffe9a8" emissive="#ffcf5a" emissiveIntensity={1.8} toneMapped={false} />
      </mesh>
      {/* halo ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, 0.5, 20]} />
        <meshBasicMaterial color="#ffd76a" transparent opacity={0.5} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <Sparkles count={10} scale={1.4} size={3} speed={0.4} color="#ffe9a8" />
    </group>
  )
}

// ── World dressing ────────────────────────────────────────────────────────────
function Ground() {
  return (
    <group>
      {/* dark forest floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[WORLD_RADIUS + 14, 96]} />
        <meshStandardMaterial color="#0e1524" roughness={1} metalness={0} />
      </mesh>
      {/* lighter mossy central clearing */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} receiveShadow>
        <circleGeometry args={[WORLD_RADIUS * 0.5, 72]} />
        <meshStandardMaterial color="#17253c" roughness={1} />
      </mesh>
      {/* faint ring marking the clearing edge */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[WORLD_RADIUS * 0.5 - 0.35, WORLD_RADIUS * 0.5, 96]} />
        <meshBasicMaterial color="#2b3d63" transparent opacity={0.45} side={THREE.DoubleSide} />
      </mesh>
      {/* glowing world boundary */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[WORLD_RADIUS - 0.5, WORLD_RADIUS + 0.5, 160]} />
        <meshBasicMaterial color="#3a5bd0" transparent opacity={0.5} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  )
}

function Decoration({ kind, x, z, s, rot, color }) {
  if (kind === 'tree') {
    // rounded low-poly canopy
    return (
      <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={s}>
        <mesh castShadow position={[0, 1.1, 0]}>
          <cylinderGeometry args={[0.15, 0.26, 2.2, 7]} />
          <meshStandardMaterial color="#241f38" roughness={0.95} />
        </mesh>
        <mesh castShadow position={[0, 2.7, 0]}>
          <icosahedronGeometry args={[1.15, 0]} />
          <meshStandardMaterial color={color} roughness={0.85} flatShading />
        </mesh>
        <mesh castShadow position={[0.5, 3.3, 0.2]}>
          <icosahedronGeometry args={[0.68, 0]} />
          <meshStandardMaterial color={color} roughness={0.85} flatShading />
        </mesh>
        <mesh castShadow position={[-0.42, 3.4, -0.28]}>
          <icosahedronGeometry args={[0.58, 0]} />
          <meshStandardMaterial color={color} roughness={0.85} flatShading />
        </mesh>
      </group>
    )
  }
  if (kind === 'pine') {
    return (
      <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={s}>
        <mesh castShadow position={[0, 0.9, 0]}>
          <cylinderGeometry args={[0.14, 0.2, 1.8, 7]} />
          <meshStandardMaterial color="#241f38" roughness={0.95} />
        </mesh>
        <mesh castShadow position={[0, 2.4, 0]}>
          <coneGeometry args={[1.05, 2.3, 8]} />
          <meshStandardMaterial color={color} roughness={0.85} flatShading />
        </mesh>
        <mesh castShadow position={[0, 3.5, 0]}>
          <coneGeometry args={[0.72, 1.6, 8]} />
          <meshStandardMaterial color={color} roughness={0.85} flatShading />
        </mesh>
      </group>
    )
  }
  if (kind === 'rock') {
    return (
      <group position={[x, 0.28 * s, z]} rotation={[rot, rot * 1.3, 0]} scale={s}>
        <mesh castShadow>
          <dodecahedronGeometry args={[0.8, 0]} />
          <meshStandardMaterial color="#1c2236" roughness={1} flatShading />
        </mesh>
        {/* moss cap */}
        <mesh position={[0, 0.32, 0]} scale={[1, 0.5, 1]}>
          <sphereGeometry args={[0.55, 8, 8]} />
          <meshStandardMaterial color="#233a2c" roughness={1} flatShading />
        </mesh>
      </group>
    )
  }
  if (kind === 'crystal') {
    // clustered glowing shards (no point light — emissive only, for perf)
    return (
      <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={s}>
        <mesh castShadow position={[0, 0.9, 0]}>
          <coneGeometry args={[0.32, 1.8, 5]} />
          <meshStandardMaterial color="#3a6bd6" emissive="#3f7bff" emissiveIntensity={1.2} roughness={0.25} metalness={0.4} toneMapped={false} />
        </mesh>
        <mesh castShadow position={[0.3, 0.5, 0.1]} rotation={[0, 0, 0.4]}>
          <coneGeometry args={[0.18, 1.0, 5]} />
          <meshStandardMaterial color="#3a6bd6" emissive="#3f7bff" emissiveIntensity={1.2} roughness={0.25} metalness={0.4} toneMapped={false} />
        </mesh>
        <mesh castShadow position={[-0.28, 0.4, -0.05]} rotation={[0, 0, -0.35]}>
          <coneGeometry args={[0.15, 0.8, 5]} />
          <meshStandardMaterial color="#3a6bd6" emissive="#3f7bff" emissiveIntensity={1.2} roughness={0.25} metalness={0.4} toneMapped={false} />
        </mesh>
      </group>
    )
  }
  if (kind === 'mushroom') {
    return (
      <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={s}>
        <mesh castShadow position={[0, 0.16, 0]}>
          <cylinderGeometry args={[0.06, 0.08, 0.32, 6]} />
          <meshStandardMaterial color="#d8cfc0" roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0, 0.34, 0]}>
          <sphereGeometry args={[0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} roughness={0.6} toneMapped={false} />
        </mesh>
      </group>
    )
  }
  if (kind === 'flower') {
    return (
      <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={s}>
        <mesh position={[0, 0.18, 0]}>
          <cylinderGeometry args={[0.015, 0.02, 0.36, 4]} />
          <meshStandardMaterial color="#2d4a35" />
        </mesh>
        <mesh position={[0, 0.38, 0]}>
          <sphereGeometry args={[0.07, 8, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.3} toneMapped={false} />
        </mesh>
      </group>
    )
  }
  if (kind === 'grass') {
    return (
      <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={s}>
        {[-0.1, 0.02, 0.13].map((ox, i) => (
          <mesh key={i} position={[ox, 0.22, i * 0.05]} rotation={[0, 0, (i - 1) * 0.28]}>
            <coneGeometry args={[0.04, 0.5, 4]} />
            <meshStandardMaterial color="#28402f" roughness={1} />
          </mesh>
        ))}
      </group>
    )
  }
  if (kind === 'pillar') {
    // glowing marker ringing the arena boundary
    return (
      <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={s}>
        <mesh castShadow position={[0, 1.4, 0]}>
          <cylinderGeometry args={[0.22, 0.32, 2.8, 6]} />
          <meshStandardMaterial color="#1a2238" roughness={1} flatShading />
        </mesh>
        <mesh position={[0, 3.0, 0]}>
          <octahedronGeometry args={[0.28, 0]} />
          <meshStandardMaterial color="#7fb0ff" emissive="#5f8bff" emissiveIntensity={1.9} toneMapped={false} />
        </mesh>
      </group>
    )
  }
  return null
}

function Moon() {
  return (
    <group position={[-40, 48, -70]}>
      <mesh>
        <sphereGeometry args={[7, 32, 32]} />
        <meshBasicMaterial color="#eaf0ff" />
      </mesh>
      <pointLight color="#cdd6ff" intensity={1.4} distance={260} />
    </group>
  )
}

// ── Procedural world content ─────────────────────────────────────────────────
function rand(min, max) { return min + Math.random() * (max - min) }
function scatterPos(minR, maxR) {
  const a = Math.random() * Math.PI * 2
  const r = rand(minR, maxR)
  return { x: Math.cos(a) * r, z: Math.sin(a) * r }
}

function buildDecorations() {
  const out = []
  const treeColors = ['#1f3a4d', '#20404a', '#254a3e', '#2a4a52']
  const pineColors = ['#1c3340', '#213f3a', '#1f3a4d']
  const shroom = ['#c74b6b', '#b85cd0', '#d08a3a']
  const petals = ['#8fb0ff', '#c98fff', '#ffd76a', '#ff9db1']

  for (let i = 0; i < 26; i++) { const { x, z } = scatterPos(7, WORLD_RADIUS - 3); out.push({ kind: 'tree', x, z, s: rand(0.8, 1.6), rot: rand(0, 6.28), color: treeColors[i % treeColors.length] }) }
  for (let i = 0; i < 20; i++) { const { x, z } = scatterPos(7, WORLD_RADIUS - 3); out.push({ kind: 'pine', x, z, s: rand(0.7, 1.5), rot: rand(0, 6.28), color: pineColors[i % pineColors.length] }) }
  for (let i = 0; i < 22; i++) { const { x, z } = scatterPos(5, WORLD_RADIUS - 1); out.push({ kind: 'rock', x, z, s: rand(0.45, 1.5), rot: rand(0, 6.28) }) }
  for (let i = 0; i < 11; i++) { const { x, z } = scatterPos(8, WORLD_RADIUS - 4); out.push({ kind: 'crystal', x, z, s: rand(0.8, 1.7), rot: rand(0, 6.28) }) }
  for (let i = 0; i < 26; i++) { const { x, z } = scatterPos(4, WORLD_RADIUS - 2); out.push({ kind: 'mushroom', x, z, s: rand(0.7, 1.5), rot: rand(0, 6.28), color: shroom[i % shroom.length] }) }
  for (let i = 0; i < 44; i++) { const { x, z } = scatterPos(3, WORLD_RADIUS - 2); out.push({ kind: 'flower', x, z, s: rand(0.7, 1.4), rot: rand(0, 6.28), color: petals[i % petals.length] }) }
  for (let i = 0; i < 40; i++) { const { x, z } = scatterPos(3, WORLD_RADIUS - 1); out.push({ kind: 'grass', x, z, s: rand(0.7, 1.6), rot: rand(0, 6.28) }) }
  // boundary pillars evenly ringing the arena edge
  const P = 26
  for (let i = 0; i < P; i++) { const a = (i / P) * Math.PI * 2; out.push({ kind: 'pillar', x: Math.cos(a) * WORLD_RADIUS, z: Math.sin(a) * WORLD_RADIUS, s: rand(0.9, 1.2), rot: a }) }
  return out
}

function buildStars() {
  const out = []
  for (let i = 0; i < 22; i++) {
    const { x, z } = scatterPos(4, WORLD_RADIUS - 3)
    out.push({ id: i, x, z, y: rand(0.8, 1.6) })
  }
  return out
}

function buildEnemies() {
  const out = []
  for (let i = 0; i < 10; i++) {
    const { x, z } = scatterPos(12, WORLD_RADIUS - 5)
    out.push({ id: i, x, z, hp: 100 })
  }
  return out
}

// ── HUD / overlays ────────────────────────────────────────────────────────────
function Hud({ hp, score, kills, toast, onExit }) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: "'Noto Sans KR', sans-serif", color: '#eaf0ff' }}>
      {/* top-left stats */}
      <div style={{ position: 'absolute', top: 20, left: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, letterSpacing: '0.15em', color: 'rgba(180,200,255,0.7)' }}>달빛 원정</div>
        <div style={{ width: 220, height: 16, borderRadius: 8, background: 'rgba(255,255,255,0.1)', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
          <div style={{ width: `${hp}%`, height: '100%', background: 'linear-gradient(90deg,#ff5a7a,#ff9db1)', transition: 'width 0.25s' }} />
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 14 }}>
          <span>✦ 파편 <b>{score}</b></span>
          <span>⚔ 처치 <b>{kills}</b></span>
        </div>
      </div>

      {/* controls hint */}
      <div style={{ position: 'absolute', bottom: 18, left: 22, fontSize: 12, lineHeight: 1.7, color: 'rgba(200,215,255,0.55)' }}>
        <div><b>WASD</b> 이동 · <b>마우스 드래그</b> 시점 · <b>휠</b> 줌</div>
        <div><b>좌클릭</b> 공격 · <b>Space</b> 회피 구르기 · <b>Shift</b> 질주 · <b>ESC</b> 종료</div>
      </div>

      {/* toast */}
      {toast && (
        <div style={{
          position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
          fontSize: 22, fontWeight: 600, color: '#ffe9a8', textShadow: '0 2px 14px rgba(0,0,0,0.7)',
          animation: 'popToast 0.3s ease',
        }}>{toast}</div>
      )}

      {/* exit button */}
      <button
        onClick={onExit}
        style={{
          position: 'absolute', top: 18, right: 20, pointerEvents: 'auto', cursor: 'pointer',
          padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(20,26,48,0.7)', color: '#dce6ff', fontSize: 13, fontFamily: 'inherit',
          backdropFilter: 'blur(6px)',
        }}
      >✕ 나가기</button>

      <style>{'@keyframes popToast{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}'}</style>
    </div>
  )
}

function DeathScreen({ score, kills, onRespawn, onExit }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 22, background: 'rgba(5,6,15,0.72)',
      backdropFilter: 'blur(3px)', fontFamily: "'Noto Sans KR', sans-serif", color: '#eaf0ff',
    }}>
      <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '0.1em', color: '#ff8fa6' }}>쓰러졌다…</div>
      <div style={{ fontSize: 15, color: 'rgba(220,230,255,0.75)' }}>파편 {score} · 처치 {kills}</div>
      <div style={{ display: 'flex', gap: 14 }}>
        <button onClick={onRespawn} style={btn('#3d5aa8')}>다시 도전</button>
        <button onClick={onExit} style={btn('rgba(40,48,80,0.8)')}>돌아가기</button>
      </div>
    </div>
  )
}

const btn = (bg) => ({
  padding: '11px 26px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.18)',
  background: bg, color: '#fff', fontSize: 15, fontFamily: 'inherit', cursor: 'pointer',
})
