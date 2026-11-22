/**
 * Coins carry up to four decimals. The database counts them in units of
 * 1/10,000 coin (whole integers, so sums are exact); everything above the
 * database (the ledger's callers, game rules, the API, the client) thinks in
 * coins. Convert only through these helpers. Payouts round down to 0.0001
 * coin, so rounding never creates coins. Gems stay whole.
 */

export const COIN_DECIMALS = 4
/** Units per coin: the database stores `coins × COIN_UNITS` as an integer. */
export const COIN_UNITS = 10_000
/** The largest balance a JS number holds to the unit (about 900 billion coins). */
export const MAX_COINS = Math.floor(Number.MAX_SAFE_INTEGER / COIN_UNITS)

// Binary floats store decimals a hair off (0.7 × 3 = 2.0999999999999996).
// Rounding down to the unit adds this much first, so a value that is meant to
// sit on a unit is not shaved one unit short. It is far below the gap any
// 4-decimal × 4-decimal product can leave under a whole unit (0.0001 unit).
const UNIT_EPSILON = 1e-6

/** Coins → database units. Exact for any amount with at most four decimals. */
export function toUnits(coins: number): number {
    return Math.round(coins * COIN_UNITS)
}

/** Database units → coins. */
export function fromUnits(units: number): number {
    return units / COIN_UNITS
}

/** Round a coin amount down to four decimals (12.34567 → 12.3456). */
export function roundCoins(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.floor(value * COIN_UNITS + UNIT_EPSILON) / COIN_UNITS
}

/** Snap a value that should already sit on four decimals (a sum, a difference) back onto them. */
export function normalizeCoins(value: number): number {
    return Number.isFinite(value) ? fromUnits(toUnits(value)) : 0
}

/** Add coin amounts exactly: 0.1 + 0.2 is 0.3, not 0.30000000000000004. */
export function sumCoins(values: Iterable<number>): number {
    let units = 0
    for (const value of values) units += toUnits(value)
    return fromUnits(units)
}

/** The same amount, to the unit: compares coin values that went through float arithmetic. */
export function sameCoins(a: number, b: number): boolean {
    return toUnits(a) === toUnits(b)
}

/**
 * A coin amount as the server accepts it: a finite, non-negative number with
 * at most four decimals (to within float noise, so 0.1 + 0.2 passes), no
 * larger than MAX_COINS.
 */
export function isCoinAmount(value: unknown): value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_COINS) return false
    const units = value * COIN_UNITS
    return Math.abs(units - Math.round(units)) < Math.max(1e-6, units * 1e-12)
}

/** What a win of `multiple` × `bet` pays: rounded down to four decimals, computed in units. */
export function payFor(bet: number, multiple: number): number {
    if (!(multiple > 0)) return 0
    return Math.floor(toUnits(bet) * multiple + UNIT_EPSILON) / COIN_UNITS
}

/** What `multiple` × `bet` costs (a feature buy at 21.75×): rounded up to four decimals. */
export function costFor(bet: number, multiple: number): number {
    return Math.ceil(toUnits(bet) * multiple - UNIT_EPSILON) / COIN_UNITS
}

const SUFFIXES: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }

/**
 * Parse what a player types into an amount field. Dutch first: `.` groups
 * thousands and `,` is the decimal comma, with English spellings read where
 * they can't mean anything else.
 *
 * - Spaces and underscores are ignored; an optional `k`, `m`, `b` or `t`
 *   (any case) multiplies by 1e3 … 1e12.
 * - Both `.` and `,`: the last one is the decimal separator and the other
 *   groups thousands (`2.137,5` and `2,137.5` are both 2137.5).
 * - One kind, several times: thousands groups (`1.000.000`, `1,000,000`).
 * - A single `,`: the decimal comma (`2,5` is 2.5, `2,137` is 2.137).
 * - A single `.`: thousands when exactly three digits follow it, no suffix is
 *   typed and the number doesn't start with 0 (`2.137` is 2137); otherwise a
 *   decimal point (`2.5`, `0.125`, `1.125k`).
 * - With a suffix a single separator is always decimal (`2,5m`, `1.5k`,
 *   `1.000k` is 1000), and more than one separator is refused.
 * - Thousands groups have one to three digits up front and exactly three
 *   after each separator (`1.00.000` is refused).
 *
 * Returns coins rounded down to four decimals, or null for anything else
 * (negative numbers, letters, an empty field, more than MAX_COINS).
 */
export function parseAmount(input: string): number | null {
    const text = input.trim().toLowerCase().replace(/[\s_  ]/g, '')
    const match = /^([\d.,]+)([kmbt])?$/.exec(text)
    if (!match || !/\d/.test(match[1]!)) return null
    const body = match[1]!
    const suffix = match[2]

    const dots = body.split('.').length - 1
    const commas = body.split(',').length - 1
    let whole = body
    let fraction = ''
    if (dots && commas) {
        const decimal = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ','
        const at = body.lastIndexOf(decimal)
        whole = body.slice(0, at)
        fraction = body.slice(at + 1)
        if (suffix || whole.includes(decimal) || !grouped(whole, decimal === '.' ? ',' : '.')) return null
        whole = whole.replace(/[.,]/g, '')
    } else if (dots + commas > 1) {
        if (suffix || !grouped(body, dots ? '.' : ',')) return null
        whole = body.replace(/[.,]/g, '')
    } else if (dots + commas === 1) {
        const separator = dots ? '.' : ','
        const [left, right] = body.split(separator) as [string, string]
        if (separator === '.' && !suffix && /^[1-9]\d{0,2}$/.test(left) && /^\d{3}$/.test(right)) {
            whole = left + right
        } else {
            whole = left
            fraction = right
        }
    }
    if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction) || (!whole && !fraction)) return null

    const value = Number(`${whole || '0'}.${fraction || '0'}`) * (suffix ? SUFFIXES[suffix]! : 1)
    if (!Number.isFinite(value) || value > MAX_COINS) return null
    return roundCoins(value)
}

/** `1.234.567` with `.` as separator: 1-3 digits, then groups of exactly three. */
function grouped(text: string, separator: '.' | ','): boolean {
    const groups = text.split(separator)
    return /^\d{1,3}$/.test(groups[0]!) && groups.slice(1).every(group => /^\d{3}$/.test(group))
}

/**
 * The old site's `formatNumber`, ported verbatim: nl-NL, at most two
 * decimals, compact by default (2137 → `2,14K`, 1,234,567 → `1,23m`,
 * 2.5e9 → `2,5B`), standard on request (`2.137`). Ported games use it through
 * `app/utils/format-number.ts`.
 */
export function formatNumber(value: number | bigint | Intl.StringNumericLiteral, compact: boolean = true, minimumFractionDigits: number = 0): string {
    const { format } = Intl.NumberFormat('nl-NL', {
        notation: compact ? 'compact' : 'standard',
        minimumFractionDigits,
        maximumFractionDigits: 2
    })

    const formatted = format(value)
    if (!compact) return formatted

    return formatted
        .replace(/[\s ]*mln\.?/gi, 'm')
        .replace(/[\s ]*mld\.?/gi, 'B')
        .replace(/[\s ]*bln\.?/gi, 'T')
}

const WHOLE = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 })
const SMALL = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 })
const EXACT = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: COIN_DECIMALS })

/** Cut a value to `digits` decimals toward zero, so a display never rounds up past what's there. */
function truncate(value: number, digits: number): number {
    const factor = 10 ** digits
    const cut = Math.trunc(value * factor + Math.sign(value) * 1e-6) / factor
    return cut === 0 ? 0 : cut
}

/**
 * Display a coin (or gem) amount the casino's way, in nl-NL: whole coins with
 * `.` between thousands (2137.5 → `2.137`). Amounts under 10 that aren't
 * whole show up to two decimals (`2,5`, `0,07`). Never rounds up: 9.999
 * reads `9,99`. With `compact`, the old site's short form (`2,14K`, `1,5m`),
 * for chips and other tight spots. Put `formatCoinsExact` in a tooltip where
 * the decimals matter.
 */
export function formatCoins(value: number, compact = false): string {
    if (!Number.isFinite(value)) return '0'
    if (compact) return formatNumber(value, true)
    const small = Math.abs(value) < 10 && !Number.isInteger(normalizeCoins(value))
    return small ? SMALL.format(truncate(value, 2)) : WHOLE.format(truncate(value, 0))
}

/** Every decimal a coin amount has, in nl-NL: 2137.5 → `2.137,5`, 0.0001 → `0,0001`. */
export function formatCoinsExact(value: number): string {
    if (!Number.isFinite(value)) return '0'
    const shown = normalizeCoins(value)
    return EXACT.format(shown === 0 ? 0 : shown)
}
