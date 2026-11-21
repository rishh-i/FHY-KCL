import { create } from 'zustand'

export type Action = 'fold' | 'check' | 'call' | 'raise'
export type Phase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
export type Pace = 'fast' | 'normal' | 'slow'
export type Chatter = 'quiet' | 'normal' | 'chatty'
export type Player = {
  id: number
  name: string
  stack: number
  bet: number
  folded: boolean
  in_hand: boolean
  cards: string[]
}
export type TableMessage = {
  id: number
  hand: number
  seat: number
  to: number | null
  text: string
}
export type PlayedAction = {
  hand: number
  seat: number
  action: Action
  chips: number
  to: number
  phase: Phase
}
export type Settings = {
  opponents: number
  small_blind: number
  big_blind: number
  stack: number
  pace: Pace
  live_thoughts: boolean
  chatter: Chatter
}
export type SeatStats = {
  seat: number
  name: string
  stack: number
  net: number
  hands: number
  vpip: number
  pfr: number
  won: number
  showdowns: number
  showdowns_won: number
  biggest_pot: number
}
export type HandRecord = {
  hand: number
  board: string[]
  pot: number
  showdown: boolean
  winners: { seat: number; chips: number }[]
  deltas: number[]
  hands: { seat: number; rank: string }[]
  your_cards: string[]
}
export type ThoughtLog = {
  id: number
  seat: number
  hand: number
  phase: string | null
  kind: 'decision' | 'talk' | 'read' | 'style' | 'showdown'
  title: string
  details: string[]
  talk_changed: boolean
}
export type State = {
  id: string
  seq: number
  version: number
  hand: number
  phase: Phase
  actor: number | null
  button: number
  blinds: [number, number]
  thinking: number | null
  board: string[]
  pot: number
  legal: {
    fold?: object
    check?: object
    call?: { amount: number }
    raise?: { min: number; max: number }
  }
  players: Player[]
  messages: TableMessage[]
  match_over: boolean
  runout: boolean
  choices: ('show' | 'muck')[]
  actions: PlayedAction[]
  result: {
    payouts: { seat: number; chips: number }[]
    refunds: { seat: number; chips: number }[]
    hands: { seat: number; rank: string }[]
    mucked: number[]
    winners: number[]
    pot: number
    showdown: boolean
  } | null
  settings: Settings
  stats: SeatStats[]
  history: HandRecord[]
  logs: ThoughtLog[]
  locked_logs: number
}

export const phases: Record<Phase, string> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Hand complete',
}

export const useTable = create<{
  state: State | null
  accept: (next: State) => void
  clear: () => void
}>((set) => ({
  state: null,
  accept: (next) =>
    set(({ state }) => ({
      state: state?.id === next.id && state.seq > next.seq ? state : next,
    })),
  clear: () => set({ state: null }),
}))

export async function api(path: string, body?: object): Promise<State> {
  const response = await fetch(
    '/api/games' + path,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d: { msg?: string }) => d.msg).join(' ')
      : data.detail
    throw new Error(
      typeof detail === 'string' && detail ? detail : 'Could not reach the table.',
    )
  }
  return response.json()
}

export const suits: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
export const cardRank = (card: string) => (card[0] === 'T' ? '10' : card[0])
export const cardText = (card: string) => cardRank(card) + suits[card[1]]

// --- Per-game tracker kept in this browser -----------------------------------
export type GameSummary = {
  id: string
  started: number
  updated: number
  settings: Settings
  hands: number
  net: number
  stack: number
  place: number
  players: number
  wins: number
  biggest_pot: number
  finished: boolean
  closed?: boolean
  standings: { name: string; stack: number; net: number }[]
}
const trackerKey = 'last-table-games'

export function loadGames(): GameSummary[] {
  try {
    const games = JSON.parse(localStorage.getItem(trackerKey) ?? '[]')
    return Array.isArray(games) ? games : []
  } catch {
    return []
  }
}

export function saveGame(state: State) {
  if (!state.history.length) return // nothing to record until a hand completes
  try {
    const games = loadGames()
    const prior = games.find((g) => g.id === state.id)
    const standings = [...state.stats]
      .sort((a, b) => b.stack - a.stack)
      .map(({ name, stack, net }) => ({ name, stack, net }))
    const me = state.stats[0]
    const summary: GameSummary = {
      id: state.id,
      started: prior?.started ?? Date.now(),
      updated: Date.now(),
      settings: state.settings,
      hands: state.history.length,
      net: me.net,
      stack: me.stack,
      place: standings.findIndex((s) => s.name === me.name) + 1,
      players: state.players.length,
      wins: me.won,
      biggest_pot: me.biggest_pot,
      finished: state.match_over,
      standings,
    }
    const next = [summary, ...games.filter((g) => g.id !== state.id)].slice(0, 30)
    localStorage.setItem(trackerKey, JSON.stringify(next))
  } catch {
    // Storage may be unavailable (private mode); the tracker is a convenience.
  }
}

export function markClosed(id: string) {
  try {
    const games = loadGames().map((g) => (g.id === id ? { ...g, closed: true } : g))
    localStorage.setItem(trackerKey, JSON.stringify(games))
  } catch {
    /* ignore */
  }
}

export function forgetGames() {
  try {
    localStorage.removeItem(trackerKey)
  } catch {
    /* ignore */
  }
}
