/**
 * The casino's star level, 0 to 10: how many of these thresholds the player's
 * CURRENT coin balance is at or above. Lose the coins and the stars go with
 * them. The level is reported to the hub whenever it changes
 * (server/utils/stars.ts). Thresholds must ascend; tune them here.
 */
export interface CasinoStar {
    key: string
    name: string
    description: string
    threshold: number
}

export const CASINO_GAME_SLUG = 'casino'

export const CASINO_STARS: readonly CasinoStar[] = [
    { key: 'hold-10k', name: 'Pocket change', description: 'Hold 10k coins', threshold: 10_000 },
    { key: 'hold-50k', name: 'Fat wallet', description: 'Hold 50k coins', threshold: 50_000 },
    { key: 'hold-100k', name: 'High roller', description: 'Hold 100k coins', threshold: 100_000 },
    { key: 'hold-250k', name: 'Whale watch', description: 'Hold 250k coins', threshold: 250_000 },
    { key: 'hold-500k', name: 'Velvet rope', description: 'Hold 500k coins', threshold: 500_000 },
    { key: 'hold-1m', name: 'First million', description: 'Hold 1M coins', threshold: 1_000_000 },
    { key: 'hold-5m', name: 'Penthouse', description: 'Hold 5M coins', threshold: 5_000_000 },
    { key: 'hold-10m', name: 'House money', description: 'Hold 10M coins', threshold: 10_000_000 },
    { key: 'hold-50m', name: 'Casino royalty', description: 'Hold 50M coins', threshold: 50_000_000 },
    { key: 'hold-100m', name: 'Nine figures', description: 'Hold 100M coins', threshold: 100_000_000 }
]

export const MAX_STARS = CASINO_STARS.length

/** The star level (0-10) for a balance. Thresholds ascend, so it is a prefix count. */
export function starLevel(coins: number): number {
    let level = 0
    while (level < CASINO_STARS.length && coins >= CASINO_STARS[level]!.threshold) level++
    return level
}

/** The star a level sits on (the one you would lose by dropping below it), or null at 0. */
export function currentStar(level: number): CasinoStar | null {
    return level > 0 ? CASINO_STARS[level - 1] ?? null : null
}

/** The next star up from a level, or null at 10. */
export function nextStar(level: number): CasinoStar | null {
    return CASINO_STARS[level] ?? null
}

export interface StarSummary {
    /** starLevel(coins): 0-10, follows the current balance. */
    level: number
    max: number
    /** The level the hub has confirmed; differs from `level` while a report is due. */
    reported: number
    /** The star you'd lose by dropping below its threshold. */
    current: { name: string, threshold: number } | null
    next: { name: string, threshold: number } | null
}

/** What the wallet shows about stars for a balance (server and client alike). */
export function starSummary(coins: number, reported: number): StarSummary {
    const level = starLevel(coins)
    const current = currentStar(level)
    const next = nextStar(level)
    return {
        level,
        max: MAX_STARS,
        reported,
        current: current ? { name: current.name, threshold: current.threshold } : null,
        next: next ? { name: next.name, threshold: next.threshold } : null
    }
}
