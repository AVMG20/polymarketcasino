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
const { STAR_SEQ_BASE, syncAllStars, syncStars } = await import('../server/utils/stars')
const { coinTransaction } = await import('../server/utils/ledger')
const { creditChips } = await import('../server/utils/chips')
const { giveChips, seedPlayer } = await import('./setup/players')
const { db } = await import('../server/database')
const { chipTransactions, players } = await import('../server/database/schema')
const { desc, eq } = await import('drizzle-orm')

// Stars follow chips (economy v2).
const credit = (playerId: string, amount: number) => coinTransaction(coins => coins.creditChips({ playerId, amount, reason: 'win:dice' }))
const debit = (playerId: string, amount: number) => coinTransaction(coins => coins.debitChips({ playerId, amount, reason: 'bet:dice' }))
/** A player whose casino holds `chips`. */
const withChips = (chips: number) => {
    const id = seedPlayer(0)
    giveChips(id, chips)
    return id
}
const lastChipId = (id: string) => db.select({ id: chipTransactions.id }).from(chipTransactions).where(eq(chipTransactions.playerId, id)).orderBy(desc(chipTransactions.id)).get()!.id
const reported = (id: string) => db.select({ level: players.starsReported, seq: players.starsSeq }).from(players).where(eq(players.id, id)).get()!

describe('star levels', () => {
    it('has ten ascending thresholds from 1k to 1M, each named by what it takes', () => {
        expect(CASINO_STARS).toHaveLength(10)
        expect(CASINO_STARS[0]!.threshold).toBe(1_000)
        expect(CASINO_STARS[9]!.threshold).toBe(1_000_000)
        expect(new Set(CASINO_STARS.map(star => star.key)).size).toBe(10)
        expect(CASINO_STARS.every(star => /^Hold [\d.]+[kM] chips$/.test(star.description))).toBe(true)
        for (let i = 1; i < CASINO_STARS.length; i++) expect(CASINO_STARS[i]!.threshold).toBeGreaterThan(CASINO_STARS[i - 1]!.threshold)
        expect(CASINO_STARS.every(star => /^[a-z0-9-]{1,40}$/.test(star.key))).toBe(true)
    })

    it('counts the thresholds at or below the balance', () => {
        expect(starLevel(0)).toBe(0)
        expect(starLevel(999.9999)).toBe(0)
        expect(starLevel(1_000)).toBe(1)
        expect(starLevel(26_000)).toBe(5)
        expect(starLevel(999_999)).toBe(9)
        expect(starLevel(5_000_000_000)).toBe(10)
        expect(currentStar(5)?.threshold).toBe(20_000)
        expect(nextStar(5)?.threshold).toBe(40_000)
        expect(currentStar(0)).toBeNull()
        expect(nextStar(10)).toBeNull()
    })
})

describe('star reports', () => {
    beforeEach(() => {
        hubDown = false
        setStars.mockClear()
    })

    it('reports a rise and a drop, each with the offset chip ledger row id as seq', async () => {
        const id = withChips(500)
        const up = await credit(id, 2_000)
        expect(up.stars).toEqual([{ playerId: id, level: 2, previous: 0, bounty: 20 }])
        const firstSeq = setStars.mock.calls[0]![0].seq
        expect(firstSeq).toBe(STAR_SEQ_BASE + lastChipId(id))
        const down = await debit(id, 1_200)
        expect(down.stars).toEqual([{ playerId: id, level: 1, previous: 2, bounty: 10 }])
        expect(setStars.mock.calls[1]![0].seq).toBeGreaterThan(firstSeq)
        expect(reported(id).level).toBe(1)
    })

    it('does not call the hub when the level stays the same', async () => {
        const id = withChips(1_500)
        db.update(players).set({ starsReported: 1 }).where(eq(players.id, id)).run()
        await credit(id, 500)
        await debit(id, 500)
        expect(setStars).not.toHaveBeenCalled()
    })

    it('retries a level still due on the next balance change, without holding up the round', async () => {
        const id = withChips(500)
        hubDown = true
        expect((await credit(id, 1_000)).stars).toEqual([])
        hubDown = false
        // A coin change moves no level: the retry runs in the background.
        expect((await coinTransaction(coins => coins.credit({ playerId: id, amount: 1_000, category: 'allowance' }))).stars).toEqual([])
        await vi.waitFor(() => expect(reported(id).level).toBe(1))
        expect(lastSeq.get(id)!.stars).toBe(1)
    })

    it('keeps a level due while the hub is down and reports it later', async () => {
        const id = withChips(500)
        hubDown = true
        expect((await credit(id, 1_000)).stars).toEqual([])
        expect(reported(id).level).toBe(0)
        hubDown = false
        expect(await syncStars(id)).toMatchObject({ level: 1, previous: 0 })
        expect(await syncStars(id)).toBeNull()
    })

    it('ends at the latest level when reports race', async () => {
        const id = withChips(500)
        await Promise.all([credit(id, 1_000), credit(id, 2_000), credit(id, 2_000)])
        await syncStars(id)
        expect(reported(id).level).toBe(starLevel(5_500))
        expect(lastSeq.get(id)!.stars).toBe(3)
    })

    it('never reports for dev-login players', async () => {
        const id = withChips(5_000)
        db.update(players).set({ origin: 'dev' }).where(eq(players.id, id)).run()
        await credit(id, 1_000_000)
        expect(setStars).not.toHaveBeenCalled()
    })

    it('never counts coins', async () => {
        const id = seedPlayer(0)
        const result = await coinTransaction(coins => coins.credit({ playerId: id, amount: 5_000_000, category: 'convert' }))
        expect(result.stars).toEqual([])
        expect(setStars).not.toHaveBeenCalled()
        expect(await syncStars(id)).toBeNull()
    })

    it('reports a level held from the coin era past its old coin seq', async () => {
        // Stars 3 reported under a coin ledger id; the casino holds no chips.
        const id = withChips(0)
        db.update(players).set({ starsReported: 3, starsSeq: 987_654 }).where(eq(players.id, id)).run()
        lastSeq.set(id, { seq: 987_654, stars: 3 })
        expect(await syncAllStars()).toBeGreaterThanOrEqual(1)
        expect(reported(id)).toEqual({ level: 0, seq: STAR_SEQ_BASE })
        expect(lastSeq.get(id)).toEqual({ seq: STAR_SEQ_BASE, stars: 0 })
    })

    it('refuses a chip move outside a coin transaction (stars could not follow it)', () => {
        const id = withChips(0)
        expect(() => db.transaction(tx => creditChips(tx, { playerId: id, amount: 10, reason: 'win:dice' }))).toThrow(/coinTransaction/)
    })
})
