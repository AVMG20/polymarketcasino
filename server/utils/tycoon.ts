import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { db, type DbExecutor, type Tx, writeTx } from '../database'
import { casinoConstructions, casinoDecor, casinoHistory, casinoProfiles, players } from '../database/schema'
import { casinoLevel } from '../../shared/casino-level'
import { DECOR_TYPES, findDecor, placedSpecials, specialBonus, type BuyDecorBody, type DecorType, type OwnedDecor, type PlaceBody } from '../../shared/decor'
import { furnitureGrants, layoutOf, layoutStateOf, placementProblem, type LayoutInput } from '../../shared/floor/placement'
import { findGame } from '../../shared/games/registry'
import { roundCoins, sumCoins } from '../../shared/money'
import {
    DOOR_RULES,
    floorNow,
    houseState,
    isRuleValue,
    ruleZone,
    RULES_COOLDOWN_MS,
    runFloor,
    seedOf,
    unlockedRules,
    VISITOR_TIER_IDS,
    type FloorView,
    type HistoryHour,
    type HouseRuleId,
    type HouseRules,
    type HourPiece,
    type HistoryResponse,
    type RulesBody
} from '../../shared/visitors'
import {
    buildBlocker,
    builderCount,
    NO_ROOM_BLOCKER,
    cageCapacity,
    decorRefund,
    newGameSpot,
    levelOf,
    nextCost,
    progressOf,
    STARTER_CAGE,
    TYCOON_GAMES,
    UPGRADE_IDS,
    campaignBlocker,
    campaignCost,
    findCampaign,
    findTycoonGame,
    findUpgrade,
    findZone,
    floorGames,
    type BuildBody,
    type CampaignId,
    type RunningCampaignRef,
    type BuildKind,
    type TycoonActionResponse,
    type TycoonStarChange,
    type TycoonState,
    type UpgradeId,
    type ZoneId
} from '../../shared/tycoon'
import { cosmeticsOf } from './cosmetics'
import { casinoEnv } from './env'
import { creditChips } from './chips'
import { coinTransaction, commitCoins } from './ledger'
import { missionsState, recordMissions } from './missions'
import { noteVisit } from './welcome'
import { ownStarChange, starSummaryOf, type StarChange } from './stars'

/**
 * My Casino on the server: the casino profile, constructions, the cage and
 * ad campaigns. Rules and numbers live in shared/tycoon.ts.
 *
 * - The profile is created on first use (insert … on conflict do nothing),
 *   with the starters built and some coins already in the cage.
 * - Finished constructions are applied lazily, in `advanceCasino`, on every
 *   read and action: deleting the ready rows (… RETURNING) is the guard that
 *   applies each one once. The cage accrues at the old rate up to the moment
 *   each one finished, so the result doesn't depend on when it is read.
 * - Everything that writes runs inside one BEGIN IMMEDIATE transaction,
 *   synchronously. Anything that moves coins or chips (collect, build,
 *   campaign) runs in a `coinTransaction`, so the star level (which follows
 *   chips) is reported when it moves.
 * - The cage accrues through the per-tick visitor model (shared/visitors.ts
 *   `runFloor`, seeded by the player id), always up to a change first (a
 *   build finishing, a rush, a campaign, a rule change), so every stretch
 *   runs at one build and one set of rules. Persisted accruals also write
 *   the hour-by-hour history (`casino_history`) when the casino is saved.
 */

const KINDS: readonly BuildKind[] = ['zone', 'game', 'upgrade']
const ID = /^[a-z][a-zA-Z0-9-]{0,39}$/

type ConstructionRow = typeof casinoConstructions.$inferSelect
type ProfileRow = typeof casinoProfiles.$inferSelect
type DecorRow = typeof casinoDecor.$inferSelect

/** A decoration as the server holds it: the free furniture it came from, if any. */
export interface CasinoDecor extends OwnedDecor {
    grantKey: string | null
}

/** A casino profile in memory, with its running constructions. */
export interface Casino {
    playerId: string
    chips: number
    zones: ZoneId[]
    games: Record<string, number>
    upgrades: Record<UpgradeId, number>
    golden: string[]
    /** Builders now: 1 + the Construction Crew + the gem builder (`builderCount`). */
    builders: number
    /** The gem builder is hired (stored as `builders = 2`; the crew is `upgrades.crew`). */
    gemBuilder: boolean
    cageStored: number
    /** ms */
    cageAt: number
    /** The jar's rakeback pots, in coins, read with the row (server/utils/rakeback.ts). Never written by `saveCasino`: only their own guarded updates move them. */
    pots: { rakeback: number, visitors: number }
    rushUntil: number | null
    /** Ad campaigns, one per kind (some may have run out). */
    campaigns: RunningCampaignRef[]
    constructions: ConstructionRow[]
    /** House rules in force, and when they last changed (ms). */
    rules: HouseRules
    rulesAt: number | null
    /** Stored game spots (moved or first built); a game missing here stands at home. */
    placements: Record<string, { x: number, y: number }>
    /** Built games put away (stored as `placements[slug] = null`): off the floor, out of the visitor model. */
    storedGames: string[]
    /** Decorations owned, placed or put away (known types only). */
    decor: CasinoDecor[]
    /** Levels of the removed Decor upgrade still on the row, not refunded yet (kept on save until `refundDecor`). */
    legacyDecor: number
    /** A Decor level was left under construction (refunded by `refundDecor`). */
    legacyDecorBuilding: boolean
    /** The luck seed (from the player id). */
    seed: number
    /** History pieces accrued but not written yet (null: a read-only casino, nothing is recorded). */
    pending: HourPiece[] | null
    /** A read-only casino that only needs the hours from here (ms): earlier stretches just fill the cage. */
    recordFrom?: number
}

const floorListeners = new Set<(playerId: string) => void>()

/**
 * Call `listener` with the casino's id whenever what stands on its floor may
 * have changed (a build started or finished, a placement, a decoration bought
 * or granted): the floor socket reads its walk grid again. Returns the unsubscribe.
 */
export function onFloorChange(listener: (playerId: string) => void): () => void {
    floorListeners.add(listener)
    return () => floorListeners.delete(listener)
}

function floorChanged(playerId: string) {
    for (const listener of floorListeners) listener(playerId)
}

/** History rows older than this are pruned on write. */
export const HISTORY_KEEP_MS = 4 * 24 * 60 * 60_000

function starterGames(): Record<string, number> {
    return Object.fromEntries(TYCOON_GAMES.filter(game => game.starter).map(game => [game.slug, 1]))
}

function upgradeLevels(raw: Record<string, number> = {}): Record<UpgradeId, number> {
    return Object.fromEntries(UPGRADE_IDS.map(id => [id, raw[id] ?? 0])) as Record<UpgradeId, number>
}

function newProfile(playerId: string, now: number) {
    return {
        playerId,
        chips: 0,
        zones: ['backroom'],
        games: starterGames(),
        upgrades: upgradeLevels(),
        golden: [],
        builders: 1,
        cageStored: STARTER_CAGE,
        cageAt: new Date(now),
        cageRakeback: 0,
        cageVisitors: 0
    }
}

function decorOf(row: DecorRow): CasinoDecor | null {
    if (!findDecor(row.type)) return null
    const placed = row.x !== null && row.y !== null
    return { id: row.id, type: row.type as DecorType, x: placed ? row.x : null, y: placed ? row.y : null, grantKey: row.grantKey }
}

/** Stored spots that are whole tiles (anything else reads as home but null: put away). */
function placementsOf(raw: unknown): { placements: Record<string, { x: number, y: number }>, stored: string[] } {
    const placements: Record<string, { x: number, y: number }> = {}
    const stored: string[] = []
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { placements, stored }
    for (const [slug, at] of Object.entries(raw as Record<string, unknown>)) {
        if (!findTycoonGame(slug)) continue
        if (at === null) {
            stored.push(slug)
            continue
        }
        const tile = at as { x?: unknown, y?: unknown }
        if (tile && Number.isInteger(tile.x) && Number.isInteger(tile.y)) placements[slug] = { x: tile.x as number, y: tile.y as number }
    }
    return { placements, stored: stored.sort() }
}

/** The `placements` column: the spots, and null for every game put away. */
function placementsRow(casino: Pick<Casino, 'placements' | 'storedGames'>): Record<string, { x: number, y: number } | null> {
    const row: Record<string, { x: number, y: number } | null> = { ...casino.placements }
    for (const slug of casino.storedGames) row[slug] = null
    return row
}

function fromRow(row: ProfileRow, constructions: ConstructionRow[], decor: DecorRow[], record = true): Casino {
    const upgrades = upgradeLevels(row.upgrades)
    const gemBuilder = row.builders >= 2
    const { placements, stored } = placementsOf(row.placements)
    return {
        playerId: row.playerId,
        chips: row.chips,
        zones: row.zones as ZoneId[],
        games: { ...row.games },
        upgrades,
        golden: [...row.golden],
        builders: builderCount(upgrades, gemBuilder),
        gemBuilder,
        cageStored: row.cageStored,
        cageAt: row.cageAt.getTime(),
        pots: { rakeback: row.cageRakeback ?? 0, visitors: row.cageVisitors ?? 0 },
        rushUntil: row.rushUntil?.getTime() ?? null,
        campaigns: campaignsFromRow(row),
        constructions: constructions.filter(known).sort((a, b) => a.readyAt.getTime() - b.readyAt.getTime()),
        rules: { door: DOOR_RULES.includes(row.door) ? row.door : 'open', vip: !!row.vip },
        rulesAt: row.rulesAt?.getTime() ?? null,
        placements,
        // Only a built game can be away (a guard against an odd row: anything else stands on the floor).
        storedGames: stored.filter(slug => (row.games[slug] ?? 0) >= 1),
        legacyDecor: Math.max(0, Math.floor(Number((row.upgrades as Record<string, unknown>).decor) || 0)),
        legacyDecorBuilding: constructions.some(c => c.kind === 'upgrade' && c.target === 'decor'),
        decor: decor.flatMap(d => decorOf(d) ?? []).sort((a, b) => a.id - b.id),
        seed: luckSeed(row.playerId),
        pending: record ? [] : null
    }
}

/** The stored campaigns (known kinds only); a row from before several could run has the single `campaign` column. */
function campaignsFromRow(row: Pick<ProfileRow, 'campaign' | 'campaignUntil' | 'campaigns'>): RunningCampaignRef[] {
    const list = Array.isArray(row.campaigns) ? row.campaigns : []
    const known = list.filter(c => c && typeof c.until === 'number' && findCampaign(c.id)).map(c => ({ id: c.id as CampaignId, until: c.until }))
    if (known.length || !row.campaign || !row.campaignUntil || !findCampaign(row.campaign)) return known
    return [{ id: row.campaign as CampaignId, until: row.campaignUntil.getTime() }]
}

/** A player's luck seed: the id salted with the server's secret (`PNX_LUCK_SALT`). */
export function luckSeed(playerId: string): number {
    return seedOf(playerId, casinoEnv().luckSalt)
}

/** What the visitor model reads of a casino (the games and specials standing on the floor). */
export function casinoView(casino: Pick<Casino, 'zones' | 'games' | 'upgrades' | 'rushUntil' | 'campaigns' | 'rules'> & { decor?: readonly OwnedDecor[], storedGames?: readonly string[] }): FloorView {
    return {
        zones: casino.zones,
        games: floorGames(casino),
        upgrades: casino.upgrades,
        rushUntil: casino.rushUntil,
        campaign: null,
        campaigns: casino.campaigns,
        rules: casino.rules,
        specials: specialBonus(placedSpecials(casino.decor ?? []))
    }
}

/** What stands on a casino's floor (shared/floor/placement.ts). */
export function casinoLayout(casino: Pick<Casino, 'zones' | 'games' | 'constructions' | 'placements' | 'decor'> & { storedGames?: readonly string[] }): LayoutInput {
    return layoutOf(layoutStateOf({
        zones: casino.zones,
        games: casino.games,
        constructions: casino.constructions.map(row => ({ kind: row.kind, id: row.target })),
        placements: casino.placements,
        storedGames: casino.storedGames,
        decor: casino.decor
    }))
}

/** Every game on the floor and where it stands, home spots resolved (TycoonState.placements). */
function placementsView(casino: Pick<Casino, 'zones' | 'games' | 'constructions' | 'placements' | 'storedGames'>): Record<string, { x: number, y: number }> {
    return layoutStateOf({
        zones: casino.zones,
        games: casino.games,
        constructions: casino.constructions.map(row => ({ kind: row.kind, id: row.target })),
        placements: casino.placements,
        storedGames: casino.storedGames
    }).games as Record<string, { x: number, y: number }>
}

/**
 * Give the casino the free furniture it is due (shared/floor/placement.ts
 * `furnitureGrants`): every piece of an owned room,
 * reached, at its old spot when free, else put away. With a transaction the
 * grants are stored (the unique (player, grant_key) index gives each one
 * once, whatever became of it since); without (a read-only peek) they are
 * only added in memory, with ids below zero.
 */
function grantFurniture(casino: Casino, tx: Tx | null): number {
    const given = new Set<string>()
    for (const item of casino.decor) if (item.grantKey) given.add(item.grantKey)
    const due = furnitureGrants(casinoLayout(casino), given)
    let virtual = -1
    for (const grant of due) {
        const x = grant.at?.x ?? null
        const y = grant.at?.y ?? null
        if (!tx) {
            casino.decor.push({ id: virtual--, type: grant.type, x, y, grantKey: grant.key })
            continue
        }
        const row = tx.insert(casinoDecor).values({ playerId: casino.playerId, type: grant.type, x, y, grantKey: grant.key })
            .onConflictDoNothing()
            .returning()
            .get()
        const item = row ? decorOf(row) : null
        if (item) casino.decor.push(item)
    }
    return due.length
}

/** A construction of something still in the catalog (the House Cut upgrade left in economy v2). */
function known(row: Pick<ConstructionRow, 'kind' | 'target'>): boolean {
    if (row.kind === 'zone') return !!findZone(row.target)
    if (row.kind === 'game') return !!findTycoonGame(row.target)
    return !!findUpgrade(row.target)
}

/** Create the player's casino if it doesn't exist yet. */
export function ensureCasino(tx: Tx, playerId: string, now = Date.now()) {
    tx.insert(casinoProfiles).values(newProfile(playerId, now)).onConflictDoNothing().run()
}

/**
 * Bring the cage up to `to` at the casino's current build and rules (rush and
 * campaign included, tick by tick), capped at capacity. A casino that records
 * (`pending`) keeps the hour pieces for the history; a read-only one stops
 * counting once the cage is full.
 */
export function accrueCage(casino: Casino, to: number) {
    if (!(to > casino.cageAt)) return
    if (casino.recordFrom !== undefined && casino.recordFrom > casino.cageAt) {
        // Only the hours from `recordFrom` are wanted: before it, just the cage (fast once it is full).
        const until = Math.min(to, casino.recordFrom)
        const head = runFloor(casinoView(casino), casino.seed, casino.cageAt, until, {
            cage: { stored: casino.cageStored, capacity: cageCapacity(casino.upgrades.cage) },
            stopWhenFull: true
        })
        casino.cageStored = Math.max(casino.cageStored, head.stored)
        casino.cageAt = until
        if (!(to > until)) return
    }
    const run = runFloor(casinoView(casino), casino.seed, casino.cageAt, to, {
        cage: { stored: casino.cageStored, capacity: cageCapacity(casino.upgrades.cage) },
        hours: casino.pending !== null,
        stopWhenFull: casino.pending === null
    })
    casino.cageStored = Math.max(casino.cageStored, run.stored)
    casino.cageAt = to
    casino.pending?.push(...run.hours)
}

/** Hour pieces added up per hour. */
function mergeHours(pieces: readonly HourPiece[]): HourPiece[] {
    const byHour = new Map<number, HourPiece>()
    for (const piece of pieces) {
        const hour = byHour.get(piece.at)
        if (!hour) {
            byHour.set(piece.at, { ...piece, guestHours: { ...piece.guestHours } })
            continue
        }
        for (const id of VISITOR_TIER_IDS) hour.guestHours[id] += piece.guestHours[id]
        hour.ms += piece.ms
        hour.income = roundCoins(hour.income + piece.income + 1e-9)
        hour.lost = roundCoins(hour.lost + piece.lost + 1e-9)
    }
    return [...byHour.values()].sort((a, b) => a.at - b.at)
}

/**
 * Pay back the removed Decor upgrade, once: the chips its levels cost (at the
 * last catalog prices, `decorRefund`) and any Decor level still under
 * construction, as `refund:decor` chips. Runs inside a coin unit (chips move
 * only there); the guards are the conditional update that drops `decor`
 * from the row only while it still holds the level read, and the delete of
 * the construction rows (… RETURNING), in the same BEGIN IMMEDIATE
 * transaction. Returns the chips paid.
 */
export function refundDecor(tx: Tx, casino: Casino): number {
    if (casino.legacyDecor <= 0 && !casino.legacyDecorBuilding) return 0
    let chips = 0
    if (casino.legacyDecor > 0) {
        const cleared = tx.update(casinoProfiles)
            .set({ upgrades: sql`json_remove(${casinoProfiles.upgrades}, '$.decor')` })
            .where(and(eq(casinoProfiles.playerId, casino.playerId), sql`json_extract(${casinoProfiles.upgrades}, '$.decor') = ${casino.legacyDecor}`))
            .returning({ playerId: casinoProfiles.playerId })
            .get()
        if (cleared) chips += decorRefund(casino.legacyDecor)
        casino.legacyDecor = 0
    }
    const building = tx.delete(casinoConstructions)
        .where(and(eq(casinoConstructions.playerId, casino.playerId), eq(casinoConstructions.kind, 'upgrade'), eq(casinoConstructions.target, 'decor')))
        .returning({ level: casinoConstructions.level })
        .all()
    for (const row of building) chips += decorRefund(row.level) - decorRefund(row.level - 1)
    casino.legacyDecorBuilding = false
    if (chips > 0) casino.chips = creditChips(tx, { playerId: casino.playerId, amount: chips, reason: 'refund:decor' })
    return chips
}

/** Write the pending history pieces (each hour adds up), and prune old rows. */
export function flushHistory(tx: Tx, casino: Casino) {
    if (!casino.pending?.length) return
    const hours = mergeHours(casino.pending)
    casino.pending = []
    const keepFrom = hours.at(-1)!.at - HISTORY_KEEP_MS
    for (const hour of hours) {
        if (hour.at < keepFrom) continue
        tx.insert(casinoHistory).values({
            playerId: casino.playerId,
            hour: new Date(hour.at),
            touristHours: hour.guestHours.tourist,
            regularHours: hour.guestHours.regular,
            highrollerHours: hour.guestHours.highroller,
            whaleHours: hour.guestHours.whale,
            coveredMs: hour.ms,
            income: hour.income,
            lost: hour.lost
        }).onConflictDoUpdate({
            target: [casinoHistory.playerId, casinoHistory.hour],
            set: {
                touristHours: sql`${casinoHistory.touristHours} + excluded.tourist_hours`,
                regularHours: sql`${casinoHistory.regularHours} + excluded.regular_hours`,
                highrollerHours: sql`${casinoHistory.highrollerHours} + excluded.highroller_hours`,
                whaleHours: sql`${casinoHistory.whaleHours} + excluded.whale_hours`,
                coveredMs: sql`${casinoHistory.coveredMs} + excluded.covered_ms`,
                income: sql`${casinoHistory.income} + excluded.income`,
                lost: sql`${casinoHistory.lost} + excluded.lost`
            }
        }).run()
    }
    tx.delete(casinoHistory).where(and(eq(casinoHistory.playerId, casino.playerId), lt(casinoHistory.hour, new Date(keepFrom)))).run()
}

/** Put `kind:target` at `level` (a zone at 1 is owned). */
export function applyLevel(casino: Casino, kind: BuildKind, target: string, level: number) {
    if (kind === 'zone') {
        if (!casino.zones.includes(target as ZoneId)) casino.zones = [...casino.zones, target as ZoneId]
    } else if (kind === 'game') {
        casino.games = { ...casino.games, [target]: Math.max(casino.games[target] ?? 0, level) }
    } else {
        const id = target as UpgradeId
        casino.upgrades = { ...casino.upgrades, [id]: Math.max(casino.upgrades[id] ?? 0, level) }
        casino.builders = builderCount(casino.upgrades, casino.gemBuilder)
    }
}

/** Apply finished constructions to `casino` in memory, oldest first. Returns them. */
function applyFinished(casino: Casino, finished: ConstructionRow[]) {
    for (const row of [...finished].filter(known).sort((a, b) => a.readyAt.getTime() - b.readyAt.getTime())) {
        accrueCage(casino, row.readyAt.getTime())
        applyLevel(casino, row.kind, row.target, row.level)
    }
    const done = new Set(finished.map(row => row.id))
    casino.constructions = casino.constructions.filter(row => !done.has(row.id))
}

function loadRows(ex: DbExecutor, playerId: string) {
    const row = ex.select().from(casinoProfiles).where(eq(casinoProfiles.playerId, playerId)).get()
    const constructions = row ? ex.select().from(casinoConstructions).where(eq(casinoConstructions.playerId, playerId)).all() : []
    const decor = row ? ex.select().from(casinoDecor).where(eq(casinoDecor.playerId, playerId)).all() : []
    return { row, constructions, decor }
}

/** The campaign of the list that ends first. */
function firstEnding(list: readonly RunningCampaignRef[]): RunningCampaignRef | null {
    return [...list].sort((a, b) => a.until - b.until)[0] ?? null
}

/** Persist the build and the cage, and write the history it accrued (not chips: those move through chips.ts; not the rules: `setHouseRules`). */
export function saveCasino(tx: Tx, casino: Casino) {
    // Campaigns that ran out by the time they were accrued are dropped; the first one ending also goes to the old columns.
    const live = casino.campaigns.filter(c => c.until > casino.cageAt)
    casino.campaigns = live
    const first = firstEnding(live)
    tx.update(casinoProfiles).set({
        zones: casino.zones,
        games: casino.games,
        // The removed Decor upgrade stays on the row until it is refunded (refundDecor).
        upgrades: casino.legacyDecor > 0 ? { ...casino.upgrades, decor: casino.legacyDecor } : casino.upgrades,
        golden: casino.golden,
        builders: casino.gemBuilder ? 2 : 1,
        cageStored: casino.cageStored,
        cageAt: new Date(casino.cageAt),
        rushUntil: casino.rushUntil === null ? null : new Date(casino.rushUntil),
        campaign: first?.id ?? null,
        campaignUntil: first ? new Date(first.until) : null,
        campaigns: live,
        placements: placementsRow(casino)
    }).where(eq(casinoProfiles.playerId, casino.playerId)).run()
    flushHistory(tx, casino)
}

/**
 * The player's casino as of `now`, inside a write transaction: created if
 * missing, finished constructions applied and saved. Call it first in every
 * action.
 */
export function advanceCasino(tx: Tx, playerId: string, now = Date.now()): Casino {
    ensureCasino(tx, playerId, now)
    const { row, constructions, decor } = loadRows(tx, playerId)
    if (!row) throw new Error(`No casino for ${playerId}`)
    const casino = fromRow(row, constructions, decor)
    // The delete is the guard: a finished construction applies once.
    const finished = tx.delete(casinoConstructions)
        // A Decor level left building (the upgrade is gone) waits for its refund instead.
        .where(and(eq(casinoConstructions.playerId, playerId), lte(casinoConstructions.readyAt, new Date(now)), sql`not (${casinoConstructions.kind} = 'upgrade' and ${casinoConstructions.target} = 'decor')`))
        .returning()
        .all()
    if (finished.length) {
        applyFinished(casino, finished)
        saveCasino(tx, casino)
    }
    if (grantFurniture(casino, tx) > 0 || finished.length) floorChanged(playerId)
    return casino
}

/**
 * The casino as of `now` without writing anything (a missing one reads as
 * new). With `record`, the history pieces of the finished constructions'
 * accrual stay in `pending` (never written).
 */
export function peekCasino(playerId: string, now = Date.now(), ex: DbExecutor = db, record = false, recordFrom?: number): Casino {
    const { row, constructions, decor } = loadRows(ex, playerId)
    const casino = row
        ? fromRow(row, constructions, decor, record)
        : fromRow({ ...newProfile(playerId, now), rushUntil: null, campaign: null, campaignUntil: null, campaigns: [], avatar: {}, skins: {}, lastSeenAt: null, lastSeen: null, door: 'open', vip: false, rulesAt: null, placements: {}, createdAt: new Date(now) } as ProfileRow, [], [], record)
    if (recordFrom !== undefined) casino.recordFrom = recordFrom
    applyFinished(casino, casino.constructions.filter(c => c.readyAt.getTime() <= now))
    grantFurniture(casino, null)
    return casino
}

/** Whether the player has built `slug` (live tables check this before seating). */
export function hasBuiltGame(playerId: string, slug: string): boolean {
    return (peekCasino(playerId).games[slug] ?? 0) >= 1
}

/** The refusal for a game the player hasn't built yet. */
export function notBuiltError(slug: string) {
    return createError({ statusCode: 403, statusMessage: `Build ${findGame(slug)?.name ?? slug} in your casino first` })
}

/** The API view of a casino at `now` (`house`: the owner's own read). */
export function toState(casino: Casino, now: number, gemsEnabled: boolean, house = false): TycoonState {
    const view: Casino = { ...casino, pending: null }
    accrueCage(view, now)
    const rushUntil = view.rushUntil !== null && view.rushUntil > now ? view.rushUntil : null
    const campaigns = view.campaigns.filter(c => c.until > now).sort((a, b) => a.until - b.until)
    const campaign = campaigns[0] ? { ...campaigns[0] } : null
    const floor = floorNow(casinoView(view), view.seed, now)
    return {
        serverNow: now,
        chips: view.chips,
        zones: [...view.zones],
        games: { ...view.games },
        upgrades: { ...view.upgrades },
        constructions: view.constructions.map(row => ({
            kind: row.kind,
            id: row.target,
            level: row.level,
            startedAt: row.startedAt.getTime(),
            readyAt: row.readyAt.getTime()
        })),
        builders: view.builders,
        gemBuilder: view.gemBuilder,
        cage: {
            stored: view.cageStored,
            capacity: cageCapacity(view.upgrades.cage),
            perHour: floor.perHour,
            rakeback: view.pots.rakeback,
            visitors: view.pots.visitors
        },
        floor,
        ...(house ? { house: houseState(casinoView(view), now, view.rulesAt) } : {}),
        rushUntil,
        campaign,
        campaigns,
        golden: [...view.golden],
        placements: placementsView(view),
        storedGames: [...view.storedGames],
        decor: view.decor.map(item => ({ id: item.id, type: item.type, x: item.x, y: item.y })),
        progress: progressOf(view),
        gemsEnabled
    }
}

export function isHubPlayer(playerId: string, ex: DbExecutor = db): boolean {
    return ex.select({ origin: players.origin }).from(players).where(eq(players.id, playerId)).get()?.origin === 'hub'
}

/**
 * GET /api/tycoon: the casino as of now (applies finished constructions),
 * with today's missions. Every read is the owner's latest visit; with
 * `welcome`, a read ten minutes or more after the last one also says what
 * happened while they were away (server/utils/welcome.ts).
 */
export function getTycoonState(playerId: string, now = Date.now(), options: { welcome?: boolean } = {}): TycoonState {
    return readCasino(playerId, now, options).value
}

/** The owner's read as a coin unit, so the first read can pay back the removed Decor upgrade. */
function readCasino(playerId: string, now: number, options: { welcome?: boolean }) {
    return commitCoins(({ tx, checkStars }) => {
        const casino = advanceCasino(tx, playerId, now)
        // The removed Decor upgrade is paid back on the owner's first read after it left (the guards make it once).
        const refunded = refundDecor(tx, casino)
        const state = toState(casino, now, isHubPlayer(playerId, tx), true)
        const welcome = noteVisit(tx, casino, state, options.welcome === true)
        // A build that finished since the last unit can reach a goal: the read checks the star level.
        checkStars(playerId)
        return { ...state, cosmetics: cosmeticsOf(playerId, tx), missions: missionsState(tx, playerId, now), welcome, starGoals: starSummaryOf(playerId, tx, now), ...(refunded > 0 ? { decorRefund: refunded } : {}) }
    }, playerId)
}

/**
 * GET /api/tycoon: `getTycoonState`, and the star rise the owner has not been
 * shown yet (one this read reported, or one reported earlier in the
 * background: a build that finished, the sweep, a visitor's round), else null.
 */
export async function readTycoonState(playerId: string, now = Date.now(), options: { welcome?: boolean } = {}): Promise<TycoonState> {
    const { value, stars } = readCasino(playerId, now, options)
    return { ...value, stars: starOf(await stars, playerId) }
}

/** The star change this response hands its player (claimed as seen), in the shape the API sends. */
function starOf(stars: StarChange[], playerId: string): TycoonStarChange | null {
    return ownStarChange(playerId, stars)
}

/**
 * Empty the cage into the coin balance: the guest income (whole coins only:
 * the fraction stays in the cage, category 'cage') and both rakeback pots in
 * full (category 'rakeback'), in one transaction. One update is the guard: a
 * compare-and-set on `cage_at` and on the pots as read in this unit, so
 * parallel collects pay the cage and the pots once. A cage with nothing in it
 * but a pot still collects.
 */
export async function collectCage(playerId: string, now = Date.now()): Promise<TycoonActionResponse> {
    const { value, stars } = await coinTransaction((coins) => {
        const casino = advanceCasino(coins.tx, playerId, now)
        const readAt = casino.cageAt
        const pots = casino.pots
        accrueCage(casino, now)
        const amount = Math.floor(casino.cageStored)
        const rakeback = sumCoins([pots.rakeback, pots.visitors])
        if (amount <= 0 && rakeback <= 0) return { collected: 0, balance: null }
        const emptied = coins.tx.update(casinoProfiles)
            .set({ cageStored: roundCoins(casino.cageStored - amount), cageAt: new Date(Math.max(now, readAt)), cageRakeback: 0, cageVisitors: 0 })
            .where(and(
                eq(casinoProfiles.playerId, playerId),
                eq(casinoProfiles.cageAt, new Date(readAt)),
                eq(casinoProfiles.cageRakeback, pots.rakeback),
                eq(casinoProfiles.cageVisitors, pots.visitors)
            ))
            .returning({ playerId: casinoProfiles.playerId })
            .get()
        if (!emptied) return { collected: 0, balance: null }
        casino.pots = { rakeback: 0, visitors: 0 }
        flushHistory(coins.tx, casino)
        recordMissions(coins.tx, playerId, ['collects'], now)
        let balance = 0
        if (amount > 0) balance = coins.credit({ playerId, amount, category: 'cage' }).coins
        if (rakeback > 0) balance = coins.credit({ playerId, amount: rakeback, category: 'rakeback' }).coins
        return { collected: sumCoins([amount, rakeback]), balance }
    }, playerId)
    return { state: getTycoonState(playerId, now), coins: value.balance, gems: null, collected: value.collected, stars: starOf(stars, playerId) }
}

/** A BuildBody from the request, typed: anything else is a 400. */
export function parseBuildBody(body: unknown): BuildBody {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
    if (typeof input.kind !== 'string' || !KINDS.includes(input.kind as BuildKind)) {
        throw createError({ statusCode: 400, statusMessage: 'kind is zone, game or upgrade' })
    }
    if (typeof input.id !== 'string' || !ID.test(input.id)) throw createError({ statusCode: 400, statusMessage: 'id names what to build' })
    return { kind: input.kind as BuildKind, id: input.id }
}

/**
 * Start building `kind:id`: the chips are debited and the construction row
 * inserted in one transaction. A cost with
 * no build time applies at once. The debits are the affordability guard; the
 * unique (player, kind, target) index stops a second construction of the
 * same thing.
 */
export async function startBuild(playerId: string, body: BuildBody, now = Date.now()): Promise<TycoonActionResponse> {
    const { kind, id } = body
    const { stars } = await coinTransaction((coins) => {
        const casino = advanceCasino(coins.tx, playerId, now)
        const state = toState(casino, now, false)
        const blocker = buildBlocker(state, kind, id)
        if (blocker) throw createError({ statusCode: 400, statusMessage: blocker })
        const cost = nextCost(state, kind, id)
        if (!cost) throw createError({ statusCode: 400, statusMessage: 'Nothing left to build there' })
        const level = levelOf(state, kind, id) + 1
        const reason = `build:${kind}:${id}`

        if (cost.chips > 0) coins.debitChips({ playerId, amount: cost.chips, reason })
        // A new game takes its spot now (home when free, else the nearest free one), so the
        // construction stands where the game will; the blocker above made sure there is one.
        if (kind === 'game' && level === 1 && !casino.placements[id]) {
            const spot = newGameSpot(state, id)
            if (!spot) throw createError({ statusCode: 400, statusMessage: NO_ROOM_BLOCKER })
            casino.placements = { ...casino.placements, [id]: spot }
            coins.tx.update(casinoProfiles).set({ placements: placementsRow(casino) }).where(eq(casinoProfiles.playerId, playerId)).run()
        }

        if (cost.buildMs <= 0) {
            accrueCage(casino, now)
            applyLevel(casino, kind, id, level)
            saveCasino(coins.tx, casino)
        } else {
            const row = coins.tx.insert(casinoConstructions).values({
                playerId,
                kind,
                target: id,
                level,
                startedAt: new Date(now),
                readyAt: new Date(now + cost.buildMs)
            }).onConflictDoNothing().returning({ id: casinoConstructions.id }).get()
            if (!row) throw createError({ statusCode: 409, statusMessage: 'Already under construction' })
        }
        recordMissions(coins.tx, playerId, ['build'], now)
    }, playerId)
    floorChanged(playerId)
    return { state: getTycoonState(playerId, now), coins: null, gems: null, collected: 0, stars: starOf(stars, playerId) }
}

/** Finish `kind:id` now (a gem skip), inside the caller's transaction. False when it isn't running. */
export function finishConstruction(tx: Tx, playerId: string, kind: BuildKind, id: string, now = Date.now(), constructionId?: string): boolean {
    // A Decor level left building (the upgrade is gone) is refunded in chips, never finished: the skip is handed back.
    if (kind === 'upgrade' && !findUpgrade(id)) return false
    const casino = advanceCasino(tx, playerId, now)
    const done = tx.delete(casinoConstructions)
        .where(and(
            eq(casinoConstructions.playerId, playerId),
            eq(casinoConstructions.kind, kind),
            eq(casinoConstructions.target, id),
            constructionId ? eq(casinoConstructions.id, constructionId) : undefined
        ))
        .returning()
        .get()
    if (!done) return false
    accrueCage(casino, now)
    applyLevel(casino, done.kind, done.target, done.level)
    casino.constructions = casino.constructions.filter(row => row.id !== done.id)
    saveCasino(tx, casino)
    floorChanged(playerId)
    return true
}

/** Chips held, read straight from the profile (0 without one). */
export function chipBalance(playerId: string, ex: DbExecutor = db): number {
    return ex.select({ chips: casinoProfiles.chips }).from(casinoProfiles).where(eq(casinoProfiles.playerId, playerId)).get()?.chips ?? 0
}

/** POST /api/tycoon/campaign body: `{ id }`, a campaign id. */
export function parseCampaignBody(body: unknown): CampaignId {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
    if (typeof input.id !== 'string' || !findCampaign(input.id)) {
        throw createError({ statusCode: 400, statusMessage: 'id names a campaign' })
    }
    return input.id as CampaignId
}

/**
 * Run an ad campaign: pay its chips, and more (or richer) guests come until
 * it ends. Campaigns of different kinds run at once; running the same one
 * again extends it. The cage is
 * brought up to now at the old rate first; the chip debit is the guard.
 */
export async function startCampaign(playerId: string, id: CampaignId, now = Date.now()): Promise<TycoonActionResponse> {
    const { stars } = await coinTransaction((coins) => {
        const casino = advanceCasino(coins.tx, playerId, now)
        const blocked = campaignBlocker(casino, id, now)
        if (blocked) throw createError({ statusCode: 400, statusMessage: blocked })
        const def = findCampaign(id)!
        coins.debitChips({ playerId, amount: campaignCost(casino, id, now), reason: `campaign:${id}` })
        accrueCage(casino, now)
        // Campaigns of different kinds run side by side; the same kind again extends its queue.
        const mine = casino.campaigns.find(c => c.id === id)
        const from = mine && mine.until > now ? mine.until : now
        casino.campaigns = [...casino.campaigns.filter(c => c.id !== id && c.until > now), { id, until: from + def.ms }]
        saveCasino(coins.tx, casino)
        recordMissions(coins.tx, playerId, ['campaign'], now)
    }, playerId)
    return { state: getTycoonState(playerId, now), coins: null, gems: null, collected: 0, stars: starOf(stars, playerId) }
}

/** POST /api/tycoon/rules body: some of `door` (open, limit, closed) and `vip` (boolean). Anything else is a 400. */
export function parseRulesBody(body: unknown): RulesBody {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, statusMessage: 'Send the rules to change' })
    const input = body as Record<string, unknown>
    const keys = Object.keys(input)
    if (!keys.length) throw createError({ statusCode: 400, statusMessage: 'Send the rules to change' })
    const rules: RulesBody = {}
    for (const key of keys) {
        if (key !== 'door' && key !== 'vip') throw createError({ statusCode: 400, statusMessage: `Unknown rule ${key.slice(0, 20)}` })
        if (!isRuleValue(key, input[key])) {
            throw createError({ statusCode: 400, statusMessage: key === 'door' ? 'door is open, limit or closed' : `${key} is true or false` })
        }
        (rules as Record<HouseRuleId, unknown>)[key] = input[key]
    }
    return rules
}

/**
 * Change house rules: the casino is brought up to now (finished builds, the
 * cage at the old rules), then one update sets the rules, the cage and
 * `rules_at`, guarded on the cooldown (`rules_at` null or RULES_COOLDOWN_MS
 * ago), so a burst of changes lands once. A rule the casino hasn't unlocked
 * is a 403; the same rules again change nothing (no cooldown).
 */
export function setHouseRules(playerId: string, body: RulesBody, now = Date.now()): TycoonActionResponse {
    writeTx((tx) => {
        const casino = advanceCasino(tx, playerId, now)
        const open = unlockedRules(casinoView(casino))
        for (const rule of Object.keys(body) as HouseRuleId[]) {
            if (!open.includes(rule)) throw createError({ statusCode: 403, statusMessage: `Open the ${findZone(ruleZone(rule))?.name ?? 'next zone'} first` })
        }
        const next: HouseRules = { ...casino.rules, ...body }
        if (next.door === casino.rules.door && next.vip === casino.rules.vip) return
        const ready = casino.rulesAt === null ? now : casino.rulesAt + RULES_COOLDOWN_MS
        if (now < ready) throw createError({ statusCode: 429, statusMessage: `The rules can change again in ${Math.ceil((ready - now) / 60_000)} min` })
        accrueCage(casino, now)
        const changed = tx.update(casinoProfiles)
            .set({ door: next.door, vip: next.vip, rulesAt: new Date(now), cageStored: casino.cageStored, cageAt: new Date(casino.cageAt) })
            .where(and(
                eq(casinoProfiles.playerId, playerId),
                or(isNull(casinoProfiles.rulesAt), lte(casinoProfiles.rulesAt, new Date(now - RULES_COOLDOWN_MS)))
            ))
            .returning({ playerId: casinoProfiles.playerId })
            .get()
        if (!changed) throw createError({ statusCode: 429, statusMessage: 'The rules just changed' })
        flushHistory(tx, casino)
    })
    return { state: getTycoonState(playerId, now), coins: null, gems: null, collected: 0, stars: null }
}

/** The `range` query of GET /api/tycoon/history: 24h (default) or 3d. */
export function parseHistoryRange(value: unknown): '24h' | '3d' {
    if (value === undefined) return '24h'
    if (value === '24h' || value === '3d') return value
    throw createError({ statusCode: 400, statusMessage: 'range is 24h or 3d' })
}

const HOUR_MS = 60 * 60_000

/**
 * The floor hour by hour from `from` to `now`, whole hours, oldest first:
 * the stored history plus the stretch the cage hasn't accrued for good yet
 * (worked out now). Hours with nothing are zeros.
 */
export function historyHours(ex: DbExecutor, playerId: string, from: number, now: number): HistoryHour[] {
    const first = Math.floor(from / HOUR_MS) * HOUR_MS
    const last = Math.floor(now / HOUR_MS) * HOUR_MS
    const casino = peekCasino(playerId, now, ex, true, first)
    accrueCage(casino, now)
    const rows = ex.select().from(casinoHistory)
        .where(and(eq(casinoHistory.playerId, playerId), sql`${casinoHistory.hour} >= ${first}`))
        .all()
    const pieces: HourPiece[] = rows.map(row => ({
        at: row.hour.getTime(),
        guestHours: { tourist: row.touristHours, regular: row.regularHours, highroller: row.highrollerHours, whale: row.whaleHours },
        ms: row.coveredMs,
        income: row.income,
        lost: row.lost
    }))
    const byHour = new Map(mergeHours([...pieces, ...(casino.pending ?? [])]).map(hour => [hour.at, hour]))
    const hours: HistoryHour[] = []
    for (let at = first; at <= last; at += HOUR_MS) {
        const hour = byHour.get(at)
        const covered = hour && hour.ms > 0 ? hour.ms / HOUR_MS : 0
        const average = (n: number) => (covered > 0 ? Math.round(n / covered * 100) / 100 : 0)
        hours.push({
            at,
            visitors: {
                tourist: average(hour?.guestHours.tourist ?? 0),
                regular: average(hour?.guestHours.regular ?? 0),
                highroller: average(hour?.guestHours.highroller ?? 0),
                whale: average(hour?.guestHours.whale ?? 0)
            },
            income: Math.floor(hour?.income ?? 0),
            lost: Math.floor(hour?.lost ?? 0)
        })
    }
    return hours
}

/** GET /api/tycoon/history: the last 24 hours or 3 days of the player's own floor. */
export function getHistory(playerId: string, range: '24h' | '3d', now = Date.now()): HistoryResponse {
    const hours = range === '24h' ? 24 : 72
    return { range, hours: historyHours(db, playerId, now - (hours - 1) * HOUR_MS, now) }
}

// ── Decorations and placement ─────────────────────────────────────────────

/** A whole tile from x and y (both or neither): anything else is a 400. */
function parseTile(input: Record<string, unknown>, required: boolean): { x: number, y: number } | null {
    if (input.x === undefined && input.y === undefined && !required) return null
    if (!Number.isInteger(input.x) || !Number.isInteger(input.y)) throw createError({ statusCode: 400, statusMessage: 'x and y are whole tiles' })
    return { x: input.x as number, y: input.y as number }
}

function bodyObject(body: unknown): Record<string, unknown> {
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
}

/** POST /api/tycoon/decor body: `{ type }`, or `{ type, x, y }` to place it at once. Anything else is a 400. */
export function parseBuyDecorBody(body: unknown): BuyDecorBody {
    const input = bodyObject(body)
    if (typeof input.type !== 'string' || !DECOR_TYPES.includes(input.type as DecorType)) throw createError({ statusCode: 400, statusMessage: 'type names a decoration' })
    const at = parseTile(input, false)
    return at ? { type: input.type as DecorType, ...at } : { type: input.type as DecorType }
}

/** `store: true` without x and y, or nothing: anything else is a 400. */
function parseStore(input: Record<string, unknown>): boolean {
    if (input.store === undefined) return false
    if (input.store !== true || input.x !== undefined || input.y !== undefined) throw createError({ statusCode: 400, statusMessage: 'store is true, without x and y' })
    return true
}

/** POST /api/tycoon/place body: `{ item: 'game' | 'decor', id, x, y }` or `{ item, id, store: true }`. */
export function parsePlaceBody(body: unknown): PlaceBody {
    const input = bodyObject(body)
    if (input.item === 'game') {
        if (typeof input.id !== 'string' || !ID.test(input.id)) throw createError({ statusCode: 400, statusMessage: 'id names a game' })
        if (parseStore(input)) return { item: 'game', id: input.id, store: true }
        return { item: 'game', id: input.id, ...parseTile(input, true)! }
    }
    if (input.item === 'decor') {
        if (!Number.isSafeInteger(input.id) || (input.id as number) < 1) throw createError({ statusCode: 400, statusMessage: 'id names a decoration' })
        if (parseStore(input)) return { item: 'decor', id: input.id as number, store: true }
        return { item: 'decor', id: input.id as number, ...parseTile(input, true)! }
    }
    throw createError({ statusCode: 400, statusMessage: 'item is game or decor' })
}

/**
 * Buy a decoration for chips (`decor:<type>`): level-gated, a special once
 * per casino. With x and y it is placed at once (the spot is checked in the
 * same transaction against the rows read in it: a bad spot is a 400 and
 * nothing is bought), else it goes to storage. A special placed changes the
 * rate: the cage is accrued up to now first. The chip debit and the unique
 * (player, special) index are the guards.
 */
export async function buyDecor(playerId: string, body: BuyDecorBody, now = Date.now()): Promise<TycoonActionResponse> {
    const def = findDecor(body.type)
    if (!def) throw createError({ statusCode: 400, statusMessage: 'type names a decoration' })
    const at = body.x !== undefined && body.y !== undefined ? { x: body.x, y: body.y } : null
    const { stars } = await coinTransaction((coins) => {
        const casino = advanceCasino(coins.tx, playerId, now)
        if (casinoLevel(casino).level < def.level) throw createError({ statusCode: 403, statusMessage: `Reach casino level ${def.level}` })
        if (def.special && casino.decor.some(item => item.type === def.type)) throw createError({ statusCode: 409, statusMessage: `You already own the ${def.name}` })
        if (at) {
            const problem = placementProblem(casinoLayout(casino), { kind: 'decor', type: def.type }, at)
            if (problem) throw createError({ statusCode: 400, statusMessage: problem })
        }
        coins.debitChips({ playerId, amount: def.chips, reason: `decor:${def.type}` })
        const lifts = !!def.special && !!at
        if (lifts) accrueCage(casino, now)
        const row = coins.tx.insert(casinoDecor)
            .values({ playerId, type: def.type, x: at?.x ?? null, y: at?.y ?? null, special: def.special ? def.type : null })
            .onConflictDoNothing()
            .returning()
            .get()
        if (!row) throw createError({ statusCode: 409, statusMessage: `You already own the ${def.name}` })
        if (lifts) saveCasino(coins.tx, casino)
    }, playerId)
    if (at) floorChanged(playerId)
    return { state: getTycoonState(playerId, now), coins: null, gems: null, collected: 0, stars: starOf(stars, playerId) }
}

/**
 * Place, move or put away a game or a decoration. Free. The spot is checked
 * inside the BEGIN IMMEDIATE transaction against the rows read in it, so of
 * two parallel moves onto the same tile only the first lands. A game under
 * construction can move too (the builders follow it) but not be put away. A
 * game or a special going onto or off the floor changes the rate: the cage is
 * accrued up to now first.
 */
export function placeItem(playerId: string, body: PlaceBody, now = Date.now()): TycoonActionResponse {
    writeTx((tx) => {
        const casino = advanceCasino(tx, playerId, now)
        if (body.item === 'game') {
            placeGame(tx, casino, body, now)
            return
        }
        const item = casino.decor.find(d => d.id === body.id)
        if (!item) throw createError({ statusCode: 404, statusMessage: 'That decoration is not yours' })
        const special = !!findDecor(item.type)?.special
        const wasPlaced = item.x !== null
        const at = 'store' in body ? null : { x: body.x, y: body.y }
        if (!at && !wasPlaced) return
        if (at) {
            const problem = placementProblem(casinoLayout(casino), { kind: 'decor', id: item.id, type: item.type }, at)
            if (problem) throw createError({ statusCode: 400, statusMessage: problem })
        }
        // A special going onto or off the floor changes what guests spend: the cage first runs at the old rate.
        const lifts = special && wasPlaced !== !!at
        if (lifts) accrueCage(casino, now)
        const moved = tx.update(casinoDecor)
            .set({ x: at?.x ?? null, y: at?.y ?? null })
            .where(and(eq(casinoDecor.id, item.id), eq(casinoDecor.playerId, playerId)))
            .returning({ id: casinoDecor.id })
            .get()
        if (!moved) throw createError({ statusCode: 404, statusMessage: 'That decoration is not yours' })
        item.x = at?.x ?? null
        item.y = at?.y ?? null
        if (lifts) saveCasino(tx, casino)
    })
    floorChanged(playerId)
    return { state: getTycoonState(playerId, now), coins: null, gems: null, collected: 0, stars: null }
}

/**
 * `placeItem` for a game, inside its transaction: move one on the floor (the
 * rate stays: where a game stands never changes income), put a built one
 * away, or place one from storage. Putting away and placing change the seats:
 * the cage runs at the old rate up to now first, and the casino is saved with
 * it.
 */
function placeGame(tx: Tx, casino: Casino, body: Extract<PlaceBody, { item: 'game' }>, now: number) {
    const building = casino.constructions.some(row => row.kind === 'game' && row.target === body.id)
    if (!building && (casino.games[body.id] ?? 0) < 1) throw createError({ statusCode: 404, statusMessage: 'You have not built that game' })
    const stored = casino.storedGames.includes(body.id)
    if ('store' in body) {
        if (building) throw createError({ statusCode: 400, statusMessage: 'A game under construction can\'t be put away' })
        if (stored) return
        accrueCage(casino, now)
        const placements = { ...casino.placements }
        delete placements[body.id]
        casino.placements = placements
        casino.storedGames = [...casino.storedGames, body.id].sort()
        saveCasino(tx, casino)
        return
    }
    const at = { x: body.x, y: body.y }
    const problem = placementProblem(casinoLayout(casino), { kind: 'game', id: body.id }, at)
    if (problem) throw createError({ statusCode: 400, statusMessage: problem })
    if (stored) {
        accrueCage(casino, now)
        casino.storedGames = casino.storedGames.filter(slug => slug !== body.id)
        casino.placements = { ...casino.placements, [body.id]: at }
        saveCasino(tx, casino)
        return
    }
    casino.placements = { ...casino.placements, [body.id]: at }
    tx.update(casinoProfiles).set({ placements: placementsRow(casino) }).where(eq(casinoProfiles.playerId, casino.playerId)).run()
}
