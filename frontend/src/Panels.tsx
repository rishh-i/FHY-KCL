import { useState } from 'react'
import { cardText, type State, type ThoughtLog } from './game'

const kinds: Record<ThoughtLog['kind'], string> = {
  decision: 'Decision',
  talk: 'Talk',
  read: 'Read',
  style: 'Style',
  showdown: 'Showdown',
}
const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : '–')
const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

export function Thoughts({ state, close }: { state: State; close: () => void }) {
  const [seat, setSeat] = useState<number | 'all'>('all')
  const [onlyDecisions, setOnlyDecisions] = useState(false)
  const entries = state.logs
    .filter((e) => (seat === 'all' || e.seat === seat) && (!onlyDecisions || e.kind === 'decision'))
    .slice()
    .reverse()
  const hands = [...new Set(entries.map((e) => e.hand))]
  return (
    <aside className="panel" aria-label="AI thought logs">
      <header>
        <h2>Thought logs</h2>
        <button aria-label="Close thought logs" onClick={close}>
          ✕
        </button>
      </header>
      <div className="filters">
        <select
          aria-label="Opponent"
          value={seat}
          onChange={(e) => setSeat(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          <option value="all">All opponents</option>
          {state.players.slice(1).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={onlyDecisions}
            onChange={(e) => setOnlyDecisions(e.target.checked)}
          />{' '}
          Decisions only
        </label>
      </div>
      {state.locked_logs > 0 && (
        <p className="locked">
          🔒 {state.locked_logs} thought{state.locked_logs === 1 ? '' : 's'} from this hand unlock when it
          ends.
        </p>
      )}
      <div className="panel-body">
        {!entries.length && <p className="empty">No reasoning recorded yet.</p>}
        {hands.map((hand) => (
          <section key={hand}>
            <h3>Hand {hand}</h3>
            {entries
              .filter((e) => e.hand === hand)
              .map((e) => (
                <article key={e.id} className={`thought ${e.kind}`}>
                  <div className="thought-head">
                    <b>{state.players[e.seat]?.name}</b>
                    <span className="kind">{kinds[e.kind]}</span>
                    {e.phase && <span className="street">{e.phase}</span>}
                    {e.talk_changed && <span className="swayed">Talk changed this</span>}
                  </div>
                  <div className="thought-title">{e.title}</div>
                  <ul>
                    {e.details.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </article>
              ))}
          </section>
        ))}
      </div>
    </aside>
  )
}

export function Tracker({ state, close }: { state: State; close: () => void }) {
  const bb = state.blinds[1]
  const rows = [...state.stats].sort((a, b) => b.stack - a.stack)
  return (
    <aside className="panel" aria-label="Game tracker">
      <header>
        <h2>This table</h2>
        <button aria-label="Close tracker" onClick={close}>
          ✕
        </button>
      </header>
      <div className="panel-body">
        <p className="muted">
          Blinds {state.blinds[0]}/{bb} · started with {state.settings.stack.toLocaleString()} each ·{' '}
          {state.history.length} hand{state.history.length === 1 ? '' : 's'} complete
        </p>
        <div className="table-scroll">
          <table className="leaders">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Stack</th>
                <th>Net</th>
                <th title="Voluntarily put chips in pre-flop">VPIP</th>
                <th title="Pre-flop raise">PFR</th>
                <th>Won</th>
                <th title="Showdowns won / reached">SD</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.seat} className={row.seat === 0 ? 'me' : ''}>
                  <td>{i + 1}</td>
                  <td>{row.name}</td>
                  <td>{row.stack}</td>
                  <td className={row.net > 0 ? 'up' : row.net < 0 ? 'down' : ''}>
                    {signed(Math.round((row.net / bb) * 10) / 10)} BB
                  </td>
                  <td>{pct(row.vpip, row.hands)}</td>
                  <td>{pct(row.pfr, row.hands)}</td>
                  <td>{row.won}</td>
                  <td>
                    {row.showdowns_won}/{row.showdowns}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Hand history</h3>
        {!state.history.length && <p className="empty">Finished hands appear here.</p>}
        <ol className="history">
          {[...state.history].reverse().map((h) => (
            <li key={h.hand}>
              <div className="history-head">
                <b>Hand {h.hand}</b>
                <span className={h.deltas[0] > 0 ? 'up' : h.deltas[0] < 0 ? 'down' : ''}>
                  {signed(h.deltas[0])}
                </span>
              </div>
              <div className="muted">
                You {h.your_cards.length ? h.your_cards.map(cardText).join(' ') : '—'} · Board{' '}
                {h.board.length ? h.board.map(cardText).join(' ') : 'none'} · Pot {h.pot}
              </div>
              <div>
                {h.winners
                  .map((w) => {
                    const rank = h.hands.find((x) => x.seat === w.seat)?.rank
                    return `${state.players[w.seat]?.name} won ${w.chips}${rank ? ` with ${rank}` : h.showdown ? '' : ' uncontested'}`
                  })
                  .join(' · ')}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  )
}
