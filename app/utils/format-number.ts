import { formatNumber } from '#shared/money'

/**
 * The old site's `formatNumber(value, compact, minimumFractionDigits)`,
 * ported verbatim (nl-NL, at most two decimals: 2137 → `2,14K` compact,
 * `2.137` standard), so ported games read exactly as they did there. The
 * code lives in shared/money.ts so the casino's `formatCoins` can share it.
 */
export default formatNumber
