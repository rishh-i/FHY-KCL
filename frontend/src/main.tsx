import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  api,
  cardRank,
  suits,
  useTable,
  type Action,
  type State,
  type TableMessage,
} from './game'
import { Room } from './Room'
import { useSpeech } from './speech'
import './style.css'

const storageKey = 'last-table-session'

function useSession() {
  const { state, accept } = useTable()
  const [connection, setConnection] = useState<'joining' | 'live' | 'retrying'>(
    'joining',
  )
  const [error, setError] = useState('')
  useEffect(() => {
    let closed = false
    let socket: WebSocket | undefined
    let timer: ReturnType<typeof setTimeout>
    function retry() {
      if (!closed) {
        setConnection('retrying')
        timer = setTimeout(connect, 1500)
      }
    }
    async function connect() {
      try {
        const prior = sessionStorage.getItem(storageKey)
        const initial = prior
          ? await api('/' + prior).catch(async (error) => {
              if (error.message !== 'Table session expired') throw error
              return api('', {})
            })
          : await api('', {})
        if (closed) return
        sessionStorage.setItem(storageKey, initial.id)
        accept(initial)
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
        socket = new WebSocket(
          `${protocol}//${location.host}/ws/games/${initial.id}`,
        )
        socket.onopen = () => {
          setConnection('live')
          setError('')
        }
        socket.onmessage = (e) => {
          if (!closed) accept(JSON.parse(e.data).state)
        }
        socket.onclose = retry
      } catch {
        retry()
      }
    }
    void connect()
    return () => {
      closed = true
      clearTimeout(timer)
      socket?.close()
    }
  }, [accept])
  async function submit(path: string, payload: object) {
    if (!state) return false
    try {
      setError('')
      accept(await api(`/${state.id}/${path}`, payload))
      return true
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not reach the table.',
      )
      return false
    }
  }
  return { state, connection, error, submit }
}

function Icon({
  name,
}: {
  name: 'mic' | 'mute' | 'sound' | 'camera' | 'restart' | 'send'
}) {
  const paths = {
    mic: 'M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zm-3 6v1a6 6 0 0 0 12 0v-1m-6 7v4m-4 0h8',
    mute: 'M3 9v6h4l5 4V5L7 9zm13 1 5 5m0-5-5 5',
    sound: 'M3 9v6h4l5 4V5L7 9zm13 0a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12',
    camera: 'M3 8h4l2-3h6l2 3h4v12H3zm13 6a4 4 0 1 0-8 0 4 4 0 0 0 8 0z',
    restart: 'M4 11a8 8 0 1 1 2 6M4 5v6h6',
    send: 'M4 12h15m-6-6 6 6-6 6',
  }
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}

function Cards({ cards }: { cards: string[] }) {
  return (
    <div className="pocket">
      {[0, 1].map((i) => {
        const card = cards[i]
        return (
          <div
            key={i}
            className={`card ${card && 'hd'.includes(card[1]) ? 'red' : ''}`}
          >
            {card ? (
              <>
                <strong>{cardRank(card)}</strong>
                <span>{suits[card[1]]}</span>
              </>
            ) : (
              <span>◇</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Actions({
  state,
  disabled,
  play,
}: {
  state: State | null
  disabled: boolean
  play: (action: Action, amount?: number) => void
}) {
  const legal = state?.legal
  const [chosen, setChosen] = useState<number>()
  const range = legal?.raise
  const value = range
    ? Math.min(range.max, Math.max(range.min, chosen ?? range.min))
    : 0
  if (!legal || !Object.keys(legal).length) return null
  return (
    <div className="actions">
      {range && (
        <label className="raise-size">
          <span>
            Raise to <strong>{value}</strong>
          </span>
          <input
            type="range"
            aria-label="Raise amount"
            min={range.min}
            max={range.max}
            value={value}
            disabled={disabled || range.min === range.max}
            onChange={(e) => setChosen(Number(e.target.value))}
          />
        </label>
      )}
      <div className="action-buttons">
        {legal.fold && (
          <button disabled={disabled} onClick={() => play('fold')}>
            Fold
          </button>
        )}
        {legal.check && (
          <button disabled={disabled} onClick={() => play('check')}>
            Check
          </button>
        )}
        {legal.call && (
          <button disabled={disabled} onClick={() => play('call')}>
            Call {legal.call.amount}
          </button>
        )}
        {range && (
          <button
            className="primary"
            disabled={disabled}
            onClick={() => play('raise', value)}
          >
            {value === range.max ? 'All in' : 'Raise'}
          </button>
        )}
      </div>
    </div>
  )
}

function App() {
  const { state, connection, submit, error } = useSession()
  const [reset, setReset] = useState(0)
  const [muted, mute] = useState(true)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [bubble, setBubble] = useState<TableMessage>()
  const latest = state?.messages.at(-1)
  const lastHuman = state?.messages.findLast((message) => message.seat === 0)
  const transcript = lastHuman?.hand === state?.hand ? lastHuman : latest
  useEffect(() => {
    if (!latest?.seat) return
    setBubble(latest)
    const timeout = setTimeout(() => setBubble(undefined), 6200)
    return () => {
      clearTimeout(timeout)
      setBubble(undefined)
    }
  }, [latest?.id, state?.id])
  useEffect(() => {
    if (!muted && latest?.seat && 'speechSynthesis' in window) {
      const line = new SpeechSynthesisUtterance(latest.text)
      line.rate = 0.96
      line.pitch = [1, 0.9, 1.1, 0.82, 1.03, 0.97][latest.seat]
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(line)
      return () => window.speechSynthesis.cancel()
    }
  }, [latest?.id, muted, state?.id])
  const send = async (message: string) => {
    if (message.trim() && (await submit('messages', { text: message.trim() })))
      return true
    return false
  }
  const voice = useSpeech((message) => {
    void send(message)
  })
  const me = state?.players[0]
  const disabled = connection !== 'live' || busy
  const run = async (path: string, body: object = {}) => {
    if (!state || busy) return
    setBusy(true)
    try {
      await submit(path, { version: state.version, ...body })
    } finally {
      setBusy(false)
    }
  }
  const result = state?.result
  const summary = result?.payouts
    .map(({ seat, chips }) => {
      const hand = result.hands.find((h) => h.seat === seat)?.rank
      return `${seat === 0 ? 'You win' : state?.players[seat].name + ' wins'} ${chips}${hand ? ' · ' + hand : ''}`
    })
    .join(' / ')
  const status = !state
    ? 'Taking your seat…'
    : result
      ? state.match_over
        ? 'Match complete'
        : summary || 'Hand complete'
      : state.actor === 0
        ? 'Your turn'
        : state.actor !== null
          ? `${state.players[state.actor].name} to act`
          : 'Dealing…'
  return (
    <main>
      <Room state={state} message={bubble} reset={reset} />
      <header className="top">
        <div className="brand">
          <span className="mark">♠</span>
          <div>
            <h1>The Last Table</h1>
            <p>HUMAN VS AI</p>
          </div>
        </div>
        <div className="tools">
          <span className="hand-number">
            {state ? `HAND ${String(state.hand).padStart(2, '0')}` : 'JOINING'}
          </span>
          <button
            title={muted ? 'Enable opponent voices' : 'Mute opponent voices'}
            aria-label={
              muted ? 'Enable opponent voices' : 'Mute opponent voices'
            }
            onClick={() => mute(!muted)}
          >
            <Icon name={muted ? 'mute' : 'sound'} />
          </button>
          <button
            title="Reset camera"
            aria-label="Reset camera"
            onClick={() => setReset((n) => n + 1)}
          >
            <Icon name="camera" />
          </button>
          <button
            title="Restart game"
            aria-label="Restart game"
            disabled={!state || disabled}
            onClick={() => {
              if (window.confirm('Restart the game and clear table memory?'))
                void run('restart')
            }}
          >
            <Icon name="restart" />
          </button>
        </div>
      </header>
      <section className="dock">
        <div className="transcript" aria-live="polite">
          {connection === 'retrying'
            ? 'Reconnecting to the table…'
            : error ||
              (voice.recording ? (
                voice.feedback || 'Listening…'
              ) : voice.feedback &&
                /^(Voice recognition unavailable|No speech detected)/.test(
                  voice.feedback,
                ) ? (
                voice.feedback
              ) : transcript ? (
                <>
                  <b>{state?.players[transcript.seat]?.name}</b>{' '}
                  {transcript.text}
                </>
              ) : (
                'Hold the mic or type to talk to the table.'
              ))}
        </div>
        <div className="playbar">
          <div className="your-seat">
            <Cards cards={me?.cards ?? []} />
            <div>
              <div className="mini-label">
                YOU {state?.button === 0 && '· DEALER'}
              </div>
              <strong>{me?.stack ?? '–'} chips</strong>
              {Boolean(me?.bet) && <small>{me?.bet} bet</small>}
            </div>
          </div>
          <div className="turn" aria-live="polite">
            <div className={`turn-status ${state?.actor === 0 ? 'yours' : ''}`}>
              {status}
            </div>
            {state?.match_over && summary && <small>{summary}</small>}
            {!result && state?.legal.call && (
              <small>{state.legal.call.amount} to call</small>
            )}
            {result && (
              <button
                className="primary"
                onClick={() => run(state.match_over ? 'restart' : 'next')}
                disabled={disabled}
              >
                {state.match_over ? 'Play again' : 'Next hand'}
              </button>
            )}
          </div>
          <Actions
            key={state?.version}
            state={state}
            disabled={disabled}
            play={(action, amount = 0) => {
              void run('actions', { action, amount })
            }}
          />
        </div>
        <form
          className="talk"
          onSubmit={(e) => {
            e.preventDefault()
            const entered = text
            void send(entered).then((sent) => {
              if (sent)
                setText((current) => (current === entered ? '' : current))
            })
          }}
        >
          <button
            type="button"
            className={`mic ${voice.recording ? 'recording' : ''}`}
            disabled={!voice.supported || !state || connection !== 'live'}
            aria-label="Hold to talk"
            title={
              voice.supported
                ? 'Hold to talk'
                : 'Speech recognition unavailable'
            }
            aria-pressed={voice.recording}
            onPointerDown={(e) => {
              if (e.button === 0) {
                e.currentTarget.setPointerCapture(e.pointerId)
                voice.start()
              }
            }}
            onPointerUp={voice.stop}
            onPointerCancel={voice.stop}
            onLostPointerCapture={voice.stop}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault()
                if (!e.repeat) voice.start()
              }
            }}
            onKeyUp={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault()
                voice.stop()
              }
            }}
            onBlur={voice.stop}
          >
            <Icon name="mic" />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={240}
            placeholder="Say something to the table…"
            aria-label="Table message"
          />
          <button
            aria-label="Send table message"
            title="Send table message"
            disabled={!text.trim() || !state || connection !== 'live'}
          >
            <Icon name="send" />
          </button>
        </form>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
