import { and, eq, lt } from 'drizzle-orm'
import { db, type Tx, writeTx } from '../database'
import { gemPurchases } from '../database/schema'
import { findGame } from '../../shared/games/registry'
import { CASINO_GAME_SLUG } from '../../shared/stars'
import {
    BUILDER_GEMS,
    builderCount,
    GOLDEN_GEMS,
    RUSH_MS,
    rushGems,
    skipGems,
    type BuildKind,
    type GemBody,
    type GemItem,
    findTycoonGame,
    type TycoonActionResponse
} from '../../shared/tycoon'
import { findCosmetic } from '../../shared/cosmetics'
import { cosmeticGemPrice, grantCosmetic } from './cosmetics'
import { hub, HubError } from './hub'
import { syncStars } from './stars'
import { accrueCage, advanceCasino, finishConstruction, isHubPlayer, readTycoonState, saveCasino } from './tycoon'
import { spendForRow, STALE_CONVERSION_MS } from './wallet'

/**
 * Gem purchases in My Casino, the convert flow exactly:
 *   1. in one immediate transaction, check the purchase against the casino
 *      as it is now, price it and insert a `pending` gem_purchases row (one
 *      pending row per player, item and target: a double tap gets a 409);
 *   2. spend at the hub with the row's idempotency key, no transaction open;
 *   3. in a separate immediate transaction, flip the row `pending → done`
 *      (the guard) and deliver the item.
 * A refusal that proves nothing was spent marks the row failed; anything
 * else leaves it pending, retried with the same key on the player's next
 * purchase and by the hub-sync sweep.
 */

type Purchase = typeof gemPurchases.$inferSelect

const ITEMS: readonly GemItem[] = ['skip', 'rush', 'builder', 'golden', 'cosmetic']
const KINDS: readonly BuildKind[] = ['zone', 'game', 'upgrade']

export function parseGemBody(body: unknown): GemBody {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
    if (typeof input.item !== 'string' || !ITEMS.includes(input.item as GemItem)) {
        throw createError({ statusCode: 400, statusMessage: 'item is skip, rush, builder, golden or cosmetic' })
    }
    const item = input.item as GemItem
    if (item === 'skip' || item === 'golden' || item === 'cosmetic') {
        if (typeof input.target !== 'string' || !input.target || input.target.length > 60) {
            throw createError({ statusCode: 400, statusMessage: item === 'skip' ? 'target is the construction, as kind:id' : item === 'golden' ? 'target is the game' : 'target is the cosmetic, like hat:crown' })
        }
        return { item, target: input.target }
    }
    if (input.target !== undefined) throw createError({ statusCode: 400, statusMessage: `${item} takes no target` })
    return { item }
}

/** What the purchase costs now, or a 400 when it can't be bought. Runs inside the insert's transaction. */
function priceOf(tx: Tx, playerId: string, body: GemBody, now: number): { gems: number, target: string } {
    const casino = advanceCasino(tx, playerId, now)
    const refuse = (message: string): never => {
        throw createError({ statusCode: 400, statusMessage: message })
    }
    switch (body.item) {
        case 'skip': {
            const [kind, id] = body.target!.split(':') as [string, string | undefined]
            const running = KINDS.includes(kind as BuildKind) && id
                ? casino.constructions.find(row => row.kind === kind && row.target === id)
                : undefined
            if (!running) refuse('Nothing is being built there')
            // The construction's own id rides along: a skip that settles late
            // must never finish a later build of the same thing.
            return { gems: skipGems(running!.readyAt.getTime() - now), target: `${kind}:${id}:${running!.id}` }
        }
        case 'rush':
            // Priced from the casino's full floor, like a skip from the time left.
            return { gems: rushGems(casino), target: '' }
        case 'builder':
            // The gem builder is its own source: the Construction Crew (chips)
            // doesn't use it up, and it is bought once.
            if (casino.gemBuilder) refuse('You already hired the gem builder')
            return { gems: BUILDER_GEMS, target: '' }
        case 'golden': {
            const slug = body.target!
            if (!findTycoonGame(slug) || !Object.hasOwn(casino.games, slug) || (casino.games[slug] ?? 0) < 1) refuse('Build that game first')
            if (casino.golden.includes(slug)) refuse('That game is golden already')
            return { gems: GOLDEN_GEMS, target: slug }
        }
        case 'cosmetic':
            return { gems: cosmeticGemPrice(tx, playerId, body.target!), target: body.target! }
    }
}

/** Deliver a purchase whose gems were spent. Runs in the settle transaction. False: nothing to deliver (refund it). */
function deliver(tx: Tx, row: Purchase, now: number): boolean {
    switch (row.item) {
        case 'skip': {
            const [kind, id, constructionId] = row.target.split(':') as [BuildKind, string, string | undefined]
            // Finished on its own in the meantime: the gems go back.
            return finishConstruction(tx, row.playerId, kind, id, now, constructionId)
        }
        case 'rush': {
            const casino = advanceCasino(tx, row.playerId, now)
            accrueCage(casino, now)
            casino.rushUntil = Math.max(now, casino.rushUntil ?? 0) + RUSH_MS
            saveCasino(tx, casino)
            return true
        }
        case 'builder': {
            const casino = advanceCasino(tx, row.playerId, now)
            // Hired already (a second purchase that got past the check): the gems go back.
            if (casino.gemBuilder) return false
            casino.gemBuilder = true
            casino.builders = builderCount(casino.upgrades, true)
            saveCasino(tx, casino)
            return true
        }
        case 'chips':
            // A chip pack from before economy v2 that never settled: gems no
            // longer buy chips (they set the star level), so it is refunded.
            return false
        case 'golden': {
            const casino = advanceCasino(tx, row.playerId, now)
            if (!casino.golden.includes(row.target)) casino.golden = [...casino.golden, row.target]
            saveCasino(tx, casino)
            return true
        }
        case 'cosmetic':
            // Owned already (a second purchase that got past the check): the gems go back.
            return grantCosmetic(tx, row.playerId, row.target)
    }
}

/** Spend the row's gems at the hub, then flip it done and deliver. Returns the gems left at the hub. */
export async function settlePurchase(row: Purchase): Promise<number> {
    const spend = await spendForRow({
        table: gemPurchases,
        id: row.id,
        spend: { playerId: row.playerId, amount: row.gems, game: CASINO_GAME_SLUG, reason: reasonOf(row), idempotencyKey: row.idempotencyKey },
        retryMessage: 'The hub did not answer; your purchase finishes on its own once it is back'
    })
    const delivered = writeTx((tx) => {
        const claimed = tx.update(gemPurchases)
            .set({ status: 'done', spendId: spend.spendId, error: null, settledAt: new Date() })
            .where(and(eq(gemPurchases.id, row.id), eq(gemPurchases.status, 'pending')))
            .returning({ id: gemPurchases.id })
            .get()
        if (!claimed) return 'claimed'
        if (deliver(tx, row, Date.now())) return 'delivered'
        // Nothing to deliver: the gems go back. `refund_due` until the hub confirms the refund.
        tx.update(gemPurchases)
            .set({ status: 'refund_due', error: REFUND_NOTE[row.item] ?? 'Finished before the skip landed; refunded' })
            .where(eq(gemPurchases.id, row.id))
            .run()
        return 'refund'
    })
    if (delivered === 'claimed') throw createError({ statusCode: 409, statusMessage: 'Purchase already settled' })
    if (delivered === 'refund') return (await refundPurchase(row.id, spend.spendId)) ?? spend.gems
    return spend.gems
}

/**
 * Hand back the gems of a `refund_due` purchase. No transaction is open
 * across the hub call; the hub refunds a spend only once, so a retry (the
 * sweep) can't double it. The answer flips the row: `refund_due → refunded`
 * on success, `→ refund_failed` when the hub refuses (4xx: refunded already
 * or past its 24 h window, so retrying won't help; logged for a person).
 * Hub down or 5xx: it stays `refund_due` for the next sweep. Returns the gem
 * balance after a refund, else null.
 */
export async function refundPurchase(id: string, spendId: string): Promise<number | null> {
    try {
        const { gems } = await hub.refundGems(spendId)
        db.update(gemPurchases)
            .set({ status: 'refunded', settledAt: new Date() })
            .where(and(eq(gemPurchases.id, id), eq(gemPurchases.status, 'refund_due')))
            .run()
        return gems
    } catch (error) {
        if (error instanceof HubError && error.rejected) {
            console.error('[tycoon] the hub refused a gem refund', id, error.message)
            db.update(gemPurchases)
                .set({ status: 'refund_failed', error: `Refund refused: ${error.message}`.slice(0, 300) })
                .where(and(eq(gemPurchases.id, id), eq(gemPurchases.status, 'refund_due')))
                .run()
        } else {
            console.error('[tycoon] refunding a purchase failed; the sweep retries it', id, error)
        }
        return null
    }
}

const REFUND_NOTE: Partial<Record<Purchase['item'], string>> = {
    chips: 'Chip packs are gone; refunded',
    builder: 'The gem builder was hired already; refunded',
    cosmetic: 'Owned already; refunded'
}

function reasonOf(row: Purchase): string {
    switch (row.item) {
        case 'skip': return `Finish a build in My Casino now (${row.gems} gems)`
        case 'rush': return 'Guest rush in My Casino'
        case 'builder': return 'An extra builder in My Casino'
        case 'chips': return 'A chip pack in My Casino (no longer sold)'
        case 'golden': return `Golden ${findGame(row.target)?.name ?? row.target} in My Casino`
        case 'cosmetic': return `${findCosmetic(row.target)?.name ?? row.target} in My Casino (cosmetic)`
    }
}

/**
 * Retry abandoned pending purchases, and refunds still due, for one player
 * or (sweep) all. Failures stay as they are for the next try. Returns how
 * many purchases settled (refunds not counted).
 */
export async function retryStalePurchases(playerId?: string): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_CONVERSION_MS)
    const rows = db.select().from(gemPurchases).where(and(
        eq(gemPurchases.status, 'pending'),
        lt(gemPurchases.createdAt, cutoff),
        playerId ? eq(gemPurchases.playerId, playerId) : undefined
    )).limit(playerId ? 5 : 200).all()
    let settled = 0
    for (const row of rows) {
        try {
            await settlePurchase(row)
            settled++
            // Delivered outside a coin unit (a skip, a cosmetic): report a goal it reached.
            void syncStars(row.playerId)
        } catch {
            // Hub still down, the hub refused, or a parallel retry won.
        }
    }
    await retryDueRefunds(playerId)
    return settled
}

/**
 * Refund every `refund_due` purchase (of one player, or all) left for a
 * while: a fresh one is still being refunded by its own request, and a
 * second call racing it would get the hub's "refunded already" refusal.
 * Returns how many were refunded.
 */
export async function retryDueRefunds(playerId?: string): Promise<number> {
    const due = db.select({ id: gemPurchases.id, spendId: gemPurchases.spendId }).from(gemPurchases).where(and(
        eq(gemPurchases.status, 'refund_due'),
        lt(gemPurchases.settledAt, new Date(Date.now() - STALE_CONVERSION_MS)),
        playerId ? eq(gemPurchases.playerId, playerId) : undefined
    )).limit(playerId ? 5 : 200).all()
    let refunded = 0
    for (const row of due) {
        if (row.spendId && await refundPurchase(row.id, row.spendId) !== null) refunded++
    }
    return refunded
}

/** POST /api/tycoon/gems: buy a My Casino item with gems. */
export async function buyWithGems(playerId: string, body: GemBody): Promise<TycoonActionResponse> {
    if (!isHubPlayer(playerId)) throw createError({ statusCode: 403, statusMessage: 'Gems need a hub account' })
    await retryStalePurchases(playerId)
    const now = Date.now()
    const row = writeTx((tx) => {
        const price = priceOf(tx, playerId, body, now)
        const inserted = tx.insert(gemPurchases).values({
            playerId,
            item: body.item,
            target: price.target,
            gems: price.gems,
            idempotencyKey: crypto.randomUUID()
        }).onConflictDoNothing().returning().get()
        if (!inserted) throw createError({ statusCode: 409, statusMessage: 'That purchase is already on its way' })
        return inserted
    })
    const gems = await settlePurchase(row)
    // A skip can finish a build and a cosmetic complete the wardrobe: the read reports the star level.
    const { stars, ...state } = await readTycoonState(playerId)
    return { state, coins: null, gems, collected: 0, stars: stars ?? null }
}
