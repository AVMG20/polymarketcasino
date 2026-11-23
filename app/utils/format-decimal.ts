const cache = new Map<string, Intl.NumberFormat>()

/**
 * A fixed number of decimals in nl-NL (comma decimals): `formatFixed(2.5, 2)` is
 * `2,50`. `grouping: false` leaves out the thousands dots, for text fields.
 */
export function formatFixed(value: number, digits: number, grouping = true): string {
    const key = `${digits}:${grouping}`
    let format = cache.get(key)
    if (!format) {
        format = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: grouping })
        cache.set(key, format)
    }
    return format.format(value)
}

/** Reads a decimal typed the Dutch (`2,5`) or English (`2.5`) way; NaN when it is not a number. */
export function parseDecimal(text: string): number {
    const clean = text.trim().replace(',', '.')
    return /^\d*\.?\d*$/.test(clean) && clean !== '' && clean !== '.' ? Number(clean) : Number.NaN
}
