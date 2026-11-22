import { formatCoins } from '#shared/money'

const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const DAY_YEAR = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
const PERCENT = new Intl.NumberFormat('nl-NL', { style: 'percent', maximumFractionDigits: 1 })

/** 'YYYY-MM-DD' → "21 Nov" (with the year when asked). */
export function formatDay(day: string, withYear = false): string {
    return (withYear ? DAY_YEAR : DAY).format(new Date(`${day}T12:00:00Z`))
}

/** A return rate (paid out ÷ wagered) as `96,3%`, or a dash when nothing was wagered. */
export function formatReturn(rate: number | null): string {
    return rate === null ? '–' : PERCENT.format(rate)
}

/** A coin result with its sign: `+2.137`, `−40`, `0`. */
export function formatSignedCoins(value: number, compact = false): string {
    const text = formatCoins(Math.abs(value), compact)
    if (text === '0') return '0'
    return value > 0 ? `+${text}` : `−${text}`
}
