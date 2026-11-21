import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  api,
  cardRank,
  saveGame,
  suits,
  useTable,
  type Action,
  type Pace,
  type Settings,
  type State,
  type TableMessage,
} from './game'
import { Lobby } from './Lobby'
import { Thoughts, Tracker } from './Panels'
import { Room } from './Room'
import { useSpeech } from './speech'
import './style.css'

const storageKey = 'last-table-session'
const readSession = () => {
  try {
    return sessionStorage.getItem(storageKey)
  } catch {
    return null
  }
}
const writeSession = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(storageKey, id)
    else sessionStorage.removeItem(storageKey)
  } catch {
    /* ignore */
  }
}

function useConnection(gameId: string | null, lost: (message: string) => void) {
  const { state, accept, clear } = useTable()
  const [connection, setConnection] = useState<'joining' | 'live' | 'retrying'>('joining')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!gameId) {
      clear()
      return
    }
    let closed = false
    let socket: WebSocket | undefined
    let timer: ReturnType<typeof setTimeout>
    setConnection('joining')
    function retry() {
      if (!closed) {
        setConnection('retrying')
        timer = setTimeout(connect, 1500)
      }
    }
    async function connect() {
      try {
        const initial = await api('/' + gameId)
        if (closed) return
        accept(initial)
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
        socket = new WebSocket(`${protocol}//${location.host}/ws/games/${gameId}`)
        socket.onopen = () => {
          setConnection('live')
          setError('')
        }
        socket.onmessage = (e) => {
          if (!closed) accept(JSON.parse(e.data).state)
        }
        socket.onclose = (e) => {
          if (e.code === 4404) lost('That table has closed — the server was restarted.')
          else retry()
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'Table session expired') {
          lost('That table has closed — the server was restarted.')
          return
        }
        retry()
      }
    }
    void connect()
    return () => {
      closed = true
      clearTimeout(timer)
      if (socket) {
        socket.onclose = null
        socket.close()
      }
    }
  }, [gameId, accept, clear, lost])
  const submit = useCallback(
    async (path: string, payload: object) => {
      const current = useTable.getState().state
      if (!current) return false
      try {
        setError('')
        accept(await api(`/${current.id}/${path}`, payload))
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not reach the table.')
        return false
      }
    },
    [accept],
  )
  return { state: gameId ? state : null, connection, error, submit }
}

type IconName = 'mic' | 'mute' | 'sound' | 'camera' | 'restart' | 'send' | 'brain' | 'chart' | 'exit'
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    mic: 'M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zm-3 6v1a6 6 0 0 0 12 0v-1m-6 7v4m-4 0h8',
    mute: 'M3 9v6h4l5 4V5L7 9zm13 1 5 5m0-5-5 5',
    sound: 'M3 9v6h4l5 4V5L7 9zm13 0a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12',
    camera: 'M3 8h4l2-3h6l2 3h4v12H3zm13 6a4 4 0 1 0-8 0 4 4 0 0 0 8 0z',
    restart: 'M4 11a8 8 0 1 1 2 6M4 5v6h6',
    send: 'M4 12h15m-6-6 6 6-6 6',
    brain: 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zm6 0a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1',
    chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
    exit: 'M14 4h5v16h-5M10 8l-4 4 4 4m-4-4h11',
  }
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}

function Cards({ cards, folded }: { cards: string[]; folded?: boolean }) {
  return (
    <div className={`pocket ${folded ? 'folded' : ''}`}>
      {[0, 1].map((i) => {
        const card = cards[i]
        return (
          <div key={i} className={`card ${card && 'hd'.includes(card[1]) ? 'red' : ''}`}>
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
  state: State
  disabled: boolean
  play: (action: Action, amount?: number) => void
}) {
  const legal = state.legal
  const [chosen, setChosen] = useState<number>()
  const range = legal.raise
  const value = range ? Math.min(range.max, Math.max(range.min, chosen ?? range.min)) : 0
  if (!Object.keys(legal).length) return null
  const pot = state.pot + (legal.call?.amount ?? 0)
  const presets = range
    ? [
        ['½ pot', Math.round(state.players[0].bet + (legal.call?.amount ?? 0) + pot / 2)],
        ['Pot', state.players[0].bet + (legal.call?.amount ?? 0) + pot],
        ['All in', range.max],
      ].filter(([, v]) => (v as number) >= range.min && (v as number) <= range.max)
    : []
  return (
    <div className="actions">
      {range && (
        <div className="raise-size">
          <label>
            <span>
              Raise to <strong>{value}</strong>
            </span>
            <input type="range" aria-label="Raise amount" min={range.min} max={range.max} value={value}
              step={state.blinds[0]} disabled={disabled || range.min === range.max}
              onChange={(e) => setChosen(Number(e.target.value))} />
          </label>
          <div className="presets">
            {presets.map(([label, amount]) => (
              <button key={label} type="button" disabled={disabled} onClick={() => setChosen(amount as number)}>
                {label}
              </button>
            ))}
          </div>
        </div>
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
          <button className="primary" disabled={disabled} onClick={() => play('raise', value)}>
            {value === range.max ? 'All in' : 'Raise'}
          </button>
        )}
      </div>
    </div>
  )
}

function useBubbles(state: State | null) {
  const [bubbles, setBubbles] = useState<Record<number, TableMessage>>({})
  const seen = useRef(0)
  const id = state?.id
  useEffect(() => {
    seen.current = state?.messages.at(-1)?.id ?? 0
    setBubbles({})
    // Only messages that arrive after joining become bubbles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  const latest = state?.messages.at(-1)?.id ?? 0
  useEffect(() => {
    if (!state) return
    if (latest < seen.current) seen.current = 0 // table restarted
    const fresh = state.messages.filter((m) => m.id > seen.current && m.seat !== 0)
    seen.current = Math.max(seen.current, latest)
    if (!fresh.length) return
    setBubbles((current) => {
      const next = { ...current }
      for (const m of fresh) next[m.seat] = m
      return next
    })
    const timers = fresh.map((m) =>
      setTimeout(
        () =>
          setBubbles((current) => {
            if (current[m.seat]?.id !== m.id) return current
            const next = { ...current }
            delete next[m.seat]
            return next
          }),
        Math.min(9000, 3800 + m.text.length * 45),
      ),
    )
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest])
  return bubbles
}

function Table({ gameId, leave }: { gameId: string; leave: (message?: string) => void }) {
  const lost = useCallback((message: string) => leave(message), [leave])
  const { state, connection, submit, error } = useConnection(gameId, lost)
  const [reset, setReset] = useState(0)
  const [muted, mute] = useState(true)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<'thoughts' | 'tracker' | null>(null)
  const bubbles = useBubbles(state)
  const spoken = useRef(0)
  const latest = state?.messages.at(-1)
  const historyLength = state?.history.length
  useEffect(() => {
    if (state) saveGame(state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.id, historyLength, state?.match_over])
  useEffect(() => {
    if (!latest || latest.id <= spoken.current) return
    spoken.current = latest.id
    if (!muted && latest.seat && 'speechSynthesis' in window) {
      const line = new SpeechSynthesisUtterance(latest.text)
      line.rate = 0.98
      line.pitch = [1, 0.9, 1.15, 1.1, 0.8, 1.02][latest.seat] ?? 1
      window.speechSynthesis.speak(line) // queued, so overlapping replies are not cut off
    }
  }, [latest, muted])
  useEffect(() => {
    if (muted && 'speechSynthesis' in window) window.speechSynthesis.cancel()
  }, [muted])
  const send = async (message: string) => Boolean(message.trim()) && (await submit('messages', { text: message.trim() }))
  const voice = useSpeech((message) => {
    void send(message)
  })
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
  if (!state)
    return (
      <main className="loading">
        <p>{connection === 'retrying' ? 'Reconnecting to the table…' : 'Taking your seat…'}</p>
        <button onClick={() => leave()}>Back to lobby</button>
      </main>
    )
  const me = state.players[0]
  const result = state.result
  const name = (seat: number) => (seat === 0 ? 'You' : state.players[seat]?.name)
  const summary = result?.payouts
    .map(({ seat, chips }) => {
      const hand = result.hands.find((h) => h.seat === seat)?.rank
      return `${seat === 0 ? 'You win' : name(seat) + ' wins'} ${chips}${hand ? ' · ' + hand : ''}`
    })
    .join(' / ')
  const myRank = result?.hands.find((h) => h.seat === 0)?.rank
  const status = result
    ? state.match_over
      ? me.stack
        ? 'You won the table!'
        : 'You are out of chips'
      : summary || 'Hand complete'
    : state.runout
      ? 'All in — running out the board'
      : state.actor === 0
        ? 'Your turn'
        : state.thinking !== null
          ? `${name(state.thinking)} is thinking…`
          : state.actor !== null
            ? `${name(state.actor)} to act`
            : 'Dealing…'
  const feed = state.messages.slice(-3)
  const won = result?.winners.includes(0)
  return (
    <main>
      <Room state={state} bubbles={bubbles} reset={reset} />
      <header className="top">
        <div className="brand">
          <span className="mark">♠</span>
          <div>
            <h1>The Last Table</h1>
            <p>
              BLINDS {state.blinds[0]}/{state.blinds[1]}
            </p>
          </div>
        </div>
        <div className="tools">
          <span className="hand-number">HAND {String(state.hand).padStart(2, '0')}</span>
          <select
            className="pace"
            aria-label="AI pacing"
            title="AI pacing"
            value={state.settings.pace}
            onChange={(e) => void submit('settings', { pace: e.target.value as Pace })}
          >
            <option value="fast">Brisk</option>
            <option value="normal">Natural</option>
            <option value="slow">Deliberate</option>
          </select>
          <button
            title="Thought logs"
            aria-label="Thought logs"
            aria-pressed={panel === 'thoughts'}
            className={panel === 'thoughts' ? 'on' : ''}
            onClick={() => setPanel(panel === 'thoughts' ? null : 'thoughts')}
          >
            <Icon name="brain" />
          </button>
          <button
            title="Game tracker"
            aria-label="Game tracker"
            aria-pressed={panel === 'tracker'}
            className={panel === 'tracker' ? 'on' : ''}
            onClick={() => setPanel(panel === 'tracker' ? null : 'tracker')}
          >
            <Icon name="chart" />
          </button>
          <button
            title={muted ? 'Enable opponent voices' : 'Mute opponent voices'}
            aria-label={muted ? 'Enable opponent voices' : 'Mute opponent voices'}
            onClick={() => mute(!muted)}
          >
            <Icon name={muted ? 'mute' : 'sound'} />
          </button>
          <button title="Reset camera" aria-label="Reset camera" onClick={() => setReset((n) => n + 1)}>
            <Icon name="camera" />
          </button>
          <button
            title="Restart game"
            aria-label="Restart game"
            disabled={disabled}
            onClick={() => {
              if (window.confirm('Restart this table with the same settings and clear table memory?'))
                void run('restart')
            }}
          >
            <Icon name="restart" />
          </button>
          <button title="Leave table" aria-label="Leave table" onClick={() => leave()}>
            <Icon name="exit" />
          </button>
        </div>
      </header>
      {panel === 'thoughts' && <Thoughts state={state} close={() => setPanel(null)} />}
      {panel === 'tracker' && <Tracker state={state} close={() => setPanel(null)} />}
      <section className="dock">
        <div className="transcript" aria-live="polite">
          {connection === 'retrying' ? (
            <div>Reconnecting to the table…</div>
          ) : error ? (
            <div className="error">{error}</div>
          ) : voice.recording ? (
            <div>{voice.feedback || 'Listening…'}</div>
          ) : voice.feedback && /^(Voice recognition unavailable|No speech detected|Microphone)/.test(voice.feedback) ? (
            <div>{voice.feedback}</div>
          ) : feed.length ? (
            feed.map((m) => (
              <div key={m.id} className={m.id === latest?.id ? 'newest' : ''}>
                <b>{name(m.seat)}</b>
                {m.to !== null && <span className="to"> → {name(m.to)}</span>} {m.text}
              </div>
            ))
          ) : (
            <div>Hold the mic or type to talk to the table — everyone can hear you.</div>
          )}
        </div>
        <div className="playbar">
          <div className="your-seat">
            <Cards cards={me.cards} folded={me.folded && !result} />
            <div>
              <div className="mini-label">YOU {state.button === 0 && '· DEALER'}</div>
              <strong>{me.stack} chips</strong>
              {Boolean(me.bet) && <small>{me.bet} bet</small>}
              {myRank && <small>{myRank}</small>}
            </div>
          </div>
          <div className="turn" aria-live="polite">
            <div className={`turn-status ${state.actor === 0 ? 'yours' : ''}`}>{status}</div>
            {state.match_over && summary && <small>{summary}</small>}
            {!result && state.legal.call && <small>{state.legal.call.amount} to call</small>}
            {result && state.choices.length > 0 && (
              <div className="show-muck">
                <small>{won ? 'Show your winning hand?' : 'Show or muck your cards?'}</small>
                <button disabled={disabled} onClick={() => run('showdown', { choice: 'show' })}>
                  Show
                </button>
                <button disabled={disabled} onClick={() => run('showdown', { choice: 'muck' })}>
                  Muck
                </button>
              </div>
            )}
            {result && result.mucked.includes(0) && <small>You mucked.</small>}
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
            key={state.version}
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
              if (sent) setText((current) => (current === entered ? '' : current))
            })
          }}
        >
          <button
            type="button"
            className={`mic ${voice.recording ? 'recording' : ''}`}
            disabled={!voice.supported || connection !== 'live'}
            aria-label="Hold to talk"
            title={voice.supported ? 'Hold to talk' : 'Speech recognition unavailable in this browser'}
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
            placeholder="Talk to the table, or name someone (“Vega, you're bluffing”)…"
            aria-label="Table message"
          />
          <button aria-label="Send table message" title="Send table message"
            disabled={!text.trim() || connection !== 'live'}>
            <Icon name="send" />
          </button>
        </form>
      </section>
    </main>
  )
}

function App() {
  const [gameId, setGameId] = useState<string | null>(readSession)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const leave = useCallback((message?: string) => {
    writeSession(null)
    setGameId(null)
    setError(message ?? '')
  }, [])
  const join = (id: string) => {
    writeSession(id)
    setError('')
    setGameId(id)
  }
  if (gameId) return <Table key={gameId} gameId={gameId} leave={leave} />
  return (
    <Lobby
      error={error}
      busy={busy}
      start={async (settings: Settings) => {
        setBusy(true)
        try {
          join((await api('', settings)).id)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not reach the table.')
        } finally {
          setBusy(false)
        }
      }}
      resume={async (id) => {
        try {
          await api('/' + id)
          join(id)
          return true
        } catch {
          setError('That table has closed — the server was restarted. Start a new one.')
          return false
        }
      }}
    />
  )
}

createRoot(document.getElementById('root')!).render(<App />)
