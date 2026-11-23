/**
 * The casino's star level, 0 to 10: how many of these thresholds the player's
 * CURRENT chip balance (My Casino chips, which only come from round payouts)
 * is at or above. Spend or lose the chips and the stars go with them. Coins
 * never count. The level is reported to the hub whenever it changes
 * (server/utils/stars.ts). Thresholds must ascend; tune them here.
 *
 * Sized against `bun scripts/tycoon-sim.ts` (the whole catalog is ~1.65M
 * chips, a maxed casino wins ~100-200k chips a day): the first stars come in
 * the first days, the middle ones while saving between builds (the Lounge,
 * the Crew, the High Limit Room; 8 while saving for the Penthouse at
 * 132k), 9 around max and 10 about a week of play after it.
 */
export interface CasinoStar {
    key: string
    name: string
    description: string
    threshold: number
}

export const CASINO_GAME_SLUG = 'casino'

export const CASINO_STARS: readonly CasinoStar[] = [
    { key: 'hold-1k', name: 'Pocket change', description: 'Hold 1k chips', threshold: 1_000 },
    { key: 'hold-2500', name: 'Fat wallet', description: 'Hold 2.5k chips', threshold: 2_500 },
    { key: 'hold-5k', name: 'Chip stack', description: 'Hold 5k chips', threshold: 5_000 },
    { key: 'hold-10k', name: 'High roller', description: 'Hold 10k chips', threshold: 10_000 },
    { key: 'hold-20k', name: 'Whale watch', description: 'Hold 20k chips', threshold: 20_000 },
    { key: 'hold-40k', name: 'Velvet rope', description: 'Hold 40k chips', threshold: 40_000 },
    { key: 'hold-75k', name: 'Penthouse', description: 'Hold 75k chips', threshold: 75_000 },
    { key: 'hold-120k', name: 'House money', description: 'Hold 120k chips', threshold: 120_000 },
    { key: 'hold-300k', name: 'Casino royalty', description: 'Hold 300k chips', threshold: 300_000 },
    { key: 'hold-1m', name: 'First million', description: 'Hold 1M chips', threshold: 1_000_000 }
]

export const MAX_STARS = CASINO_STARS.length

/** The star level (0-10) for a chip balance. Thresholds ascend, so it is a prefix count. */
export function starLevel(chips: number): number {
    let level = 0
    while (level < CASINO_STARS.length && chips >= CASINO_STARS[level]!.threshold) level++
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
    /** starLevel(chips): 0-10, follows the current chip balance. */
    level: number
    max: number
    /** The level the hub has confirmed; differs from `level` while a report is due. */
    reported: number
    /** The star you'd lose by dropping below its threshold. */
    current: { name: string, threshold: number } | null
    next: { name: string, threshold: number } | null
}

/** What the wallet shows about stars for a chip balance (server and client alike). */
export function starSummary(chips: number, reported: number): StarSummary {
    const level = starLevel(chips)
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
