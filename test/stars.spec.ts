import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COSMETICS, isFree } from '../shared/cosmetics'
import { DECOR } from '../shared/decor'
import { CHIP_COSMETICS, goalLevel, goalSummary, starGoals, starTitle, STAR_GOALS, STAR_LEVELS, type StarView } from '../shared/stars'
import { MAX_LEVEL, TYCOON_GAMES, UPGRADES, ZONES, type UpgradeId } from '../shared/tycoon'

// The fake hub keeps the last applied seq per player, like the real one.
const lastSeq = new Map<string, { seq: number, stars: number }>()
let hubDown = false
/** Runs while a set is on its way to the hub (a parallel report landing first). */
let duringSet: ((playerId: string) => void) | null = null
/** Holds a player's set at the hub until the promise it returns settles (a slow hub). */
let hold: ((playerId: string) => Promise<void> | undefined) | null = null
/** The hub applies the set, but its answer never arrives. */
let loseAnswer = false
const setStars = vi.fn(async ({ playerId, stars, seq }: { playerId: string, stars: number, seq: number }) => {
    await new Promise(resolve => setTimeout(resolve, 2))
    await hold?.(playerId)
    duringSet?.(playerId)
    if (hubDown) throw new HubError('Hub unavailable', null)
    const last = lastSeq.get(playerId)
    if (last && seq <= last.seq) return { applied: false, stars: last.stars, best: last.stars, bounty: 0, total: last.stars, title: 'Newcomer' }
    lastSeq.set(playerId, { seq, stars })
    if (loseAnswer) throw new HubError('No answer', null)
    return { applied: true, stars, best: stars, bounty: stars * 10, total: stars, title: 'Newcomer' }
})

vi.mock('../server/utils/hub', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../server/utils/hub')>()
    return {
        ...actual,
        hub: {
            ...actual.hub,
            setStars: (input: never) => setStars(input),
            getPlayer: async (id: string) => ({ id, name: 'x', image: null, gems: 0, stars: 0, title: 'Newcomer' })
        }
    }
})

const { HubError } = await import('../server/utils/hub')
const { dueStarLevel, ownStarChange, playedGames, starSummaryOf, starView, syncAllStars, syncStars } = await import('../server/utils/stars')
const { collectCage, getTycoonState, readTycoonState } = await import('../server/utils/tycoon')
const { claimMission } = await import('../server/utils/missions')
const { playRound } = await import('../server/utils/rounds')
const { getWallet } = await import('../server/utils/wallet')
const { coinTransaction } = await import('../server/utils/ledger')
const { creditChips } = await import('../server/utils/chips')
const { seedPlayer } = await import('./setup/players')
const { db } = await import('../server/database')
const { casinoConstructions, casinoCosmetics, casinoDecor, casinoProfiles, dailyMissions, gameRounds, players } = await import('../server/database/schema')
const { and, eq } = await import('drizzle-orm')

const SLUGS = TYCOON_GAMES.map(game => game.slug)
const SPECIALS = DECOR.filter(def => def.special).map(def => def.type)
const FOR_SALE = CHIP_COSMETICS
const STARTERS = Object.fromEntries(TYCOON_GAMES.filter(game => game.starter).map(game => [game.slug, 1]))
const NO_UPGRADES = Object.fromEntries(UPGRADES.map(upgrade => [upgrade.id, 0])) as Record<UpgradeId, number>
const MAX_UPGRADES = Object.fromEntries(UPGRADES.map(upgrade => [upgrade.id, upgrade.levels.length])) as Record<UpgradeId, number>

/** A new casino's view: the backroom and its two starters, nothing played or bought. */
const newView = (over: Partial<StarView> = {}): StarView => ({
    casino: { zones: ['backroom'], games: { ...STARTERS }, upgrades: NO_UPGRADES },
    decor: [],
    played: [],
    cosmetics: [],
    ...over
})
/** Everything built to the top, every special, every game played, every cosmetic bought. */
const doneView = (): StarView => ({
    casino: { zones: ZONES.map(zone => zone.id), games: Object.fromEntries(SLUGS.map(slug => [slug, MAX_LEVEL])), upgrades: MAX_UPGRADES },
    decor: SPECIALS.map(type => ({ type })),
    played: SLUGS,
    cosmetics: FOR_SALE
})
const goal = (view: StarView, key: string) => starGoals(view).find(g => g.key === key)!

/** A hub player with a new casino (the backroom and its starters). */
const newPlayer = () => {
    const id = seedPlayer(0, 0, { casino: 'none' })
    db.insert(casinoProfiles).values({ playerId: id, zones: ['backroom'], games: { ...STARTERS }, upgrades: NO_UPGRADES, golden: [], cageAt: new Date() }).run()
    return id
}
/** Give a player `n` of the cosmetics for sale (the all-cosmetics goal at n = all). */
const buyCosmetics = (id: string, keys: readonly string[]) => {
    for (const item of keys) db.insert(casinoCosmetics).values({ playerId: id, item, paid: 'gems' }).run()
}
/** A unit that moves nothing but asks for a star check (like the owner's casino read). */
const check = (playerId: string) => coinTransaction(coins => coins.checkStars(playerId))
const reported = (id: string) => db.select({ level: players.starsReported, seq: players.starsSeq }).from(players).where(eq(players.id, id)).get()!
const seen = (id: string) => db.select({ level: players.starsSeen, bounty: players.starsUnseenBounty }).from(players).where(eq(players.id, id)).get()!
/** A new casino with coins to bet (a plinko round needs no build). */
const bettor = (coins = 10_000) => {
    const id = newPlayer()
    db.update(players).set({ coins }).where(eq(players.id, id)).run()
    return id
}
const PLINKO = { bet: 100, options: { rows: 8, risk: 'low', balls: 1 } }

describe('star goals', () => {
    it('has ten goals and a ten-level track the hub can take', () => {
        expect(STAR_GOALS).toHaveLength(10)
        expect(new Set(STAR_GOALS.map(g => g.key)).size).toBe(10)
        expect(STAR_LEVELS).toHaveLength(10)
        expect(new Set(STAR_LEVELS.map(l => l.key)).size).toBe(10)
        for (const [i, level] of STAR_LEVELS.entries()) {
            expect(level.key).toMatch(/^[a-z0-9-]{1,40}$/)
            expect(level.name.length).toBeLessThanOrEqual(60)
            expect(level.description.length).toBeLessThanOrEqual(300)
            expect(level.description).toContain(`Earn ${i + 1} of the 10 casino stars`)
        }
        // The old chip keys are retired by the new ones.
        expect(STAR_LEVELS.some(level => level.key.startsWith('hold-'))).toBe(false)
        expect(starTitle(0)).toBeNull()
        expect(starTitle(1)).toBe(STAR_LEVELS[0]!.name)
        expect(starTitle(10)).toBe(STAR_LEVELS[9]!.name)
    })

    it('starts a new casino at level 0, with the progress of every goal', () => {
        const view = newView()
        expect(goalLevel(view)).toBe(0)
        expect(goal(view, 'level-5')).toMatchObject({ done: false, have: 1, need: 5 })
        expect(goal(view, 'level-25')).toMatchObject({ have: 1, need: 25 })
        expect(goal(view, 'build-all')).toMatchObject({ done: false, have: 2, need: SLUGS.length })
        expect(goal(view, 'play-all')).toMatchObject({ have: 0, need: SLUGS.length })
        expect(goal(view, 'all-specials')).toMatchObject({ have: 0, need: SPECIALS.length })
        expect(goal(view, 'max-all')).toMatchObject({ have: 0, need: SLUGS.length })
        expect(goal(view, 'all-cosmetics')).toMatchObject({ have: 0, need: FOR_SALE.length })
    })

    it('gives ten stars for everything, and counts goals in any order', () => {
        expect(goalLevel(doneView())).toBe(10)
        expect(starGoals(doneView()).every(g => g.done && g.have === g.need)).toBe(true)
        // Only the late goals: still a star each.
        expect(goalLevel(newView({ cosmetics: FOR_SALE }))).toBe(1)
        expect(goalLevel(newView({ played: SLUGS, decor: SPECIALS.map(type => ({ type })) }))).toBe(2)
        // One short of a goal is no star; a casino level past one caps its progress.
        expect(goalLevel(newView({ played: SLUGS.slice(1), cosmetics: FOR_SALE.slice(1) }))).toBe(0)
        const built = { ...doneView(), decor: [], played: [], cosmetics: [] }
        expect(goal(built, 'level-25')).toMatchObject({ done: true, have: 25, need: 25 })
        expect(goalLevel(built)).toBe(7)
    })

    it('ignores what is not a goal: free and gem-only cosmetics, plain decorations, other games, put-away specials still count', () => {
        const free = COSMETICS.filter(isFree).map(def => def.key)
        expect(goal(newView({ cosmetics: free }), 'all-cosmetics').have).toBe(0)
        // A star level is never sold for gems: gem-only cosmetics never count, and the goal needs none.
        const gemOnly = COSMETICS.filter(def => def.gems > 0 && def.chips === 0).map(def => def.key)
        expect(gemOnly.length).toBeGreaterThan(0)
        expect(FOR_SALE.length).toBeGreaterThan(0)
        expect(FOR_SALE.every(key => COSMETICS.find(def => def.key === key)!.chips > 0)).toBe(true)
        expect(goal(newView({ cosmetics: gemOnly }), 'all-cosmetics').have).toBe(0)
        const plain = DECOR.filter(def => !def.special).map(def => ({ type: def.type }))
        expect(goal(newView({ decor: plain }), 'all-specials').have).toBe(0)
        expect(goal(newView({ played: ['not-a-game', 'dice'] }), 'play-all').have).toBe(1)
        expect(goalSummary(newView(), 3)).toMatchObject({ level: 0, max: 10, reported: 3 })
    })
})

describe('star view (from the database)', () => {
    it('reads the build, ready constructions, specials, rounds anywhere and cosmetics', () => {
        const id = newPlayer()
        const other = newPlayer()
        // Every game played: rounds are the player's wherever they played them (a visit too).
        for (const game of SLUGS) db.insert(gameRounds).values({ playerId: id, game, stake: 10, payout: 0, summary: {} }).run()
        db.insert(gameRounds).values({ playerId: other, game: 'dice', stake: 10, payout: 0, summary: {} }).run()
        expect(playedGames(id).sort()).toEqual([...SLUGS].sort())
        expect(playedGames(other)).toEqual(['dice'])
        // A construction that is ready counts before any casino read applies it; one still running does not.
        const now = Date.now()
        db.insert(casinoConstructions).values({ playerId: id, kind: 'game', target: 'limbo', level: 1, startedAt: new Date(now - 60_000), readyAt: new Date(now - 1_000) }).run()
        db.insert(casinoConstructions).values({ playerId: id, kind: 'game', target: 'wheel', level: 1, startedAt: new Date(now), readyAt: new Date(now + 60_000) }).run()
        // Every special, one put away; every cosmetic for sale.
        for (const [i, type] of SPECIALS.entries()) db.insert(casinoDecor).values({ playerId: id, type, special: type, x: i ? i : null, y: i ? 0 : null }).run()
        buyCosmetics(id, FOR_SALE)

        const view = starView(id, db, now)
        expect(view.casino.games).toMatchObject({ plinko: 1, spinata: 1, limbo: 1 })
        expect(view.casino.games.wheel).toBeUndefined()
        const summary = starSummaryOf(id, db, now)
        expect(summary.goals.filter(g => g.done).map(g => g.key)).toEqual(['play-all', 'all-specials', 'all-cosmetics'])
        expect(summary.level).toBe(3)
        expect(summary.goals.find(g => g.key === 'build-all')).toMatchObject({ have: 3 })
    })

    it('reads a player without a casino as a new one', () => {
        const id = seedPlayer(0, 0, { casino: 'none' })
        expect(goalLevel(starView(id))).toBe(0)
        expect(goal(starView(id), 'build-all').have).toBe(2)
    })
})

describe('star reports', () => {
    beforeEach(() => {
        hubDown = false
        duringSet = null
        hold = null
        loseAnswer = false
        setStars.mockClear()
    })

    it('reports a goal reached on the next unit, with a ms timestamp seq above the stored one', async () => {
        const id = newPlayer()
        expect((await check(id)).stars).toEqual([])
        expect(setStars).not.toHaveBeenCalled()
        buyCosmetics(id, FOR_SALE)
        const before = Date.now()
        const { stars } = await check(id)
        expect(stars).toEqual([{ playerId: id, level: 1, previous: 0, bounty: 10, goals: ['all-cosmetics'] }])
        const seq = setStars.mock.calls[0]![0].seq
        expect(seq).toBeGreaterThanOrEqual(before)
        expect(seq).toBeLessThanOrEqual(Date.now())
        expect(reported(id)).toEqual({ level: 1, seq })
        // Nothing due any more: no call.
        await check(id)
        expect(setStars).toHaveBeenCalledTimes(1)
    })

    it('reports through any unit that touches the player: a chip move, a coin move, a stake', async () => {
        const id = newPlayer()
        buyCosmetics(id, FOR_SALE)
        const { stars } = await coinTransaction(coins => coins.credit({ playerId: id, amount: 5, category: 'cage' }))
        expect(stars).toMatchObject([{ playerId: id, level: 1 }])
        db.insert(gameRounds).values(SLUGS.map(game => ({ playerId: id, game, stake: 10, payout: 0, summary: {} }))).run()
        const chips = await coinTransaction(coins => coins.creditChips({ playerId: id, amount: 5, reason: 'win:dice' }))
        expect(chips.stars).toMatchObject([{ playerId: id, level: 2, previous: 1, goals: ['play-all', 'all-cosmetics'] }])
    })

    it('keeps the seq rising past one stored ahead of the clock, and past old chip and coin seqs', async () => {
        const ahead = newPlayer()
        buyCosmetics(ahead, FOR_SALE)
        const future = Date.now() + 3_600_000
        db.update(players).set({ starsSeq: future }).where(eq(players.id, ahead)).run()
        await syncStars(ahead)
        expect(setStars.mock.calls[0]![0].seq).toBe(future + 1)
        expect(reported(ahead)).toEqual({ level: 1, seq: future + 1 })

        // Chip stars from before the goals: 1e9 + a chip ledger id, level 8. The goals say 0: the level drops.
        const old = newPlayer()
        db.update(players).set({ starsReported: 8, starsSeq: 1_000_000_123 }).where(eq(players.id, old)).run()
        lastSeq.set(old, { seq: 1_000_000_123, stars: 8 })
        expect(await syncAllStars()).toBeGreaterThanOrEqual(1)
        expect(reported(old).level).toBe(0)
        expect(reported(old).seq).toBeGreaterThan(1_000_000_123)
        expect(lastSeq.get(old)!.stars).toBe(0)
    })

    it('never lets a slower, older report overwrite a newer one', async () => {
        const id = newPlayer()
        buyCosmetics(id, FOR_SALE)
        // A newer report lands while this one is on its way.
        duringSet = playerId => db.update(players).set({ starsReported: 1, starsSeq: Date.now() + 60_000 }).where(eq(players.id, playerId)).run()
        expect(await syncStars(id)).toBeNull()
        expect(reported(id).seq).toBeGreaterThan(Date.now())
    })

    it('runs one report at a time per player and ends at the latest level', async () => {
        const id = newPlayer()
        buyCosmetics(id, FOR_SALE)
        const first = syncStars(id)
        db.insert(gameRounds).values(SLUGS.map(game => ({ playerId: id, game, stake: 10, payout: 0, summary: {} }))).run()
        const second = syncStars(id)
        await Promise.all([first, second, syncStars(id)])
        expect(reported(id).level).toBe(2)
        expect(lastSeq.get(id)!.stars).toBe(2)
        expect(setStars).toHaveBeenCalledTimes(2)
    })

    it('keeps a level due while the hub is down and retries it in the background', async () => {
        const id = newPlayer()
        buyCosmetics(id, FOR_SALE)
        hubDown = true
        expect((await check(id)).stars).toEqual([])
        expect(reported(id).level).toBe(0)
        expect(dueStarLevel(id)).toBe(1)
        hubDown = false
        // The same level again: retried without holding up this unit.
        expect((await check(id)).stars).toEqual([])
        await vi.waitFor(() => expect(reported(id).level).toBe(1))
        expect(dueStarLevel(id)).toBeNull()
    })

    it('resends the same seq when it retries the same level, and a new one for a new level', async () => {
        const id = newPlayer()
        buyCosmetics(id, FOR_SALE)
        hubDown = true
        expect(await syncStars(id)).toBeNull()
        expect(await syncStars(id)).toBeNull()
        const first = setStars.mock.calls[0]![0].seq
        expect(setStars.mock.calls[1]![0].seq).toBe(first)
        hubDown = false
        expect(await syncStars(id)).toMatchObject({ level: 1 })
        expect(setStars.mock.calls[2]![0].seq).toBe(first)
        expect(reported(id)).toEqual({ level: 1, seq: first })
        // The hub applied a set whose answer never came back: the retry with the same seq confirms it.
        db.insert(gameRounds).values(SLUGS.map(game => ({ playerId: id, game, stake: 10, payout: 0, summary: {} }))).run()
        loseAnswer = true
        expect(await syncStars(id)).toBeNull()
        const second = setStars.mock.calls[3]![0].seq
        expect(second).toBeGreaterThan(first)
        expect(lastSeq.get(id)).toEqual({ seq: second, stars: 2 })
        expect(reported(id).level).toBe(1)
        loseAnswer = false
        await syncStars(id)
        expect(setStars.mock.calls[4]![0].seq).toBe(second)
        expect(reported(id)).toEqual({ level: 2, seq: second })
    })

    it('never reports for dev-login players', async () => {
        const id = newPlayer()
        db.update(players).set({ origin: 'dev' }).where(eq(players.id, id)).run()
        buyCosmetics(id, FOR_SALE)
        expect((await check(id)).stars).toEqual([])
        expect(await syncStars(id)).toBeNull()
        expect(dueStarLevel(id)).toBeNull()
        await syncAllStars()
        expect(setStars).not.toHaveBeenCalled()
        // Their goals still show.
        expect(starSummaryOf(id).level).toBe(1)
    })

    it('never counts coins or chips', async () => {
        const id = newPlayer()
        await coinTransaction((coins) => {
            coins.credit({ playerId: id, amount: 5_000_000, category: 'convert' })
            coins.creditChips({ playerId: id, amount: 5_000_000, reason: 'win:dice' })
        })
        expect(setStars).not.toHaveBeenCalled()
        expect(dueStarLevel(id)).toBeNull()
    })

    it('refuses a chip move outside a coin transaction (the unit checks stars)', () => {
        const id = newPlayer()
        expect(() => db.transaction(tx => creditChips(tx, { playerId: id, amount: 10, reason: 'win:dice' }))).toThrow(/coinTransaction/)
    })
})

describe('star celebrations (the seen level)', () => {
    beforeEach(() => {
        hubDown = false
        duringSet = null
        hold = null
        setStars.mockClear()
    })

    it('celebrates a ready build the sweep reported on the next owner read, once', async () => {
        const id = newPlayer()
        // Every game built but Limbo, whose construction is ready (not applied yet).
        db.update(casinoProfiles).set({ games: Object.fromEntries(SLUGS.filter(slug => slug !== 'limbo').map(slug => [slug, 1])) }).where(eq(casinoProfiles.playerId, id)).run()
        const now = Date.now()
        db.insert(casinoConstructions).values({ playerId: id, kind: 'game', target: 'limbo', level: 1, startedAt: new Date(now - 60_000), readyAt: new Date(now - 1_000) }).run()
        const level = goalLevel(starView(id))
        expect(starGoals(starView(id)).find(g => g.key === 'build-all')!.done).toBe(true)

        await syncAllStars()
        expect(reported(id).level).toBe(level)
        expect(seen(id)).toEqual({ level: 0, bounty: level * 10 })

        const first = await readTycoonState(id, Date.now(), { welcome: true })
        // Reported before this read: the bounty is in any gem count read since (the client reads it again).
        expect(first.stars).toMatchObject({ playerId: id, level, previous: 0, bounty: level * 10, late: true })
        expect(first.stars!.goals).toContain('build-all')
        expect(seen(id)).toEqual({ level, bounty: 0 })
        expect((await readTycoonState(id)).stars).toBeNull()
        expect((await getWallet(id)).starChange).toBeNull()
    })

    it("hands a round's change over once: the next read does not celebrate it again", async () => {
        const id = bettor()
        buyCosmetics(id, FOR_SALE)
        const round = await playRound(id, 'plinko', PLINKO)
        expect(round.stars).toEqual({ playerId: id, level: 1, previous: 0, bounty: 10, goals: ['all-cosmetics'] })
        expect(seen(id).level).toBe(1)
        expect((await readTycoonState(id)).stars).toBeNull()
        expect((await getWallet(id)).starChange).toBeNull()
    })

    it('delivers an unseen rise to exactly one of many parallel reads', async () => {
        const id = newPlayer()
        buyCosmetics(id, FOR_SALE)
        await syncAllStars()
        const [wallets, reads] = await Promise.all([
            Promise.all([getWallet(id), getWallet(id)]),
            Promise.all(Array.from({ length: 6 }, () => readTycoonState(id)))
        ])
        const changes = [...wallets.map(w => w.starChange), ...reads.map(r => r.stars)].filter(Boolean)
        expect(changes).toEqual([expect.objectContaining({ level: 1, previous: 0, bounty: 10 })])

        // The same when the reads report it themselves.
        const other = newPlayer()
        buyCosmetics(other, FOR_SALE)
        const burst = await Promise.all(Array.from({ length: 6 }, () => readTycoonState(other)))
        expect(burst.map(r => r.stars).filter(Boolean)).toEqual([expect.objectContaining({ playerId: other, level: 1, previous: 0 })])
        expect(setStars.mock.calls.filter(([input]) => input.playerId === other)).toHaveLength(1)
    })

    it('returns the change from a collect and from a mission claim', async () => {
        const collector = newPlayer()
        db.update(casinoProfiles).set({ cageStored: 25 }).where(eq(casinoProfiles.playerId, collector)).run()
        buyCosmetics(collector, FOR_SALE)
        const collected = await collectCage(collector)
        expect(collected.collected).toBeGreaterThanOrEqual(25)
        expect(collected.stars).toMatchObject({ playerId: collector, level: 1, previous: 0 })
        expect((await readTycoonState(collector)).stars).toBeNull()

        const claimer = newPlayer()
        getTycoonState(claimer)
        const mission = db.select().from(dailyMissions).where(eq(dailyMissions.playerId, claimer)).all().find(row => row.mission !== 'bonus')!
        db.update(dailyMissions).set({ progress: mission.target }).where(and(eq(dailyMissions.playerId, claimer), eq(dailyMissions.mission, mission.mission))).run()
        await vi.waitFor(() => expect(dueStarLevel(claimer)).toBeNull())
        buyCosmetics(claimer, FOR_SALE)
        const claim = await claimMission(claimer, mission.mission as never)
        expect(claim.stars).toMatchObject({ playerId: claimer, level: 1, previous: 0 })
        expect((await readTycoonState(claimer)).stars).toBeNull()
    })

    it("never holds a visitor's round on the host's report, nor hands them the host's change", async () => {
        const host = newPlayer()
        buyCosmetics(host, FOR_SALE)
        const visitor = bettor()
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        hold = playerId => (playerId === host ? gate : undefined)
        // The rakeback moves the host's chips: their level is due, and reported in the background.
        const round = await playRound(visitor, 'plinko', { ...PLINKO, host })
        expect(round.rakeback).toBe(0)
        expect(round.stars).toBeNull()
        expect(setStars).toHaveBeenCalledWith(expect.objectContaining({ playerId: host, stars: 1 }))
        expect(reported(host).level).toBe(0)
        release()
        await vi.waitFor(() => expect(reported(host).level).toBe(1))
        expect(seen(host).level).toBe(0)
        expect((await readTycoonState(host)).stars).toMatchObject({ playerId: host, level: 1, previous: 0, bounty: 10, late: true })
        expect((await readTycoonState(host)).stars).toBeNull()
    })

    it('follows a drop down without celebrating it, and celebrates the next rise from there', async () => {
        const id = newPlayer()
        db.update(players).set({ starsReported: 8, starsSeen: 8, starsSeq: 1_000_000_123 }).where(eq(players.id, id)).run()
        const drop = await coinTransaction(coins => coins.checkStars(id), id)
        expect(ownStarChange(id, drop.stars)).toMatchObject({ level: 0, previous: 8 })
        expect(seen(id).level).toBe(0)
        buyCosmetics(id, FOR_SALE)
        expect((await readTycoonState(id)).stars).toMatchObject({ level: 1, previous: 0 })
    })
})
