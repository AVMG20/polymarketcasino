import { findGame } from '#shared/games/registry'

/** Bet ladder a suggested bet snaps down to: 1-2-5 steps (10, 20, 50, 100, ...). */
const STEPS = [1, 2, 5]
const key = (slug: string) => `casino:bet:${slug}`

/** About 1% of the bankroll, rounded down to a 1-2-5 chip value, within the game's bet bounds. */
export function suggestedBet(min: number, max: number, bankroll: number): number {
    const target = bankroll * 0.01
    let best = min
    for (let e = 0; e <= 12; e++) {
        for (const m of STEPS) {
            const value = m * 10 ** e
            if (value > target || value > max) return Math.max(min, Math.min(max, best))
            if (value >= min) best = value
        }
    }
    return Math.max(min, Math.min(max, best))
}

function readBet(slug: string, min: number, max: number): number | null {
    try {
        const value = Number(localStorage.getItem(key(slug)))
        return Number.isFinite(value) && value >= min && value <= max ? value : null
    } catch {
        return null
    }
}

function writeBet(slug: string, value: number) {
    try {
        localStorage.setItem(key(slug), String(value))
    } catch {
        // Private mode: the bet just starts from the suggestion next time.
    }
}

/**
 * A game's bet: the last bet the player chose here (per browser and game),
 * else about 1% of the bankroll on a chip value, never below the game's
 * minimum. A bankroll that is still loading sets the suggestion once it
 * arrives, unless the player picked a bet first.
 */
export function useGameBet(slug: string, bankroll: Ref<number>): Ref<number> {
    const info = findGame(slug)
    const min = info?.minBet ?? 100
    const max = info?.maxBet ?? 1_000_000
    const remembered = import.meta.client ? readBet(slug, min, max) : null
    const bet = ref(remembered ?? (bankroll.value > 0 ? suggestedBet(min, max, bankroll.value) : min))
    let touched = remembered !== null || bankroll.value > 0
    let setting = false

    if (!touched) {
        const stop = watch(bankroll, (value) => {
            if (touched || !(value > 0)) return
            touched = true
            stop()
            setting = true
            bet.value = suggestedBet(min, max, value)
            setting = false
        })
    }
    watch(bet, (value) => {
        if (setting) return
        touched = true
        if (value >= min && value <= max) writeBet(slug, value)
    })
    return bet
}
