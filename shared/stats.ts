/** The player stats page (GET /api/me/stats): ranges and the response shape. */

export const STATS_RANGES = ['7d', '30d', '90d', 'all'] as const
export type StatsRange = typeof STATS_RANGES[number]

/** How many Amsterdam days a range covers, today included (`all`: since the first ledger row). */
export const RANGE_DAYS: Record<Exclude<StatsRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 }

/**
 * Ledger categories that move coins without a game: the daily allowance (old
 * rows), gem conversions, the My Casino cashier cage (guest income) and daily
 * mission rewards. They are listed apart and never count toward wagered, paid
 * out or return.
 */
export const FLOW_CATEGORIES = ['allowance', 'convert', 'cage', 'mission'] as const
export type FlowCategory = typeof FLOW_CATEGORIES[number]

export function isStatsRange(value: unknown): value is StatsRange {
    return typeof value === 'string' && (STATS_RANGES as readonly string[]).includes(value)
}

/**
 * Totals over a set of settled rounds. A stake is coins or chips; every
 * payout is chips (economy v2), so `wagered` counts both currencies and
 * `net` is what the rounds made or lost across them.
 */
export interface RoundTotals {
    rounds: number
    /** Every stake, coins and chips. */
    wagered: number
    /** The part of `wagered` staked with coins (coins only ever leave through rounds). */
    wageredCoins?: number
    /** The part staked with chips. */
    wageredChips?: number
    /** Payouts (chips). */
    paidOut: number
    /** paidOut − wagered. */
    net: number
    /** paidOut ÷ wagered; null when nothing was wagered. */
    returnRate: number | null
    /** The largest single-round profit (payout − stake), 0 when no round won. */
    biggestWin: number
}

export interface GameStats extends RoundTotals {
    game: string
    name: string
}

export interface StatsDay {
    /** Amsterdam day, YYYY-MM-DD. */
    day: string
    rounds: number
    wagered: number
    paidOut: number
    net: number
    /** The player's coin balance at the end of the day (all games and flows). */
    balance: number
}

export interface StatsFlow {
    category: FlowCategory
    /** Ledger rows (claims, conversions). */
    count: number
    /** Coins credited. */
    amount: number
}

export interface PlayerStats {
    range: StatsRange
    /** The game the summary and days are narrowed to, or null for every game. */
    game: string | null
    /** First and last Amsterdam day covered (inclusive). */
    from: string
    to: string
    summary: RoundTotals & {
        /** The game and day of the biggest win, when there was one. */
        biggestWinGame: string | null
        biggestWinDay: string | null
    }
    /** Every game played in the range (ignores `game`), most wagered first. */
    games: GameStats[]
    days: StatsDay[]
    /** Coins in without a game (allowance, converts, the cage, missions): every flow category, zero when unused. */
    flows: StatsFlow[]
    /** Balance before the first day and at the end of the last. */
    balance: { start: number, end: number }
}
