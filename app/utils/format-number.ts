import { formatCoins } from '#shared/money'

/**
 * The old site's `formatNumber(value, compact)`, kept so ported games read the
 * same, on the casino's coin format: whole amounts go through `formatCoins`
 * (12.3K, 4.56M from 10,000 up, never rounded up), so a slot shows the same
 * figure as the top bar. Like the old compact format, fractions keep two
 * decimals below 1,000 (a line bet of 2.46) and are dropped from there up
 * (a count-up passing 2,392.95 reads 2,392).
 */
export default function (value: number, compact: boolean = true, minimumFractionDigits: number = 0): string {
    if (!Number.isFinite(value)) return '0'
    if (Number.isInteger(value) && minimumFractionDigits === 0) return formatCoins(value, compact)
    if (compact && Math.abs(value) >= 1_000) return formatCoins(Math.trunc(value), compact)
    return value.toLocaleString('en-US', { minimumFractionDigits, maximumFractionDigits: 2 })
}
