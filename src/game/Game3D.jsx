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
const COMBO_WINDOW = 850    // ms since the last hit that a click chains into the next combo step
const COMBO_GAP = 150       // ms minimum between swings (clicks faster than this are ignored)
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
    strafe: false,    // right-mouse held → body locks to camera-forward and strafes
    attackAt: 0,       // timestamp of last swing, consumed by enemies
    attackSeq: 0,      // increments each swing
    comboStep: 0,      // 0→1→2 chain position of the current swing
    attackDamage: 30,  // damage of the current swing (finisher hits harder)
    attackRange: ATTACK_RANGE, // reach of the current swing (finisher cleaves wider)
    attackKnock: 0.7,  // knockback of the current swing
    shake: 0,          // camera-shake impulse, decays each frame
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
  const onPointerDown = (e) => {
    dragging.current = true; last.current = { x: e.clientX, y: e.clientY }
    if (e.button === 2) bus.strafe = true // right-drag turns/strafes WoW-style
  }
  const onPointerUp = () => { dragging.current = false; bus.strafe = false }
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
    const now = performance.now()
    if (now - bus.attackAt < COMBO_GAP) return // ignore machine-gun clicks so hits stay distinct
    // chain to the next step if the click lands inside the combo window (and we're not
    // already at the finisher); otherwise start a fresh combo at step 0.
    const step = (now - bus.attackAt < COMBO_WINDOW && bus.comboStep < 2) ? bus.comboStep + 1 : 0
    const finisher = step === 2
    bus.comboStep = step
    bus.attackAt = now
    bus.attackSeq++
    bus.attackDamage = finisher ? 60 : 30
    bus.attackRange = finisher ? 4.4 : ATTACK_RANGE
    bus.attackKnock = finisher ? 2.4 : 0.7
    bus.shake = finisher ? 0.5 : 0.16
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
      onContextMenu={(e) => e.preventDefault()}
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
      {/* bright, mystical twilight — luminous lavender air instead of near-black night */}
      <color attach="background" args={['#242c62']} />
      {/* fog pushed far out so the whole clearing reads clearly, with a bright misty tint */}
      <fog attach="fog" args={['#3c4890', 48, 170]} />

      {/* Airy, magical lighting: strong soft ambient so the map is clearly visible */}
      <ambientLight intensity={0.85} color="#aab6ee" />
      <hemisphereLight args={['#93a3e4', '#3a4068', 1.0]} />
      <directionalLight
        position={[30, 55, 20]} intensity={1.7} color="#eef2ff"
        castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-80} shadow-camera-right={80}
        shadow-camera-top={80} shadow-camera-bottom={-80}
      />
      {/* cool moon rim + a soft mystic teal accent from the far side */}
      <directionalLight position={[-45, 25, -60]} intensity={0.7} color="#9fb6ff" />
      <directionalLight position={[0, 18, 55]} intensity={0.5} color="#8fe6d8" />

      <Stars radius={180} depth={60} count={4500} factor={5} saturation={0} fade speed={0.6} />
      <Moon />

      <Ground />
      {decorations.map((d, i) => <Decoration key={i} {...d} />)}
      {stars.map((s) => <Collectible key={s.id} data={s} bus={bus} api={api} />)}
      {enemies.map((e) => <Enemy key={e.id} data={e} bus={bus} api={api} />)}

      {/* fireflies & mystic motes drifting across the whole clearing */}
      <Sparkles count={170} scale={[WORLD_RADIUS * 2, 8, WORLD_RADIUS * 2]} position={[0, 3.8, 0]} size={2.8} speed={0.3} opacity={0.85} color="#cfe0ff" />
      <Sparkles count={55} scale={[WORLD_RADIUS * 1.4, 2, WORLD_RADIUS * 1.4]} position={[0, 0.8, 0]} size={3.6} speed={0.15} opacity={0.7} color="#ffe6a8" />
      <Sparkles count={45} scale={[WORLD_RADIUS * 1.7, 5, WORLD_RADIUS * 1.7]} position={[0, 2.4, 0]} size={3.2} speed={0.22} opacity={0.6} color="#9ff0dd" />

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
  const head = useRef()
  const bladeMat = useRef()
  const walkPhase = useRef(0)
  const swing = useRef({ seq: 0, t: 1, step: 0 })
  const roll = useRef({ seq: 0, t: 0, cool: 0, was: false })
  const facing = useRef(Math.PI)
  // idle-gesture scheduler: after a few still seconds, play a random little motion
  const idle = useRef({ t: 0, next: 3, kind: null, gt: 0, dur: 0 })
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
    const strafing = bus.strafe && !bus.dead
    let moving = false
    let locF = 1, locS = 0 // move direction relative to facing: forward(+)/back(−), right(+)/left(−)
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
        moving = true
      }
      // Facing: in strafe mode the body locks to camera-forward so A/D side-step and
      // S back-pedal instead of spinning; otherwise the body turns to face the move.
      if (strafing) facing.current = Math.atan2(fwd.x, fwd.z)
      else if (wantMove) facing.current = Math.atan2(move.x, move.z)
      // Split the move into forward/sideways relative to where we now face, so the
      // walk cycle can play back-pedal and side-step variants — not just a forward walk.
      if (moving) {
        const sf = Math.sin(facing.current), cf = Math.cos(facing.current)
        locF = move.x * sf + move.z * cf
        locS = move.x * cf - move.z * sf
      }
    }
    // keep inside the world
    const r = Math.hypot(bus.playerPos.x, bus.playerPos.z)
    if (r > WORLD_RADIUS) { bus.playerPos.x *= WORLD_RADIUS / r; bus.playerPos.z *= WORLD_RADIUS / r }

    g.position.copy(bus.playerPos)
    // smooth turn toward facing; remember the turn amount so we can bank into it
    let d = facing.current - g.rotation.y
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    g.rotation.y += d * Math.min(1, dt * 12)

    // ── body animation (idle breathing · walk/run weight · lean · roll) ──
    const b = bob.current
    const isSprint = !!(k['ShiftLeft'] || k['ShiftRight'])
    const tNow = performance.now()
    if (rolling) {
      // forward tumble owns the body
      roll.current.was = true
      const rp = 1 - Math.max(0, roll.current.t) / ROLL_TIME // 0 → 1 progress
      if (b) {
        // eased 0→2π spin: zero angular velocity at both ends (starts & lands gently),
        // and lands exactly on 2π so the pose is upright again — no snap, no mechanical spin.
        b.rotation.x = rp * Math.PI * 2 - Math.sin(rp * Math.PI * 2)
        b.rotation.z = 0
        b.position.y = -Math.sin(rp * Math.PI) * 0.1 // duck low through the roll, not a hop
      }
      // curl into a tight tuck at mid-roll, then unfurl — smooth in and out
      const tuck = Math.sin(rp * Math.PI)
      if (leftLeg.current) leftLeg.current.rotation.x = 1.0 * tuck
      if (rightLeg.current) rightLeg.current.rotation.x = 1.0 * tuck
      if (leftArm.current) leftArm.current.rotation.x = -1.15 * tuck
    } else {
      // clean up the instant the roll finishes so the tumble doesn't unwind backwards
      if (roll.current.was) {
        roll.current.was = false
        if (b) { b.rotation.x = 0; b.rotation.z = 0; b.position.y = 0 }
        if (leftLeg.current) leftLeg.current.rotation.x = 0
        if (rightLeg.current) rightLeg.current.rotation.x = 0
        if (leftArm.current) leftArm.current.rotation.x = 0
      }
      // legs & arms — stride direction follows walk / back-pedal / strafe
      let stepSwing = 0
      if (moving) {
        const gait = Math.min(1, Math.hypot(locF, locS) || 1)
        walkPhase.current += dt * (isSprint ? 13 : 9) * (0.6 + gait * 0.4)
        const amp = (isSprint ? 0.72 : 0.5) * gait
        const dir = locF < -0.15 ? -1 : 1 // back-pedalling flips the stride
        const a = Math.sin(walkPhase.current) * amp * dir
        stepSwing = a
        if (leftLeg.current) leftLeg.current.rotation.x = a
        if (rightLeg.current) rightLeg.current.rotation.x = -a
        if (leftArm.current) leftArm.current.rotation.x = -a * 0.95
      } else {
        if (leftLeg.current) leftLeg.current.rotation.x *= 0.85
        if (rightLeg.current) rightLeg.current.rotation.x *= 0.85
        if (leftArm.current) leftArm.current.rotation.x *= 0.85
      }
      // torso: lean toward travel (forward/back), bounce with steps, breathe when idle,
      // bank on turns AND into side-steps
      if (b) {
        const leanTarget = moving ? locF * (isSprint ? 0.3 : 0.17) : 0
        b.rotation.x += (leanTarget - b.rotation.x) * Math.min(1, dt * 8)

        const yTarget = moving
          ? Math.abs(Math.sin(walkPhase.current)) * (isSprint ? 0.13 : 0.08)
          : 0.02 + Math.sin(tNow * 0.0018) * 0.02 // gentle breathing
        b.position.y += (yTarget - b.position.y) * Math.min(1, dt * 12)

        const stepRoll = moving ? stepSwing * (isSprint ? 0.16 : 0.11) : Math.sin(tNow * 0.0011) * 0.02
        const strafeBank = moving ? -locS * 0.2 : 0 // lean into a side-step
        const turnBank = THREE.MathUtils.clamp(d * 0.9, -0.22, 0.22) // lean into turns
        b.rotation.z += (stepRoll + strafeBank + turnBank - b.rotation.z) * Math.min(1, dt * 10)
      }
    }

    // sword swing — 3-hit combo, each step a distinct sweep across the FRONT (+Z)
    const sp = swordPivot.current
    if (sp) {
      if (bus.attackSeq !== swing.current.seq) {
        swing.current.seq = bus.attackSeq
        swing.current.t = 0
        swing.current.step = bus.comboStep // lock in which combo step this swing plays
      }
      if (swing.current.t < 1) {
        const st = swing.current.step
        swing.current.t = Math.min(1, swing.current.t + dt * (st === 2 ? 2.9 : 3.7))
        const t = swing.current.t
        const s = 1 - Math.pow(1 - t, 2) // ease-out
        const arc = Math.sin(t * Math.PI)
        if (st === 0) {
          // ① right → left horizontal slash
          sp.rotation.y = 1.25 - s * 2.25
          sp.rotation.x = 0.5 - arc * 0.55
          if (b) { b.rotation.y = 0.42 - s * 0.85; b.rotation.x = Math.max(b.rotation.x, arc * 0.3) }
        } else if (st === 1) {
          // ② left → right backhand slash (mirror of ①)
          sp.rotation.y = -1.0 + s * 2.25
          sp.rotation.x = 0.5 - arc * 0.55
          if (b) { b.rotation.y = -0.42 + s * 0.85; b.rotation.x = Math.max(b.rotation.x, arc * 0.3) }
        } else {
          // ③ overhead smash finisher — raise high, chop straight down with a big lunge
          sp.rotation.x = -1.2 + s * 2.0
          sp.rotation.y = 0.15 * (1 - s)
          if (b) { b.rotation.y = 0; b.rotation.x = Math.max(b.rotation.x, arc * 0.5) }
        }
        // dynamic forward lunge into the strike (biggest on the finisher)
        const lunge = (st === 2 ? 7 : 3.4) * arc
        bus.playerPos.x += Math.sin(facing.current) * lunge * dt
        bus.playerPos.z += Math.cos(facing.current) * lunge * dt
        const rr = Math.hypot(bus.playerPos.x, bus.playerPos.z)
        if (rr > WORLD_RADIUS) { bus.playerPos.x *= WORLD_RADIUS / rr; bus.playerPos.z *= WORLD_RADIUS / rr }
        g.position.copy(bus.playerPos)
        // blade flares bright as it sweeps, brightest at the start of the swing
        if (bladeMat.current) bladeMat.current.emissiveIntensity = 0.6 + (1 - t) * (st === 2 ? 3.6 : 2.4)
      } else {
        // ease back to the resting guard pose — but let the sword arm swing with the
        // stride (counter to the left arm) so the walk doesn't look one-armed
        const swordArm = moving ? Math.sin(walkPhase.current + Math.PI) * (isSprint ? 0.22 : 0.15) : 0
        sp.rotation.y += (0.45 - sp.rotation.y) * Math.min(1, dt * 10)
        sp.rotation.x += ((0.5 + swordArm) - sp.rotation.x) * Math.min(1, dt * 10)
        if (b) b.rotation.y += (0 - b.rotation.y) * Math.min(1, dt * 8) // untwist
        if (bladeMat.current) bladeMat.current.emissiveIntensity += (0.6 - bladeMat.current.emissiveIntensity) * Math.min(1, dt * 8)
      }
    }

    // ── idle gestures — after a few still seconds the knight glances around, nods,
    // or takes a lazy practice swing, so standing still never looks frozen ──
    const hd = head.current
    const idl = idle.current
    const trulyIdle = !moving && !rolling && !strafing && !bus.dead && swing.current.t >= 1
    if (trulyIdle) {
      idl.t += dt
      if (!idl.kind && idl.t > idl.next) {
        idl.kind = ['lookL', 'lookR', 'scan', 'nod', 'swing'][Math.floor(Math.random() * 5)]
        idl.gt = 0
        idl.dur = idl.kind === 'swing' ? 0.6 : idl.kind === 'scan' ? 2.2 : 1.4
        if (idl.kind === 'swing') swing.current.t = 0 // cosmetic swing — no hit, no arc
      }
      if (idl.kind) {
        idl.gt += dt
        const p = Math.min(1, idl.gt / idl.dur)
        if (hd && idl.kind !== 'swing') {
          const s = Math.sin(p * Math.PI)
          if (idl.kind === 'lookL') hd.rotation.y = s * 0.6
          else if (idl.kind === 'lookR') hd.rotation.y = -s * 0.6
          else if (idl.kind === 'nod') hd.rotation.x = s * 0.32
          else if (idl.kind === 'scan') hd.rotation.y = Math.sin(p * Math.PI * 2) * 0.55
        }
        if (idl.gt >= idl.dur) { idl.kind = null; idl.t = 0; idl.next = 2.5 + Math.random() * 3.5 }
      }
    } else {
      idl.t = 0; idl.kind = null
    }
    // ease the head back to neutral whenever nothing is driving it
    if (hd && !idl.kind) {
      hd.rotation.y += (0 - hd.rotation.y) * Math.min(1, dt * 6)
      hd.rotation.x += (0 - hd.rotation.x) * Math.min(1, dt * 6)
    }

    // WoW camera: orbit behind the player.
    const { pitch, dist } = bus.camera
    const target = _target.set(bus.playerPos.x, bus.playerPos.y + 1.4, bus.playerPos.z)
    _off.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)).multiplyScalar(dist)
    _desired.set(target.x + _off.x, target.y + _off.y, target.z + _off.z)
    camera.position.lerp(_desired, Math.min(1, dt * 10))
    // impact punch — a quick decaying shake on hit (biggest on the finisher)
    if (bus.shake > 0) {
      bus.shake = Math.max(0, bus.shake - dt * 1.8)
      camera.position.x += (Math.random() - 0.5) * bus.shake
      camera.position.y += (Math.random() - 0.5) * bus.shake
      camera.position.z += (Math.random() - 0.5) * bus.shake
    }
    camera.lookAt(target)
  })

  return (
    <group ref={group}>
      <group ref={bob}>
        {/* ===== CHIBI KNIGHT — 2-head-tall, round & pastel so it reads cute, not robotic.
             Same refs/pivots as before so every animation still drives it. ===== */}

        {/* ===== LEGS — stubby thigh + rounded boot (swing while walking) ===== */}
        <group ref={leftLeg} position={[-0.12, 0.34, 0]}>
          <mesh castShadow position={[0, -0.12, 0]}>
            <capsuleGeometry args={[0.1, 0.1, 5, 12]} />
            <meshStandardMaterial color="#6377c8" roughness={0.7} />
          </mesh>
          <mesh castShadow position={[0, -0.26, 0.05]} scale={[1, 0.85, 1.3]}>
            <sphereGeometry args={[0.13, 14, 12]} />
            <meshStandardMaterial color="#3a4788" roughness={0.85} />
          </mesh>
        </group>
        <group ref={rightLeg} position={[0.12, 0.34, 0]}>
          <mesh castShadow position={[0, -0.12, 0]}>
            <capsuleGeometry args={[0.1, 0.1, 5, 12]} />
            <meshStandardMaterial color="#6377c8" roughness={0.7} />
          </mesh>
          <mesh castShadow position={[0, -0.26, 0.05]} scale={[1, 0.85, 1.3]}>
            <sphereGeometry args={[0.13, 14, 12]} />
            <meshStandardMaterial color="#3a4788" roughness={0.85} />
          </mesh>
        </group>

        {/* ===== BELT · ROUND BODY · BELLY ===== */}
        <mesh position={[0, 0.46, 0]}>
          <cylinderGeometry args={[0.26, 0.26, 0.09, 20]} />
          <meshStandardMaterial color="#e0b866" metalness={0.5} roughness={0.5} />
        </mesh>
        {/* egg-round torso */}
        <mesh castShadow position={[0, 0.66, 0]} scale={[1, 1.05, 0.92]}>
          <sphereGeometry args={[0.3, 20, 18]} />
          <meshStandardMaterial color="#8ea6f0" roughness={0.55} />
        </mesh>
        {/* lighter belly panel */}
        <mesh position={[0, 0.62, 0.2]} scale={[0.78, 0.92, 0.4]}>
          <sphereGeometry args={[0.24, 18, 16]} />
          <meshStandardMaterial color="#bcc9f8" roughness={0.6} />
        </mesh>
        {/* chest heart-gem */}
        <mesh position={[0, 0.74, 0.27]} rotation={[0, 0, Math.PI / 4]}>
          <octahedronGeometry args={[0.075, 0]} />
          <meshStandardMaterial color="#ffd0dc" emissive="#ff8fae" emissiveIntensity={1.6} toneMapped={false} />
        </mesh>

        {/* ===== little rounded CAPE on the back (−Z) ===== */}
        <mesh castShadow position={[0, 0.74, -0.22]} rotation={[0.16, 0, 0]}>
          <boxGeometry args={[0.44, 0.66, 0.04]} />
          <meshStandardMaterial color="#a98fe6" side={THREE.DoubleSide} roughness={0.8} />
        </mesh>

        {/* ===== round PAULDRONS ===== */}
        <mesh castShadow position={[-0.3, 0.86, 0]}>
          <sphereGeometry args={[0.15, 16, 16]} />
          <meshStandardMaterial color="#7f93e6" roughness={0.5} />
        </mesh>
        <mesh castShadow position={[0.3, 0.86, 0]}>
          <sphereGeometry args={[0.15, 16, 16]} />
          <meshStandardMaterial color="#7f93e6" roughness={0.5} />
        </mesh>

        {/* ===== LEFT ARM — stubby + round mitten (swings while walking) ===== */}
        <group ref={leftArm} position={[-0.3, 0.84, 0]}>
          <mesh castShadow position={[0, -0.15, 0]}>
            <capsuleGeometry args={[0.08, 0.14, 5, 10]} />
            <meshStandardMaterial color="#8ea6f0" roughness={0.6} />
          </mesh>
          <mesh castShadow position={[0, -0.32, 0.02]}>
            <sphereGeometry args={[0.11, 12, 12]} />
            <meshStandardMaterial color="#6377c8" roughness={0.6} />
          </mesh>
        </group>

        {/* ===== BIG CUTE HEAD (group pivots at the neck for glances/nods) ===== */}
        <group ref={head} position={[0, 0.95, 0]}>
          {/* collar / neck */}
          <mesh position={[0, -0.02, 0]}>
            <cylinderGeometry args={[0.1, 0.13, 0.08, 12]} />
            <meshStandardMaterial color="#7f93e6" roughness={0.6} />
          </mesh>
          {/* big round head */}
          <mesh castShadow position={[0, 0.34, 0]}>
            <sphereGeometry args={[0.36, 24, 22]} />
            <meshStandardMaterial color="#93a4ee" roughness={0.5} />
          </mesh>
          {/* side ear-guards */}
          <mesh castShadow position={[-0.35, 0.32, 0]}>
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshStandardMaterial color="#7f93e6" roughness={0.55} />
          </mesh>
          <mesh castShadow position={[0.35, 0.32, 0]}>
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshStandardMaterial color="#7f93e6" roughness={0.55} />
          </mesh>
          {/* ---- FACE (+Z front) ---- */}
          {/* big glossy eyes: white base + dark pupil + sparkle */}
          <mesh position={[-0.13, 0.33, 0.29]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#f6f9ff" roughness={0.3} />
          </mesh>
          <mesh position={[0.13, 0.33, 0.29]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#f6f9ff" roughness={0.3} />
          </mesh>
          <mesh position={[-0.14, 0.32, 0.37]}>
            <sphereGeometry args={[0.06, 14, 14]} />
            <meshStandardMaterial color="#2b2f52" roughness={0.25} />
          </mesh>
          <mesh position={[0.14, 0.32, 0.37]}>
            <sphereGeometry args={[0.06, 14, 14]} />
            <meshStandardMaterial color="#2b2f52" roughness={0.25} />
          </mesh>
          {/* eye sparkles */}
          <mesh position={[-0.11, 0.37, 0.42]}>
            <sphereGeometry args={[0.022, 8, 8]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1.4} toneMapped={false} />
          </mesh>
          <mesh position={[0.16, 0.37, 0.42]}>
            <sphereGeometry args={[0.022, 8, 8]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1.4} toneMapped={false} />
          </mesh>
          {/* rosy cheeks */}
          <mesh position={[-0.23, 0.24, 0.26]} scale={[1, 0.7, 0.5]}>
            <sphereGeometry args={[0.07, 12, 12]} />
            <meshStandardMaterial color="#ff9db1" emissive="#ff7d9b" emissiveIntensity={0.35} toneMapped={false} />
          </mesh>
          <mesh position={[0.23, 0.24, 0.26]} scale={[1, 0.7, 0.5]}>
            <sphereGeometry args={[0.07, 12, 12]} />
            <meshStandardMaterial color="#ff9db1" emissive="#ff7d9b" emissiveIntensity={0.35} toneMapped={false} />
          </mesh>
          {/* tiny happy mouth */}
          <mesh position={[0, 0.22, 0.34]}>
            <boxGeometry args={[0.07, 0.02, 0.02]} />
            <meshStandardMaterial color="#4a3340" roughness={0.8} />
          </mesh>
          {/* antenna crest with a glowing bead */}
          <mesh position={[0, 0.66, -0.02]}>
            <cylinderGeometry args={[0.02, 0.02, 0.16, 8]} />
            <meshStandardMaterial color="#7f93e6" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.77, -0.02]}>
            <sphereGeometry args={[0.07, 14, 14]} />
            <meshStandardMaterial color="#8fe0ff" emissive="#4fd0ff" emissiveIntensity={1.7} toneMapped={false} />
          </mesh>
        </group>

        {/* ===== RIGHT ARM + LITTLE SWORD (whole arm swings on the shoulder pivot) ===== */}
        <group ref={swordPivot} position={[0.3, 0.86, 0.02]} rotation={[0.5, 0.45, 0]}>
          {/* stubby arm reaching forward to the grip */}
          <mesh castShadow position={[0, -0.08, 0.16]} rotation={[1.15, 0, 0]}>
            <capsuleGeometry args={[0.08, 0.22, 5, 10]} />
            <meshStandardMaterial color="#8ea6f0" roughness={0.6} />
          </mesh>
          {/* round mitten hand */}
          <mesh castShadow position={[0, -0.12, 0.34]}>
            <sphereGeometry args={[0.11, 12, 12]} />
            <meshStandardMaterial color="#6377c8" roughness={0.6} />
          </mesh>
          {/* round pommel */}
          <mesh position={[0, -0.12, 0.26]}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshStandardMaterial color="#e0b866" metalness={0.6} roughness={0.4} />
          </mesh>
          {/* crossguard */}
          <mesh position={[0, -0.12, 0.4]}>
            <boxGeometry args={[0.28, 0.06, 0.07]} />
            <meshStandardMaterial color="#e0b866" metalness={0.6} roughness={0.4} />
          </mesh>
          {/* short chunky blade (+Z) — flares bright mid-swing via bladeMat */}
          <mesh castShadow position={[0, -0.12, 0.82]}>
            <boxGeometry args={[0.1, 0.1, 0.8]} />
            <meshStandardMaterial ref={bladeMat} color="#e3edff" emissive="#5f8bff" emissiveIntensity={0.6} metalness={0.6} roughness={0.3} toneMapped={false} />
          </mesh>
          {/* rounded glowing tip */}
          <mesh position={[0, -0.12, 1.24]}>
            <sphereGeometry args={[0.09, 12, 12]} />
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

// The combo VFX: a crescent slash that flashes in front along each blade sweep
// (mirrored on the 2nd hit), plus a ground shockwave ring + radial flash that only
// fire on the 3rd-hit finisher. All hug the character and fade fast.
function SwingArc({ bus }) {
  const arc = useRef()
  const arcMat = useRef()
  const ring = useRef()
  const ringMat = useRef()
  const flash = useRef()
  const flashMat = useRef()
  const seen = useRef(0)
  const t = useRef(1)
  const step = useRef(0)
  useFrame((_, dt) => {
    const a = arc.current
    if (!a) return
    if (bus.attackSeq !== seen.current) { seen.current = bus.attackSeq; t.current = 0; step.current = bus.comboStep }
    const finisher = step.current === 2
    if (t.current < 1) {
      t.current = Math.min(1, t.current + dt * (finisher ? 3.8 : 5.2))
      const tt = t.current
      const e = 1 - Math.pow(1 - tt, 2)
      // crescent slash — mirror the backhand (step 1), fatter & brighter on the finisher
      a.visible = true
      const mir = step.current === 1 ? -1 : 1
      const grow = finisher ? 1.05 + e * 0.55 : 0.92 + e * 0.22
      a.scale.set(mir * grow, grow, 1)
      if (arcMat.current) arcMat.current.opacity = (finisher ? 0.95 : 0.85) * (1 - tt) ** 1.3
      // finisher-only: expanding ground shockwave + bright radial flash
      if (finisher) {
        if (ring.current) { ring.current.visible = true; ring.current.scale.setScalar(0.5 + e * 3.0) }
        if (ringMat.current) ringMat.current.opacity = 0.75 * (1 - tt) ** 1.2
        const ft = Math.min(1, tt * 1.7)
        if (flash.current) { flash.current.visible = true; flash.current.scale.setScalar(0.6 + ft * 1.6) }
        if (flashMat.current) flashMat.current.opacity = 0.85 * (1 - ft)
      }
    } else {
      a.visible = false
      if (ring.current) ring.current.visible = false
      if (flash.current) flash.current.visible = false
    }
  })
  return (
    <group position={[0, 0.78, 0]}>
      {/* crescent arc. rotation +π/2 about X maps the ring's centre (local +Y) to
          world +Z, so the slash lands in FRONT of the character. */}
      <group ref={arc} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.82, 1.34, 48, 1, Math.PI / 2 - 0.95, 1.9]} />
          <meshBasicMaterial ref={arcMat} color="#e6f2ff" transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      {/* finisher shockwave ring on the ground (parent sits at y=0.78 → drop to the floor) */}
      <mesh ref={ring} visible={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.74, 0]}>
        <ringGeometry args={[0.7, 1.02, 64]} />
        <meshBasicMaterial ref={ringMat} color="#a9d4ff" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* finisher radial flash in front */}
      <mesh ref={flash} visible={false} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.06, 1.5, 40]} />
        <meshBasicMaterial ref={flashMat} color="#dbe8ff" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
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

    // player attacking this enemy — damage / reach / knockback come from the current combo step
    if (bus.attackSeq !== s.seen && performance.now() - bus.attackAt < 200) {
      s.seen = bus.attackSeq
      if (dist < (bus.attackRange || ATTACK_RANGE)) {
        s.hp -= (bus.attackDamage || 30); s.hurtT = 1
        const kb = bus.attackKnock || 0.7
        s.x -= nx * kb; s.z -= nz * kb // shove the wisp away from the player
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
      {/* moonlit forest floor — brighter so the terrain is clearly legible */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[WORLD_RADIUS + 14, 96]} />
        <meshStandardMaterial color="#2a3660" roughness={1} metalness={0} />
      </mesh>
      {/* luminous enchanted central clearing (soft teal-blue) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} receiveShadow>
        <circleGeometry args={[WORLD_RADIUS * 0.5, 72]} />
        <meshStandardMaterial color="#3a5578" roughness={1} />
      </mesh>
      {/* glowing ring marking the clearing edge */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[WORLD_RADIUS * 0.5 - 0.35, WORLD_RADIUS * 0.5, 96]} />
        <meshBasicMaterial color="#6f8ad0" transparent opacity={0.55} side={THREE.DoubleSide} toneMapped={false} />
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
        <div><b>WASD</b> 이동 · <b>마우스 드래그</b> 시점 · <b>우클릭 드래그</b> 스트레이프 · <b>휠</b> 줌</div>
        <div><b>좌클릭 연타</b> 3타 콤보 · <b>Space</b> 회피 구르기 · <b>Shift</b> 질주 · <b>ESC</b> 종료</div>
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
