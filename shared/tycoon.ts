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
 * - **Stars** (0-10 at the hub) count the ten casino goals reached (shared/stars.ts).
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
import { casinoLevel, gameUnlockLevel } from './casino-level'
import { ownedSpecials, placedSpecials, specialBonus, type DecorType, type OwnedDecor, type SpecialBonus } from './decor'
import { buildSpot, layoutOf, layoutStateOf } from './floor/placement'
import { COINS_PER_GEM } from './economy'
import type { MissionsState, WelcomeBack } from './missions'
import type { StarGoalKey, StarSummary } from './stars'
import { findGame } from './games/registry'
import { normalizeCoins, roundCoins } from './money'
import {
    bestFullFloorPerHour,
    expectedFloor,
    expectedPerHour,
    fullFloorPerHour,
    DEFAULT_RULES,
    seatedTotal,
    tierOdds,
    zonesOf,
    type FloorNow,
    type FloorView,
    type HouseRules,
    type HouseState,
    type VisitorCounts
} from './visitors'

// ── Zones ────────────────────────────────────────────────────────────────

/** Areas of the floor, bought in order. The client lays them out (shared/floor/layout.ts). */
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
}

// ── Casino upgrades ──────────────────────────────────────────────────────

/** The Decor upgrade is gone (its levels were refunded): rich guests come with Hospitality, the rooms and the specials. */
export type UpgradeId = 'cage' | 'marketing' | 'hospitality' | 'crew'

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
 * Gems never buy chips: chips are only won (the bound on coins claimed ×
 * RTP), and the platform contract forbids selling star levels for gems.
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
    /** The chip balance (what builds, campaigns and chip bets spend). */
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
        /** Coins an hour it fills at now: the current tick's rate, luck included (= `floor.perHour`). */
        perHour: number
    }
    /** The floor now: seated guests per tier, the tick's rate and the expected rate (shared/visitors.ts). */
    floor: FloorNow
    /** The house rules and their options. Only on the owner's own reads. */
    house?: HouseState
    /** Guest rush active until (ms), or null. */
    rushUntil: number | null
    /** The running ad campaign that ends first, or null (older screens show one; `campaigns` has them all). */
    campaign: RunningCampaignRef | null
    /** Every ad campaign running, one per kind, with when its queue ends. Missing on old payloads. */
    campaigns?: RunningCampaignRef[]
    /** Games with the golden skin. */
    golden: string[]
    /**
     * Where every game on the floor stands (its origin tile): built or under
     * construction, home spots included (shared/floor/placement.ts). Missing on
     * old payloads = every game at its home spot.
     */
    placements?: Record<string, { x: number, y: number }>
    /**
     * Built games put away (arrange mode): still owned (level, value, goals),
     * but off the floor: no seats, no guests, no spot. Missing = none.
     */
    storedGames?: string[]
    /** Decorations the casino owns (shared/decor.ts); put-away ones have x = y = null. Visitors see only placed ones. */
    decor?: OwnedDecor[]
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
    /** Chips the removed Decor upgrade was refunded with, on the one owner's read that paid it (show a notice), else missing. */
    decorRefund?: number
    /** GET /api/tycoon only: the star rise the owner has not been shown yet (this read reported it, or the sweep, a visit or a retry did), once, else null. */
    stars?: TycoonStarChange | null
    /** The casino goals and the star level (shared/stars.ts). Only on the owner's own reads. */
    starGoals?: StarSummary
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

/** A star level change the hub confirmed after an action (a casino goal reached). */
export interface TycoonStarChange {
    playerId: string
    level: number
    previous: number
    /** Gems the hub paid for a new best level. */
    bounty: number
    /** The goals done when the level was reported. */
    goals: StarGoalKey[]
    /** Reported before this response (a build that became ready, the sweep, a visit): its bounty is in a gem count read since. */
    late?: true
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
    /** The star level change the action caused (a goal reached), once the hub confirmed it. */
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
 * converted gem), so the cage carries a casino's
 * income and gems stay a boost, not a skip.
 */
const CHIP_SCALE = 5
/** The Construction Crew (+1 builder for chips): the mid-game goal after the Slot Lounge. Before CHIP_SCALE. */
const CREW_CHIPS = 8_000
const CREW_MS = 4 * HOUR
/** Cage sizes and the starter cage, in coins, are written small and multiplied by this. */
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

export const TYCOON_GAMES: readonly TycoonGameDef[] = [
    // Backroom
    { slug: 'plinko', zone: 'backroom', archetype: 'plinko', accent: '#06b6d4', starter: true, levels: gameLevels(40, MIN, true) },
    { slug: 'spinata', zone: 'backroom', archetype: 'slot', accent: '#f43f5e', starter: true, levels: gameLevels(40, MIN, true) },
    { slug: 'limbo', zone: 'backroom', archetype: 'rocket', accent: '#38bdf8', levels: gameLevels(80, 10 * SEC) },
    { slug: 'wheel', zone: 'backroom', archetype: 'wheel', accent: '#facc15', levels: gameLevels(200, 45 * SEC) },
    // Main floor
    { slug: 'roulette', zone: 'main', archetype: 'roulette', accent: '#ef4444', levels: gameLevels(250, 5 * MIN) },
    { slug: 'trashpanda', zone: 'main', archetype: 'slot', accent: '#84cc16', levels: gameLevels(270, 8 * MIN) },
    { slug: 'fireinthehole', zone: 'main', archetype: 'slot', accent: '#f97316', levels: gameLevels(290, 10 * MIN) },
    { slug: 'candymadness', zone: 'main', archetype: 'slot', accent: '#ec4899', levels: gameLevels(310, 12 * MIN) },
    { slug: 'dice', zone: 'main', archetype: 'dice', accent: '#22c55e', levels: gameLevels(330, 14 * MIN) },
    // Table pit
    { slug: 'blackjack', zone: 'pit', archetype: 'cards', accent: '#10b981', levels: gameLevels(450, 30 * MIN) },
    { slug: 'three-card-poker', zone: 'pit', archetype: 'cards', accent: '#6366f1', levels: gameLevels(470, 35 * MIN) },
    { slug: 'polymasters', zone: 'pit', archetype: 'flight', accent: '#0ea5e9', levels: gameLevels(450, 30 * MIN) },
    // Slot lounge
    { slug: 'bookofshadows', zone: 'lounge', archetype: 'slot', accent: '#a855f7', levels: gameLevels(720, 55 * MIN) },
    { slug: 'xenoslot', zone: 'lounge', archetype: 'slot', accent: '#14b8a6', levels: gameLevels(750, 60 * MIN) },
    { slug: 'emberportals', zone: 'lounge', archetype: 'slot', accent: '#fb923c', levels: gameLevels(770, 65 * MIN) },
    { slug: 'magichands', zone: 'lounge', archetype: 'hands', accent: '#c084fc', levels: gameLevels(750, 65 * MIN) },
    // High limit
    { slug: 'baccarat', zone: 'highlimit', archetype: 'cards', accent: '#b91c1c', levels: gameLevels(1_030, 100 * MIN) },
    { slug: 'casino-holdem', zone: 'highlimit', archetype: 'cards', accent: '#1d4ed8', levels: gameLevels(1_060, 100 * MIN) },
    { slug: 'aethergates', zone: 'highlimit', archetype: 'slot', accent: '#eab308', levels: gameLevels(1_090, 135 * MIN) },
    // Penthouse
    { slug: 'mines', zone: 'penthouse', archetype: 'mines', accent: '#10b981', levels: gameLevels(1_150, 115 * MIN) },
    { slug: 'hilo', zone: 'penthouse', archetype: 'hilo', accent: '#8b5cf6', levels: gameLevels(1_200, 135 * MIN) }
]

/** What each Hospitality level brings (index = level - 1), for the build menu. */
export const HOSPITALITY_LEVELS: readonly string[] = [
    'Free drinks', 'Snacks', 'Buffet', 'Live music', 'Fine dining', 'Cocktail bar', 'Champagne', 'Private chef'
]

/** Hospitality levels: chips (before CHIP_SCALE), build time, the room it needs. */
const HOSPITALITY_TUNING: readonly [number, number, ZoneId][] = [
    [400, 30 * MIN, 'main'],
    [1_200, 2 * HOUR, 'pit'],
    [2_400, 4 * HOUR, 'pit'],
    [3_600, 5 * HOUR, 'lounge'],
    [5_000, 6 * HOUR, 'highlimit'],
    [6_500, 7 * HOUR, 'highlimit'],
    [8_000, 8 * HOUR, 'penthouse'],
    [9_600, 9 * HOUR, 'penthouse']
]

/**
 * What the Decor upgrade (removed) cost per level (index = level - 1), at its
 * last catalog prices: a casino that had built it gets these chips back once
 * (server/utils/tycoon.ts `refundDecor`).
 */
export const DECOR_REFUND_CHIPS: readonly number[] = [150, 300, 500, 750, 1_000, 1_350, 1_700, 2_100, 2_500, 2_900, 3_300, 3_700].map(chips => roundChips(chips * CHIP_SCALE))

/** Chips the removed Decor upgrade cost up to `level`. */
export function decorRefund(level: number): number {
    const n = Number.isFinite(level) ? Math.max(0, Math.min(DECOR_REFUND_CHIPS.length, Math.floor(level))) : 0
    return DECOR_REFUND_CHIPS.slice(0, n).reduce((sum, chips) => sum + chips, 0)
}

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
        description: 'More guests: a known name draws more visitors, unlocks bigger ad campaigns and makes every campaign stronger.',
        levels: [cost(150, MIN), cost(1_000, 30 * MIN), cost(2_500, 3 * HOUR), cost(5_500, 8 * HOUR), cost(8_800, 9 * HOUR)],
        requiresZone: [null, 'main', 'pit', 'lounge', 'highlimit']
    },
    {
        id: 'hospitality',
        name: 'Hospitality',
        description: 'More and richer guests: free drinks, snacks, a buffet, live music, fine dining, a cocktail bar, champagne and a private chef.',
        // The ladder to richer guests (with the rooms, the top machines and the prestige specials), gated by the rooms.
        levels: HOSPITALITY_TUNING.map(([chips, ms]) => cost(chips, ms)),
        requiresZone: HOSPITALITY_TUNING.map(([, , zone]) => zone)
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
const CAGE_CAPACITY = [300, 400, 600, 850, 1_100, 1_400].map(coins => coins * GUEST_SCALE)

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
// Every built game has seats; guests come in tiers (Tourist, Regular, High
// Roller, Whale) and spend by tier, by the level of the game they sit at and
// by the house rules: the model lives in shared/visitors.ts. Marketing brings
// more guests, Decor richer ones, an ad campaign multiplies the crowd for a
// while and a gem rush doubles what they spend. The helpers below are the
// expected (no luck) numbers for a state; the cage itself accrues through the
// per-tick model (`runFloor`).

export type CampaignId = 'flyers' | 'billboard' | 'tv' | 'invites' | 'jet'

/** A campaign running (or queued) until `until` (ms). */
export interface RunningCampaignRef {
    id: CampaignId
    until: number
}

/** What a campaign buys: more guests (fills empty seats), or richer ones (worth most on a full floor). */
export type CampaignGoal = 'guests' | 'wealth'

export interface CampaignDef {
    id: CampaignId
    name: string
    /** One line: what it does. */
    description: string
    goal: CampaignGoal
    /** How long it runs, ms. */
    ms: number
    /**
     * A guests campaign: the share of the seats it adds to the crowd while it
     * runs (several running at once each add their own share, so only all of
     * them together fill the floor).
     */
    fills: number
    /** A wealth campaign: prestige it adds while it runs, as a share (0.6: × 1.6), at Marketing 0 (richer guests, and a few more). */
    prestige: number
    /** A wealth campaign: Whale odds multiplier while it runs, at Marketing 0. */
    whales: number
    /** Marketing level needed to run it. */
    requiresMarketing: number
    /** Zone that must be open (the tier it brings comes with it), or null. */
    requiresZone: ZoneId | null
    /**
     * Price in hours of the floor's full income (`fullIncomePerHour`: every
     * seat taken, default rules; at least MIN_CAMPAIGN_CHIPS). Tuned with `bun scripts/tycoon-sim.ts`: each
     * pays back in its own situation (guests ads on a floor with empty seats,
     * wealth ads on a floor full of Tourists), as far as the cage has room.
     */
    costHours: number
}

export const CAMPAIGNS: readonly CampaignDef[] = [
    { id: 'flyers', name: 'Flyers', description: 'More guests for 2 hours: about an eighth of your seats more.', goal: 'guests', ms: 2 * HOUR, fills: 0.12, prestige: 0, whales: 1, requiresMarketing: 0, requiresZone: null, costHours: 0.17 },
    { id: 'billboard', name: 'Billboard', description: 'More guests for 8 hours: about a sixth of your seats more.', goal: 'guests', ms: 8 * HOUR, fills: 0.18, prestige: 0, whales: 1, requiresMarketing: 2, requiresZone: null, costHours: 0.75 },
    { id: 'tv', name: 'TV Ad', description: 'Many more guests for a day: a quarter of your seats more.', goal: 'guests', ms: 24 * HOUR, fills: 0.25, prestige: 0, whales: 1, requiresMarketing: 4, requiresZone: null, costHours: 2.8 },
    { id: 'invites', name: 'VIP Invitations', description: 'Richer guests for 8 hours: more High Rollers in the same seats, and with Marketing more Whales.', goal: 'wealth', ms: 8 * HOUR, fills: 0, prestige: 0.45, whales: 1, requiresMarketing: 1, requiresZone: 'highlimit', costHours: 0.5 },
    { id: 'jet', name: 'Private Jet', description: 'Fly in Whales for 12 hours: far more Whales and a few more High Rollers.', goal: 'wealth', ms: 12 * HOUR, fills: 0, prestige: 0.15, whales: 4, requiresMarketing: 3, requiresZone: 'highlimit', costHours: 1 }
]
export const MIN_CAMPAIGN_CHIPS = roundChips(20 * CHIP_SCALE)

/** Seats per archetype at level 1; every level adds one. */
const SEATS: Readonly<Record<Archetype, number>> = { slot: 2, dice: 3, rocket: 2, wheel: 3, flight: 2, hands: 2, roulette: 4, cards: 5, plinko: 3, mines: 3, hilo: 3 }
/** Each Marketing level makes a campaign this much stronger. */
const MARKETING_CAMPAIGN = 0.1

/** Decorations as the visitor helpers read them: only the specials count. */
type DecorView = readonly Pick<OwnedDecor, 'type' | 'x' | 'y'>[]

/** What the visitor helpers read of a state: the build, the rush and campaign, and (when known) the zones, the rules and the decorations. */
export type VisitorView = Pick<TycoonState, 'games' | 'upgrades' | 'rushUntil' | 'campaign'> & {
    campaigns?: readonly RunningCampaignRef[]
    zones?: readonly string[]
    rules?: HouseRules
    house?: Pick<HouseState, 'rules'>
    /** The casino's decorations: the specials standing on the floor lift it (`specials` wins when given). */
    decor?: DecorView
    specials?: SpecialBonus
    /** Built games put away: the visitor model leaves them out. */
    storedGames?: readonly string[]
}

/**
 * The games standing on the floor: the built ones minus the put-away ones.
 * Only these take guests (seats, the crowd, a top machine's prestige); the
 * zones stay owned. Prices read every built game as if placed (`games`).
 */
export function floorGames(state: Pick<TycoonState, 'games'> & { storedGames?: readonly string[] }): Record<string, number> {
    if (!state.storedGames?.length) return state.games
    const games = { ...state.games }
    for (const slug of state.storedGames) delete games[slug]
    return games
}

/** A state as the visitor model reads it (the games on the floor only). */
export function floorView(state: VisitorView): FloorView {
    return {
        // Zones read from the games come from every built one: putting a game away keeps its room.
        zones: state.zones ?? (state.storedGames?.length ? zonesOf({ games: state.games }) : undefined),
        games: floorGames(state),
        upgrades: state.upgrades,
        rushUntil: state.rushUntil,
        campaign: state.campaign,
        campaigns: state.campaigns,
        rules: state.rules ?? state.house?.rules ?? DEFAULT_RULES,
        specials: state.specials ?? specialBonus(placedSpecials(state.decor ?? []))
    }
}

/**
 * The tier odds without and with one special standing on the floor (the
 * other placed specials as they are, wealth ads running at `at`): what
 * placing it changes. For a special already placed, `without` is the floor
 * once it is put away.
 */
export function specialOdds(state: VisitorView, type: DecorType, at?: number): { without: VisitorCounts, with: VisitorCounts } {
    const others = placedSpecials(state.decor ?? []).filter(t => t !== type)
    const view = floorView(state)
    return {
        without: tierOdds({ ...view, specials: specialBonus(others) }, at),
        with: tierOdds({ ...view, specials: specialBonus([...others, type]) }, at)
    }
}

type FullView = Pick<TycoonState, 'games'> & { zones?: readonly string[], upgrades?: Partial<Record<UpgradeId, number>>, decor?: DecorView }

export function findCampaign(id: string): CampaignDef | undefined {
    return CAMPAIGNS.find(campaign => campaign.id === id)
}

function builtGames(state: Pick<TycoonState, 'games'>) {
    const built: { def: TycoonGameDef, level: number }[] = []
    for (const def of TYCOON_GAMES) {
        const level = levelIndex(state.games[def.slug] ?? 0, def.levels.length)
        if (level > 0) built.push({ def, level })
    }
    return built
}

/** Seats one game has at `level` (0 when not built). */
export function seatsOf(slug: string, level: number): number {
    const def = findTycoonGame(slug)
    return def && level >= 1 ? SEATS[def.archetype] + Math.min(MAX_LEVEL, Math.floor(level)) - 1 : 0
}

/** Seats on the whole floor: the most visitors it holds (put-away games have none). */
export function floorSeats(state: Pick<TycoonState, 'games'> & { storedGames?: readonly string[] }): number {
    return builtGames({ games: floorGames(state) }).reduce((sum, { def, level }) => sum + seatsOf(def.slug, level), 0)
}

/**
 * What the floor spends an hour with every seat taken, at the expected tier
 * mix and the default rules (no rush, no costs), with every built game and
 * every special the casino owns as if placed (putting one away must not make
 * prices cheaper):
 * what campaigns and mission rewards are priced from. Without zones they are
 * read from the built games.
 */
export function fullIncomePerHour(state: FullView): number {
    return fullFloorPerHour({ zones: state.zones, games: state.games, upgrades: state.upgrades ?? {}, specials: specialBonus(ownedSpecials(state.decor ?? [])) }, DEFAULT_RULES)
}

type CampaignHolder = { campaign?: RunningCampaignRef | null, campaigns?: readonly RunningCampaignRef[] }

/** Every campaign a state holds (running or run out), one per kind: `campaigns`, or the single `campaign` of an older payload. */
export function campaignsOf(state: CampaignHolder): RunningCampaignRef[] {
    if (state.campaigns) return [...state.campaigns]
    return state.campaign ? [state.campaign] : []
}

/** The campaigns running at `now`, soonest to end first. */
export function activeCampaigns(state: CampaignHolder, now: number): (CampaignDef & { until: number })[] {
    return campaignsOf(state)
        .filter(c => now < c.until)
        .sort((a, b) => a.until - b.until)
        .flatMap((c) => {
            const def = findCampaign(c.id)
            return def ? [{ ...def, until: c.until }] : []
        })
}

/** The running campaign that ends first at `now`, or null. */
export function activeCampaign(state: CampaignHolder, now: number): CampaignDef | null {
    return activeCampaigns(state, now)[0] ?? null
}

/** The campaign of kind `id` in a state (running or run out), or null. */
export function campaignOf(state: CampaignHolder, id: CampaignId): RunningCampaignRef | null {
    return campaignsOf(state).find(c => c.id === id) ?? null
}

/**
 * What a campaign does at this Marketing level: the share of the seats it
 * adds to the crowd (guests ads; Marketing brings the crowd itself), and the
 * prestige and Whale odds it adds (wealth ads; every Marketing level makes
 * those MARKETING_CAMPAIGN stronger).
 */
export function campaignEffect(id: CampaignId, marketing: number): { fills: number, prestige: number, whales: number } {
    const def = findCampaign(id)
    if (!def) return { fills: 0, prestige: 0, whales: 1 }
    const strength = 1 + MARKETING_CAMPAIGN * levelIndex(marketing, MAX_LEVEL)
    return { fills: def.fills, prestige: def.prestige * strength, whales: 1 + (def.whales - 1) * strength }
}

/** A guests campaign's share of the seats it adds to the crowd (0 for a wealth campaign). */
export function campaignBoost(id: CampaignId, marketing: number): number {
    return campaignEffect(id, marketing).fills
}

/** Guests arriving a tick on average at `now` (may exceed the seats). */
export function visitorDemand(state: VisitorView, now: number): number {
    return expectedFloor(floorView(state), now).demand
}

/** Expected share of seats in use at `now`, 0..1. */
export function occupancy(state: VisitorView, now: number): number {
    const floor = expectedFloor(floorView(state), now)
    const seated = seatedTotal(floor.visitors)
    return floor.seats > 0 ? Math.min(1, seated / floor.seats) : 0
}

/** Expected visitors on the floor at `now` (no luck: `TycoonState.floor` has the tick's own). */
export function visitorCount(state: VisitorView, now: number): number {
    const floor = expectedFloor(floorView(state), now)
    return Math.round(seatedTotal(floor.visitors))
}

/** Expected guest income at `now`, coins per hour (rules, campaign and rush included; no luck). */
export function guestsPerHour(state: VisitorView, now: number): number {
    return expectedPerHour(floorView(state), now)
}

/** Expected guest income without a campaign or rush (what an idle casino earns). */
export function baseGuestsPerHour(state: Pick<TycoonState, 'games' | 'upgrades'> & Omit<Partial<VisitorView>, 'games' | 'upgrades'>): number {
    return expectedPerHour(floorView({ ...state, rushUntil: null, campaign: null, campaigns: [] }))
}

/** Each run already stacked on a campaign makes the next one this much dearer. */
export const CAMPAIGN_STACK_FACTOR = 1.5

/**
 * Price of a campaign now, in chips: hours of full income, never under
 * MIN_CAMPAIGN_CHIPS. Extending one that still runs costs more for every run
 * already queued (×CAMPAIGN_STACK_FACTOR per run left), so a long idle costs
 * real chips: 1×, 1,5×, 2,25×, 3,4×…
 */
export function campaignCost(state: FullView & CampaignHolder, id: CampaignId, now?: number): number {
    const def = findCampaign(id)
    if (!def) return 0
    const base = Math.max(MIN_CAMPAIGN_CHIPS, roundChips(fullIncomePerHour(state) * def.costHours))
    return roundChips(base * CAMPAIGN_STACK_FACTOR ** campaignStacks(state, id, now))
}

/** How many runs of this campaign are still queued at `now` (0 when none runs). */
export function campaignStacks(state: CampaignHolder, id: CampaignId, now?: number): number {
    const def = findCampaign(id)
    const running = campaignOf(state, id)
    if (!def || now === undefined || !running || running.until <= now) return 0
    return Math.ceil((running.until - now) / def.ms)
}

/**
 * Why a campaign can't start now, or null. Campaigns of different kinds run
 * side by side; running the same one again extends it (up to a week queued).
 */
export function campaignBlocker(state: { upgrades: Partial<Record<UpgradeId, number>> } & CampaignHolder & { zones?: readonly string[] }, id: string, now: number): string | null {
    const def = findCampaign(id)
    if (!def) return 'No such campaign'
    if (def.requiresZone && state.zones && !state.zones.includes(def.requiresZone)) return `Open the ${findZone(def.requiresZone)?.name ?? 'next zone'} first`
    if ((state.upgrades.marketing ?? 0) < def.requiresMarketing) return `Needs Marketing ${def.requiresMarketing}`
    const running = campaignOf(state, def.id)
    const until = running && running.until > now ? running.until : now
    if (until + def.ms - now > MAX_CAMPAIGN_QUEUE_MS) return 'A week of this campaign is queued already'
    return null
}

/** Campaigns stack up to a week ahead. */
export const MAX_CAMPAIGN_QUEUE_MS = 7 * 24 * HOUR

/**
 * The most extra guest coins a rush can bring: what a full floor spends over
 * RUSH_MS at the richest mix any of the casino's unlocked rules lets in (a
 * rush doubles what guests spend), as if every seat were taken (a campaign
 * started after the rush can fill them) and every built game and special
 * the casino owns stood on the floor (one put away can be placed during the
 * rush: `games`, not `floorGames`). Priced
 * from the occupancy at purchase instead, a rush bought before a campaign
 * would come out cheaper than converting. Not capped by the cage: collecting
 * during the rush takes more than one cage.
 */
export function rushExtraCoins(state: FullView): number {
    const specials = specialBonus(ownedSpecials(state.decor ?? []))
    return roundCoins(bestFullFloorPerHour({ zones: state.zones, games: state.games, upgrades: state.upgrades ?? {}, specials }) * RUSH_MS / HOUR)
}

/**
 * Gems for a rush, priced from the casino: the most extra coins it can bring
 * at the convert rate (COINS_PER_GEM) plus RUSH_PREMIUM, so with or without
 * a campaign it is never a cheaper way to coins than converting. RUSH_GEMS
 * at least, RUSH_MAX_GEMS at most.
 */
export function rushGems(state: FullView): number {
    const fair = Math.ceil((rushExtraCoins(state) / COINS_PER_GEM) * RUSH_PREMIUM)
    return Math.max(RUSH_GEMS, Math.min(RUSH_MAX_GEMS, fair))
}

/**
 * Coins in the cage at `now`, as the client shows it between reads: stored
 * plus the current tick's rate until the tick ends, then the expected rate
 * (the next read brings the real ticks), capped at capacity.
 */
export function cageAt(state: TycoonState, now: number): number {
    if (!(now > state.serverNow)) return state.cage.stored
    const floor = state.floor as FloorNow | undefined
    const tickEnds = floor?.tickEndsAt ?? now
    const first = Math.min(now, tickEnds) - state.serverNow
    const rest = Math.max(0, now - Math.max(tickEnds, state.serverNow))
    const gained = (state.cage.perHour * Math.max(0, first) + (floor?.expectedPerHour ?? state.cage.perHour) * rest) / HOUR
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

/** What `buildBlocker` reads of a state (`placements`, `storedGames` and `decor`: where a new game would stand). */
export type BlockerView = Pick<TycoonState, 'zones' | 'games' | 'upgrades' | 'constructions' | 'builders' | 'placements' | 'storedGames' | 'decor'>

/**
 * Why `kind:id` can't start building now, or null when it can. Affordability
 * is not checked here (the debit is the guard). A new game needs the casino
 * level (shared/casino-level.ts) and a free spot in an owned room
 * (shared/floor/placement.ts `buildSpot`); rooms need the room before them,
 * upgrades their room.
 */
export function buildBlocker(state: BlockerView, kind: BuildKind, id: string): string | null {
    let requires: ZoneId | null = null
    let newGame = false
    if (kind === 'zone') {
        const zone = findZone(id)
        if (!zone) return 'Unknown zone'
        if (state.zones.includes(zone.id)) return `You already own the ${zone.name}`
        requires = zone.requires
    } else if (kind === 'game') {
        const game = findTycoonGame(id)
        if (!game) return 'Unknown game'
        if ((state.games[id] ?? 0) >= game.levels.length) return `${findGame(id)?.name ?? id} is at the top level`
        newGame = (state.games[id] ?? 0) < 1
        if (!newGame && state.storedGames?.includes(id)) return STORED_BLOCKER
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
    if (newGame) {
        const needs = gameUnlockLevel(id)
        if (casinoLevel(state).level < needs) return `Reach casino level ${needs}`
    }
    if (state.constructions.length >= state.builders) return state.builders > 1 ? 'Every builder is busy' : 'Your builder is busy'
    if (newGame && !hasRoomFor(state, id)) return NO_ROOM_BLOCKER
    return null
}

/** `buildBlocker`'s refusal when no owned room has a free spot for a new game. */
export const NO_ROOM_BLOCKER = 'No room for it: open a room or move things'

/** `buildBlocker`'s refusal for a put-away game: it is upgraded where it stands. */
export const STORED_BLOCKER = 'Place it on the floor first'

/** Whether a game that isn't on the floor yet has a free spot in the owned rooms (false: build nothing, or move things first). */
export function hasRoomFor(state: Pick<BlockerView, 'zones' | 'games' | 'constructions' | 'placements' | 'storedGames' | 'decor'>, slug: string): boolean {
    return newGameSpot(state, slug) !== null
}

/** Where a game that isn't on the floor yet would stand when built (null: no free spot in the owned rooms). */
export function newGameSpot(state: Pick<BlockerView, 'zones' | 'games' | 'constructions' | 'placements' | 'storedGames' | 'decor'>, slug: string): { x: number, y: number } | null {
    return buildSpot(layoutOf(layoutStateOf(state)), slug)
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
