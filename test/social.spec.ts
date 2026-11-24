import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { eq } = await import('drizzle-orm')
const { db } = await import('../server/database')
const { casinoConstructions, casinoLikes, casinoProfiles } = await import('../server/database/schema')
const { getCasinoVisit, getLeaderboard, likeCasino, parsePlayerParam, resetLeaderboardCache } = await import('../server/utils/social')
const { casinoTier, casinoValue, LEADERBOARD_SIZE } = await import('../shared/social')
const T = await import('../shared/tycoon')
const { seedPlayer, coinsOf } = await import('./setup/players')
const { playRound } = await import('../server/utils/rounds')
const { startStepRound } = await import('../server/utils/steps')
const { BlackjackTable } = await import('../server/utils/tables/blackjack')
const { hostHasGame, parseHost } = await import('../server/utils/social')
const { seededRng } = await import('../shared/rng')

const HOUR = 3_600_000

/** A player whose casino has exactly this build (backroom starters unless given). */
function casino(build: { zones?: string[], games?: Record<string, number>, upgrades?: Record<string, number>, golden?: string[], chips?: number } = {}) {
    const id = seedPlayer(5_000, 5_000, { chips: build.chips ?? 0 })
    db.update(casinoProfiles).set({
        zones: build.zones ?? ['backroom'],
        games: build.games ?? { plinko: 1, spinata: 1 },
        upgrades: { cage: 0, marketing: 0, decor: 0, ...build.upgrades },
        golden: build.golden ?? []
    }).where(eq(casinoProfiles.playerId, id)).run()
    return id
}

const chipsOf = (kind: 'zone' | 'game' | 'upgrade', id: string, levels = 1) => {
    if (kind === 'zone') return T.findZone(id)!.cost.chips
    const def = kind === 'game' ? T.findTycoonGame(id)! : T.findUpgrade(id)!
    return def.levels.slice(0, levels).reduce((sum, cost) => sum + cost.chips, 0)
}

beforeEach(() => {
    db.delete(casinoLikes).run()
    // Only this file's casinos: start each test from an empty board.
    db.delete(casinoProfiles).run()
    resetLeaderboardCache()
})

describe('casino value', () => {
    it('is the chips everything finished cost at catalog prices', () => {
        expect(casinoValue({ zones: ['backroom'], games: { plinko: 1, spinata: 1 }, upgrades: { cage: 0, marketing: 0, decor: 0 } })).toBe(0)
        const value = casinoValue({ zones: ['backroom', 'main'], games: { plinko: 3, spinata: 1, limbo: 2, roulette: 1 }, upgrades: { cage: 2, marketing: 0, decor: 1 } })
        expect(value).toBe(chipsOf('zone', 'main') + chipsOf('game', 'plinko', 3) + chipsOf('game', 'limbo', 2) + chipsOf('game', 'roulette')
            + chipsOf('upgrade', 'cage', 2) + chipsOf('upgrade', 'decor'))
        // Starters' first level is free.
        expect(chipsOf('game', 'plinko', 1)).toBe(0)
        expect(value).toBeGreaterThan(0)
    })

    it('ignores unknown and out-of-range entries', () => {
        const base = casinoValue({ zones: ['backroom'], games: { limbo: 5 }, upgrades: { cage: 0, marketing: 0, decor: 0 } })
        expect(casinoValue({ zones: ['backroom', 'moon'] as never, games: { limbo: 9, nope: 3 }, upgrades: { cage: 0, marketing: 0, decor: 0, houseCut: 4 } as never })).toBe(base)
    })

    it('names the furthest zone as the tier', () => {
        expect(casinoTier(['backroom'])).toBe('backroom')
        expect(casinoTier(['backroom', 'main', 'pit'])).toBe('pit')
    })
})

describe('leaderboard', () => {
    it('ranks casinos by value, most valuable first, with the player pinned', () => {
        const small = casino({ games: { plinko: 1, spinata: 1, limbo: 1 } })
        const big = casino({ zones: ['backroom', 'main', 'pit'], games: { plinko: 2, spinata: 1, roulette: 3, blackjack: 1 }, upgrades: { decor: 2 } })
        const mid = casino({ zones: ['backroom', 'main'], games: { plinko: 1, spinata: 1, roulette: 1 } })
        const fresh = casino()

        const board = getLeaderboard(fresh)
        expect(board.entries.map(e => e.owner.id)).toEqual([big, mid, small, fresh])
        expect(board.entries.map(e => e.rank)).toEqual([1, 2, 3, 4])
        expect(board.total).toBe(4)
        expect(board.me?.owner.id).toBe(fresh)
        expect(board.me?.rank).toBe(4)
        const top = board.entries[0]!
        expect(top.value).toBe(casinoValue({ zones: ['backroom', 'main', 'pit'], games: { plinko: 2, roulette: 3, blackjack: 1 }, upgrades: { cage: 0, marketing: 0, decor: 2 } }))
        expect(top.tier).toBe('pit')
        expect(top.zones).toEqual(['backroom', 'main', 'pit'])
        expect(top.games).toBe(4)
        expect(top.owner.name).toBe('Test player')
        // No balances on the board.
        expect(Object.keys(top).sort()).toEqual(['games', 'likes', 'owner', 'progress', 'rank', 'tier', 'value', 'zones'])
    })

    it('lists the top 50 and still gives a player outside it their rank', () => {
        const ids = Array.from({ length: LEADERBOARD_SIZE + 5 }, (_, i) => casino({ games: { plinko: 1, spinata: 1, limbo: 1 + (i % 5) } }))
        const last = casino()
        const board = getLeaderboard(last)
        expect(board.entries).toHaveLength(LEADERBOARD_SIZE)
        expect(board.total).toBe(ids.length + 1)
        expect(board.me?.rank).toBe(ids.length + 1)
        expect(board.entries.some(e => e.owner.id === last)).toBe(false)
        for (let i = 1; i < board.entries.length; i++) expect(board.entries[i - 1]!.value).toBeGreaterThanOrEqual(board.entries[i]!.value)
    })

    it('counts a construction that finished but was not applied yet', () => {
        const now = Date.now()
        const id = casino()
        const other = casino({ games: { plinko: 1, spinata: 1, limbo: 1 } })
        db.insert(casinoConstructions).values({ playerId: id, kind: 'game', target: 'wheel', level: 1, startedAt: new Date(now - HOUR), readyAt: new Date(now - 1) }).run()
        db.insert(casinoConstructions).values({ playerId: id, kind: 'game', target: 'limbo', level: 1, startedAt: new Date(now - HOUR), readyAt: new Date(now + HOUR) }).run()
        const board = getLeaderboard(id, now)
        expect(board.me?.value).toBe(chipsOf('game', 'wheel'))
        expect(board.entries[0]!.owner.id).toBe(id)
        expect(board.entries[1]!.owner.id).toBe(other)
    })

    it('breaks a tie on hearts', () => {
        const a = casino()
        const b = casino()
        const fan = casino()
        likeCasino(fan, b)
        const board = getLeaderboard(fan)
        expect(board.entries.findIndex(e => e.owner.id === b)).toBeLessThan(board.entries.findIndex(e => e.owner.id === a))
        expect(board.entries.find(e => e.owner.id === b)?.likes).toBe(1)
    })

    it('caches the ranking for a few seconds', () => {
        const now = Date.now()
        const a = casino()
        const first = getLeaderboard(a, now)
        casino({ zones: ['backroom', 'main'] })
        expect(getLeaderboard(a, now + 1_000).total).toBe(first.total)
        expect(getLeaderboard(a, now + 6_000).total).toBe(first.total + 1)
    })
})

describe('visiting', () => {
    it('shows the build and none of the private data', () => {
        const now = Date.now()
        const owner = casino({
            zones: ['backroom', 'main'],
            games: { plinko: 3, spinata: 1, roulette: 2, limbo: 0 },
            upgrades: { decor: 2, cage: 1, marketing: 1 },
            golden: ['roulette'],
            chips: 987_654.3210
        })
        db.update(casinoProfiles).set({ campaign: 'flyers', campaignUntil: new Date(now + HOUR), cageStored: 8_675.3 }).where(eq(casinoProfiles.playerId, owner)).run()
        db.insert(casinoConstructions).values({ playerId: owner, kind: 'game', target: 'wheel', level: 1, startedAt: new Date(now), readyAt: new Date(now + HOUR) }).run()
        const visitor = casino()

        const visit = getCasinoVisit(visitor, owner, now)
        expect(visit.owner).toEqual({ id: owner, name: 'Test player', image: null, avatar: { hat: 'none', outfit: 'classic', accessory: 'none', hair: 'auto', haircolor: 'auto', skintone: 'auto' } })
        expect(visit.zones).toEqual(['backroom', 'main'])
        expect(visit.games).toEqual({ plinko: 3, spinata: 1, roulette: 2 })
        expect(visit.golden).toEqual(['roulette'])
        expect(visit.decor).toBe(2)
        expect(visit.campaign).toBe('flyers')
        expect(visit.seats).toBe(T.floorSeats({ games: visit.games }))
        expect(visit.visitors).toBeGreaterThan(0)
        expect(visit.visitors).toBeLessThanOrEqual(visit.seats)
        expect(visit.value).toBe(getLeaderboard(visitor, now).entries.find(e => e.owner.id === owner)!.value)
        expect(visit.rank).toBe(1)
        expect(visit.likedToday).toBe(false)

        // No balances, no cage, no constructions, no gems.
        const json = JSON.stringify(visit)
        for (const key of ['chips', 'coins', 'cage', 'constructions', 'builders', 'gems', 'rush', 'rushUntil', 'upgrades', 'peakCoins']) {
            expect(json).not.toContain(`"${key}"`)
        }
        expect(json).not.toContain('987654')
        expect(json).not.toContain('8675.3')
        expect(json).not.toContain('wheel')
    })

    it('refuses a player without a casino and a malformed id', () => {
        const visitor = casino()
        const nobody = seedPlayer(0, 0, { casino: 'none' })
        expect(() => getCasinoVisit(visitor, nobody)).toThrow(/does not exist/)
        expect(() => getCasinoVisit(visitor, 'no-such-player')).toThrow(/does not exist/)
        for (const bad of [undefined, '', 'a/b', '../x', 'x'.repeat(200), 42]) {
            expect(() => parsePlayerParam(bad)).toThrow(/No such player/)
        }
        expect(parsePlayerParam('Hx9YnsKn_RoF-YYL2p6')).toBe('Hx9YnsKn_RoF-YYL2p6')
    })
})

describe('hearts', () => {
    it('leaves one heart per visitor, casino and day', () => {
        const now = Date.now()
        const owner = casino()
        const visitor = casino()
        expect(likeCasino(visitor, owner, now)).toEqual({ likes: 1, liked: true })
        expect(likeCasino(visitor, owner, now + 1_000)).toEqual({ likes: 1, liked: false })
        expect(getCasinoVisit(visitor, owner, now).likedToday).toBe(true)
        expect(getCasinoVisit(owner, owner, now).likedToday).toBe(false)
        // Another visitor, and the same visitor tomorrow.
        expect(likeCasino(casino(), owner, now)).toEqual({ likes: 2, liked: true })
        expect(likeCasino(visitor, owner, now + 25 * HOUR)).toEqual({ likes: 3, liked: true })
        expect(getCasinoVisit(visitor, owner, now + 25 * HOUR).likes).toBe(3)
    })

    it('keeps one heart from a burst of parallel taps', async () => {
        const owner = casino()
        const visitor = casino()
        const results = await Promise.all(Array.from({ length: 25 }, () => Promise.resolve().then(() => likeCasino(visitor, owner))))
        expect(results.filter(r => r.liked)).toHaveLength(1)
        expect(results.every(r => r.likes === 1)).toBe(true)
        expect(db.select().from(casinoLikes).where(eq(casinoLikes.ownerId, owner)).all()).toHaveLength(1)
    })

    it('refuses your own casino and a casino that does not exist', () => {
        const owner = casino()
        expect(() => likeCasino(owner, owner)).toThrow(/own casino/)
        const nobody = seedPlayer(0, 0, { casino: 'none' })
        expect(() => likeCasino(owner, nobody)).toThrow(/does not exist/)
        expect(db.select().from(casinoLikes).all()).toHaveLength(0)
    })

    it('moves no money', () => {
        const owner = casino({ chips: 100 })
        const visitor = casino({ chips: 50 })
        likeCasino(visitor, owner)
        const chips = (id: string) => db.select({ chips: casinoProfiles.chips }).from(casinoProfiles).where(eq(casinoProfiles.playerId, id)).get()!.chips
        expect(chips(owner)).toBe(100)
        expect(chips(visitor)).toBe(50)
    })
})

describe('playing in a visited casino', () => {
    /** A dev player (no hub) whose casino has only the backroom starters, with coins to bet. */
    const visitor = () => {
        const id = seedPlayer(10_000, 10_000, { origin: 'dev' })
        db.update(casinoProfiles).set({ zones: ['backroom'], games: { plinko: 1, spinata: 1 } }).where(eq(casinoProfiles.playerId, id)).run()
        return id
    }
    const host = () => casino({ zones: ['backroom', 'main', 'pit', 'lounge', 'highlimit', 'penthouse'], games: { plinko: 1, spinata: 1, limbo: 2, blackjack: 1, mines: 1 } })

    it('plays a game the host built with the player\'s own coins', async () => {
        const me = visitor()
        const owner = host()
        await expect(playRound(me, 'limbo', { bet: 100, options: { target: 2 } })).rejects.toThrow(/Build Limbo/)
        const round = await playRound(me, 'limbo', { bet: 100, options: { target: 2 }, host: owner })
        expect(round.stake).toBe(100)
        // The visitor paid; the host's casino and balances are untouched.
        expect(coinsOf(me).coins).toBe(9_900)
        expect(coinsOf(owner).coins).toBe(5_000)
        const step = await startStepRound(me, 'mines', { bet: 100, options: { mines: 3 }, host: owner })
        expect(step.round.status).toBe('open')
    })

    it('refuses when neither casino has the game, and a bogus host', async () => {
        const me = visitor()
        const owner = casino()
        await expect(playRound(me, 'limbo', { bet: 100, options: { target: 2 }, host: owner })).rejects.toThrow(/Build Limbo/)
        await expect(playRound(me, 'limbo', { bet: 100, options: { target: 2 }, host: 'no-such-player' })).rejects.toThrow(/Build Limbo/)
        const casinoless = seedPlayer(0, 0, { casino: 'none' })
        await expect(playRound(me, 'plinko', { bet: 100, options: { rows: 8, risk: 'low', balls: 1 }, host: casinoless })).resolves.toBeTruthy()
        expect(hostHasGame(casinoless, 'plinko')).toBe(false)
        for (const bad of [42, '', 'a/b', ['x'], { id: owner }]) {
            await expect(playRound(me, 'limbo', { bet: 100, options: { target: 2 }, host: bad })).rejects.toThrow(/host/)
        }
        expect(parseHost(undefined)).toBeNull()
        expect(parseHost(null)).toBeNull()
        expect(coinsOf(me).coins).toBe(9_900)
    })

    describe('live tables', () => {
        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
        })
        afterEach(() => {
            vi.useRealTimers()
        })

        it('seats a visitor at a table the host built', () => {
            const table = new BlackjackTable(seededRng(1))
            const me = visitor()
            const owner = host()
            const empty = casino()
            expect(() => table.run(() => table.sit(me, 'Me', null, 0))).toThrow(/Build Blackjack/)
            expect(() => table.run(() => table.sit(me, 'Me', null, 0, empty))).toThrow(/Build Blackjack/)
            expect(() => table.run(() => table.sit(me, 'Me', null, 0, 'no-such-player'))).toThrow(/Build Blackjack/)
            table.run(() => table.sit(me, 'Me', null, 0, owner))
            expect(table.seatIndexOf(me)).toBe(0)
            table.run(() => table.leave(me))
        })
    })
})
