import { and, eq, lt, sql } from 'drizzle-orm'
import { db } from '../database'
import { gemConversions, gemPurchases, players } from '../database/schema'
import {
    COINS_PER_GEM,
    CONVERT_MAX_GEMS,
    CONVERT_MIN_GEMS
} from '../../shared/economy'
import { formatCoins } from '../../shared/money'
import { coinTransaction, getCoins } from './ledger'
import { hub, HubError, type HubSpendInput } from './hub'
import { syncStars, type StarChange } from './stars'
import { chipBalance } from './tycoon'
import { CASINO_GAME_SLUG, starSummary, type StarSummary } from '../../shared/stars'

type Conversion = typeof gemConversions.$inferSelect

/** A pending conversion this old is taken as abandoned and retried with its key. */
export const STALE_CONVERSION_MS = 60_000

export interface ConvertResult {
    conversionId: string
    gems: number
    coins: number
    balance: number
    /** The player's gems after the spend, as the hub reported it. */
    gemsLeft: number
    /** The star level change this conversion caused, if the hub confirmed one. */
    stars: StarChange | null
}

/**
 * Whether a hub refusal proves that no attempt with this idempotency key
 * spent gems, so the conversion can be marked failed.
 *
 * - 400 (can't afford, over the unverified cap) is decided after the hub's
 *   idempotency lookup: an earlier attempt that landed would have replayed.
 * - Any other 4xx (401 bad key, 403 not connected, 404, 409 spend in
 *   progress, 429 rate limited) is decided before that lookup, so it proves
 *   nothing on a retry: the first attempt may have timed out after the hub
 *   committed the spend. Only the first attempt can trust it.
 */
export function spendNeverLanded(error: HubError, firstAttempt: boolean): boolean {
    return error.statusCode === 400 || (firstAttempt && error.rejected)
}

/** A table of pending gem spends (gem_conversions, gem_purchases): the columns spendForRow touches. */
type SpendTable = typeof gemConversions | typeof gemPurchases

/**
 * Spend gems at the hub for one pending row, no transaction open: counts the
 * attempt, calls the hub with the row's idempotency key, and on a refusal
 * that proves nothing was spent (`spendNeverLanded`) flips the row
 * `pending → failed` and throws 400. Anything else (hub down, 5xx, a refusal
 * on a retry) leaves it pending and throws 503 with `retryMessage`. The
 * caller settles the row in its own guarded transaction.
 */
export async function spendForRow(input: { table: SpendTable, id: string, spend: HubSpendInput, retryMessage: string }): Promise<{ spendId: string, gems: number }> {
    const table = input.table as typeof gemConversions
    const counted = db.update(table)
        .set({ attempts: sql`${table.attempts} + 1` })
        .where(eq(table.id, input.id))
        .returning({ attempts: table.attempts })
        .get()
    const firstAttempt = counted?.attempts === 1
    try {
        return await hub.spendGems(input.spend)
    } catch (error) {
        if (error instanceof HubError && spendNeverLanded(error, firstAttempt)) {
            db.update(table)
                .set({ status: 'failed', error: error.message, settledAt: new Date() })
                .where(and(eq(table.id, input.id), eq(table.status, 'pending')))
                .run()
            throw createError({ statusCode: 400, statusMessage: error.message || 'Not enough gems' })
        }
        throw createError({ statusCode: 503, statusMessage: input.retryMessage })
    }
}

/**
 * Settle one pending conversion in three steps, none of which holds a lock
 * across the network call:
 *   1. spend at the hub (idempotent on the row's key);
 *   2. in one immediate transaction, flip the row `pending → done` and credit
 *      the coins. The conditional update is the guard: settling the same row
 *      twice at once credits once, the loser gets no row back;
 *   3. report any star the credit earned.
 * A refusal that proves nothing was spent marks the row failed; anything
 * else (hub down, 5xx, a refusal on a retry) leaves it pending for a retry.
 */
export async function settleConversion(row: Conversion): Promise<ConvertResult> {
    const spend = await spendForRow({
        table: gemConversions,
        id: row.id,
        spend: {
            playerId: row.playerId,
            amount: row.gems,
            game: CASINO_GAME_SLUG,
            reason: `Convert ${row.gems} gems to ${formatCoins(row.coins)} coins`,
            idempotencyKey: row.idempotencyKey
        },
        retryMessage: 'The hub did not answer; your conversion finishes on its own once it is back'
    })

    const { value: balance, stars } = await coinTransaction((coins) => {
        const claimed = coins.tx.update(gemConversions)
            .set({ status: 'done', spendId: spend.spendId, error: null, settledAt: new Date() })
            .where(and(eq(gemConversions.id, row.id), eq(gemConversions.status, 'pending')))
            .returning({ id: gemConversions.id })
            .get()
        if (!claimed) return null
        return coins.credit({ playerId: row.playerId, amount: row.coins, category: 'convert' })
    })
    if (!balance) throw createError({ statusCode: 409, statusMessage: 'Conversion already settled' })

    return { conversionId: row.id, gems: row.gems, coins: row.coins, balance: balance.coins, gemsLeft: spend.gems, stars: stars[0] ?? null }
}

function stalePending(playerId?: string) {
    const cutoff = new Date(Date.now() - STALE_CONVERSION_MS)
    return db.select().from(gemConversions).where(and(
        eq(gemConversions.status, 'pending'),
        lt(gemConversions.createdAt, cutoff),
        playerId ? eq(gemConversions.playerId, playerId) : undefined
    )).limit(playerId ? 5 : 200).all()
}

/**
 * Retry abandoned pending conversions, for one player or (boot sweep) all.
 * Failures stay pending for the next try. Returns how many settled.
 */
export async function retryStaleConversions(playerId?: string) {
    let settled = 0
    for (const row of stalePending(playerId)) {
        try {
            await settleConversion(row)
            settled++
        } catch {
            // Hub still down, the hub refused, or a parallel retry won.
        }
    }
    return settled
}

export function parseGemAmount(value: unknown): number {
    const gems = Number(value)
    if (!Number.isInteger(gems) || gems < CONVERT_MIN_GEMS || gems > CONVERT_MAX_GEMS) {
        throw createError({ statusCode: 400, statusMessage: `Convert between ${CONVERT_MIN_GEMS} and ${CONVERT_MAX_GEMS} gems` })
    }
    return gems
}

/** Convert gems (spent and burned at the hub) into coins. One-way. */
export async function convertGems(playerId: string, gems: number): Promise<ConvertResult> {
    if (getCoins(playerId)?.origin !== 'hub') {
        throw createError({ statusCode: 400, statusMessage: 'Converting gems needs a hub account' })
    }
    await retryStaleConversions(playerId)
    const row = db.insert(gemConversions).values({
        playerId,
        gems,
        coins: gems * COINS_PER_GEM,
        idempotencyKey: crypto.randomUUID()
    }).returning().get()
    return settleConversion(row)
}

export interface WalletState {
    coins: number
    peakCoins: number
    /** My Casino chips: what wins pay and what the stars follow. */
    chips: number
    /** Gems at the hub, or null when the hub could not be reached or the player has no hub account. */
    gems: number | null
    /** False for dev-login players: no gems, no convert, no star reports. */
    hubAccount: boolean
    coinsPerGem: number
    convert: { min: number, max: number }
    /** The star level, from the chip balance. */
    stars: StarSummary
    /** A level change this read confirmed with the hub (a retried report). */
    starChange: StarChange | null
}

/** Everything the wallet UI shows. Also retries stale conversions and star reports. */
export async function getWallet(playerId: string): Promise<WalletState> {
    await retryStaleConversions(playerId)
    const starChange = await syncStars(playerId)
    const balance = getCoins(playerId)
    if (!balance) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const hubAccount = balance.origin === 'hub'
    const chips = chipBalance(playerId)
    let gems: number | null = null
    if (hubAccount) {
        try {
            gems = (await hub.getPlayer(playerId)).gems
        } catch {
            gems = null
        }
    }

    return {
        coins: balance.coins,
        peakCoins: balance.peakCoins,
        chips,
        gems,
        hubAccount,
        coinsPerGem: COINS_PER_GEM,
        convert: { min: CONVERT_MIN_GEMS, max: CONVERT_MAX_GEMS },
        stars: starSummary(chips, starChange?.level ?? reportedLevel(playerId)),
        starChange
    }
}

function reportedLevel(playerId: string) {
    return db.select({ level: players.starsReported }).from(players).where(eq(players.id, playerId)).get()?.level ?? 0
}
