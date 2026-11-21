// Player-facing numbers for Fire in the Hole's paytable, win tiers and rules
// panel. The game math lives in shared/slots/fireinthehole; the pays, the
// cascade step and the coin and pickaxe values come straight from it.
import { findGame } from '#shared/games/registry'
import { FITH_BOOST_VALUES, FITH_COIN_VALUES, type FirePaySymbol } from '#shared/slots/fireinthehole'

export { FITH_CHAIN_STEP, FITH_SYMBOL_PAY, fithChainMultiplier } from '#shared/slots/fireinthehole'

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

const GAME = findGame('fireinthehole')!

/**
 * The registry's RTP, measured with scripts/fireinthehole-rtp.ts; free spins
 * come about once every 180 spins.
 */
export const FITH_RTP_LABEL = `${Math.round(GAME.rtp * 1000) / 10}%`
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

/** Bet ladder for the − / + buttons, inside the casino's bet bounds (the old site took 1 to 100B). */
export const FITH_BET_STEPS = [
    1, 2, 5, 10, 20, 50, 100, 200, 500,
    1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
    1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000,
    250_000_000, 500_000_000, 1_000_000_000, 2_500_000_000, 5_000_000_000,
    10_000_000_000, 25_000_000_000, 50_000_000_000, 100_000_000_000
].filter(step => step >= GAME.minBet && step <= GAME.maxBet)
