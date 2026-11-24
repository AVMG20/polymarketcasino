// `bun scripts/tycoon-sim.ts [days] [seed]`: My Casino under economy v2
// ("claim coins, win chips"), played day by day by three kinds of player,
// against the catalog in shared/tycoon.ts.
//
// Coins are claimed: the cashier cage (guest income, in coins), daily
// missions and gems converted at 1,000 coins a gem. Coins can only be bet, and
// every payout is chips, so a session bets its coins (in chunks, at RTP 0.97
// with dice-like variance) and the wins become chips. Chips build (the next
// zone first, else the cheapest step), run the ad campaign that pays best
// (judged against the cage and the player's own collect times), and a share
// of spare chips is bet again for more chips. Gems buy speed (the gem
// builder, skips, rushes) or are converted. The Construction Crew (an upgrade
// after the Slot Lounge) is saved for like a zone: +1 builder. Between
// sessions constructions finish and the cage fills up to its capacity.
//
// After the last build the players keep playing for POST_MAX_DAYS (third
// argument), so the star table shows when the top stars come. A shadow cage
// that never sees a campaign runs next to the real one: the difference at
// each collect is what the campaigns brought.
//
// Games unlock by casino level (shared/casino-level.ts), not by room, and need
// floor space: a new game takes its spot as the server gives it (home, else the
// nearest free one in an owned room, shared/floor/placement.ts), and the free
// furniture each room brings is granted onto the floor too. A
// special decoration (shared/decor.ts) is bought once it is unlocked, pays its
// price back within SPECIAL_PAYBACK_H of expected income and leaves chips to
// build; it is placed at once. The tables show the day each casino level came,
// the day each game was first built and the specials bought.
//
// The cage accrues through the visitor model (shared/visitors.ts `runFloor`):
// tiers, seats, house rules and the per-tick luck, seeded per profile, exactly
// as the server does. Players judge campaigns and house rules on the expected
// numbers (no luck): at each session start they run the rules that earn the
// most until the next session (the casual player only at the day's first
// session), within the ten-minute cooldown.
//
// Daily missions (shared/missions.ts) pay coins: three a day, drawn at the
// day's first session with rewards from the casino's full guest income, plus
// the bonus for all three. The casual player clears two a day, the regular
// and the whale all three and the bonus; the coins are claimed at the day's
// last session (the first day: as its first session ends) and bet like the
// cage's.
//
// Targets (docs/casino-economy.md): the first builds land in seconds in the
// first session; casual (no gems) maxes in ~4 weeks, regular (converts its
// gems, buys the builder) in 2-3, whale (buys gems, skips, rushes) in 1-2.
// Stars: the first in the first days, the middle ones while building, 8-9
// around max and 10 one to two weeks of play after it.
// The starting 50 gems converted stay under ~10-15% of the catalog, a day's
// 10 gems ~10-20% of a regular's mid-game daily chips, and a full floor's
// guest income stays capped.
import { casinoLevel, gameUnlockLevel, MAX_CASINO_LEVEL } from '../shared/casino-level'
import { DECOR, placedSpecials, specialBonus, type DecorType } from '../shared/decor'
import { findSpot, furnitureGrants, layoutOf, layoutStateOf, roomCentre } from '../shared/floor/placement'
import { seededRng, type Rng } from '../shared/rng'
import { COINS_PER_GEM } from '../shared/economy'
import { CASINO_STARS, starLevel } from '../shared/stars'
import { BONUS_HOURS, findMission, MISSIONS, missionReward, pickMissions } from '../shared/missions'
import {
    activeCampaigns,
    BUILDER_GEMS,
    builderCount,
    campaignBlocker,
    campaignCost,
    CAMPAIGNS,
    type CampaignId,
    buildBlocker,
    cageCapacity,
    newGameSpot,
    fullIncomePerHour,
    nextCost,
    occupancy,
    progressOf,
    RUSH_GEMS,
    RUSH_MAX_GEMS,
    rushExtraCoins,
    rushGems,
    RUSH_MS,
    skipGems,
    STARTER_CAGE,
    TYCOON_GAMES,
    UPGRADES,
    ZONES,
    type BuildKind,
    type Construction,
    type TycoonState,
    type RunningCampaignRef,
    type UpgradeId
} from '../shared/tycoon'
import {
    DEFAULT_RULES,
    expectedBetween,
    expectedFloor,
    expectedPerHour,
    floorNow,
    ruleCombos,
    RULES_COOLDOWN_MS,
    runFloor,
    seatedTotal,
    seedOf,
    unlockedRules,
    VISITOR_TIERS,
    type FloorView,
    type HouseRules
} from '../shared/visitors'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const days = Number(process.argv[2] ?? 80)
const seed = Number(process.argv[3] ?? 7)
const POST_MAX_DAYS = Number(process.argv[4] ?? 21)

/** The mix of games the sim bets on: RTP and a dice-like win chance (variance). */
const RTP = 0.97
const WIN_CHANCE = 0.495
const MULTIPLIER = RTP / WIN_CHANCE

interface Session {
    /** Hour of the day it starts. */
    at: number
    minutes: number
}

interface Profile {
    name: string
    sessions: Session[]
    /** Gems at the start, and gems a day (the hub's 10, plus any bought). */
    startGems: number
    gemsPerDay: number
    /** none: never touches gems; regular: converts the start pile, saves for the builder, converts the rest; whale: builder, skips, rushes, converts the rest above a reserve. */
    gems: 'none' | 'regular' | 'whale'
    /** Share of spare chips bet again at the end of a session (spare = above twice the dearest next step). */
    betSpare: number
    /** Daily missions cleared a day (of three); all three also claim the bonus. */
    missions: number
}

const PROFILES: Profile[] = [
    {
        name: 'casual',
        sessions: [{ at: 8, minutes: 15 }, { at: 13, minutes: 10 }, { at: 21, minutes: 30 }],
        startGems: 0,
        gemsPerDay: 0,
        gems: 'none',
        betSpare: 0.05,
        missions: 2
    },
    {
        name: 'regular',
        sessions: [{ at: 8, minutes: 30 }, { at: 12.5, minutes: 20 }, { at: 18, minutes: 45 }, { at: 22.5, minutes: 30 }],
        startGems: 50,
        gemsPerDay: 10,
        gems: 'regular',
        betSpare: 0.1,
        missions: 3
    },
    {
        name: 'whale',
        sessions: [7, 9.5, 12, 14.5, 17, 19.5, 22.5].map(at => ({ at, minutes: 40 })),
        startGems: 150,
        gemsPerDay: 110,
        gems: 'whale',
        betSpare: 0.1,
        missions: 3
    }
]

const STEP_MS = 5_000

type SimState = TycoonState & {
    cageAt: number
    /** Per campaign that ran since the last collect: the same cage without that one (the others ran as they did). */
    shadows: Partial<Record<CampaignId, number>>
    rules: HouseRules
    rulesAt: number | null
    seed: number
    /** Free furniture given (grant keys). */
    granted: string[]
}

const view = (state: SimState): FloorView => ({ zones: state.zones, games: state.games, upgrades: state.upgrades, rushUntil: state.rushUntil, campaign: null, campaigns: state.campaigns ?? [], rules: state.rules, specials: specialBonus(placedSpecials(state.decor ?? [])) })

function newState(now: number, seed = 0): SimState {
    const state: SimState = {
        serverNow: now,
        chips: 0,
        zones: ['backroom'],
        games: Object.fromEntries(TYCOON_GAMES.filter(g => g.starter).map(g => [g.slug, 1])),
        upgrades: { cage: 0, marketing: 0, hospitality: 0, crew: 0 },
        constructions: [],
        builders: 1,
        gemBuilder: false,
        cage: { stored: STARTER_CAGE, capacity: cageCapacity(0), perHour: 0 },
        rushUntil: null,
        campaign: null,
        campaigns: [],
        golden: [],
        placements: {},
        decor: [],
        progress: 0,
        gemsEnabled: true,
        cageAt: now,
        shadows: {},
        rules: { ...DEFAULT_RULES },
        rulesAt: null,
        seed,
        granted: [],
        floor: undefined as unknown as TycoonState['floor']
    }
    state.floor = floorNow(view(state), seed, now)
    return state
}

interface Tally {
    cage: number
    missions: number
    cageLost: number
    converted: number
    coinsBet: number
    chipsWon: number
    chipsRebet: number
    campaigns: number
    built: number
    gemsConverted: number
    gemsSpeed: number
    builds: number
    firstSession: { builds: number, longestMs: number }
    buildLog: { day: number, ms: number }[]
    /** Chips won per day (index = day). */
    chipsByDay: number[]
    /** Per campaign: runs, chips paid, extra coins it brought to the cage. */
    campaignRuns: Record<CampaignId, { runs: number, chips: number, coins: number }>
    /** First day (fraction) each star level was held at, index = level - 1. */
    starDays: (number | null)[]
    /** Chip balance at the end of each day. */
    chipsEndOfDay: number[]
    /** Guest income (before the cage cap) by hour start and by day. */
    incomeByHour: Map<number, number>
    incomeByDay: number[]
    /** Coins collected from the cage by day (the starter cage included). */
    cageByDay: number[]
    /** Hours run under each rule set (by stage zone). */
    ruleHours: Map<string, number>
    /** Specials bought: when, the price and the expected coins an hour they added. */
    specials: { type: DecorType, day: number, chips: number, gain: number }[]
    /** Casino level at the end of each day, and the day each level was reached. */
    levelEndOfDay: number[]
    levelDays: (number | null)[]
    /** Day each game was first started (built). */
    gameDays: Record<string, number>
}

/** The cage up to `to` through the tick model (lazily: before anything changes the floor or reads the cage). */
function accrue(state: SimState, to: number, tally: Tally) {
    if (to <= state.cageAt) return
    const capacity = cageCapacity(state.upgrades.cage)
    const startOf = state.cage.stored
    const run = runFloor(view(state), state.seed, state.cageAt, to, { cage: { stored: state.cage.stored, capacity }, hours: true })
    state.cage.stored = run.stored
    tally.cageLost += run.lost
    for (const hour of run.hours) {
        const day = Math.floor(hour.at / DAY)
        tally.incomeByHour.set(hour.at, (tally.incomeByHour.get(hour.at) ?? 0) + hour.income)
        tally.incomeByDay[day] = (tally.incomeByDay[day] ?? 0) + hour.income
    }
    // Each campaign that runs in the stretch: the cage without it, the others as they ran. One that
    // ran out earlier since the last collect follows the real cage's gain.
    const running = (state.campaigns ?? []).filter(c => c.until > state.cageAt)
    for (const id of Object.keys(state.shadows) as CampaignId[]) {
        if (!running.some(c => c.id === id)) state.shadows[id] = Math.max(state.shadows[id]!, Math.min(capacity, state.shadows[id]! + run.income))
    }
    for (const c of running) {
        const without = runFloor({ ...view(state), campaigns: running.filter(o => o.id !== c.id) }, state.seed, state.cageAt, to, { cage: { stored: state.shadows[c.id] ?? startOf, capacity } })
        state.shadows[c.id] = without.stored
    }
    state.cageAt = to
}

function apply(state: SimState, c: Construction) {
    if (c.kind === 'zone') state.zones.push(c.id as never)
    else if (c.kind === 'game') state.games[c.id] = c.level
    else state.upgrades[c.id as UpgradeId] = c.level
    state.builders = builderCount(state.upgrades, !!state.gemBuilder)
    if (c.kind === 'zone') grantFurniture(state)
}

/** The free furniture a room brings, as the server grants it (it takes floor space). */
function grantFurniture(state: SimState) {
    const given = new Set(state.granted)
    const due = furnitureGrants(layoutOf(layoutStateOf(state)), given)
    for (const grant of due) {
        state.granted.push(grant.key)
        state.decor!.push({ id: state.decor!.length + 1, type: grant.type, x: grant.at?.x ?? null, y: grant.at?.y ?? null })
    }
}

function hireGemBuilder(state: SimState) {
    state.gemBuilder = true
    state.builders = builderCount(state.upgrades, true)
}

function advance(state: SimState, to: number, tally: Tally) {
    for (;;) {
        const next = [...state.constructions].sort((a, b) => a.readyAt - b.readyAt)[0]
        if (!next || next.readyAt > to) break
        accrue(state, next.readyAt, tally)
        state.constructions = state.constructions.filter(c => c !== next)
        apply(state, next)
    }
    state.serverNow = to
}

const CANDIDATES: { kind: BuildKind, id: string }[] = [
    ...ZONES.map(z => ({ kind: 'zone' as const, id: z.id })),
    ...TYCOON_GAMES.map(g => ({ kind: 'game' as const, id: g.slug })),
    ...UPGRADES.map(u => ({ kind: 'upgrade' as const, id: u.id }))
]

function levelOf(state: SimState, kind: BuildKind, id: string) {
    return kind === 'zone' ? 0 : kind === 'game' ? state.games[id] ?? 0 : state.upgrades[id as UpgradeId] ?? 0
}

/** Steps the builder could start now (ignoring money), cheapest first. */
function startable(state: SimState) {
    return CANDIDATES
        .filter(c => buildBlocker(state, c.kind, c.id) === null)
        .map(c => ({ ...c, cost: nextCost(state, c.kind, c.id)! }))
        .sort((a, b) => a.cost.chips - b.cost.chips)
}

/** Bet `amount` in chunks of about 1/25th (at least 10) at RTP with dice-like variance. Returns the payout. */
function gamble(rng: Rng, amount: number): number {
    const chunk = Math.max(10, amount / 25)
    let won = 0
    for (let left = amount; left > 0.0001; left -= chunk) {
        const bet = Math.min(chunk, left)
        if (rng.next() < WIN_CHANCE) won += bet * MULTIPLIER
    }
    return won
}

/** When `profile` collects (every session's start and end) after `from`, up to `to`. */
function collectTimes(profile: Profile, from: number, to: number): number[] {
    const times: number[] = []
    for (let day = Math.floor(from / DAY); day * DAY <= to; day++) {
        for (const session of profile.sessions) {
            const start = day * DAY + session.at * HOUR
            for (const at of [start, start + session.minutes * MIN]) if (at > from && at <= to) times.push(at)
        }
    }
    return times.sort((a, b) => a - b)
}

/**
 * The coins `id` would add to the cage, run now with an empty cage, as the
 * player collects at `collects`: each stretch between collects is capped at
 * the cage's capacity, with and without the campaign.
 */
function campaignGain(state: SimState, id: CampaignId, now: number, profile: Profile): number {
    const def = CAMPAIGNS.find(c => c.id === id)!
    const until = now + def.ms
    const room = cageCapacity(state.upgrades.cage)
    // On top of what runs already, judged with the rules the player would run with it.
    const others = (state.campaigns ?? []).filter(c => c.id !== id)
    const withList = [...others, { id, until }]
    const withIt = { ...view(state), campaigns: withList, rules: bestRules(state, now, until, withList) }
    // Against the rules the player would run without it (each side at its own best).
    const without = { ...view(state), rules: bestRules(state, now, until, others) }
    // The cage holds what it gains until the first collect after the campaign ends.
    const stops = collectTimes(profile, now, until + DAY)
    const last = stops.find(at => at >= until) ?? until
    let gain = 0
    let from = now
    for (const at of [...stops.filter(t => t < last), last]) {
        gain += Math.min(room, expectedBetween(withIt, from, at)) - Math.min(room, expectedBetween(without, from, at))
        from = at
    }
    return gain
}

/** The rules that earn the most (expected) from `now` to `until`, with `campaigns` running. */
function bestRules(state: SimState, now: number, until: number, campaigns: readonly RunningCampaignRef[] = state.campaigns ?? []): HouseRules {
    let best = state.rules
    let most = -Infinity
    for (const rules of ruleCombos(state)) {
        const coins = expectedBetween({ ...view(state), campaigns, rules }, now, until)
        if (coins > most + 1e-6) {
            most = coins
            best = rules
        }
    }
    return best
}

/** A special is bought when its expected extra income pays its price back within this many hours. */
const SPECIAL_PAYBACK_H = 10 * 24

function buySpecials(state: SimState, now: number, tally: Tally, day: number) {
    const level = casinoLevel(state).level
    for (const def of DECOR) {
        if (!def.special || def.level > level || state.decor!.some(d => d.type === def.type)) continue
        const without = expectedPerHour(view(state))
        const types = [...placedSpecials(state.decor!), def.type]
        const gain = expectedPerHour({ ...view(state), specials: specialBonus(types) }) - without
        if (!(gain * SPECIAL_PAYBACK_H * RTP >= def.chips) || state.chips < def.chips * 2) continue
        const layout = layoutOf(layoutStateOf(state))
        const at = findSpot(layout, { kind: 'decor', type: def.type }, roomCentre(state.zones.at(-1)!))
        if (!at) continue
        accrue(state, now, tally)
        state.chips -= def.chips
        tally.specials.push({ type: def.type, day: Math.round(now / DAY * 10) / 10, chips: def.chips, gain })
        state.decor!.push({ id: state.decor!.length + 1, type: def.type, x: at.x, y: at.y })
    }
}

interface Result {
    profile: string
    milestones: Record<string, number | null>
    tally: Tally
}

const MILESTONES = ['8 builds', 'main', 'pit', 'lounge', 'crew', 'highlimit', 'penthouse', '50%', '90%', 'max'] as const

function simulate(profile: Profile): Result {
    const rng = seededRng(seed)
    // Missions draw from their own stream, so the bets replay as before.
    const missionRng = seededRng(seed + 1_000)
    const state = newState(0, seedOf(`${profile.name}-${seed}`))
    grantFurniture(state)
    let coins = 0
    let gems = profile.startGems
    const tally: Tally = {
        cage: 0, missions: 0, cageLost: 0, converted: 0, coinsBet: 0, chipsWon: 0, chipsRebet: 0, campaigns: 0, built: 0,
        gemsConverted: 0, gemsSpeed: 0, builds: 0,
        firstSession: { builds: 0, longestMs: 0 },
        buildLog: [],
        chipsByDay: [],
        campaignRuns: Object.fromEntries(CAMPAIGNS.map(c => [c.id, { runs: 0, chips: 0, coins: 0 }])) as Tally['campaignRuns'],
        starDays: CASINO_STARS.map(() => null),
        chipsEndOfDay: [],
        incomeByHour: new Map(),
        incomeByDay: [],
        cageByDay: [],
        ruleHours: new Map(),
        specials: [],
        levelEndOfDay: [],
        levelDays: Array.from({ length: MAX_CASINO_LEVEL }, () => null),
        gameDays: {}
    }
    const milestones: Record<string, number | null> = Object.fromEntries(MILESTONES.map(m => [m, null]))
    let firstSession = true

    const mark = (key: string, now: number) => {
        if (milestones[key] === null) milestones[key] = Math.round(now / DAY * 10) / 10
    }
    const convert = (n: number) => {
        n = Math.floor(n)
        if (n <= 0) return
        gems -= n
        coins += n * COINS_PER_GEM
        tally.converted += n * COINS_PER_GEM
        tally.gemsConverted += n
    }
    const spendGems = (n: number) => {
        gems -= n
        tally.gemsSpeed += n
    }
    // The sim's clock, for the day a star was first held.
    let clock = 0
    const noteStars = () => {
        const level = starLevel(state.chips)
        for (let i = 0; i < level; i++) tally.starDays[i] ??= Math.round(clock / DAY * 10) / 10
    }
    const collect = (day: number) => {
        accrue(state, clock, tally)
        const amount = Math.floor(state.cage.stored)
        // What the campaigns brought since the last collect, shared among those that ran.
        // What each campaign brought since the last collect: the cage less the same cage without it.
        for (const [id, shadow] of Object.entries(state.shadows) as [CampaignId, number][]) tally.campaignRuns[id].coins += state.cage.stored - shadow
        state.shadows = {}
        state.cage.stored -= amount
        coins += amount
        tally.cage += amount
        tally.cageByDay[day] = (tally.cageByDay[day] ?? 0) + amount
        betCoins(day)
    }
    const betCoins = (day: number) => {
        if (coins < 10) return
        const won = gamble(rng, coins)
        tally.coinsBet += coins
        coins = 0
        state.chips += won
        tally.chipsWon += won
        tally.chipsByDay[day] = (tally.chipsByDay[day] ?? 0) + won
        noteStars()
    }

    // The regular converts its starting pile at once: a nice early boost.
    if (profile.gems === 'regular') convert(gems)

    let maxedOn: number | null = null
    for (let day = 0; day < days && (maxedOn === null || day < maxedOn + POST_MAX_DAYS + 1); day++) {
        if (day > 0) gems += profile.gemsPerDay

        if (profile.gems === 'regular') {
            // Save for the second builder, then convert the daily gems.
            if (state.gemBuilder) convert(gems)
        } else if (profile.gems === 'whale') {
            if (!state.gemBuilder && gems >= BUILDER_GEMS) {
                spendGems(BUILDER_GEMS)
                hireGemBuilder(state)
            }
            // Keep a reserve for skips and rushes, convert the rest.
            convert(gems - 120)
        }
        if (profile.gems === 'regular' && !state.gemBuilder && gems >= BUILDER_GEMS) {
            spendGems(BUILDER_GEMS)
            hireGemBuilder(state)
        }

        let missionCoins = 0
        for (const [index, session] of profile.sessions.entries()) {
            const t0 = day * DAY + session.at * HOUR
            if (index === 0 && profile.missions > 0) {
                // The day's missions, priced from the casino as it is now.
                const eligible = MISSIONS.map(m => m.id).filter(id => id !== 'build' || progressOf(state) < 1)
                const picked = pickMissions(missionRng, eligible).slice(0, profile.missions)
                missionCoins = picked.reduce((sum, id) => sum + missionReward(state, findMission(id)!.hours), 0)
                if (picked.length >= 3) missionCoins += missionReward(state, BONUS_HOURS)
            }
            const following = profile.sessions[index + 1] ?? { at: profile.sessions[0]!.at + 24 }
            const nextSessionAt = day * DAY + following.at * HOUR
            advance(state, t0, tally)
            const end = t0 + session.minutes * MIN

            for (let now = t0; now < end; now += STEP_MS) {
                advance(state, now, tally)
                clock = now

                // The day's mission coins, claimed in its last session. On the first
                // day they are claimed as the first session ends: a new player's
                // missions (20 rounds, collect twice, start a build) fit in it.
                const claimNow = day === 0
                    ? index === 0 && now + STEP_MS >= end
                    : index === profile.sessions.length - 1 && now === t0
                if (claimNow && missionCoins > 0) {
                    coins += missionCoins
                    tally.missions += missionCoins
                    missionCoins = 0
                }
                // Collect (and bet) at the start and the end of a session.
                if (now === t0 || now + STEP_MS >= end) collect(day)
                if (now === t0) betCoins(day)

                if (profile.gems === 'whale') {
                    for (const c of state.constructions) {
                        const price = skipGems(c.readyAt - now)
                        if (c.readyAt - now > 30 * MIN && gems >= price + 10) {
                            spendGems(price)
                            c.readyAt = now
                        }
                    }
                    advance(state, now, tally)
                    const rushPrice = rushGems(state)
                    if (now === t0 && (state.rushUntil ?? 0) < now && gems >= rushPrice + 10 && state.zones.includes('pit')) {
                        clock = now
                        spendGems(rushPrice)
                        accrue(state, now, tally)
                        state.rushUntil = now + RUSH_MS
                    }
                }

                // Ad campaigns at the start of a session, several kinds at once: each one
                // not running yet that pays a fifth over its price (on top of what runs,
                // against the cage and the player's collect times) and leaves chips to
                // build, the best first.
                for (; now === t0;) {
                    const best = CAMPAIGNS
                        .filter(c => !activeCampaigns(state, now).some(r => r.id === c.id) && campaignBlocker(state, c.id, now) === null)
                        .map(c => ({ id: c.id, price: campaignCost(state, c.id, now), gain: campaignGain(state, c.id, now, profile) * RTP }))
                        .filter(c => c.gain > c.price * 1.2 && state.chips >= c.price * 2)
                        .sort((a, b) => (b.gain - b.price) - (a.gain - a.price))[0]
                    if (!best) break
                    accrue(state, now, tally)
                    state.chips -= best.price
                    tally.campaigns += best.price
                    tally.campaignRuns[best.id].runs++
                    tally.campaignRuns[best.id].chips += best.price
                    state.campaigns = [...(state.campaigns ?? []).filter(c => c.id !== best.id && c.until > now), { id: best.id, until: now + CAMPAIGNS.find(c => c.id === best.id)!.ms }]
                }

                // Specials: buy one that pays back within SPECIAL_PAYBACK_H and leaves chips to build.
                if (now === t0) buySpecials(state, now, tally, day)

                // House rules: the set that earns the most until the next session
                // (the casual player looks once a day), within the cooldown.
                if (now === t0 && (index === 0 || profile.name !== 'casual') && unlockedRules(state).length) {
                    const pick = bestRules(state, now, nextSessionAt)
                    const ready = state.rulesAt === null || now >= state.rulesAt + RULES_COOLDOWN_MS
                    if (ready && JSON.stringify(pick) !== JSON.stringify(state.rules)) {
                        accrue(state, now, tally)
                        state.rules = pick
                        state.rulesAt = now
                    }
                    const key = `${state.zones.at(-1)} ${ruleKey(state.rules)}`
                    tally.ruleHours.set(key, (tally.ruleHours.get(key) ?? 0) + (nextSessionAt - now) / HOUR)
                }

                // Build: quick steps (done before the session ends) first, then the
                // next zone when affordable; at the session's end, the step that best
                // fills the time until the next session. While a zone is out of reach,
                // save for it (small steps only).
                const last = now + STEP_MS >= end
                for (; maxedOn === null;) {
                    const options = startable(state)
                    // The goal to save for: the Construction Crew once it is open, else the next zone.
                    const zone = options.find(o => o.kind === 'upgrade' && o.id === 'crew') ?? options.find(o => o.kind === 'zone')
                    const budget = zone && zone.cost.chips > state.chips ? zone.cost.chips * 0.25 : Infinity
                    const affordable = options.filter(o => o.cost.chips <= state.chips && (o === zone || o.cost.chips <= budget))
                    const gap = nextSessionAt - now
                    const fits = affordable.filter(o => o.cost.buildMs <= gap).sort((a, b) => b.cost.buildMs - a.cost.buildMs)[0]
                    const option = affordable.find(o => o.cost.buildMs <= end - now - STEP_MS)
                        ?? (zone && zone.cost.chips <= state.chips ? zone : undefined)
                        ?? (last ? fits ?? affordable.sort((a, b) => a.cost.buildMs - b.cost.buildMs)[0] : undefined)
                    if (!option) break
                    state.chips -= option.cost.chips
                    tally.built += option.cost.chips
                    tally.builds++
                    tally.buildLog.push({ day, ms: option.cost.buildMs })
                    if (firstSession) {
                        tally.firstSession.builds++
                        tally.firstSession.longestMs = Math.max(tally.firstSession.longestMs, option.cost.buildMs)
                    }
                    // A new game takes its spot as the server gives it (home, else the nearest free one).
                    if (option.kind === 'game' && levelOf(state, 'game', option.id) === 0) {
                        state.placements![option.id] = newGameSpot(state, option.id)!
                        tally.gameDays[option.id] = Math.round(now / DAY * 10) / 10
                    }
                    const c: Construction = { kind: option.kind, id: option.id, level: levelOf(state, option.kind, option.id) + 1, startedAt: now, readyAt: now + option.cost.buildMs }
                    if (option.cost.buildMs <= 0) {
                        accrue(state, now, tally)
                        apply(state, c)
                    }
                    else state.constructions.push(c)
                }

                const level = casinoLevel(state).level
                for (let l = 0; l < level; l++) tally.levelDays[l] ??= Math.round(now / DAY * 10) / 10
                const progress = progressOf(state)
                if (tally.builds >= 8 && firstSession) milestones['8 builds'] = 0
                else if (tally.builds >= 8) mark('8 builds', now)
                for (const zone of ['main', 'pit', 'lounge', 'highlimit', 'penthouse']) if (state.zones.includes(zone as never)) mark(zone, now)
                if (state.upgrades.crew >= 1) mark('crew', now)
                if (progress >= 0.5) mark('50%', now)
                if (progress >= 0.9) mark('90%', now)
                if (progress >= 1 && maxedOn === null) {
                    mark('max', now)
                    maxedOn = day
                }
                // Nothing left to build: the session is collect, bet, campaign.
                if (maxedOn !== null && !last && now > t0) now = end - 2 * STEP_MS
            }

            // Spare chips bet again for more chips.
            const next = Math.max(0, ...startable(state).map(o => o.cost.chips))
            const spare = state.chips - 2 * next
            if (profile.betSpare > 0 && spare > 100) {
                const bet = Math.floor(spare * profile.betSpare)
                state.chips += gamble(rng, bet) - bet
                tally.chipsRebet += bet
            }
            noteStars()
            firstSession = false
        }
        tally.chipsEndOfDay[day] = state.chips
        tally.levelEndOfDay[day] = casinoLevel(state).level
    }
    accrue(state, clock, tally)
    return { profile: profile.name, milestones, tally }
}

function ruleKey(rules: HouseRules): string {
    return [rules.door !== 'open' ? `door:${rules.door}` : '', rules.vip ? 'vip' : ''].filter(Boolean).join('+') || 'none'
}

const results = PROFILES.map(simulate)

const pad = (s: string | number, n: number) => String(s).padStart(n)
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const fmtShort = (n: number) => n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`

console.log(`My Casino (economy v2), ${days} days max, seed ${seed}. Day of each milestone (0 = first day):\n`)
console.log(`${'profile'.padEnd(9)}${MILESTONES.map(m => pad(m, 10)).join('')}`)
for (const r of results) {
    console.log(`${r.profile.padEnd(9)}${MILESTONES.map(m => pad(r.milestones[m] ?? '-', 10)).join('')}`)
}

console.log('\nCasino level (day each level was first reached):')
for (let from = 0; from < MAX_CASINO_LEVEL; from += 15) {
    console.log(`${'level'.padEnd(9)}${Array.from({ length: 15 }, (_, i) => pad(from + i + 1, 6)).join('')}`)
    for (const r of results) console.log(`${r.profile.padEnd(9)}${r.tally.levelDays.slice(from, from + 15).map(d => pad(d ?? '-', 6)).join('')}`)
}
console.log('Games: unlock level, and the day each profile first built it (old room in brackets):')
for (const game of TYCOON_GAMES.filter(g => !g.starter)) {
    console.log(`  ${game.slug.padEnd(17)} L${pad(gameUnlockLevel(game.slug), 2)} (${game.zone.padEnd(9)}) ${results.map(r => `${r.profile} ${pad(r.tally.gameDays[game.slug] ?? '-', 5)}`).join('  ')}`)
}
console.log('Specials bought (day, chips, expected coins/h added):')
for (const r of results) console.log(`${r.profile.padEnd(9)}${r.tally.specials.map(b => `${b.type} d${b.day} ${fmtShort(b.chips)} +${fmt(b.gain)}/h`).join(' | ') || '-'}`)

console.log(`\nStars (day each level was first held; play goes on ${POST_MAX_DAYS} days after max):`)
console.log(`${'profile'.padEnd(9)}${CASINO_STARS.map((star, i) => pad(`${i + 1}:${fmtShort(star.threshold)}`, 9)).join('')}${pad('at max', 8)}${pad('max+7', 8)}${pad('max+14', 8)}${pad('max+21', 8)}`)
for (const r of results) {
    const t = r.tally
    const at = (offset: number) => {
        const max = r.milestones.max
        const day = max === null || max === undefined ? null : Math.floor(max) + offset
        const chips = day === null ? undefined : t.chipsEndOfDay[day]
        return chips === undefined ? '-' : `${starLevel(chips)}`
    }
    console.log(`${r.profile.padEnd(9)}${t.starDays.map(d => pad(d ?? '-', 9)).join('')}${pad(at(0), 8)}${pad(at(7), 8)}${pad(at(14), 8)}${pad(at(21), 8)}`)
}
console.log('End-of-day chips (every 3rd day):')
for (const r of results) {
    console.log(`${r.profile.padEnd(9)}${r.tally.chipsEndOfDay.filter((_, d) => d % 3 === 0).map(c => pad(fmtShort(c), 6)).join('')}`)
}

console.log('\nAd campaigns (whole run): runs, chips paid, extra coins in the cage, net = extra × RTP - chips:')
for (const r of results) {
    const parts = CAMPAIGNS.map((c) => {
        const run = r.tally.campaignRuns[c.id]
        return `${c.id} ${pad(run.runs, 3)}× ${pad(fmt(run.chips), 9)} → ${pad(fmt(run.coins), 9)} (net ${pad(fmt(run.coins * RTP - run.chips), 8)})`
    })
    console.log(`${r.profile.padEnd(9)}${parts.join(' | ')}`)
}

// The stages the tables below read: every zone open up to one, its games at
// level 1, 3 or 5, the upgrades as far as that zone allows.
const often: Profile = { ...PROFILES[0]!, sessions: Array.from({ length: 12 }, (_, i) => ({ at: i * 2, minutes: 0 })) }
/** Levels of an upgrade the open zones allow. */
function upgradeCap(id: UpgradeId, open: readonly string[]): number {
    const def = UPGRADES.find(u => u.id === id)!
    let level = 0
    while (level < def.levels.length && (def.requiresZone[level] === null || open.includes(def.requiresZone[level]!))) level++
    return level
}
/** A casino with the zones up to `zi` open, every game there at `level`, Hospitality as far as the zones allow, Cage and Marketing at the zone's index, and every richer-guests special its casino level unlocks placed. */
function stageState(zi: number, level: number): SimState {
    const open = ZONES.slice(0, zi + 1).map(z => z.id)
    const upgrade = Math.min(5, zi)
    const state: SimState = {
        ...newState(0, seedOf(`stage-${seed}`)),
        zones: open,
        games: Object.fromEntries(TYCOON_GAMES.filter(g => open.includes(g.zone)).map(g => [g.slug, level])),
        upgrades: { cage: upgrade, marketing: upgrade, hospitality: upgradeCap('hospitality', open), crew: 0 }
    }
    const reached = casinoLevel(state).level
    state.decor = DECOR.filter(d => d.special?.stat === 'prestige' && d.level <= reached).map((d, i) => ({ id: i + 1, type: d.type, x: 0, y: 0 }))
    return state
}
const STAGES = ZONES.flatMap((zone, zi) => [1, 3, 5].map(level => ({ name: `${zone.id} L${level}`, state: stageState(zi, level) })))
const withAds = (stage: SimState, ids: CampaignId[]) => ({ ...view(stage), campaigns: ids.filter(id => !campaignBlocker(stage, id, 0)).map(id => ({ id, until: 1e15 })) })
const seated = (v: FloorView, at?: number) => {
    const f = expectedFloor(v, at)
    return seatedTotal(f.visitors) / Math.max(1, f.seats)
}

// How full the floor is: idle, with each ad on its own, with every ad it can run, and under each house rule.
console.log('\nFloor fill by stage (expected share of seats taken; ads at the stage\'s Marketing level):')
console.log(`${'stage'.padEnd(13)}${['idle', ...CAMPAIGNS.map(c => c.id), 'all ads', 'limit T', 'no T', 'VIP'].map(h => pad(h, 9)).join('')}`)
for (const { name, state: stage } of STAGES) {
    const open = unlockedRules(stage)
    const cells = [
        seated(view(stage)),
        ...CAMPAIGNS.map(c => (campaignBlocker(stage, c.id, 0) ? NaN : seated(withAds(stage, [c.id]), 0))),
        seated(withAds(stage, CAMPAIGNS.map(c => c.id)), 0),
        open.includes('door') ? seated({ ...view(stage), rules: { ...DEFAULT_RULES, door: 'limit' } }) : NaN,
        open.includes('door') ? seated({ ...view(stage), rules: { ...DEFAULT_RULES, door: 'closed' } }) : NaN,
        open.includes('vip') ? seated({ ...view(stage), rules: { ...DEFAULT_RULES, vip: true } }) : NaN
    ]
    console.log(`${name.padEnd(13)}${cells.map(c => pad(Number.isNaN(c) ? '-' : `${Math.round(c * 100)}%`, 9)).join('')}`)
}

// What one campaign nets at each stage, run on its own with an empty cage at 8:00 by a
// player who collects every 2 hours (no cage loss) or on the casual's schedule.
console.log('\nAd return by stage (coins back × RTP ÷ chips paid; collect every 2 h / casual schedule) and the better kind of ad:')
for (const { name, state: stage } of STAGES) {
    const at = 8 * HOUR
    const ret: Record<string, number> = {}
    const cells = CAMPAIGNS.map((c) => {
        if (campaignBlocker(stage, c.id, at)) return pad('-', 16)
        const price = campaignCost(stage, c.id, at)
        const back = (p: Profile) => campaignGain(stage, c.id, at, p) * RTP / price
        ret[c.id] = back(often)
        return pad(`${back(often).toFixed(2)} / ${back(PROFILES[0]!).toFixed(2)}`, 16)
    })
    const best = (goal: string) => Math.max(0, ...CAMPAIGNS.filter(c => c.goal === goal && ret[c.id] !== undefined).map(c => ret[c.id]!))
    const verdict = best('wealth') > best('guests') ? 'wealth' : best('guests') >= 1 ? 'guests' : 'none pays'
    console.log(`${name.padEnd(13)}${CAMPAIGNS.map((c, i) => `${c.id} ${cells[i]}`).join(' ')}  → ${verdict}`)
}

// Payback of single steps: chips ÷ the expected coins an hour they add (at the stage they are bought in).
console.log('\nPayback (chips ÷ expected coins an hour gained), hours:')
const payback = (label: string, stage: SimState, kind: BuildKind, id: string) => {
    const level = levelOf(stage, kind, id)
    const cost = nextCost(stage, kind, id)
    if (!cost) return
    const after: SimState = kind === 'zone'
        ? { ...stage, zones: [...stage.zones, id as never] }
        : kind === 'game' ? { ...stage, games: { ...stage.games, [id]: level + 1 } } : { ...stage, upgrades: { ...stage.upgrades, [id]: level + 1 } }
    const gain = expectedPerHour(view(after)) - expectedPerHour(view(stage))
    console.log(`  ${label.padEnd(34)} ${pad(fmt(cost.chips), 8)} chips  +${pad(fmt(gain), 5)}/h  ${gain > 0 ? pad(fmt(cost.chips / gain), 6) : '     -'} h`)
}
{
    const at = (zi: number, level: number, tweak: (s: SimState) => void = () => {}) => {
        const s = stageState(zi, level)
        tweak(s)
        return s
    }
    payback('early: Limbo (backroom)', at(0, 1, s => delete s.games.limbo), 'game', 'limbo')
    payback('early: Roulette (main)', at(1, 1, s => delete s.games.roulette), 'game', 'roulette')
    payback('early: Hospitality 1 (main)', at(1, 2, s => (s.upgrades.hospitality = 0)), 'upgrade', 'hospitality')
    payback('early: Marketing 1→2 (main)', at(1, 2, s => (s.upgrades.marketing = 1)), 'upgrade', 'marketing')
    payback('mid: Blackjack 3→4 (pit)', at(2, 3), 'game', 'blackjack')
    payback('mid: Hospitality 3→4 (lounge)', at(3, 3, s => (s.upgrades.hospitality = 3)), 'upgrade', 'hospitality')
    payback('mid: Xenoslot 3→4 (lounge)', at(3, 3), 'game', 'xenoslot')
    payback('late: Hospitality 5→6 (high limit)', at(4, 4, s => (s.upgrades.hospitality = 5)), 'upgrade', 'hospitality')
    payback('late: Marketing 4→5 (high limit)', at(4, 4), 'upgrade', 'marketing')
    payback('late: Baccarat 4→5 (high limit)', at(4, 4), 'game', 'baccarat')
    payback('max: Hospitality 7→8 (penthouse)', at(5, 5, s => (s.upgrades.hospitality = 7)), 'upgrade', 'hospitality')
    payback('max: Mines 4→5 (penthouse)', at(5, 4), 'game', 'mines')
    payback('zone: Slot Lounge', at(2, 5), 'zone', 'lounge')
    payback('zone: Penthouse', at(4, 5), 'zone', 'penthouse')
}

console.log('\nFirst session and build times:')
for (const r of results) {
    const t = r.tally
    const byWeek = [0, 1, 2, 3].map(w => {
        const builds = t.buildLog.filter(b => b.day >= w * 7 && b.day < (w + 1) * 7)
        const median = builds.map(b => b.ms).sort((a, b) => a - b)[Math.floor(builds.length / 2)] ?? 0
        return `wk${w + 1} ${pad(builds.length, 3)} builds, median ${pad((median / MIN).toFixed(0), 4)} min`
    })
    console.log(`${r.profile.padEnd(9)} first session ${t.firstSession.builds} builds (longest ${(t.firstSession.longestMs / 1000).toFixed(0)} s); ${byWeek.join(' | ')}`)
}

console.log('\nCoins claimed and chips (whole run):')
console.log(`${'profile'.padEnd(9)}${['cage', 'missions', 'cage lost', 'converted', 'coins bet', 'chips won', 'chips rebet', 'campaigns', 'built', 'gems conv', 'gems speed'].map(h => pad(h, 12)).join('')}`)
for (const r of results) {
    const t = r.tally
    console.log(`${r.profile.padEnd(9)}${[t.cage, t.missions, t.cageLost, t.converted, t.coinsBet, t.chipsWon, t.chipsRebet, t.campaigns, t.built, t.gemsConverted, t.gemsSpeed].map(v => pad(fmt(v), 12)).join('')}`)
    const claimed = t.cage + t.missions + t.converted
    if (t.chipsWon > claimed * 1.05) console.log(`  !! ${r.profile}: won well over the coins claimed (luck, or a leak)`)
}

const catalog = CANDIDATES.reduce((sum, c) => {
    if (c.kind === 'zone') return sum + ZONES.find(z => z.id === c.id)!.cost.chips
    if (c.kind === 'game') return sum + TYCOON_GAMES.find(g => g.slug === c.id)!.levels.reduce((s, l) => s + l.chips, 0)
    return sum + UPGRADES.find(u => u.id === c.id)!.levels.reduce((s, l) => s + l.chips, 0)
}, 0)
const catalogMs = CANDIDATES.reduce((sum, c) => {
    if (c.kind === 'zone') return sum + ZONES.find(z => z.id === c.id)!.cost.buildMs
    if (c.kind === 'game') return sum + TYCOON_GAMES.find(g => g.slug === c.id)!.levels.reduce((s, l) => s + l.buildMs, 0)
    return sum + UPGRADES.find(u => u.id === c.id)!.levels.reduce((s, l) => s + l.buildMs, 0)
}, 0)
const maxed = {
    ...newState(0),
    zones: ZONES.map(z => z.id),
    games: Object.fromEntries(TYCOON_GAMES.map(g => [g.slug, 5])),
    upgrades: { cage: 5, marketing: 5, hospitality: 8, crew: 1 }
}
const allSpecials = DECOR.filter(d => d.special).map((d, i) => ({ id: i + 1, type: d.type, x: 0, y: 0 }))
const maxedSpecials = { ...maxed, decor: allSpecials }
const allAds = CAMPAIGNS.map(c => ({ id: c.id, until: 1e15 }))
const bestAt = (v: FloorView, at?: number) => Math.max(...ruleCombos(v).map(rules => expectedPerHour({ ...v, rules }, at)))
console.log(`\nCatalog: ${fmt(catalog)} chips, ${(catalogMs / HOUR).toFixed(0)} build hours.`)
console.log(`Specials at max (best rules): every special placed ${fmt(bestAt(view(maxedSpecials)) * 24)} coins/day (+${((bestAt(view(maxedSpecials)) / bestAt(view(maxed)) - 1) * 100).toFixed(1)}%), with every ad +${((bestAt({ ...view(maxedSpecials), campaigns: allAds }, 0) / bestAt({ ...view(maxed), campaigns: allAds }, 0) - 1) * 100).toFixed(1)}%; the richer-guests ones alone +${((bestAt({ ...view(maxed), specials: specialBonus(DECOR.filter(d => d.special?.stat === 'prestige').map(d => d.type)) }) / bestAt(view(maxed)) - 1) * 100).toFixed(1)}%; a rush with them all owned ${rushGems(maxedSpecials)} gems (${fmt(rushExtraCoins(maxedSpecials) / rushGems(maxedSpecials))} coins a gem), without ${rushGems(maxed)}.`)
console.log(`Guest income at max: ${fmt(expectedPerHour(view(maxed)) * 24)} coins/day expected without a campaign (default rules; best rules ${fmt(Math.max(...ruleCombos(maxed).map(rules => expectedPerHour({ ...view(maxed), rules }))) * 24)}), ${fmt(fullIncomePerHour(maxed) * 24)} with every seat full (cage holds ${fmt(cageCapacity(5))}).`)

// The floor's luck at each stage: 30 days at a fixed build, default rules, no campaign.
console.log(`\nLuck by stage (30 days, default rules, no campaign): expected/h, daily ±sd and min..max of the mean, hourly p10/p50/p90, Whale visits a day (average stay, coins each); seated ${VISITOR_TIERS.map(t => t.name).join('/')}:`)
const pct = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.floor(q * (values.length - 1))]!
for (const { name, state: stage } of STAGES.filter((_, i) => i % 3 !== 1)) {
    const daily: number[] = []
    const hourly: number[] = []
    const visits: { ms: number, spent: number }[] = []
    const t0 = 1_000 * DAY
    for (let d = 0; d < 30; d++) {
        let total = 0
        for (let h = 0; h < 24; h++) {
            const at = t0 + d * DAY + h * HOUR
            const run = runFloor(view(stage), stage.seed, at, at + HOUR)
            hourly.push(run.income)
            total += run.income
        }
        daily.push(total)
    }
    for (const guest of runFloor(view(stage), stage.seed, t0, t0 + 30 * DAY, { notable: true }).notable) visits.push({ ms: (guest.until ?? guest.at) - guest.at, spent: guest.spent })
    const whales = visits.length
    const stay = visits.length ? visits.reduce((a, v) => a + v.ms, 0) / visits.length / HOUR : 0
    const each = visits.length ? visits.reduce((a, v) => a + v.spent, 0) / visits.length : 0
    const mean = daily.reduce((a, b) => a + b, 0) / daily.length
    const sd = Math.sqrt(daily.reduce((a, b) => a + (b - mean) ** 2, 0) / daily.length)
    const floor = expectedFloor(view(stage))
    const odds = Object.values(floor.visitors).map(v => v / Math.max(1e-9, Object.values(floor.visitors).reduce((a, b) => a + b, 0)))
    console.log(`${name.padEnd(13)} ${pad(fmt(expectedPerHour(view(stage))), 6)}/h  ±${(sd / mean * 100).toFixed(1)}% ${(Math.min(...daily) / mean).toFixed(2)}..${(Math.max(...daily) / mean).toFixed(2)}  hour ${fmt(pct(hourly, 0.1))}/${fmt(pct(hourly, 0.5))}/${fmt(pct(hourly, 0.9))}  whales ${(whales / 30).toFixed(1)}/day (${stay.toFixed(1)} h, ${fmt(each)})  seated ${odds.map(o => `${Math.round(o * 100)}`).join('/')}%`)
}

// Each house rule against the default rules, by stage: idle / Flyers / every ad the stage
// can run. Every option should lose somewhere.
console.log('\nHouse rules by stage (expected change vs the default rules, %: idle / Flyers / all ads):')
console.log(`${'stage'.padEnd(13)}${['limit Tourists', 'no Tourists', 'VIP room'].map(h => h.padEnd(20)).join('')}best idle / best with all ads`)
for (const { name, state: stage } of STAGES) {
    const open = unlockedRules(stage)
    const views = [view(stage), withAds(stage, ['flyers']), withAds(stage, CAMPAIGNS.map(c => c.id))]
    const cell = (rules: Partial<HouseRules>, rule: keyof HouseRules) => !open.includes(rule)
        ? '-'
        : views.map(v => `${Math.round((expectedPerHour({ ...v, rules: { ...DEFAULT_RULES, ...rules } }, 0) / expectedPerHour({ ...v, rules: DEFAULT_RULES }, 0) - 1) * 100)}`).join(' / ')
    const best = (v: FloorView) => ruleKey(ruleCombos(stage).map(rules => ({ rules, coins: expectedPerHour({ ...v, rules }, 0) })).sort((a, b) => b.coins - a.coins)[0]!.rules)
    console.log(`${name.padEnd(13)}${[cell({ door: 'limit' }, 'door'), cell({ door: 'closed' }, 'door'), cell({ vip: true }, 'vip')].map(c => c.padEnd(20)).join('')}${best(views[0]!)} / ${best(views[2]!)}`)
}

console.log('\nRules the players ran (hours, by the newest zone open):')
for (const r of results) {
    const rows = [...r.tally.ruleHours.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    console.log(`${r.profile.padEnd(9)}${rows.map(([key, hours]) => `${key} ${fmt(hours)}h`).join(' | ')}`)
}

console.log('\nGuest income (before the cage cap) / coins collected, by day (first 14 days):')
for (const r of results) {
    console.log(`${r.profile.padEnd(9)}${r.tally.incomeByDay.slice(0, 14).map(v => pad(fmtShort(v), 7)).join('')}`)
    console.log(`${''.padEnd(9)}${r.tally.cageByDay.slice(0, 14).map(v => pad(fmtShort(v ?? 0), 7)).join('')}`)
}

// Gems against progress.
const regular = results.find(r => r.profile === 'regular')!
const midDays = regular.tally.chipsByDay.slice(5, 12)
const midPerDay = midDays.reduce((a, b) => a + b, 0) / Math.max(1, midDays.length)
const gemChips = (gems: number) => gems * COINS_PER_GEM * RTP
console.log('\nGems against progress (converted at 1 gem = 1,000 coins, then won at RTP):')
console.log(`  starting 50 gems ≈ ${fmt(gemChips(50))} chips = ${(gemChips(50) / catalog * 100).toFixed(1)}% of the catalog`)
console.log(`  a day's 10 gems ≈ ${fmt(gemChips(10))} chips = ${(gemChips(10) / midPerDay * 100).toFixed(0)}% of a regular's mid-game day (days 5-11: ${fmt(midPerDay)} chips won a day)`)
console.log(`  skips: 10 min ${skipGems(10 * MIN)}, 1 h ${skipGems(HOUR)}, 4 h ${skipGems(4 * HOUR)}, 8 h ${skipGems(8 * HOUR)}, 12 h ${skipGems(12 * HOUR)} gems; builder ${BUILDER_GEMS}, rush ${RUSH_GEMS}-${RUSH_MAX_GEMS} (from the casino)`)
