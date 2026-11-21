import { Canvas, useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  CanvasTexture,
  Group,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  SRGBColorSpace,
  Vector3,
} from 'three'
import {
  cardRank,
  phases,
  suits,
  type Action,
  type Player,
  type State,
  type TableMessage,
} from './game'

type Vec = [number, number, number]
const accents = ['#d8b276', '#557e93', '#aa576b', '#bd864d', '#669174', '#8b71aa']
const skins = ['#b07e5f', '#97674d', '#c59879', '#a47154', '#c08e6f', '#956341']
const hair = ['#2b2026', '#26202a', '#542e36', '#3c282b', '#332a30', '#332530']
const humanSeat: Vec = [0, 0, 5]

function Box({ p, size, color }: { p: Vec; size: Vec; color: string }) {
  return (
    <mesh position={p}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.78} />
    </mesh>
  )
}

function Chair({ position, rotation }: { position: Vec; rotation: number }) {
  return (
    <group position={position} rotation-y={rotation}>
      <Box p={[0, 0.47, 0.02]} size={[0.93, 0.25, 0.85]} color="#372532" />
      <Box p={[0, 0.81, -0.37]} size={[0.91, 0.76, 0.16]} color="#4c303d" />
      <Box p={[0, 0.23, 0.02]} size={[0.35, 0.45, 0.4]} color="#231e25" />
    </group>
  )
}

// --- cards ---------------------------------------------------------------------
const textures = new Map<string, CanvasTexture>()
function faceTexture(card: string) {
  const cached = textures.get(card)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 176
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#f7ecd6'
  ctx.fillRect(0, 0, 128, 176)
  ctx.strokeStyle = '#d7c4a5'
  ctx.lineWidth = 3
  ctx.strokeRect(6, 6, 116, 164)
  ctx.fillStyle = 'hd'.includes(card[1]) ? '#ac354a' : '#262836'
  ctx.font = 'bold 42px Georgia'
  ctx.fillText(cardRank(card), 14, 53)
  ctx.font = '76px Georgia'
  ctx.textAlign = 'center'
  ctx.fillText(suits[card[1]], 67, 132)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  textures.set(card, texture)
  return texture
}
let backTexture: CanvasTexture | null = null
function cardBack() {
  if (backTexture) return backTexture
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 88
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#7b2f45'
  ctx.fillRect(0, 0, 64, 88)
  ctx.strokeStyle = '#e8c79a'
  ctx.lineWidth = 2
  ctx.strokeRect(5, 5, 54, 78)
  ctx.strokeRect(10, 10, 44, 68)
  backTexture = new CanvasTexture(canvas)
  backTexture.colorSpace = SRGBColorSpace
  return backTexture
}

function PlayingCard({
  card,
  p,
  facedown = false,
  scale = 1,
  rotation = 0,
}: {
  card?: string
  p: Vec
  facedown?: boolean
  scale?: number
  rotation?: number
}) {
  const ref = useRef<Group>(null)
  const present = Boolean(card) || facedown
  // Drop newly dealt cards onto the felt.
  useEffect(() => {
    if (ref.current && present) ref.current.position.y = p[1] + 0.22
  }, [card, facedown, present, p[1]])
  useFrame((_, delta) => {
    if (ref.current) ref.current.position.y = MathUtils.damp(ref.current.position.y, p[1], 9, delta)
  })
  const map = card ? faceTexture(card) : facedown ? cardBack() : null
  return (
    <group ref={ref} position={p} rotation-y={rotation} scale={scale}>
      {/* The key forces a fresh material whenever the texture changes; three.js
          will not start sampling a map on a material compiled without one. */}
      <mesh key={card ?? (facedown ? 'back' : 'slot')} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.46, 0.66]} />
        {map ? (
          <meshBasicMaterial map={map} toneMapped={false} />
        ) : (
          <meshBasicMaterial color="#285c53" />
        )}
      </mesh>
    </group>
  )
}

// --- seats ---------------------------------------------------------------------
const fixedPositions: Vec[] = [
  [0, 0, 3],
  [-3.05, 0, -0.55],
  [0, 0, -2.55],
  [3.05, 0, -0.55],
]
function positionFor(id: number, total: number): Vec {
  if (total === 4 || id === 0) return fixedPositions[id]
  const angle = ((id - 1) / (total - 2)) * Math.PI
  return [-3.36 * Math.cos(angle), 0, -0.25 - 2.42 * Math.sin(angle)]
}
const yawTo = (from: Vec, to: Vec) => Math.atan2(to[0] - from[0], to[2] - from[2])

function useLatestAction(state: State | null, seat: number) {
  const last = state?.actions.findLast((a) => a.seat === seat && a.hand === state.hand)
  const key = last ? `${last.hand}:${state?.actions.lastIndexOf(last)}:${last.action}` : ''
  const [moment, setMoment] = useState<{ action: Action; at: number } | null>(null)
  const seen = useRef(key) // actions that happened before mounting do not animate
  useEffect(() => {
    if (last && key && key !== seen.current) setMoment({ action: last.action, at: performance.now() })
    seen.current = key
  }, [key, last])
  return moment
}

function Character({
  p,
  player,
  state,
  active,
  thinking,
  dealer,
  message,
  look,
  labels,
  rank,
}: {
  p: Vec
  player: Player
  state: State
  active: boolean
  thinking: boolean
  dealer: boolean
  labels: RefObject<HTMLDivElement>
  message?: TableMessage
  look: Vec | null
  rank?: string
}) {
  const { id, name, stack, bet, folded, in_hand } = player
  const body = useRef<Group>(null)
  const arms = useRef<(Group | null)[]>([])
  const head = useRef<Mesh>(null)
  const facing = Math.atan2(-p[0], -p[2])
  const moment = useLatestAction(state, id)
  const won = state.result?.winners.includes(id)
  useFrame(({ clock }, delta) => {
    if (!body.current) return
    const target = look ? yawTo(p, look) : facing
    body.current.rotation.y = MathUtils.damp(body.current.rotation.y, target, 5, delta)
    const t = clock.elapsedTime
    const since = moment ? (performance.now() - moment.at) / 1000 : 9
    const reacting = won && state.result ? Math.max(0, Math.sin(t * 7)) * 0.08 : 0
    body.current.position.y = (active || message ? Math.sin(t * 3.6) * 0.018 : 0) + reacting
    if (head.current) head.current.rotation.x = thinking ? Math.sin(t * 1.4) * 0.12 - 0.08 : 0
    arms.current.forEach((arm, side) => {
      if (!arm) return
      let reach = active ? -0.33 : -0.15
      if (since < 1.1 && moment) {
        const k = Math.sin((since / 1.1) * Math.PI)
        if (moment.action === 'call' || moment.action === 'raise')
          reach -= k * (moment.action === 'raise' || side === 1 ? 0.95 : 0.2)
        else if (moment.action === 'fold') reach -= k * (side === 0 ? 0.7 : 0.1)
        else if (moment.action === 'check' && side === 1) reach += Math.abs(Math.sin(since * 12)) * 0.25 * (1 - since)
      }
      if (thinking && side === 0) reach = -0.9 + Math.sin(t * 2) * 0.05 // hand to chin
      arm.rotation.x = MathUtils.damp(arm.rotation.x, reach, 10, delta)
    })
  })
  const handCards = in_hand && !folded
  return (
    <group position={p}>
      <Chair position={[0, 0, 0]} rotation={facing} />
      <group ref={body} rotation-y={facing} scale={folded || !in_hand ? 0.94 : 1}>
        <Box p={[0, 0.83, 0]} size={[0.68, 0.65, 0.44]} color={accents[id]} />
        <Box p={[0, 1.12, 0.226]} size={[0.23, 0.14, 0.026]} color="#e0c8a1" />
        <mesh ref={head} position={[0, 1.48, 0.01]}>
          <boxGeometry args={[0.53, 0.53, 0.48]} />
          <meshStandardMaterial color={skins[id]} roughness={0.78} />
        </mesh>
        <Box p={[0, 1.77, -0.015]} size={[0.56, 0.13, 0.52]} color={hair[id]} />
        <Box p={[-0.105, 1.5, 0.258]} size={[0.056, 0.043, 0.025]} color="#28212a" />
        <Box p={[0.105, 1.5, 0.258]} size={[0.056, 0.043, 0.025]} color="#28212a" />
        <Box p={[0, 1.37, 0.258]} size={[won && state.result ? 0.16 : 0.105, 0.023, 0.024]} color="#52313b" />
        {[-1, 1].map((side, i) => (
          <group key={side} ref={(g) => void (arms.current[i] = g)} position={[side * 0.43, 0.89, 0.15]}>
            <Box p={[0, 0, 0.2]} size={[0.19, 0.28, 0.51]} color={accents[id]} />
            <Box p={[0, -0.02, 0.49]} size={[0.19, 0.19, 0.16]} color={skins[id]} />
          </group>
        ))}
      </group>
      <Html portal={labels} position={[0, 2.02, 0]} center zIndexRange={[2, 1]} style={{ pointerEvents: 'none' }}>
        <div
          data-table-side={p[0] < -2.5 ? 'left' : p[0] > 2.5 ? 'right' : undefined}
          className={`seat ${active ? 'active' : ''} ${folded || !in_hand ? 'dim' : ''} ${won && state.result ? 'won' : ''}`}
        >
          {message && (
            <div className="bubble">
              {message.to !== null && message.to !== 0 && (
                <span className="to">@{state.players[message.to]?.name} </span>
              )}
              {message.text}
            </div>
          )}
          <div className="seat-name">
            <span style={{ background: accents[id] }} />
            {name}
            {dealer && <i title="Dealer">D</i>}
          </div>
          <div className="seat-chips">
            {stack} chips{bet > 0 && ` · ${bet} bet`}
          </div>
          {rank && <div className="seat-rank">{rank}</div>}
          {thinking && (
            <div className="thinking">
              Thinking<span className="dots" />
            </div>
          )}
          {!in_hand && <div className="seat-rank">Out</div>}
          {in_hand && folded && state.phase !== 'showdown' && <div className="seat-rank">Folded</div>}
        </div>
      </Html>
      {handCards &&
        !player.cards.length &&
        [0, 1].map((i) => {
          // Local to the seat: a little way toward the table centre, side by side.
          const d = Math.hypot(p[0], p[2])
          const [dx, dz] = [-p[0] / d, -p[2] / d]
          const off = (i - 0.5) * 0.2
          return (
            <PlayingCard
              key={i}
              facedown
              scale={0.62}
              rotation={facing}
              p={[dx * 1.15 + dz * off, 1.112, dz * 1.15 - dx * off]}
            />
          )
        })}
    </group>
  )
}

function Chips({ position, count, color }: { position: Vec; count: number; color: string }) {
  if (!count) return null
  return (
    <group position={position}>
      {Array.from({ length: Math.min(9, 2 + Math.floor(Math.log2(1 + count / 25))) }, (_, i) => (
        <group key={i} position={[0, i * 0.036, 0]}>
          <mesh>
            <cylinderGeometry args={[0.095, 0.095, 0.032, 16]} />
            <meshStandardMaterial color={color} />
          </mesh>
          <mesh position-y={0.017} rotation-x={-Math.PI / 2}>
            <ringGeometry args={[0.059, 0.073, 16]} />
            <meshStandardMaterial color="#f0d4a7" />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// --- first-person arms --------------------------------------------------------
type Pose = [Vec, Vec] // left hand, right hand (world positions)
const REST: Pose = [
  [-0.55, 1.17, 1.92],
  [0.55, 1.17, 1.92],
]
const STACK: Vec = [-0.85, 1.2, 1.5]
const BET: Vec = [0.17, 1.17, 1.0]
const CARDS: Vec = [0, 1.14, 1.42]
// Keyframes: [time 0..1, left, right]
const MOTIONS: Record<string, [number, Vec, Vec][]> = {
  call: [
    [0, REST[0], REST[1]],
    [0.3, STACK, REST[1]],
    [0.62, BET, REST[1]],
    [1, REST[0], REST[1]],
  ],
  raise: [
    [0, REST[0], REST[1]],
    [0.28, STACK, [0.4, 1.2, 1.55]],
    [0.6, [0.02, 1.17, 0.95], [0.32, 1.17, 0.95]],
    [1, REST[0], REST[1]],
  ],
  check: [
    [0, REST[0], REST[1]],
    [0.2, REST[0], [0.3, 1.32, 1.7]],
    [0.35, REST[0], [0.3, 1.13, 1.7]],
    [0.5, REST[0], [0.3, 1.3, 1.7]],
    [0.65, REST[0], [0.3, 1.13, 1.7]],
    [1, REST[0], REST[1]],
  ],
  fold: [
    [0, REST[0], REST[1]],
    [0.3, REST[0], [0.06, 1.15, 1.48]],
    [0.6, REST[0], [0, 1.15, 0.75]],
    [1, REST[0], REST[1]],
  ],
  show: [
    [0, REST[0], REST[1]],
    [0.3, [-0.15, 1.15, 1.45], [0.15, 1.15, 1.45]],
    [0.6, [-0.15, 1.42, 1.35], [0.15, 1.42, 1.35]],
    [1, REST[0], REST[1]],
  ],
}

function sample(frames: [number, Vec, Vec][], t: number): Pose {
  for (let i = 1; i < frames.length; i++) {
    if (t <= frames[i][0]) {
      const [t0, l0, r0] = frames[i - 1]
      const [t1, l1, r1] = frames[i]
      const k = MathUtils.smoothstep((t - t0) / (t1 - t0), 0, 1)
      const mix = (a: Vec, b: Vec): Vec => [
        MathUtils.lerp(a[0], b[0], k),
        MathUtils.lerp(a[1], b[1], k),
        MathUtils.lerp(a[2], b[2], k),
      ]
      return [mix(l0, l1), mix(r0, r1)]
    }
  }
  return REST
}

function Arm({
  shoulder,
  hand,
  chip,
  side,
}: {
  shoulder: Vec
  hand: RefObject<Vector3>
  chip?: RefObject<boolean>
  side: number
}) {
  const arm = useRef<Group>(null)
  const sleeve = useRef<Mesh>(null)
  const palm = useRef<Group>(null)
  const token = useRef<Mesh>(null)
  const origin = useMemo(() => new Vector3(...shoulder), [shoulder])
  useFrame(() => {
    if (!arm.current || !sleeve.current || !palm.current || !hand.current) return
    const length = origin.distanceTo(hand.current)
    arm.current.lookAt(hand.current)
    sleeve.current.scale.z = length
    sleeve.current.position.z = length / 2
    // The hand stays flat and points across the table, whatever the arm's angle.
    palm.current.position.copy(hand.current)
    if (token.current) token.current.visible = Boolean(chip?.current)
  })
  return (
    <>
      <group ref={arm} position={shoulder}>
        <mesh ref={sleeve}>
          <boxGeometry args={[0.15, 0.12, 1]} />
          <meshStandardMaterial color="#3d4f66" roughness={0.85} />
        </mesh>
      </group>
      <group ref={palm} rotation-y={side * 0.18} scale={1.35}>
        <mesh position={[0, 0.01, 0.02]}>
          <boxGeometry args={[0.17, 0.12, 0.05]} />
          <meshStandardMaterial color="#d8cfc0" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0, -0.1]}>
          <boxGeometry args={[0.16, 0.07, 0.2]} />
          <meshStandardMaterial color={skins[0]} roughness={0.8} />
        </mesh>
        <mesh position={[side * 0.1, 0.005, -0.08]}>
          <boxGeometry args={[0.045, 0.05, 0.11]} />
          <meshStandardMaterial color={skins[0]} roughness={0.8} />
        </mesh>
        <mesh ref={token} position={[0, -0.05, -0.12]}>
          <cylinderGeometry args={[0.085, 0.085, 0.045, 14]} />
          <meshStandardMaterial color={accents[0]} />
        </mesh>
      </group>
    </>
  )
}

function PlayerArms({ state }: { state: State }) {
  const moment = useLatestAction(state, 0)
  const showing = state.result && state.result.hands.some((h) => h.seat === 0) && state.players[0].cards.length
  const [show, setShow] = useState<number | null>(null)
  const shownKey = showing ? `${state.hand}` : ''
  const seenShow = useRef(shownKey)
  useEffect(() => {
    if (shownKey && shownKey !== seenShow.current) setShow(performance.now())
    seenShow.current = shownKey
  }, [shownKey])
  const left = useRef(new Vector3(...REST[0]))
  const right = useRef(new Vector3(...REST[1]))
  const chip = useRef(false)
  useFrame(({ clock }, delta) => {
    const now = performance.now()
    let pose: Pose = REST
    chip.current = false
    const motion = show !== null && now - show < 1300 ? 'show' : moment ? moment.action : null
    const started = motion === 'show' ? show! : moment?.at ?? 0
    const duration = motion === 'show' ? 1300 : motion === 'check' ? 900 : 1150
    const t = (now - started) / duration
    if (motion && t < 1) {
      pose = sample(MOTIONS[motion], t)
      chip.current = (motion === 'call' || motion === 'raise') && t > 0.28 && t < 0.66
    }
    const bob = Math.sin(clock.elapsedTime * 1.3) * 0.006
    left.current.lerp(new Vector3(pose[0][0], pose[0][1] + bob, pose[0][2]), 1 - Math.exp(-14 * delta))
    right.current.lerp(new Vector3(pose[1][0], pose[1][1] + bob, pose[1][2]), 1 - Math.exp(-14 * delta))
  })
  return (
    <>
      {/* Shoulders sit just below and beside the camera, out of frame, so only
          forearms and hands reach into view. */}
      <Arm shoulder={[-0.62, 2.0, 4.35]} hand={left} chip={chip} side={1} />
      <Arm shoulder={[0.62, 2.0, 4.35]} hand={right} side={-1} />
    </>
  )
}

// --- table -----------------------------------------------------------------------
function PokerTable({ state, labels }: { state: State | null; labels: RefObject<HTMLDivElement> | null }) {
  const me = state?.players[0]
  return (
    <>
      <mesh position={[0, 0.94, 0]} scale={[1.62, 1, 1]}>
        <cylinderGeometry args={[1.71, 1.71, 0.24, 80]} />
        <meshStandardMaterial color="#442937" />
      </mesh>
      <mesh position={[0, 1.075, 0]} scale={[1.62, 1, 1]}>
        <cylinderGeometry args={[1.57, 1.57, 0.045, 80]} />
        <meshStandardMaterial color="#2b6657" />
      </mesh>
      <mesh position={[0, 1.101, 0]} scale={[1.62, 1, 1]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[1.48, 1.49, 80]} />
        <meshBasicMaterial color="#659683" />
      </mesh>
      {[-1.45, 1.45].map((x) => (
        <Box key={x} p={[x, 0.48, 0]} size={[0.25, 0.93, 0.52]} color="#422738" />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <PlayingCard key={i} card={state?.board[i]} p={[(i - 2) * 0.53, 1.109, 0.05]} />
      ))}
      {state && labels && (
        <Html portal={labels} position={[0, 1.12, 0.78]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
          <div className="pot" role="status">
            <span>{state.runout ? 'Running it out' : phases[state.phase]}</span>
            <strong>
              {state.pot} <small>POT</small>
            </strong>
          </div>
        </Html>
      )}
      {state?.players.map((player) => {
        const p = positionFor(player.id, state.players.length)
        const mine = player.id === 0
        return (
          <group key={player.id}>
            <Chips
              position={[mine ? -0.85 : p[0] * 0.74 - 0.35, 1.12, p[2] * 0.49]}
              count={player.stack}
              color={accents[player.id]}
            />
            <Chips position={[p[0] * 0.42 + 0.17, 1.12, p[2] * 0.33]} count={player.bet} color={accents[player.id]} />
            {(mine && me?.folded ? [] : player.cards).map((card, i) => (
              <PlayingCard
                key={card}
                card={card}
                p={mine ? [(i - 0.5) * 0.49, 1.115, 1.38] : [p[0] * 0.57 + (i - 0.5) * 0.49, 1.115, p[2] * 0.46]}
              />
            ))}
            {mine && me?.folded && me.cards.length > 0 && state.phase !== 'showdown' && (
              <>
                <PlayingCard facedown p={[-0.08, 1.112, 0.75]} scale={0.8} rotation={0.4} />
                <PlayingCard facedown p={[0.05, 1.114, 0.72]} scale={0.8} rotation={-0.2} />
              </>
            )}
          </group>
        )
      })}
    </>
  )
}

function View({ look }: { look: { current: { x: number; y: number } } }) {
  useFrame(({ camera, size }, delta) => {
    const narrow = size.width < 650
    camera.position.set(
      MathUtils.damp(camera.position.x, look.current.x, 5, delta),
      MathUtils.damp(camera.position.y, (narrow ? 3.6 : 3.05) + look.current.y, 5, delta),
      MathUtils.damp(camera.position.z, narrow ? 6.7 : 5.05, 5, delta),
    )
    if (camera instanceof PerspectiveCamera) {
      const fov = Math.max(
        42,
        MathUtils.radToDeg(2 * Math.atan((Math.tan(Math.PI / 6) * size.height) / size.width)),
      )
      if (camera.fov !== fov) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
    }
    camera.lookAt(look.current.x * 0.32, 1.15, -0.48)
  })
  return null
}

export function Room({
  state,
  bubbles,
  reset,
}: {
  state: State | null
  bubbles: Record<number, TableMessage>
  reset: number
}) {
  const [labelLayer, setLabelLayer] = useState<HTMLDivElement | null>(null)
  const labels = useMemo(() => labelLayer && { current: labelLayer }, [labelLayer])
  const look = useRef({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    look.current = { x: 0, y: 0 }
  }, [reset])
  const total = state?.players.length ?? 4
  // Whom each opponent is looking at: whoever they address, or whoever addressed them.
  const looks = useMemo(() => {
    const map: Record<number, Vec | null> = {}
    for (const message of Object.values(bubbles)) {
      if (message.seat) {
        map[message.seat] =
          message.to === null || message.to === 0 ? humanSeat : positionFor(message.to, total)
      }
      if (message.to && !(message.to in map)) {
        map[message.to] = message.seat === 0 ? humanSeat : positionFor(message.seat, total)
      }
    }
    return map
  }, [bubbles, total])
  return (
    <div
      className="room"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        look.current = {
          x: MathUtils.clamp(look.current.x - (e.clientX - drag.current.x) * 0.01, -0.85, 0.85),
          y: MathUtils.clamp(look.current.y + (e.clientY - drag.current.y) * 0.01, -0.37, 0.5),
        }
        drag.current = { x: e.clientX, y: e.clientY }
      }}
      onLostPointerCapture={() => {
        drag.current = null
      }}
    >
      <Canvas dpr={[1, 1.6]} camera={{ position: [0, 3.05, 5.05], fov: 42 }}>
        <color attach="background" args={['#201824']} />
        <fog attach="fog" args={['#241a28', 9, 22]} />
        <ambientLight intensity={1.1} color="#e4c1c5" />
        <directionalLight position={[2.5, 6, 2]} intensity={2.3} color="#ffe3b6" />
        <directionalLight position={[-5, 3, -5]} intensity={1.1} color="#8b9bd9" />
        <Box p={[0, -0.09, 0]} size={[22, 0.15, 22]} color="#2d2835" />
        <Box p={[0, 2.5, -5.4]} size={[22, 5, 0.14]} color="#392737" />
        <Box p={[0, 0.77, -5.29]} size={[22, 1.52, 0.12]} color="#493044" />
        <Box p={[0, 1.57, -5.19]} size={[22, 0.035, 0.09]} color="#997151" />
        {[-7, 7].map((x) => (
          <Box key={x} p={[x, 2.5, 0]} size={[0.14, 5, 14]} color="#332737" />
        ))}
        {[-3.9, 0, 3.9].map((x) => (
          <group key={x} position={[x, 2.82, -5.17]}>
            <Box p={[0, 0, 0]} size={[0.14, 1.02, 0.08]} color="#6a473f" />
            <mesh position={[0, 0.02, 0.07]}>
              <boxGeometry args={[0.06, 0.76, 0.05]} />
              <meshBasicMaterial color="#ebba7e" />
            </mesh>
          </group>
        ))}
        <PokerTable state={state} labels={labels} />
        {state && <PlayerArms state={state} />}
        {labels &&
          state?.players.slice(1).map((player) => (
            <Character
              key={player.id}
              p={positionFor(player.id, state.players.length)}
              player={player}
              state={state}
              labels={labels}
              active={state.actor === player.id}
              thinking={state.thinking === player.id}
              dealer={state.button === player.id}
              message={bubbles[player.id]}
              look={looks[player.id] ?? null}
              rank={state.result?.hands.find((h) => h.seat === player.id)?.rank}
            />
          ))}
        <View look={look} />
      </Canvas>
      <div className="labels" ref={setLabelLayer} />
      {state && state.board.length > 0 && (
        <span className="sr-only" role="status">
          Board {state.board.map((card) => cardRank(card) + suits[card[1]]).join(', ')}
        </span>
      )}
    </div>
  )
}
