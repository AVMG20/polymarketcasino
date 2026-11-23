import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A fake hub: gem balances, idempotent spends and star sets we can count.
const hubGems = new Map<string, number>()
const spends = new Map<string, { spendId: string, gems: number }>()
let hubDown = false
let refuseWith: number | null = null
const spendGems = vi.fn(async (input: { playerId: string, amount: number, idempotencyKey: string }) => {
    await new Promise(resolve => setTimeout(resolve, 2))
    if (hubDown) throw new HubError('Hub unavailable', null)
    if (refuseWith) throw new HubError(`Refused with ${refuseWith}`, refuseWith)
    const replay = spends.get(input.idempotencyKey)
    if (replay) return replay
    const have = hubGems.get(input.playerId) ?? 0
    if (have < input.amount) throw new HubError('Not enough gems', 400)
    hubGems.set(input.playerId, have - input.amount)
    const spend = { spendId: crypto.randomUUID(), gems: have - input.amount }
    spends.set(input.idempotencyKey, spend)
    spent.set(spend.spendId, { playerId: input.playerId, amount: input.amount })
    return spend
})
const spent = new Map<string, { playerId: string, amount: number }>()
/** Make the next refunds fail: 'down' (no answer) or a 4xx refusal. */
let refundFail: 'down' | number | null = null
const refundGems = vi.fn(async (spendId: string) => {
    if (refundFail === 'down') throw new HubError('Hub unavailable', null)
    if (refundFail) throw new HubError(`Refused with ${refundFail}`, refundFail)
    const row = spent.get(spendId)
    if (!row) throw new HubError('Not your spend', 403)
    spent.delete(spendId)
    hubGems.set(row.playerId, (hubGems.get(row.playerId) ?? 0) + row.amount)
    return { gems: hubGems.get(row.playerId)! }
})
const setStars = vi.fn(async ({ stars }: { stars: number }) => ({ applied: true, stars, best: stars, bounty: 0, total: stars, title: 'Newcomer' }))

vi.mock('../server/utils/hub', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../server/utils/hub')>()
    return {
        ...actual,
        hub: {
            ...actual.hub,
            spendGems: (input: never) => spendGems(input),
            refundGems: (spendId: string) => refundGems(spendId),
            getPlayer: async (id: string) => ({ id, name: 'x', image: null, gems: hubGems.get(id) ?? 0, stars: 0, title: 'Newcomer' }),
            setStars: (input: never) => setStars(input)
        }
    }
})

const { HubError } = await import('../server/utils/hub')
const { eq } = await import('drizzle-orm')
const { db } = await import('../server/database')
const { casinoConstructions, casinoProfiles, chipTransactions, gameRounds, gemPurchases, players } = await import('../server/database/schema')
const { collectCage, getTycoonState, parseBuildBody, parseCampaignBody, startBuild, startCampaign } = await import('../server/utils/tycoon')
const { buyWithGems, parseGemBody, retryStalePurchases } = await import('../server/utils/tycoon-gems')
const { playRound } = await import('../server/utils/rounds')
const { playerStats } = await import('../server/utils/stats')
const { TABLES } = await import('../server/utils/tables')
const { TableError } = await import('../server/utils/tables/table')
const { GAMES } = await import('../shared/games/registry')
const { normalizeCoins, sumCoins } = await import('../shared/money')
const T = await import('../shared/tycoon')
const { CASINO_STARS } = await import('../shared/stars')
const { chipLedgerSum, chipsOf, coinsOf, giveChips, ledgerSum, seedPlayer } = await import('./setup/players')
const { coinTransactions } = await import('../server/database/schema')

beforeEach(() => {
    hubDown = false
    refuseWith = null
    refundFail = null
    spendGems.mockClear()
    refundGems.mockClear()
    setStars.mockClear()
})

const SEC = 1_000
const MIN = 60 * SEC
const HOUR = 60 * MIN

/** A brand-new player: no casino yet. */
const newPlayer = (coins = 100_000, origin: 'hub' | 'dev' = 'hub') => seedPlayer(coins, coins, { casino: 'none', origin })
const chipRows = (id: string) => db.select().from(chipTransactions).where(eq(chipTransactions.playerId, id)).all()
const coinRows = (id: string) => db.select().from(coinTransactions).where(eq(coinTransactions.playerId, id)).all()
const purchasesOf = (id: string) => db.select().from(gemPurchases).where(eq(gemPurchases.playerId, id)).all()

function blankState(over: Partial<import('../shared/tycoon').TycoonState> = {}): import('../shared/tycoon').TycoonState {
    return {
        serverNow: 0,
        chips: 0,
        zones: ['backroom'],
        games: { plinko: 1, spinata: 1 },
        upgrades: { cage: 0, marketing: 0, decor: 0, crew: 0 },
        constructions: [],
        builders: 1,
        cage: { stored: 0, capacity: T.cageCapacity(0), perHour: 0 },
        rushUntil: null,
        campaign: null,
        golden: [],
        progress: 0,
        gemsEnabled: true,
        ...over
    }
}

describe('catalog and rules', () => {
    it('lists every game of the registry once, with five levels and guest income per level', () => {
        expect(T.TYCOON_GAMES.map(game => game.slug).sort()).toEqual(GAMES.map(game => game.slug).sort())
        for (const game of T.TYCOON_GAMES) {
            expect(game.levels).toHaveLength(T.MAX_LEVEL)
            expect(game.guestsPerHour).toHaveLength(T.MAX_LEVEL)
            expect(T.findZone(game.zone)).toBeDefined()
            if (game.starter) expect(game.levels[0]).toEqual({ chips: 0, coins: 0, buildMs: 0 })
            else expect(game.levels[0]!.buildMs).toBeGreaterThan(0)
            // Builds cost chips only.
            for (const level of game.levels) expect(level.coins).toBe(0)
        }
        for (const zone of T.ZONES) expect(zone.cost.coins).toBe(0)
        expect(T.UPGRADE_IDS).toEqual(['cage', 'marketing', 'decor', 'crew'])
        for (const zone of T.ZONES) if (zone.requires) expect(T.findZone(zone.requires)).toBeDefined()
        for (const upgrade of T.UPGRADES) expect(upgrade.requiresZone).toHaveLength(upgrade.levels.length)
    })

    it('never lowers guest income with a new game', () => {
        // Built in catalog order, with every earlier game at level 1 or 3: each new one adds income.
        for (const earlier of [1, 3]) {
            let games: Record<string, number> = {}
            for (const game of T.TYCOON_GAMES) {
                const zones = T.ZONES.slice(0, T.ZONES.findIndex(zone => zone.id === game.zone) + 1).map(zone => zone.id)
                const state = blankState({ zones, games })
                const after = blankState({ zones, games: { ...games, [game.slug]: 1 } })
                if (Object.keys(games).length) expect(T.baseGuestsPerHour(after), game.slug).toBeGreaterThan(T.baseGuestsPerHour(state))
                games = { ...games, [game.slug]: game.starter ? 1 : earlier }
            }
        }
    })

    it('keeps guest income (coins) and the cage bounded', () => {
        const maxed = blankState({
            zones: T.ZONES.map(zone => zone.id),
            games: Object.fromEntries(T.TYCOON_GAMES.map(game => [game.slug, T.MAX_LEVEL])),
            upgrades: { cage: 5, marketing: 5, decor: 5, crew: 1 }
        })
        // Every seat full, with the strongest campaign: still capped.
        expect(T.fullIncomePerHour(maxed) * 24).toBeLessThanOrEqual(180_000)
        expect(T.guestsPerHour({ ...maxed, campaign: { id: 'tv', until: 1 } }, 0)).toBeLessThanOrEqual(T.fullIncomePerHour(maxed))
        expect(T.cageCapacity(99)).toBe(T.cageCapacity(T.MAX_LEVEL))
        expect(T.cageCapacity(T.MAX_LEVEL)).toBeGreaterThan(T.cageCapacity(0))
        expect(T.guestsPerHour({ ...maxed, rushUntil: 10 }, 0)).toBe(T.guestsPerHour(maxed, 0) * 2)
        expect(T.progressOf(maxed)).toBe(1)
        expect(T.progressOf(blankState())).toBeGreaterThan(0)
    })

    it('prices the next step and says why a build cannot start', () => {
        const state = blankState()
        expect(T.nextCost(state, 'game', 'limbo')).toEqual(T.findTycoonGame('limbo')!.levels[0])
        expect(T.nextCost(state, 'game', 'plinko')).toEqual(T.findTycoonGame('plinko')!.levels[1])
        expect(T.nextCost(state, 'game', 'dice')).toEqual(T.findTycoonGame('dice')!.levels[0])
        expect(T.nextCost(state, 'zone', 'backroom')).toBeNull()
        expect(T.nextCost(state, 'game', 'nope')).toBeNull()
        expect(T.nextCost({ ...state, games: { plinko: 5 } }, 'game', 'plinko')).toBeNull()

        expect(T.buildBlocker(state, 'game', 'limbo')).toBeNull()
        expect(T.buildBlocker(state, 'game', 'roulette')).toBe('Open the Main Floor first')
        expect(T.buildBlocker(state, 'zone', 'pit')).toBe('Open the Main Floor first')
        expect(T.buildBlocker(state, 'zone', 'backroom')).toMatch(/already own/)
        expect(T.buildBlocker(state, 'game', 'nope')).toBe('Unknown game')
        expect(T.buildBlocker({ ...state, games: { plinko: 5 } }, 'game', 'plinko')).toMatch(/top level/)
        expect(T.buildBlocker(state, 'game', 'dice')).toBe('Open the Main Floor first')
        const busy = { ...state, constructions: [{ kind: 'game' as const, id: 'limbo', level: 1, startedAt: 0, readyAt: 1 }] }
        expect(T.buildBlocker(busy, 'game', 'limbo')).toBe('Already under construction')
        expect(T.buildBlocker(busy, 'game', 'wheel')).toBe('Your builder is busy')
        expect(T.buildBlocker({ ...busy, builders: 2 }, 'game', 'wheel')).toBeNull()
        expect(T.buildBlocker(state, 'upgrade', 'decor')).toBe('Open the Main Floor first')
        expect(T.buildBlocker(state, 'upgrade', 'cage')).toBeNull()
        // The House Cut upgrade left with economy v2.
        expect(T.buildBlocker(state, 'upgrade', 'houseCut')).toBe('Unknown upgrade')
    })

    it('counts builders from the Construction Crew and the gem builder, three at most', () => {
        const crew = T.findUpgrade('crew')!
        expect(crew.levels).toHaveLength(1)
        expect(crew.requiresZone).toEqual(['lounge'])
        expect(T.builderCount({ crew: 0 }, false)).toBe(1)
        expect(T.builderCount({ crew: 1 }, false)).toBe(2)
        expect(T.builderCount({ crew: 0 }, true)).toBe(2)
        expect(T.builderCount({ crew: 1 }, true)).toBe(T.MAX_BUILDERS)
        expect(T.MAX_BUILDERS).toBe(3)
        expect(T.buildBlocker(blankState(), 'upgrade', 'crew')).toBe('Open the Slot Lounge first')
        const lounge = blankState({ zones: ['backroom', 'main', 'pit', 'lounge'] })
        expect(T.buildBlocker(lounge, 'upgrade', 'crew')).toBeNull()
        expect(T.buildBlocker({ ...lounge, upgrades: { ...lounge.upgrades, crew: 1 } }, 'upgrade', 'crew')).toBe('Construction Crew is at the top level')
        const busy = { ...lounge, builders: 3, constructions: ['limbo', 'wheel', 'roulette'].map(id => ({ kind: 'game' as const, id, level: 1, startedAt: 0, readyAt: 1 })) }
        expect(T.buildBlocker(busy, 'upgrade', 'crew')).toBe('Every builder is busy')
    })

    it('prices skips from the time left, on the dear side of the guide, from 1 to at most 200 gems', () => {
        expect(T.skipGems(0)).toBe(1)
        expect(T.skipGems(-5)).toBe(1)
        expect(T.skipGems(10 * MIN)).toBeGreaterThanOrEqual(3)
        expect(T.skipGems(10 * MIN)).toBeLessThanOrEqual(5)
        expect(T.skipGems(HOUR)).toBeGreaterThanOrEqual(10)
        expect(T.skipGems(HOUR)).toBeLessThanOrEqual(15)
        expect(T.skipGems(8 * HOUR)).toBeGreaterThanOrEqual(40)
        expect(T.skipGems(8 * HOUR)).toBeLessThanOrEqual(60)
        expect(T.skipGems(1_000 * HOUR)).toBe(200)
    })

    it('extrapolates the cage at the client, rush and cap included', () => {
        const state = blankState({ serverNow: 0, cage: { stored: 100, capacity: 10_000, perHour: 0 } })
        const perHour = T.guestsPerHour(state, 0)
        expect(T.cageAt(state, HOUR)).toBe(normalizeCoins(100 + perHour))
        expect(T.cageAt(state, 1_000 * HOUR)).toBe(10_000)
        const rushed = { ...state, rushUntil: HOUR }
        expect(T.guestsPerHour(rushed, 0)).toBeCloseTo(2 * perHour, 1)
        expect(T.cageAt(rushed, 2 * HOUR)).toBe(normalizeCoins(100 + T.guestsPerHour(rushed, 0) + perHour))
    })
})

describe('casino profile', () => {
    it('is created on first read with the starters, the backroom and chips in the cage', () => {
        const id = newPlayer()
        const now = Date.now()
        const state = getTycoonState(id, now)
        expect(state).toMatchObject({
            serverNow: now,
            chips: 0,
            zones: ['backroom'],
            games: { plinko: 1, spinata: 1 },
            upgrades: { cage: 0, marketing: 0, decor: 0 },
            constructions: [],
            builders: 1,
            rushUntil: null,
            campaign: null,
            golden: [],
            gemsEnabled: true
        })
        expect(state.cage.stored).toBe(T.STARTER_CAGE)
        expect(state.cage.perHour).toBeGreaterThan(0)
        // A second read finds the same casino.
        expect(getTycoonState(id, now).chips).toBe(0)
        expect(getTycoonState(newPlayer(0, 'dev')).gemsEnabled).toBe(false)
    })

    it('collects the cage as coins once, however many collects race, and refills it over time to capacity', async () => {
        const id = newPlayer(0)
        const t0 = Date.now()
        getTycoonState(id, t0)
        const results = await Promise.all(Array.from({ length: 10 }, () => collectCage(id, t0)))
        expect(results.map(r => r.collected).filter(Boolean)).toEqual([T.STARTER_CAGE])
        expect(results.find(r => r.collected)!.coins).toBe(T.STARTER_CAGE)
        expect(coinsOf(id).coins).toBe(T.STARTER_CAGE)
        expect(chipsOf(id)).toBe(0)

        const perHour = getTycoonState(id, t0).cage.perHour
        const later = await collectCage(id, t0 + 2 * HOUR)
        expect(later.collected).toBe(Math.floor(2 * perHour))
        const full = await collectCage(id, t0 + 1_000 * HOUR)
        expect(full.collected).toBe(T.cageCapacity(0))
        expect(ledgerSum(id)).toBe(coinsOf(id).coins)
        expect(coinRows(id).every(row => row.category === 'cage' && row.type === 'credit')).toBe(true)
        expect(chipRows(id)).toEqual([])
    })

    it('builds: debits chips, runs the timer and applies the level once it is done', async () => {
        const id = newPlayer()
        const t0 = Date.now()
        getTycoonState(id, t0)
        // Under the first star, before and after: no star report.
        giveChips(id, 900)
        const limbo = T.findTycoonGame('limbo')!.levels[0]!
        const started = await startBuild(id, { kind: 'game', id: 'limbo' }, t0)
        expect(started.state.chips).toBe(900 - limbo.chips)
        expect(started.state.constructions).toEqual([{ kind: 'game', id: 'limbo', level: 1, startedAt: t0, readyAt: t0 + limbo.buildMs }])
        expect(started.state.games.limbo).toBeUndefined()
        expect(started.coins).toBeNull()
        expect(started.stars).toBeNull()
        await expect(startBuild(id, { kind: 'game', id: 'wheel' }, t0)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Your builder is busy' })
        await expect(playRound(id, 'limbo', { bet: 10, options: { target: 2 } })).rejects.toMatchObject({ statusCode: 403 })

        const done = getTycoonState(id, t0 + limbo.buildMs)
        expect(done.games.limbo).toBe(1)
        expect(done.constructions).toEqual([])
        expect(db.select().from(casinoConstructions).where(eq(casinoConstructions.playerId, id)).all()).toEqual([])
        // More guests now that limbo runs.
        expect(done.cage.perHour).toBeGreaterThan(started.state.cage.perHour)
        expect(chipRows(id).find(row => row.type === 'debit')).toMatchObject({ amount: limbo.chips, reason: 'build:game:limbo' })
    })

    it('charges builds in chips only, and refuses what the player cannot afford', async () => {
        const id = newPlayer(1_000_000)
        const t0 = Date.now()
        getTycoonState(id, t0)
        await expect(startBuild(id, { kind: 'zone', id: 'main' }, t0)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Not enough chips' })
        giveChips(id, 100_000)
        await startBuild(id, { kind: 'zone', id: 'main' }, t0)
        getTycoonState(id, t0 + HOUR)
        const pit = T.findZone('pit')!.cost
        const result = await startBuild(id, { kind: 'zone', id: 'pit' }, t0 + HOUR)
        expect(result.coins).toBeNull()
        expect(result.state.chips).toBe(100_000 - T.findZone('main')!.cost.chips - pit.chips)
        // Coins never pay for building.
        expect(coinsOf(id).coins).toBe(1_000_000)
        expect(ledgerSum(id)).toBe(0)
        expect(getTycoonState(id, t0 + HOUR).constructions).toHaveLength(1)
    })

    it("reports the star level a build's chip spend drops", async () => {
        const id = newPlayer(0)
        getTycoonState(id)
        // Just over the first star threshold, so the build drops below it.
        giveChips(id, CASINO_STARS[0]!.threshold + T.findTycoonGame('limbo')!.levels[0]!.chips / 2)
        db.update(players).set({ starsReported: 1 }).where(eq(players.id, id)).run()
        const result = await startBuild(id, { kind: 'game', id: 'limbo' })
        expect(result.stars).toMatchObject({ playerId: id, level: 0, previous: 1 })
        expect(setStars).toHaveBeenCalledWith(expect.objectContaining({ stars: 0 }))
    })

    it('starts one construction out of a burst, and never spends more chips than the balance', async () => {
        const id = newPlayer()
        getTycoonState(id)
        giveChips(id, 5_000)
        db.update(casinoProfiles).set({ builders: 2 }).where(eq(casinoProfiles.playerId, id)).run()
        const burst = await Promise.allSettled(Array.from({ length: 12 }, () => startBuild(id, { kind: 'game', id: 'wheel' })))
        expect(burst.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(chipsOf(id)).toBe(5_000 - T.findTycoonGame('wheel')!.levels[0]!.chips)
        expect(chipLedgerSum(id)).toBe(chipsOf(id) - 5_000)
        expect(getTycoonState(id).constructions).toHaveLength(1)
    })

    it('builds the Construction Crew once, after the Slot Lounge, for one more builder', async () => {
        const id = newPlayer()
        const t0 = Date.now()
        getTycoonState(id, t0)
        giveChips(id, 200_000)
        await expect(startBuild(id, { kind: 'upgrade', id: 'crew' }, t0)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Open the Slot Lounge first' })
        db.update(casinoProfiles).set({ zones: ['backroom', 'main', 'pit', 'lounge'] }).where(eq(casinoProfiles.playerId, id)).run()
        const crew = T.findUpgrade('crew')!.levels[0]!
        // A burst of taps starts it once and pays once.
        const burst = await Promise.allSettled(Array.from({ length: 8 }, () => startBuild(id, { kind: 'upgrade', id: 'crew' }, t0)))
        expect(burst.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(chipsOf(id)).toBe(200_000 - crew.chips)
        // Still one builder while the crew is on its way (and it is the busy one).
        expect(getTycoonState(id, t0).builders).toBe(1)
        const done = getTycoonState(id, t0 + crew.buildMs)
        expect(done.upgrades.crew).toBe(1)
        expect(done.builders).toBe(2)
        expect(done.gemBuilder).toBe(false)
        await expect(startBuild(id, { kind: 'upgrade', id: 'crew' }, t0 + crew.buildMs)).rejects.toMatchObject({ statusCode: 400 })
        // Two constructions at once now, not three.
        await startBuild(id, { kind: 'game', id: 'limbo' }, t0 + crew.buildMs)
        await startBuild(id, { kind: 'game', id: 'wheel' }, t0 + crew.buildMs)
        await expect(startBuild(id, { kind: 'game', id: 'roulette' }, t0 + crew.buildMs)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Every builder is busy' })
        // The stored column keeps only the gem builder; the crew comes from the upgrade.
        expect(db.select().from(casinoProfiles).where(eq(casinoProfiles.playerId, id)).get()!.builders).toBe(1)
    })

    it('reads build bodies strictly', () => {
        expect(parseBuildBody({ kind: 'game', id: 'limbo' })).toEqual({ kind: 'game', id: 'limbo' })
        for (const body of [null, [], {}, { kind: 'games', id: 'limbo' }, { kind: 'game', id: 7 }, { kind: 'game', id: '' }, { kind: ['game'], id: 'limbo' }]) {
            expect(() => parseBuildBody(body)).toThrow()
        }
    })
})

describe('visitors and ad campaigns', () => {
    it('seats come from built games, demand from games, decor, marketing and campaigns', () => {
        const start = blankState()
        expect(T.floorSeats(start)).toBe(T.seatsOf('plinko', 1) + T.seatsOf('spinata', 1))
        expect(T.seatsOf('plinko', 3)).toBe(T.seatsOf('plinko', 1) + 2)
        expect(T.seatsOf('nope', 1)).toBe(0)
        // A new casino is not full: a campaign has something to fill.
        expect(T.visitorDemand(start, 0)).toBeLessThan(T.floorSeats(start))
        const flyers = { ...start, campaign: { id: 'flyers' as const, until: HOUR } }
        expect(T.visitorDemand(flyers, 0)).toBeGreaterThan(T.visitorDemand(start, 0))
        expect(T.visitorDemand(flyers, HOUR)).toBe(T.visitorDemand(start, HOUR))
        expect(T.visitorCount(flyers, 0)).toBeLessThanOrEqual(T.floorSeats(start))
        expect(T.guestsPerHour(flyers, 0)).toBeGreaterThan(T.guestsPerHour(start, 0))
        expect(T.guestsPerHour(start, 0)).toBeLessThanOrEqual(T.fullIncomePerHour(start))
        // Marketing makes campaigns stronger.
        expect(T.campaignBoost('flyers', 5)).toBeGreaterThan(T.campaignBoost('flyers', 0))
    })

    it('splits guest income where a campaign ends', () => {
        const state = blankState({ campaign: { id: 'flyers', until: HOUR } })
        const both = T.guestChipsBetween(state, 0, 2 * HOUR)
        const expected = T.guestsPerHour(state, 0) + T.guestsPerHour(state, HOUR)
        expect(Math.abs(both - expected)).toBeLessThan(0.001)
    })

    it('gates campaigns on Marketing and one at a time', () => {
        const state = blankState()
        expect(T.campaignBlocker(state, 'flyers', 0)).toBeNull()
        expect(T.campaignBlocker(state, 'tv', 0)).toMatch(/Marketing/)
        const running = blankState({ campaign: { id: 'flyers', until: HOUR }, upgrades: { cage: 0, marketing: 2, decor: 0, crew: 0 } })
        expect(T.campaignBlocker(running, 'billboard', 0)).toMatch(/running/)
        expect(T.campaignBlocker(running, 'flyers', 0)).toBeNull()
        expect(T.campaignBlocker(running, 'billboard', HOUR)).toBeNull()
        expect(T.campaignCost(state, 'flyers')).toBeGreaterThanOrEqual(T.MIN_CAMPAIGN_CHIPS)
        // At most a week queued: a TV ad six days out can't take another day.
        const tv = blankState({ campaign: { id: 'tv', until: 6.5 * 24 * HOUR }, upgrades: { cage: 0, marketing: 4, decor: 0, crew: 0 } })
        expect(T.campaignBlocker(tv, 'tv', 0)).toMatch(/week/)
        expect(T.campaignBlocker(tv, 'tv', 24 * HOUR)).toBeNull()
    })

    it('prices a stacked campaign 1.5× per run still queued, and back to 1× once it runs out', () => {
        const state = blankState({ games: { plinko: 3, spinata: 3, limbo: 2 }, upgrades: { cage: 0, marketing: 4, decor: 0, crew: 0 } })
        const ms = T.findCampaign('billboard')!.ms
        const base = T.campaignCost(state, 'billboard', 0)
        expect(Math.abs(base - T.fullIncomePerHour(state) * T.findCampaign('billboard')!.costHours)).toBeLessThanOrEqual(50)
        for (const queued of [1, 2, 3, 5]) {
            const running = { ...state, campaign: { id: 'billboard' as const, until: queued * ms } }
            expect(T.campaignStacks(running, 'billboard', 0)).toBe(queued)
            const price = T.campaignCost(running, 'billboard', 0)
            expect(Math.abs(price - base * T.CAMPAIGN_STACK_FACTOR ** queued)).toBeLessThanOrEqual(base * 0.01 + 100)
            // Part of a run left still counts as a run.
            expect(T.campaignCost(running, 'billboard', 0.5 * ms)).toBe(price)
            // Another campaign running doesn't stack on this one; the old one ran out: 1× again.
            expect(T.campaignCost(running, 'tv', 0)).toBe(T.campaignCost(state, 'tv', 0))
            expect(T.campaignCost(running, 'billboard', queued * ms)).toBe(base)
        }
    })

    it('pays a campaign back while seats are empty and not once the floor is nearly full', () => {
        const maxed = blankState({
            zones: T.ZONES.map(zone => zone.id),
            games: Object.fromEntries(T.TYCOON_GAMES.map(game => [game.slug, T.MAX_LEVEL])),
            upgrades: { cage: 5, marketing: 5, decor: 5, crew: 1 }
        })
        // Even a maxed casino leaves seats empty without a campaign.
        expect(T.occupancy(maxed, 0)).toBeLessThan(0.75)
        for (const def of T.CAMPAIGNS) {
            const price = T.campaignCost(maxed, def.id, 0)
            const gain = T.guestChipsBetween({ ...maxed, campaign: { id: def.id, until: def.ms } }, 0, def.ms) - T.guestChipsBetween(maxed, 0, def.ms)
            // Collected as it comes, the coins won back at RTP 0.97 beat the price by a clear margin…
            expect(gain * 0.97, def.id).toBeGreaterThan(price * 1.15)
            // …but filling a floor that is 85% full already doesn't pay.
            expect(0.15 * T.fullIncomePerHour(maxed) * def.ms / HOUR * 0.97, def.id).toBeLessThan(price)
        }
    })

    it('runs a campaign for chips, extends the same one and refuses another', async () => {
        const id = newPlayer()
        const t0 = Date.now()
        getTycoonState(id, t0)
        giveChips(id, 100_000)
        const before = getTycoonState(id, t0)
        const price = T.campaignCost(before, 'flyers')
        const ran = await startCampaign(id, 'flyers', t0)
        expect(ran.state.chips).toBe(100_000 - price)
        expect(ran.state.campaign).toEqual({ id: 'flyers', until: t0 + T.findCampaign('flyers')!.ms })
        expect(ran.state.cage.perHour).toBeGreaterThan(before.cage.perHour)
        expect(chipRows(id).at(-1)).toMatchObject({ reason: 'campaign:flyers', type: 'debit', amount: price })

        // Each run already queued makes the next one dearer: 1×, 1,5×, 2,25×…
        const second = T.campaignCost(ran.state, 'flyers', t0 + 1_000)
        expect(second).toBeGreaterThan(price * 1.4)
        const again = await startCampaign(id, 'flyers', t0 + 1_000)
        expect(again.state.campaign!.until).toBe(t0 + 2 * T.findCampaign('flyers')!.ms)
        expect(again.state.chips).toBe(100_000 - price - second)
        expect(T.campaignCost(again.state, 'flyers', t0 + 2_000)).toBeGreaterThan(second * 1.4)
        // Once the queue runs down, the price comes back.
        expect(T.campaignCost(again.state, 'flyers', t0 + 2 * T.findCampaign('flyers')!.ms)).toBe(price)
        await expect(startCampaign(id, 'billboard', t0 + 2_000)).rejects.toMatchObject({ statusCode: 400 })
        giveChips(id, 0)
        await expect(startCampaign(id, 'flyers', t0 + 3_000)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Not enough chips' })

        expect(parseCampaignBody({ id: 'tv' })).toBe('tv')
        for (const body of [null, {}, { id: 3 }, { id: 'radio' }, ['flyers']]) expect(() => parseCampaignBody(body)).toThrow()
    })

    it('keeps cage income at the old rate up to the campaign start', async () => {
        const id = newPlayer()
        const t0 = Date.now()
        const fresh = getTycoonState(id, t0)
        giveChips(id, 1_000)
        const later = t0 + 3 * HOUR
        const expected = T.cageAt(fresh, later)
        const after = await startCampaign(id, 'flyers', later)
        expect(after.state.cage.stored).toBe(expected)
    })
})

describe('rounds and My Casino', () => {
    /** A new casino (the starters) with Dice built too: fixed odds to bet on. */
    const diceBettor = (coins: number) => {
        const id = newPlayer(coins)
        const { games } = getTycoonState(id)
        db.update(casinoProfiles).set({ games: { ...games, dice: 1 } }).where(eq(casinoProfiles.playerId, id)).run()
        return id
    }

    it('refuses a game the player has not built, without charging', async () => {
        const id = newPlayer(10_000)
        await expect(playRound(id, 'limbo', { bet: 100, options: { target: 2 } })).rejects.toMatchObject({ statusCode: 403, statusMessage: 'Build Limbo in your casino first' })
        expect(coinsOf(id).coins).toBe(10_000)
        await expect(playRound(id, 'dice', { bet: 100, options: { chance: 50 } })).rejects.toMatchObject({ statusCode: 403, statusMessage: 'Build Dice in your casino first' })
        expect(coinsOf(id).coins).toBe(10_000)
        // The starters play from the start.
        const round = await playRound(id, 'plinko', { bet: 100, options: { rows: 8, risk: 'low', balls: 1 } })
        expect(round.stake).toBe(100)
        expect((await playRound(id, 'spinata', { bet: 100 })).stake).toBe(100)
    })

    it("pays a coin round's whole payout in chips, in the same transaction", async () => {
        const id = diceBettor(10_000)
        let chips = 0
        for (let i = 0; i < 10; i++) {
            const round = await playRound(id, 'dice', { bet: 1_000, options: { chance: 50 } })
            chips = normalizeCoins(chips + round.payout)
            expect(round.balance).toBe(10_000 - 1_000 * (i + 1))
            expect(round.chips).toBe(chips)
            expect(round.chipsEarned).toBe(round.payout)
        }
        expect(coinsOf(id).coins).toBe(0)
        expect(chipsOf(id)).toBe(chips)
        expect(chipLedgerSum(id)).toBe(chips)
        expect(chipRows(id).every(row => row.type === 'credit' && row.reason === 'win:dice')).toBe(true)
        const rows = db.select().from(gameRounds).where(eq(gameRounds.playerId, id)).all()
        expect(rows.every(row => row.funding === 'coins' && row.stake === 1_000)).toBe(true)
    })

    it('stakes chips once the coins are gone, and pays the payout in chips', async () => {
        const id = diceBettor(0)
        getTycoonState(id)
        giveChips(id, 5_000)
        let chips = 5_000
        for (let i = 0; i < 20; i++) {
            // An older client's `funding` is ignored.
            const round = await playRound(id, 'dice', { bet: 100, options: { chance: 90 }, funding: 'coins' })
            chips = normalizeCoins(chips - 100 + round.payout)
            expect(round).toMatchObject({ stakeCoins: 0, stakeChips: 100, chips, balance: 0 })
        }
        expect(chipsOf(id)).toBe(chips)
        expect(chipLedgerSum(id)).toBe(normalizeCoins(chips - 5_000))
        expect(coinsOf(id).coins).toBe(0)
        expect(ledgerSum(id)).toBe(0)
        expect(chipRows(id).filter(row => row.reason === 'bet:dice')).toHaveLength(20)
        const rows = db.select().from(gameRounds).where(eq(gameRounds.playerId, id)).all()
        expect(rows.every(row => row.stakeChips === 100 && row.funding === 'chips')).toBe(true)
    })

    it('splits a stake: coins first, then chips for the rest', async () => {
        const id = diceBettor(60)
        getTycoonState(id)
        giveChips(id, 1_000)
        const mixed = await playRound(id, 'dice', { bet: 100, options: { chance: 50 } })
        expect(mixed).toMatchObject({ stake: 100, stakeCoins: 60, stakeChips: 40, balance: 0, chips: normalizeCoins(960 + mixed.payout) })
        expect(db.select().from(gameRounds).where(eq(gameRounds.playerId, id)).get()).toMatchObject({ stake: 100, stakeChips: 40, funding: 'coins' })
        expect(chipRows(id)[0]).toMatchObject({ type: 'debit', amount: 40, reason: 'bet:dice' })

        // Coins that cover the stake exactly leave the chips alone.
        const exact = diceBettor(100)
        getTycoonState(exact)
        giveChips(exact, 1_000)
        const round = await playRound(exact, 'dice', { bet: 100, options: { chance: 50 } })
        expect(round).toMatchObject({ stakeCoins: 100, stakeChips: 0, balance: 0 })
        expect(chipRows(exact).filter(row => row.type === 'debit')).toEqual([])
    })

    it('reports the stars a winning round lifts (stars follow chips, not coins)', async () => {
        const id = diceBettor(1_000_000)
        for (let i = 0; i < 100; i++) {
            const round = await playRound(id, 'dice', { bet: 1_000, options: { chance: 95 } })
            if (round.chips >= CASINO_STARS[0]!.threshold) {
                expect(round.stars).toMatchObject({ playerId: id, level: 1, previous: 0 })
                break
            }
            expect(round.stars).toBeNull()
        }
        const level = db.select({ stars: players.starsReported }).from(players).where(eq(players.id, id)).get()!.stars
        expect(level).toBe(1)
        // Nearly a million coins left: they never count.
        for (const call of setStars.mock.calls) expect((call[0] as { stars: number }).stars).toBe(1)
    })

    it('refuses a stake coins and chips together cannot cover, without charging', async () => {
        const id = diceBettor(60)
        getTycoonState(id)
        giveChips(id, 39)
        await expect(playRound(id, 'dice', { bet: 100, options: { chance: 50 } })).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Not enough coins or chips' })
        expect(chipsOf(id)).toBe(39)
        expect(coinsOf(id).coins).toBe(60)
        expect(chipRows(id)).toEqual([])
        expect(ledgerSum(id)).toBe(0)
        // Any bet goes: a near-certain one too.
        giveChips(id, 1_000)
        await expect(playRound(id, 'dice', { bet: 100, options: { chance: 95 } })).resolves.toMatchObject({ stake: 100 })
    })

    it('never lets a burst of bets spend more than coins and chips together', async () => {
        const id = diceBettor(450)
        getTycoonState(id)
        giveChips(id, 550)
        const burst = await Promise.allSettled(Array.from({ length: 30 }, () => playRound(id, 'dice', { bet: 100, options: { chance: 1 } })))
        const played = burst.flatMap(r => r.status === 'fulfilled' ? [r.value] : [])
        const paid = sumCoins(played.map(round => round.payout))
        expect(sumCoins(played.map(round => round.stakeCoins))).toBe(450)
        expect(coinsOf(id).coins).toBe(0)
        expect(ledgerSum(id)).toBe(-450)
        expect(chipsOf(id)).toBe(normalizeCoins(1_000 - 100 * played.length + paid))
        expect(chipLedgerSum(id)).toBe(normalizeCoins(chipsOf(id) - 550))
        for (const r of burst) if (r.status === 'rejected') expect(r.reason).toMatchObject({ statusMessage: 'Not enough coins or chips' })
    })

    it("splits the stats page's wagered per currency", async () => {
        const id = diceBettor(150)
        getTycoonState(id)
        giveChips(id, 1_000)
        const coinRound = await playRound(id, 'dice', { bet: 100, options: { chance: 50 } })
        const chipRound = await playRound(id, 'dice', { bet: 200, options: { chance: 49 } })
        const stats = playerStats(id, { range: '7d', game: null })
        expect(stats.summary).toMatchObject({ rounds: 2, wagered: 300, wageredCoins: 150, wageredChips: 150 })
        expect(stats.summary.paidOut).toBe(normalizeCoins(coinRound.payout + chipRound.payout))
        expect(stats.balance.end).toBe(coinsOf(id).coins)
    })
})

describe('live tables and My Casino', () => {
    it('lets anyone watch but seats only players who built the game', () => {
        const table = TABLES.blackjack!
        const id = newPlayer(10_000)
        expect(() => table.run(() => table.sit(id, 'New', null, 0))).toThrow(TableError)
        expect(() => table.run(() => table.sit(id, 'New', null, 0))).toThrow('Build Blackjack in your casino first')
        expect(table.occupancy()).toMatchObject({ slug: 'blackjack', seated: [], seats: table.config.seats })
        const built = seedPlayer(10_000)
        table.run(() => table.sit(built, 'Builder', null, 0))
        expect(table.occupancy().seated).toEqual([{ name: 'Builder', image: null, avatar: { hat: 'none', outfit: 'classic', accessory: 'none' } }])
        table.run(() => table.leave(built))
    })
})

describe('gem purchases', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('reads gem bodies strictly', () => {
        expect(parseGemBody({ item: 'rush' })).toEqual({ item: 'rush' })
        expect(parseGemBody({ item: 'skip', target: 'game:limbo' })).toEqual({ item: 'skip', target: 'game:limbo' })
        for (const body of [null, {}, { item: 'gems' }, { item: 'skip' }, { item: 'golden', target: 3 }, { item: 'rush', target: 'x' }]) {
            expect(() => parseGemBody(body)).toThrow()
        }
    })

    it('refuses dev-login players', async () => {
        const id = newPlayer(0, 'dev')
        await expect(buyWithGems(id, { item: 'rush' })).rejects.toMatchObject({ statusCode: 403 })
        expect(spendGems).not.toHaveBeenCalled()
    })

    it('sells no chips (they set the star level), and refunds a chip pack left pending from before', async () => {
        expect(() => parseGemBody({ item: 'chips' })).toThrow()
        const id = newPlayer()
        hubGems.set(id, 20)
        getTycoonState(id)
        const row = db.insert(gemPurchases).values({ playerId: id, item: 'chips', gems: 5, idempotencyKey: crypto.randomUUID(), createdAt: new Date(Date.now() - 120_000) }).returning().get()
        await retryStalePurchases(id)
        expect(hubGems.get(id)).toBe(20)
        expect(chipsOf(id)).toBe(0)
        expect(purchasesOf(id).find(p => p.id === row.id)).toMatchObject({ status: 'refunded', error: 'Chip packs are gone; refunded' })
    })

    it('buys the gem builder once, a rush, a golden skin and a skip', async () => {
        const id = newPlayer()
        hubGems.set(id, 500)
        const t0 = Date.now()
        getTycoonState(id, t0)
        giveChips(id, 10_000)

        expect((await buyWithGems(id, { item: 'builder' })).state.builders).toBe(2)
        await expect(buyWithGems(id, { item: 'builder' })).rejects.toMatchObject({ statusCode: 400 })

        const rushed = await buyWithGems(id, { item: 'rush' })
        expect(rushed.state.rushUntil).toBeGreaterThan(Date.now() + T.RUSH_MS - 5_000)

        await expect(buyWithGems(id, { item: 'golden', target: 'limbo' })).rejects.toMatchObject({ statusCode: 400 })
        expect((await buyWithGems(id, { item: 'golden', target: 'plinko' })).state.golden).toEqual(['plinko'])
        await expect(buyWithGems(id, { item: 'golden', target: 'plinko' })).rejects.toMatchObject({ statusCode: 400 })

        await startBuild(id, { kind: 'zone', id: 'main' })
        await expect(buyWithGems(id, { item: 'skip', target: 'zone:pit' })).rejects.toMatchObject({ statusCode: 400 })
        const before = hubGems.get(id)!
        const skipped = await buyWithGems(id, { item: 'skip', target: 'zone:main' })
        expect(skipped.state.zones).toContain('main')
        expect(skipped.state.constructions).toEqual([])
        expect(before - hubGems.get(id)!).toBe(T.skipGems(T.findZone('main')!.cost.buildMs))
    })

    it('refunds a late skip instead of finishing a later build of the same thing', async () => {
        const id = newPlayer()
        hubGems.set(id, 500)
        getTycoonState(id)
        giveChips(id, 100_000)
        await startBuild(id, { kind: 'game', id: 'limbo' })
        hubDown = true
        await expect(buyWithGems(id, { item: 'skip', target: 'game:limbo' })).rejects.toMatchObject({ statusCode: 503 })
        hubDown = false

        // Limbo finishes on its own, and its next level starts.
        db.delete(casinoConstructions).where(eq(casinoConstructions.playerId, id)).run()
        db.update(casinoProfiles).set({ games: { ...getTycoonState(id).games, limbo: 1 } }).where(eq(casinoProfiles.playerId, id)).run()
        await startBuild(id, { kind: 'game', id: 'limbo' })

        const row = purchasesOf(id)[0]!
        db.update(gemPurchases).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(gemPurchases.id, row.id)).run()
        await retryStalePurchases(id)
        expect(getTycoonState(id).constructions).toMatchObject([{ kind: 'game', id: 'limbo', level: 2 }])
        expect(hubGems.get(id)).toBe(500)
        expect(refundGems).toHaveBeenCalledTimes(1)
    })

    it('sells the gem builder once, before or after the Construction Crew, up to three builders', async () => {
        // After the crew: the crew must not use up the gem builder.
        const after = newPlayer()
        hubGems.set(after, 500)
        getTycoonState(after)
        db.update(casinoProfiles).set({ zones: ['backroom', 'main', 'pit', 'lounge'], upgrades: { cage: 0, marketing: 0, decor: 0, crew: 1 } }).where(eq(casinoProfiles.playerId, after)).run()
        expect(getTycoonState(after).builders).toBe(2)
        const hired = await buyWithGems(after, { item: 'builder' })
        expect(hired.state).toMatchObject({ builders: 3, gemBuilder: true })
        await expect(buyWithGems(after, { item: 'builder' })).rejects.toMatchObject({ statusCode: 400, statusMessage: 'You already hired the gem builder' })
        expect(hubGems.get(after)).toBe(500 - T.BUILDER_GEMS)

        // Before the crew: the crew still adds its builder on top.
        const before = newPlayer()
        hubGems.set(before, 500)
        const t0 = Date.now()
        getTycoonState(before, t0)
        expect((await buyWithGems(before, { item: 'builder' })).state).toMatchObject({ builders: 2, gemBuilder: true })
        await expect(buyWithGems(before, { item: 'builder' })).rejects.toMatchObject({ statusCode: 400 })
        db.update(casinoProfiles).set({ zones: ['backroom', 'main', 'pit', 'lounge'] }).where(eq(casinoProfiles.playerId, before)).run()
        giveChips(before, 100_000)
        await startBuild(before, { kind: 'upgrade', id: 'crew' }, t0)
        const done = getTycoonState(before, t0 + T.findUpgrade('crew')!.levels[0]!.buildMs)
        expect(done).toMatchObject({ builders: T.MAX_BUILDERS, gemBuilder: true, upgrades: { crew: 1 } })
        expect(hubGems.get(before)).toBe(500 - T.BUILDER_GEMS)
    })

    it('refunds a gem builder that settles after one was hired already', async () => {
        const id = newPlayer()
        hubGems.set(id, 500)
        getTycoonState(id)
        await buyWithGems(id, { item: 'builder' })
        // A second purchase left pending from before (e.g. under the old count check) settles late.
        db.insert(gemPurchases).values({ playerId: id, item: 'builder', gems: T.BUILDER_GEMS, idempotencyKey: crypto.randomUUID(), createdAt: new Date(Date.now() - 120_000) }).run()
        await retryStalePurchases(id)
        expect(getTycoonState(id)).toMatchObject({ builders: 2, gemBuilder: true })
        expect(hubGems.get(id)).toBe(500 - T.BUILDER_GEMS)
        expect(purchasesOf(id).filter(p => p.error === 'The gem builder was hired already; refunded')).toHaveLength(1)
    })

    it('sells one of the same purchase to a burst', async () => {
        const id = newPlayer()
        hubGems.set(id, 500)
        const burst = await Promise.allSettled(Array.from({ length: 6 }, () => buyWithGems(id, { item: 'builder' })))
        expect(burst.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(hubGems.get(id)).toBe(500 - T.BUILDER_GEMS)
        expect(getTycoonState(id)).toMatchObject({ builders: 2, gemBuilder: true })
    })

    it('marks a refused first attempt failed, and leaves an unanswered one pending for a retry', async () => {
        const id = newPlayer()
        hubGems.set(id, 2)
        await expect(buyWithGems(id, { item: 'rush' })).rejects.toMatchObject({ statusCode: 400 })
        expect(purchasesOf(id)).toMatchObject([{ status: 'failed' }])

        hubGems.set(id, 100)
        hubDown = true
        await expect(buyWithGems(id, { item: 'rush' })).rejects.toMatchObject({ statusCode: 503 })
        const pending = purchasesOf(id).find(row => row.status === 'pending')!
        expect(pending).toBeDefined()
        // A second rush waits for the first.
        await expect(buyWithGems(id, { item: 'rush' })).rejects.toMatchObject({ statusCode: 409 })
        expect(getTycoonState(id).rushUntil).toBeNull()

        // The hub is back; the stale row settles once with its own key.
        hubDown = false
        db.update(gemPurchases).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(gemPurchases.id, pending.id)).run()
        expect(await retryStalePurchases()).toBeGreaterThanOrEqual(1)
        expect(await retryStalePurchases(id)).toBe(0)
        expect(getTycoonState(id).rushUntil).toBeGreaterThan(Date.now())
        expect(hubGems.get(id)).toBe(100 - T.RUSH_GEMS)
        expect(purchasesOf(id).find(row => row.id === pending.id)?.status).toBe('done')
    })

    it('keeps a refusal on a retry pending: the first attempt may have landed', async () => {
        const id = newPlayer()
        hubGems.set(id, 100)
        hubDown = true
        await expect(buyWithGems(id, { item: 'rush' })).rejects.toMatchObject({ statusCode: 503 })
        hubDown = false
        refuseWith = 429
        const row = purchasesOf(id)[0]!
        db.update(gemPurchases).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(gemPurchases.id, row.id)).run()
        await retryStalePurchases(id)
        expect(purchasesOf(id)[0]!.status).toBe('pending')
    })

    it('keeps a refund that got no answer due, and the sweep hands the gems back later', async () => {
        const id = newPlayer()
        hubGems.set(id, 500)
        getTycoonState(id)
        await buyWithGems(id, { item: 'builder' })
        // A second builder purchase settles late: nothing to deliver, and the refund gets no answer.
        db.insert(gemPurchases).values({ playerId: id, item: 'builder', gems: T.BUILDER_GEMS, idempotencyKey: crypto.randomUUID(), createdAt: new Date(Date.now() - 120_000) }).run()
        refundFail = 'down'
        await retryStalePurchases(id)
        const due = purchasesOf(id).find(p => p.status === 'refund_due')!
        expect(due).toMatchObject({ status: 'refund_due', spendId: expect.any(String) })
        expect(hubGems.get(id)).toBe(500 - 2 * T.BUILDER_GEMS)

        // The hub is back. A fresh refund_due row is left to its own request; an older one is retried.
        refundFail = null
        await retryStalePurchases(id)
        expect(purchasesOf(id).find(p => p.id === due.id)!.status).toBe('refund_due')
        db.update(gemPurchases).set({ settledAt: new Date(Date.now() - 120_000) }).where(eq(gemPurchases.id, due.id)).run()
        await retryStalePurchases()
        expect(purchasesOf(id).find(p => p.id === due.id)!.status).toBe('refunded')
        expect(hubGems.get(id)).toBe(500 - T.BUILDER_GEMS)
        // Refunded once: another sweep leaves it alone.
        const calls = refundGems.mock.calls.length
        await retryStalePurchases()
        expect(refundGems.mock.calls.length).toBe(calls)
    })

    it('marks a refund the hub refuses refund_failed, and a refund that lands refunded', async () => {
        const id = newPlayer()
        hubGems.set(id, 500)
        getTycoonState(id)
        await buyWithGems(id, { item: 'builder' })
        db.insert(gemPurchases).values({ playerId: id, item: 'builder', gems: T.BUILDER_GEMS, idempotencyKey: crypto.randomUUID(), createdAt: new Date(Date.now() - 120_000) }).run()
        refundFail = 403
        await retryStalePurchases(id)
        expect(purchasesOf(id).filter(p => p.status === 'refund_failed')).toHaveLength(1)
        refundFail = null
        db.insert(gemPurchases).values({ playerId: id, item: 'builder', gems: T.BUILDER_GEMS, idempotencyKey: crypto.randomUUID(), createdAt: new Date(Date.now() - 120_000) }).run()
        await retryStalePurchases(id)
        expect(purchasesOf(id).filter(p => p.status === 'refunded')).toHaveLength(1)
    })

    it('prices the rush from the casino: 5 gems young, never cheaper than converting, at most 100', async () => {
        const young = newPlayer()
        expect(T.rushGems(getTycoonState(young))).toBe(T.RUSH_GEMS)

        const id = newPlayer()
        hubGems.set(id, 500)
        getTycoonState(id)
        const maxed = Object.fromEntries(T.TYCOON_GAMES.map(game => [game.slug, game.levels.length]))
        db.update(casinoProfiles).set({ zones: T.ZONES.map(zone => zone.id), games: maxed, upgrades: { cage: 5, marketing: 5, decor: 5, crew: 1 } }).where(eq(casinoProfiles.playerId, id)).run()
        const now = Date.now()
        const state = getTycoonState(id, now)
        const price = T.rushGems(state)
        const extra = T.rushExtraCoins(state)
        expect(price).toBeGreaterThan(T.RUSH_GEMS)
        expect(price).toBeLessThanOrEqual(T.RUSH_MAX_GEMS)
        expect(price * 1_000).toBeGreaterThanOrEqual(extra)

        const bought = await buyWithGems(id, { item: 'rush' })
        const charged = 500 - hubGems.get(id)!
        expect(charged).toBeGreaterThanOrEqual(price - 1)
        expect(charged).toBeLessThanOrEqual(price + 1)
        expect(purchasesOf(id).find(p => p.item === 'rush')!.gems).toBe(charged)
        // A running rush doesn't change the price of the next four hours.
        expect(T.rushGems(bought.state)).toBe(price)
    })

    it('never makes a rush then the best campaign a cheaper way to coins than converting', () => {
        // Every stage of a casino: each zone open, its games at each level, upgrades from none to the top.
        for (const [zi] of T.ZONES.entries()) {
            const open = T.ZONES.slice(0, zi + 1).map(zone => zone.id)
            for (const level of [1, 3, 5]) {
                for (const upgrade of [0, Math.min(5, zi), 5]) {
                    const state = blankState({
                        zones: open,
                        games: Object.fromEntries(T.TYCOON_GAMES.filter(game => open.includes(game.zone)).map(game => [game.slug, level])),
                        upgrades: { cage: upgrade, marketing: upgrade, decor: upgrade, crew: 0 }
                    })
                    const price = T.rushGems(state)
                    for (const campaign of [null, ...T.CAMPAIGNS.map(c => c.id)]) {
                        if (campaign && T.campaignBlocker(state, campaign, 0)) continue
                        // Rush now, then the campaign: every coin the rush adds over its four hours,
                        // collected as often as you like (no cage cap).
                        const base = { ...state, campaign: campaign ? { id: campaign, until: T.RUSH_MS } : null }
                        const extra = T.guestChipsBetween({ ...base, rushUntil: T.RUSH_MS }, 0, T.RUSH_MS) - T.guestChipsBetween(base, 0, T.RUSH_MS)
                        expect(extra / price, `${open.at(-1)} L${level} upgrades ${upgrade} ${campaign}`).toBeLessThan(1_000)
                    }
                }
            }
        }
    })
})
