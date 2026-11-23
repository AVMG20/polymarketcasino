import { findGame } from './games/registry'
import type { Rng } from './rng'
import { fullIncomePerHour, type BuildKind, type CampaignId, type TycoonState } from './tycoon'

/**
 * Daily missions and the "while you were away" card (My Casino).
 *
 * Missions: three a player per Amsterdam day, drawn when the day's first
 * read or event comes in (one to play, one for the casino, one more of
 * anything), plus a bonus for clearing all three. Progress counts real
 * events on the server (rounds settled, collects, builds, campaigns). Rewards
 * are **coins** (claimed money, so they are bet before they become chips),
 * sized from the casino's full guest income when the day's missions are
 * drawn: `hours` of it, never under MISSION_FLOOR_PER_HOUR × `hours`.
 */

export type MissionId = 'rounds' | 'slot-wins' | 'big-win' | 'table-hands' | 'collects' | 'build' | 'campaign' | 'visit'
export const BONUS_MISSION = 'bonus'
export type MissionKey = MissionId | typeof BONUS_MISSION

export type MissionGroup = 'play' | 'casino' | 'social'

export interface MissionDef {
    id: MissionId
    /** Short, as the card shows it. */
    title: string
    target: number
    /** The reward in hours of the casino's full guest income. */
    hours: number
    group: MissionGroup
}

export const MISSIONS: readonly MissionDef[] = [
    { id: 'rounds', title: 'Play 20 rounds', target: 20, hours: 0.5, group: 'play' },
    { id: 'slot-wins', title: 'Win 3 times on slots', target: 3, hours: 0.75, group: 'play' },
    { id: 'big-win', title: 'Land a 5× win', target: 1, hours: 1, group: 'play' },
    { id: 'table-hands', title: 'Play 5 hands at a live table', target: 5, hours: 0.75, group: 'play' },
    { id: 'collects', title: 'Collect the cage twice', target: 2, hours: 0.5, group: 'casino' },
    { id: 'build', title: 'Start a build', target: 1, hours: 0.5, group: 'casino' },
    { id: 'campaign', title: 'Run an ad campaign', target: 1, hours: 0.75, group: 'casino' },
    { id: 'visit', title: "Play 3 rounds at a friend's casino", target: 3, hours: 0.75, group: 'social' }
]

/** Missions a day. */
export const MISSIONS_PER_DAY = 3
/** The bonus for clearing all three, in hours of full guest income. */
export const BONUS_HOURS = 0.75
/**
 * A young casino earns little: rewards are at least this many coins per
 * reward hour (about a casino with the Main Floor open), so the first day's
 * missions add half again to the starter cage.
 */
export const MISSION_FLOOR_PER_HOUR = 1_500
/** A win this many times the stake (or more) counts for `big-win`. */
export const BIG_WIN_MULTIPLE = 5

export function findMission(id: string): MissionDef | undefined {
    return MISSIONS.find(mission => mission.id === id)
}

export function isMissionKey(id: unknown): id is MissionKey {
    return typeof id === 'string' && (id === BONUS_MISSION || !!findMission(id))
}

/** Coins for `hours` of the casino's full guest income (whole tens, at least the floor). */
export function missionReward(state: Pick<TycoonState, 'games'>, hours: number): number {
    const coins = Math.max(MISSION_FLOOR_PER_HOUR * hours, fullIncomePerHour(state) * hours)
    return Math.round(coins / 10) * 10
}

/**
 * The day's three missions: one to play, one for the casino, then one more
 * of whatever is left. `eligible` drops what the casino can't do (no live
 * table built, nothing left to build, no other casino to visit).
 */
export function pickMissions(rng: Rng, eligible: readonly MissionId[]): MissionId[] {
    const pool = MISSIONS.filter(mission => eligible.includes(mission.id))
    const picked: MissionId[] = []
    const take = (from: readonly MissionDef[]) => {
        const left = from.filter(mission => !picked.includes(mission.id))
        if (left.length) picked.push(left[Math.floor(rng.next() * left.length)]!.id)
    }
    take(pool.filter(mission => mission.group === 'play'))
    take(pool.filter(mission => mission.group === 'casino'))
    while (picked.length < MISSIONS_PER_DAY && pool.some(mission => !picked.includes(mission.id))) take(pool)
    return picked
}

/** What one settled round counts toward. `host`: the casino it was played in, when visiting. */
export function roundMissionEvents(round: { playerId: string, game: string, stake: number, payout: number, host?: string | null }): MissionId[] {
    const info = findGame(round.game)
    const events: MissionId[] = ['rounds']
    if (info?.kind === 'slot' && round.payout > round.stake) events.push('slot-wins')
    if (round.stake > 0 && round.payout >= round.stake * BIG_WIN_MULTIPLE) events.push('big-win')
    if (info?.live) events.push('table-hands')
    if (round.host && round.host !== round.playerId) events.push('visit')
    return events
}

/** One mission (or the bonus) as the API sends it. */
export interface MissionView {
    id: MissionKey
    title: string
    target: number
    progress: number
    /** Coins it pays. */
    reward: number
    claimed: boolean
}

/** The day's missions (`TycoonState.missions`). */
export interface MissionsState {
    /** Amsterdam day, YYYY-MM-DD. */
    day: string
    /** When the next day's missions come (server ms). */
    endsAt: number
    missions: MissionView[]
    /** All three claimed: this pays on top. `progress` counts the claimed missions. */
    bonus: MissionView
}

/** POST /api/tycoon/mission */
export interface MissionClaimBody {
    id: MissionKey
}

/** "While you were away" (`TycoonState.welcome`, on a read after ten minutes or more away). */
export interface WelcomeBack {
    awayMs: number
    /** Coins that came into the cage while away. */
    earned: number
    /** Guest income the cage had no room for (it was full). */
    lost: number
    /** The cage is full now. */
    full: boolean
    /** Coins in the cage now, and what it holds. */
    stored: number
    capacity: number
    /** Constructions that finished while away. */
    finished: { kind: BuildKind, id: string, level: number }[]
    /** The ad campaign that ran out while away, or null. */
    campaignEnded: CampaignId | null
    /** Visitors on the floor now, and the seats. */
    visitors: number
    seats: number
}

/** Away this long (or more) and the next read says what happened. */
export const WELCOME_AFTER_MS = 10 * 60_000
