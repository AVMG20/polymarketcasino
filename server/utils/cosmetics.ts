import { and, eq } from 'drizzle-orm'
import { db, type DbExecutor, type Tx, writeTx } from '../database'
import { casinoCosmetics, casinoProfiles } from '../database/schema'
import {
    findCosmetic,
    isFree,
    normalizeAvatar,
    normalizeSkins,
    type AvatarLook,
    type AvatarSlot,
    type CosmeticBuyBody,
    type CosmeticDef,
    type CosmeticEquipBody,
    type CosmeticsState,
    type SkinId,
    type ZoneSkins
} from '../../shared/cosmetics'
import { findZone, type TycoonActionResponse, type ZoneId } from '../../shared/tycoon'
import { coinTransaction } from './ledger'
import { ownStarChange } from './stars'
import { advanceCasino, getTycoonState } from './tycoon'

/**
 * Cosmetics (shared/cosmetics.ts): avatar items and zone skins. Nothing here
 * touches odds, income or the casino value.
 *
 * - Owning: a casino_cosmetics row per player and key; its primary key is
 *   the guard, so parallel buys pay once. Free items are never stored.
 * - Chip prices (zone skins) are paid here, in one coinTransaction with the
 *   ownership insert (the debit is the affordability guard, the insert the
 *   double-buy guard). Gem prices go through the gem purchase flow
 *   (tycoon-gems.ts, item 'cosmetic'), which calls `cosmeticGemPrice` and
 *   `grantCosmetic`.
 * - Equipping is free and needs the item owned; a skin goes on an owned zone.
 */

const KEY = /^[a-z]{1,12}:[a-z]{1,16}$/

/** The request's `{ key, zone? }`, typed: anything else is a 400. */
export function parseCosmeticBody(body: unknown): CosmeticBuyBody & CosmeticEquipBody {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
    if (typeof input.key !== 'string' || !KEY.test(input.key) || !findCosmetic(input.key)) {
        throw createError({ statusCode: 400, statusMessage: 'key names a cosmetic, like hat:tophat or skin:royal' })
    }
    const def = findCosmetic(input.key)!
    if (input.zone === undefined) return { key: def.key }
    if (def.slot !== 'skin') throw createError({ statusCode: 400, statusMessage: 'Only a skin goes on a zone' })
    if (typeof input.zone !== 'string' || !findZone(input.zone)) throw createError({ statusCode: 400, statusMessage: 'zone names one of your zones' })
    return { key: def.key, zone: input.zone as ZoneId }
}

function ownedKeys(playerId: string, ex: DbExecutor): string[] {
    return ex.select({ item: casinoCosmetics.item }).from(casinoCosmetics).where(eq(casinoCosmetics.playerId, playerId)).all()
        .map(row => row.item)
        .filter(key => !!findCosmetic(key))
}

function owns(playerId: string, def: CosmeticDef, ex: DbExecutor): boolean {
    if (isFree(def)) return true
    return !!ex.select({ item: casinoCosmetics.item }).from(casinoCosmetics)
        .where(and(eq(casinoCosmetics.playerId, playerId), eq(casinoCosmetics.item, def.key))).get()
}

/** The player's cosmetics: what they wear, their zone skins and what they bought. */
export function cosmeticsOf(playerId: string, ex: DbExecutor = db): CosmeticsState {
    const row = ex.select({ avatar: casinoProfiles.avatar, skins: casinoProfiles.skins }).from(casinoProfiles).where(eq(casinoProfiles.playerId, playerId)).get()
    return {
        avatar: normalizeAvatar(row?.avatar),
        skins: normalizeSkins(row?.skins),
        owned: ownedKeys(playerId, ex)
    }
}

/** What a player's avatar wears, for other players (visits, the leaderboard, live table seats). */
export function avatarOf(playerId: string, ex: DbExecutor = db): AvatarLook {
    const row = ex.select({ avatar: casinoProfiles.avatar }).from(casinoProfiles).where(eq(casinoProfiles.playerId, playerId)).get()
    return normalizeAvatar(row?.avatar)
}

/** A casino's zone skins, for its visitors. */
export function skinsOf(playerId: string, ex: DbExecutor = db): ZoneSkins {
    const row = ex.select({ skins: casinoProfiles.skins }).from(casinoProfiles).where(eq(casinoProfiles.playerId, playerId)).get()
    return normalizeSkins(row?.skins)
}

/** Put an owned skin on an owned zone, or wear an owned avatar item, inside `tx`. */
function equipIn(tx: Tx, playerId: string, def: CosmeticDef, zone: ZoneId | undefined, now: number) {
    const casino = advanceCasino(tx, playerId, now)
    const row = tx.select({ avatar: casinoProfiles.avatar, skins: casinoProfiles.skins }).from(casinoProfiles).where(eq(casinoProfiles.playerId, playerId)).get()!
    if (def.slot === 'skin') {
        if (!zone) throw createError({ statusCode: 400, statusMessage: 'zone names the zone to skin' })
        if (!casino.zones.includes(zone)) throw createError({ statusCode: 400, statusMessage: `Open the ${findZone(zone)?.name ?? 'zone'} first` })
        const skins: Record<string, string> = { ...normalizeSkins(row.skins) }
        if (def.id === 'classic') delete skins[zone]
        else skins[zone] = def.id as SkinId
        tx.update(casinoProfiles).set({ skins }).where(eq(casinoProfiles.playerId, playerId)).run()
    } else {
        const avatar = { ...normalizeAvatar(row.avatar), [def.slot as AvatarSlot]: def.id }
        tx.update(casinoProfiles).set({ avatar }).where(eq(casinoProfiles.playerId, playerId)).run()
    }
}

/** POST /api/tycoon/cosmetics/equip: wear an item or skin a zone (free, owned items only). */
export function equipCosmetic(playerId: string, body: CosmeticEquipBody, now = Date.now()): TycoonActionResponse {
    const def = findCosmetic(body.key)
    if (!def) throw createError({ statusCode: 400, statusMessage: 'No such cosmetic' })
    writeTx((tx) => {
        if (!owns(playerId, def, tx)) throw createError({ statusCode: 403, statusMessage: `Buy the ${def.name} first` })
        equipIn(tx, playerId, def, body.zone, now)
    })
    return { state: getTycoonState(playerId, now), coins: null, gems: null, collected: 0 }
}

/**
 * POST /api/tycoon/cosmetics/buy: buy an item priced in chips (the basic
 * zone skins), and with `zone` put it on that zone. One transaction: the
 * ownership insert (on conflict: already owned, 409) and the chip debit
 * (not enough: 400, nothing kept).
 */
export async function buyCosmeticWithChips(playerId: string, body: CosmeticBuyBody, now = Date.now()): Promise<TycoonActionResponse> {
    const def = findCosmetic(body.key)
    if (!def) throw createError({ statusCode: 400, statusMessage: 'No such cosmetic' })
    if (isFree(def)) throw createError({ statusCode: 400, statusMessage: 'That one is free' })
    if (!def.chips) throw createError({ statusCode: 400, statusMessage: 'That one is sold for gems' })
    const { stars } = await coinTransaction((coins) => {
        advanceCasino(coins.tx, playerId, now)
        const added = coins.tx.insert(casinoCosmetics)
            .values({ playerId, item: def.key, paid: 'chips' })
            .onConflictDoNothing()
            .returning({ item: casinoCosmetics.item })
            .get()
        if (!added) throw createError({ statusCode: 409, statusMessage: 'You own that already' })
        coins.debitChips({ playerId, amount: def.chips, reason: `cosmetic:${def.key}` })
        if (body.zone) equipIn(coins.tx, playerId, def, body.zone, now)
    }, playerId)
    return { state: getTycoonState(playerId, now), coins: null, gems: null, collected: 0, stars: ownStarChange(playerId, stars) }
}

/** The gem price of a cosmetic the player can buy now, or a 400. Runs in the gem purchase's insert transaction. */
export function cosmeticGemPrice(tx: Tx, playerId: string, key: string): number {
    const def = findCosmetic(key)
    if (!def || !def.gems) throw createError({ statusCode: 400, statusMessage: def ? 'That one is not sold for gems' : 'No such cosmetic' })
    if (owns(playerId, def, tx)) throw createError({ statusCode: 400, statusMessage: 'You own that already' })
    return def.gems
}

/** Deliver a cosmetic whose gems were spent. False when it was owned already (the gems go back). */
export function grantCosmetic(tx: Tx, playerId: string, key: string): boolean {
    if (!findCosmetic(key)) return false
    const added = tx.insert(casinoCosmetics)
        .values({ playerId, item: key, paid: 'gems' })
        .onConflictDoNothing()
        .returning({ item: casinoCosmetics.item })
        .get()
    return !!added
}
