import { eq } from 'drizzle-orm'
import type { Tx } from '../database'
import { casinoProfiles } from '../database/schema'
import { WELCOME_AFTER_MS, type WelcomeBack } from '../../shared/missions'
import { floorSeats, guestChipsBetween, visitorCount, type BuildKind, type CampaignId, type TycoonState, type UpgradeId } from '../../shared/tycoon'

/**
 * "While you were away". Every read of the owner's casino stores when it
 * happened and what the casino looked like (`casino_profiles.last_seen`):
 * the build, the running constructions with their finish times, the
 * campaign, the rush and the coins in the cage. A read ten minutes or more
 * later replays the guest income from that snapshot (split where each
 * construction finished, rush and campaign included, as the cage itself
 * accrues it) and compares it with what the cage gained: the difference is
 * what a full cage turned away.
 */

interface Snapshot {
    at: number
    cage: number
    games: Record<string, number>
    upgrades: Record<string, number>
    constructions: { kind: BuildKind, id: string, level: number, readyAt: number }[]
    rushUntil: number | null
    campaign: { id: CampaignId, until: number } | null
}

function snapshotOf(state: TycoonState): Snapshot {
    return {
        at: state.serverNow,
        cage: state.cage.stored,
        games: { ...state.games },
        upgrades: { ...state.upgrades },
        constructions: state.constructions.map(c => ({ kind: c.kind, id: c.id, level: c.level, readyAt: c.readyAt })),
        rushUntil: state.rushUntil,
        campaign: state.campaign
    }
}

function readSnapshot(raw: unknown): Snapshot | null {
    if (!raw || typeof raw !== 'object') return null
    const s = raw as Partial<Snapshot>
    if (typeof s.at !== 'number' || typeof s.cage !== 'number' || !s.games || !s.upgrades || !Array.isArray(s.constructions)) return null
    return { at: s.at, cage: s.cage, games: s.games, upgrades: s.upgrades, constructions: s.constructions, rushUntil: s.rushUntil ?? null, campaign: s.campaign ?? null }
}

/** Guest income from the snapshot to `to` with no cage cap (constructions applied as they finished). */
function incomeSince(snap: Snapshot, to: number): number {
    const view = {
        games: { ...snap.games },
        upgrades: { ...snap.upgrades } as Record<UpgradeId, number>,
        rushUntil: snap.rushUntil,
        campaign: snap.campaign
    }
    let at = snap.at
    let income = 0
    const done = snap.constructions.filter(c => c.readyAt > snap.at && c.readyAt <= to).sort((a, b) => a.readyAt - b.readyAt)
    for (const c of done) {
        income += guestChipsBetween(view, at, c.readyAt)
        at = c.readyAt
        if (c.kind === 'game') view.games[c.id] = Math.max(view.games[c.id] ?? 0, c.level)
        else if (c.kind === 'upgrade') view.upgrades[c.id as UpgradeId] = Math.max(view.upgrades[c.id as UpgradeId] ?? 0, c.level)
    }
    return income + guestChipsBetween(view, at, to)
}

/** How often a plain read refreshes the last-seen snapshot. */
const LAST_SEEN_EVERY_MS = 60_000

/**
 * Store this read as the owner's last visit, and when `welcome` is asked for
 * and the last one was WELCOME_AFTER_MS ago or more, say what happened since.
 * `state` is the casino as of now (cage accrued).
 */
export function noteVisit(tx: Tx, playerId: string, state: TycoonState, welcome: boolean): WelcomeBack | null {
    const now = state.serverNow
    const row = tx.select({ lastSeen: casinoProfiles.lastSeen, lastSeenAt: casinoProfiles.lastSeenAt }).from(casinoProfiles).where(eq(casinoProfiles.playerId, playerId)).get()
    const snap = readSnapshot(row?.lastSeen)
    const next = snapshotOf(state)
    // Reads come often (polls, every action): skip the write while the last one is under a
    // minute old and the snapshot still replays to now. It does while only guest income came
    // in since; a collect (the cage went down), a rush, a campaign or a build breaks the replay.
    const same = !!snap && JSON.stringify(snap.constructions) === JSON.stringify(next.constructions)
        && JSON.stringify(snap.campaign) === JSON.stringify(next.campaign)
        && snap.rushUntil === next.rushUntil
        && JSON.stringify(snap.games) === JSON.stringify(next.games)
        && JSON.stringify(snap.upgrades) === JSON.stringify(next.upgrades)
        && next.cage >= snap.cage
    if (!welcome && same && row?.lastSeenAt && now - row.lastSeenAt.getTime() < LAST_SEEN_EVERY_MS) return null
    tx.update(casinoProfiles)
        .set({ lastSeenAt: new Date(now), lastSeen: next as unknown as Record<string, unknown> })
        .where(eq(casinoProfiles.playerId, playerId))
        .run()
    if (!welcome || !snap || now - snap.at < WELCOME_AFTER_MS) return null

    const gained = Math.max(0, state.cage.stored - snap.cage)
    const lost = Math.max(0, Math.round(incomeSince(snap, now) - gained))
    const running = (c: Snapshot['constructions'][number]) => state.constructions.some(n => n.kind === c.kind && n.id === c.id && n.level === c.level)
    const finished = snap.constructions.filter(c => c.readyAt <= now && !running(c)).map(c => ({ kind: c.kind, id: c.id, level: c.level }))
    const ended = snap.campaign && snap.campaign.until > snap.at && snap.campaign.until <= now ? snap.campaign.id : null
    return {
        awayMs: now - snap.at,
        earned: Math.floor(gained),
        lost,
        full: state.cage.stored >= state.cage.capacity - 0.5,
        stored: Math.floor(state.cage.stored),
        capacity: state.cage.capacity,
        finished,
        campaignEnded: ended,
        visitors: visitorCount(state, now),
        seats: floorSeats(state)
    }
}
