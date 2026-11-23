import { and, eq, lte } from 'drizzle-orm'
import { db, type DbExecutor, type Tx, writeTx } from '../database'
import { casinoConstructions, casinoProfiles, players } from '../database/schema'
import { findGame } from '../../shared/games/registry'
import { roundCoins } from '../../shared/money'
import {
    buildBlocker,
    builderCount,
    cageCapacity,
    guestChipsBetween,
    guestsPerHour,
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
    type BuildKind,
    type TycoonActionResponse,
    type TycoonStarChange,
    type TycoonState,
    type UpgradeId,
    type ZoneId
} from '../../shared/tycoon'
import { cosmeticsOf } from './cosmetics'
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
    campaign: { id: CampaignId, until: number } | null
    constructions: ConstructionRow[]
}

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

function fromRow(row: ProfileRow, constructions: ConstructionRow[]): Casino {
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
        campaign: row.campaign && row.campaignUntil && findCampaign(row.campaign)
            ? { id: row.campaign as CampaignId, until: row.campaignUntil.getTime() }
            : null,
        constructions: constructions.filter(known).sort((a, b) => a.readyAt.getTime() - b.readyAt.getTime())
    }
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

/** Bring the cage up to `to` at the casino's current build (rush included), capped at capacity. */
export function accrueCage(casino: Casino, to: number) {
    if (!(to > casino.cageAt)) return
    const capacity = cageCapacity(casino.upgrades.cage)
    const gained = guestChipsBetween(casino, casino.cageAt, to)
    casino.cageStored = Math.max(casino.cageStored, Math.min(capacity, roundCoins(casino.cageStored + gained)))
    casino.cageAt = to
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

/** Persist the build and the cage (not chips: those move through chips.ts). */
export function saveCasino(tx: Tx, casino: Casino) {
    tx.update(casinoProfiles).set({
        zones: casino.zones,
        games: casino.games,
        upgrades: casino.upgrades,
        golden: casino.golden,
        builders: casino.gemBuilder ? 2 : 1,
        cageStored: casino.cageStored,
        cageAt: new Date(casino.cageAt),
        rushUntil: casino.rushUntil === null ? null : new Date(casino.rushUntil),
        campaign: casino.campaign?.id ?? null,
        campaignUntil: casino.campaign ? new Date(casino.campaign.until) : null
    }).where(eq(casinoProfiles.playerId, casino.playerId)).run()
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

/** The casino as of `now` without writing anything (a missing one reads as new). */
export function peekCasino(playerId: string, now = Date.now(), ex: DbExecutor = db): Casino {
    const { row, constructions } = loadRows(ex, playerId)
    const casino = row
        ? fromRow(row, constructions)
        : fromRow({ ...newProfile(playerId, now), rushUntil: null, campaign: null, campaignUntil: null, avatar: {}, skins: {}, lastSeenAt: null, lastSeen: null, createdAt: new Date(now) } as ProfileRow, [])
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

/** The API view of a casino at `now`. */
export function toState(casino: Casino, now: number, gemsEnabled: boolean): TycoonState {
    const view: Casino = { ...casino }
    accrueCage(view, now)
    const rushUntil = view.rushUntil !== null && view.rushUntil > now ? view.rushUntil : null
    const campaign = view.campaign !== null && view.campaign.until > now ? { ...view.campaign } : null
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
            perHour: guestsPerHour({ ...view, rushUntil, campaign }, now)
        },
        rushUntil,
        campaign,
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
        const state = toState(casino, now, isHubPlayer(playerId, tx))
        const welcome = noteVisit(tx, playerId, state, options.welcome === true)
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
        throw createError({ statusCode: 400, statusMessage: 'id is flyers, billboard or tv' })
    }
    return input.id as CampaignId
}

/**
 * Run an ad campaign: pay its chips, and visitors come in bigger numbers
 * until it ends. Running the same campaign again extends it. The cage is
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
        const from = casino.campaign && casino.campaign.id === id && casino.campaign.until > now ? casino.campaign.until : now
        casino.campaign = { id, until: from + def.ms }
        saveCasino(coins.tx, casino)
        recordMissions(coins.tx, playerId, ['campaign'], now)
    })
    return { state: getTycoonState(playerId, now), coins: null, gems: null, collected: 0, stars: starOf(stars, playerId) }
}
