import { eq } from 'drizzle-orm'
import type { Tx } from '../database'
import { casinoProfiles } from '../database/schema'
import { placedSpecials, specialBonus } from '../../shared/decor'
import { WELCOME_AFTER_MS, type WelcomeBack } from '../../shared/missions'
import { DEFAULT_RULES, DOOR_RULES, runFloor, seatedTotal, type HouseRules, type NotableGuest } from '../../shared/visitors'
import { campaignsOf, findTycoonGame, findUpgrade, findZone, type BuildKind, type RunningCampaignRef, type TycoonState, type UpgradeId } from '../../shared/tycoon'
import { historyHours, type Casino } from './tycoon'

/**
 * "While you were away". Every read of the owner's casino stores when it
 * happened and what the casino looked like (`casino_profiles.last_seen`):
 * the zones, the build, the running constructions with their finish times,
 * the campaign, the rush, the house rules and the coins in the cage. A read
 * ten minutes or more later replays the floor from that snapshot tick by
 * tick (the same seeded luck the cage ran on; split where each construction
 * finished, rush and campaign included) and compares its income with what
 * the cage gained: the difference is what a full cage turned away. The
 * replay also finds the whales that came by; the hours come from the
 * history (`historyHours`).
 */

interface Snapshot {
    at: number
    cage: number
    zones: string[] | null
    games: Record<string, number>
    upgrades: Record<string, number>
    constructions: { kind: BuildKind, id: string, level: number, readyAt: number }[]
    rushUntil: number | null
    campaigns: RunningCampaignRef[]
    rules: HouseRules
    /** The specials standing on the floor (shared/decor.ts). */
    specials: string[]
}

function snapshotOf(state: TycoonState, rules: HouseRules): Snapshot {
    return {
        at: state.serverNow,
        cage: state.cage.stored,
        zones: [...state.zones],
        games: { ...state.games },
        upgrades: { ...state.upgrades },
        constructions: state.constructions.map(c => ({ kind: c.kind, id: c.id, level: c.level, readyAt: c.readyAt })),
        rushUntil: state.rushUntil,
        campaigns: campaignsOf(state),
        rules: { ...rules },
        specials: placedSpecials(state.decor ?? []).sort()
    }
}

function readRules(raw: unknown): HouseRules {
    const r = raw && typeof raw === 'object' ? raw as Partial<HouseRules> : {}
    return {
        door: DOOR_RULES.includes(r.door as HouseRules['door']) ? r.door as HouseRules['door'] : DEFAULT_RULES.door,
        vip: r.vip === true
    }
}

function readSnapshot(raw: unknown): Snapshot | null {
    if (!raw || typeof raw !== 'object') return null
    const s = raw as Partial<Snapshot>
    if (typeof s.at !== 'number' || typeof s.cage !== 'number' || !s.games || !s.upgrades || !Array.isArray(s.constructions)) return null
    return {
        at: s.at,
        cage: s.cage,
        // Snapshots from before the visitor tiers have no zones: the replay reads them from the games.
        zones: Array.isArray(s.zones) ? s.zones : null,
        games: s.games,
        upgrades: s.upgrades,
        // Only what is still in the catalog (a Decor level from before it left is refunded, not finished).
        constructions: s.constructions.filter(c => (c.kind === 'zone' ? findZone(c.id) : c.kind === 'game' ? findTycoonGame(c.id) : findUpgrade(c.id))),
        rushUntil: s.rushUntil ?? null,
        campaigns: campaignsOf(s as { campaign?: RunningCampaignRef | null, campaigns?: RunningCampaignRef[] }),
        rules: readRules(s.rules),
        specials: Array.isArray(s.specials) ? s.specials.filter(t => typeof t === 'string') : []
    }
}

/** The floor from the snapshot to `to` with no cage cap (constructions applied as they finished). */
function replay(snap: Snapshot, seed: number, to: number): { income: number, notable: NotableGuest[] } {
    const zones = snap.zones ? [...snap.zones] : undefined
    const view = {
        zones,
        games: { ...snap.games },
        upgrades: { ...snap.upgrades } as Record<UpgradeId, number>,
        rushUntil: snap.rushUntil,
        campaign: null,
        campaigns: snap.campaigns,
        rules: snap.rules,
        specials: specialBonus(snap.specials)
    }
    let at = snap.at
    let income = 0
    // A Whale whose stay spans a finished construction shows up in both stretches: merge on its id.
    const visits = new Map<string, NotableGuest>()
    const run = (until: number) => {
        const part = runFloor(view, seed, at, until, { notable: true })
        income += part.income
        for (const guest of part.notable) {
            const key = guest.id ?? `${guest.at}`
            const seen = visits.get(key)
            visits.set(key, seen ? { ...seen, spent: seen.spent + guest.spent } : guest)
        }
        at = until
    }
    const done = snap.constructions.filter(c => c.readyAt > snap.at && c.readyAt <= to).sort((a, b) => a.readyAt - b.readyAt)
    for (const c of done) {
        run(c.readyAt)
        if (c.kind === 'zone') {
            if (view.zones && !view.zones.includes(c.id)) view.zones.push(c.id)
        } else if (c.kind === 'game') {
            view.games[c.id] = Math.max(view.games[c.id] ?? 0, c.level)
        } else {
            view.upgrades[c.id as UpgradeId] = Math.max(view.upgrades[c.id as UpgradeId] ?? 0, c.level)
        }
    }
    run(to)
    return { income, notable: [...visits.values()].sort((a, b) => a.at - b.at) }
}

/** How often a plain read refreshes the last-seen snapshot. */
const LAST_SEEN_EVERY_MS = 60_000
/** The welcome card's hours go back at most this far, and list this many guests at most. */
const WELCOME_HOURS = 72
const WELCOME_NOTABLE = 8

/**
 * Store this read as the owner's last visit, and when `welcome` is asked for
 * and the last one was WELCOME_AFTER_MS ago or more, say what happened since.
 * `casino` is as of now (finished builds applied and saved), `state` its view
 * (cage accrued).
 */
export function noteVisit(tx: Tx, casino: Casino, state: TycoonState, welcome: boolean): WelcomeBack | null {
    const now = state.serverNow
    const playerId = casino.playerId
    const row = tx.select({ lastSeen: casinoProfiles.lastSeen, lastSeenAt: casinoProfiles.lastSeenAt }).from(casinoProfiles).where(eq(casinoProfiles.playerId, playerId)).get()
    const snap = readSnapshot(row?.lastSeen)
    const next = snapshotOf(state, casino.rules)
    // Reads come often (polls, every action): skip the write while the last one is under a
    // minute old and the snapshot still replays to now. It does while only guest income came
    // in since; a collect (the cage went down), a rush, a campaign, a rule change or a build breaks the replay.
    const same = !!snap && JSON.stringify(snap.constructions) === JSON.stringify(next.constructions)
        && JSON.stringify(snap.campaigns) === JSON.stringify(next.campaigns)
        && snap.rushUntil === next.rushUntil
        && JSON.stringify(snap.zones) === JSON.stringify(next.zones)
        && JSON.stringify(snap.games) === JSON.stringify(next.games)
        && JSON.stringify(snap.upgrades) === JSON.stringify(next.upgrades)
        && JSON.stringify(snap.rules) === JSON.stringify(next.rules)
        && JSON.stringify(snap.specials) === JSON.stringify(next.specials)
        && next.cage >= snap.cage
    if (!welcome && same && row?.lastSeenAt && now - row.lastSeenAt.getTime() < LAST_SEEN_EVERY_MS) return null
    tx.update(casinoProfiles)
        .set({ lastSeenAt: new Date(now), lastSeen: next as unknown as Record<string, unknown> })
        .where(eq(casinoProfiles.playerId, playerId))
        .run()
    if (!welcome || !snap || now - snap.at < WELCOME_AFTER_MS) return null

    const gained = Math.max(0, state.cage.stored - snap.cage)
    const away = replay(snap, casino.seed, now)
    const lost = Math.max(0, Math.round(away.income - gained))
    const running = (c: Snapshot['constructions'][number]) => state.constructions.some(n => n.kind === c.kind && n.id === c.id && n.level === c.level)
    const finished = snap.constructions.filter(c => c.readyAt <= now && !running(c)).map(c => ({ kind: c.kind, id: c.id, level: c.level }))
    const ended = snap.campaigns.filter(c => c.until > snap.at && c.until <= now).sort((a, b) => a.until - b.until)[0]?.id ?? null
    const notable = [...away.notable].sort((a, b) => b.spent - a.spent).slice(0, WELCOME_NOTABLE).sort((a, b) => a.at - b.at)
    return {
        awayMs: now - snap.at,
        earned: Math.floor(gained),
        lost,
        full: state.cage.stored >= state.cage.capacity - 0.5,
        stored: Math.floor(state.cage.stored),
        capacity: state.cage.capacity,
        finished,
        campaignEnded: ended,
        visitors: seatedTotal(state.floor.visitors),
        seats: state.floor.seats,
        hours: historyHours(tx, playerId, Math.max(snap.at, now - (WELCOME_HOURS - 1) * 3_600_000), now),
        notable,
        whales: away.notable.length
    }
}
