/**
 * My Casino: the tycoon layer. The player owns a casino floor, starts with a
 * backroom holding Pegfall (plinko) and Spiñata, and builds the rest with **chips**.
 *
 * Economy v2, "claim coins, win chips" (binding, see docs/casino-economy.md):
 * - **Coins are claimed, never won**: the cashier cage
 *   (guest income, paid in coins, collected at the cage) and gems converted
 *   at the hub's convert. Coins can only be bet.
 * - **Every win pays chips.** A stake is paid from coins first, then chips
 *   for whatever coins don't cover (`splitStake`), and the whole payout
 *   (stake included) comes as chips; a loss is gone. So claimed coins are
 *   gambled at least once before they become chips, and chips can be
 *   gambled for more chips. Live tables too (a refund hands each part back
 *   in its own currency).
 * - **Chips** build the casino (zones, games, levels, upgrades, ad
 *   campaigns) and can be bet. Chips never turn back into coins.
 * - **Stars** (0-10 at the hub) follow the chip balance (shared/stars.ts).
 * - Bound: chips come only from round payouts, and every game's RTP is
 *   below 1, so chips made ≤ coins claimed × RTP in expectation. Coins come
 *   only from the capped cage and gem converts.
 * - Building takes time (construction timers). Gems skip timers and buy
 *   boosts, but the casino stays fully playable with zero gems.
 * - Progress is fast early (the first builds take seconds) and slow late
 *   (hour-long builds, steep costs). A casual player maxes in about four
 *   weeks, a regular one in two to three, a whale in one to two.
 *
 * Everything here is pure and shared by server, client and scripts. Numbers
 * are tuned with `bun scripts/tycoon-sim.ts`.
 */

import type { AvatarLook, CosmeticsState } from './cosmetics'
import { COINS_PER_GEM } from './economy'
import type { MissionsState, WelcomeBack } from './missions'
import { findGame } from './games/registry'
import { normalizeCoins, roundCoins } from './money'

// ── Zones ────────────────────────────────────────────────────────────────

/** Areas of the floor, bought in order. The client lays them out (app/utils/floor/layout.ts). */
export type ZoneId = 'backroom' | 'main' | 'pit' | 'lounge' | 'highlimit' | 'penthouse'

export interface Cost {
    chips: number
    /** @deprecated Builds cost chips only (economy v2): always 0. */
    coins: number
    /** Construction time in milliseconds. 0 = instant. */
    buildMs: number
}

export interface ZoneDef {
    id: ZoneId
    name: string
    /** Previous zone that must be owned first. */
    requires: ZoneId | null
    cost: Cost
}

// ── Games on the floor ───────────────────────────────────────────────────

/** How the floor draws a game's machine. */
export type Archetype =
    | 'slot' // a cabinet (bank of machines), themed by `accent`
    | 'dice' // craps-style dice table
    | 'rocket' // limbo: launch pad with a multiplier tower
    | 'wheel' // upright money wheel
    | 'flight' // poly masters: plane on a runway/island diorama
    | 'hands' // magic hands: a glowing grid table
    | 'roulette' // roulette table with wheel
    | 'cards' // live card table (blackjack, baccarat, hold'em, three card poker)
    | 'plinko' // pegfall: an upright peg-board cabinet with prize slots
    | 'mines' // gem dig: a table with a 5×5 grid of dirt tiles and gems
    | 'hilo' // card climb: a one-on-one card table with a giant flipped card

export interface TycoonGameDef {
    slug: string
    zone: ZoneId
    archetype: Archetype
    /** Main color of the machine, hex. */
    accent: string
    /** Built from the start (no construction). */
    starter?: true
    /** Level 1 = built. Index 0 is the build itself, index n-1 the upgrade to level n. */
    levels: readonly Cost[]
    /** Guest income this game adds at each level, coins per hour with every seat full, before INCOME_SCALE (index 0 = level 1). */
    guestsPerHour: readonly number[]
}

// ── Casino upgrades ──────────────────────────────────────────────────────

export type UpgradeId = 'cage' | 'marketing' | 'decor' | 'crew'

export interface UpgradeDef {
    id: UpgradeId
    name: string
    description: string
    /** Index n = cost of going from level n to n+1. Max level = levels.length. */
    levels: readonly Cost[]
    /** Zone needed for each level (index = target level - 1), null = none. */
    requiresZone: readonly (ZoneId | null)[]
}

// ── Gems ─────────────────────────────────────────────────────────────────

/**
 * Things gems buy. Prices follow the platform guide (10 gems a day: small
 * boost 3-5, meaningful unlock 30-70, never above ~200).
 * - skip: finish one construction now; price from the time left (`skipGems`).
 * - rush: every guest spends double for RUSH_MS, priced from the casino
 *   (`rushGems`: a full floor's extra coins at the convert rate plus a premium).
 * - builder: a permanent extra builder (one more construction at once).
 *   Bought once; it stacks with the Construction Crew (chips), so a casino
 *   has 1 + crew + gem builder = at most MAX_BUILDERS.
 * - golden: a cosmetic golden skin for one built game.
 * - cosmetic: an avatar item or a premium zone skin (shared/cosmetics.ts),
 *   target = its key (`hat:crown`, `skin:royal`). Cosmetic only.
 * Gems never buy chips: chips set the star level, and the platform contract
 * forbids selling star levels for gems.
 */
export type GemItem = 'skip' | 'rush' | 'builder' | 'golden' | 'cosmetic'

// ── State (GET /api/tycoon) ──────────────────────────────────────────────

export type BuildKind = 'zone' | 'game' | 'upgrade'

export interface Construction {
    kind: BuildKind
    id: string
    /** The level it reaches when done (1 for a zone or a new game). */
    level: number
    startedAt: number
    readyAt: number
}

export interface TycoonState {
    /** Server clock (ms) when this state was made; the client extrapolates timers and the cage from it. */
    serverNow: number
    /** The chip balance (what builds, campaigns and chip bets spend; what stars follow). */
    chips: number
    zones: ZoneId[]
    /** Built games and their level (1..max). Missing = not built (or still under construction). */
    games: Record<string, number>
    upgrades: Record<UpgradeId, number>
    /** Running constructions, at most `builders`. Finished ones are applied on every read. */
    constructions: Construction[]
    /** Builders now: 1 + the Construction Crew (chips) + the gem builder (`builderCount`). */
    builders: number
    /** The gem builder is hired (each builder source is bought once). Missing on old payloads = false. */
    gemBuilder?: boolean
    /** The cashier cage: guest income, in **coins**, waiting to be collected. */
    cage: {
        /** Coins in the cage at `serverNow`. */
        stored: number
        /** The most coins it holds. */
        capacity: number
        /** Coins an hour it fills at now. */
        perHour: number
    }
    /** Guest rush active until (ms), or null. */
    rushUntil: number | null
    /** The running ad campaign, or null. */
    campaign: { id: CampaignId, until: number } | null
    /** Games with the golden skin. */
    golden: string[]
    /** Share of everything buildable that is built, 0..1. */
    progress: number
    /** False for dev-login players (no hub, no gems). */
    gemsEnabled: boolean
    /** What the avatar wears, the zone skins and the cosmetics bought (shared/cosmetics.ts). Missing on old payloads. */
    cosmetics?: CosmeticsState
    /** Today's missions (shared/missions.ts). Only on the owner's own reads. */
    missions?: MissionsState
    /** "While you were away": on GET /api/tycoon?welcome=1 after ten minutes or more away, else null. */
    welcome?: WelcomeBack | null
}

// ── API bodies and responses ─────────────────────────────────────────────

/** POST /api/tycoon/build */
export interface BuildBody {
    kind: BuildKind
    id: string
}

/** POST /api/tycoon/gems */
export interface GemBody {
    item: GemItem
    /** skip: the construction's `${kind}:${id}`; golden: the game slug; cosmetic: the item's key. */
    target?: string
}

/** A star level change the hub confirmed after an action (stars follow chips). */
export interface TycoonStarChange {
    playerId: string
    level: number
    previous: number
    /** Gems the hub paid for a new best level. */
    bounty: number
}

/** Response of build, collect, campaign and gem purchases. The chip balance is `state.chips`. */
export interface TycoonActionResponse {
    state: TycoonState
    /** Coin balance after, when coins moved (collect), else null. */
    coins: number | null
    /** Gem balance after a gem purchase, else null. */
    gems: number | null
    /** Coins the action collected from the cage (collect only), else 0. */
    collected: number
    /** The star level change the action's chip spend caused, once the hub confirmed it. */
    stars?: TycoonStarChange | null
    /** Coins a mission claim paid (POST /api/tycoon/mission), else missing. */
    reward?: number
}

/**
 * @deprecated There is no currency choice any more: every stake is paid from
 * coins first, then chips for the rest (`splitStake`). The play endpoint
 * ignores a `funding` field; `game_rounds.funding` is kept for old rows.
 */
export type Funding = 'coins' | 'chips'

/** The two parts of a stake: coins first, then chips for whatever coins don't cover. */
export interface StakeSplit {
    coins: number
    chips: number
}

/**
 * How a stake is paid: coins first, then chips for the rest (stake 100 with
 * 60 coins → 60 coins + 40 chips). Null when coins and chips together can't
 * cover it. The server debits the same split, each part guarded.
 * - POST /api/games/<slug>/play: the response's `stakeCoins` / `stakeChips`
 *   are the two parts, `balance` the coin balance after, `chips` the chip
 *   balance after and `chipsEarned` the payout (always chips; 0 on a loss).
 * - Live tables: every stake is split the same way; a refund hands each part
 *   back in its own currency.
 */
export function splitStake(stake: number, coins: number, chips: number): StakeSplit | null {
    if (!(stake > 0)) return null
    const fromCoins = Math.max(0, Math.min(normalizeCoins(stake), normalizeCoins(coins)))
    const fromChips = normalizeCoins(stake - fromCoins)
    if (fromChips > 0 && !(normalizeCoins(chips) >= fromChips)) return null
    return { coins: fromCoins, chips: fromChips }
}

/** What a player can stake: coins and chips together. */
export function bankroll(coins: number, chips: number): number {
    return normalizeCoins(Math.max(0, coins) + Math.max(0, chips))
}

/** GET /api/tables: who is at each live table, for the floor. */
export interface TableOccupancy {
    slug: string
    /** `avatar`: what they wear (missing on old payloads). */
    seated: { name: string, image: string | null, avatar?: AvatarLook }[]
    seats: number
    watching: number
}


// ── Helpers every side uses ──────────────────────────────────────────────

/** Live tables are watchable by anyone; sitting down needs the game built. */
export function isGameUnlocked(state: Pick<TycoonState, 'games'>, slug: string): boolean {
    return (state.games[slug] ?? 0) >= 1
}

// ── Catalog (tuned with `bun scripts/tycoon-sim.ts`) ─────────────────────

const SEC = 1_000
const MIN = 60 * SEC
const HOUR = 60 * MIN

/** Highest level of a game or an upgrade. */
export const MAX_LEVEL = 5

/**
 * Chip prices (CHIP_SCALE) and guest income in coins (GUEST_SCALE) below are
 * written small and multiplied by these. They size the economy against the
 * fixed amounts outside it (1,000 coins a
 * converted gem, the star thresholds), so the cage carries a casino's
 * income and gems stay a boost, not a skip.
 */
const CHIP_SCALE = 6
/** The Construction Crew (+1 builder for chips): the mid-game goal after the Slot Lounge. Before CHIP_SCALE. */
const CREW_CHIPS = 8_000
const CREW_MS = 4 * HOUR
const GUEST_SCALE = 30

function roundChips(chips: number): number {
    if (chips < 100) return Math.round(chips)
    return chips < 1_000 ? Math.round(chips / 10) * 10 : Math.round(chips / 100) * 100
}

function cost(chips: number, buildMs: number): Cost {
    return { chips: roundChips(chips * CHIP_SCALE), coins: 0, buildMs }
}

export const ZONES: readonly ZoneDef[] = [
    { id: 'backroom', name: 'Backroom', requires: null, cost: cost(0, 0) },
    { id: 'main', name: 'Main Floor', requires: 'backroom', cost: cost(600, 25 * MIN) },
    { id: 'pit', name: 'Table Pit', requires: 'main', cost: cost(3_000, 2 * HOUR) },
    { id: 'lounge', name: 'Slot Lounge', requires: 'pit', cost: cost(7_000, 4 * HOUR) },
    { id: 'highlimit', name: 'High Limit Room', requires: 'lounge', cost: cost(14_000, 7 * HOUR) },
    { id: 'penthouse', name: 'Penthouse', requires: 'highlimit', cost: cost(22_000, 9 * HOUR) }
]

/** Chip and time factors of levels 1-5 against a game's build. */
const LEVEL_CHIPS = [1, 1.6, 2.4, 3.8, 5.5] as const
const LEVEL_TIME = [1, 2, 3, 4, 5] as const
/** The shortest a level-up takes (index = level - 1): minutes early, hours at the top. */
const LEVEL_MIN_MS = [0, MIN, 15 * MIN, HOUR, 3 * HOUR] as const
/** No single construction runs longer than this. */
const MAX_BUILD_MS = 9 * HOUR

/** Whole minutes from ten minutes up, else whole five seconds. */
function roundMs(ms: number): number {
    const step = ms >= 10 * MIN ? MIN : 5 * SEC
    return Math.round(ms / step) * step
}

/**
 * Level costs for a game that builds for `chips` in `ms`: every level
 * steeper and slower than the one before. `starter` games come built, so
 * their level 1 is free and instant.
 */
function gameLevels(chips: number, ms: number, starter = false): Cost[] {
    return LEVEL_CHIPS.map((factor, i) => i === 0 && starter
        ? cost(0, 0)
        : cost(chips * factor, Math.min(MAX_BUILD_MS, roundMs(Math.max(LEVEL_MIN_MS[i]!, ms * LEVEL_TIME[i]!)))))
}

/** Guest income per level against level 1. */
const LEVEL_GUESTS = [1.3, 1.7, 2.05, 2.3, 2.45] as const

function guests(base: number): number[] {
    return LEVEL_GUESTS.map(factor => Math.round(base * factor * GUEST_SCALE * 10) / 10)
}

export const TYCOON_GAMES: readonly TycoonGameDef[] = [
    // Backroom
    { slug: 'plinko', zone: 'backroom', archetype: 'plinko', accent: '#06b6d4', starter: true, levels: gameLevels(40, MIN, true), guestsPerHour: guests(4) },
    { slug: 'spinata', zone: 'backroom', archetype: 'slot', accent: '#f43f5e', starter: true, levels: gameLevels(40, MIN, true), guestsPerHour: guests(4) },
    { slug: 'limbo', zone: 'backroom', archetype: 'rocket', accent: '#38bdf8', levels: gameLevels(80, 10 * SEC), guestsPerHour: guests(2) },
    { slug: 'wheel', zone: 'backroom', archetype: 'wheel', accent: '#facc15', levels: gameLevels(200, 45 * SEC), guestsPerHour: guests(2) },
    // Main floor
    { slug: 'roulette', zone: 'main', archetype: 'roulette', accent: '#ef4444', levels: gameLevels(250, 5 * MIN), guestsPerHour: guests(2) },
    { slug: 'trashpanda', zone: 'main', archetype: 'slot', accent: '#84cc16', levels: gameLevels(270, 8 * MIN), guestsPerHour: guests(2) },
    { slug: 'fireinthehole', zone: 'main', archetype: 'slot', accent: '#f97316', levels: gameLevels(290, 10 * MIN), guestsPerHour: guests(2) },
    { slug: 'candymadness', zone: 'main', archetype: 'slot', accent: '#ec4899', levels: gameLevels(310, 12 * MIN), guestsPerHour: guests(2) },
    { slug: 'dice', zone: 'main', archetype: 'dice', accent: '#22c55e', levels: gameLevels(330, 14 * MIN), guestsPerHour: guests(1.5) },
    // Table pit
    { slug: 'blackjack', zone: 'pit', archetype: 'cards', accent: '#10b981', levels: gameLevels(450, 30 * MIN), guestsPerHour: guests(2.5) },
    { slug: 'three-card-poker', zone: 'pit', archetype: 'cards', accent: '#6366f1', levels: gameLevels(470, 35 * MIN), guestsPerHour: guests(2.5) },
    { slug: 'polymasters', zone: 'pit', archetype: 'flight', accent: '#0ea5e9', levels: gameLevels(450, 30 * MIN), guestsPerHour: guests(2.5) },
    // Slot lounge
    { slug: 'bookofshadows', zone: 'lounge', archetype: 'slot', accent: '#a855f7', levels: gameLevels(720, 55 * MIN), guestsPerHour: guests(3) },
    { slug: 'xenoslot', zone: 'lounge', archetype: 'slot', accent: '#14b8a6', levels: gameLevels(750, 60 * MIN), guestsPerHour: guests(3) },
    { slug: 'emberportals', zone: 'lounge', archetype: 'slot', accent: '#fb923c', levels: gameLevels(770, 65 * MIN), guestsPerHour: guests(3) },
    { slug: 'magichands', zone: 'lounge', archetype: 'hands', accent: '#c084fc', levels: gameLevels(750, 65 * MIN), guestsPerHour: guests(3) },
    // High limit
    { slug: 'baccarat', zone: 'highlimit', archetype: 'cards', accent: '#b91c1c', levels: gameLevels(1_030, 100 * MIN), guestsPerHour: guests(3.5) },
    { slug: 'casino-holdem', zone: 'highlimit', archetype: 'cards', accent: '#1d4ed8', levels: gameLevels(1_060, 100 * MIN), guestsPerHour: guests(3.5) },
    { slug: 'aethergates', zone: 'highlimit', archetype: 'slot', accent: '#eab308', levels: gameLevels(1_090, 135 * MIN), guestsPerHour: guests(3.5) },
    // Penthouse
    { slug: 'mines', zone: 'penthouse', archetype: 'mines', accent: '#10b981', levels: gameLevels(1_150, 115 * MIN), guestsPerHour: guests(2.5) },
    { slug: 'hilo', zone: 'penthouse', archetype: 'hilo', accent: '#8b5cf6', levels: gameLevels(1_200, 135 * MIN), guestsPerHour: guests(2.5) }
]

export const UPGRADES: readonly UpgradeDef[] = [
    {
        id: 'cage',
        name: 'Cashier Cage',
        description: 'The cage holds more guest coins before it is full.',
        levels: [cost(150, 30 * SEC), cost(700, 20 * MIN), cost(1_800, 2 * HOUR), cost(4_000, 7 * HOUR), cost(6_600, 9 * HOUR)],
        requiresZone: [null, 'main', 'pit', 'lounge', 'highlimit']
    },
    {
        id: 'marketing',
        name: 'Marketing',
        description: 'A known name draws more visitors, unlocks bigger ad campaigns (Billboard at 2, TV at 4) and makes every campaign stronger.',
        levels: [cost(150, MIN), cost(1_000, 30 * MIN), cost(2_500, 3 * HOUR), cost(5_500, 8 * HOUR), cost(8_800, 9 * HOUR)],
        requiresZone: [null, 'main', 'pit', 'lounge', 'highlimit']
    },
    {
        id: 'decor',
        name: 'Decor',
        description: 'Carpet, lights and chandeliers: a nicer casino draws more visitors.',
        levels: [cost(400, 3 * MIN), cost(1_400, 45 * MIN), cost(3_000, 4 * HOUR), cost(6_600, 9 * HOUR), cost(9_900, 9 * HOUR)],
        requiresZone: ['main', 'pit', 'lounge', 'highlimit', 'penthouse']
    },
    {
        id: 'crew',
        name: 'Construction Crew',
        description: 'Hire a second crew for good: one more builder, so one more construction at once.',
        levels: [cost(CREW_CHIPS, CREW_MS)],
        requiresZone: ['lounge']
    }
]

export const UPGRADE_IDS: readonly UpgradeId[] = UPGRADES.map(upgrade => upgrade.id)

export function findZone(id: string): ZoneDef | undefined {
    return ZONES.find(zone => zone.id === id)
}

export function findTycoonGame(slug: string): TycoonGameDef | undefined {
    return TYCOON_GAMES.find(game => game.slug === slug)
}

export function findUpgrade(id: string): UpgradeDef | undefined {
    return UPGRADES.find(upgrade => upgrade.id === id)
}

// ── Economy numbers ──────────────────────────────────────────────────────

/**
 * Three builders at most: the first comes free, one more with the
 * Construction Crew (an upgrade, chips) and one more for BUILDER_GEMS. Each
 * source is bought once, in any order.
 */
export const MAX_BUILDERS = 3
/** A guest rush doubles guest income for this long. */
export const RUSH_MS = 4 * HOUR
/** The cheapest a rush is (a young casino); the price grows with the casino (`rushGems`). */
export const RUSH_GEMS = 5
/** The dearest a rush is (the platform guide's ceiling for a boost). */
export const RUSH_MAX_GEMS = 100
/** A rush costs this much more than converting gems into the same coins: gems only make it faster. */
const RUSH_PREMIUM = 1.25
/** The permanent gem builder (one more construction at once). */
export const BUILDER_GEMS = 60
/** A golden skin for one built game (cosmetic only). */
export const GOLDEN_GEMS = 30

/** Coins a new casino finds in its cage: enough to win the first builds. */
export const STARTER_CAGE = 250 * GUEST_SCALE

/** Cage capacity in coins by Cashier Cage level 0-5. */
const CAGE_CAPACITY = [250, 400, 600, 800, 1_000, 1_200].map(coins => coins * GUEST_SCALE)
const RUSH_FACTOR = 2

function levelIndex(level: number, max: number): number {
    return Number.isFinite(level) ? Math.max(0, Math.min(max, Math.floor(level))) : 0
}

export function cageCapacity(level: number): number {
    return CAGE_CAPACITY[levelIndex(level, CAGE_CAPACITY.length - 1)]!
}

/** Builders a casino has: 1, +1 with the Construction Crew built, +1 with the gem builder hired. */
export function builderCount(upgrades: Partial<Record<UpgradeId, number>>, gemBuilder: boolean): number {
    return 1 + ((upgrades.crew ?? 0) >= 1 ? 1 : 0) + (gemBuilder ? 1 : 0)
}

// ── Visitors ─────────────────────────────────────────────────────────────
//
// Every built game has seats; visitors come for the games (each draws by its
// seats, so a card table pulls more than a slot; higher levels draw more), the decor and the casino's name (Marketing), and an ad
// campaign multiplies that for a while. Visitors on the floor = the smaller
// of demand and seats; the rest queue at the door. Guest income is what the
// floor earns with every seat taken, times the share of seats in use: so a
// casino without a campaign runs part empty, and one with too few seats
// turns people away. A guest rush makes every visitor spend double.

export type CampaignId = 'flyers' | 'billboard' | 'tv'

export interface CampaignDef {
    id: CampaignId
    name: string
    description: string
    /** How long it runs, ms. */
    ms: number
    /** Demand multiplier at Marketing 0. */
    boost: number
    /** Marketing level needed to run it. */
    requiresMarketing: number
    /**
     * Price in hours of the floor's full income (at least MIN_CAMPAIGN_CHIPS).
     * About 0.23 of an hour per hour run (the TV Ad 0.17: a day-long run loses
     * the night to a full cage unless the cage is collected all day long, so
     * it is the most active player's pick): a campaign that fills the floor pays
     * back while under ~78% of the seats are taken (more the emptier the
     * floor, and only as far as the cage has room between collects).
     */
    costHours: number
}

export const CAMPAIGNS: readonly CampaignDef[] = [
    { id: 'flyers', name: 'Flyers', description: 'Hand out flyers on the street.', ms: 2 * HOUR, boost: 1.5, requiresMarketing: 0, costHours: 0.45 },
    { id: 'billboard', name: 'Billboard', description: 'Your name on a billboard downtown.', ms: 8 * HOUR, boost: 1.8, requiresMarketing: 2, costHours: 1.8 },
    { id: 'tv', name: 'TV Ad', description: 'A prime-time ad on every screen.', ms: 24 * HOUR, boost: 2.4, requiresMarketing: 4, costHours: 4 }
]
export const MIN_CAMPAIGN_CHIPS = 20 * CHIP_SCALE

/** Seats per archetype at level 1; every level adds one. */
const SEATS: Readonly<Record<Archetype, number>> = { slot: 2, dice: 3, rocket: 2, wheel: 3, flight: 2, hands: 2, roulette: 4, cards: 5, plinko: 3, mines: 3, hilo: 3 }
/** Full-floor income against the catalog's per-game numbers. */
const INCOME_SCALE = 1.8
/** Demand per built game and per extra level; decor and Marketing add a share. */
const DEMAND_BASE = 2
/** Each built game draws visitors by its seats at level 1 (a five-seat card table pulls more than a two-seat slot). */
const DEMAND_PER_SEAT = 0.32
const DEMAND_PER_LEVEL = 0.5
const DECOR_DEMAND = 0.06
const MARKETING_DEMAND = 0.05
/** Each Marketing level makes a campaign's boost this much stronger. */
const MARKETING_CAMPAIGN = 0.15

type VisitorView = Pick<TycoonState, 'games' | 'upgrades' | 'rushUntil' | 'campaign'>

export function findCampaign(id: string): CampaignDef | undefined {
    return CAMPAIGNS.find(campaign => campaign.id === id)
}

function builtGames(state: Pick<TycoonState, 'games'>) {
    const built: { def: TycoonGameDef, level: number }[] = []
    for (const def of TYCOON_GAMES) {
        const level = levelIndex(state.games[def.slug] ?? 0, def.guestsPerHour.length)
        if (level > 0) built.push({ def, level })
    }
    return built
}

/** Seats one game has at `level` (0 when not built). */
export function seatsOf(slug: string, level: number): number {
    const def = findTycoonGame(slug)
    return def && level >= 1 ? SEATS[def.archetype] + Math.min(MAX_LEVEL, Math.floor(level)) - 1 : 0
}

/** Seats on the whole floor: the most visitors it holds. */
export function floorSeats(state: Pick<TycoonState, 'games'>): number {
    return builtGames(state).reduce((sum, { def, level }) => sum + seatsOf(def.slug, level), 0)
}

/** What the floor earns an hour with every seat taken, before a rush. */
export function fullIncomePerHour(state: Pick<TycoonState, 'games'>): number {
    const base = builtGames(state).reduce((sum, { def, level }) => sum + def.guestsPerHour[level - 1]!, 0)
    return Math.round(base * INCOME_SCALE * 100) / 100
}

/** The campaign running at `now`, or null. */
export function activeCampaign(state: Pick<TycoonState, 'campaign'>, now: number): CampaignDef | null {
    return state.campaign && now < state.campaign.until ? findCampaign(state.campaign.id) ?? null : null
}

/** A campaign's demand multiplier at this Marketing level. */
export function campaignBoost(id: CampaignId, marketing: number): number {
    const def = findCampaign(id)
    if (!def) return 1
    return 1 + (def.boost - 1) * (1 + MARKETING_CAMPAIGN * levelIndex(marketing, MAX_LEVEL))
}

/** How many visitors want in at `now` (may exceed the seats). */
export function visitorDemand(state: VisitorView, now: number): number {
    const built = builtGames(state)
    const levels = built.reduce((sum, { level }) => sum + level - 1, 0)
    const pull = built.reduce((sum, { def }) => sum + SEATS[def.archetype], 0)
    const decor = 1 + DECOR_DEMAND * levelIndex(state.upgrades.decor ?? 0, MAX_LEVEL)
    const brand = 1 + MARKETING_DEMAND * levelIndex(state.upgrades.marketing ?? 0, MAX_LEVEL)
    const campaign = activeCampaign(state, now)
    const boost = campaign ? campaignBoost(campaign.id, state.upgrades.marketing ?? 0) : 1
    return (DEMAND_BASE + DEMAND_PER_SEAT * pull + DEMAND_PER_LEVEL * levels) * decor * brand * boost
}

/** Share of seats in use at `now`, 0..1. */
export function occupancy(state: VisitorView, now: number): number {
    const seats = floorSeats(state)
    return seats > 0 ? Math.min(1, visitorDemand(state, now) / seats) : 0
}

/** Visitors on the floor at `now`. */
export function visitorCount(state: VisitorView, now: number): number {
    return Math.round(Math.min(visitorDemand(state, now), floorSeats(state)))
}

/** Visitors turned away at the door at `now`: build more seats. */
export function visitorQueue(state: VisitorView, now: number): number {
    return Math.max(0, Math.round(visitorDemand(state, now) - floorSeats(state)))
}

/** Guest income at `now`, coins per hour: full income × occupancy, doubled in a rush. */
export function guestsPerHour(state: VisitorView, now: number): number {
    const rate = fullIncomePerHour(state) * occupancy(state, now)
    const rushed = state.rushUntil !== null && now < state.rushUntil ? rate * RUSH_FACTOR : rate
    return Math.round(rushed * 100) / 100
}

/** Guest income without a campaign or rush (what an idle casino earns). */
export function baseGuestsPerHour(state: Pick<TycoonState, 'games' | 'upgrades'>): number {
    return guestsPerHour({ ...state, rushUntil: null, campaign: null }, 0)
}

/** Each run already stacked on a campaign makes the next one this much dearer. */
export const CAMPAIGN_STACK_FACTOR = 1.5

/**
 * Price of a campaign now, in chips: hours of full income, never under
 * MIN_CAMPAIGN_CHIPS. Extending one that still runs costs more for every run
 * already queued (×CAMPAIGN_STACK_FACTOR per run left), so a long idle costs
 * real chips: 1×, 1,5×, 2,25×, 3,4×…
 */
export function campaignCost(state: Pick<TycoonState, 'games'> & Partial<Pick<TycoonState, 'campaign'>>, id: CampaignId, now?: number): number {
    const def = findCampaign(id)
    if (!def) return 0
    const base = Math.max(MIN_CAMPAIGN_CHIPS, roundChips(fullIncomePerHour(state) * def.costHours))
    return roundChips(base * CAMPAIGN_STACK_FACTOR ** campaignStacks(state, id, now))
}

/** How many runs of this campaign are still queued at `now` (0 when none runs). */
export function campaignStacks(state: Partial<Pick<TycoonState, 'campaign'>>, id: CampaignId, now?: number): number {
    const def = findCampaign(id)
    const running = state.campaign
    if (!def || now === undefined || !running || running.id !== id || running.until <= now) return 0
    return Math.ceil((running.until - now) / def.ms)
}

/** Why a campaign can't start now, or null. Running the same one again extends it. */
export function campaignBlocker(state: Pick<TycoonState, 'upgrades' | 'campaign'>, id: string, now: number): string | null {
    const def = findCampaign(id)
    if (!def) return 'No such campaign'
    if ((state.upgrades.marketing ?? 0) < def.requiresMarketing) return `Needs Marketing ${def.requiresMarketing}`
    const running = activeCampaign(state, now)
    if (running && running.id !== def.id) return `${running.name} is still running`
    const until = running && state.campaign ? state.campaign.until : now
    if (until + def.ms - now > MAX_CAMPAIGN_QUEUE_MS) return 'A week of campaigns is queued already'
    return null
}

/** Campaigns stack up to a week ahead. */
export const MAX_CAMPAIGN_QUEUE_MS = 7 * 24 * HOUR

/**
 * Guest coins earned between `from` and `to` (ms) at the current build:
 * split where a rush or campaign ends, each stretch at its own rate.
 * Uncapped; rounded down.
 */
export function guestChipsBetween(state: VisitorView, from: number, to: number): number {
    if (!(to > from)) return 0
    const cuts = [from, to]
    for (const at of [state.rushUntil, state.campaign?.until ?? null]) {
        if (at !== null && at > from && at < to) cuts.push(at)
    }
    cuts.sort((a, b) => a - b)
    let chips = 0
    for (let i = 0; i + 1 < cuts.length; i++) {
        const a = cuts[i]!
        const b = cuts[i + 1]!
        chips += guestsPerHour(state, a) * (b - a) / HOUR
    }
    return roundCoins(chips)
}

/**
 * The most extra guest coins a rush can bring: the floor's full income over
 * RUSH_MS, as if every seat were taken (a campaign started after the rush
 * can fill them). Priced from the occupancy at purchase instead, a rush
 * bought before a campaign would come out cheaper than converting. Not
 * capped by the cage: collecting during the rush takes more than one cage.
 */
export function rushExtraCoins(state: Pick<TycoonState, 'games'>): number {
    return roundCoins(fullIncomePerHour(state) * RUSH_MS / HOUR)
}

/**
 * Gems for a rush, priced from the casino: the most extra coins it can bring
 * at the convert rate (COINS_PER_GEM) plus RUSH_PREMIUM, so with or without
 * a campaign it is never a cheaper way to coins than converting. RUSH_GEMS
 * at least, RUSH_MAX_GEMS at most.
 */
export function rushGems(state: Pick<TycoonState, 'games'>): number {
    const fair = Math.ceil((rushExtraCoins(state) / COINS_PER_GEM) * RUSH_PREMIUM)
    return Math.max(RUSH_GEMS, Math.min(RUSH_MAX_GEMS, fair))
}

/** Coins in the cage at `now`: stored plus guest income since `serverNow`, capped at capacity. */
export function cageAt(state: TycoonState, now: number): number {
    const gained = guestChipsBetween(state, state.serverNow, now)
    return Math.max(state.cage.stored, Math.min(state.cage.capacity, roundCoins(state.cage.stored + gained)))
}

type BuildView = Pick<TycoonState, 'zones' | 'games' | 'upgrades'>

/** The level a game or upgrade is at now (0 = not built), or 1/0 for an owned zone. */
export function levelOf(state: BuildView, kind: BuildKind, id: string): number {
    if (kind === 'zone') return state.zones.includes(id as ZoneId) ? 1 : 0
    if (kind === 'game') return state.games[id] ?? 0
    return state.upgrades[id as UpgradeId] ?? 0
}

/** What the next step of `kind:id` costs, or null when it is maxed or unknown. */
export function nextCost(state: BuildView, kind: BuildKind, id: string): Cost | null {
    if (kind === 'zone') {
        const zone = findZone(id)
        return zone && !state.zones.includes(zone.id) ? zone.cost : null
    }
    if (kind === 'game') {
        const game = findTycoonGame(id)
        return game?.levels[state.games[id] ?? 0] ?? null
    }
    if (kind === 'upgrade') {
        const upgrade = findUpgrade(id)
        return upgrade?.levels[state.upgrades[upgrade.id] ?? 0] ?? null
    }
    return null
}

function zoneName(id: ZoneId | null): string {
    return findZone(id ?? '')?.name ?? 'the zone'
}

/**
 * Why `kind:id` can't start building now, or null when it can. Affordability
 * is not checked here (the debit is the guard).
 */
export function buildBlocker(state: TycoonState, kind: BuildKind, id: string): string | null {
    let requires: ZoneId | null = null
    if (kind === 'zone') {
        const zone = findZone(id)
        if (!zone) return 'Unknown zone'
        if (state.zones.includes(zone.id)) return `You already own the ${zone.name}`
        requires = zone.requires
    } else if (kind === 'game') {
        const game = findTycoonGame(id)
        if (!game) return 'Unknown game'
        if ((state.games[id] ?? 0) >= game.levels.length) return `${findGame(id)?.name ?? id} is at the top level`
        requires = game.zone
    } else if (kind === 'upgrade') {
        const upgrade = findUpgrade(id)
        if (!upgrade) return 'Unknown upgrade'
        const level = state.upgrades[upgrade.id] ?? 0
        if (level >= upgrade.levels.length) return `${upgrade.name} is at the top level`
        requires = upgrade.requiresZone[level] ?? null
    } else {
        return 'Unknown kind'
    }
    if (state.constructions.some(c => c.kind === kind && c.id === id)) return 'Already under construction'
    if (requires && !state.zones.includes(requires)) return `Open the ${zoneName(requires)} first`
    if (state.constructions.length >= state.builders) return state.builders > 1 ? 'Every builder is busy' : 'Your builder is busy'
    return null
}

/**
 * Gems to finish a construction now, from the time it has left. Priced on
 * the dear side of the platform guide, so a skip is a real choice: about 4
 * gems for ten minutes (a small boost), 12 for an hour, 51 for eight hours,
 * 66 for twelve. At least 1, never above 200.
 */
export function skipGems(remainingMs: number): number {
    const minutes = Math.max(0, remainingMs) / MIN
    return Math.max(1, Math.min(200, Math.ceil(0.71 * minutes ** 0.69)))
}

/** Every step there is to build: zones past the backroom, game levels and upgrade levels. */
export const TOTAL_STEPS = (ZONES.length - 1)
    + TYCOON_GAMES.reduce((sum, game) => sum + game.levels.length, 0)
    + UPGRADES.reduce((sum, upgrade) => sum + upgrade.levels.length, 0)

/** Share of everything buildable that is built, 0..1. */
export function progressOf(state: BuildView): number {
    let done = state.zones.filter(zone => zone !== 'backroom' && findZone(zone)).length
    for (const game of TYCOON_GAMES) done += Math.min(game.levels.length, state.games[game.slug] ?? 0)
    for (const upgrade of UPGRADES) done += Math.min(upgrade.levels.length, state.upgrades[upgrade.id] ?? 0)
    return Math.min(1, done / TOTAL_STEPS)
}
