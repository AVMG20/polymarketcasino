import { eq, sql } from 'drizzle-orm'
import type { Tx } from '../database'
import { casinoProfiles } from '../database/schema'
import { toUnits } from '../../shared/money'
import { rakebackOf } from '../../shared/rakeback'
import type { CoinWork } from './ledger'
import { ensureCasino } from './tycoon'

export interface RakebackPaid {
    /** Coins that went into the player's own pot (0 when the host got them, or the stake was too small). */
    rakeback: number
    /** Coins that went into the host's visitors pot. */
    host: number
    /** The player's rakeback pot after, when it grew; else null (unchanged). */
    pot: number | null
}

/** A visitor's rakeback just landed in a host's jar (sent once the unit committed). */
export interface VisitorRakeback {
    host: string
    /** Who played. */
    playerId: string
    game: string
    /** Coins it added. */
    amount: number
    /** The host's visitors pot after. */
    pot: number
}

const visitorListeners = new Set<(event: VisitorRakeback) => void>()

/**
 * Hear about every visitor rakeback once its unit has committed (the floor
 * socket tells the host's open floor). Display only: the database is the
 * truth on the next read. Returns the unsubscribe.
 */
export function onVisitorRakeback(listener: (event: VisitorRakeback) => void): () => void {
    visitorListeners.add(listener)
    return () => visitorListeners.delete(listener)
}

type Pot = 'cageRakeback' | 'cageVisitors'

/** Add `amount` coins to one of the jar's pots: one guarded `+ ?` update. Returns the pot after, or null without a profile row. */
function addToPot(tx: Tx, playerId: string, pot: Pot, amount: number): number | null {
    const column = casinoProfiles[pot]
    // Raw sql is not converted: bind units.
    const raise = sql`${column} + ${toUnits(amount)}`
    const row = tx.update(casinoProfiles)
        .set(pot === 'cageRakeback' ? { cageRakeback: raise } : { cageVisitors: raise })
        .where(eq(casinoProfiles.playerId, playerId))
        .returning({ pot: column })
        .get()
    return row ? row.pot : null
}

/**
 * Pay the rakeback on a settled stake (shared/rakeback.ts), in the unit that
 * settles it, as **coins into the cage**, in a pot of its own (never capped
 * by the cage): the host's visitors pot when the stake was played in
 * someone else's casino, else the player's own rakeback pot. A host whose
 * casino is gone pays the player instead; it never throws for that. No
 * coin or chip moves here: collect pays the pots out (category
 * 'rakeback'). Refunds never call this.
 */
export function payRakeback(coins: CoinWork, input: { playerId: string, game: string, stake: number, host?: string | null }): RakebackPaid {
    const amount = rakebackOf(input.stake)
    if (amount <= 0) return { rakeback: 0, host: 0, pot: null }
    const host = input.host && input.host !== input.playerId ? input.host : null
    // Only a host with a casino row: the update finds none for one that is gone.
    const hostPot = host ? addToPot(coins.tx, host, 'cageVisitors', amount) : null
    if (host && hostPot !== null) {
        const event: VisitorRakeback = { host, playerId: input.playerId, game: input.game, amount, pot: hostPot }
        coins.afterCommit(() => {
            for (const listener of visitorListeners) listener(event)
        })
        return { rakeback: 0, host: amount, pot: null }
    }
    let pot = addToPot(coins.tx, input.playerId, 'cageRakeback', amount)
    if (pot === null) {
        ensureCasino(coins.tx, input.playerId)
        pot = addToPot(coins.tx, input.playerId, 'cageRakeback', amount)
    }
    return { rakeback: amount, host: 0, pot }
}
