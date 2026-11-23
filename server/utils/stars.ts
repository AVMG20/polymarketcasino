import { and, eq, lt, sql } from 'drizzle-orm'
import { db } from '../database'
import { casinoProfiles, chipTransactions, players } from '../database/schema'
import { CASINO_GAME_SLUG, starLevel } from '../../shared/stars'
import { hub, HubError } from './hub'

/**
 * Star levels at the hub. A player's level is starLevel(current **chips**),
 * 0-10, and it goes down as well as up. Whenever it differs from what the hub
 * last confirmed (`players.stars_reported`), we set it at the hub with
 * `seq = STAR_SEQ_BASE + the player's latest chip_transactions id`: ids only
 * grow, so the hub can drop a stale set that arrives after a newer one.
 * Unconfirmed levels retry lazily (next coin or chip change, next wallet
 * read, the ten-minute sweep).
 */

/**
 * Added to every chip ledger id used as `seq`. Before economy v2 stars
 * followed coins and `seq` was the coin ledger id; the hub applies a set only
 * when its seq beats the stored one, and the chip ledger's ids are far
 * smaller than the coin ledger's. The offset puts every chip-based seq above
 * every coin id ever sent (a billion coin rows away), and it stays well under
 * the hub's 2^53 − 1 limit.
 */
export const STAR_SEQ_BASE = 1_000_000_000

export interface StarChange {
    playerId: string
    /** The level now confirmed at the hub. */
    level: number
    /** The level the hub held before. */
    previous: number
    /** Gems the hub paid for a new best level. */
    bounty: number
}

/**
 * Bring the hub up to date with this player's level. Returns the change when
 * the hub confirmed a new level, null when nothing was due or the hub could
 * not be reached (it stays due).
 */
export async function syncStars(playerId: string): Promise<StarChange | null> {
    const row = db.select({
        chips: casinoProfiles.chips,
        origin: players.origin,
        reported: players.starsReported,
        reportedSeq: players.starsSeq,
        seq: sql<number | null>`(select max(${chipTransactions.id}) from ${chipTransactions} where ${chipTransactions.playerId} = ${playerId})`
    }).from(players)
        .leftJoin(casinoProfiles, eq(casinoProfiles.playerId, players.id))
        .where(eq(players.id, playerId))
        .get()
    // Dev-login players don't exist at the hub: nothing to report.
    if (!row || row.origin !== 'hub') return null

    const level = starLevel(row.chips ?? 0)
    const seq = STAR_SEQ_BASE + (row.seq ?? 0)
    if (level === row.reported || seq <= row.reportedSeq) return null

    try {
        const result = await hub.setStars({ playerId, game: CASINO_GAME_SLUG, stars: level, seq })
        // Record what the hub holds now; the seq guard keeps a slower, older
        // report from overwriting a newer one.
        const updated = db.update(players)
            .set({ starsReported: result.stars, starsSeq: seq })
            .where(and(eq(players.id, playerId), lt(players.starsSeq, seq)))
            .returning({ id: players.id })
            .get()
        if (!updated || result.stars === row.reported) return null
        return { playerId, level: result.stars, previous: row.reported, bounty: result.bounty }
    } catch (error) {
        if (!(error instanceof HubError && error.backoff)) {
            console.warn(`[stars] could not set level ${level} for ${playerId}: ${(error as Error).message}`)
        }
        return null
    }
}

/** Report every hub player whose level may be out of date (boot and ten-minute sweep). */
export async function syncAllStars() {
    const due = db.select({ id: players.id, chips: casinoProfiles.chips, reported: players.starsReported })
        .from(players)
        .leftJoin(casinoProfiles, eq(casinoProfiles.playerId, players.id))
        .where(eq(players.origin, 'hub'))
        .all()
        .filter(row => starLevel(row.chips ?? 0) !== row.reported)
    let synced = 0
    for (const row of due) if (await syncStars(row.id)) synced++
    return synced
}
