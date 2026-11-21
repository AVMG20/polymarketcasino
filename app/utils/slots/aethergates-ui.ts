// Presentation constants for Aethergates: win celebration tiers and number
// formats. Game math lives in shared/slots/aethergates.
import { formatCoins } from '#shared/money'

export interface AgWinTier {
    /** Minimum win, in × total bet. */
    min: number
    label: string
    from: string
    to: string
    glow: string
    sound: 'win-big' | 'win-mega' | 'win-epic'
}

export const AG_WIN_TIERS: AgWinTier[] = [
    { min: 20, label: 'Big Win', from: '#fef9c3', to: '#f59e0b', glow: 'rgba(245, 158, 11, 0.7)', sound: 'win-big' },
    { min: 60, label: 'Mega Win', from: '#cffafe', to: '#06b6d4', glow: 'rgba(6, 182, 212, 0.75)', sound: 'win-mega' },
    { min: 150, label: 'Epic Win', from: '#fae8ff', to: '#c026d3', glow: 'rgba(192, 38, 211, 0.75)', sound: 'win-epic' },
    { min: 500, label: 'Mythic Win', from: '#ffe4e6', to: '#e11d48', glow: 'rgba(225, 29, 72, 0.8)', sound: 'win-epic' }
]

/** Index into AG_WIN_TIERS for a win of `mult` × bet, or -1 below Big Win. */
export function agWinTier(mult: number): number {
    let tier = -1
    for (let i = 0; i < AG_WIN_TIERS.length; i++) if (mult >= AG_WIN_TIERS[i]!.min) tier = i
    return tier
}

/** A coin amount as the server pays it: whole coins, rounded down. */
export function agCoins(value: number, compact = true): string {
    return formatCoins(Math.floor(value + 1e-9), compact)
}

/** A multiple (0.08, 12.5, 500) for multipliers and pays in × bet. */
export function agTimes(value: number): string {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
