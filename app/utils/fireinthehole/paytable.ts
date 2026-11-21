// Player-facing labels, win tiers and the bet ladder for Fire in the Hole.
// The pays themselves come from the rules module.
import { FITH_BOOST_VALUES, FITH_COIN_VALUES, type FirePaySymbol } from '#shared/slots/fireinthehole'

/** Player-facing names; the art for `emerald` is gold and `ore` is silver. */
export const FITH_SYMBOL_LABEL: Record<FirePaySymbol, string> = {
    coal: 'Coal',
    ore: 'Silver',
    ruby: 'Ruby',
    sapphire: 'Sapphire',
    emerald: 'Gold'
}

/** Pay symbols from highest to lowest value. */
export const FITH_PAY_ORDER: FirePaySymbol[] = ['emerald', 'sapphire', 'ruby', 'ore', 'coal']

/** Range of the coin values that land during free spins (× bet). */
export const FITH_COIN_RANGE = { min: FITH_COIN_VALUES[0]![0], max: FITH_COIN_VALUES.at(-1)![0] } as const
/** Range of the value a pickaxe adds to every coin, each free spin (× bet). */
export const FITH_BOOST_RANGE = { min: FITH_BOOST_VALUES[0]![0], max: FITH_BOOST_VALUES.at(-1)![0] } as const

/** Measured with scripts/fireinthehole-rtp.ts. */
export const FITH_BONUS_FREQUENCY_LABEL = '1 in 180'

export interface FithWinTier {
    id: 'big' | 'mega' | 'epic' | 'motherlode'
    label: string
    /** Win as a multiple of the bet at or above which the tier shows. */
    min: number
}

/** Celebration tiers by win size (× bet), lowest first. */
export const FITH_WIN_TIERS: FithWinTier[] = [
    { id: 'big', label: 'Big Win', min: 20 },
    { id: 'mega', label: 'Mega Win', min: 50 },
    { id: 'epic', label: 'Epic Win', min: 150 },
    { id: 'motherlode', label: 'Motherlode', min: 500 }
]

/** Highest tier a win of `multiple` × bet reaches, or null below Big Win. */
export function fithWinTier(multiple: number): FithWinTier | null {
    let tier: FithWinTier | null = null
    for (const entry of FITH_WIN_TIERS) if (multiple >= entry.min) tier = entry
    return tier
}

/** Bet ladder for the − / + buttons, clipped to the game's limits. */
export function fithBetSteps(min: number, max: number): number[] {
    const steps: number[] = []
    for (let e = 2; e <= 6; e++) {
        for (const m of [1, 2, 5]) {
            const value = m * 10 ** e
            if (value >= min && value <= max) steps.push(value)
        }
    }
    if (steps[0] !== min) steps.unshift(min)
    if (steps.at(-1) !== max) steps.push(max)
    return steps
}

/** A multiple of the bet as shown on coins and banners: 0.64x, 12x, 1,250x. */
export function fithMult(value: number): string {
    return `${value.toLocaleString('en-US', { maximumFractionDigits: value < 10 ? 2 : 0 })}x`
}
