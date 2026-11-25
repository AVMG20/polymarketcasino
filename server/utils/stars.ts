import { and, eq, isNotNull, lt, lte, sql } from 'drizzle-orm'
import { db, writeTx, type DbExecutor } from '../database'
import { casinoConstructions, casinoCosmetics, casinoDecor, casinoProfiles, gameRounds, players } from '../database/schema'
import { CASINO_GAME_SLUG, goalLevel, goalSummary, starGoals, type StarGoalKey, type StarSummary, type StarView } from '../../shared/stars'
import { findTycoonGame, findUpgrade, findZone, TYCOON_GAMES, type UpgradeId, type ZoneId } from '../../shared/tycoon'
import { hub, HubError } from './hub'

/**
 * Star levels at the hub. A player's level is the number of casino goals
 * reached (shared/stars.ts), 0-10, worked out from the database: the build
 * (finished constructions count the moment they are ready, applied or not),
 * the specials owned, the games played and the cosmetics bought. Whenever it
 * differs from what the hub last confirmed (`players.stars_reported`), we set
 * it at the hub with a millisecond-timestamp `seq` that is always above the
 * stored one (`max(now, stars_seq + 1)`), so the hub drops a stale set that
 * arrives after a newer one; a retry of the same level resends the same seq
 * (`stars_pending_level/seq`). Reports of one player run one at a time.
 * Unconfirmed levels retry lazily (the next coin, chip or tycoon unit, the
 * next wallet read, the ten-minute sweep).
 *
 * Celebrations: `players.stars_seen` is the level the player has been shown.
 * A report never hands its change to anyone by itself; a response does, with
 * `ownStarChange`, which claims every rise above `stars_seen` (a guarded
 * update), so a rise reported in the background (the sweep, a visitor's
 * round, a retry) reaches the owner's next casino or wallet read, and exactly
 * one response carries each rise.
 */

export interface StarChange {
    playerId: string
    /** The level now confirmed at the hub. */
    level: number
    /** The level the hub held before (handed to a player: the level they were last shown). */
    previous: number
    /** Gems the hub paid for a new best level (handed to a player: for every level they had not been shown). */
    bounty: number
    /** The goals done when the level was reported (the client works out which one is new). */
    goals: StarGoalKey[]
    /** Handed to a player: some of it was reported before this response (its bounty is in a gem count read since). */
    late?: true
}

/** Every game the player has a settled round of (anywhere), by skipping through the index one game at a time. */
export function playedGames(playerId: string, ex: DbExecutor = db): string[] {
    return ex.all<{ game: string }>(sql`
        with recursive g(game) as (
            select min(game) from ${gameRounds} where player_id = ${playerId}
            union all
            select (select min(game) from ${gameRounds} where player_id = ${playerId} and game > g.game) from g where g.game is not null
        )
        select game from g where game is not null
    `).map(row => row.game)
}

/** What the goals read for a player, as of `now` (a missing casino reads as a new one). */
export function starView(playerId: string, ex: DbExecutor = db, now = Date.now()): StarView {
    const profile = ex.select({ zones: casinoProfiles.zones, games: casinoProfiles.games, upgrades: casinoProfiles.upgrades })
        .from(casinoProfiles).where(eq(casinoProfiles.playerId, playerId)).get()
    const zones = new Set<ZoneId>((profile?.zones ?? ['backroom']) as ZoneId[])
    const games: Record<string, number> = profile ? { ...profile.games } : Object.fromEntries(TYCOON_GAMES.filter(game => game.starter).map(game => [game.slug, 1]))
    const upgrades: Record<string, number> = { ...profile?.upgrades }
    if (profile) {
        // Constructions that are ready count now, applied or not (advanceCasino applies them on the next tycoon unit).
        const ready = ex.select({ kind: casinoConstructions.kind, target: casinoConstructions.target, level: casinoConstructions.level })
            .from(casinoConstructions)
            .where(and(eq(casinoConstructions.playerId, playerId), lte(casinoConstructions.readyAt, new Date(now))))
            .all()
        for (const row of ready) {
            if (row.kind === 'zone' && findZone(row.target)) zones.add(row.target as ZoneId)
            else if (row.kind === 'game' && findTycoonGame(row.target)) games[row.target] = Math.max(games[row.target] ?? 0, row.level)
            else if (row.kind === 'upgrade' && findUpgrade(row.target)) upgrades[row.target] = Math.max(upgrades[row.target] ?? 0, row.level)
        }
    }
    const specials = ex.select({ type: casinoDecor.special }).from(casinoDecor)
        .where(and(eq(casinoDecor.playerId, playerId), isNotNull(casinoDecor.special)))
        .all()
    const cosmetics = ex.select({ item: casinoCosmetics.item }).from(casinoCosmetics).where(eq(casinoCosmetics.playerId, playerId)).all()
    return {
        casino: { zones: [...zones], games, upgrades: upgrades as Record<UpgradeId, number> },
        decor: specials.map(row => ({ type: row.type! })) as StarView['decor'],
        played: playedGames(playerId, ex),
        cosmetics: cosmetics.map(row => row.item)
    }
}

/** The goals and levels a player's wallet and Stars sheet show. */
export function starSummaryOf(playerId: string, ex: DbExecutor = db, now = Date.now()): StarSummary {
    const reported = ex.select({ level: players.starsReported }).from(players).where(eq(players.id, playerId)).get()?.level ?? 0
    return goalSummary(starView(playerId, ex, now), reported)
}

/**
 * The level a hub player should be reported at, or null when nothing is due
 * (the hub holds it already, or a dev-login player that never touches the hub).
 */
export function dueStarLevel(playerId: string, ex: DbExecutor = db): number | null {
    const row = ex.select({ origin: players.origin, reported: players.starsReported }).from(players).where(eq(players.id, playerId)).get()
    if (!row || row.origin !== 'hub') return null
    const level = goalLevel(starView(playerId, ex))
    return level === row.reported ? null : level
}

/** The report running (or queued) per player: a player's reports run one after another. */
const queues = new Map<string, Promise<StarChange | null>>()

/**
 * Bring the hub up to date with this player's level. Returns the change when
 * the hub confirmed a new level, null when nothing was due or the hub could
 * not be reached (it stays due). Never rejects.
 */
export function syncStars(playerId: string): Promise<StarChange | null> {
    const before = queues.get(playerId)
    const next = (before ? before.then(() => report(playerId)) : report(playerId)).catch(() => null)
    queues.set(playerId, next)
    const clear = () => {
        if (queues.get(playerId) === next) queues.delete(playerId)
    }
    void next.then(clear)
    return next
}

async function report(playerId: string): Promise<StarChange | null> {
    const row = db.select({ origin: players.origin, reported: players.starsReported, seq: players.starsSeq, pendingLevel: players.starsPendingLevel, pendingSeq: players.starsPendingSeq })
        .from(players).where(eq(players.id, playerId)).get()
    // Dev-login players don't exist at the hub: nothing to report.
    if (!row || row.origin !== 'hub') return null

    const goals = starGoals(starView(playerId))
    const level = goals.filter(goal => goal.done).length
    if (level === row.reported) return null
    // A retry of the level still on its way resends its seq (the hub may have
    // applied it already); a new level gets one above every seq sent before.
    const retry = row.pendingLevel === level && row.pendingSeq > row.seq
    const seq = retry ? row.pendingSeq : Math.max(Date.now(), row.seq + 1, row.pendingSeq + 1)
    if (!retry) {
        db.update(players).set({ starsPendingLevel: level, starsPendingSeq: seq })
            .where(and(eq(players.id, playerId), lt(players.starsPendingSeq, seq)))
            .run()
    }

    try {
        const result = await hub.setStars({ playerId, game: CASINO_GAME_SLUG, stars: level, seq })
        // Record what the hub holds now; the seq guard keeps a slower, older
        // report from overwriting a newer one. A rise waits above `stars_seen`
        // (with its bounty) until a response hands it over; a drop is never
        // celebrated, so the seen level follows it down.
        const updated = db.update(players)
            .set({
                starsReported: result.stars,
                starsSeq: seq,
                starsSeen: sql`min(${players.starsSeen}, ${result.stars})`,
                starsUnseenBounty: sql`${players.starsUnseenBounty} + ${result.bounty}`
            })
            .where(and(eq(players.id, playerId), lt(players.starsSeq, seq)))
            .returning({ id: players.id })
            .get()
        if (!updated || result.stars === row.reported) return null
        return { playerId, level: result.stars, previous: row.reported, bounty: result.bounty, goals: goals.filter(goal => goal.done).map(goal => goal.key) }
    } catch (error) {
        if (!(error instanceof HubError && error.backoff)) {
            console.warn(`[stars] could not set level ${level} for ${playerId}: ${(error as Error).message}`)
        }
        return null
    }
}

/**
 * Hand the player the star rise they have not been shown (`stars_reported`
 * above `stars_seen`), with the gems the hub paid for it: the guarded update
 * makes exactly one response carry it, however many race. Null when there is
 * none.
 */
export function takeUnseenStars(playerId: string, now = Date.now()): StarChange | null {
    const peek = db.select({ reported: players.starsReported, seen: players.starsSeen }).from(players).where(eq(players.id, playerId)).get()
    if (!peek || peek.reported <= peek.seen) return null
    return writeTx((tx) => {
        const row = tx.select({ reported: players.starsReported, seen: players.starsSeen, bounty: players.starsUnseenBounty })
            .from(players).where(eq(players.id, playerId)).get()
        if (!row || row.reported <= row.seen) return null
        const taken = tx.update(players)
            .set({ starsSeen: row.reported, starsUnseenBounty: 0 })
            .where(and(eq(players.id, playerId), eq(players.starsSeen, row.seen), eq(players.starsReported, row.reported)))
            .returning({ id: players.id })
            .get()
        if (!taken) return null
        const goals = starGoals(starView(playerId, tx, now)).filter(goal => goal.done).map(goal => goal.key)
        return { playerId, level: row.reported, previous: row.seen, bounty: row.bounty, goals }
    })
}

/**
 * The star change a response hands its own player: the rise they have not
 * been shown yet (claimed: no other response carries it), else a drop the
 * unit just reported (never celebrated, nothing to claim), else null. Every
 * StarChange that reaches a client goes through here.
 */
export function ownStarChange(playerId: string, reported: readonly StarChange[] = []): StarChange | null {
    const mine = reported.find(change => change.playerId === playerId)
    const rise = takeUnseenStars(playerId)
    if (rise) return mine && mine.previous <= rise.previous && mine.level === rise.level ? rise : { ...rise, late: true }
    return mine && mine.level < mine.previous ? mine : null
}

/** Report every hub player whose level is out of date (boot and ten-minute sweep). */
export async function syncAllStars() {
    const hubPlayers = db.select({ id: players.id }).from(players).where(eq(players.origin, 'hub')).all()
    let synced = 0
    for (const { id } of hubPlayers) {
        if (dueStarLevel(id) !== null && await syncStars(id)) synced++
    }
    return synced
}
