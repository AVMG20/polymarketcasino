import type { Rng } from '../rng'

/**
 * Dice: roll 0.00-99.99 and win when the roll lands on your side of the line.
 * The payout multiplier is RTP / chance, so every setting returns 98%.
 */
export const DICE_RTP = 0.98
export const DICE_MIN_CHANCE = 1
export const DICE_MAX_CHANCE = 95

export interface DiceOptions {
    /** Win chance in percent, up to two decimals. */
    chance: number
    /** Win on a roll over (100 - chance) instead of under `chance`. */
    over: boolean
}

export interface DiceResult {
    roll: number
    chance: number
    over: boolean
    /** The line the roll had to beat. */
    target: number
    won: boolean
    multiplier: number
}

export function diceMultiplier(chance: number): number {
    return Math.floor((DICE_RTP * 100 / chance) * 10_000) / 10_000
}

export function parseDiceOptions(input: Record<string, unknown> | undefined): DiceOptions {
    const chance = Math.round(Number(input?.chance ?? 50) * 100) / 100
    if (!Number.isFinite(chance) || chance < DICE_MIN_CHANCE || chance > DICE_MAX_CHANCE) {
        throw new RangeError(`Win chance must be between ${DICE_MIN_CHANCE}% and ${DICE_MAX_CHANCE}%`)
    }
    return { chance, over: input?.over === true }
}

export function playDice(rng: Rng, options: DiceOptions): DiceResult {
    // 10,000 equally likely rolls: 0.00 to 99.99.
    const roll = Math.floor(rng.next() * 10_000) / 100
    const target = options.over ? Math.round((100 - options.chance) * 100) / 100 : options.chance
    const won = options.over ? roll >= target : roll < target
    return { roll, chance: options.chance, over: options.over, target, won, multiplier: diceMultiplier(options.chance) }
}
