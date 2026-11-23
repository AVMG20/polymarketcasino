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
import { seededRng, type Rng } from '../shared/rng'
import { COINS_PER_GEM } from '../shared/economy'
import { CASINO_STARS, starLevel } from '../shared/stars'
import { BONUS_HOURS, findMission, MISSIONS, missionReward, pickMissions } from '../shared/missions'
import {
    activeCampaign,
    BUILDER_GEMS,
    builderCount,
    campaignBlocker,
    campaignCost,
    CAMPAIGNS,
    type CampaignId,
    buildBlocker,
    cageCapacity,
    guestChipsBetween,
    guestsPerHour,
    fullIncomePerHour,
    nextCost,
    occupancy,
    progressOf,
    RUSH_GEMS,
    RUSH_MAX_GEMS,
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
    type UpgradeId
} from '../shared/tycoon'

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
    /** The same cage without any campaign: what the campaigns brought shows at each collect. */
    shadow: number
    /** The campaign whose coins sit in the cage since the last collect. */
    campaignTag: CampaignId | null
}

function newState(now: number): SimState {
    return {
        serverNow: now,
        chips: 0,
        zones: ['backroom'],
        games: Object.fromEntries(TYCOON_GAMES.filter(g => g.starter).map(g => [g.slug, 1])),
        upgrades: { cage: 0, marketing: 0, decor: 0, crew: 0 },
        constructions: [],
        builders: 1,
        gemBuilder: false,
        cage: { stored: STARTER_CAGE, capacity: cageCapacity(0), perHour: 0 },
        rushUntil: null,
        campaign: null,
        golden: [],
        progress: 0,
        gemsEnabled: true,
        cageAt: now,
        shadow: STARTER_CAGE,
        campaignTag: null
    }
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
}

function accrue(state: SimState, to: number, tally: Tally) {
    if (to <= state.cageAt) return
    const capacity = cageCapacity(state.upgrades.cage)
    const gained = guestChipsBetween(state, state.cageAt, to)
    const before = state.cage.stored
    state.cage.stored = Math.max(before, Math.min(capacity, before + gained))
    tally.cageLost += gained - (state.cage.stored - before)
    const plain = guestChipsBetween({ ...state, campaign: null }, state.cageAt, to)
    state.shadow = Math.max(state.shadow, Math.min(capacity, state.shadow + plain))
    if (activeCampaign(state, state.cageAt)) state.campaignTag = state.campaign!.id
    state.cageAt = to
}

function apply(state: SimState, c: Construction) {
    if (c.kind === 'zone') state.zones.push(c.id as never)
    else if (c.kind === 'game') state.games[c.id] = c.level
    else state.upgrades[c.id as UpgradeId] = c.level
    state.builders = builderCount(state.upgrades, !!state.gemBuilder)
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
    accrue(state, to, tally)
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
    const withIt = { ...state, campaign: { id, until } }
    const without = { ...state, campaign: null }
    // The cage holds what it gains until the first collect after the campaign ends.
    const stops = collectTimes(profile, now, until + DAY)
    const last = stops.find(at => at >= until) ?? until
    let gain = 0
    let from = now
    for (const at of [...stops.filter(t => t < last), last]) {
        gain += Math.min(room, guestChipsBetween(withIt, from, at)) - Math.min(room, guestChipsBetween(without, from, at))
        from = at
    }
    return gain
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
    const state = newState(0)
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
        chipsEndOfDay: []
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
        const amount = Math.floor(state.cage.stored)
        if (state.campaignTag) tally.campaignRuns[state.campaignTag].coins += state.cage.stored - state.shadow
        state.campaignTag = null
        state.cage.stored -= amount
        state.shadow = state.cage.stored
        coins += amount
        tally.cage += amount
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
                        spendGems(rushPrice)
                        accrue(state, now, tally)
                        state.rushUntil = now + RUSH_MS
                    }
                }

                // An ad campaign at the start of a session when none runs: the one
                // that pays best against the cage and the player's collect times,
                // when it pays a fifth over its price and leaves chips to build.
                if (now === t0 && activeCampaign(state, now) === null) {
                    const best = CAMPAIGNS
                        .filter(c => campaignBlocker(state, c.id, now) === null)
                        .map(c => ({ id: c.id, price: campaignCost(state, c.id, now), gain: campaignGain(state, c.id, now, profile) * RTP }))
                        .filter(c => c.gain > c.price * 1.2 && state.chips >= c.price * 2)
                        .sort((a, b) => (b.gain - b.price) - (a.gain - a.price))[0]
                    if (best) {
                        accrue(state, now, tally)
                        state.chips -= best.price
                        tally.campaigns += best.price
                        tally.campaignRuns[best.id].runs++
                        tally.campaignRuns[best.id].chips += best.price
                        state.campaign = { id: best.id, until: now + CAMPAIGNS.find(c => c.id === best.id)!.ms }
                    }
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
                    const c: Construction = { kind: option.kind, id: option.id, level: levelOf(state, option.kind, option.id) + 1, startedAt: now, readyAt: now + option.cost.buildMs }
                    if (option.cost.buildMs <= 0) apply(state, c)
                    else state.constructions.push(c)
                }

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
    }
    return { profile: profile.name, milestones, tally }
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

// What one campaign nets at each stage, run with an empty cage at 8:00 by a
// player who collects every 2 hours (no cage loss) or on the casual's schedule.
console.log('\nCampaign net by stage (% of its price; collect every 2 h / casual schedule; at the Marketing level of the stage):')
const often: Profile = { ...PROFILES[0]!, sessions: Array.from({ length: 12 }, (_, i) => ({ at: i * 2, minutes: 0 })) }
for (const [zi, zone] of ZONES.entries()) {
    for (const level of [1, 3, 5]) {
        const open = ZONES.slice(0, zi + 1).map(z => z.id)
        const upgrade = Math.min(5, zi)
        const stage: SimState = {
            ...newState(0),
            zones: open,
            games: Object.fromEntries(TYCOON_GAMES.filter(g => open.includes(g.zone)).map(g => [g.slug, level])),
            upgrades: { cage: upgrade, marketing: upgrade, decor: upgrade, crew: 0 }
        }
        const at = 8 * HOUR
        const cells = CAMPAIGNS.map((c) => {
            if (campaignBlocker(stage, c.id, at)) return pad('-', 17)
            const price = campaignCost(stage, c.id, at)
            const net = (p: Profile) => `${Math.round((campaignGain(stage, c.id, at, p) * RTP / price - 1) * 100)}%`
            return pad(`${net(often)} / ${net(PROFILES[0]!)}`, 17)
        })
        console.log(`${`${zone.id} L${level}`.padEnd(13)} occupancy ${pad(Math.round(occupancy(stage, at) * 100), 3)}%  ${CAMPAIGNS.map((c, i) => `${c.id} ${cells[i]}`).join('  ')}`)
    }
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
    upgrades: { cage: 5, marketing: 5, decor: 5, crew: 1 }
}
console.log(`\nCatalog: ${fmt(catalog)} chips, ${(catalogMs / HOUR).toFixed(0)} build hours.`)
console.log(`Guest income at max: ${fmt(guestsPerHour(maxed, 0) * 24)} coins/day without a campaign, ${fmt(fullIncomePerHour(maxed) * 24)} with every seat full (cage holds ${fmt(cageCapacity(5))}).`)

// Gems against progress.
const regular = results.find(r => r.profile === 'regular')!
const midDays = regular.tally.chipsByDay.slice(5, 12)
const midPerDay = midDays.reduce((a, b) => a + b, 0) / Math.max(1, midDays.length)
const gemChips = (gems: number) => gems * COINS_PER_GEM * RTP
console.log('\nGems against progress (converted at 1 gem = 1,000 coins, then won at RTP):')
console.log(`  starting 50 gems ≈ ${fmt(gemChips(50))} chips = ${(gemChips(50) / catalog * 100).toFixed(1)}% of the catalog`)
console.log(`  a day's 10 gems ≈ ${fmt(gemChips(10))} chips = ${(gemChips(10) / midPerDay * 100).toFixed(0)}% of a regular's mid-game day (days 5-11: ${fmt(midPerDay)} chips won a day)`)
console.log(`  skips: 10 min ${skipGems(10 * MIN)}, 1 h ${skipGems(HOUR)}, 4 h ${skipGems(4 * HOUR)}, 8 h ${skipGems(8 * HOUR)}, 12 h ${skipGems(12 * HOUR)} gems; builder ${BUILDER_GEMS}, rush ${RUSH_GEMS}-${RUSH_MAX_GEMS} (from the casino)`)
