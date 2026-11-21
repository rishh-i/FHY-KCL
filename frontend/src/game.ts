import { create } from 'zustand'

export type Action = 'fold' | 'check' | 'call' | 'raise'
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
  text: string
}
export type State = {
  id: string
  seq: number
  version: number
  hand: number
  phase: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
  actor: number | null
  button: number
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
  actions: { seat: number; action: Action; chips: number; phase: string }[]
  result: {
    payouts: { seat: number; chips: number }[]
    refunds: { seat: number; chips: number }[]
    hands: { seat: number; rank: string }[]
  } | null
}

export const phases = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Hand complete',
}

export const useTable = create<{
  state: State | null
  accept: (next: State) => void
}>((set) => ({
  state: null,
  accept: (next) =>
    set(({ state }) => ({
      state: state?.id === next.id && state.seq > next.seq ? state : next,
    })),
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
    throw new Error(
      typeof data.detail === 'string'
        ? data.detail
        : 'Could not reach the table.',
    )
  }
  return response.json()
}

export const suits: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
export const cardRank = (card: string) => (card[0] === 'T' ? '10' : card[0])
