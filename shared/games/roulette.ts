import type { Rng } from '../rng'

/**
 * Single-zero European roulette. A bet covers a set of pockets and returns
 * 36 / covered × stake when the ball lands in one of them (2.70% house edge
 * on every bet).
 */

export const ROULETTE_POCKETS = 37
export const ROULETTE_MAX_BETS = 40

/** Wheel order, clockwise from zero. */
export const WHEEL_ORDER = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
] as const

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])

export type PocketColor = 'green' | 'red' | 'black'

export function pocketColor(n: number): PocketColor {
    return n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black'
}

export type RouletteBetKind =
    | 'straight' | 'red' | 'black' | 'odd' | 'even' | 'low' | 'high' | 'dozen' | 'column'

export interface RouletteBet {
    kind: RouletteBetKind
    /** straight: 0-36; dozen and column: 1-3. */
    value?: number
    amount: number
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

/** The pockets a bet covers. Throws on a malformed bet. */
export function coveredPockets(bet: Pick<RouletteBet, 'kind' | 'value'>): number[] {
    // Inside bets, dozens and columns need their number; outside bets ignore it.
    const v = bet.value ?? Number.NaN
    switch (bet.kind) {
        case 'straight':
            if (!Number.isInteger(v) || v < 0 || v > 36) break
            return [v]
        case 'red':
            return range(1, 36).filter(n => REDS.has(n))
        case 'black':
            return range(1, 36).filter(n => !REDS.has(n))
        case 'odd':
            return range(1, 36).filter(n => n % 2 === 1)
        case 'even':
            return range(1, 36).filter(n => n % 2 === 0)
        case 'low':
            return range(1, 18)
        case 'high':
            return range(19, 36)
        case 'dozen':
            if (![1, 2, 3].includes(v)) break
            return range(12 * (v - 1) + 1, 12 * v)
        case 'column':
            if (![1, 2, 3].includes(v)) break
            return range(1, 36).filter(n => (n - v) % 3 === 0)
    }
    throw new RangeError('Invalid roulette bet')
}

/** What a winning bet returns per coin staked, stake included (straight 36×, red 2×). */
export function betReturn(bet: Pick<RouletteBet, 'kind' | 'value'>): number {
    return 36 / coveredPockets(bet).length
}

export function betKey(bet: Pick<RouletteBet, 'kind' | 'value'>): string {
    return bet.value === undefined ? bet.kind : `${bet.kind}:${bet.value}`
}

const NUMBERED_KINDS = new Set<unknown>(['straight', 'dozen', 'column'])

/** Validate and merge a client's bet list (same spot twice adds up). */
export function parseRouletteBets(input: unknown): RouletteBet[] {
    if (!Array.isArray(input) || input.length === 0) throw new RangeError('Place at least one bet')
    if (input.length > ROULETTE_MAX_BETS * 4) throw new RangeError(`At most ${ROULETTE_MAX_BETS} bets per spin`)
    const merged = new Map<string, RouletteBet>()
    for (const raw of input as (Record<string, unknown> | null)[]) {
        const kind = raw?.kind as RouletteBetKind
        // Only inside bets, dozens and columns carry a value; it is a whole number.
        const value = NUMBERED_KINDS.has(kind) ? raw?.value : undefined
        if (value !== undefined && typeof value !== 'number') throw new RangeError('Invalid roulette bet')
        const amount = raw?.amount
        if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1) throw new RangeError('Every bet needs a whole coin amount')
        coveredPockets({ kind, value })
        const key = betKey({ kind, value })
        const existing = merged.get(key)
        merged.set(key, { kind, ...(value === undefined ? {} : { value }), amount: (existing?.amount ?? 0) + amount })
    }
    if (merged.size > ROULETTE_MAX_BETS) throw new RangeError(`At most ${ROULETTE_MAX_BETS} bets per spin`)
    return [...merged.values()]
}

export interface RouletteResult {
    pocket: number
    color: PocketColor
    bets: (RouletteBet & { won: boolean, payout: number })[]
}

export function totalStake(bets: readonly RouletteBet[]): number {
    return bets.reduce((sum, bet) => sum + bet.amount, 0)
}

export function playRoulette(rng: Rng, bets: readonly RouletteBet[]): RouletteResult {
    const pocket = Math.floor(rng.next() * ROULETTE_POCKETS)
    return {
        pocket,
        color: pocketColor(pocket),
        bets: bets.map((bet) => {
            const won = coveredPockets(bet).includes(pocket)
            return { ...bet, won, payout: won ? Math.floor(bet.amount * betReturn(bet)) : 0 }
        })
    }
}
