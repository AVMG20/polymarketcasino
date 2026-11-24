/**
 * The wire protocol every live table shares. The generic slots carry what a
 * game invents itself: per-seat state (`TSeat`), table-wide state (`TShared`)
 * and its own actions (`TAction`).
 */

export interface SeatView<TSeat = unknown> {
    index: number
    playerId: string
    name: string
    image: string | null
    connected: boolean
    /** Asked to stand up while a stake was live; the seat frees once it settles. */
    leaving: boolean
    /** Voted to start the round rather than wait out the betting clock. */
    votedStart: boolean
    /** Net result of the round that just settled, for the flash badge. */
    lastNet: number | null
    /** Profit or loss since this player sat down. */
    sessionNet: number
    /** Winning rounds in a row. A push holds the streak. */
    winStreak: number
    roundsPlayed: number
    game: TSeat
}

export interface ScoreEntry {
    playerId: string
    name: string
    image: string | null
    net: number
    winStreak: number
    seated: boolean
}

export interface TableState<TSeat = unknown, TShared = unknown> {
    slug: string
    version: number
    roundId: number
    phase: string
    /** Epoch ms the current phase's timer runs out, or null when untimed. */
    phaseEndsAt: number | null
    phaseDuration: number | null
    /** Epoch ms the next round's betting opens, once the hand is over. */
    nextRoundAt: number | null
    /** Server clock at snapshot time, so a client can correct for drift. */
    now: number
    seats: (SeatView<TSeat> | null)[]
    message: string
    scoreboard: ScoreEntry[]
    /** Sockets watching the table, seated or not. */
    watching: number
    minBet: number
    maxBet: number
    game: TShared
}

/**
 * Every stake is paid from coins first, then chips for whatever coins don't
 * cover; every payout is chips, and a refund hands each part back in its own
 * currency. (A `currency` field on an action is ignored.)
 */
export type ClientMessage<TAction = unknown> =
    /** `host`: the casino the player is visiting (a player id), whose built table lets them sit. Optional. */
    | { t: 'sit', seat: number, host?: string }
    | { t: 'leave' }
    | { t: 'voteStart' }
    | { t: 'chat', text: string }
    | { t: 'action', action: TAction }

/** A star level change the hub confirmed after one of this player's stakes or payouts. */
export interface TableStarChange {
    level: number
    previous: number
    bounty: number
}

export type TableEvent =
    | { t: 'event', kind: 'sit', name: string, seat: number }
    | { t: 'event', kind: 'leave', name: string, seat: number }
    | { t: 'event', kind: 'watch', name: string, joined: boolean }
    | { t: 'event', kind: 'settled', seat: number, name: string, net: number }
    | { t: 'event', kind: 'chat', name: string, seat: number, text: string }
    | { t: 'event', kind: 'game', payload: unknown }

export type ServerMessage<TSeat = unknown, TShared = unknown> =
    | { t: 'state', state: TableState<TSeat, TShared> }
    /** `balance` is coins, `chips` the chip balance. */
    | { t: 'you', playerId: string, seat: number | null, balance: number, chips?: number }
    /** After a stake, payout or refund: `balance` is coins, `chips` the chip balance. */
    | { t: 'balance', balance: number, chips?: number }
    | { t: 'stars', stars: TableStarChange }
    | { t: 'error', message: string }
    | TableEvent

/** What a game hands the base to settle: it never moves coins itself. */
export interface TablePayout {
    playerId: string
    /** Everything the player staked this round; must equal their open escrow. */
    staked: number
    /** Everything returned, stakes included (four decimals at most), paid in chips; zero on a total loss. */
    payout: number
    /** Kept with the round in game_rounds. */
    summary: Record<string, unknown>
    /** The best return of one bet this round (a hand, a side bet, a spot), × that bet: the 5× win mission. */
    multiple?: number
}
