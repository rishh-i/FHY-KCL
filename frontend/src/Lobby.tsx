import { useState } from 'react'
import {
  forgetGames,
  loadGames,
  markClosed,
  type Chatter,
  type GameSummary,
  type Pace,
  type Settings,
} from './game'

const stakes = [
  { label: '1 / 2', small: 1, big: 2, note: 'Micro' },
  { label: '5 / 10', small: 5, big: 10, note: 'Low' },
  { label: '25 / 50', small: 25, big: 50, note: 'Mid' },
  { label: '100 / 200', small: 100, big: 200, note: 'High' },
]
const depths = [
  { bb: 30, note: 'Short — push/fold pressure' },
  { bb: 100, note: 'Standard' },
  { bb: 200, note: 'Deep — more post-flop play' },
]
const paces: { value: Pace; label: string; note: string }[] = [
  { value: 'fast', label: 'Brisk', note: '~1s per decision' },
  { value: 'normal', label: 'Natural', note: '~2s, longer on close spots' },
  { value: 'slow', label: 'Deliberate', note: '~3–5s, room to study' },
]
const chatter: { value: Chatter; label: string }[] = [
  { value: 'quiet', label: 'Quiet' },
  { value: 'normal', label: 'Sociable' },
  { value: 'chatty', label: 'Rowdy' },
]

function Choice<T extends string | number | boolean>({
  name,
  options,
  value,
  onChange,
}: {
  name: string
  options: { value: T; label: string; note?: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="choices" role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <button
          type="button"
          role="radio"
          aria-checked={option.value === value}
          key={String(option.value)}
          className={option.value === value ? 'chosen' : ''}
          onClick={() => onChange(option.value)}
        >
          <strong>{option.label}</strong>
          {option.note && <small>{option.note}</small>}
        </button>
      ))}
    </div>
  )
}

const date = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

function Tracker({
  games,
  resume,
  clear,
}: {
  games: GameSummary[]
  resume: (id: string) => void
  clear: () => void
}) {
  if (!games.some((g) => g.hands > 0))
    return (
      <p className="empty">
        Your finished and in-progress tables will appear here, with results per
        game. Nothing carries over between tables — every game starts fresh.
      </p>
    )
  const played = games.filter((g) => g.hands > 0)
  const best = [...played].sort(
    (a, b) => b.net / b.settings.big_blind - a.net / a.settings.big_blind,
  )[0]
  return (
    <>
      <div className="best">
        Best table: <strong>{signed(Math.round(best.net / best.settings.big_blind))} BB</strong>{' '}
        over {best.hands} hands at {best.settings.small_blind}/{best.settings.big_blind},
        finishing {best.place} of {best.players}.
      </div>
      <div className="table-scroll">
        <table className="games">
          <thead>
            <tr>
              <th>When</th>
              <th>Stakes</th>
              <th>Hands</th>
              <th>Result</th>
              <th>Place</th>
              <th>Biggest pot</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {played.map((game) => {
              const bb = game.settings.big_blind
              return (
                <tr key={game.id}>
                  <td>{date(game.updated)}</td>
                  <td>
                    {game.settings.small_blind}/{bb}
                    <small> · {Math.round(game.settings.stack / bb)} BB · {game.players - 1} AI</small>
                  </td>
                  <td>{game.hands}</td>
                  <td className={game.net > 0 ? 'up' : game.net < 0 ? 'down' : ''}>
                    {signed(game.net)} <small>({signed(Math.round(game.net / bb))} BB)</small>
                  </td>
                  <td>
                    {game.place}/{game.players}
                  </td>
                  <td>{game.biggest_pot || '–'}</td>
                  <td>
                    {game.finished || game.closed ? (
                      <span className="tag">{game.finished ? 'Finished' : 'Closed'}</span>
                    ) : (
                      <button type="button" onClick={() => resume(game.id)}>
                        Resume
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="link" onClick={clear}>
        Clear game history
      </button>
    </>
  )
}

export function Lobby({
  start,
  resume,
  error,
  busy,
}: {
  start: (settings: Settings) => void
  resume: (id: string) => Promise<boolean>
  error: string
  busy: boolean
}) {
  const [stake, setStake] = useState(1)
  const [depth, setDepth] = useState(100)
  const [opponents, setOpponents] = useState(3)
  const [pace, setPace] = useState<Pace>('normal')
  const [talk, setTalk] = useState<Chatter>('normal')
  const [live, setLive] = useState(false)
  const [games, setGames] = useState(loadGames)
  const blinds = stakes[stake]
  return (
    <main className="lobby">
      <section className="lobby-card">
        <header className="lobby-head">
          <span className="mark">♠</span>
          <div>
            <h1>The Last Table</h1>
            <p>Single-player Hold'em training against adaptive AI opponents</p>
          </div>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            start({
              opponents,
              small_blind: blinds.small,
              big_blind: blinds.big,
              stack: blinds.big * depth,
              pace,
              chatter: talk,
              live_thoughts: live,
            })
          }}
        >
          <fieldset>
            <legend>Stakes (blinds)</legend>
            <Choice
              name="Stakes"
              value={stake}
              onChange={setStake}
              options={stakes.map((s, i) => ({ value: i, label: s.label, note: s.note }))}
            />
          </fieldset>
          <fieldset>
            <legend>
              Starting stack <span>{(blinds.big * depth).toLocaleString()} chips each</span>
            </legend>
            <Choice
              name="Starting stack"
              value={depth}
              onChange={setDepth}
              options={depths.map((d) => ({ value: d.bb, label: `${d.bb} BB`, note: d.note }))}
            />
          </fieldset>
          <div className="row">
            <fieldset>
              <legend>Opponents</legend>
              <Choice
                name="Opponents"
                value={opponents}
                onChange={setOpponents}
                options={[3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
              />
            </fieldset>
            <fieldset>
              <legend>Table talk</legend>
              <Choice name="Table talk" value={talk} onChange={setTalk} options={chatter} />
            </fieldset>
          </div>
          <fieldset>
            <legend>AI pacing</legend>
            <Choice name="AI pacing" value={pace} onChange={setPace} options={paces} />
          </fieldset>
          <fieldset>
            <legend>Thought logs</legend>
            <Choice
              name="Thought logs"
              value={live}
              onChange={setLive}
              options={[
                { value: false, label: 'After each hand', note: 'Fair play — reasoning unlocks at showdown' },
                { value: true, label: 'Live', note: 'Study mode — reveals AI cards and reads as they act' },
              ]}
            />
          </fieldset>
          {error && <p className="error">{error}</p>}
          <button className="primary start" disabled={busy}>
            {busy ? 'Opening table…' : 'Take a seat'}
          </button>
        </form>
      </section>
      <section className="lobby-card tracker">
        <h2>Game tracker</h2>
        <Tracker
          games={games}
          resume={async (id) => {
            if (!(await resume(id))) {
              markClosed(id)
              setGames(loadGames())
            }
          }}
          clear={() => {
            if (window.confirm('Clear the list of past games on this device?')) {
              forgetGames()
              setGames([])
            }
          }}
        />
      </section>
    </main>
  )
}
