import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake hub: gem balances and idempotent spends we can count.
const hubGems = new Map<string, number>()
const spends = new Map<string, { spendId: string, gems: number }>()
const spent = new Map<string, { playerId: string, amount: number }>()
let hubDown = false
const spendGems = vi.fn(async (input: { playerId: string, amount: number, idempotencyKey: string }) => {
    await new Promise(resolve => setTimeout(resolve, 2))
    if (hubDown) throw new HubError('Hub unavailable', null)
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
const refundGems = vi.fn(async (spendId: string) => {
    const row = spent.get(spendId)
    if (!row) throw new HubError('Not your spend', 403)
    spent.delete(spendId)
    hubGems.set(row.playerId, (hubGems.get(row.playerId) ?? 0) + row.amount)
    return { gems: hubGems.get(row.playerId)! }
})

vi.mock('../server/utils/hub', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../server/utils/hub')>()
    return {
        ...actual,
        hub: {
            ...actual.hub,
            spendGems: (input: never) => spendGems(input),
            refundGems: (spendId: string) => refundGems(spendId),
            getPlayer: async (id: string) => ({ id, name: 'x', image: null, gems: hubGems.get(id) ?? 0, stars: 0, title: 'Newcomer' }),
            setStars: async ({ stars }: { stars: number }) => ({ applied: true, stars, best: stars, bounty: 0, total: stars, title: 'Newcomer' })
        }
    }
})

const { HubError } = await import('../server/utils/hub')
const { and, eq } = await import('drizzle-orm')
const { db } = await import('../server/database')
const { casinoCosmetics, casinoProfiles, chipTransactions, gemPurchases } = await import('../server/database/schema')
const { getTycoonState } = await import('../server/utils/tycoon')
const { buyWithGems, retryStalePurchases } = await import('../server/utils/tycoon-gems')
const { buyCosmeticWithChips, equipCosmetic, parseCosmeticBody } = await import('../server/utils/cosmetics')
const { getCasinoVisit, getLeaderboard, resetLeaderboardCache } = await import('../server/utils/social')
const C = await import('../shared/cosmetics')
const { chipLedgerSum, chipsOf, giveChips, seedPlayer } = await import('./setup/players')

beforeEach(() => {
    hubDown = false
    spendGems.mockClear()
    refundGems.mockClear()
    resetLeaderboardCache()
})

/** A player whose casino exists (backroom only, like a new one). */
function newPlayer(origin: 'hub' | 'dev' = 'hub', chips = 0) {
    const id = seedPlayer(1_000, 1_000, { casino: 'none', origin })
    getTycoonState(id)
    if (chips) giveChips(id, chips)
    return id
}

const ownedRows = (id: string) => db.select().from(casinoCosmetics).where(eq(casinoCosmetics.playerId, id)).all()
const purchasesOf = (id: string) => db.select().from(gemPurchases).where(eq(gemPurchases.playerId, id)).all()
const DECO = C.findCosmetic('skin:deco')!
const CROWN = C.findCosmetic('hat:crown')!
const ROYAL = C.findCosmetic('skin:royal')!

describe('catalog', () => {
    it('keeps prices cosmetic: avatar items in gems (5-50, premium up to ~100), basic skins in chips, premium skins in gems', () => {
        for (const def of C.COSMETICS) {
            expect(def.key).toBe(`${def.slot}:${def.id}`)
            expect(def.gems > 0 && def.chips > 0).toBe(false)
            if (def.slot !== 'skin') expect(def.chips).toBe(0)
            if (def.gems) expect(def.gems).toBeGreaterThanOrEqual(5)
            if (def.gems) expect(def.gems).toBeLessThanOrEqual(def.premium ? 100 : 50)
        }
        expect(new Set(C.COSMETICS.map(c => c.key)).size).toBe(C.COSMETICS.length)
        // The defaults are free, and every slot has a few free items.
        for (const slot of C.AVATAR_SLOTS) {
            expect(C.isFree(C.findCosmetic(`${slot}:${C.DEFAULT_AVATAR[slot]}`)!)).toBe(true)
            expect(C.cosmeticsIn(slot).filter(C.isFree).length).toBeGreaterThanOrEqual(2)
        }
        expect(C.isFree(C.findCosmetic('skin:classic')!)).toBe(true)
        const skins = C.cosmeticsIn('skin').filter(s => !C.isFree(s))
        expect(skins.filter(s => s.chips > 0).length).toBeGreaterThanOrEqual(2)
        expect(skins.filter(s => s.gems > 0).length).toBeGreaterThanOrEqual(1)
    })

    it('normalizes stored looks and skins', () => {
        expect(C.normalizeAvatar(null)).toEqual(C.DEFAULT_AVATAR)
        expect(C.normalizeAvatar({ hat: 'crown', outfit: 'nope', accessory: 3 })).toEqual({ ...C.DEFAULT_AVATAR, hat: 'crown' })
        expect(C.normalizeSkins({ main: 'royal', pit: 'classic', lounge: 'moon', highlimit: 7 })).toEqual({ main: 'royal' })
    })
})

describe('defaults and equipping', () => {
    it('starts every casino with the free defaults', () => {
        const id = newPlayer()
        expect(getTycoonState(id).cosmetics).toEqual({ avatar: C.DEFAULT_AVATAR, skins: {}, owned: [] })
    })

    it('wears free items for anyone, dev players too, and refuses items not owned', () => {
        const dev = newPlayer('dev')
        const worn = equipCosmetic(dev, { key: 'hat:cap' })
        expect(worn.state.cosmetics!.avatar).toEqual({ ...C.DEFAULT_AVATAR, hat: 'cap' })
        equipCosmetic(dev, { key: 'accessory:shades' })
        equipCosmetic(dev, { key: 'outfit:stripes' })
        expect(getTycoonState(dev).cosmetics!.avatar).toEqual({ hat: 'cap', outfit: 'stripes', accessory: 'shades' })

        expect(() => equipCosmetic(dev, { key: 'hat:crown' })).toThrow(expect.objectContaining({ statusCode: 403 }))
        expect(() => equipCosmetic(dev, { key: 'skin:deco', zone: 'backroom' })).toThrow(expect.objectContaining({ statusCode: 403 }))
        expect(getTycoonState(dev).cosmetics!.avatar.hat).toBe('cap')
    })

    it('puts skins only on owned zones; classic takes the skin off', async () => {
        const id = newPlayer('hub', 50_000)
        await buyCosmeticWithChips(id, { key: 'skin:deco' })
        expect(() => equipCosmetic(id, { key: 'skin:deco' })).toThrow(expect.objectContaining({ statusCode: 400 }))
        expect(() => equipCosmetic(id, { key: 'skin:deco', zone: 'main' })).toThrow(expect.objectContaining({ statusCode: 400 }))
        expect(equipCosmetic(id, { key: 'skin:deco', zone: 'backroom' }).state.cosmetics!.skins).toEqual({ backroom: 'deco' })
        expect(equipCosmetic(id, { key: 'skin:classic', zone: 'backroom' }).state.cosmetics!.skins).toEqual({})
    })

    it('types the request body', () => {
        for (const body of [null, {}, { key: 3 }, { key: 'hat:nope' }, { key: 'hat' }, { key: 'hat:cap', zone: 'main' }, { key: 'skin:deco', zone: 'moon' }, { key: 'skin:deco', zone: 3 }]) {
            expect(() => parseCosmeticBody(body)).toThrow(expect.objectContaining({ statusCode: 400 }))
        }
        expect(parseCosmeticBody({ key: 'skin:deco', zone: 'main' })).toEqual({ key: 'skin:deco', zone: 'main' })
        expect(parseCosmeticBody({ key: 'hat:cap' })).toEqual({ key: 'hat:cap' })
    })
})

describe('buying with chips', () => {
    it('debits the price once, owns the skin and can put it on a zone in the same step', async () => {
        const id = newPlayer('dev', 10_000)
        const bought = await buyCosmeticWithChips(id, { key: 'skin:deco', zone: 'backroom' })
        expect(chipsOf(id)).toBe(10_000 - DECO.chips)
        expect(chipLedgerSum(id)).toBe(-DECO.chips)
        expect(bought.state.chips).toBe(10_000 - DECO.chips)
        expect(bought.state.cosmetics).toMatchObject({ owned: ['skin:deco'], skins: { backroom: 'deco' } })
        expect(db.select().from(chipTransactions).where(and(eq(chipTransactions.playerId, id), eq(chipTransactions.reason, 'cosmetic:skin:deco'))).all()).toHaveLength(1)

        await expect(buyCosmeticWithChips(id, { key: 'skin:deco' })).rejects.toMatchObject({ statusCode: 409 })
        expect(chipsOf(id)).toBe(10_000 - DECO.chips)
    })

    it('keeps nothing when the chips fall short', async () => {
        const id = newPlayer('hub', DECO.chips - 1)
        await expect(buyCosmeticWithChips(id, { key: 'skin:deco' })).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Not enough chips' })
        expect(ownedRows(id)).toEqual([])
        expect(chipsOf(id)).toBe(DECO.chips - 1)
    })

    it('refuses free items and gem items', async () => {
        const id = newPlayer('hub', 100_000)
        await expect(buyCosmeticWithChips(id, { key: 'skin:classic' })).rejects.toMatchObject({ statusCode: 400 })
        await expect(buyCosmeticWithChips(id, { key: 'skin:royal' })).rejects.toMatchObject({ statusCode: 400 })
        await expect(buyCosmeticWithChips(id, { key: 'hat:crown' })).rejects.toMatchObject({ statusCode: 400 })
        expect(chipsOf(id)).toBe(100_000)
    })

    it('sells one to a burst of parallel buys', async () => {
        const id = newPlayer('hub', 100_000)
        const burst = await Promise.allSettled(Array.from({ length: 8 }, () => buyCosmeticWithChips(id, { key: 'skin:tropical' })))
        expect(burst.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(chipsOf(id)).toBe(100_000 - C.findCosmetic('skin:tropical')!.chips)
        expect(ownedRows(id)).toHaveLength(1)
    })
})

describe('buying with gems', () => {
    it('spends the gems at the hub, owns the item, and then it can be worn', async () => {
        const id = newPlayer()
        hubGems.set(id, 200)
        expect(() => equipCosmetic(id, { key: 'hat:crown' })).toThrow(expect.objectContaining({ statusCode: 403 }))
        const bought = await buyWithGems(id, { item: 'cosmetic', target: 'hat:crown' })
        expect(bought.gems).toBe(200 - CROWN.gems)
        expect(hubGems.get(id)).toBe(200 - CROWN.gems)
        expect(bought.state.cosmetics!.owned).toEqual(['hat:crown'])
        expect(purchasesOf(id)).toMatchObject([{ item: 'cosmetic', target: 'hat:crown', gems: CROWN.gems, status: 'done' }])
        expect(equipCosmetic(id, { key: 'hat:crown' }).state.cosmetics!.avatar.hat).toBe('crown')

        // A premium skin, then onto a zone.
        await buyWithGems(id, { item: 'cosmetic', target: 'skin:royal' })
        expect(hubGems.get(id)).toBe(200 - CROWN.gems - ROYAL.gems)
        expect(equipCosmetic(id, { key: 'skin:royal', zone: 'backroom' }).state.cosmetics!.skins).toEqual({ backroom: 'royal' })
    })

    it('refuses what is owned, free, sold for chips or unknown, and dev players', async () => {
        const id = newPlayer()
        hubGems.set(id, 500)
        await buyWithGems(id, { item: 'cosmetic', target: 'hat:tophat' })
        for (const target of ['hat:tophat', 'hat:cap', 'skin:deco', 'hat:nope']) {
            await expect(buyWithGems(id, { item: 'cosmetic', target })).rejects.toMatchObject({ statusCode: 400 })
        }
        expect(hubGems.get(id)).toBe(500 - C.findCosmetic('hat:tophat')!.gems)
        const dev = newPlayer('dev')
        await expect(buyWithGems(dev, { item: 'cosmetic', target: 'hat:tophat' })).rejects.toMatchObject({ statusCode: 403 })
    })

    it('leaves an unanswered purchase pending and settles it later with the same key', async () => {
        const id = newPlayer()
        hubGems.set(id, 100)
        hubDown = true
        await expect(buyWithGems(id, { item: 'cosmetic', target: 'outfit:tuxedo' })).rejects.toMatchObject({ statusCode: 503 })
        hubDown = false
        const pending = purchasesOf(id)[0]!
        expect(pending.status).toBe('pending')
        // Not delivered yet: it can't be worn, and a second buy waits for the first.
        expect(() => equipCosmetic(id, { key: 'outfit:tuxedo' })).toThrow(expect.objectContaining({ statusCode: 403 }))
        await expect(buyWithGems(id, { item: 'cosmetic', target: 'outfit:tuxedo' })).rejects.toMatchObject({ statusCode: 409 })

        db.update(gemPurchases).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(gemPurchases.id, pending.id)).run()
        expect(await retryStalePurchases(id)).toBe(1)
        expect(purchasesOf(id)[0]!.status).toBe('done')
        expect(getTycoonState(id).cosmetics!.owned).toEqual(['outfit:tuxedo'])
        expect(hubGems.get(id)).toBe(100 - C.findCosmetic('outfit:tuxedo')!.gems)
    })

    it('refunds a purchase that settles after the item was owned already', async () => {
        const id = newPlayer()
        hubGems.set(id, 200)
        await buyWithGems(id, { item: 'cosmetic', target: 'accessory:monocle' })
        db.insert(gemPurchases).values({ playerId: id, item: 'cosmetic', target: 'accessory:monocle', gems: 18, idempotencyKey: crypto.randomUUID(), createdAt: new Date(Date.now() - 120_000) }).run()
        await retryStalePurchases(id)
        expect(hubGems.get(id)).toBe(200 - 18)
        expect(refundGems).toHaveBeenCalledTimes(1)
        expect(purchasesOf(id).filter(p => p.error === 'Owned already; refunded')).toHaveLength(1)
    })

    it('sells one to a burst', async () => {
        const id = newPlayer()
        hubGems.set(id, 500)
        const burst = await Promise.allSettled(Array.from({ length: 6 }, () => buyWithGems(id, { item: 'cosmetic', target: 'hat:cowboy' })))
        expect(burst.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(hubGems.get(id)).toBe(500 - C.findCosmetic('hat:cowboy')!.gems)
        expect(ownedRows(id)).toHaveLength(1)
    })
})

describe('what others see', () => {
    it('shows the owner\'s look and zone skins on a visit and the leaderboard, and nothing private', async () => {
        const owner = newPlayer('hub', 50_000)
        hubGems.set(owner, 200)
        await buyWithGems(owner, { item: 'cosmetic', target: 'hat:crown' })
        equipCosmetic(owner, { key: 'hat:crown' })
        equipCosmetic(owner, { key: 'accessory:shades' })
        await buyCosmeticWithChips(owner, { key: 'skin:western', zone: 'backroom' })
        // A skin left on a zone that is not open is never shown.
        db.update(casinoProfiles).set({ skins: { backroom: 'western', penthouse: 'deco' } }).where(eq(casinoProfiles.playerId, owner)).run()
        const visitor = newPlayer()

        const visit = getCasinoVisit(visitor, owner)
        expect(visit.owner.avatar).toEqual({ hat: 'crown', outfit: 'classic', accessory: 'shades' })
        expect(visit.skins).toEqual({ backroom: 'western' })
        const json = JSON.stringify(visit)
        for (const secret of ['owned', 'chips', 'cosmetics', 'gems', 'coins', 'cage']) expect(json).not.toContain(`"${secret}"`)
        expect(Object.keys(visit.owner).sort()).toEqual(['avatar', 'id', 'image', 'name'])

        const row = getLeaderboard(visitor).entries.find(e => e.owner.id === owner)!
        expect(row.owner.avatar?.hat).toBe('crown')
        expect(JSON.stringify(row)).not.toContain('"owned"')
    })
})
