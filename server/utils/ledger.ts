import { and, desc, eq, sql } from 'drizzle-orm'
import { db, type DbExecutor, type Tx, writeTx } from '../database'
import { casinoProfiles, coinTransactions, players } from '../database/schema'
import { isCoinAmount, toUnits } from '../../shared/money'
import { starLevel } from '../../shared/stars'
import { splitStake, type StakeSplit } from '../../shared/tycoon'
import { creditChips, debitChips, watchChips, type ChipChange } from './chips'
import { syncStars, type StarChange } from './stars'

/**
 * The coin ledger, and the only way coins change; also the unit every chip
 * move runs in. Work runs inside `coinTransaction`: one immediate SQLite
 * transaction (synchronous, so it never spans an await). Stars follow the
 * **chip** balance (economy v2): the unit watches every chip move
 * (server/utils/chips.ts), and after it commits, the star level of every
 * player whose chips crossed a threshold is reported to the hub (a level
 * still due from a failed report is retried in the background, on any coin or
 * chip change). Nothing can move chips without the stars following.
 *
 * Amounts are positive coins with at most four decimals; the database holds
 * them as units of 1/10,000 coin (schema.ts converts its columns, the raw SQL
 * here binds `toUnits` itself). Every change writes a coin_transactions row.
 */

export interface CoinChange {
    playerId: string
    amount: number
    /** The game's plain lowercase name: 'dice', 'spinata', 'convert', 'cage'. */
    category: string
    /** The player's own money coming back (a crash refund). Never counts as income. */
    refund?: boolean
}

export interface CoinBalance {
    coins: number
    peakCoins: number
}

export interface CoinWork {
    /** The open transaction, for the caller's own writes in the same unit. */
    tx: Tx
    /** Add coins. Returns the new balance. */
    credit(change: CoinChange): CoinBalance
    /** Take coins; throws 400 when the player can't afford it, so never pre-check. */
    debit(change: Omit<CoinChange, 'refund'>): CoinBalance
    /** Add chips (server/utils/chips.ts). Returns the chip balance after. */
    creditChips(change: ChipChange): number
    /** Take chips; throws 400 'Not enough chips', so never pre-check. Returns the chip balance after. */
    debitChips(change: ChipChange): number
    /**
     * Take a stake: coins first, then chips for whatever coins don't cover
     * (`splitStake`), each part a guarded debit. Throws 400 'Not enough coins
     * or chips' when both together can't cover it.
     */
    stake(change: StakeChange): StakeResult
}

export interface StakeChange {
    playerId: string
    amount: number
    /** The coin ledger category (the game's slug); chips go as `bet:<category>`. */
    category: string
}

export interface StakeResult extends StakeSplit {
    /** Balances after. */
    balance: number
    chipBalance: number
}

/** The amount in database units; throws 400 unless it is a positive coin amount (four decimals at most). */
function amountUnits(amount: number): number {
    const units = isCoinAmount(amount) ? toUnits(amount) : 0
    if (units <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid amount' })
    return units
}

const balanceColumns = { coins: players.coins, peakCoins: players.peakCoins }

function applyCredit(tx: Tx, change: CoinChange): CoinBalance {
    const units = amountUnits(change.amount)
    // Balance and peak move in one statement. In SET, `coins` is the old value
    // on both sides, so the peak can never lag behind a credit that beat it.
    const updated = tx.update(players)
        .set({
            coins: sql`${players.coins} + ${units}`,
            peakCoins: sql`max(${players.peakCoins}, ${players.coins} + ${units})`,
            updatedAt: new Date()
        })
        .where(eq(players.id, change.playerId))
        .returning(balanceColumns)
        .get()
    if (!updated) throw createError({ statusCode: 404, statusMessage: 'Player not found' })

    tx.insert(coinTransactions).values({
        playerId: change.playerId,
        amount: change.amount,
        type: 'credit',
        category: change.category,
        refund: change.refund === true,
        balanceAfter: updated.coins
    }).run()
    return updated
}

// The `coins >= amount` guard lives in the WHERE clause: the check and the
// decrement are one statement, so nothing can push a balance negative.
function applyDebit(tx: Tx, change: Omit<CoinChange, 'refund'>): CoinBalance {
    const units = amountUnits(change.amount)
    const updated = tx.update(players)
        .set({ coins: sql`${players.coins} - ${units}`, updatedAt: new Date() })
        .where(and(eq(players.id, change.playerId), sql`${players.coins} >= ${units}`))
        .returning(balanceColumns)
        .get()
    if (!updated) throw createError({ statusCode: 400, statusMessage: 'Not enough coins' })

    tx.insert(coinTransactions).values({
        playerId: change.playerId,
        amount: change.amount,
        type: 'debit',
        category: change.category,
        balanceAfter: updated.coins
    }).run()
    return updated
}

export interface CoinTransactionResult<T> {
    value: T
    /** Star levels the hub confirmed after commit, one per player whose level moved. */
    stars: StarChange[]
}

/**
 * Run coin work atomically, then report star levels that moved. `work` must be
 * synchronous; a thrown error rolls back every change in it.
 */
export async function coinTransaction<T>(work: (coins: CoinWork) => T): Promise<CoinTransactionResult<T>> {
    const { value, stars } = commitCoins(work)
    return { value, stars: await stars }
}

export interface CommittedCoins<T> {
    value: T
    /** Resolves once the hub has heard about every level that moved (never rejects). */
    stars: Promise<StarChange[]>
}

/**
 * The same unit as `coinTransaction`, committed synchronously: it returns (or
 * throws) once the transaction is done, and hands back the star report as a
 * promise instead of waiting for it. The live tables use this so a slow hub
 * never holds up a table's queue; the report itself is identical.
 */
export function commitCoins<T>(work: (coins: CoinWork) => T): CommittedCoins<T> {
    // Chip balance before (first move) and after (last move), per player.
    const chips = new Map<string, { before: number, after: number }>()
    const touched = new Set<string>()
    const value = writeTx(tx => watchChips((playerId, before, after) => {
        const seen = chips.get(playerId)
        chips.set(playerId, { before: seen?.before ?? before, after })
        touched.add(playerId)
    }, () => work({
        tx,
        credit: (change) => {
            touched.add(change.playerId)
            return applyCredit(tx, change)
        },
        debit: (change) => {
            touched.add(change.playerId)
            return applyDebit(tx, change)
        },
        creditChips: change => creditChips(tx, change),
        debitChips: change => debitChips(tx, change),
        stake: (change) => {
            touched.add(change.playerId)
            return takeStake(tx, change)
        }
    })))
    return { value, stars: reportStars(touched, chips) }
}

async function reportStars(touched: Set<string>, chips: Map<string, { before: number, after: number }>): Promise<StarChange[]> {
    const stars: StarChange[] = []
    for (const playerId of touched) {
        const moved = chips.get(playerId)
        if (moved && starLevel(moved.after) !== starLevel(moved.before)) {
            // The level moved: report it now, so the response can celebrate it.
            const change = await syncStars(playerId).catch(() => null)
            if (change) stars.push(change)
        } else if (!retrying.has(playerId) && starsDue(playerId)) {
            // Still due from a report that failed earlier: retry without
            // holding up this response, one retry per player at a time.
            retrying.add(playerId)
            void syncStars(playerId).catch(() => null).finally(() => retrying.delete(playerId))
        }
    }
    return stars
}

const retrying = new Set<string>()

/** Whether the hub holds another level than the chips say (a report is due). */
function starsDue(playerId: string): boolean {
    try {
        return dueRow(playerId)
    } catch {
        return false
    }
}

function dueRow(playerId: string): boolean {
    const row = db.select({ reported: players.starsReported, origin: players.origin, chips: casinoProfiles.chips })
        .from(players)
        .leftJoin(casinoProfiles, eq(casinoProfiles.playerId, players.id))
        .where(eq(players.id, playerId))
        .get()
    return !!row && row.origin === 'hub' && starLevel(row.chips ?? 0) !== row.reported
}

/**
 * Split a stake against the balances as this transaction sees them (it holds
 * the write lock, so they can't move under it) and debit each part with its
 * own guard: the coin debit checks `coins >= part`, the chip debit
 * `chips >= part`. Either failing rolls the whole unit back.
 */
function takeStake(tx: Tx, change: StakeChange): StakeResult {
    if (!isCoinAmount(change.amount) || change.amount <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid amount' })
    const held = tx.select({ coins: players.coins, chips: casinoProfiles.chips })
        .from(players)
        .leftJoin(casinoProfiles, eq(casinoProfiles.playerId, players.id))
        .where(eq(players.id, change.playerId))
        .get()
    if (!held) throw createError({ statusCode: 404, statusMessage: 'Player not found' })
    const split = splitStake(change.amount, held.coins, held.chips ?? 0)
    if (!split) throw createError({ statusCode: 400, statusMessage: 'Not enough coins or chips' })
    const balance = split.coins > 0 ? applyDebit(tx, { playerId: change.playerId, amount: split.coins, category: change.category }).coins : held.coins
    const chipBalance = split.chips > 0 ? debitChips(tx, { playerId: change.playerId, amount: split.chips, reason: `bet:${change.category}` }) : held.chips ?? 0
    return { ...split, balance, chipBalance }
}

export function getCoins(playerId: string, ex: DbExecutor = db) {
    return ex.select({ coins: players.coins, peakCoins: players.peakCoins, origin: players.origin })
        .from(players).where(eq(players.id, playerId)).get() ?? null
}

export function listCoinHistory(playerId: string, limit = 50) {
    return db.select({
        id: coinTransactions.id,
        amount: coinTransactions.amount,
        type: coinTransactions.type,
        category: coinTransactions.category,
        refund: coinTransactions.refund,
        balanceAfter: coinTransactions.balanceAfter,
        createdAt: coinTransactions.createdAt
    })
        .from(coinTransactions)
        .where(eq(coinTransactions.playerId, playerId))
        .orderBy(desc(coinTransactions.id))
        .limit(Math.max(1, Math.min(200, Math.floor(limit) || 50)))
        .all()
}
