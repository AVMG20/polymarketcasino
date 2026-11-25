import { eq } from 'drizzle-orm'
import { casinoProfiles } from '../database/schema'
import { rakebackOf } from '../../shared/rakeback'
import type { CoinWork } from './ledger'

export interface RakebackPaid {
    /** Chips the player got (0 when the host got them, or the stake was too small). */
    rakeback: number
    /** Chips the host got. */
    host: number
    /** The player's chip balance after, when they were paid; else null (unchanged). */
    chipBalance: number | null
}

/**
 * Pay the rakeback on a settled stake (shared/rakeback.ts), in the unit that
 * settles it: to the host when the stake was played in someone else's
 * casino (`host:<slug>`), else to the player (`rakeback:<slug>`). A host whose
 * casino is gone pays the player instead; it never throws for that. Refunds
 * never call this.
 */
export function payRakeback(coins: CoinWork, input: { playerId: string, game: string, stake: number, host?: string | null }): RakebackPaid {
    const amount = rakebackOf(input.stake)
    if (amount <= 0) return { rakeback: 0, host: 0, chipBalance: null }
    const host = input.host && input.host !== input.playerId
        && coins.tx.select({ id: casinoProfiles.playerId }).from(casinoProfiles).where(eq(casinoProfiles.playerId, input.host)).get()
        ? input.host
        : null
    if (host) {
        coins.creditChips({ playerId: host, amount, reason: `host:${input.game}` })
        return { rakeback: 0, host: amount, chipBalance: null }
    }
    const chipBalance = coins.creditChips({ playerId: input.playerId, amount, reason: `rakeback:${input.game}` })
    return { rakeback: amount, host: 0, chipBalance }
}
