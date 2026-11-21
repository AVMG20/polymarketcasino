/**
 * Coins are whole integers end to end: the database, the API and the client.
 * Payouts round down to the coin.
 */

const SUFFIXES: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }

/**
 * Parse what a player types into an amount field: '2500', '2,500', '10k',
 * '2.5m', '1b'. Returns whole coins (rounded down), or null for anything else.
 */
export function parseAmount(input: string): number | null {
    const text = input.trim().toLowerCase().replace(/[,_\s]/g, '')
    const match = /^(\d+(?:\.\d+)?|\.\d+)([kmbt])?$/.exec(text)
    if (!match) return null
    // The epsilon keeps binary floats from shaving a coin: 1.005k is 1,005.
    const value = Math.floor(Number(match[1]) * (match[2] ? SUFFIXES[match[2]]! : 1) + 1e-6)
    return Number.isSafeInteger(value) ? value : null
}

const COMPACT = [
    { value: 1e12, suffix: 'T' },
    { value: 1e9, suffix: 'B' },
    { value: 1e6, suffix: 'M' },
    { value: 1e3, suffix: 'K' }
]

/**
 * Display a coin (or gem) amount. Compact mode, the default, shortens from
 * 10,000 up (12.3K, 4.56M) and never rounds up past what the player holds.
 * Full mode prints grouped digits.
 */
export function formatCoins(value: number, compact = true): string {
    if (!Number.isFinite(value)) return '0'
    const abs = Math.abs(value)
    if (compact && abs >= 10_000) {
        const unit = COMPACT.find(entry => abs >= entry.value)!
        const scaled = abs / unit.value
        const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
        const factor = 10 ** digits
        const shown = Math.floor(scaled * factor + 1e-9) / factor
        return `${value < 0 ? '-' : ''}${shown.toLocaleString('en-US', { maximumFractionDigits: digits })}${unit.suffix}`
    }
    return Math.trunc(value).toLocaleString('en-US')
}
