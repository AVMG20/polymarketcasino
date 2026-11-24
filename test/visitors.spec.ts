import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../server/database'
import { casinoHistory, casinoProfiles } from '../server/database/schema'
import { getCasinoVisit } from '../server/utils/social'
import {
    collectCage, getHistory, getTycoonState, HISTORY_KEEP_MS, luckSeed, parseHistoryRange, parseRulesBody, setHouseRules, startBuild
} from '../server/utils/tycoon'
import { casinoLevel } from '../shared/casino-level'
import { DECOR, specialBonus } from '../shared/decor'
import { normalizeCoins } from '../shared/money'
import { CAMPAIGNS, campaignBlocker, campaignCost, cageCapacity, findUpgrade, floorView, MAX_LEVEL, TYCOON_GAMES, UPGRADES, ZONES, type CampaignId, type RunningCampaignRef, type UpgradeId, type ZoneId } from '../shared/tycoon'
import {
    campaignGain, DEFAULT_RULES, DOOR_RULES, expectedFloor, expectedPerHour, floorNow, houseState, prestige, richerLevel, rollAt, ruleCombos, rulesOf, RULES_COOLDOWN_MS, runFloor,
    seedOf, TICK_MS, tickOf, tierOdds, tierShift, unlockedRules, VISITOR_MODEL, VISITOR_TIER_IDS, VISITOR_TIERS, type FloorView, type HouseRules
} from '../shared/visitors'
import { giveChips, seedPlayer } from './setup/players'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** A fixed moment on an hour boundary, so tests don't depend on the clock. */
const T0 = 20_000 * DAY

const ALL_RULES: HouseRules[] = DOOR_RULES.flatMap(door => [false, true].map(vip => ({ door, vip })))

/** Levels of an upgrade the open zones allow, at most `cap`. */
function allowed(id: UpgradeId, open: readonly string[], cap: number): number {
    const def = findUpgrade(id)!
    let level = 0
    while (level < Math.min(cap, def.levels.length) && (def.requiresZone[level] === null || open.includes(def.requiresZone[level]!))) level++
    return level
}

/**
 * A casino with the zones up to `zone` open, every game there at `level`, Cage and Marketing at `upgrades`,
 * Hospitality as far as the zones allow (at most `upgrades` × 2), and with `upgrades` the richer-guests specials
 * its casino level unlocks standing on the floor.
 */
function stage(zone: ZoneId, level: number, upgrades = 0, rules: HouseRules = DEFAULT_RULES): FloorView {
    const open = ZONES.slice(0, ZONES.findIndex(z => z.id === zone) + 1).map(z => z.id)
    const games = Object.fromEntries(TYCOON_GAMES.filter(g => open.includes(g.zone)).map(g => [g.slug, level]))
    const built = { cage: upgrades, marketing: upgrades, hospitality: allowed('hospitality', open, upgrades * 2), crew: 0 }
    const reached = casinoLevel({ zones: open, games, upgrades: built }).level
    return {
        zones: open,
        games,
        upgrades: built,
        rushUntil: null,
        campaign: null,
        rules,
        specials: specialBonus(upgrades ? DECOR.filter(d => d.special?.stat === 'prestige' && d.level <= reached).map(d => d.type) : [])
    }
}

const STAGES = ZONES.flatMap(zone => [1, 3, 5].flatMap(level => [0, 3, 5].map(upgrades => ({ name: `${zone.id} L${level} U${upgrades}`, view: stage(zone.id, level, upgrades) }))))
    // The same casinos with every special standing on the floor (shared/decor.ts).
    .flatMap(entry => [entry, { name: `${entry.name} specials`, view: { ...entry.view, specials: specialBonus(DECOR.filter(d => d.special).map(d => d.type)) } }])

/** Every single build step from `view`: the next zone, a game level, an upgrade level (as the zones allow). */
function buildSteps(view: FloorView): { name: string, view: FloorView }[] {
    const zones = view.zones!
    const steps: { name: string, view: FloorView }[] = []
    const next = ZONES[zones.length]
    if (next) steps.push({ name: `zone ${next.id}`, view: { ...view, zones: [...zones, next.id] } })
    for (const game of TYCOON_GAMES) {
        const level = view.games[game.slug] ?? 0
        // Games unlock by casino level, not by room: any of them can be built in any owned room.
        if (level < MAX_LEVEL) steps.push({ name: `${game.slug} ${level + 1}`, view: { ...view, games: { ...view.games, [game.slug]: level + 1 } } })
    }
    for (const def of UPGRADES) {
        const level = view.upgrades[def.id] ?? 0
        const needs = def.requiresZone[level]
        if (level < def.levels.length && (!needs || zones.includes(needs))) steps.push({ name: `${def.id} ${level + 1}`, view: { ...view, upgrades: { ...view.upgrades, [def.id]: level + 1 } } })
    }
    return steps
}

describe('visitor model', () => {
    it('opens tiers with their zones: a new casino sees only Tourists, Regulars come with the Main Floor', () => {
        expect(VISITOR_TIERS.map(t => t.id)).toEqual(VISITOR_TIER_IDS)
        for (let i = 1; i < VISITOR_TIERS.length; i++) expect(VISITOR_TIERS[i]!.spend).toBeGreaterThan(VISITOR_TIERS[i - 1]!.spend)
        const fresh = { games: { plinko: 1, spinata: 1 }, upgrades: {}, zones: ['backroom'] }
        expect(tierOdds(fresh)).toEqual({ tourist: 1, regular: 0, highroller: 0, whale: 0 })
        expect(unlockedRules(fresh)).toEqual([])
        expect(tierOdds(stage('main', 1)).regular).toBeGreaterThan(0)
        expect(tierOdds(stage('main', 1)).highroller).toBe(0)
        expect(tierOdds(stage('pit', 1)).highroller).toBeGreaterThan(0)
        expect(tierOdds(stage('lounge', 5)).whale).toBe(0)
        expect(tierOdds(stage('highlimit', 1)).whale).toBeGreaterThan(0)
        for (const { view } of STAGES) {
            const odds = tierOdds(view)
            expect(VISITOR_TIER_IDS.reduce((sum, id) => sum + odds[id], 0)).toBeCloseTo(1, 9)
        }
        // Decor and levels make guests richer.
        expect(prestige(stage('pit', 3, 3))).toBeGreaterThan(prestige(stage('pit', 3, 0)))
        expect(tierOdds(stage('pit', 3, 3)).highroller).toBeGreaterThan(tierOdds(stage('pit', 3, 0)).highroller)
        // Whales stay rare.
        expect(tierOdds(stage('penthouse', 5, 5)).whale).toBeLessThan(0.01)
    })

    it('is deterministic: the same casino, player and moment give the same floor', () => {
        const view = stage('highlimit', 3, 3)
        const seed = seedOf('player-1')
        expect(seedOf('player-1')).toBe(seed)
        expect(seedOf('player-2')).not.toBe(seed)
        expect(rollAt(view, seed, T0 + 5 * MIN)).toEqual(rollAt(view, seed, T0 + 5 * MIN))
        // One tick, one roll.
        expect(rollAt(view, seed, T0)).toEqual(rollAt(view, seed, T0 + TICK_MS - 1))
        expect(runFloor(view, seed, T0, T0 + DAY, { hours: true, notable: true })).toEqual(runFloor(view, seed, T0, T0 + DAY, { hours: true, notable: true }))
        // Other players have other luck.
        const day = (s: number) => runFloor(view, s, T0, T0 + DAY).income
        expect(day(seedOf('player-2'))).not.toBe(day(seed))
        const now = floorNow(view, seed, T0 + 7 * MIN)
        expect(now.tickEndsAt).toBe(T0 + TICK_MS)
        expect(now.seats).toBe(expectedFloor(view).seats)
        expect(VISITOR_TIER_IDS.reduce((sum, id) => sum + now.visitors[id], 0)).toBeLessThanOrEqual(now.seats)
    })

    it('adds up: any split of a stretch earns the same coins, with a campaign and a rush ending inside it', () => {
        const view: FloorView = { ...stage('pit', 2, 2), campaign: { id: 'flyers', until: T0 + 77 * MIN + 13_000 }, rushUntil: T0 + 3 * HOUR + 1_234 }
        const seed = 12_345
        const from = T0 + 7_777
        const to = T0 + 9 * HOUR + 4_321
        const whole = runFloor(view, seed, from, to, { hours: true })
        let rnd = 99
        const next = () => (rnd = (rnd * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648
        for (let trial = 0; trial < 20; trial++) {
            const cuts = Array.from({ length: 1 + Math.floor(next() * 12) }, () => from + Math.floor(next() * (to - from))).sort((a, b) => a - b)
            let total = 0
            let at = from
            const hours = new Map<number, number>()
            for (const cut of [...cuts, to]) {
                const part = runFloor(view, seed, at, cut, { hours: true })
                total += part.income
                for (const hour of part.hours) hours.set(hour.at, normalizeCoins((hours.get(hour.at) ?? 0) + hour.income))
                at = cut
            }
            expect(normalizeCoins(total)).toBe(whole.income)
            for (const hour of whole.hours) expect(hours.get(hour.at)).toBe(hour.income)
        }
        // The cage too: split or not, the same coins stored and lost.
        const cage = { stored: 100, capacity: 3_000 }
        const once = runFloor(view, seed, from, to, { cage })
        const first = runFloor(view, seed, from, T0 + 4 * HOUR, { cage })
        const second = runFloor(view, seed, T0 + 4 * HOUR, to, { cage: { stored: first.stored, capacity: cage.capacity } })
        expect(second.stored).toBe(once.stored)
        expect(normalizeCoins(first.lost + second.lost)).toBe(once.lost)
        expect(once.stored).toBe(3_000)
        expect(normalizeCoins(once.stored - 100 + once.lost)).toBe(once.income)
        // A read that only needs the cage stops once it is full, at the same fill.
        expect(runFloor(view, seed, from, to, { cage, stopWhenFull: true }).stored).toBe(once.stored)
    })

    it('matches the expectation on average, varies from hour to hour and keeps days steady', () => {
        for (const view of [stage('main', 3, 1), stage('highlimit', 3, 4), stage('penthouse', 5, 5)]) {
            const seed = seedOf('steady')
            const days: number[] = []
            const hours: number[] = []
            for (let d = 0; d < 20; d++) {
                let total = 0
                for (let h = 0; h < 24; h++) {
                    const at = T0 + d * DAY + h * HOUR
                    const income = runFloor(view, seed, at, at + HOUR).income
                    hours.push(income)
                    total += income
                }
                days.push(total)
            }
            const mean = days.reduce((a, b) => a + b, 0) / days.length
            expect(Math.abs(mean / 24 / expectedPerHour(view) - 1)).toBeLessThan(0.04)
            for (const day of days) expect(Math.abs(day / mean - 1)).toBeLessThan(0.18)
            const sorted = [...hours].sort((a, b) => a - b)
            expect(sorted[Math.floor(hours.length * 0.9)]! / sorted[Math.floor(hours.length * 0.1)]!).toBeGreaterThan(1.3)
        }
    })

    /** Campaign mixes to check under: none, each on its own, all at once. */
    const MIXES: (CampaignId[])[] = [[], ...CAMPAIGNS.map(c => [c.id]), CAMPAIGNS.map(c => c.id)]
    const running = (ids: CampaignId[]): RunningCampaignRef[] => ids.map(id => ({ id, until: T0 + DAY }))

    it('never lowers expected income with a build step, under any rules the casino could run, with any ads', () => {
        let checked = 0
        for (const { name, view } of STAGES) {
            const steps = buildSteps(view)
            for (const rules of ALL_RULES) {
                // Rules the casino hasn't unlocked are at their defaults (setting one is a 403).
                if (JSON.stringify(rulesOf({ ...view, rules })) !== JSON.stringify(rules)) continue
                for (const mix of MIXES) {
                    const campaigns = running(mix)
                    const before = expectedPerHour({ ...view, rules, campaigns }, T0)
                    for (const step of steps) {
                        const after = expectedPerHour({ ...step.view, rules, campaigns }, T0)
                        expect(after, `${name} + ${step.name} ${JSON.stringify(rules)} ${mix.join('+')}`).toBeGreaterThanOrEqual(before - 0.01)
                        checked++
                    }
                }
            }
        }
        expect(checked).toBeGreaterThan(10_000)
    })

    it('never fills the floor without ads, and all the ads together take it to about full', () => {
        for (const { name, view } of STAGES) {
            const fill = (campaigns: RunningCampaignRef[]) => {
                const floor = expectedFloor({ ...view, campaigns }, T0)
                return VISITOR_TIER_IDS.reduce((sum, id) => sum + floor.visitors[id], 0) / floor.seats
            }
            const idle = fill([])
            expect(idle, name).toBeGreaterThan(0.4)
            expect(idle, name).toBeLessThan(0.8)
            const guests = CAMPAIGNS.filter(c => c.goal === 'guests' && !campaignBlocker(view, c.id, T0)).map(c => c.id)
            // Each guests ad adds its own share of the seats: only all of them together fill the floor.
            for (const id of guests) expect(fill(running([id])), `${name} ${id}`).toBeGreaterThan(idle + 0.08)
            if (guests.length >= 3) {
                expect(fill(running(guests)), name).toBeGreaterThan(0.9)
                for (const id of guests) expect(fill(running(guests.filter(g => g !== id))), `${name} without ${id}`).toBeLessThan(fill(running(guests)))
            }
        }
    })

    it('stacks campaigns of different kinds: each adds on top of the others', () => {
        const view = stage('penthouse', 3, 4)
        const all = CAMPAIGNS.map(c => c.id)
        let previous = expectedPerHour(view, T0)
        for (let n = 1; n <= all.length; n++) {
            const now = expectedPerHour({ ...view, campaigns: running(all.slice(0, n)) }, T0)
            expect(now, all.slice(0, n).join('+')).toBeGreaterThan(previous)
            previous = now
        }
        // The wealth ads bring richer guests, the guests ads more of them.
        const base = tierOdds(view, T0)
        expect(tierOdds({ ...view, campaigns: running(['invites']) }, T0).highroller).toBeGreaterThan(base.highroller)
        expect(tierOdds({ ...view, campaigns: running(['jet']) }, T0).whale).toBeGreaterThan(base.whale * 3)
        expect(tierOdds({ ...view, campaigns: running(['tv']) }, T0)).toEqual(base)
    })

    it('previews a campaign over its whole run: guests ads pay on empty seats, wealth ads late', () => {
        const at = T0
        const ret = (view: FloorView, id: CampaignId) => campaignGain(view, id, at).coins * 0.97 / campaignCost(view, id, at)
        // Early: the Flyers pay for themselves on a half-empty floor; on a floor all the other guests ads fill, less.
        const main = stage('main', 3, 1)
        expect(ret(main, 'flyers')).toBeGreaterThan(1.2)
        const pit = stage('pit', 3, 2)
        const gain = campaignGain(pit, 'billboard', at)
        expect(gain.guests).toBeGreaterThan(2)
        expect(gain.until - gain.from).toBe(8 * HOUR)
        expect(gain.after.tourist).toBeGreaterThan(gain.before.tourist)
        expect(ret({ ...pit, campaigns: running(['flyers']) }, 'billboard')).toBeLessThan(ret(pit, 'billboard'))
        // A bigger run brings more over its run.
        const high = stage('highlimit', 3, 4)
        expect(campaignGain(high, 'tv', at).coins).toBeGreaterThan(campaignGain(high, 'billboard', at).coins)
        expect(campaignGain(high, 'billboard', at).coins).toBeGreaterThan(campaignGain(high, 'flyers', at).coins)
        // Wealth ads open with the High Limit Room; at the top, on a floor the guests ads keep full, they beat one more guests ad.
        expect(campaignBlocker(pit, 'invites', at)).toMatch(/High Limit/)
        const top = stage('penthouse', 5, 5)
        const guestsAds = CAMPAIGNS.filter(c => c.goal === 'guests').map(c => c.id)
        const full = (id: CampaignId) => ({ ...top, campaigns: running(guestsAds.filter(g => g !== id)) })
        const best = (goal: string) => Math.max(...CAMPAIGNS.filter(c => c.goal === goal).map(c => ret(full(c.id), c.id)))
        expect(best('wealth')).toBeGreaterThan(best('guests'))
        expect(campaignGain(top, 'invites', at).richGuests).toBeGreaterThan(0)
        // A run on top of a queued one covers the stretch after it.
        const queued = campaignGain({ ...high, campaigns: [{ id: 'tv', until: at + 5 * HOUR }] }, 'tv', at)
        expect(queued.from).toBe(at + 5 * HOUR)
    })

    it('caps Tourists at the door and keeps the VIP room for High Rollers and Whales', () => {
        const busy = { ...stage('penthouse', 3, 4), campaigns: running(['flyers', 'billboard', 'tv']) }
        const seed = seedOf('door')
        const seats = expectedFloor(busy).seats
        for (let tick = 0; tick < 96; tick++) {
            const at = T0 + tick * TICK_MS
            const limit = rollAt({ ...busy, rules: { ...DEFAULT_RULES, door: 'limit' } }, seed, at)
            expect(limit.visitors.tourist).toBeLessThanOrEqual(Math.floor(seats / 3))
            const closed = rollAt({ ...busy, rules: { ...DEFAULT_RULES, door: 'closed' } }, seed, at)
            expect(closed.visitors.tourist).toBe(0)
            const vip = rollAt({ ...busy, rules: { ...DEFAULT_RULES, vip: true } }, seed, at)
            // The High Limit Room's seats hold only the rich: everyone else fits in the other seats.
            const highLimit = TYCOON_GAMES.filter(g => g.zone === 'highlimit').reduce((sum, g) => sum + expectedFloor({ zones: ['highlimit'], games: { [g.slug]: 3 }, upgrades: {} }).seats, 0)
            expect(vip.visitors.tourist + vip.visitors.regular).toBeLessThanOrEqual(seats - highLimit)
        }
        // A locked rule does nothing.
        const pit = stage('pit', 3)
        expect(expectedPerHour({ ...pit, rules: { door: 'closed', vip: true } })).toBe(expectedPerHour(pit))
    })

    it('gives every house rule a trade-off: it loses somewhere and pays somewhere', () => {
        const options: Partial<HouseRules>[] = [{ door: 'limit' }, { door: 'closed' }, { vip: true }]
        for (const option of options) {
            const deltas: number[] = []
            for (const { view } of STAGES) {
                if (!unlockedRules(view).includes(Object.keys(option)[0] as keyof HouseRules)) continue
                for (const mix of MIXES) {
                    const at = { ...view, campaigns: running(mix) }
                    deltas.push(expectedPerHour({ ...at, rules: { ...DEFAULT_RULES, ...option } }, T0) - expectedPerHour(at, T0))
                }
            }
            expect(Math.min(...deltas), JSON.stringify(option)).toBeLessThan(0)
            expect(Math.max(...deltas), JSON.stringify(option)).toBeGreaterThan(0)
        }
    })

    it('shows the rules panel: unlocked rules in order, each option with its expected change, the cooldown', () => {
        expect(houseState(stage('pit', 3), T0, null)).toEqual({ rules: DEFAULT_RULES, unlocked: [], options: [], cooldownUntil: null })
        expect(houseState(stage('lounge', 1), T0, null).unlocked).toEqual(['door'])
        const view = { ...stage('penthouse', 3, 3), rules: { door: 'limit' as const, vip: false } }
        const house = houseState(view, T0, T0 - MIN)
        expect(house.unlocked).toEqual(['door', 'vip'])
        expect(house.options).toHaveLength(5)
        expect(house.cooldownUntil).toBe(T0 - MIN + RULES_COOLDOWN_MS)
        expect(houseState(view, T0, T0 - RULES_COOLDOWN_MS).cooldownUntil).toBeNull()
        const base = expectedPerHour(view, T0)
        for (const option of house.options) {
            expect(option.active).toBe(view.rules[option.rule] === option.value)
            if (option.active) expect(option.delta).toBe(0)
            expect(option.delta).toBeCloseTo(expectedPerHour({ ...view, rules: { ...view.rules, [option.rule]: option.value } }, T0) - base, 1)
            expect(option.label.length).toBeGreaterThan(0)
            expect(option.description.length).toBeGreaterThan(0)
        }
        expect(ruleCombos(view)).toHaveLength(6)
    })

    it('lets Whales stay for one to three hours and reports each visit whole', () => {
        const view = stage('penthouse', 5, 5)
        const seed = seedOf('whales')
        const run = runFloor(view, seed, T0, T0 + 10 * DAY, { notable: true })
        expect(run.notable.length).toBeGreaterThan(5)
        for (const guest of run.notable) {
            expect(guest.tier).toBe('whale')
            const stay = guest.until! - guest.at
            expect(stay).toBeGreaterThanOrEqual(VISITOR_MODEL.whaleStayMin * TICK_MS)
            expect(stay).toBeLessThanOrEqual(VISITOR_MODEL.whaleStayMax * TICK_MS)
        }
        // A long stay spends far more than one tick of a Whale, and a split stretch reports the same visits.
        const big = Math.max(...run.notable.map(g => g.spent))
        expect(big).toBeGreaterThan(VISITOR_TIERS[3]!.spend)
        const halves = [...runFloor(view, seed, T0, T0 + 5 * DAY, { notable: true }).notable, ...runFloor(view, seed, T0 + 5 * DAY, T0 + 10 * DAY, { notable: true }).notable]
        const sum = (list: { spent: number }[]) => list.reduce((a, g) => a + g.spent, 0)
        expect(Math.abs(sum(halves) - sum(run.notable))).toBeLessThan(run.notable.length + 2)
        // A Whale seen at a tick is still there at the next one when its stay goes on.
        for (let tick = 0; tick < 200; tick++) {
            const at = T0 + tick * TICK_MS
            const r = rollAt(view, seed, at)
            for (const w of r.whaleStays) {
                if (w.arrival + w.stay > tickOf(at) + 1) expect(rollAt(view, seed, at + TICK_MS).whaleStays.some(n => n.arrival === w.arrival && n.index === w.index)).toBe(true)
            }
        }
    })

    it('shows how a step moves the tier mix: cheap tiers down, rich ones up, and the next tier once its room opens', () => {
        const back = stage('backroom', 2)
        const decor = tierShift(back, { ...back, specials: specialBonus(['red-carpet']) })
        expect(decor.map(t => t.id)).toEqual(['tourist', 'regular'])
        expect(decor[0]!.from).toBeNull()
        expect(decor[1]!.from).toBe('main')
        expect(decor[1]!.next).toBeGreaterThan(decor[1]!.now)
        const pit = stage('pit', 3, 2)
        const richer = tierShift(pit, { ...pit, upgrades: { ...pit.upgrades, hospitality: (pit.upgrades.hospitality ?? 0) + 1 } })
        expect(richer.find(t => t.id === 'tourist')!.next).toBeLessThan(richer.find(t => t.id === 'tourist')!.now)
        expect(richer.find(t => t.id === 'highroller')!.next).toBeGreaterThan(richer.find(t => t.id === 'highroller')!.now)
        // The top machine levels draw richer guests; the first ones barely.
        expect(richerLevel(5)).toBe(true)
        expect(richerLevel(2)).toBe(false)
        // The floor now adds up: what each tier brings less the costs is the rate.
        const now = floorNow({ ...stage('penthouse', 3, 4), rules: { door: 'open', vip: true } }, seedOf('sum'), T0 + 3 * MIN)
        const total = VISITOR_TIER_IDS.reduce((sum, id) => sum + Math.round(now.income[id] * 100), 0)
        expect(Math.max(0, total - Math.round(now.costs * 100)) / 100).toBe(now.perHour)
    })
})

describe('house rules and history on the server', () => {
    /** Server tests run on the real clock: the casino is made now, so start on the next hour but one. */
    const S0 = Math.ceil(Date.now() / HOUR) * HOUR + 2 * HOUR
    /** A dev player with every zone open and every game built (seedPlayer's default casino). */
    const builtPlayer = () => seedPlayer(0, 0, { origin: 'dev' })

    it('parses the rules body strictly', () => {
        expect(parseRulesBody({ vip: true })).toEqual({ vip: true })
        expect(parseRulesBody({ door: 'closed', vip: false })).toEqual({ door: 'closed', vip: false })
        for (const body of [null, [], {}, 'vip', { vip: 'true' }, { vip: 1 }, { door: 'shut' }, { door: true }, { vip: null }, { music: true }, { drinks: true }, { vip: true, extra: 1 }]) {
            expect(() => parseRulesBody(body), JSON.stringify(body)).toThrow(expect.objectContaining({ statusCode: 400 }))
        }
        expect(parseHistoryRange(undefined)).toBe('24h')
        expect(parseHistoryRange('3d')).toBe('3d')
        for (const range of ['7d', '', 24, ['24h']]) expect(() => parseHistoryRange(range)).toThrow(expect.objectContaining({ statusCode: 400 }))
    })

    it('refuses a rule the casino has not unlocked (403) and hides the panel from a new casino', () => {
        const id = seedPlayer(0, 0, { casino: 'none', origin: 'dev' })
        const state = getTycoonState(id, S0)
        expect(state.house).toEqual({ rules: DEFAULT_RULES, unlocked: [], options: [], cooldownUntil: null })
        expect(state.floor.odds).toEqual({ tourist: 1, regular: 0, highroller: 0, whale: 0 })
        expect(state.floor.seats).toBe(5)
        expect(state.cage.perHour).toBe(state.floor.perHour)
        expect(() => setHouseRules(id, { door: 'limit' }, S0)).toThrow(expect.objectContaining({ statusCode: 403 }))
        expect(() => setHouseRules(id, { vip: false }, S0)).toThrow(expect.objectContaining({ statusCode: 403 }))
    })

    it('changes rules once per cooldown, accruing the cage at the old rules first', async () => {
        const id = builtPlayer()
        getTycoonState(id, S0)
        await collectCage(id, S0)
        const changed = setHouseRules(id, { door: 'limit' }, S0 + HOUR)
        expect(changed.state.house!.rules).toEqual({ door: 'limit', vip: false })
        expect(changed.state.house!.cooldownUntil).toBe(S0 + HOUR + RULES_COOLDOWN_MS)
        // The cage holds exactly what the floor made at the old rules.
        const atOld = runFloor({ ...floorView(changed.state), rules: DEFAULT_RULES }, luckSeed(id), S0, S0 + HOUR, { cage: { stored: 0, capacity: cageCapacity(0) } })
        const row = db.select().from(casinoProfiles).where(eq(casinoProfiles.playerId, id)).get()!
        expect(row.cageStored).toBe(atOld.stored)
        expect(row.cageAt.getTime()).toBe(S0 + HOUR)
        expect(row.rulesAt!.getTime()).toBe(S0 + HOUR)

        // Within the cooldown: refused; the same rules again: nothing changes, nothing refused.
        expect(() => setHouseRules(id, { vip: true }, S0 + HOUR + 5 * MIN)).toThrow(expect.objectContaining({ statusCode: 429 }))
        expect(setHouseRules(id, { door: 'limit' }, S0 + HOUR + 5 * MIN).state.house!.rules.vip).toBe(false)
        expect(setHouseRules(id, { vip: true }, S0 + HOUR + RULES_COOLDOWN_MS).state.house!.rules).toEqual({ door: 'limit', vip: true })

        // A burst of changes (each to other rules) lands once.
        const at = S0 + 2 * HOUR
        const bodies = ALL_RULES.filter(r => !(r.door === 'limit' && r.vip))
        const results = await Promise.allSettled(bodies.map(body => Promise.resolve().then(() => setHouseRules(id, body, at))))
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(results.filter(r => r.status === 'rejected').every(r => (r as PromiseRejectedResult).reason.statusCode === 429)).toBe(true)
    })

    it('sends the floor on every read and the rules panel only to the owner', () => {
        const owner = builtPlayer()
        const visitor = builtPlayer()
        const mine = getTycoonState(owner, S0)
        expect(mine.house!.unlocked).toEqual(['door', 'vip'])
        expect(mine.floor.expectedPerHour).toBeGreaterThan(0)
        expect(mine.floor.tickEndsAt).toBe(S0 + TICK_MS)
        const visit = getCasinoVisit(visitor, owner, S0)
        // Visitors see who is on the floor, never the owner's income.
        expect(visit.floor).toEqual({ visitors: mine.floor.visitors, seats: mine.floor.seats, turnedAway: mine.floor.turnedAway })
        expect('house' in visit).toBe(false)
        expect(visit.visitors).toBe(VISITOR_TIER_IDS.reduce((sum, id) => sum + mine.floor.visitors[id], 0))
    })

    it('writes the hour-by-hour history while the cage accrues and serves the last 24 hours or 3 days', async () => {
        const id = builtPlayer()
        giveChips(id, 1_000_000)
        getTycoonState(id, S0)
        await collectCage(id, S0)
        // A build finishing mid-way splits the stretch; a collect writes the rest.
        await startBuild(id, { kind: 'game', id: 'plinko' }, S0 + 2 * HOUR + 10 * MIN)
        const collected = (await collectCage(id, S0 + 5 * HOUR + 30 * MIN)).collected
        // Rows since S0 (the casino's first hours before it are there too).
        const rows = db.select().from(casinoHistory).where(eq(casinoHistory.playerId, id)).all().filter(r => r.hour.getTime() >= S0)
        expect(rows.map(r => r.hour.getTime()).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5].map(h => S0 + h * HOUR))
        // Whole hours are fully covered, the last one half.
        expect(rows.filter(r => r.hour.getTime() < S0 + 5 * HOUR).every(r => r.coveredMs === HOUR)).toBe(true)
        expect(rows.find(r => r.hour.getTime() === S0 + 5 * HOUR)!.coveredMs).toBe(30 * MIN)

        const now = S0 + 7 * HOUR + 20 * MIN
        const made = Math.floor(Date.now() / HOUR) * HOUR
        const day = getHistory(id, '24h', now)
        expect(day.range).toBe('24h')
        expect(day.hours).toHaveLength(24)
        expect(day.hours.at(-1)!.at).toBe(S0 + 7 * HOUR)
        for (let i = 1; i < day.hours.length; i++) expect(day.hours[i]!.at - day.hours[i - 1]!.at).toBe(HOUR)
        // Before the casino: zeros. After: guests and income, also for the hours not written yet.
        expect(day.hours[0]).toEqual({ at: S0 - 16 * HOUR, visitors: { tourist: 0, regular: 0, highroller: 0, whale: 0 }, income: 0, lost: 0 })
        for (const hour of day.hours.filter(h => h.at < made)) expect(hour.income).toBe(0)
        for (const hour of day.hours.filter(h => h.at >= S0)) {
            expect(hour.income).toBeGreaterThan(0)
            expect(hour.visitors.tourist + hour.visitors.regular).toBeGreaterThan(0)
        }
        expect(getHistory(id, '3d', now).hours).toHaveLength(72)
        // What the cage took in is the written income less what a full cage lost.
        const written = normalizeCoins(rows.reduce((sum, r) => sum + r.income, 0))
        const lost = normalizeCoins(rows.reduce((sum, r) => sum + r.lost, 0))
        const left = getTycoonState(id, S0 + 5 * HOUR + 30 * MIN).cage.stored
        expect(written).toBeGreaterThan(0)
        expect(normalizeCoins(written - lost)).toBe(normalizeCoins(collected + left))
    })

    it('prunes history older than four days when it writes', async () => {
        const id = builtPlayer()
        getTycoonState(id, S0)
        db.insert(casinoHistory).values({ playerId: id, hour: new Date(S0 - HISTORY_KEEP_MS - 2 * HOUR), touristHours: 1, coveredMs: HOUR, income: 10, lost: 0 }).run()
        await collectCage(id, S0 + HOUR)
        const left = db.select().from(casinoHistory).where(and(eq(casinoHistory.playerId, id))).all()
        expect(left.every(r => r.hour.getTime() >= S0 - HISTORY_KEEP_MS)).toBe(true)
        expect(left.length).toBeGreaterThan(0)
    })
})
