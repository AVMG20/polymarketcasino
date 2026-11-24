import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { Tx } from '../database'
import { casinoProfiles, dailyMissions } from '../database/schema'
import { amsterdamDay, nextAmsterdamMidnight } from '../../shared/economy'
import { findGame } from '../../shared/games/registry'
import {
    BONUS_HOURS,
    BONUS_MISSION,
    findMission,
    isMissionKey,
    MISSIONS,
    missionReward,
    pickMissions,
    type MissionId,
    type MissionKey,
    type MissionsState,
    type MissionView
} from '../../shared/missions'
import { cryptoRng, type Rng } from '../../shared/rng'
import { CAMPAIGNS, campaignBlocker, progressOf, type TycoonActionResponse } from '../../shared/tycoon'
import { coinTransaction } from './ledger'
import { getTycoonState, peekCasino, type Casino } from './tycoon'

/**
 * Daily missions on the server (rules in shared/missions.ts).
 *
 * - The day's missions are drawn on the first read or event of the
 *   Amsterdam day (`ensureMissions`, insert … on conflict do nothing), with
 *   their rewards fixed from the casino as it is then.
 * - Events bump progress in the same transaction as the thing that happened
 *   (`recordMissions`): a settled round (solo, step or live table), a cage
 *   collect, a build, a campaign. Progress is capped at the target and
 *   stops once claimed.
 * - A claim flips `claimed_at` from null, guarded by `progress >= target`,
 *   and credits the coins (category 'mission') in the same coin
 *   transaction: parallel claims pay once. Claiming one of the three counts
 *   toward the bonus.
 */

const BONUS_TITLE = 'Clear all three'

/** Missions this casino can do today. */
function eligibleMissions(tx: Tx, playerId: string, casino: Casino, now: number): MissionId[] {
    const builtLive = Object.entries(casino.games).some(([slug, level]) => level >= 1 && !!findGame(slug)?.live)
    const canBuild = progressOf(casino) < 1
    // Flyers need no Marketing; only a full week of queued ads leaves nothing to start.
    const canCampaign = CAMPAIGNS.some(campaign => !campaignBlocker(casino, campaign.id, now))
    const otherCasino = !!tx.select({ id: casinoProfiles.playerId }).from(casinoProfiles).where(ne(casinoProfiles.playerId, playerId)).limit(1).get()
    return MISSIONS.map(mission => mission.id).filter((id) => {
        if (id === 'table-hands') return builtLive
        if (id === 'build') return canBuild
        if (id === 'campaign') return canCampaign
        if (id === 'visit') return otherCasino
        return true
    })
}

/** Draw today's missions if the player has none yet. Returns the day. */
export function ensureMissions(tx: Tx, playerId: string, now = Date.now(), rng: Rng = cryptoRng): string {
    const day = amsterdamDay(new Date(now))
    const have = tx.select({ mission: dailyMissions.mission }).from(dailyMissions)
        .where(and(eq(dailyMissions.playerId, playerId), eq(dailyMissions.day, day))).limit(1).get()
    if (have) return day
    const casino = peekCasino(playerId, now, tx)
    const picked = pickMissions(rng, eligibleMissions(tx, playerId, casino, now))
    const rows = picked.map((id, slot) => {
        const def = findMission(id)!
        return { playerId, day, mission: id as string, slot, target: def.target, reward: missionReward(casino, def.hours) }
    })
    rows.push({ playerId, day, mission: BONUS_MISSION, slot: 3, target: picked.length, reward: missionReward(casino, BONUS_HOURS) })
    tx.insert(dailyMissions).values(rows).onConflictDoNothing().run()
    return day
}

/** Count `events` toward today's missions, inside the transaction of the thing that happened. */
export function recordMissions(tx: Tx, playerId: string, events: readonly MissionId[], now = Date.now()) {
    if (!events.length) return
    const day = ensureMissions(tx, playerId, now)
    tx.update(dailyMissions)
        .set({ progress: sql`min(${dailyMissions.target}, ${dailyMissions.progress} + 1)` })
        .where(and(
            eq(dailyMissions.playerId, playerId),
            eq(dailyMissions.day, day),
            inArray(dailyMissions.mission, [...new Set(events)]),
            isNull(dailyMissions.claimedAt)
        ))
        .run()
}

/** Today's missions as the API sends them (drawn first when missing). */
export function missionsState(tx: Tx, playerId: string, now = Date.now()): MissionsState {
    const day = ensureMissions(tx, playerId, now)
    const rows = tx.select().from(dailyMissions)
        .where(and(eq(dailyMissions.playerId, playerId), eq(dailyMissions.day, day)))
        .orderBy(asc(dailyMissions.slot))
        .all()
    const view = (row: typeof rows[number]): MissionView => ({
        id: row.mission as MissionKey,
        title: row.mission === BONUS_MISSION ? BONUS_TITLE : findMission(row.mission)?.title ?? row.mission,
        target: row.target,
        progress: Math.min(row.target, row.progress),
        reward: row.reward,
        claimed: row.claimedAt !== null
    })
    const bonus = rows.find(row => row.mission === BONUS_MISSION)
    return {
        day,
        endsAt: nextAmsterdamMidnight(new Date(now)).getTime(),
        missions: rows.filter(row => row.mission !== BONUS_MISSION && findMission(row.mission)).map(view),
        bonus: bonus ? view(bonus) : { id: BONUS_MISSION, title: BONUS_TITLE, target: 3, progress: 0, reward: 0, claimed: false }
    }
}

/** POST /api/tycoon/mission body: `{ id }`, one of today's missions or 'bonus'. */
export function parseMissionBody(body: unknown): MissionKey {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
    if (!isMissionKey(input.id)) throw createError({ statusCode: 400, statusMessage: 'id names a mission' })
    return input.id
}

/**
 * Claim a finished mission of today: the flip of `claimed_at` (guarded by
 * `progress >= target`) and the coin credit are one transaction, so a burst
 * of claims pays once.
 */
export async function claimMission(playerId: string, id: MissionKey, now = Date.now()): Promise<TycoonActionResponse> {
    const { value } = await coinTransaction((coins) => {
        const day = ensureMissions(coins.tx, playerId, now)
        const mine = and(eq(dailyMissions.playerId, playerId), eq(dailyMissions.day, day))
        const claimed = coins.tx.update(dailyMissions)
            .set({ claimedAt: new Date(now) })
            .where(and(mine, eq(dailyMissions.mission, id), isNull(dailyMissions.claimedAt), sql`${dailyMissions.progress} >= ${dailyMissions.target}`))
            .returning({ reward: dailyMissions.reward })
            .get()
        if (!claimed) {
            const row = coins.tx.select({ claimedAt: dailyMissions.claimedAt }).from(dailyMissions).where(and(mine, eq(dailyMissions.mission, id))).get()
            if (!row) throw createError({ statusCode: 404, statusMessage: 'That is not one of today\'s missions' })
            if (row.claimedAt) throw createError({ statusCode: 409, statusMessage: 'Claimed already' })
            throw createError({ statusCode: 400, statusMessage: 'Not done yet' })
        }
        if (id !== BONUS_MISSION) {
            coins.tx.update(dailyMissions)
                .set({ progress: sql`min(${dailyMissions.target}, ${dailyMissions.progress} + 1)` })
                .where(and(mine, eq(dailyMissions.mission, BONUS_MISSION), isNull(dailyMissions.claimedAt)))
                .run()
        }
        const balance = coins.credit({ playerId, amount: claimed.reward, category: 'mission' }).coins
        return { reward: claimed.reward, balance }
    })
    return { state: getTycoonState(playerId, now), coins: value.balance, gems: null, collected: 0, reward: value.reward, stars: null }
}
