import { and, desc, eq, sql } from 'drizzle-orm'
import { db, type DbExecutor, type Tx, writeTx } from '../database'
import { coinTransactions, players } from '../database/schema'
import { starLevel } from '../../shared/stars'
import { syncStars, type StarChange } from './stars'

/**
 * The coin ledger, and the only way coins change. Work runs inside
 * `coinTransaction`: one immediate SQLite transaction (synchronous, so it
 * never spans an await), and after it commits, the star level of every player
 * whose balance crossed a threshold is reported to the hub (a level still due
 * from a failed report is retried in the background). A game cannot move
 * coins without its stars following.
 *
 * Amounts are whole positive coins. Every change writes a coin_transactions
 * row; its id is the `seq` star reports use.
 */

export interface CoinChange {
    playerId: string
    amount: number
    /** The game's plain lowercase name: 'dice', 'spinata', 'convert', 'allowance'. */
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
}

function assertAmount(amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid amount' })
    }
}

/** A balance as the ledger sees it: plus the level the hub last confirmed. */
interface LedgerBalance extends CoinBalance {
    starsReported: number
}

const balanceColumns = { coins: players.coins, peakCoins: players.peakCoins, starsReported: players.starsReported }

function applyCredit(tx: Tx, change: CoinChange): LedgerBalance {
    assertAmount(change.amount)
    // Balance and peak move in one statement. In SET, `coins` is the old value
    // on both sides, so the peak can never lag behind a credit that beat it.
    const updated = tx.update(players)
        .set({
            coins: sql`${players.coins} + ${change.amount}`,
            peakCoins: sql`max(${players.peakCoins}, ${players.coins} + ${change.amount})`,
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
function applyDebit(tx: Tx, change: Omit<CoinChange, 'refund'>): LedgerBalance {
    assertAmount(change.amount)
    const updated = tx.update(players)
        .set({ coins: sql`${players.coins} - ${change.amount}`, updatedAt: new Date() })
        .where(and(eq(players.id, change.playerId), sql`${players.coins} >= ${change.amount}`))
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
    const before = new Map<string, number>()
    const after = new Map<string, LedgerBalance>()
    const value = writeTx((tx) => {
        const track = (playerId: string, balance: LedgerBalance, delta: number): CoinBalance => {
            if (!before.has(playerId)) before.set(playerId, balance.coins - delta)
            after.set(playerId, balance)
            return { coins: balance.coins, peakCoins: balance.peakCoins }
        }
        return work({
            tx,
            credit: change => track(change.playerId, applyCredit(tx, change), change.amount),
            debit: change => track(change.playerId, applyDebit(tx, change), -change.amount)
        })
    })
    return { value, stars: reportStars(before, after) }
}

async function reportStars(before: Map<string, number>, after: Map<string, LedgerBalance>): Promise<StarChange[]> {
    const stars: StarChange[] = []
    for (const [playerId, balance] of after) {
        const level = starLevel(balance.coins)
        if (level !== starLevel(before.get(playerId)!)) {
            // The level moved: report it now, so the response can celebrate it.
            const change = await syncStars(playerId).catch(() => null)
            if (change) stars.push(change)
        } else if (level !== balance.starsReported && !retrying.has(playerId)) {
            // Still due from a report that failed earlier: retry without
            // holding up this response, one retry per player at a time.
            retrying.add(playerId)
            void syncStars(playerId).catch(() => null).finally(() => retrying.delete(playerId))
        }
    }
    return stars
}

const retrying = new Set<string>()

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
