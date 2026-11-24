/**
 * Visitors, tiers and house rules (My Casino). CONTRACT between the server
 * model and the UI: the types and API shapes here are fixed; the numbers
 * and the logic are filled in by the income model work.
 *
 * Income = the guests seated on the floor × what each tier spends an hour
 * (× the seat's game level bonus), minus running costs of the house rules.
 * Every 15 minutes (a tick) guests arrive and each rolls a tier; the luck
 * is a pure function of (casino state, player, tick), so accrual between
 * any two moments is reproducible and additive.
 */

export type VisitorTierId = 'tourist' | 'regular' | 'highroller' | 'whale'

export const VISITOR_TIER_IDS: readonly VisitorTierId[] = ['tourist', 'regular', 'highroller', 'whale']

export interface VisitorTierDef {
    id: VisitorTierId
    name: string
    /** Coins an hour one seated guest of this tier spends (before level and room bonuses). */
    spend: number
    /** The zone that must be open before this tier visits (null: from the start). */
    unlockZone: string | null
    /** Hex colour: floor tint, chart series, HUD dot. */
    color: string
}

export type VisitorCounts = Record<VisitorTierId, number>

export type DoorRule = 'open' | 'limit' | 'closed'

/** The house rules a casino runs. Defaults: everything off / open. */
export interface HouseRules {
    /** Who gets in: everyone, Tourists capped at a share of the seats, or no Tourists. */
    door: DoorRule
    /** The High Limit Room seats only High Rollers and Whales, who spend more there; staff cost per VIP guest. */
    vip: boolean
}

export type HouseRuleId = keyof HouseRules

export const DEFAULT_RULES: HouseRules = { door: 'open', vip: false }

/** What the floor looks like now (`TycoonState.floor`). */
export interface FloorNow {
    /** The current tick's seated guests per tier. */
    visitors: VisitorCounts
    seats: number
    /** Guests who came this tick and found no seat (or were kept out by the door). */
    turnedAway: number
    /** Coins an hour at the current tick (luck included, costs taken off): Σ income − costs, never below 0. */
    perHour: number
    /** Coins an hour each tier brings this tick (level and VIP bonuses and a rush included). */
    income: VisitorCounts
    /** The house rules' running costs an hour this tick (VIP staff). */
    costs: number
    /** Coins an hour on average for this build and these rules (no luck): what prices and previews use. */
    expectedPerHour: number
    /** Share of arrivals per unlocked tier, 0..1 (sums to 1). */
    odds: VisitorCounts
    /** The current tick ends at (server ms): the rate can change then. */
    tickEndsAt: number
}

/** One rule option as the rules panel shows it (`TycoonState.house`). */
export interface HouseRuleOption {
    rule: HouseRuleId
    /** The value this option sets. */
    value: boolean | DoorRule
    label: string
    /** One line: what it does and what it costs. */
    description: string
    /** Expected coins/h change against the current rules if picked (negative = loses money now). */
    delta: number
    /** This is the current setting. */
    active: boolean
}

/** House rules on the owner's state (`TycoonState.house`). */
export interface HouseState {
    rules: HouseRules
    /** Rules this casino has unlocked, in unlock order (empty for a new casino: the panel stays hidden). */
    unlocked: HouseRuleId[]
    /** Options of the unlocked rules, with their live expected deltas. */
    options: HouseRuleOption[]
    /** A rule change is allowed again at (server ms), or null when it is now. */
    cooldownUntil: number | null
}

/** POST /api/tycoon/rules: the rules to change (only the given keys). */
export type RulesBody = Partial<HouseRules>

/** One hour of history (GET /api/tycoon/history). */
export interface HistoryHour {
    /** Start of the hour (ms). */
    at: number
    /** Average seated guests per tier over the hour. */
    visitors: VisitorCounts
    /** Coins earned into the cage this hour (after costs, before the cage cap). */
    income: number
    /** Coins the full cage had no room for. */
    lost: number
}

/** GET /api/tycoon/history?range=24h|3d */
export interface HistoryResponse {
    range: '24h' | '3d'
    hours: HistoryHour[]
}

/** A guest worth mentioning on the welcome-back card. */
export interface NotableGuest {
    /** Stable id of the visit (`<arrival tick>:<index>`): the same Whale across stretches merges on it. Missing on old payloads. */
    id?: string
    /** When they came in (ms). */
    at: number
    /** When they left, or leave (ms). Missing on old payloads. */
    until?: number
    tier: VisitorTierId
    /** Coins they spent while here (in the stretch reported). */
    spent: number
}

// ── The model ─────────────────────────────────────────────────────────────
//
// Everything below is pure: the server, the client and scripts/tycoon-sim.ts
// run the same code. Numbers are tuned with `bun scripts/tycoon-sim.ts`.
//
// - Tiers: a guest arrives as a Tourist, a Regular, a High Roller or a Whale.
//   The odds of tier k are weight_k × P^k over the unlocked tiers, normalised,
//   where P is the casino's prestige: 1 + Decor + zones past the Backroom +
//   game levels (`prestige`). Decor brings richer guests, Marketing more of them.
// - Seats: every built game has seats (shared/tycoon.ts `seatsOf`: +1 a level),
//   and each level makes a guest seated there spend LEVEL_SPEND more.
// - A tick (TICK_MS): the crowd is seats × FILL × (1 + BRAND × Marketing) × the
//   ads (each fills a share of the empty seats), times a mood: a random good or
//   quiet hour, a random day and a little per tick (no time-of-day curve). That
//   many guests arrive, each rolls a tier, the door rule filters them, High
//   Rollers and Whales take a VIP seat when the VIP room runs, everyone else
//   takes a free seat first come; no seat, turned away.
// - The tick's rate: Σ seated spend × level bonus (× the VIP room's bonus),
//   doubled in a rush, minus the house rules' running costs, never below 0.
// - Luck is a pure function of (casino state, player seed, tick), so income
//   between any two moments is reproducible, and additive: a tick earns whole
//   units of 1/10,000 coin, and part of a tick earns floor(units × elapsed /
//   TICK_MS), so accrual over [a, c) equals [a, b) + [b, c) for any b.
// - `expectedPerHour` is the same model with fractional tier counts and the
//   moods averaged out (no luck): prices, rewards and previews read it.

import { COIN_UNITS, fromUnits } from './money'
import { activeCampaigns, CAMPAIGNS, campaignBlocker, campaignEffect, campaignOf, campaignsOf, findCampaign, seatsOf, TYCOON_GAMES, ZONES, type CampaignId, type RunningCampaignRef, type UpgradeId, type ZoneId } from './tycoon'

const MINUTE = 60_000
const HOUR_MS = 60 * MINUTE

/** One tick of the floor: guests arrive, roll their tier and sit down. */
export const TICK_MS = 15 * MINUTE
/** A house rule change is allowed again this long after the last one. */
export const RULES_COOLDOWN_MS = 10 * MINUTE

export const VISITOR_TIERS: readonly VisitorTierDef[] = [
    { id: 'tourist', name: 'Tourist', spend: 38, unlockZone: null, color: '#38bdf8' },
    { id: 'regular', name: 'Regular', spend: 50, unlockZone: 'main', color: '#34d399' },
    { id: 'highroller', name: 'High Roller', spend: 66, unlockZone: 'pit', color: '#c084fc' },
    { id: 'whale', name: 'Whale', spend: 500, unlockZone: 'highlimit', color: '#fbbf24' }
]

/** Guests in a count per tier, all together. */
export function seatedTotal(counts: VisitorCounts): number {
    return VISITOR_TIER_IDS.reduce((sum, id) => sum + counts[id], 0)
}

/**
 * The model's numbers, tuned with `bun scripts/tycoon-sim.ts` (a tuning
 * script may try others in place; the app never changes them).
 */
export const VISITOR_MODEL = {
    /** Base weight of each tier (index = VISITOR_TIER_IDS), before prestige. */
    weights: [1, 0.2, 0.006, 0.00001] as number[],
    /** Prestige multiplies: × (1 + this) per Decor level and per zone past the Backroom. */
    prestigeDecor: 0.09,
    prestigeZone: 0.05,
    /** × (1 + this) per game at levels 1-5: the top machines draw richer guests, a maxed one most. */
    levelPrestige: [0, 0.002, 0.004, 0.008, 0.02] as number[],
    /** What a guest seated at a game of level 1-5 spends, against level 1 (steeper at the top: late levels cost the most). */
    levelSpend: [1, 1.02, 1.04, 1.06, 1.08] as number[],
    /** A Whale stays this many ticks (uniform, both included): one to three hours. */
    whaleStayMin: 4,
    whaleStayMax: 12,
    /** The crowd without a campaign, as a share of the seats it comes for, × prestige^fillPrestige (a better casino draws more guests). */
    fill: 0.41,
    fillPrestige: 0.08,
    /** An exclusive door draws richer guests: prestige × this with Tourists limited or kept out. */
    doorPrestige: { limit: 1.15, closed: 1.35 },
    /** A small floor is a little busier: the fill × (1 + smallFloor × smallSeats ÷ (smallSeats + seats)). */
    smallFloor: 0.3,
    smallSeats: 20,
    /** Each Marketing level: this many more guests. */
    brand: 0.045,
    /** Mood spreads (uniform ±): a good or quiet hour, day and tick. */
    hourMood: 0.3,
    dayMood: 0.1,
    tickMood: 0.15,
    /** Hospitality (drinks, snacks, buffet, dining, champagne): each level × (1 + this) guests and × (1 + hospitalityPrestige) prestige. */
    hospitalityCrowd: 0.04,
    hospitalityPrestige: 0.045,
    /** The VIP room: High Rollers and Whales spend this much more there, at a staff cost an hour per VIP guest. */
    vipSpend: 1.6,
    vipStaff: 10,
    /** The door's limit: Tourists take at most this share of the seats. */
    touristShare: 1 / 3,
    /** A gem rush multiplies what guests spend. */
    rush: 2
}

const RICH = 2
/** The room the VIP rule reserves for High Rollers and Whales. */
export const VIP_ZONE: ZoneId = 'highlimit'

/** House rules unlock one at a time, each with a zone (in this order). */
export const RULE_UNLOCKS: readonly { rule: HouseRuleId, zone: ZoneId }[] = [
    { rule: 'door', zone: 'lounge' },
    { rule: 'vip', zone: 'highlimit' }
]

export const DOOR_RULES: readonly DoorRule[] = ['open', 'limit', 'closed']

/** What the model needs of a casino. Missing zones are read from the built games; missing rules are the defaults. */
export interface FloorView {
    zones?: readonly string[]
    games: Readonly<Record<string, number>>
    upgrades: Readonly<Partial<Record<UpgradeId, number>>>
    rushUntil?: number | null
    campaign?: RunningCampaignRef | null
    /** Every campaign (one per kind); `campaign` alone is read when this is missing. */
    campaigns?: readonly RunningCampaignRef[]
    rules?: HouseRules
}

export function emptyCounts(): VisitorCounts {
    return { tourist: 0, regular: 0, highroller: 0, whale: 0 }
}

/**
 * The per-tick luck seed of a player: FNV-1a of `salt:playerId`. The server
 * salts it with a secret (`luckSeed` in server/utils/tycoon.ts), so nobody
 * can work out the good hours ahead from a player id; scripts and tests pass
 * their own.
 */
export function seedOf(playerId: string, salt = ''): number {
    const key = salt ? `${salt}:${playerId}` : playerId
    let hash = 0x811C9DC5
    for (let i = 0; i < key.length; i++) {
        hash ^= key.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return hash >>> 0
}

function mix(a: number): number {
    a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
}

/** A uniform 0..1 from (seed, a, b), the same everywhere. */
function luck(seed: number, a: number, b: number): number {
    return mix(seed ^ Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 7, 0x85EBCA77))
}

function zoneIndex(id: string): number {
    return ZONES.findIndex(zone => zone.id === id)
}

/** The zones a view owns (from the built games when it doesn't say). */
export function zonesOf(view: Pick<FloorView, 'zones' | 'games'>): string[] {
    if (view.zones) return [...view.zones]
    const zones = new Set<string>(['backroom'])
    for (const game of TYCOON_GAMES) if ((view.games[game.slug] ?? 0) >= 1) zones.add(game.zone)
    return [...zones]
}

/** Rules this casino has unlocked, in unlock order. */
export function unlockedRules(view: Pick<FloorView, 'zones' | 'games'>): HouseRuleId[] {
    const zones = zonesOf(view)
    return RULE_UNLOCKS.filter(unlock => zones.includes(unlock.zone)).map(unlock => unlock.rule)
}

/** The zone that unlocks a rule. */
export function ruleZone(rule: HouseRuleId): ZoneId {
    return RULE_UNLOCKS.find(unlock => unlock.rule === rule)!.zone
}

/** The rules in force: locked ones read as their default. */
export function rulesOf(view: Pick<FloorView, 'zones' | 'games' | 'rules'>): HouseRules {
    const rules = { ...DEFAULT_RULES }
    const set = view.rules ?? DEFAULT_RULES
    for (const rule of unlockedRules(view)) (rules as Record<HouseRuleId, unknown>)[rule] = set[rule]
    return rules
}

/**
 * Prestige: × (1 + a share) per Decor and Hospitality level, zone past the
 * Backroom and game level (multiplied, so each step lifts the odds alike), and
 * × an exclusive door's pull when the rules say so.
 */
export function prestige(view: Pick<FloorView, 'zones' | 'games' | 'upgrades' | 'rules'>): number {
    const m = VISITOR_MODEL
    const zones = zonesOf(view).filter(zone => zoneIndex(zone) > 0).length
    const door = view.rules ? rulesOf(view).door : 'open'
    let machines = 1
    for (const game of TYCOON_GAMES) {
        const level = Math.min(5, Math.floor(view.games[game.slug] ?? 0))
        if (level >= 1) machines *= 1 + (m.levelPrestige[level - 1] ?? 0)
    }
    return (1 + m.prestigeDecor) ** Math.max(0, view.upgrades.decor ?? 0)
        * (1 + m.hospitalityPrestige) ** Math.max(0, view.upgrades.hospitality ?? 0)
        * (1 + m.prestigeZone) ** zones * machines
        * (door === 'limit' ? m.doorPrestige.limit : door === 'closed' ? m.doorPrestige.closed : 1)
}

/** Share of arrivals per tier, 0..1 (locked tiers 0). */
export function tierOdds(view: Pick<FloorView, 'zones' | 'games' | 'upgrades' | 'campaign' | 'campaigns' | 'rules'>, at?: number): VisitorCounts {
    const zones = zonesOf(view)
    const wealth = wealthAt(view, at)
    const p = prestige(view) * wealth.prestige
    const weights = VISITOR_TIERS.map((tier, k) => (tier.unlockZone === null || zones.includes(tier.unlockZone)
        ? VISITOR_MODEL.weights[k]! * p ** k * (k === 3 ? wealth.whales : 1)
        : 0))
    const sum = weights.reduce((a, b) => a + b, 0)
    const odds = emptyCounts()
    VISITOR_TIER_IDS.forEach((id, k) => { odds[id] = weights[k]! / sum })
    return odds
}

/** The wealth campaigns running at `at`, combined: prestige × and Whale odds × (both 1 without). */
function wealthAt(view: Pick<FloorView, 'upgrades' | 'campaign' | 'campaigns'>, at?: number): { prestige: number, whales: number } {
    let prestige = 1
    let whales = 1
    if (at === undefined) return { prestige, whales }
    for (const c of activeCampaigns(view, at)) {
        const e = campaignEffect(c.id, view.upgrades.marketing ?? 0)
        prestige *= 1 + e.prestige
        whales *= e.whales
    }
    return { prestige, whales }
}

/** The share of the seats the guests campaigns running at `at` add to the crowd (0 without): each adds its own share. */
function adsAt(view: Pick<FloorView, 'upgrades' | 'campaign' | 'campaigns'>, at?: number): number {
    if (at === undefined) return 0
    let adds = 0
    for (const c of activeCampaigns(view, at)) adds += campaignEffect(c.id, view.upgrades.marketing ?? 0).fills
    return adds
}

/** A view made ready for ticks: the layout, the odds and the crowd at one moment. */
interface Prepared {
    odds: number[]
    cumulative: number[]
    spends: number[]
    general: number
    vip: number
    /**
     * Spend factor of each general and each VIP seat (VIP bonus included), best
     * first. Guests spread over the general seats (every seat as likely, so every
     * level counts: `gAverage`); the VIP room's few rich guests take its best seats.
     */
    gSeats: number[]
    vSeats: number[]
    gAverage: number
    seats: number
    /** Arrivals a tick before the mood (Whales included). */
    crowd: number
    /** Cumulative odds of the tiers but the Whale, for the tick's fresh arrivals. */
    cumulativeOthers: number[]
    /** Whales arriving a tick before the mood (they stay several ticks). */
    whaleRate: number
    touristCap: number
    rush: number
}

function prepare(view: FloorView, at?: number): Prepared {
    const m = VISITOR_MODEL
    const zones = zonesOf(view)
    const rules = rulesOf(view)
    // The VIP room is the High Limit Room (where the rule unlocks). Moving it up to a newer, emptier
    // room would make opening the Penthouse cost income.
    const vipZone = rules.vip && zones.includes(VIP_ZONE) ? VIP_ZONE : null
    const gSeats: number[] = []
    const vSeats: number[] = []
    for (const game of TYCOON_GAMES) {
        const level = Math.min(5, Math.floor(view.games[game.slug] ?? 0))
        if (level < 1) continue
        const factor = m.levelSpend[level - 1] ?? 1
        const into = game.zone === vipZone ? vSeats : gSeats
        for (let i = seatsOf(game.slug, level); i > 0; i--) into.push(game.zone === vipZone ? factor * m.vipSpend : factor)
    }
    gSeats.sort((a, b) => b - a)
    vSeats.sort((a, b) => b - a)
    const general = gSeats.length
    const vip = vSeats.length
    const odds = tierOdds(view, at)
    const list = VISITOR_TIER_IDS.map(id => odds[id])
    let acc = 0
    const cumulative = list.map((q) => {
        acc += q
        return acc
    })
    cumulative[cumulative.length - 1] = 1
    const others = 1 - list[3]!
    const cumulativeOthers = cumulative.slice(0, 3).map(c => (others > 0 ? Math.min(1, c / others) : 1))
    cumulativeOthers[2] = 1
    // The VIP room seats only the rich: the everyday crowd comes for the other seats. A better
    // casino (prestige, wealth ads included) draws more of them; Marketing too.
    const p = prestige(view) * wealthAt(view, at).prestige
    const idle = general * m.fill * p ** m.fillPrestige * (1 + m.smallFloor * m.smallSeats / (m.smallSeats + general))
        * (1 + m.brand * Math.max(0, view.upgrades.marketing ?? 0)) * (1 + m.hospitalityCrowd * Math.max(0, view.upgrades.hospitality ?? 0))
    // Guests ads each bring their own share of the seats, so only all of them together fill the floor.
    const crowd = idle + general * adsAt(view, at)
    const seats = general + vip
    return {
        odds: list,
        cumulative,
        spends: VISITOR_TIERS.map(tier => tier.spend),
        general,
        vip,
        gSeats,
        vSeats,
        gAverage: general > 0 ? gSeats.reduce((a, b) => a + b, 0) / general : 1,
        seats,
        crowd,
        cumulativeOthers,
        whaleRate: crowd * list[3]! / ((m.whaleStayMin + m.whaleStayMax) / 2),
        touristCap: rules.door === 'closed' ? 0 : rules.door === 'limit' ? Math.floor(seats * m.touristShare) : Infinity,
        rush: at !== undefined && view.rushUntil != null && at < view.rushUntil ? m.rush : 1
    }
}

/** The mood of a tick: a random hour, day and tick factor (no time-of-day curve). */
export function moodAt(seed: number, tick: number): number {
    const m = VISITOR_MODEL
    const hour = Math.floor(tick * TICK_MS / HOUR_MS)
    const day = Math.floor(tick * TICK_MS / (24 * HOUR_MS))
    return (1 + m.hourMood * (2 * luck(seed, hour, -2) - 1))
        * (1 + m.dayMood * (2 * luck(seed, day, -3) - 1))
        * (1 + m.tickMood * (2 * luck(seed, tick, -1) - 1))
}

/** A Whale on the floor this tick: came in at tick `arrival` (the `index`-th that tick) for `stay` ticks, spending `spend` an hour (rush included). */
export interface WhaleStay {
    arrival: number
    index: number
    stay: number
    spend: number
}

/** One tick of the floor. */
export interface TickRoll {
    visitors: VisitorCounts
    seated: number
    turnedAway: number
    /** What the seated guests spend an hour (before a rush and costs). */
    gross: number
    /** Running costs an hour (VIP staff). */
    costs: number
    /** Coins an hour into the cage: gross × rush − costs, never below 0. */
    rate: number
    /** Seated whales, and each one's stay. */
    whales: number
    whaleStays: WhaleStay[]
    /** What each tier spends an hour (index = VISITOR_TIER_IDS), rush included. */
    byTier: number[]
}

/** A Poisson draw from the uniform `u` (inverse CDF). */
function poisson(u: number, mean: number): number {
    if (!(mean > 0)) return 0
    let k = 0
    let p = Math.exp(-mean)
    let c = p
    while (u > c && k < 50) {
        k++
        p *= mean / k
        c += p
    }
    return k
}

/**
 * The Whales on the floor at `tick`: those who arrived in the last
 * whaleStayMax ticks and haven't left. Arrivals and stays are worked out
 * from (the casino as it is now, seed, their arrival tick) only, so a tick's
 * floor stays a pure function of (state, seed, tick): after a change the
 * stayers are those the new casino would have drawn. Earliest first.
 */
function whalesAt(p: Prepared, seed: number, tick: number): Omit<WhaleStay, 'spend'>[] {
    if (!(p.whaleRate > 0)) return []
    const { whaleStayMin: lo, whaleStayMax: hi } = VISITOR_MODEL
    const here: Omit<WhaleStay, 'spend'>[] = []
    for (let back = hi - 1; back >= 0; back--) {
        const arrival = tick - back
        const count = poisson(luck(seed, arrival, -4), p.whaleRate * moodAt(seed, arrival))
        for (let index = 0; index < count; index++) {
            const stay = lo + Math.floor(luck(seed, arrival, -100 - index) * (hi - lo + 1))
            if (stay > back) here.push({ arrival, index, stay })
        }
    }
    return here
}

function roll(p: Prepared, seed: number, tick: number): TickRoll {
    const m = VISITOR_MODEL
    const seatedBy = [0, 0, 0, 0]
    const byTier = [0, 0, 0, 0]
    let away = 0, vipUsed = 0, genUsed = 0, gross = 0
    // Whales already here keep their seats (the best ones; VIP first), then the tick's other guests come in.
    const whaleStays: WhaleStay[] = []
    for (const whale of whalesAt(p, seed, tick)) {
        let factor: number
        if (vipUsed < p.vip) factor = p.vSeats[vipUsed++]!
        else if (genUsed < p.general) {
            genUsed++
            factor = p.gAverage
        }
        else {
            away++
            continue
        }
        const spend = p.spends[3]! * factor
        seatedBy[3]!++
        byTier[3]! += spend
        gross += spend
        whaleStays.push({ ...whale, spend: spend * p.rush })
    }
    const n = Math.max(0, Math.round(p.crowd * (1 - p.odds[3]!) * moodAt(seed, tick)))
    for (let i = 0; i < n; i++) {
        const u = luck(seed, tick, i)
        let k = 0
        while (k < 2 && u >= p.cumulativeOthers[k]!) k++
        if (k === 0 && seatedBy[0]! >= p.touristCap) {
            away++
            continue
        }
        let factor: number
        if (k >= RICH && vipUsed < p.vip) factor = p.vSeats[vipUsed++]!
        else if (genUsed < p.general) {
            genUsed++
            factor = p.gAverage
        }
        else {
            away++
            continue
        }
        seatedBy[k]!++
        byTier[k]! += p.spends[k]! * factor
        gross += p.spends[k]! * factor
    }
    const seated = vipUsed + genUsed
    const costs = m.vipStaff * vipUsed
    return {
        visitors: { tourist: seatedBy[0]!, regular: seatedBy[1]!, highroller: seatedBy[2]!, whale: seatedBy[3]! },
        seated,
        turnedAway: away,
        gross,
        costs,
        rate: Math.max(0, gross * p.rush - costs),
        whales: seatedBy[3]!,
        whaleStays,
        byTier: byTier.map(v => v * p.rush)
    }
}

/** The tick holding `at`. */
export function tickOf(at: number): number {
    return Math.floor(at / TICK_MS)
}

/** The floor's tick at `at` (state as of `at`). */
export function rollAt(view: FloorView, seed: number, at: number): TickRoll {
    return roll(prepare(view, at), seed, tickOf(at))
}

/** The fluid floor for `n` arrivals (fractional counts, no luck). */
interface Fluid {
    visitors: number[]
    seated: number
    turnedAway: number
    gross: number
    costs: number
    rate: number
}

function fluid(p: Prepared, n: number): Fluid {
    const m = VISITOR_MODEL
    const a = p.odds.map(q => q * n)
    const touristsIn = Math.min(a[0]!, p.touristCap)
    const rich = a[2]! + a[3]!
    const vipIn = Math.min(rich, p.vip)
    const inVip = rich > 0 ? vipIn / rich : 0
    const demand = touristsIn + a[1]! + rich - vipIn
    const share = demand > 0 ? Math.min(1, p.general / demand) : 0
    const visitors = [touristsIn * share, a[1]! * share, a[2]! * (inVip + (1 - inVip) * share), a[3]! * (inVip + (1 - inVip) * share)]
    const seated = visitors.reduce((s, v) => s + v, 0)
    // Guests spread over the general seats; the VIP room's take its best seats first.
    const gM = p.gAverage
    const vM = topAverage(p.vSeats, vipIn)
    let gross = 0
    for (let k = 0; k < 4; k++) {
        const vipPart = k >= RICH ? a[k]! * inVip : 0
        gross += p.spends[k]! * (vipPart * vM + (visitors[k]! - vipPart) * gM)
    }
    const costs = m.vipStaff * vipIn
    return { visitors, seated, turnedAway: Math.max(0, n - seated), gross, costs, rate: Math.max(0, gross * p.rush - costs) }
}

/** The average of the best `n` (fractional) of `factors` (sorted best first). */
function topAverage(factors: readonly number[], n: number): number {
    if (!(n > 0) || !factors.length) return 1
    const whole = Math.min(factors.length, Math.floor(n))
    let sum = 0
    for (let i = 0; i < whole; i++) sum += factors[i]!
    const part = Math.min(n, factors.length) - whole
    if (part > 0) sum += factors[whole]! * part
    return sum / Math.min(n, factors.length)
}

/** Mood points averaged by the expectation (midpoints of equal slices of each uniform spread). */
function moodPoints(): number[] {
    const m = VISITOR_MODEL
    const slices = (spread: number, count: number) => Array.from({ length: count }, (_, i) => 1 + spread * (2 * (i + 0.5) / count - 1))
    const points: number[] = []
    for (const h of slices(m.hourMood, 8)) {
        for (const d of slices(m.dayMood, 3)) {
            for (const t of slices(m.tickMood, 3)) points.push(h * d * t)
        }
    }
    return points
}

/** The expected floor at `at` (campaign and rush as of then; none without `at`): moods averaged, no luck. */
export interface ExpectedFloor {
    /** Average seated guests per tier (fractional). */
    visitors: VisitorCounts
    seats: number
    /** Arrivals a tick on average (may exceed the seats). */
    demand: number
    turnedAway: number
    perHour: number
}

function expectedOf(p: Prepared): ExpectedFloor {
    const points = moodPoints()
    const visitors = [0, 0, 0, 0]
    let away = 0, rate = 0
    for (const mood of points) {
        const f = fluid(p, p.crowd * mood)
        f.visitors.forEach((v, k) => { visitors[k]! += v / points.length })
        away += f.turnedAway / points.length
        rate += f.rate / points.length
    }
    return {
        visitors: { tourist: visitors[0]!, regular: visitors[1]!, highroller: visitors[2]!, whale: visitors[3]! },
        seats: p.seats,
        demand: p.crowd,
        turnedAway: away,
        perHour: rate
    }
}

export function expectedFloor(view: FloorView, at?: number): ExpectedFloor {
    return expectedOf(prepare(view, at))
}

/** Coins an hour on average for this build and these rules at `at` (no luck; no campaign or rush without `at`). */
export function expectedPerHour(view: FloorView, at?: number): number {
    return Math.round(expectedOf(prepare(view, at)).perHour * 100) / 100
}

/**
 * Expected guest coins from `from` to `to` (no luck, no cage cap), split where
 * the campaign or rush ends.
 */
export function expectedBetween(view: FloorView, from: number, to: number): number {
    if (!(to > from)) return 0
    const cuts = [from, to]
    for (const at of [...campaignsOf(view).map(c => c.until), view.rushUntil ?? null]) {
        if (at !== null && at > from && at < to) cuts.push(at)
    }
    cuts.sort((a, b) => a - b)
    let coins = 0
    for (let i = 0; i + 1 < cuts.length; i++) coins += expectedOf(prepare(view, cuts[i]!)).perHour * (cuts[i + 1]! - cuts[i]!) / HOUR_MS
    return coins
}

/** What a campaign adds over its whole run (`campaignGain`). */
export interface CampaignGain {
    /** Extra guests seated on average while it runs (fewer on a floor that is already full). */
    guests: number
    /** Extra High Rollers and Whales seated on average while it runs. */
    richGuests: number
    /** Extra coins over the whole run, before the cage cap (moods averaged: what it brings on average, no lucky hour). */
    coins: number
    /** Guests seated per tier on average halfway through the run, without and with it. */
    before: VisitorCounts
    after: VisitorCounts
    /**
     * What of `coins` a player collecting every `collectEveryMs` (4 hours by
     * default) actually gets with the cage's `capacity` (a full cage loses
     * the rest); `coins` without a capacity given.
     */
    kept: number
    /** How long an empty cage takes to fill while it runs (ms), with a capacity given; else null. */
    cageFullMs: number | null
    /** The run it covers (ms): from now, or from the end of the queued runs of the same campaign. */
    from: number
    until: number
}

/**
 * The realistic gain of running campaign `id` now: the expected floor (moods
 * averaged, so quiet hours with empty seats count as they come) with it,
 * minus without it, over its whole run, at the casino's build and rules. A
 * run bought on top of the same campaign covers the stretch after the queue.
 * Deterministic: previews and the simulation read it.
 */
export function campaignGain(view: FloorView, id: CampaignId, now: number, cage: { capacity: number, collectEveryMs?: number } | null = null): CampaignGain {
    const def = findCampaign(id)
    if (!def) return { guests: 0, richGuests: 0, coins: 0, before: emptyCounts(), after: emptyCounts(), kept: 0, cageFullMs: null, from: now, until: now }
    const mine = campaignOf(view, id)
    const from = mine && mine.until > now ? mine.until : now
    const until = from + def.ms
    // The other campaigns keep running as they are: this is what this one adds on top.
    const others = campaignsOf(view).filter(c => c.id !== id)
    const withIt = { ...view, campaign: null, campaigns: [...others, { id, until }] }
    const without = { ...view, campaign: null, campaigns: others }
    const mid = from + def.ms / 2
    const a = expectedFloor(withIt, mid)
    const b = expectedFloor(without, mid)
    const rich = (f: ExpectedFloor) => f.visitors.highroller + f.visitors.whale
    const coins = Math.max(0, expectedBetween(withIt, from, until) - expectedBetween(without, from, until))
    // The cage: collected every few hours from empty, each stretch holds at most the capacity.
    let kept = coins
    let cageFullMs: number | null = null
    if (cage) {
        const every = cage.collectEveryMs ?? 4 * HOUR_MS
        kept = 0
        for (let at = from; at < until; at += every) {
            const end = Math.min(until, at + every)
            kept += Math.min(cage.capacity, expectedBetween(withIt, at, end)) - Math.min(cage.capacity, expectedBetween(without, at, end))
        }
        kept = Math.max(0, Math.min(coins, kept))
        const rate = expectedOf(prepare(withIt, mid)).perHour
        cageFullMs = rate > 0 ? cage.capacity / rate * HOUR_MS : null
    }
    return {
        guests: Math.max(0, seatedTotal(a.visitors) - seatedTotal(b.visitors)),
        richGuests: rich(a) - rich(b),
        coins,
        before: b.visitors,
        after: a.visitors,
        kept,
        cageFullMs,
        from,
        until
    }
}

/** One tier's share of the guests before and after a change (`tierShift`). */
export interface TierShift {
    id: VisitorTierId
    now: number
    next: number
    /** The zone that opens this tier when it isn't open yet (its shares are then what they will be once it is), else null. */
    from: string | null
}

/**
 * How a change (a build step, a campaign) moves the tier mix: every tier open
 * after it, plus the next tier still locked (with the shares it will have
 * once its zone opens). A richer mix shows as the cheap tiers going down and
 * the rich ones going up.
 */
export function tierShift(before: FloorView, after: FloorView, at?: number): TierShift[] {
    const open = zonesOf(after)
    const shifts: TierShift[] = []
    for (const tier of VISITOR_TIERS) {
        if (tier.unlockZone === null || open.includes(tier.unlockZone)) {
            shifts.push({ id: tier.id, now: tierOdds(before, at)[tier.id], next: tierOdds(after, at)[tier.id], from: null })
            continue
        }
        const zone = tier.unlockZone
        const opened = (view: FloorView) => ({ ...view, zones: [...zonesOf(view), zone] })
        shifts.push({ id: tier.id, now: tierOdds(opened(before), at)[tier.id], next: tierOdds(opened(after), at)[tier.id], from: zone })
        break
    }
    return shifts
}

/** Game levels whose step draws noticeably richer guests (the top machines): the build UI marks them. */
export function richerLevel(level: number): boolean {
    const p = VISITOR_MODEL.levelPrestige
    return level >= 2 && (p[level - 1] ?? 0) - (p[level - 2] ?? 0) >= 0.005
}

/** What every seat taken spends an hour at the expected tier mix under `rules` (before a rush and costs). */
export function fullFloorPerHour(view: FloorView, rules: HouseRules = DEFAULT_RULES, wealthAds: readonly CampaignId[] = []): number {
    const p = prepare({ ...view, rules, rushUntil: null, campaign: null, campaigns: wealthAds.map(id => ({ id, until: 1 })) }, wealthAds.length ? 0 : undefined)
    // Arrivals far over the seats fill every one at the mix the door lets in.
    const f = fluid(p, Math.max(1, p.seats) * 50)
    return Math.round(f.gross * 100) / 100
}

/** Every combination of the rules a casino has unlocked. */
export function ruleCombos(view: Pick<FloorView, 'zones' | 'games'>): HouseRules[] {
    const open = unlockedRules(view)
    let combos: HouseRules[] = [{ ...DEFAULT_RULES }]
    if (open.includes('door')) combos = combos.flatMap(r => DOOR_RULES.map(door => ({ ...r, door })))
    if (open.includes('vip')) combos = combos.flatMap(r => [r, { ...r, vip: true }])
    return combos
}

/** The most a full floor spends an hour under any rules the casino could run (what a rush is priced from). */
export function bestFullFloorPerHour(view: FloorView): number {
    // Every wealth ad the casino can run, too: a rush must not beat converting under any of them.
    const wealth = CAMPAIGNS.filter(c => c.goal === 'wealth' && !campaignBlocker({ zones: zonesOf(view), upgrades: view.upgrades, campaigns: [] }, c.id, 0)).map(c => c.id)
    return Math.max(...ruleCombos(view).map(rules => fullFloorPerHour(view, rules, wealth)))
}

// ── Accrual ──────────────────────────────────────────────────────────────

/** An hour's share of a stretch of floor time (what the history table adds up). */
export interface HourPiece {
    /** Start of the hour (ms). */
    at: number
    /** Guest-hours per tier: seated guests × the hours covered. */
    guestHours: VisitorCounts
    /** Milliseconds of the hour covered. */
    ms: number
    /** Coins earned (after costs, before the cage cap). */
    income: number
    /** Coins a full cage had no room for. */
    lost: number
}

export interface FloorRun {
    /** Coins earned over the stretch (after costs, before the cage cap). */
    income: number
    /** Coins in the cage after (with `cage`; else 0). */
    stored: number
    /** Coins the full cage had no room for. */
    lost: number
    /** Per hour, oldest first (with `hours`). */
    hours: HourPiece[]
    /** Whales seated during the stretch, one per whale and tick (with `notable`). */
    notable: NotableGuest[]
    /** False when `stopWhenFull` cut the run short (the cage filled up). */
    complete: boolean
}

export interface FloorRunOptions {
    cage?: { stored: number, capacity: number }
    hours?: boolean
    notable?: boolean
    /** Stop once the cage is full (a read that only needs the cage). */
    stopWhenFull?: boolean
}

/** Units a tick earns at `rate` coins an hour. */
function tickUnits(rate: number): number {
    return Math.floor(rate * COIN_UNITS * TICK_MS / HOUR_MS + 1e-6)
}

/**
 * The floor from `from` to `to` (ms) at one build and one set of rules, split
 * where a rush or campaign ends and at every tick. Additive: any split point
 * gives the same income. Build changes are the caller's (run up to each).
 */
export function runFloor(view: FloorView, seed: number, from: number, to: number, options: FloorRunOptions = {}): FloorRun {
    const run: FloorRun = { income: 0, stored: options.cage?.stored ?? 0, lost: 0, hours: [], notable: [], complete: true }
    if (!(to > from)) return run
    const capUnits = options.cage ? Math.round(options.cage.capacity * COIN_UNITS) : Infinity
    let stored = options.cage ? Math.round(options.cage.stored * COIN_UNITS) : 0
    let income = 0
    let lost = 0
    const cuts = [from, to]
    for (const at of [view.rushUntil ?? null, ...campaignsOf(view).map(c => c.until)]) {
        if (at !== null && at > from && at < to) cuts.push(at)
    }
    cuts.sort((a, b) => a - b)
    let hour: HourPiece | null = null
    const whales = new Map<string, NotableGuest>()
    for (let c = 0; c + 1 < cuts.length; c++) {
        const segEnd = cuts[c + 1]!
        const p = prepare(view, cuts[c]!)
        let t = cuts[c]!
        while (t < segEnd) {
            const tick = tickOf(t)
            const start = tick * TICK_MS
            const b = Math.min(segEnd, start + TICK_MS)
            const r = roll(p, seed, tick)
            const units = tickUnits(r.rate)
            const du = Math.floor(units * (b - start) / TICK_MS) - Math.floor(units * (t - start) / TICK_MS)
            const room = stored >= capUnits ? 0 : capUnits - stored
            const gained = Math.min(du, room)
            stored += gained
            income += du
            lost += du - gained
            if (options.hours) {
                const at = Math.floor(t / HOUR_MS) * HOUR_MS
                if (!hour || hour.at !== at) {
                    hour = { at, guestHours: emptyCounts(), ms: 0, income: 0, lost: 0 }
                    run.hours.push(hour)
                }
                const share = (b - t) / HOUR_MS
                for (const id of VISITOR_TIER_IDS) hour.guestHours[id] += r.visitors[id] * share
                hour.ms += b - t
                hour.income += fromUnits(du)
                hour.lost += fromUnits(du - gained)
            }
            if (options.notable) {
                for (const whale of r.whaleStays) {
                    const key = `${whale.arrival}:${whale.index}`
                    const seen = whales.get(key) ?? { id: key, at: whale.arrival * TICK_MS, until: (whale.arrival + whale.stay) * TICK_MS, tier: 'whale' as const, spent: 0 }
                    seen.spent += whale.spend * (b - t) / HOUR_MS
                    whales.set(key, seen)
                }
            }
            t = b
            if (options.stopWhenFull && stored >= capUnits) {
                run.complete = t >= to
                c = cuts.length
                break
            }
        }
    }
    for (const h of run.hours) {
        h.income = Math.round(h.income * COIN_UNITS) / COIN_UNITS
        h.lost = Math.round(h.lost * COIN_UNITS) / COIN_UNITS
    }
    for (const seen of whales.values()) run.notable.push({ ...seen, spent: Math.floor(seen.spent) })
    run.notable.sort((a, b) => a.at - b.at)
    run.income = fromUnits(income)
    run.stored = fromUnits(stored)
    run.lost = fromUnits(lost)
    return run
}

/** The floor now (`TycoonState.floor`). */
export function floorNow(view: FloorView, seed: number, now: number): FloorNow {
    const p = prepare(view, now)
    const tick = tickOf(now)
    const r = roll(p, seed, tick)
    const odds = tierOdds(view, now)
    // Rounded to cents first, so the tiers less the costs add up to perHour exactly.
    const cents = (v: number) => Math.round(v * 100)
    const income = emptyCounts()
    VISITOR_TIER_IDS.forEach((id, k) => { income[id] = cents(r.byTier[k]!) / 100 })
    const costs = cents(r.costs) / 100
    const total = VISITOR_TIER_IDS.reduce((sum, id) => sum + cents(income[id]), 0)
    return {
        visitors: r.visitors,
        seats: p.seats,
        turnedAway: r.turnedAway,
        perHour: Math.max(0, total - cents(costs)) / 100,
        income,
        costs,
        expectedPerHour: Math.round(expectedOf(p).perHour * 100) / 100,
        odds,
        tickEndsAt: (tick + 1) * TICK_MS
    }
}

// ── House rules ──────────────────────────────────────────────────────────

interface RuleText {
    label: string
    description: string
}

const RULE_TEXT: Record<string, RuleText> = {
    'door:open': { label: 'Open door', description: 'Everyone gets in.' },
    'door:limit': { label: 'Limit Tourists', description: 'Tourists take at most a third of the seats: more room for richer guests on a busy floor, empty seats on a quiet one.' },
    'door:closed': { label: 'No Tourists', description: 'Tourists stay out: only richer guests take the seats. A quiet floor stays half empty.' },
    'vip:false': { label: 'No VIP room', description: 'The High Limit Room seats everyone.' },
    'vip:true': { label: 'VIP room', description: `The High Limit Room seats only High Rollers and Whales, who spend ${Math.round((VISITOR_MODEL.vipSpend - 1) * 100)}% more there; ${VISITOR_MODEL.vipStaff} coins an hour staff per VIP guest. The room stops drawing the everyday crowd, so it pays on a busy floor.` }
}

/** The rules panel (`TycoonState.house`): unlocked rules, their options with live expected deltas, the cooldown. */
export function houseState(view: FloorView, now: number, rulesAt: number | null): HouseState {
    const rules = rulesOf(view)
    const unlocked = unlockedRules(view)
    const base = expectedPerHour({ ...view, rules }, now)
    const options: HouseRuleOption[] = []
    for (const rule of unlocked) {
        const values: (boolean | DoorRule)[] = rule === 'door' ? [...DOOR_RULES] : [false, true]
        for (const value of values) {
            const next = { ...rules, [rule]: value } as HouseRules
            const text = RULE_TEXT[`${rule}:${String(value)}`]!
            options.push({
                rule,
                value,
                label: text.label,
                description: text.description,
                delta: Math.round((expectedPerHour({ ...view, rules: next }, now) - base) * 100) / 100,
                active: rules[rule] === value
            })
        }
    }
    const until = rulesAt === null ? null : rulesAt + RULES_COOLDOWN_MS
    return { rules, unlocked, options, cooldownUntil: until !== null && until > now ? until : null }
}

/** Whether `value` is a valid setting of `rule`. */
export function isRuleValue(rule: HouseRuleId, value: unknown): boolean {
    return rule === 'door' ? DOOR_RULES.includes(value as DoorRule) : typeof value === 'boolean'
}
