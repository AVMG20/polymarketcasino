import { payFor } from './money'

/**
 * Rakeback: every settled stake pays back RAKEBACK of itself in chips. In
 * your own casino it goes to you; played in someone else's casino (a round or
 * seat with a `host`), it goes to that casino's owner instead. Refunded
 * stakes pay none. See docs/casino-economy.md, "Rakeback".
 */
export const RAKEBACK = 0.01

/** The rakeback on `stake`, rounded down to 0.0001 (0 for a stake too small to pay any). */
export function rakebackOf(stake: number): number {
    return stake > 0 ? payFor(stake, RAKEBACK) : 0
}
