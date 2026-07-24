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
const FINISHER_WINDUP = 360   // ms the knight rears the blade back before the heavy 3rd-hit smash lands
const FINISHER_RECOVER = 620  // ms of rooted recovery lag AFTER the smash — hunched over, can't act (roll cancels)
const HITSTUN = 320           // ms the player is staggered & fully locked after taking a hit
// locomotion feel — momentum so the knight eases up to speed & glides to a stop
const MOVE_ACCEL = 17         // how quickly velocity ramps toward the target speed
const MOVE_DECEL = 13         // how quickly it bleeds off when you release (lower = more glide)
const MOVE_STOP = 30          // near-instant stop when rooted (attacking / stunned / dead)
// dodge — a low, quick GROUND ROLL in the pressed direction (forward if standing still)
const ROLL_TIME = 0.44    // roll duration (seconds)
const ROLL_SPEED = 17     // roll burst speed
const ROLL_COOL = 0.7     // cooldown after a roll
const ROLL_IFRAME = 0.12  // i-frames end this many seconds before finishing
// enemy combat
const ENEMY_AGGRO = 15
const ENEMY_REACH = 2.0     // gets this close, then telegraphs an attack
const ENEMY_WINDUP = 0.6    // telegraph duration (time to dodge)
const ENEMY_STRIKE = 0.22   // strike/lunge duration
const ENEMY_HITRANGE = 2.6  // must still be this close at the strike to get hit
const ENEMY_RECOVER = 0.55
// player hit reaction
const HIT_TIME = 0.4     // seconds the flinch owns the body
const HIT_KNOCK = 4.0    // knockback burst speed at the moment of impact

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
    move: { x: 0, z: 0 }, // analog touch stick: x = strafe (right+), z = forward(+)
    touchSprint: false,   // touch 질주 button held
    enemies: [],          // live enemy state refs — auto-targeting skills scan this
    wandLevel: 0,         // 뱀서-style: stacks of 매직완드 collected → auto-fires magic missiles
    strafe: false,    // right-mouse held → body locks to camera-forward and strafes
    attackAt: 0,       // timestamp of last swing, consumed by enemies
    attackSeq: 0,      // increments each swing
    comboStep: 0,      // 0→1→2 chain position of the current swing
    finisherPending: false, // a 3rd-hit smash is charging; it fires (damage+impact) after the wind-up
    finisherFireAt: 0, // timestamp the charged smash releases
    chargeSeq: 0,      // increments when a finisher wind-up begins → drives the rear-back pose
    stunUntil: 0,      // performance.now() until which a hit-stagger locks all input
    recoverUntil: 0,   // performance.now() until which post-finisher recovery locks move/attack
    recoverFrom: 0,    // when that recovery window started (for the hunch→rise pose curve)
    attackDamage: 30,  // damage of the current swing (finisher hits harder)
    attackRange: ATTACK_RANGE, // reach of the current swing (finisher cleaves wider)
    attackKnock: 0.7,  // knockback of the current swing
    shake: 0,          // camera-shake impulse, decays each frame
    dodgeSeq: 0,       // increments each dodge roll
    invuln: false,     // true during roll i-frames — enemy strikes pass through
    attackMoving: false, // was the player moving when the current swing started (running-slash vs planted)
    hitSeq: 0,         // increments each time an enemy strike connects → drives the flinch
    hitDirX: 0, hitDirZ: 0, // world direction the hit shoves the player (away from the enemy)
    hp: 100, maxHp: 100, score: 0, kills: 0, dead: false,
    level: 1, xp: 0, xpNext: 80, atk: 30, // leveling: kills/shards give XP → level up raises maxHp & atk
    toast: '', toastAt: 0,
  }).current

  const api = useMemo(() => {
    // grant XP and roll over into level-ups; each level raises max HP & attack, and heals full
    const gainXp = (n) => {
      bus.xp += n
      while (bus.xp >= bus.xpNext) {
        bus.xp -= bus.xpNext
        bus.level += 1
        bus.xpNext = 80 + (bus.level - 1) * 60 // rising curve
        bus.maxHp += 20
        bus.atk += 6
        bus.hp = bus.maxHp // full heal on level up
        bus.toast = `레벨 업!  Lv.${bus.level}`
        bus.toastAt = performance.now()
      }
    }
    return {
    addScore: (n) => { bus.score += n },
    heal: (n) => { bus.hp = Math.min(bus.maxHp, bus.hp + n) },
    gainXp,
    pickWand: () => {
      bus.wandLevel += 1
      bus.toast = `🪄 매직완드 획득!  Lv.${bus.wandLevel}`
      bus.toastAt = performance.now()
      gainXp(10)
    },
    onKill: () => {
      bus.kills += 1
      bus.toast = '처치! +50'; bus.toastAt = performance.now()
      gainXp(40) // XP per kill — may override the toast with a level-up
    },
    damage: (n, dirX = 0, dirZ = 0) => {
      if (bus.dead) return
      bus.hp = Math.max(0, bus.hp - n)
      // trigger the flinch: remember which way to reel and shove, and give the camera a jolt
      bus.hitSeq++
      bus.hitDirX = dirX; bus.hitDirZ = dirZ
      bus.shake = Math.max(bus.shake, 0.34)
      // hit-stun: lock the player briefly (staggered). Getting hit also interrupts your
      // own attack recovery — you're knocked out of it into the flinch.
      bus.stunUntil = performance.now() + HITSTUN
      bus.recoverUntil = 0
      if (bus.hp === 0) bus.dead = true
    },
    }
  }, [bus])

  // Lock page scroll while the game is open. The game is a fixed overlay, but the app
  // page behind it stays scrollable — so a vertical joystick/camera drag would scroll
  // that page instead. Pin the body (and restore scroll position on exit). This is the
  // reliable cross-browser lock; touch-action: none alone doesn't stop iOS page pan.
  useEffect(() => {
    const scrollY = window.scrollY
    const body = document.body
    const prev = {
      position: body.style.position, top: body.style.top,
      width: body.style.width, overflow: body.style.overflow,
    }
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    document.documentElement.style.overscrollBehavior = 'none'
    return () => {
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.width = prev.width
      body.style.overflow = prev.overflow
      document.documentElement.style.overscrollBehavior = ''
      window.scrollTo(0, scrollY)
    }
  }, [])

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
    if (bus.dead || bus.finisherPending) return // ignore clicks while a smash is already charging
    const now = performance.now()
    if (now < bus.stunUntil || now < bus.recoverUntil) return // locked in hit-stun / finisher recovery
    if (now - bus.attackAt < COMBO_GAP) return // ignore machine-gun clicks so hits stay distinct
    // chain to the next step if the click lands inside the combo window (and we're not
    // already at the finisher); otherwise start a fresh combo at step 0.
    const step = (now - bus.attackAt < COMBO_WINDOW && bus.comboStep < 2) ? bus.comboStep + 1 : 0
    const finisher = step === 2
    bus.comboStep = step
    bus.attackAt = now
    // capture movement at the click so the swing plays its running-slash / planted variant.
    // (read from keys here so the Player and the VFX agree on the same frame — no race.)
    const k = bus.keys
    bus.attackMoving = !bus.dead && !!(k['KeyW'] || k['KeyS'] || k['KeyA'] || k['KeyD'] ||
      k['ArrowUp'] || k['ArrowDown'] || k['ArrowLeft'] || k['ArrowRight'] || bus.move.x || bus.move.z)
    if (finisher) {
      // ── HEAVY 3rd-HIT SMASH — don't strike instantly. Rear the blade back NOW and let
      //    it CHARGE; the actual hit (damage · impact · VFX) releases after a wind-up so
      //    the finisher lands with weight instead of firing off too fast. ──
      bus.finisherPending = true
      bus.finisherFireAt = now + FINISHER_WINDUP
      bus.chargeSeq++     // kick off the rear-back pose in the Player
      bus.shake = 0.06    // faint tension as it loads
    } else {
      bus.attackSeq++
      bus.attackDamage = bus.atk
      bus.attackRange = ATTACK_RANGE
      bus.attackKnock = 0.7
      bus.shake = 0.16
    }
  }

  const respawn = () => { bus.hp = bus.maxHp; bus.dead = false; bus.playerPos.set(0, 0, 0) }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#05060f', cursor: 'grab', touchAction: 'none' }}
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

      {/* On-screen controls — one unified overlay for touch AND mouse (pointer events).
          Keyboard/mouse-drag still work alongside on desktop. */}
      <TouchControls bus={bus} onAttack={onClickAttack} />
    </div>
  )
}

// ── On-screen controls: left analog stick + right action buttons ──────────────
// Uses Pointer Events so a finger or a mouse both drive it. Each control captures
// its own pointer and stops propagation, so dragging the stick/buttons never also
// spins the camera (the empty screen area still does).
function TouchControls({ bus, onAttack }) {
  const dodge = () => { bus.dodgeAt = performance.now(); bus.dodgeSeq++ }
  return (
    <>
      <Joystick bus={bus} />
      <div style={{
        position: 'fixed', right: 22, bottom: 34, zIndex: 1002,
        display: 'flex', alignItems: 'flex-end', gap: 12, touchAction: 'none',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <TouchBtn label="질주" size={54} onDown={() => { bus.touchSprint = true }} onUp={() => { bus.touchSprint = false }} />
          <TouchBtn label="구르기" size={62} onDown={dodge} />
        </div>
        <TouchBtn label="공격" size={86} primary onDown={onAttack} />
      </div>
    </>
  )
}

function Joystick({ bus }) {
  const baseRef = useRef(null)
  const active = useRef(false)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const R = 42 // max knob travel from centre

  const apply = (e) => {
    const rect = baseRef.current.getBoundingClientRect()
    let dx = e.clientX - (rect.left + rect.width / 2)
    let dy = e.clientY - (rect.top + rect.height / 2)
    const d = Math.hypot(dx, dy)
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R }
    setKnob({ x: dx, y: dy })
    bus.move.x = dx / R
    bus.move.z = -dy / R // pushing up = forward
  }
  const start = (e) => { active.current = true; e.currentTarget.setPointerCapture(e.pointerId); apply(e); e.stopPropagation() }
  const move = (e) => { if (active.current) { apply(e); e.stopPropagation() } }
  const end = (e) => { active.current = false; setKnob({ x: 0, y: 0 }); bus.move.x = 0; bus.move.z = 0; e.stopPropagation() }

  return (
    <div
      ref={baseRef}
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      style={{
        position: 'fixed', left: 26, bottom: 32, width: 128, height: 128, borderRadius: '50%',
        background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.16)',
        touchAction: 'none', zIndex: 1002, backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        position: 'absolute', left: '50%', top: '50%', width: 54, height: 54, marginLeft: -27, marginTop: -27,
        transform: `translate(${knob.x}px, ${knob.y}px)`, borderRadius: '50%',
        background: 'rgba(170,195,255,0.5)', border: '1px solid rgba(255,255,255,0.45)',
        boxShadow: '0 3px 10px rgba(0,0,0,0.4)',
      }} />
    </div>
  )
}

function TouchBtn({ label, size = 62, primary, onDown, onUp }) {
  const [held, setHeld] = useState(false)
  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setHeld(true); onDown?.() }}
      onPointerUp={(e) => { e.stopPropagation(); setHeld(false); onUp?.() }}
      onPointerLeave={() => { if (held) { setHeld(false); onUp?.() } }}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: size, height: size, borderRadius: '50%', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
        border: '1px solid rgba(255,255,255,0.3)', padding: 0, cursor: 'pointer',
        background: held ? 'rgba(150,180,255,0.55)' : (primary ? 'rgba(120,150,255,0.34)' : 'rgba(255,255,255,0.12)'),
        color: 'rgba(255,255,255,0.94)', fontSize: size > 74 ? 15 : 12.5, fontWeight: 500,
        fontFamily: "'Noto Sans KR', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      }}
    >{label}</button>
  )
}

// Polls the bus each frame and re-renders only when a displayed value changes —
// this is the ONLY React state that updates during gameplay, and it touches
// nothing inside the <Canvas>.
function GameHud({ bus, onExit, onRespawn }) {
  const [ui, setUi] = useState({ hp: 100, maxHp: 100, score: 0, kills: 0, dead: false, toast: '', level: 1, xp: 0, xpNext: 80, atk: 30, wandLevel: 0 })
  useEffect(() => {
    let raf
    let prev = { hp: -1, maxHp: -1, score: -1, kills: -1, dead: null, toast: null, level: -1, xp: -1, atk: -1, wandLevel: -1 }
    const tick = () => {
      const toast = bus.toastAt && performance.now() - bus.toastAt < 1400 ? bus.toast : ''
      if (bus.hp !== prev.hp || bus.maxHp !== prev.maxHp || bus.score !== prev.score || bus.kills !== prev.kills ||
          bus.dead !== prev.dead || toast !== prev.toast || bus.level !== prev.level || bus.xp !== prev.xp || bus.atk !== prev.atk ||
          bus.wandLevel !== prev.wandLevel) {
        prev = { hp: bus.hp, maxHp: bus.maxHp, score: bus.score, kills: bus.kills, dead: bus.dead, toast, level: bus.level, xp: bus.xp, atk: bus.atk, wandLevel: bus.wandLevel }
        setUi({ hp: bus.hp, maxHp: bus.maxHp, score: bus.score, kills: bus.kills, dead: bus.dead, toast, level: bus.level, xp: bus.xp, xpNext: bus.xpNext, atk: bus.atk, wandLevel: bus.wandLevel })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [bus])

  return (
    <>
      <Hud hp={ui.hp} maxHp={ui.maxHp} score={ui.score} kills={ui.kills} toast={ui.toast}
        level={ui.level} xp={ui.xp} xpNext={ui.xpNext} atk={ui.atk} wandLevel={ui.wandLevel} onExit={onExit} />
      {ui.dead && <DeathScreen score={ui.score} kills={ui.kills} level={ui.level} onRespawn={onRespawn} onExit={onExit} />}
    </>
  )
}

// ── The scene ────────────────────────────────────────────────────────────────
function World({ bus, api }) {
  const decorations = useMemo(() => buildDecorations(), [])
  const stars = useMemo(() => buildStars(), [])
  const enemies = useMemo(() => buildEnemies(), [])
  const wands = useMemo(() => buildWands(), [])

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
      <LightPools />
      <RuneCircle />
      {/* great luminous trees framing the clearing as scenic landmarks */}
      <WorldTree position={[-20, 0, -42]} scale={1.25} />
      <WorldTree position={[34, 0, -30]} scale={0.95} />
      <WorldTree position={[8, 0, 46]} scale={1.05} />
      {decorations.map((d, i) => <Decoration key={i} {...d} />)}
      <Lanterns />
      {stars.map((s) => <Collectible key={s.id} data={s} bus={bus} api={api} />)}
      {wands.map((w) => <WandPickup key={w.id} data={w} bus={bus} api={api} />)}
      {enemies.map((e) => <Enemy key={e.id} data={e} bus={bus} api={api} />)}

      {/* 뱀서-style auto skill: fires homing magic missiles at the nearest enemies
          while any 매직완드 is owned (bus.wandLevel > 0). */}
      <MagicWand bus={bus} api={api} />


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
  const vel = useRef(new THREE.Vector3())  // smoothed horizontal velocity → momentum
  const prevSpd = useRef(0)                // last frame's speed, for the acceleration weight-shift
  const swing = useRef({ seq: 0, t: 1, step: 0, moving: false })
  const charge = useRef({ seq: 0, t: 0, active: false }) // finisher rear-back wind-up
  const roll = useRef({ seq: 0, t: 0, cool: 0, was: false })
  const hit = useRef({ seq: 0, t: 0, fwd: 0, side: 0, was: false }) // enemy-strike flinch
  const hurtMat = useRef() // red flash shell that pulses when struck
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
    // The knight ROOTS while committing to an action — mid-swing, charging a finisher,
    // staggered by a hit, or in a finisher's recovery lag — so attacks feel weighty and
    // you can't just walk through them. (attack lunges/knockback still move you; input can't.)
    const nowMs = performance.now()
    const stunned = nowMs < bus.stunUntil
    const recovering = nowMs < bus.recoverUntil
    const attacking = swing.current.t < 1 || charge.current.active || bus.finisherPending
    const locked = bus.dead || stunned || recovering || attacking
    if (!locked) {
      if (k['KeyW'] || k['ArrowUp']) move.add(fwd)
      if (k['KeyS'] || k['ArrowDown']) move.sub(fwd)
      if (k['KeyD'] || k['ArrowRight']) move.add(right)
      if (k['KeyA'] || k['ArrowLeft']) move.sub(right)
      // on-screen joystick (analog) — adds on top of any keyboard input
      if (bus.move.x || bus.move.z) { move.addScaledVector(right, bus.move.x); move.addScaledVector(fwd, bus.move.z) }
    }
    const wantMove = move.lengthSq() > 0
    if (wantMove) move.normalize()

    // Start a dodge roll (Space), if off cooldown.
    if (bus.dodgeSeq !== roll.current.seq) {
      roll.current.seq = bus.dodgeSeq
      // can't roll while stunned by a hit; otherwise a roll cancels a swing / charge / recovery
      if (!bus.dead && !stunned && roll.current.t <= 0 && roll.current.cool <= 0) {
        roll.current.t = ROLL_TIME
        roll.current.cool = ROLL_TIME + ROLL_COOL
        bus.finisherPending = false      // dodging cancels a charging smash
        charge.current.active = false
        bus.recoverUntil = 0             // …and cancels post-finisher recovery lag
        swing.current.t = 1              // …and interrupts any in-progress swing
        vel.current.set(0, 0, 0)         // …and drops walking momentum (the roll gives its own burst)
        // roll in the pressed direction (forward if standing). Orient to it RIGHT AWAY so the
        // whole thing is one clean, natural, grounded forward roll — no flips, no spin-in-place.
        if (wantMove) _rollDir.copy(move)
        else _rollDir.set(Math.sin(facing.current), 0, Math.cos(facing.current))
        facing.current = Math.atan2(_rollDir.x, _rollDir.z)
        g.rotation.y = facing.current
      }
    }
    if (roll.current.cool > 0) roll.current.cool -= dt

    // An enemy strike just connected → kick off the flinch. Resolve the incoming shove
    // into forward/side components relative to where we face, so we reel BACKWARD when
    // hit from the front and twist toward the struck flank when hit from the side.
    if (bus.hitSeq !== hit.current.seq) {
      hit.current.seq = bus.hitSeq
      if (!bus.dead) {
        hit.current.t = HIT_TIME
        const sf = Math.sin(facing.current), cf = Math.cos(facing.current)
        hit.current.fwd = bus.hitDirX * sf + bus.hitDirZ * cf
        hit.current.side = bus.hitDirX * cf - bus.hitDirZ * sf
      }
    }

    const rolling = roll.current.t > 0
    const strafing = bus.strafe && !bus.dead
    let moving = false
    let spd = 0            // actual travel speed this frame (drives the walk animation)
    let locF = 1, locS = 0 // move direction relative to facing: forward(+)/back(−), right(+)/left(−)
    if (rolling) {
      roll.current.t -= dt
      const k2 = Math.max(0, roll.current.t) / ROLL_TIME
      bus.playerPos.addScaledVector(_rollDir, ROLL_SPEED * (0.4 + k2 * 0.6) * dt)
      // already oriented to the roll direction at the start → nothing to turn mid-roll
      bus.invuln = roll.current.t > ROLL_IFRAME // i-frames for most of the roll
    } else {
      bus.invuln = false
      // ── momentum: ease velocity toward the desired speed instead of snapping. You ramp
      //    up when you press and glide to a stop when you release — but a rooted action
      //    (attack/stun) bleeds it off fast so committing still stops you crisply. ──
      const sprint = !!(k['ShiftLeft'] || k['ShiftRight'] || bus.touchSprint)
      const targetSpeed = wantMove ? PLAYER_SPEED * (sprint ? SPRINT_MULT : 1) : 0
      const tvx = move.x * targetSpeed, tvz = move.z * targetSpeed
      const rate = locked ? MOVE_STOP : (wantMove ? MOVE_ACCEL : MOVE_DECEL)
      const kk = 1 - Math.exp(-rate * dt) // frame-rate-independent smoothing factor
      vel.current.x += (tvx - vel.current.x) * kk
      vel.current.z += (tvz - vel.current.z) * kk
      bus.playerPos.x += vel.current.x * dt
      bus.playerPos.z += vel.current.z * dt
      spd = Math.hypot(vel.current.x, vel.current.z)
      moving = spd > 0.12
      // Facing: in strafe mode the body locks to camera-forward so A/D side-step and
      // S back-pedal instead of spinning; otherwise steer toward the pressed direction
      // (while gliding with no key held we hold facing and coast straight).
      if (strafing) facing.current = Math.atan2(fwd.x, fwd.z)
      else if (wantMove) facing.current = Math.atan2(move.x, move.z)
      // Split the actual VELOCITY into forward/sideways relative to facing, so a glide keeps
      // matching the feet and the walk plays back-pedal / side-step variants correctly.
      if (moving) {
        const sf = Math.sin(facing.current), cf = Math.cos(facing.current)
        const nvx = vel.current.x / spd, nvz = vel.current.z / spd
        locF = nvx * sf + nvz * cf
        locS = nvx * cf - nvz * sf
      }
    }
    // hit knockback — a quick burst that decays across the flinch, shoved away from the enemy
    if (hit.current.t > 0) {
      const hk = hit.current.t / HIT_TIME // 1 → 0
      bus.playerPos.x += bus.hitDirX * HIT_KNOCK * hk * dt
      bus.playerPos.z += bus.hitDirZ * HIT_KNOCK * hk * dt
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
    const isSprint = !!(k['ShiftLeft'] || k['ShiftRight'] || bus.touchSprint)
    const tNow = performance.now()
    if (rolling) {
      // a natural forward roll owns the body — a quick tuck-and-tumble
      roll.current.was = true
      const rp = 1 - Math.max(0, roll.current.t) / ROLL_TIME // 0 → 1 progress
      const arc = Math.sin(rp * Math.PI) // 0→1→0 envelope for the limb tuck
      // eased 0→2π somersault: gentle angular velocity at both ends, lands exactly on 2π upright
      const ang = rp * Math.PI * 2 - Math.sin(rp * Math.PI * 2)
      const H = 0.55 // ROLL AROUND THE CENTRE OF MASS (belly height), not the feet — pivoting on
                     // the feet was the awkward bit: it pole-vaulted the head around the toes.
      if (b) {
        b.rotation.x = ang
        b.rotation.z = 0
        b.rotation.y = 0
        // hold that centre pivot fixed while the body spins around it, so the knight rolls OVER
        // its own middle like a real tuck-roll (forward travel is handled by the whole group).
        b.position.y = H * (1 - Math.cos(ang))
        b.position.z = -H * Math.sin(ang)
      }
      // curl into a tight ball through the roll, then unfurl back onto the feet
      if (leftLeg.current) leftLeg.current.rotation.x = 1.4 * arc
      if (rightLeg.current) rightLeg.current.rotation.x = 1.4 * arc
      if (leftArm.current) leftArm.current.rotation.x = -1.35 * arc
    } else {
      // clean up the instant the roll finishes so the tumble doesn't unwind backwards
      if (roll.current.was) {
        roll.current.was = false
        if (b) { b.rotation.x = 0; b.rotation.z = 0; b.rotation.y = 0; b.position.y = 0; b.position.z = 0 }
        if (leftLeg.current) leftLeg.current.rotation.x = 0
        if (rightLeg.current) rightLeg.current.rotation.x = 0
        if (leftArm.current) leftArm.current.rotation.x = 0
      }
      // legs & arms — a continuous gait driven by REAL speed: the stride winds up as you
      // accelerate and unwinds as you glide to a stop, cadence locked to ground speed so the
      // feet keep pace with the floor (much less sliding).
      const gaitN = THREE.MathUtils.clamp(spd / PLAYER_SPEED, 0, 1.7) // 0 … 1(walk) … ~1.7(sprint)
      const walkAmt = THREE.MathUtils.clamp(spd / 1.8, 0, 1)          // idle→walk blend for the torso
      walkPhase.current += dt * (3.5 + spd * 0.95)                    // steps keep pace with speed
      const amp = 0.5 * Math.min(gaitN, 1.45)
      const dir = locF < -0.15 ? -1 : 1 // back-pedalling flips the stride
      const a = Math.sin(walkPhase.current) * amp * dir
      const stepSwing = a
      // ease limbs toward the stride pose so start & stop BLEND instead of popping; as amp→0
      // near a standstill the legs settle to neutral on their own.
      const legK = Math.min(1, dt * 14)
      if (leftLeg.current) leftLeg.current.rotation.x += (a - leftLeg.current.rotation.x) * legK
      if (rightLeg.current) rightLeg.current.rotation.x += (-a - rightLeg.current.rotation.x) * legK
      if (leftArm.current) leftArm.current.rotation.x += (-a * 0.95 - leftArm.current.rotation.x) * legK
      // torso: lean into travel + a weight-shift from acceleration; step-bounce blends into breathing
      if (b) {
        // pitch forward as you speed up, rock back as you brake — a believable weight shift
        const accelLean = THREE.MathUtils.clamp((spd - prevSpd.current) / Math.max(dt, 0.001) * 0.004, -0.09, 0.09)
        const leanTarget = locF * 0.18 * gaitN + accelLean
        b.rotation.x += (leanTarget - b.rotation.x) * Math.min(1, dt * 8)

        const bounce = Math.abs(Math.sin(walkPhase.current)) * 0.085 * Math.min(gaitN, 1.6)
        const breathe = 0.02 + Math.sin(tNow * 0.0018) * 0.02 // gentle idle breathing
        const yTarget = THREE.MathUtils.lerp(breathe, bounce, walkAmt)
        b.position.y += (yTarget - b.position.y) * Math.min(1, dt * 12)

        const stepRoll = stepSwing * 0.12 * walkAmt + Math.sin(tNow * 0.0011) * 0.02 * (1 - walkAmt)
        const strafeBank = -locS * 0.2 * gaitN // lean into a side-step
        const turnBank = THREE.MathUtils.clamp(d * 0.9, -0.22, 0.22) // lean into turns
        b.rotation.z += (stepRoll + strafeBank + turnBank - b.rotation.z) * Math.min(1, dt * 10)
      }
    }

    // release the charged finisher once its wind-up elapses → THIS is the moment the
    // smash actually fires (damage · impact · VFX all keyed off the attackSeq bump).
    if (bus.finisherPending && (bus.dead || tNow >= bus.finisherFireAt)) {
      bus.finisherPending = false
      if (bus.dead) {
        charge.current.active = false
      } else {
        bus.attackAt = tNow
        bus.attackSeq++
        bus.comboStep = 2
        bus.attackDamage = bus.atk * 2 // finisher hits for double
        bus.attackRange = 4.4
        bus.attackKnock = 2.4
        bus.shake = 0.62 // the big weighty jolt lands HERE, not at the click
        // rooted recovery lag — after the smash the knight is locked, hunched over,
        // for a beat before he can move/attack again (a dodge-roll can cancel it).
        bus.recoverFrom = tNow
        bus.recoverUntil = tNow + FINISHER_RECOVER
      }
    }

    // sword swing — 3-hit combo, each step a distinct sweep across the FRONT (+Z)
    const sp = swordPivot.current
    if (sp) {
      // a finisher just began charging → start the rear-back wind-up
      if (bus.chargeSeq !== charge.current.seq) {
        charge.current.seq = bus.chargeSeq
        charge.current.active = true
        charge.current.t = 0
      }
      if (bus.attackSeq !== swing.current.seq) {
        swing.current.seq = bus.attackSeq
        swing.current.t = 0
        swing.current.step = bus.comboStep // lock in which combo step this swing plays
        swing.current.moving = bus.attackMoving // running-slash vs planted, decided at the click
        charge.current.active = false // the smash released — hand the pose off to the swing
      }
      if (charge.current.active) {
        // ── FINISHER WIND-UP: heave the blade high overhead, lean back & load onto
        //    braced legs, holding the tension (glow builds, a rising quiver) so the
        //    smash that follows feels earned instead of instant ──
        charge.current.t = Math.min(1, charge.current.t + dt * (1000 / FINISHER_WINDUP))
        const c = charge.current.t
        const e = 1 - Math.pow(1 - c, 2)
        sp.rotation.x += (-2.1 - sp.rotation.x) * Math.min(1, dt * 12) // rear WAY back
        sp.rotation.y += (0 - sp.rotation.y) * Math.min(1, dt * 10)
        if (b) {
          b.rotation.x += (-0.32 * e - b.rotation.x) * Math.min(1, dt * 8) // lean back to load
          b.rotation.y += (0 - b.rotation.y) * Math.min(1, dt * 8)
        }
        const quiver = Math.sin(tNow * 0.06) * 0.05 * e // muscles straining as it nears release
        if (leftLeg.current) leftLeg.current.rotation.x = 0.3 * e + quiver
        if (rightLeg.current) rightLeg.current.rotation.x = -0.3 * e - quiver
        if (bladeMat.current) bladeMat.current.emissiveIntensity = 0.6 + e * 3.6 // charge up bright
      } else if (swing.current.t < 1) {
        const st = swing.current.step
        const mv = swing.current.moving
        // MOVING → a fast, flowing running-slash (no wind-up, wider sweep, deep lunge).
        // PLANTED → the knight cocks the blade back (anticipation), plants a foot, then
        // lands the blow with weight — reads slower and heavier. Two clearly different attacks.
        // the finisher whips DOWN fast — the wind-up already supplied the delay, so the
        // release itself should be snappy & violent, not slow
        const spd = (st === 2 ? 4.7 : 3.7) * (mv ? 1.15 : 0.9)
        swing.current.t = Math.min(1, swing.current.t + dt * spd)
        const t = swing.current.t
        const s = 1 - Math.pow(1 - t, 2) // ease-out
        const arc = Math.sin(t * Math.PI)
        const ant = mv ? 0 : (1 - s) * arc  // planted-only coil: winds the blade back before it fires
        const widen = mv ? 0.5 : 0          // moving swings carry through a wider arc
        if (st === 0) {
          // ① right → left horizontal slash
          sp.rotation.y = (1.25 + ant * 1.2) - s * (2.25 + widen)
          sp.rotation.x = 0.5 - arc * (mv ? 0.62 : 0.5) - ant * 0.5
          if (b) { b.rotation.y = (0.42 + ant * 0.55) - s * 0.85; b.rotation.x = Math.max(b.rotation.x, arc * (mv ? 0.42 : 0.3)) }
        } else if (st === 1) {
          // ② left → right backhand slash (mirror of ①)
          sp.rotation.y = (-1.0 - ant * 1.2) + s * (2.25 + widen)
          sp.rotation.x = 0.5 - arc * (mv ? 0.62 : 0.5) - ant * 0.5
          if (b) { b.rotation.y = (-0.42 - ant * 0.55) + s * 0.85; b.rotation.x = Math.max(b.rotation.x, arc * (mv ? 0.42 : 0.3)) }
        } else {
          // ③ overhead smash finisher — released from the charged rear-back (~-2.1) it
          // whips straight down in a big heavy arc; body drives forward over the blow
          sp.rotation.x = -2.1 + s * 2.95
          sp.rotation.y = 0.12 * (1 - s)
          if (b) { b.rotation.y = 0; b.rotation.x = Math.max(b.rotation.x, arc * 0.6) }
        }
        // planted attacks sink onto a braced foot; moving attacks stay tall & carry forward
        if (b && !mv) b.position.y -= arc * 0.05
        // dynamic forward lunge into the strike — deep on a running-slash, a short step when planted
        const lunge = (st === 2 ? 7 : 3.4) * arc * (mv ? 1.7 : 0.75)
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
    const trulyIdle = !moving && !rolling && !strafing && !bus.dead && swing.current.t >= 1 &&
      hit.current.t <= 0 && nowMs >= bus.recoverUntil && nowMs >= bus.stunUntil
    if (trulyIdle) {
      idl.t += dt
      if (!idl.kind && idl.t > idl.next) {
        idl.kind = ['lookL', 'lookR', 'scan', 'nod', 'swing'][Math.floor(Math.random() * 5)]
        idl.gt = 0
        idl.dur = idl.kind === 'swing' ? 0.6 : idl.kind === 'scan' ? 2.2 : 1.4
        // cosmetic practice swing — force a LIGHT step (never the heavy finisher pose), no hit, no arc
        if (idl.kind === 'swing') { swing.current.step = 0; swing.current.moving = false; swing.current.t = 0 }
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
    if (hd && !idl.kind && hit.current.t <= 0) {
      hd.rotation.y += (0 - hd.rotation.y) * Math.min(1, dt * 6)
      hd.rotation.x += (0 - hd.rotation.x) * Math.min(1, dt * 6)
    }

    // ── hit flinch — a sharp, full-body recoil the instant an enemy strike lands.
    // Runs LAST so it overrides the walk/idle/swing poses: the knight is briefly
    // staggered — torso jolts away from the blow, head whips, arms fling up defensively,
    // and a red shell flashes — then everything springs back with a damped shudder. ──
    if (hit.current.t > 0) {
      hit.current.was = true
      hit.current.t -= dt
      const h = Math.max(0, hit.current.t) / HIT_TIME        // 1 → 0 across the flinch
      const damp = Math.pow(h, 0.55)                         // hardest at impact, eases out
      const shud = Math.cos((1 - h) * Math.PI * 2.4) * damp  // damped shudder, +1 at impact
      const crumple = Math.sin(Math.min(1, (1 - h) * 2) * Math.PI) * damp // quick knee-buckle dip
      const fwd = hit.current.fwd, side = hit.current.side
      if (b) {
        b.rotation.x = -fwd * 0.7 * shud   // reel backward from a frontal blow
        b.rotation.z = side * 0.55 * shud  // fold toward the struck flank
        b.rotation.y = -side * 0.4 * shud  // twist off the hit
        b.position.y = -0.09 * crumple     // sink briefly, then rise
      }
      if (hd) {
        hd.rotation.x = fwd * 0.6 * shud   // head snaps back
        hd.rotation.y = -side * 0.5 * shud
      }
      if (leftLeg.current) leftLeg.current.rotation.x = -0.4 * crumple  // stagger-step
      if (rightLeg.current) rightLeg.current.rotation.x = 0.3 * crumple
      if (leftArm.current) leftArm.current.rotation.x = -1.3 * damp     // arms fling up
      if (sp) sp.rotation.x = Math.max(sp.rotation.x, 0.5 + 1.0 * damp) // guard the sword arm high
      if (hurtMat.current) hurtMat.current.opacity = 0.6 * damp         // red flash blooms & fades
    } else if (hit.current.was) {
      // clean up the frame the flinch ends so it doesn't leave the shell lit
      hit.current.was = false
      if (hurtMat.current) hurtMat.current.opacity = 0
    }

    // ── finisher recovery pose — once the smash has landed, the knight is hunched over
    //    from the effort, blade hanging low, and slowly straightens back to guard over the
    //    recovery window (input stays locked through it — see the movement gate). ──
    if (swing.current.step === 2 && swing.current.t >= 1 && nowMs < bus.recoverUntil && hit.current.t <= 0) {
      const span = bus.recoverUntil - bus.recoverFrom
      const rp = span > 0 ? THREE.MathUtils.clamp((bus.recoverUntil - nowMs) / span, 0, 1) : 0
      const rr = rp * rp // heavy hunch right after impact, easing up to standing
      if (b) { b.rotation.x = 0.34 * rr; b.position.y = -0.06 * rr; b.rotation.z = 0.06 * Math.sin(nowMs * 0.012) * rr }
      if (hd) hd.rotation.x = 0.34 * rr                 // head bowed, catching breath
      if (leftLeg.current) leftLeg.current.rotation.x = 0.22 * rr   // braced, recovering stance
      if (rightLeg.current) rightLeg.current.rotation.x = -0.16 * rr
      if (sp) sp.rotation.x = 0.5 + 0.85 * rr           // sword still low from the swing-through
    }

    prevSpd.current = spd // remember this frame's speed for next frame's acceleration lean

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

        {/* hurt flash — a red additive shell that blooms over the whole body when an
            enemy strike connects, then fades out (opacity driven from the flinch). */}
        <mesh position={[0, 0.7, 0]} scale={[1.35, 1.7, 1.35]}>
          <sphereGeometry args={[0.42, 20, 16]} />
          <meshBasicMaterial ref={hurtMat} color="#ff4657" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>

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
          {/* glossy eyes — flattened in Z (scale) so they hug the face like a decal
              instead of bulging out as bug-eyes; each sits just inside the head surface */}
          <mesh position={[-0.13, 0.33, 0.305]} scale={[1, 1.05, 0.4]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#f6f9ff" roughness={0.3} />
          </mesh>
          <mesh position={[0.13, 0.33, 0.305]} scale={[1, 1.05, 0.4]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#f6f9ff" roughness={0.3} />
          </mesh>
          <mesh position={[-0.14, 0.32, 0.33]} scale={[1, 1, 0.42]}>
            <sphereGeometry args={[0.06, 14, 14]} />
            <meshStandardMaterial color="#2b2f52" roughness={0.25} />
          </mesh>
          <mesh position={[0.14, 0.32, 0.33]} scale={[1, 1, 0.42]}>
            <sphereGeometry args={[0.06, 14, 14]} />
            <meshStandardMaterial color="#2b2f52" roughness={0.25} />
          </mesh>
          {/* eye sparkles */}
          <mesh position={[-0.11, 0.37, 0.35]}>
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1.4} toneMapped={false} />
          </mesh>
          <mesh position={[0.16, 0.37, 0.35]}>
            <sphereGeometry args={[0.02, 8, 8]} />
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
    hp: data.hp, maxHp: data.hp, alive: true, x: data.x, z: data.z, seen: 0, hurtT: 0,
    mode: 'roam', timer: 0, cool: 0, struck: false, lx: 0, lz: 0,
  })

  // Register this enemy's live state on the bus so auto-targeting skills (매직완드 등)
  // can find & damage it. Unregister on unmount.
  useEffect(() => {
    bus.enemies.push(state.current)
    return () => { const i = bus.enemies.indexOf(state.current); if (i >= 0) bus.enemies.splice(i, 1) }
  }, [bus])

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
        // damage lands ONLY here, and only if still in range and not mid-dodge.
        // pass the lunge direction so the player reels & is knocked back away from us.
        if (dist < ENEMY_HITRANGE && !bus.invuln && !bus.dead) api.damage(16, s.lx, s.lz)
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
      }
    }

    // Death from ANY source — melee above OR a 매직완드 missile that lowered s.hp
    // from its own frame. Centralised here so every damage source scores a kill once.
    if (s.alive && s.hp <= 0) { s.alive = false; g.visible = false; api.addScore(50); api.onKill(); return }

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
      api.addScore(10); api.heal(4); api.gainXp(8)
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

// ── 매직완드 pickup — a floating staff; walking over it grants a wand stack ────────
function WandPickup({ data, bus, api }) {
  const ref = useRef()
  const got = useRef(false)
  useFrame((_, dt) => {
    const m = ref.current
    if (!m || got.current) return
    m.rotation.y += dt * 2
    m.position.y = 0.95 + Math.sin(performance.now() * 0.003 + data.id) * 0.2
    const dx = bus.playerPos.x - data.x, dz = bus.playerPos.z - data.z
    if (Math.hypot(dx, dz) < 1.5) {
      got.current = true
      m.visible = false
      api.pickWand()
    }
  })
  return (
    <group ref={ref} position={[data.x, 0.95, data.z]}>
      {/* staff shaft */}
      <mesh rotation={[0, 0, 0.18]} castShadow>
        <cylinderGeometry args={[0.045, 0.055, 0.95, 8]} />
        <meshStandardMaterial color="#8a6a42" roughness={0.7} />
      </mesh>
      {/* glowing crystal tip */}
      <mesh position={[0.11, 0.52, 0]}>
        <icosahedronGeometry args={[0.17, 0]} />
        <meshStandardMaterial color="#cfe6ff" emissive="#5aa8ff" emissiveIntensity={2.6} toneMapped={false} />
      </mesh>
      {/* halo ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <ringGeometry args={[0.42, 0.52, 22]} />
        <meshBasicMaterial color="#7fc0ff" transparent opacity={0.5} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <Sparkles count={12} scale={1.5} size={3} speed={0.5} color="#bfe0ff" />
    </group>
  )
}

// Scratch buffer so nearest-enemy scans allocate nothing on the hot path.
const _cand = []
function nearestEnemies(bus, n, maxRange) {
  const px = bus.playerPos.x, pz = bus.playerPos.z
  _cand.length = 0
  for (const s of bus.enemies) {
    if (!s.alive) continue
    const d = Math.hypot(s.x - px, s.z - pz)
    if (d <= maxRange) _cand.push({ s, d })
  }
  _cand.sort((a, b) => a.d - b.d)
  const out = []
  for (let i = 0; i < Math.min(n, _cand.length); i++) out.push(_cand[i].s)
  return out
}

// ── 매직완드 auto-skill: homing magic missiles ────────────────────────────────
// More stacks → faster fire + more missiles per volley. Missiles home onto the
// nearest living enemies and deal damage scaled off the player's attack.
const WAND_RANGE = 34
const WAND_SHOT_SPEED = 24
function wandInterval(level) { return Math.max(0.4, 1.5 - (level - 1) * 0.18) }

function MagicWand({ bus }) {
  const N = 32 // projectile pool
  const meshes = useRef([])
  const shots = useRef(Array.from({ length: N }, () => ({ active: false, x: 0, y: 1.1, z: 0, vx: 0, vz: 0, life: 0, target: null })))
  const cd = useRef(0.5)

  const spawn = (fromX, fromZ, target) => {
    const s = shots.current.find((q) => !q.active)
    if (!s) return
    const dx = target.x - fromX, dz = target.z - fromZ
    const d = Math.hypot(dx, dz) || 1
    s.active = true; s.x = fromX; s.y = 1.1; s.z = fromZ
    s.vx = (dx / d) * WAND_SHOT_SPEED; s.vz = (dz / d) * WAND_SHOT_SPEED
    s.life = 2.4; s.target = target
  }

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)

    // fire
    if (bus.wandLevel > 0 && !bus.dead) {
      cd.current -= dt
      if (cd.current <= 0) {
        const volley = Math.min(bus.wandLevel, 5)
        const targets = nearestEnemies(bus, volley, WAND_RANGE)
        if (targets.length) {
          cd.current = wandInterval(bus.wandLevel)
          const px = bus.playerPos.x, pz = bus.playerPos.z
          for (let i = 0; i < volley; i++) spawn(px, pz, targets[i % targets.length])
        } else {
          cd.current = 0.25 // no target in range — try again soon
        }
      }
    }

    const dmg = Math.max(8, Math.round(bus.atk * 0.7))
    for (let i = 0; i < N; i++) {
      const s = shots.current[i]
      const m = meshes.current[i]
      if (!s.active) { if (m) m.visible = false; continue }
      // home toward a living target; if it died, keep flying straight until it expires
      if (s.target && s.target.alive) {
        const dx = s.target.x - s.x, dz = s.target.z - s.z
        const d = Math.hypot(dx, dz) || 1
        s.vx += ((dx / d) * WAND_SHOT_SPEED - s.vx) * Math.min(1, dt * 9)
        s.vz += ((dz / d) * WAND_SHOT_SPEED - s.vz) * Math.min(1, dt * 9)
        if (d < 0.95) { // hit
          s.target.hp -= dmg; s.target.hurtT = 1
          s.active = false; if (m) m.visible = false
          continue
        }
      }
      s.x += s.vx * dt; s.z += s.vz * dt
      s.life -= dt
      if (s.life <= 0) { s.active = false; if (m) m.visible = false; continue }
      if (m) { m.visible = true; m.position.set(s.x, s.y, s.z); m.rotation.x += dt * 12; m.rotation.y += dt * 9 }
    }
  })

  return (
    <group>
      {Array.from({ length: N }).map((_, i) => (
        <mesh key={i} ref={(el) => (meshes.current[i] = el)} visible={false}>
          <octahedronGeometry args={[0.17, 0]} />
          <meshStandardMaterial color="#cfe6ff" emissive="#5aa8ff" emissiveIntensity={2.8} toneMapped={false} />
        </mesh>
      ))}
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
      {/* soft bright heart of the clearing → a gentle radial-glow feel underfoot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.010, 0]}>
        <circleGeometry args={[WORLD_RADIUS * 0.3, 64]} />
        <meshBasicMaterial color="#4a6f96" transparent opacity={0.38} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* concentric ripple rings radiating outward for depth */}
      {[0.62, 0.74, 0.86].map((f, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.011, 0]}>
          <ringGeometry args={[WORLD_RADIUS * f - 0.12, WORLD_RADIUS * f, 120]} />
          <meshBasicMaterial color="#5f7ac0" transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
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

// ── Bioluminescent light-pools glowing softly on the clearing floor ──
function LightPools() {
  const pools = useMemo(() => {
    const cols = ['#6fe0d0', '#8fb0ff', '#c9a0ff', '#ffd98a', '#9ff0dd']
    const out = []
    for (let i = 0; i < 15; i++) {
      const a = Math.random() * Math.PI * 2
      const r = rand(4, WORLD_RADIUS * 0.82)
      out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, s: rand(1.4, 3.8), c: cols[i % cols.length] })
    }
    return out
  }, [])
  return (
    <group>
      {pools.map((p, i) => (
        <group key={i} position={[p.x, 0.016, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <mesh>
            <circleGeometry args={[p.s, 28]} />
            <meshBasicMaterial color={p.c} transparent opacity={0.13} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0, 0.001]}>
            <circleGeometry args={[p.s * 0.42, 24]} />
            <meshBasicMaterial color={p.c} transparent opacity={0.18} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ── A slowly-turning magic rune circle inscribed on the central clearing ──
function RuneCircle() {
  const g = useRef()
  useFrame((_, dt) => { if (g.current) g.current.rotation.z += dt * 0.06 })
  const spokes = 14
  return (
    <group position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <group ref={g}>
        <mesh><ringGeometry args={[5.2, 5.5, 90]} /><meshBasicMaterial color="#7fa0e6" transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} /></mesh>
        <mesh><ringGeometry args={[6.7, 6.82, 90]} /><meshBasicMaterial color="#8fe0d0" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} /></mesh>
        <mesh><ringGeometry args={[7.4, 7.46, 90]} /><meshBasicMaterial color="#bcd4ff" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} /></mesh>
        {Array.from({ length: spokes }).map((_, i) => {
          const a = (i / spokes) * Math.PI * 2
          return (
            <mesh key={i} position={[Math.cos(a) * 6.1, Math.sin(a) * 6.1, 0]} rotation={[0, 0, a]}>
              <planeGeometry args={[0.9, 0.09]} />
              <meshBasicMaterial color="#cfe0ff" transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
            </mesh>
          )
        })}
      </group>
    </group>
  )
}

// ── Glowing lanterns drifting & bobbing over the clearing ──
function Lanterns() {
  const data = useMemo(() => {
    const cols = ['#ffcf7a', '#8fe0ff', '#ff9db1', '#c9a0ff', '#9ff0dd']
    const out = []
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2
      const r = rand(8, WORLD_RADIUS * 0.85)
      out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: rand(2.4, 6), c: cols[i % cols.length], ph: Math.random() * 6.28, sp: rand(0.3, 0.7), s: rand(0.7, 1.2) })
    }
    return out
  }, [])
  const grp = useRef()
  useFrame(() => {
    const g = grp.current
    if (!g) return
    const t = performance.now() * 0.001
    for (let i = 0; i < g.children.length; i++) {
      const d = data[i], c = g.children[i]
      c.position.y = d.y + Math.sin(t * d.sp + d.ph) * 0.5
      c.position.x = d.x + Math.sin(t * d.sp * 0.6 + d.ph) * 0.7
    }
  })
  return (
    <group ref={grp}>
      {data.map((d, i) => (
        <group key={i} position={[d.x, d.y, d.z]} scale={d.s}>
          <mesh><sphereGeometry args={[0.2, 14, 14]} /><meshStandardMaterial color={d.c} emissive={d.c} emissiveIntensity={2.4} toneMapped={false} /></mesh>
          <mesh><sphereGeometry args={[0.42, 14, 14]} /><meshBasicMaterial color={d.c} transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} /></mesh>
          <Sparkles count={6} scale={1.3} size={2} speed={0.3} color={d.c} />
        </group>
      ))}
    </group>
  )
}

// ── A great luminous world-tree — a scenic landmark on the horizon ──
function WorldTree({ position, scale = 1 }) {
  const canopy = [[0, 8.6, 0, 3.4], [2.7, 9.3, 1.2, 2.3], [-2.5, 9.6, -1, 2.1], [0.4, 10.9, 0.3, 1.8], [1.4, 7.6, -1.8, 1.6]]
  return (
    <group position={position} scale={scale}>
      <mesh castShadow position={[0, 4, 0]}>
        <cylinderGeometry args={[0.7, 1.6, 8, 10]} />
        <meshStandardMaterial color="#2a2440" roughness={0.9} flatShading />
      </mesh>
      {canopy.map((c, i) => (
        <mesh key={i} castShadow position={[c[0], c[1], c[2]]}>
          <icosahedronGeometry args={[c[3], 0]} />
          <meshStandardMaterial color="#39608f" emissive="#4fd0c0" emissiveIntensity={0.55} roughness={0.7} flatShading />
        </mesh>
      ))}
      {/* heart-glow + blossom motes */}
      <mesh position={[0, 9.4, 0]}><sphereGeometry args={[0.9, 16, 16]} /><meshBasicMaterial color="#8fe6ff" transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} /></mesh>
      <Sparkles count={46} scale={[8, 7, 8]} position={[0, 9.4, 0]} size={3} speed={0.25} opacity={0.9} color="#bfe9ff" />
      {/* one STATIC point light (never toggled → no shader-recompile hitch) */}
      <pointLight position={[0, 9, 0]} color="#7fe0d0" intensity={1.3} distance={46} />
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

function buildWands() {
  const out = []
  for (let i = 0; i < 4; i++) {
    const { x, z } = scatterPos(6, WORLD_RADIUS - 6)
    out.push({ id: i, x, z })
  }
  return out
}

// ── HUD / overlays ────────────────────────────────────────────────────────────
function Hud({ hp, maxHp, score, kills, toast, level, xp, xpNext, atk, wandLevel = 0, onExit }) {
  const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100))
  const xpPct = Math.max(0, Math.min(100, (xp / xpNext) * 100))
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: "'Noto Sans KR', sans-serif", color: '#eaf0ff' }}>
      {/* top-left character panel */}
      <div style={{ position: 'absolute', top: 20, left: 22, display: 'flex', flexDirection: 'column', gap: 7, width: 250 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 13, letterSpacing: '0.15em', color: 'rgba(180,200,255,0.7)' }}>달빛 원정</div>
          {/* level badge */}
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 3, padding: '2px 10px', borderRadius: 20,
            background: 'linear-gradient(135deg,#4d6bd0,#8258d6)', boxShadow: '0 2px 10px rgba(90,110,220,0.45)',
            fontSize: 11, fontWeight: 700, letterSpacing: '0.03em',
          }}>
            <span style={{ opacity: 0.8 }}>Lv.</span><span style={{ fontSize: 15 }}>{level}</span>
          </div>
        </div>
        {/* HP bar with numbers */}
        <div style={{ position: 'relative', width: 250, height: 17, borderRadius: 8, background: 'rgba(255,255,255,0.1)', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
          <div style={{ width: `${hpPct}%`, height: '100%', background: 'linear-gradient(90deg,#ff5a7a,#ff9db1)', transition: 'width 0.25s' }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
            {Math.ceil(hp)} / {maxHp}
          </div>
        </div>
        {/* XP bar */}
        <div style={{ position: 'relative', width: 250, height: 8, borderRadius: 5, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
          <div style={{ width: `${xpPct}%`, height: '100%', background: 'linear-gradient(90deg,#7fd0ff,#b98fff)', transition: 'width 0.25s' }} />
        </div>
        {/* stats */}
        <div style={{ display: 'flex', gap: 14, fontSize: 13, marginTop: 1, color: 'rgba(225,233,255,0.9)' }}>
          <span>⚔ 공격력 <b>{atk}</b></span>
          <span>✧ EXP <b>{xp}/{xpNext}</b></span>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'rgba(225,233,255,0.9)' }}>
          <span>✦ 파편 <b>{score}</b></span>
          <span>☠ 처치 <b>{kills}</b></span>
        </div>
        {/* owned auto-skill items (뱀서-style) */}
        {wandLevel > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 8,
              background: 'rgba(90,168,255,0.16)', border: '1px solid rgba(120,190,255,0.4)', fontSize: 12,
            }}>
              <span style={{ fontSize: 14 }}>🪄</span> 매직완드 <b>Lv.{wandLevel}</b>
            </div>
          </div>
        )}
      </div>

      {/* controls hint — moved to the top so it clears the on-screen stick/buttons */}
      <div style={{
        position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)', textAlign: 'center',
        maxWidth: 'calc(100vw - 32px)', fontSize: 11.5, lineHeight: 1.65, color: 'rgba(200,215,255,0.5)',
        pointerEvents: 'none',
      }}>
        <div>왼쪽 스틱 <b>이동</b> · 화면 드래그 <b>시점</b> · 버튼 <b>공격·구르기·질주</b></div>
        <div style={{ opacity: 0.65 }}>PC: WASD · 마우스드래그 · 좌클릭 연타 콤보 · Space · Shift · ESC</div>
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

function DeathScreen({ score, kills, level, onRespawn, onExit }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 22, background: 'rgba(5,6,15,0.72)',
      backdropFilter: 'blur(3px)', fontFamily: "'Noto Sans KR', sans-serif", color: '#eaf0ff',
    }}>
      <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '0.1em', color: '#ff8fa6' }}>쓰러졌다…</div>
      <div style={{ fontSize: 15, color: 'rgba(220,230,255,0.75)' }}>Lv.{level} · 파편 {score} · 처치 {kills}</div>
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
