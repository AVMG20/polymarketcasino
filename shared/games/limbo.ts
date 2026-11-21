import type { Rng } from '../rng'

/**
 * Limbo: name a target multiplier; the game draws a result and you win the
 * target when the result reaches it. P(result ≥ t) = RTP / t, so every target
 * returns 98%.
 */
export const LIMBO_RTP = 0.98
export const LIMBO_MIN_TARGET = 1.01
export const LIMBO_MAX_TARGET = 1_000_000

export interface LimboOptions {
    target: number
}

export interface LimboResult {
    result: number
    target: number
    won: boolean
    chance: number
}

export function limboChance(target: number): number {
    return Math.min(1, LIMBO_RTP / target)
}

/**
 * A typed multiplier rounded down to the cent. The epsilon keeps binary
 * floats honest: 1.15 × 100 is 114.99999999999999, which must stay 1.15.
 */
export function toCents(value: number): number {
    return Math.floor(value * 100 + 1e-7) / 100
}

export function parseLimboOptions(input: Record<string, unknown> | undefined): LimboOptions {
    const target = toCents(Number(input?.target ?? 2))
    if (!Number.isFinite(target) || target < LIMBO_MIN_TARGET || target > LIMBO_MAX_TARGET) {
        throw new RangeError(`Target must be between ${LIMBO_MIN_TARGET}× and ${LIMBO_MAX_TARGET.toLocaleString('en-US')}×`)
    }
    return { target }
}

export function playLimbo(rng: Rng, options: LimboOptions): LimboResult {
    const u = 1 - rng.next() // (0, 1]
    // Floor to the cent so a shown 2.00× really reached 2.00×.
    const result = Math.min(LIMBO_MAX_TARGET, Math.max(1, Math.floor((LIMBO_RTP / u) * 100) / 100))
    return { result, target: options.target, won: result >= options.target, chance: limboChance(options.target) }
}
