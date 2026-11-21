import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CASINO_STARS, currentStar, nextStar, starLevel } from '../shared/stars'

// The fake hub keeps the last applied seq per player, like the real one.
const lastSeq = new Map<string, { seq: number, stars: number }>()
let hubDown = false
const setStars = vi.fn(async ({ playerId, stars, seq }: { playerId: string, stars: number, seq: number }) => {
    await new Promise(resolve => setTimeout(resolve, 2))
    if (hubDown) throw new HubError('Hub unavailable', null)
    const last = lastSeq.get(playerId)
    if (last && seq <= last.seq) return { applied: false, stars: last.stars, best: last.stars, bounty: 0, total: last.stars, title: 'Newcomer' }
    lastSeq.set(playerId, { seq, stars })
    return { applied: true, stars, best: stars, bounty: stars * 10, total: stars, title: 'Newcomer' }
})

vi.mock('../server/utils/hub', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../server/utils/hub')>()
    return { ...actual, hub: { ...actual.hub, setStars: (input: never) => setStars(input) } }
})

const { HubError } = await import('../server/utils/hub')
const { syncStars } = await import('../server/utils/stars')
const { coinTransaction } = await import('../server/utils/ledger')
const { seedPlayer } = await import('./setup/players')
const { db } = await import('../server/database')
const { players } = await import('../server/database/schema')
const { eq } = await import('drizzle-orm')

const credit = (playerId: string, amount: number) => coinTransaction(coins => coins.credit({ playerId, amount, category: 'dice' }))
const debit = (playerId: string, amount: number) => coinTransaction(coins => coins.debit({ playerId, amount, category: 'dice' }))
const reported = (id: string) => db.select({ level: players.starsReported, seq: players.starsSeq }).from(players).where(eq(players.id, id)).get()!

describe('star levels', () => {
    it('has ten ascending thresholds from 10k to 100M', () => {
        expect(CASINO_STARS).toHaveLength(10)
        expect(CASINO_STARS[0]!.threshold).toBe(10_000)
        expect(CASINO_STARS[9]!.threshold).toBe(100_000_000)
        for (let i = 1; i < CASINO_STARS.length; i++) expect(CASINO_STARS[i]!.threshold).toBeGreaterThan(CASINO_STARS[i - 1]!.threshold)
        expect(CASINO_STARS.every(star => /^[a-z0-9-]{1,40}$/.test(star.key))).toBe(true)
    })

    it('counts the thresholds at or below the balance', () => {
        expect(starLevel(0)).toBe(0)
        expect(starLevel(9_999)).toBe(0)
        expect(starLevel(10_000)).toBe(1)
        expect(starLevel(260_000)).toBe(4)
        expect(starLevel(5_000_000_000)).toBe(10)
        expect(currentStar(4)?.threshold).toBe(250_000)
        expect(nextStar(4)?.threshold).toBe(500_000)
        expect(currentStar(0)).toBeNull()
        expect(nextStar(10)).toBeNull()
    })
})

describe('star reports', () => {
    beforeEach(() => {
        hubDown = false
        setStars.mockClear()
    })

    it('reports a rise and a drop, each with the ledger row id as seq', async () => {
        const id = seedPlayer(5_000)
        const up = await credit(id, 60_000)
        expect(up.stars).toEqual([{ playerId: id, level: 2, previous: 0, bounty: 20 }])
        const firstSeq = setStars.mock.calls[0]![0].seq
        const down = await debit(id, 50_000)
        expect(down.stars).toEqual([{ playerId: id, level: 1, previous: 2, bounty: 10 }])
        expect(setStars.mock.calls[1]![0].seq).toBeGreaterThan(firstSeq)
        expect(reported(id).level).toBe(1)
    })

    it('does not call the hub when the level stays the same', async () => {
        const id = seedPlayer(20_000)
        db.update(players).set({ starsReported: 1 }).where(eq(players.id, id)).run()
        await credit(id, 5_000)
        await debit(id, 5_000)
        expect(setStars).not.toHaveBeenCalled()
    })

    it('retries a level still due on the next balance change, without holding up the round', async () => {
        const id = seedPlayer(5_000)
        hubDown = true
        expect((await credit(id, 10_000)).stars).toEqual([])
        hubDown = false
        // Level 1 either side of this change: the retry runs in the background.
        expect((await debit(id, 1_000)).stars).toEqual([])
        await vi.waitFor(() => expect(reported(id).level).toBe(1))
        expect(lastSeq.get(id)!.stars).toBe(1)
    })

    it('keeps a level due while the hub is down and reports it later', async () => {
        const id = seedPlayer(5_000)
        hubDown = true
        expect((await credit(id, 10_000)).stars).toEqual([])
        expect(reported(id).level).toBe(0)
        hubDown = false
        expect(await syncStars(id)).toMatchObject({ level: 1, previous: 0 })
        expect(await syncStars(id)).toBeNull()
    })

    it('ends at the latest level when reports race', async () => {
        const id = seedPlayer(5_000)
        await Promise.all([credit(id, 10_000), credit(id, 50_000), credit(id, 100_000)])
        await syncStars(id)
        expect(reported(id).level).toBe(starLevel(165_000))
        expect(lastSeq.get(id)!.stars).toBe(3)
    })

    it('never reports for dev-login players', async () => {
        const id = seedPlayer(5_000)
        db.update(players).set({ origin: 'dev' }).where(eq(players.id, id)).run()
        await credit(id, 1_000_000)
        expect(setStars).not.toHaveBeenCalled()
    })
})
