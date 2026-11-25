import { and, eq, inArray, lt, notInArray } from 'drizzle-orm'
import { gameRounds, tableWagers } from '../../database/schema'
import { db } from '../../database'
import { isCoinAmount, normalizeCoins, sameCoins, sumCoins } from '../../../shared/money'
import { commitCoins, getCoins, type CoinWork, type CommittedCoins } from '../ledger'
import { chipBalance } from '../tycoon'
import { recordMissions } from '../missions'
import { roundMissionEvents } from '../../../shared/missions'
import { payRakeback } from '../rakeback'

/**
 * Money at the live tables. A stake is a debit (coins first, then chips for
 * whatever coins don't cover) plus an `open` table_wagers row that records
 * the chip part, in one transaction. Settling claims the round's open rows
 * (`open → settled`) and pays the payout in **chips** in the same
 * transaction; refunding claims them `open → refunded` and hands each part
 * of a stake back in its own currency. The claim is the guard: a row closes
 * exactly once, so no retry, timer or sweep can pay a stake twice. A settle
 * also pays the stakes' rakeback (1% in chips, to the seat's host when the
 * player sat down in someone else's casino); a refund pays none. All of it
 * is synchronous (bun:sqlite), so nothing awaits while a table is mid-change.
 */

/** Both balances after a money move: `balance` is coins (the old field), `chips` the chip balance. */
export interface Balances {
    balance: number
    chips: number
}

function balancesOf(coins: CoinWork, playerId: string): Balances {
    return { balance: getCoins(playerId, coins.tx)?.coins ?? 0, chips: chipBalance(playerId, coins.tx) }
}

/** One stake: debit `amount` (coins first, then chips) and open its escrow row. */
export function stakeWager(input: { playerId: string, game: string, roundId: number, amount: number, kind: string }): CommittedCoins<Balances & { wagerId: string }> {
    const committed = stakeWagers(input.playerId, input.game, input.roundId, [{ amount: input.amount, kind: input.kind }])
    const { wagerIds, ...balances } = committed.value
    return { value: { wagerId: wagerIds[0]!, ...balances }, stars: committed.stars }
}

/**
 * Several stakes for one player, all or nothing, each split coins first,
 * then chips. Throws 400 'Not enough coins or chips' when the player can't
 * cover them.
 */
export function stakeWagers(playerId: string, game: string, roundId: number, stakes: { amount: number, kind: string }[]): CommittedCoins<Balances & { wagerIds: string[] }> {
    return commitCoins((coins) => {
        const wagerIds: string[] = []
        for (const stake of stakes) {
            const paid = coins.stake({ playerId, amount: stake.amount, category: game })
            wagerIds.push(coins.tx.insert(tableWagers).values({ playerId, game, roundId, amount: stake.amount, amountChips: paid.chips, kind: stake.kind }).returning({ id: tableWagers.id }).get().id)
        }
        return { wagerIds, ...balancesOf(coins, playerId) }
    }, playerId)
}

/** Hand claimed rows back, each part in its own currency. Returns the total. */
function giveBack(coins: CoinWork, playerId: string, game: string, rows: { amount: number, amountChips: number }[]): number {
    const chipBack = sumCoins(rows.map(row => row.amountChips))
    const coinBack = normalizeCoins(sumCoins(rows.map(row => row.amount)) - chipBack)
    if (coinBack > 0) coins.credit({ playerId, amount: coinBack, category: game, refund: true })
    if (chipBack > 0) coins.creditChips({ playerId, amount: chipBack, reason: `refund:${game}` })
    return sumCoins([coinBack, chipBack])
}

export type SettleResult =
    /** `chipsEarned`: the payout, paid in chips; `rakeback`: the player's rakeback on the stakes (0 when it went to the host). */
    | ({ kind: 'settled', chipsEarned: number, rakeback: number } & Balances)
    /** Some of the stakes were already closed (a sweep refunded them): the rest came back as a refund. */
    | ({ kind: 'refunded', refunded: number } & Balances)
    /** Nothing was open any more: nothing moved. */
    | { kind: 'closed' }

/**
 * Close a player's round: claim every open row in `wagerIds` and pay `payout`
 * in chips. Only a claim of every row, adding up to `staked`, pays the
 * result; a partial claim means someone else already closed part of the
 * round, so what this call did claim is refunded instead of paid on top.
 */
export function settleWagers(input: {
    playerId: string
    game: string
    wagerIds: string[]
    staked: number
    payout: number
    summary: Record<string, unknown>
    /** The best return of one bet in the round (missions). */
    multiple?: number
    /** The casino the player sat down in when visiting: its owner gets the rakeback, and the hand counts toward the visit mission. */
    host?: string | null
}): CommittedCoins<SettleResult> {
    if (!isCoinAmount(input.payout)) throw new Error(`table payout must be coins with at most 4 decimals, got ${input.payout}`)
    return commitCoins((coins): SettleResult => {
        if (!input.wagerIds.length) return { kind: 'closed' }
        const claimed = coins.tx.update(tableWagers)
            .set({ status: 'settled', closedAt: new Date() })
            .where(and(inArray(tableWagers.id, input.wagerIds), eq(tableWagers.status, 'open'), eq(tableWagers.playerId, input.playerId)))
            .returning({ id: tableWagers.id, amount: tableWagers.amount, amountChips: tableWagers.amountChips })
            .all()
        if (!claimed.length) return { kind: 'closed' }
        const escrow = sumCoins(claimed.map(row => row.amount))
        if (claimed.length !== input.wagerIds.length || !sameCoins(escrow, input.staked)) {
            if (!sameCoins(escrow, input.staked) && claimed.length === input.wagerIds.length) {
                console.error(`[tables] ${input.game}: settle for ${input.playerId} staked ${input.staked} but escrow holds ${escrow}; refunding`)
            }
            coins.tx.update(tableWagers).set({ status: 'refunded' }).where(inArray(tableWagers.id, claimed.map(row => row.id))).run()
            const refunded = giveBack(coins, input.playerId, input.game, claimed)
            return { kind: 'refunded', refunded, ...balancesOf(coins, input.playerId) }
        }
        if (input.payout > 0) coins.creditChips({ playerId: input.playerId, amount: input.payout, reason: `win:${input.game}` })
        const { rakeback } = payRakeback(coins, { playerId: input.playerId, game: input.game, stake: input.staked, host: input.host })
        const stakeChips = sumCoins(claimed.map(row => row.amountChips))
        // A first hand of a game can reach a star goal, even a lost one whose rakeback went to the host.
        coins.checkStars(input.playerId)
        coins.tx.insert(gameRounds).values({
            playerId: input.playerId,
            game: input.game,
            stake: input.staked,
            stakeChips: stakeChips,
            payout: input.payout,
            funding: sameCoins(stakeChips, escrow) ? 'chips' : 'coins',
            summary: input.summary
        }).run()
        recordMissions(coins.tx, input.playerId, roundMissionEvents({ playerId: input.playerId, game: input.game, stake: input.staked, payout: input.payout, multiple: input.multiple, host: input.host }))
        return { kind: 'settled', chipsEarned: input.payout, rakeback, ...balancesOf(coins, input.playerId) }
    }, input.playerId)
}

/** Hand back every still-open row in `wagerIds`, each part in its own currency. Balances are null when nothing came back. */
export function refundWagers(playerId: string, game: string, wagerIds: string[]): CommittedCoins<{ refunded: number, balance: number | null, chips: number | null }> {
    return commitCoins((coins) => {
        if (!wagerIds.length) return { refunded: 0, balance: null, chips: null }
        const claimed = coins.tx.update(tableWagers)
            .set({ status: 'refunded', closedAt: new Date() })
            .where(and(inArray(tableWagers.id, wagerIds), eq(tableWagers.status, 'open'), eq(tableWagers.playerId, playerId)))
            .returning({ amount: tableWagers.amount, amountChips: tableWagers.amountChips })
            .all()
        const refunded = giveBack(coins, playerId, game, claimed)
        if (!refunded) return { refunded: 0, balance: null, chips: null }
        return { refunded, ...balancesOf(coins, playerId) }
    }, playerId)
}

/**
 * Refund open escrow that no live table holds: at boot every open row is an
 * orphan (the tables live in memory), later only rows older than `olderThan`
 * that aren't in `held`. One transaction per player, each part of a stake
 * back in its own currency. Returns how many rows came back.
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
