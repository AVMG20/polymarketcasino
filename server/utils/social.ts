import { and, count, eq, lte } from 'drizzle-orm'
import { db, type DbExecutor, writeTx } from '../database'
import { casinoConstructions, casinoLikes, casinoProfiles, players } from '../database/schema'
import { normalizeAvatar, normalizeSkins, type ZoneSkins } from '../../shared/cosmetics'
import { amsterdamDay } from '../../shared/economy'
import { casinoTier, casinoValue, LEADERBOARD_SIZE, type CasinoOwner, type CasinoVisit, type LeaderboardEntry, type LeaderboardResponse, type LikeResponse } from '../../shared/social'
import { activeCampaign, progressOf, ZONES, type UpgradeId, type ZoneId } from '../../shared/tycoon'
import { floorNow, seatedTotal } from '../../shared/visitors'
import { casinoView, peekCasino } from './tycoon'

/**
 * The casino leaderboard and visits (shared/social.ts). Reads only, except
 * the heart: one per visitor, casino and Amsterdam day, the primary key is
 * the guard. Nothing here touches coins, chips or gems.
 *
 * The ranking reads every casino in three queries (profiles with their
 * owners, finished-but-unapplied constructions, heart counts) and is cached
 * for RANK_CACHE_MS, so a burst of leaderboard opens costs one ranking.
 */

const RANK_CACHE_MS = 5_000
const PLAYER_ID = /^[\w-]{1,128}$/

let cache: { at: number, board: LeaderboardEntry[] } | null = null

/** Drop the cached ranking (a new heart, tests). */
export function resetLeaderboardCache() {
    cache = null
}

function rankCasinos(now: number): LeaderboardEntry[] {
    const rows = db.select({
        id: casinoProfiles.playerId,
        zones: casinoProfiles.zones,
        games: casinoProfiles.games,
        upgrades: casinoProfiles.upgrades,
        createdAt: casinoProfiles.createdAt,
        avatar: casinoProfiles.avatar,
        name: players.name,
        image: players.image
    }).from(casinoProfiles).innerJoin(players, eq(players.id, casinoProfiles.playerId)).all()

    // Constructions are applied lazily on the owner's next read: count the finished ones now.
    const finished = db.select({ playerId: casinoConstructions.playerId, kind: casinoConstructions.kind, target: casinoConstructions.target, level: casinoConstructions.level })
        .from(casinoConstructions).where(lte(casinoConstructions.readyAt, new Date(now))).all()
    const done = new Map<string, typeof finished>()
    for (const row of finished) done.set(row.playerId, [...done.get(row.playerId) ?? [], row])

    const likes = new Map(db.select({ ownerId: casinoLikes.ownerId, n: count() }).from(casinoLikes).groupBy(casinoLikes.ownerId).all().map(row => [row.ownerId, row.n]))

    const ranked = rows.map((row) => {
        const zones = [...row.zones]
        const games = { ...row.games }
        const upgrades = { ...row.upgrades }
        for (const c of done.get(row.id) ?? []) {
            if (c.kind === 'zone' && !zones.includes(c.target)) zones.push(c.target)
            else if (c.kind === 'game') games[c.target] = Math.max(games[c.target] ?? 0, c.level)
            else if (c.kind === 'upgrade') upgrades[c.target] = Math.max(upgrades[c.target] ?? 0, c.level)
        }
        const view = { zones: zones as ZoneId[], games, upgrades: upgrades as Record<UpgradeId, number> }
        return {
            createdAt: row.createdAt.getTime(),
            entry: {
                rank: 0,
                owner: { id: row.id, name: row.name, image: row.image, avatar: normalizeAvatar(row.avatar) },
                value: casinoValue(view),
                tier: casinoTier(zones),
                zones: ZONES.map(zone => zone.id).filter(id => zones.includes(id)),
                games: Object.values(games).filter(level => level >= 1).length,
                progress: progressOf(view),
                likes: likes.get(row.id) ?? 0
            } satisfies LeaderboardEntry
        }
    })
    // Most valuable first; ties go to more hearts, then to the older casino.
    ranked.sort((a, b) => b.entry.value - a.entry.value
        || b.entry.likes - a.entry.likes
        || a.createdAt - b.createdAt
        || (a.entry.owner.id < b.entry.owner.id ? -1 : 1))
    return ranked.map(({ entry }, i) => ({ ...entry, rank: i + 1 }))
}

function board(now: number): { at: number, board: LeaderboardEntry[] } {
    if (!cache || now - cache.at >= RANK_CACHE_MS || now < cache.at) cache = { at: now, board: rankCasinos(now) }
    return cache
}

/** GET /api/tycoon/leaderboard: the top LEADERBOARD_SIZE casinos and the player's own row. */
export function getLeaderboard(playerId: string, now = Date.now()): LeaderboardResponse {
    const { at, board: all } = board(now)
    return {
        entries: all.slice(0, LEADERBOARD_SIZE),
        me: all.find(entry => entry.owner.id === playerId) ?? null,
        total: all.length,
        rankedAt: at
    }
}

/** The `:playerId` route param, typed: anything else is a 400. */
export function parsePlayerParam(value: unknown): string {
    if (typeof value !== 'string' || !PLAYER_ID.test(value)) throw createError({ statusCode: 400, statusMessage: 'No such player' })
    return value
}

/**
 * The `host` of a round or a seat: the casino the player is visiting, whose
 * games they may play with their own coins and chips. Absent (undefined or
 * null) is no host; anything but a player id string is a 400.
 */
export function parseHost(value: unknown): string | null {
    if (value === undefined || value === null) return null
    if (typeof value !== 'string' || !PLAYER_ID.test(value)) throw createError({ statusCode: 400, statusMessage: 'host names the casino you are visiting' })
    return value
}

/**
 * Whether the casino of `hostId` has `slug` built (level 1 or more), read in
 * the caller's transaction. A player without a casino has nothing built.
 */
export function hostHasGame(hostId: string, slug: string, ex: DbExecutor = db, now = Date.now()): boolean {
    const exists = ex.select({ id: casinoProfiles.playerId }).from(casinoProfiles).where(eq(casinoProfiles.playerId, hostId)).get()
    return !!exists && (peekCasino(hostId, now, ex).games[slug] ?? 0) >= 1
}

function ownerOf(playerId: string): CasinoOwner & { skins: ZoneSkins } {
    const row = db.select({ id: players.id, name: players.name, image: players.image, avatar: casinoProfiles.avatar, skins: casinoProfiles.skins })
        .from(players).innerJoin(casinoProfiles, eq(casinoProfiles.playerId, players.id))
        .where(eq(players.id, playerId)).get()
    if (!row) throw createError({ statusCode: 404, statusMessage: 'That casino does not exist' })
    return { id: row.id, name: row.name, image: row.image, avatar: normalizeAvatar(row.avatar), skins: normalizeSkins(row.skins) }
}

function likeCount(ownerId: string): number {
    return db.select({ n: count() }).from(casinoLikes).where(eq(casinoLikes.ownerId, ownerId)).get()?.n ?? 0
}

/** GET /api/tycoon/visit/:playerId: the public, read-only view of a casino. */
export function getCasinoVisit(visitorId: string, ownerId: string, now = Date.now()): CasinoVisit {
    const { skins, ...owner } = ownerOf(ownerId)
    const casino = peekCasino(ownerId, now)
    const campaign = activeCampaign(casino, now)
    // A rush (a gem purchase) changes income, not visitors: it stays the owner's.
    const floor = floorNow(casinoView({ ...casino, rushUntil: null }), casino.seed, now)
    const seated = seatedTotal(floor.visitors)
    const liked = db.select({ day: casinoLikes.day }).from(casinoLikes)
        .where(and(eq(casinoLikes.ownerId, ownerId), eq(casinoLikes.visitorId, visitorId), eq(casinoLikes.day, amsterdamDay(new Date(now)))))
        .get()
    const games = Object.fromEntries(Object.entries(casino.games).filter(([, level]) => level >= 1))
    return {
        serverNow: now,
        owner,
        rank: board(now).board.find(entry => entry.owner.id === ownerId)?.rank ?? null,
        value: casinoValue(casino),
        tier: casinoTier(casino.zones),
        zones: ZONES.map(zone => zone.id).filter(id => casino.zones.includes(id)),
        games,
        golden: casino.golden.filter(slug => (games[slug] ?? 0) >= 1),
        decor: casino.upgrades.decor ?? 0,
        // Skins on owned zones only (a skin is never put on a zone that isn't open).
        skins: Object.fromEntries(Object.entries(skins).filter(([zone]) => casino.zones.includes(zone as ZoneId))),
        visitors: seated,
        seats: floor.seats,
        queue: floor.turnedAway,
        floor: { visitors: floor.visitors, seats: floor.seats, turnedAway: floor.turnedAway },
        campaign: campaign?.id ?? null,
        likes: likeCount(ownerId),
        likedToday: !!liked
    }
}

/**
 * POST /api/tycoon/visit/:playerId/like: leave a heart, once per casino a
 * day. The insert on the (owner, visitor, day) key is the guard, so a burst
 * of taps leaves one.
 */
export function likeCasino(visitorId: string, ownerId: string, now = Date.now()): LikeResponse {
    if (visitorId === ownerId) throw createError({ statusCode: 400, statusMessage: 'You can\'t heart your own casino' })
    const result = writeTx((tx) => {
        const exists = tx.select({ id: casinoProfiles.playerId }).from(casinoProfiles).where(eq(casinoProfiles.playerId, ownerId)).get()
        if (!exists) throw createError({ statusCode: 404, statusMessage: 'That casino does not exist' })
        const added = tx.insert(casinoLikes)
            .values({ ownerId, visitorId, day: amsterdamDay(new Date(now)) })
            .onConflictDoNothing()
            .returning({ day: casinoLikes.day })
            .get()
        const likes = tx.select({ n: count() }).from(casinoLikes).where(eq(casinoLikes.ownerId, ownerId)).get()?.n ?? 0
        return { likes, liked: !!added }
    })
    return result
}
