import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake hub with a gem balance per player and idempotent spends, like the real one.
const hubGems = new Map<string, number>()
const spends = new Map<string, { spendId: string, playerId: string, amount: number, gems: number }>()
let hubDown = false
/** The hub refuses before its idempotency lookup (bad key, rate limit, …) with this status. */
let refuseWith: number | null = null
/** The spend commits at the hub, but the answer never reaches the casino. */
let loseAnswer = false
const spendGems = vi.fn(async (input: { playerId: string, amount: number, idempotencyKey: string }) => {
    await new Promise(resolve => setTimeout(resolve, 2))
    if (hubDown) throw new HubError('Hub unavailable', null)
    if (refuseWith) throw new HubError(`Refused with ${refuseWith}`, refuseWith)
    const replay = spends.get(input.idempotencyKey)
    if (replay) return { spendId: replay.spendId, gems: replay.gems }
    const have = hubGems.get(input.playerId) ?? 0
    if (have < input.amount) throw new HubError('Not enough gems', 400)
    hubGems.set(input.playerId, have - input.amount)
    const spend = { spendId: crypto.randomUUID(), playerId: input.playerId, amount: input.amount, gems: have - input.amount }
    spends.set(input.idempotencyKey, spend)
    if (loseAnswer) throw new HubError('The operation timed out', null)
    return { spendId: spend.spendId, gems: spend.gems }
})

vi.mock('../server/utils/hub', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../server/utils/hub')>()
    return {
        ...actual,
        hub: {
            ...actual.hub,
            spendGems: (input: never) => spendGems(input),
            getPlayer: async (id: string) => ({ id, name: 'x', image: null, gems: hubGems.get(id) ?? 0, stars: 0, title: 'Newcomer' }),
            setStars: async ({ stars }: { stars: number }) => ({ applied: true, stars, best: stars, bounty: 0, total: stars, title: 'Newcomer' })
        }
    }
})

const { HubError } = await import('../server/utils/hub')
const { convertGems, getWallet, retryStaleConversions, settleConversion, spendNeverLanded } = await import('../server/utils/wallet')
const { coinsOf, ledgerSum, seedPlayer } = await import('./setup/players')
const { db } = await import('../server/database')
const { gemConversions, players } = await import('../server/database/schema')
const { eq } = await import('drizzle-orm')

beforeEach(() => {
    hubDown = false
    refuseWith = null
    loseAnswer = false
    spendGems.mockClear()
})

const conversionsOf = (id: string) => db.select().from(gemConversions).where(eq(gemConversions.playerId, id)).all()
const makeStale = (conversionId: string) => db.update(gemConversions)
    .set({ createdAt: new Date(Date.now() - 120_000) })
    .where(eq(gemConversions.id, conversionId)).run()

describe('gem conversion', () => {
    it('spends gems at the hub and credits 1,000 coins per gem', async () => {
        // A new player (no casino yet): no goal is due.
        const id = seedPlayer(0, 0, { casino: 'none' })
        hubGems.set(id, 50)
        const result = await convertGems(id, 25)
        expect(result).toMatchObject({ gems: 25, coins: 25_000, balance: 25_000, gemsLeft: 25 })
        // Coins reach no casino goal: a conversion reports no star.
        expect(result.stars).toBeNull()
        expect(coinsOf(id).coins).toBe(25_000)
    })

    it('never double-credits parallel conversions: each paid spend credits exactly once', async () => {
        const id = seedPlayer()
        hubGems.set(id, 30)
        const results = await Promise.allSettled(Array.from({ length: 8 }, () => convertGems(id, 10)))
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(3)
        expect(hubGems.get(id)).toBe(0)
        expect(coinsOf(id).coins).toBe(30_000)
        const rows = db.select().from(gemConversions).where(eq(gemConversions.playerId, id)).all()
        expect(rows.filter(row => row.status === 'done')).toHaveLength(3)
        expect(rows.filter(row => row.status === 'failed')).toHaveLength(5)
    })

    it('settles one pending row once even when retried in parallel', async () => {
        const id = seedPlayer()
        hubGems.set(id, 5)
        const row = db.insert(gemConversions).values({ playerId: id, gems: 5, coins: 5_000, idempotencyKey: crypto.randomUUID() }).returning().get()
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => settleConversion(row)))
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(coinsOf(id).coins).toBe(5_000)
        expect(hubGems.get(id)).toBe(0)
    })

    it('leaves the row pending when the hub is down and settles it on a later retry with the same key', async () => {
        const id = seedPlayer()
        hubGems.set(id, 10)
        hubDown = true
        await expect(convertGems(id, 10)).rejects.toMatchObject({ statusCode: 503 })
        const [pending] = db.select().from(gemConversions).where(eq(gemConversions.playerId, id)).all()
        expect(pending!.status).toBe('pending')

        // Make it look abandoned, then bring the hub back.
        db.update(gemConversions).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(gemConversions.id, pending!.id)).run()
        hubDown = false
        expect(await retryStaleConversions(id)).toBe(1)
        expect(coinsOf(id).coins).toBe(10_000)
        const keys = spendGems.mock.calls.map(([input]) => input.idempotencyKey)
        expect(new Set(keys).size).toBe(1)
    })

    it('marks the row failed and credits nothing when the player cannot afford it', async () => {
        const id = seedPlayer()
        hubGems.set(id, 3)
        await expect(convertGems(id, 10)).rejects.toMatchObject({ statusCode: 400 })
        expect(coinsOf(id).coins).toBe(0)
    })

    it('credits a spend whose answer was lost exactly once, even when a retry is refused first', async () => {
        const id = seedPlayer()
        hubGems.set(id, 20)
        // The hub commits the spend, but the casino never hears back.
        loseAnswer = true
        await expect(convertGems(id, 20)).rejects.toMatchObject({ statusCode: 503 })
        expect(hubGems.get(id)).toBe(0)
        loseAnswer = false
        const [pending] = conversionsOf(id)
        makeStale(pending!.id)

        // A retry refused before the hub's idempotency lookup proves nothing: still pending.
        for (const status of [429, 401, 403, 409]) {
            refuseWith = status
            expect(await retryStaleConversions(id)).toBe(0)
            expect(conversionsOf(id)[0]!.status).toBe('pending')
        }
        refuseWith = null

        // Then the hub replays the original spend: coins land once, no second charge.
        const settled = await Promise.all(Array.from({ length: 5 }, () => retryStaleConversions(id)))
        expect(settled.reduce((a, b) => a + b, 0)).toBe(1)
        expect(coinsOf(id).coins).toBe(20_000)
        expect(ledgerSum(id)).toBe(20_000)
        expect(conversionsOf(id)[0]!.status).toBe('done')
        expect(new Set(spendGems.mock.calls.map(([input]) => input.idempotencyKey)).size).toBe(1)
    })

    it('marks a first attempt failed when the hub refuses it outright', async () => {
        const id = seedPlayer()
        hubGems.set(id, 50)
        refuseWith = 429
        await expect(convertGems(id, 5)).rejects.toMatchObject({ statusCode: 400 })
        expect(conversionsOf(id)[0]!.status).toBe('failed')
        expect(hubGems.get(id)).toBe(50)
        expect(coinsOf(id).coins).toBe(0)
    })

    it('fails a conversion only on a refusal that proves nothing was spent', () => {
        expect(spendNeverLanded(new HubError('Not enough gems', 400), false)).toBe(true)
        expect(spendNeverLanded(new HubError('Rate limited', 429), true)).toBe(true)
        expect(spendNeverLanded(new HubError('Rate limited', 429), false)).toBe(false)
        expect(spendNeverLanded(new HubError('Not connected', 403), false)).toBe(false)
        expect(spendNeverLanded(new HubError('Bad gateway', 502), true)).toBe(false)
        expect(spendNeverLanded(new HubError('Unreachable', null), true)).toBe(false)
    })

    it('validates the amount and needs a hub account', async () => {
        const { parseGemAmount } = await import('../server/utils/wallet')
        expect(() => parseGemAmount(0)).toThrow()
        expect(() => parseGemAmount(101)).toThrow()
        expect(() => parseGemAmount(2.5)).toThrow()
        const dev = seedPlayer()
        db.update(players).set({ origin: 'dev' }).where(eq(players.id, dev)).run()
        await expect(convertGems(dev, 5)).rejects.toMatchObject({ statusCode: 400 })
        expect(spendGems).not.toHaveBeenCalled()
        expect(await getWallet(dev)).toMatchObject({ hubAccount: false, gems: null })
    })
})
