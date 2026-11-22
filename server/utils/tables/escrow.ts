import { and, eq, inArray, lt, notInArray } from 'drizzle-orm'
import { gameRounds, tableWagers } from '../../database/schema'
import { db } from '../../database'
import { isCoinAmount, sameCoins, sumCoins } from '../../../shared/money'
import { commitCoins, getCoins, type CommittedCoins } from '../ledger'

/**
 * Money at the live tables. A stake is a debit plus an `open` table_wagers
 * row, in one transaction. Settling claims the round's open rows (`open →
 * settled`) and credits the payout in the same transaction; refunding claims
 * them `open → refunded` and credits the sum back as a refund. The claim is
 * the guard: a row closes exactly once, so no retry, timer or sweep can pay a
 * stake twice. All of it is synchronous (bun:sqlite), so nothing awaits while
 * a table is mid-change.
 */

export interface StakeResult {
    wagerId: string
    balance: number
}

/** Debit `amount` and open its escrow row. Throws 400 'Not enough coins' when the player can't cover it. */
export function stakeWager(input: { playerId: string, game: string, roundId: number, amount: number, kind: string }): CommittedCoins<StakeResult> {
    return commitCoins((coins) => {
        const after = coins.debit({ playerId: input.playerId, amount: input.amount, category: input.game })
        const row = coins.tx.insert(tableWagers).values({
            playerId: input.playerId,
            game: input.game,
            roundId: input.roundId,
            amount: input.amount,
            kind: input.kind
        }).returning({ id: tableWagers.id }).get()
        return { wagerId: row.id, balance: after.coins }
    })
}

/** Several stakes for one player, all or nothing. */
export function stakeWagers(playerId: string, game: string, roundId: number, stakes: { amount: number, kind: string }[]): CommittedCoins<{ wagerIds: string[], balance: number }> {
    return commitCoins((coins) => {
        const wagerIds: string[] = []
        let balance = 0
        for (const stake of stakes) {
            balance = coins.debit({ playerId, amount: stake.amount, category: game }).coins
            wagerIds.push(coins.tx.insert(tableWagers).values({ playerId, game, roundId, amount: stake.amount, kind: stake.kind }).returning({ id: tableWagers.id }).get().id)
        }
        return { wagerIds, balance }
    })
}

export type SettleResult =
    | { kind: 'settled', balance: number }
    /** Some of the stakes were already closed (a sweep refunded them): the rest came back as a refund. */
    | { kind: 'refunded', balance: number | null, refunded: number }
    /** Nothing was open any more: nothing moved. */
    | { kind: 'closed' }

/**
 * Close a player's round: claim every open row in `wagerIds` and pay `payout`.
 * Only a claim of every row, adding up to `staked`, pays the result; a partial
 * claim means someone else already closed part of the round, so what this call
 * did claim is refunded instead of paid on top.
 */
export function settleWagers(input: {
    playerId: string
    game: string
    wagerIds: string[]
    staked: number
    payout: number
    summary: Record<string, unknown>
}): CommittedCoins<SettleResult> {
    if (!isCoinAmount(input.payout)) throw new Error(`table payout must be coins with at most 4 decimals, got ${input.payout}`)
    return commitCoins((coins): SettleResult => {
        if (!input.wagerIds.length) return { kind: 'closed' }
        const claimed = coins.tx.update(tableWagers)
            .set({ status: 'settled', closedAt: new Date() })
            .where(and(inArray(tableWagers.id, input.wagerIds), eq(tableWagers.status, 'open'), eq(tableWagers.playerId, input.playerId)))
            .returning({ id: tableWagers.id, amount: tableWagers.amount })
            .all()
        if (!claimed.length) return { kind: 'closed' }
        const escrow = sumCoins(claimed.map(row => row.amount))
        if (claimed.length !== input.wagerIds.length || !sameCoins(escrow, input.staked)) {
            if (!sameCoins(escrow, input.staked) && claimed.length === input.wagerIds.length) {
                console.error(`[tables] ${input.game}: settle for ${input.playerId} staked ${input.staked} but escrow holds ${escrow}; refunding`)
            }
            coins.tx.update(tableWagers).set({ status: 'refunded' }).where(inArray(tableWagers.id, claimed.map(row => row.id))).run()
            const after = coins.credit({ playerId: input.playerId, amount: escrow, category: input.game, refund: true })
            return { kind: 'refunded', balance: after.coins, refunded: escrow }
        }
        let balance: number | null = null
        if (input.payout > 0) balance = coins.credit({ playerId: input.playerId, amount: input.payout, category: input.game }).coins
        coins.tx.insert(gameRounds).values({
            playerId: input.playerId,
            game: input.game,
            stake: input.staked,
            payout: input.payout,
            summary: input.summary
        }).run()
        return { kind: 'settled', balance: balance ?? getCoins(input.playerId, coins.tx)?.coins ?? 0 }
    })
}

/** Hand back every still-open row in `wagerIds`. Returns the refunded total and the balance after. */
export function refundWagers(playerId: string, game: string, wagerIds: string[]): CommittedCoins<{ refunded: number, balance: number | null }> {
    return commitCoins((coins) => {
        if (!wagerIds.length) return { refunded: 0, balance: null }
        const claimed = coins.tx.update(tableWagers)
            .set({ status: 'refunded', closedAt: new Date() })
            .where(and(inArray(tableWagers.id, wagerIds), eq(tableWagers.status, 'open'), eq(tableWagers.playerId, playerId)))
            .returning({ amount: tableWagers.amount })
            .all()
        const refunded = sumCoins(claimed.map(row => row.amount))
        if (!refunded) return { refunded: 0, balance: null }
        return { refunded, balance: coins.credit({ playerId, amount: refunded, category: game, refund: true }).coins }
    })
}

/**
 * Refund open escrow that no live table holds: at boot every open row is an
 * orphan (the tables live in memory), later only rows older than `olderThan`
 * that aren't in `held`. One transaction per player, under the game's own
 * ledger category. Returns how many rows came back.
 */
export async function refundOrphanedWagers(options: { olderThan?: Date, held?: ReadonlySet<string> } = {}): Promise<number> {
    const conditions = [eq(tableWagers.status, 'open')]
    if (options.olderThan) conditions.push(lt(tableWagers.createdAt, options.olderThan))
    if (options.held?.size) conditions.push(notInArray(tableWagers.id, [...options.held]))
    const open = db.select({ id: tableWagers.id, playerId: tableWagers.playerId, game: tableWagers.game })
        .from(tableWagers).where(and(...conditions)).all()
    const groups = new Map<string, { playerId: string, game: string, ids: string[] }>()
    for (const row of open) {
        const key = `${row.playerId}\u0000${row.game}`
        const group = groups.get(key) ?? { playerId: row.playerId, game: row.game, ids: [] }
        group.ids.push(row.id)
        groups.set(key, group)
    }
    let rows = 0
    for (const group of groups.values()) {
        const { value, stars } = refundWagers(group.playerId, group.game, group.ids)
        if (value.refunded) rows += group.ids.length
        await stars
    }
    return rows
}
