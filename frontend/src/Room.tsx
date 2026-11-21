import { Canvas, useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  CanvasTexture,
  Group,
  MathUtils,
  PerspectiveCamera,
  SRGBColorSpace,
} from 'three'
import {
  cardRank,
  phases,
  suits,
  type Player,
  type State,
  type TableMessage,
} from './game'

type Vec = [number, number, number]
const accents = [
  '#d8b276',
  '#557e93',
  '#aa576b',
  '#bd864d',
  '#669174',
  '#8b71aa',
]

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

function Character({
  p,
  player,
  active,
  thinking,
  dealer,
  message,
  labels,
}: {
  p: Vec
  player: Player
  active: boolean
  thinking: boolean
  dealer: boolean
  labels: RefObject<HTMLDivElement>
  message?: TableMessage
}) {
  const { id, name, stack, bet, folded, in_hand } = player
  const body = useRef<Group>(null)
  const facing = Math.atan2(-p[0], -p[2])
  const speechFacing = Math.atan2(-p[0], 5 - p[2])
  const skin = ['#97674d', '#c59879', '#a47154', '#c08e6f', '#956341'][id - 1]
  useFrame(({ clock }, delta) => {
    if (!body.current) return
    body.current.rotation.y = MathUtils.damp(
      body.current.rotation.y,
      message ? speechFacing : facing,
      5,
      delta,
    )
    body.current.position.y =
      active || message ? Math.sin(clock.elapsedTime * 3.6) * 0.018 : 0
  })
  return (
    <group position={p}>
      <Chair position={[0, 0, 0]} rotation={facing} />
      <group
        ref={body}
        rotation-y={facing}
        scale={folded || !in_hand ? 0.94 : 1}
      >
        <Box p={[0, 0.83, 0]} size={[0.68, 0.65, 0.44]} color={accents[id]} />
        <Box p={[0, 1.12, 0.226]} size={[0.23, 0.14, 0.026]} color="#e0c8a1" />
        <Box p={[0, 1.48, 0.01]} size={[0.53, 0.53, 0.48]} color={skin} />
        <Box
          p={[0, 1.77, -0.015]}
          size={[0.56, 0.13, 0.52]}
          color={
            ['#26202a', '#542e36', '#3c282b', '#332a30', '#332530'][id - 1]
          }
        />
        <Box
          p={[-0.105, 1.5, 0.258]}
          size={[0.056, 0.043, 0.025]}
          color="#28212a"
        />
        <Box
          p={[0.105, 1.5, 0.258]}
          size={[0.056, 0.043, 0.025]}
          color="#28212a"
        />
        <Box
          p={[0, 1.37, 0.258]}
          size={[0.105, 0.023, 0.024]}
          color="#52313b"
        />
        {[-1, 1].map((side) => (
          <group
            key={side}
            position={[side * 0.43, 0.89, 0.15]}
            rotation-x={active ? -0.33 : -0.15}
          >
            <Box p={[0, 0, 0]} size={[0.19, 0.28, 0.51]} color={accents[id]} />
            <Box p={[0, -0.02, 0.29]} size={[0.19, 0.19, 0.16]} color={skin} />
          </group>
        ))}
      </group>
      <Html
        portal={labels}
        position={[0, 2.02, 0]}
        center
        zIndexRange={[2, 1]}
        style={{ pointerEvents: 'none' }}
      >
        <div
          data-table-side={
            p[0] < -2.5 ? 'left' : p[0] > 2.5 ? 'right' : undefined
          }
          className={`seat ${active ? 'active' : ''} ${folded || !in_hand ? 'dim' : ''}`}
        >
          {message && <div className="bubble">{message.text}</div>}
          <div className="seat-name">
            <span style={{ background: accents[id] }} />
            {name}
            {dealer && <i title="Dealer">D</i>}
          </div>
          <div className="seat-chips">
            {stack} chips{bet > 0 && ` · ${bet} bet`}
          </div>
          {thinking && <div className="thinking">Thinking…</div>}
        </div>
      </Html>
    </group>
  )
}

function Chips({
  position,
  count,
  color,
}: {
  position: Vec
  count: number
  color: string
}) {
  if (!count) return null
  return (
    <group position={position}>
      {Array.from(
        { length: Math.min(9, 2 + Math.floor(count / 80)) },
        (_, i) => (
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
        ),
      )}
    </group>
  )
}

function PlayingCard({ card, p }: { card?: string; p: Vec }) {
  const ref = useRef<Group>(null)
  const texture = useMemo(() => {
    if (!card) return null
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
    const surface = new CanvasTexture(canvas)
    surface.colorSpace = SRGBColorSpace
    return surface
  }, [card])
  useEffect(() => () => texture?.dispose(), [texture])
  useEffect(() => {
    if (ref.current) ref.current.position.y = p[1] + (card ? 0.16 : 0)
  }, [card, p[1]])
  useFrame((_, delta) => {
    if (ref.current)
      ref.current.position.y = MathUtils.damp(
        ref.current.position.y,
        p[1],
        9,
        delta,
      )
  })
  return (
    <group ref={ref} position={p}>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.46, 0.66]} />
        <meshBasicMaterial
          map={texture}
          color={texture ? '#ffffff' : '#285c53'}
        />
      </mesh>
    </group>
  )
}

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

function PokerTable({ state }: { state: State | null }) {
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
      <mesh
        position={[0, 1.101, 0]}
        scale={[1.62, 1, 1]}
        rotation-x={-Math.PI / 2}
      >
        <ringGeometry args={[1.48, 1.49, 80]} />
        <meshBasicMaterial color="#659683" />
      </mesh>
      {[-1.45, 1.45].map((x) => (
        <Box
          key={x}
          p={[x, 0.48, 0]}
          size={[0.25, 0.93, 0.52]}
          color="#422738"
        />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <PlayingCard
          key={i}
          card={state?.board[i]}
          p={[(i - 2) * 0.53, 1.109, 0.05]}
        />
      ))}
      {state?.players.map((player) => {
        const p = positionFor(player.id, state.players.length)
        return (
          <group key={player.id}>
            <Chips
              position={[
                player.id === 0 ? -0.85 : p[0] * 0.74 - 0.35,
                1.12,
                p[2] * 0.49,
              ]}
              count={player.stack}
              color={accents[player.id]}
            />
            <Chips
              position={[p[0] * 0.42 + 0.17, 1.12, p[2] * 0.33]}
              count={player.bet}
              color={accents[player.id]}
            />
            {player.cards.map((card, i) => (
              <PlayingCard
                key={i}
                card={card}
                p={[p[0] * 0.57 + (i - 0.5) * 0.49, 1.115, p[2] * 0.46]}
              />
            ))}
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
      MathUtils.damp(
        camera.position.y,
        (narrow ? 3.6 : 3.05) + look.current.y,
        5,
        delta,
      ),
      MathUtils.damp(camera.position.z, narrow ? 6.7 : 5.05, 5, delta),
    )
    if (camera instanceof PerspectiveCamera) {
      const fov = Math.max(
        42,
        MathUtils.radToDeg(
          2 * Math.atan((Math.tan(Math.PI / 6) * size.height) / size.width),
        ),
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
  message,
  reset,
}: {
  state: State | null
  message?: TableMessage
  reset: number
}) {
  const [labelLayer, setLabelLayer] = useState<HTMLDivElement | null>(null)
  const labels = useMemo(
    () => labelLayer && { current: labelLayer },
    [labelLayer],
  )
  const look = useRef({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    look.current = { x: 0, y: 0 }
  }, [reset])
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
          x: MathUtils.clamp(
            look.current.x - (e.clientX - drag.current.x) * 0.01,
            -0.85,
            0.85,
          ),
          y: MathUtils.clamp(
            look.current.y + (e.clientY - drag.current.y) * 0.01,
            -0.37,
            0.5,
          ),
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
        <directionalLight
          position={[2.5, 6, 2]}
          intensity={2.3}
          color="#ffe3b6"
        />
        <directionalLight
          position={[-5, 3, -5]}
          intensity={1.1}
          color="#8b9bd9"
        />
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
        <PokerTable state={state} />
        {labels &&
          state?.players
            .slice(1)
            .map((player) => (
              <Character
                key={player.id}
                p={positionFor(player.id, state.players.length)}
                player={player}
                labels={labels}
                active={state.actor === player.id}
                thinking={state.thinking === player.id}
                dealer={state.button === player.id}
                message={message?.seat === player.id ? message : undefined}
              />
            ))}
        <View look={look} />
      </Canvas>
      <div className="labels" ref={setLabelLayer} />
      {state && (
        <div className="pot" role="status">
          <span>{phases[state.phase]}</span>
          {state.board.length > 0 && (
            <span className="sr-only">
              Board{' '}
              {state.board
                .map((card) => cardRank(card) + suits[card[1]])
                .join(', ')}
            </span>
          )}
          <strong>
            {state.pot} <small>POT</small>
          </strong>
        </div>
      )}
    </div>
  )
}
