import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { db, type DbExecutor, type Tx, writeTx } from '../database'
import { casinoConstructions, casinoHistory, casinoProfiles, players } from '../database/schema'
import { findGame } from '../../shared/games/registry'
import { roundCoins } from '../../shared/money'
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
    cageCapacity,
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
import { coinTransaction } from './ledger'
import { missionsState, recordMissions } from './missions'
import { noteVisit } from './welcome'
import type { StarChange } from './stars'

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
    rushUntil: number | null
    /** Ad campaigns, one per kind (some may have run out). */
    campaigns: RunningCampaignRef[]
    constructions: ConstructionRow[]
    /** House rules in force, and when they last changed (ms). */
    rules: HouseRules
    rulesAt: number | null
    /** The luck seed (from the player id). */
    seed: number
    /** History pieces accrued but not written yet (null: a read-only casino, nothing is recorded). */
    pending: HourPiece[] | null
    /** A read-only casino that only needs the hours from here (ms): earlier stretches just fill the cage. */
    recordFrom?: number
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
        cageAt: new Date(now)
    }
}

function fromRow(row: ProfileRow, constructions: ConstructionRow[], record = true): Casino {
    const upgrades = upgradeLevels(row.upgrades)
    const gemBuilder = row.builders >= 2
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
        rushUntil: row.rushUntil?.getTime() ?? null,
        campaigns: campaignsFromRow(row),
        constructions: constructions.filter(known).sort((a, b) => a.readyAt.getTime() - b.readyAt.getTime()),
        rules: { door: DOOR_RULES.includes(row.door) ? row.door : 'open', vip: !!row.vip },
        rulesAt: row.rulesAt?.getTime() ?? null,
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

/** What the visitor model reads of a casino. */
export function casinoView(casino: Pick<Casino, 'zones' | 'games' | 'upgrades' | 'rushUntil' | 'campaigns' | 'rules'>): FloorView {
    return { zones: casino.zones, games: casino.games, upgrades: casino.upgrades, rushUntil: casino.rushUntil, campaign: null, campaigns: casino.campaigns, rules: casino.rules }
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
    return { row, constructions }
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
        upgrades: casino.upgrades,
        golden: casino.golden,
        builders: casino.gemBuilder ? 2 : 1,
        cageStored: casino.cageStored,
        cageAt: new Date(casino.cageAt),
        rushUntil: casino.rushUntil === null ? null : new Date(casino.rushUntil),
        campaign: first?.id ?? null,
        campaignUntil: first ? new Date(first.until) : null,
        campaigns: live
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
    const { row, constructions } = loadRows(tx, playerId)
    if (!row) throw new Error(`No casino for ${playerId}`)
    const casino = fromRow(row, constructions)
    // The delete is the guard: a finished construction applies once.
    const finished = tx.delete(casinoConstructions)
        .where(and(eq(casinoConstructions.playerId, playerId), lte(casinoConstructions.readyAt, new Date(now))))
        .returning()
        .all()
    if (finished.length) {
        applyFinished(casino, finished)
        saveCasino(tx, casino)
    }
    return casino
}

/**
 * The casino as of `now` without writing anything (a missing one reads as
 * new). With `record`, the history pieces of the finished constructions'
 * accrual stay in `pending` (never written).
 */
export function peekCasino(playerId: string, now = Date.now(), ex: DbExecutor = db, record = false, recordFrom?: number): Casino {
    const { row, constructions } = loadRows(ex, playerId)
    const casino = row
        ? fromRow(row, constructions, record)
        : fromRow({ ...newProfile(playerId, now), rushUntil: null, campaign: null, campaignUntil: null, campaigns: [], avatar: {}, skins: {}, lastSeenAt: null, lastSeen: null, door: 'open', vip: false, rulesAt: null, createdAt: new Date(now) } as ProfileRow, [], record)
    if (recordFrom !== undefined) casino.recordFrom = recordFrom
    applyFinished(casino, casino.constructions.filter(c => c.readyAt.getTime() <= now))
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
            perHour: floor.perHour
        },
        floor,
        ...(house ? { house: houseState(casinoView(view), now, view.rulesAt) } : {}),
        rushUntil,
        campaign,
        campaigns,
        golden: [...view.golden],
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
    return writeTx((tx) => {
        const casino = advanceCasino(tx, playerId, now)
        const state = toState(casino, now, isHubPlayer(playerId, tx), true)
        const welcome = noteVisit(tx, casino, state, options.welcome === true)
        return { ...state, cosmetics: cosmeticsOf(playerId, tx), missions: missionsState(tx, playerId, now), welcome }
    })
}

/** The star change for this player, in the shape the API sends. */
function starOf(stars: StarChange[], playerId: string): TycoonStarChange | null {
    return stars.find(change => change.playerId === playerId) ?? null
}

/**
 * Empty the cage into the coin balance. Whole coins only: the fraction stays
 * in the cage. The compare-and-set on `cage_at` is the guard, so parallel
 * collects pay the cage once.
 */
export async function collectCage(playerId: string, now = Date.now()): Promise<TycoonActionResponse> {
    const { value } = await coinTransaction((coins) => {
        const casino = advanceCasino(coins.tx, playerId, now)
        const readAt = casino.cageAt
        accrueCage(casino, now)
        const amount = Math.floor(casino.cageStored)
        if (amount <= 0) return { collected: 0, balance: null }
        const emptied = coins.tx.update(casinoProfiles)
            .set({ cageStored: roundCoins(casino.cageStored - amount), cageAt: new Date(Math.max(now, readAt)) })
            .where(and(eq(casinoProfiles.playerId, playerId), eq(casinoProfiles.cageAt, new Date(readAt))))
            .returning({ playerId: casinoProfiles.playerId })
            .get()
        if (!emptied) return { collected: 0, balance: null }
        flushHistory(coins.tx, casino)
        recordMissions(coins.tx, playerId, ['collects'], now)
        return { collected: amount, balance: coins.credit({ playerId, amount, category: 'cage' }).coins }
    })
    return { state: getTycoonState(playerId, now), coins: value.balance, gems: null, collected: value.collected, stars: null }
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
    })
    return { state: getTycoonState(playerId, now), coins: null, gems: null, collected: 0, stars: starOf(stars, playerId) }
}

/** Finish `kind:id` now (a gem skip), inside the caller's transaction. False when it isn't running. */
export function finishConstruction(tx: Tx, playerId: string, kind: BuildKind, id: string, now = Date.now(), constructionId?: string): boolean {
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
    })
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
