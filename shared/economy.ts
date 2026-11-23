/** Casino economy constants (docs/casino-economy.md). */

/** One gem converts into this many coins. One-way: coins never become gems. */
export const COINS_PER_GEM = 1_000

export const CONVERT_MIN_GEMS = 1
/** The hub caps a player's gem pile at 100, so one conversion can take it all. */
export const CONVERT_MAX_GEMS = 100

/** Missions and the stats days follow the Amsterdam calendar. */
export const CASINO_TIME_ZONE = 'Europe/Amsterdam'

// en-CA formats as YYYY-MM-DD. Built once: a formatter costs far more than a format.
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
    timeZone: CASINO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
})

/** The calendar day (YYYY-MM-DD) in Amsterdam at `at`. */
export function amsterdamDay(at: Date = new Date()): string {
    return DAY_FORMAT.format(at)
}

/** The calendar day `days` after `day` (YYYY-MM-DD; negative goes back). */
export function addDays(day: string, days: number): string {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number]
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** The instant the Amsterdam day `day` (YYYY-MM-DD) starts. */
export function amsterdamDayStart(day: string): Date {
    // Amsterdam is UTC+1 or UTC+2, so its midnight is 22:00 or 23:00 UTC the
    // day before: the first of those that already reads as `day`.
    const midnight = new Date(`${day}T00:00:00Z`).getTime()
    for (const hours of [2, 1]) {
        const candidate = new Date(midnight - hours * 3_600_000)
        if (DAY_FORMAT.format(candidate) === day) return candidate
    }
    return new Date(midnight)
}

/** The instant the next Amsterdam day starts, after `at`. */
export function nextAmsterdamMidnight(at: Date = new Date()): Date {
    const today = amsterdamDay(at)
    // Amsterdam midnight is 22:00 or 23:00 UTC; step through whole UTC hours
    // from 21:00 on the local date until the day flips.
    const start = new Date(`${today}T21:00:00Z`).getTime()
    for (let hour = 0; hour < 30; hour++) {
        const candidate = new Date(start + hour * 3_600_000)
        if (candidate > at && amsterdamDay(candidate) !== today) return candidate
    }
    return new Date(at.getTime() + 86_400_000)
}
