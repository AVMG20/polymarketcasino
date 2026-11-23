import { and, eq, sql } from 'drizzle-orm'
import type { Tx } from '../database'
import { casinoProfiles, chipTransactions } from '../database/schema'
import { isCoinAmount, normalizeCoins, toUnits } from '../../shared/money'

/**
 * The chip ledger, and the only way chips change. Chips carry up to four
 * decimals like coins and are stored the same way (units of 1/10,000). Every
 * move writes a chip_transactions row and is a guarded statement: a debit
 * carries its `chips >= amount` check in the WHERE clause. Chips never touch
 * `players.coins`. The casino profile must exist (server/utils/tycoon.ts
 * creates it).
 *
 * Stars follow the chip balance, so chips move only inside a
 * `coinTransaction` / `commitCoins` unit (pass its `coins.tx`): the unit
 * watches every chip move and reports the star level after commit. A chip
 * move anywhere else throws.
 */

export interface ChipChange {
    playerId: string
    amount: number
    /** 'bet:dice', 'win:dice', 'refund:blackjack', 'build:zone:main', 'campaign:flyers'. */
    reason: string
}

/** Told about every chip move of the open unit: the balance before and after. */
export type ChipObserver = (playerId: string, before: number, after: number) => void

let observer: ChipObserver | null = null

/** Run `work` (synchronous, inside the unit's transaction) with `watch` told about every chip move. */
export function watchChips<T>(watch: ChipObserver, work: () => T): T {
    const previous = observer
    observer = watch
    try {
        return work()
    } finally {
        observer = previous
    }
}

function observe(playerId: string, after: number, delta: number) {
    if (!observer) throw new Error('Chips move only inside coinTransaction or commitCoins (stars follow chips)')
    observer(playerId, normalizeCoins(after - delta), after)
}

function chipUnits(amount: number): number {
    const units = isCoinAmount(amount) ? toUnits(amount) : 0
    if (units <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid chip amount' })
    return units
}

/** Add chips. Returns the balance after. */
export function creditChips(tx: Tx, change: ChipChange): number {
    const units = chipUnits(change.amount)
    if (!observer) observe(change.playerId, 0, 0)
    const updated = tx.update(casinoProfiles)
        .set({ chips: sql`${casinoProfiles.chips} + ${units}` })
        .where(eq(casinoProfiles.playerId, change.playerId))
        .returning({ chips: casinoProfiles.chips })
        .get()
    if (!updated) throw new Error(`No casino for ${change.playerId}`)
    tx.insert(chipTransactions).values({ playerId: change.playerId, amount: change.amount, type: 'credit', reason: change.reason, balanceAfter: updated.chips }).run()
    observe(change.playerId, updated.chips, change.amount)
    return updated.chips
}

/** Take chips; throws 400 'Not enough chips' when the player can't cover them, so never pre-check. */
export function debitChips(tx: Tx, change: ChipChange): number {
    const units = chipUnits(change.amount)
    if (!observer) observe(change.playerId, 0, 0)
    const updated = tx.update(casinoProfiles)
        .set({ chips: sql`${casinoProfiles.chips} - ${units}` })
        .where(and(eq(casinoProfiles.playerId, change.playerId), sql`${casinoProfiles.chips} >= ${units}`))
        .returning({ chips: casinoProfiles.chips })
        .get()
    if (!updated) throw createError({ statusCode: 400, statusMessage: 'Not enough chips' })
    tx.insert(chipTransactions).values({ playerId: change.playerId, amount: change.amount, type: 'debit', reason: change.reason, balanceAfter: updated.chips }).run()
    observe(change.playerId, updated.chips, -change.amount)
    return updated.chips
}
