import { and, eq, like } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../server/database'
import { casinoProfiles, chipTransactions, coinTransactions, players, stepRounds } from '../server/database/schema'
import { floorPresence } from '../server/utils/floor-socket'
import { onVisitorRakeback, type VisitorRakeback } from '../server/utils/rakeback'
import { playRound } from '../server/utils/rounds'
import { actStepRound, cashOutStepRound, settleAbandonedRounds, startStepRound } from '../server/utils/steps'
import { refundWagers, settleWagers, stakeWagers } from '../server/utils/tables/escrow'
import { collectCage, getTycoonState } from '../server/utils/tycoon'
import type { PresenceServerMessage } from '../shared/floor-presence'
import { WELCOME_AFTER_MS } from '../shared/missions'
import { normalizeCoins } from '../shared/money'
import { RAKEBACK, rakebackOf } from '../shared/rakeback'
import { cageCapacity } from '../shared/tycoon'
import { chipLedgerSum, chipsOf, coinsOf, ledgerSum, seedPlayer } from './setup/players'

/** A dev player (no hub) with coins and only the backroom starters, or every game when `all`. */
function player(coins = 10_000, all = false) {
    const id = seedPlayer(coins, coins, { origin: 'dev' })
    if (!all) db.update(casinoProfiles).set({ zones: ['backroom'], games: { plinko: 1, spinata: 1 } }).where(eq(casinoProfiles.playerId, id)).run()
    return id
}

/** The jar's rakeback pots of `id` (coins). */
function pots(id: string) {
    const row = db.select({ rakeback: casinoProfiles.cageRakeback, visitors: casinoProfiles.cageVisitors }).from(casinoProfiles).where(eq(casinoProfiles.playerId, id)).get()
    return row ?? { rakeback: 0, visitors: 0 }
}

/** Chip ledger rows of `id` whose reason starts with `prefix` (the rakeback must leave none). */
function chipRows(id: string, prefix: string) {
    return db.select({ amount: chipTransactions.amount, reason: chipTransactions.reason })
        .from(chipTransactions)
        .where(and(eq(chipTransactions.playerId, id), like(chipTransactions.reason, `${prefix}%`)))
        .all()
}

/** Coin ledger credits of `id` in `category`. */
function coinCredits(id: string, category: string) {
    return db.select({ amount: coinTransactions.amount }).from(coinTransactions)
        .where(and(eq(coinTransactions.playerId, id), eq(coinTransactions.category, category), eq(coinTransactions.type, 'credit')))
        .all()
        .map(row => row.amount)
}

/** A tile without a bomb in the Gem Dig round `roundId`. */
function safeTile(roundId: string): number {
    const state = db.select({ state: stepRounds.state }).from(stepRounds).where(eq(stepRounds.id, roundId)).get()!.state as { bombs: number[] }
    let tile = 0
    while (state.bombs.includes(tile)) tile++
    return tile
}

const DICE = { options: { chance: 50 } }
const PLINKO = { bet: 100, options: { rows: 8, risk: 'low', balls: 1 } }

describe('rakeback', () => {
    it('is 1% of the stake, rounded down to 0.0001, and nothing for a stake too small', () => {
        expect(RAKEBACK).toBe(0.01)
        expect(rakebackOf(100)).toBe(1)
        expect(rakebackOf(10.0001)).toBe(0.1)
        expect(rakebackOf(1_234.5678)).toBe(12.3456)
        expect(rakebackOf(0.0199)).toBe(0.0001)
        expect(rakebackOf(0.0099)).toBe(0)
        expect(rakebackOf(0)).toBe(0)
    })

    it("puts 1% of a round in the player's own cage as coins, in the same unit as the round", async () => {
        const me = player(10_000, true)
        const round = await playRound(me, 'dice', { bet: 250, ...DICE })
        expect(round).toMatchObject({ rakeback: 2.5, rakebackPot: 2.5 })
        // No chips for it: the chip balance is the payout alone, and no chip row says rakeback.
        expect(round.chips).toBe(round.payout)
        expect(chipsOf(me)).toBe(round.payout)
        expect(chipRows(me, 'rakeback:')).toEqual([])
        expect(pots(me)).toEqual({ rakeback: 2.5, visitors: 0 })
        // Coins in the cage, not in the balance yet: only the stake moved.
        expect(coinsOf(me).coins).toBe(9_750)
        // A host that is the player themselves is their own casino.
        const own = await playRound(me, 'dice', { bet: 100, ...DICE, host: me })
        expect(own).toMatchObject({ rakeback: 1, rakebackPot: 3.5 })
        expect(pots(me)).toEqual({ rakeback: 3.5, visitors: 0 })
        expect(getTycoonState(me).cage).toMatchObject({ rakeback: 3.5, visitors: 0 })
    })

    it("puts it in the host's visitors pot, not the player's, for a round in the host's casino", async () => {
        const me = player()
        const owner = player(0, true)
        const round = await playRound(me, 'dice', { bet: 1_000, ...DICE, host: owner })
        expect(round).toMatchObject({ rakeback: 0, rakebackPot: null })
        expect(round.chips).toBe(round.payout)
        expect(pots(me)).toEqual({ rakeback: 0, visitors: 0 })
        expect(pots(owner)).toEqual({ rakeback: 0, visitors: 10 })
        // Nothing moved for the owner: no chips, no coins, no rows until they collect.
        expect(chipsOf(owner)).toBe(0)
        expect(chipRows(owner, '')).toEqual([])
        expect(coinsOf(owner).coins).toBe(0)
        // A game the player built too still pays the host when played in the host's casino.
        const mine = await playRound(me, 'plinko', { ...PLINKO, host: owner })
        expect(mine.rakeback).toBe(0)
        expect(pots(owner).visitors).toBe(11)
    })

    it('pays the player when the named host has no casino or not the game', async () => {
        const me = player()
        const casinoless = seedPlayer(0, 0, { origin: 'dev', casino: 'none' })
        const round = await playRound(me, 'plinko', { ...PLINKO, host: casinoless })
        expect(round).toMatchObject({ rakeback: 1, rakebackPot: 1 })
        // A host without Pegfall: the round was the player's own casino's.
        const bare = player(0)
        db.update(casinoProfiles).set({ games: { spinata: 1 } }).where(eq(casinoProfiles.playerId, bare)).run()
        const other = await playRound(me, 'plinko', { ...PLINKO, host: bare })
        expect(other).toMatchObject({ rakeback: 1, rakebackPot: 2 })
        expect(pots(bare)).toEqual({ rakeback: 0, visitors: 0 })
        expect(pots(me)).toEqual({ rakeback: 2, visitors: 0 })
    })

    it('pays a step game at settle only, on the stake, to the host it was started in', async () => {
        const me = player()
        const owner = player(0, true)
        const start = await startStepRound(me, 'mines', { bet: 200, options: { mines: 1 }, host: owner })
        expect(start).toMatchObject({ rakeback: 0, rakebackPot: null })
        expect(pots(owner).visitors).toBe(0)
        const dug = await actStepRound(me, 'mines', { step: 0, action: { type: 'reveal', tile: safeTile(start.round.id) } })
        expect(dug.round.status).toBe('open')
        expect(pots(owner).visitors).toBe(0)
        const out = await cashOutStepRound(me, 'mines')
        expect(out).toMatchObject({ rakeback: 0, rakebackPot: null })
        expect(out.chips).toBe(out.chipsEarned)
        expect(pots(owner)).toEqual({ rakeback: 0, visitors: 2 })

        // At home (Gem Dig built): the player's own, at cash-out.
        const home = player(10_000, true)
        const own = await startStepRound(home, 'mines', { bet: 200, options: { mines: 1 } })
        expect(pots(home).rakeback).toBe(0)
        await actStepRound(home, 'mines', { step: 0, action: { type: 'reveal', tile: safeTile(own.round.id) } })
        const cashed = await cashOutStepRound(home, 'mines')
        expect(cashed).toMatchObject({ rakeback: 2, rakebackPot: 2 })
        expect(cashed.chips).toBe(cashed.chipsEarned)
        expect(pots(home)).toEqual({ rakeback: 2, visitors: 0 })
    })

    it('pays a swept step round its rakeback when cashed out, none when refunded, and falls back to the player when the host is gone', async () => {
        const me = player()
        const owner = player(0, true)
        const played = await startStepRound(me, 'mines', { bet: 100, options: { mines: 1 }, host: owner })
        await actStepRound(me, 'mines', { step: 0, action: { type: 'reveal', tile: safeTile(played.round.id) } })
        const idle = player(10_000, true)
        await startStepRound(idle, 'mines', { bet: 100, options: { mines: 1 } })
        // The host's account (and casino) is gone by the time the sweep settles.
        db.delete(players).where(eq(players.id, owner)).run()
        await settleAbandonedRounds(new Date(Date.now() + 1_000))
        expect(pots(me)).toEqual({ rakeback: 1, visitors: 0 })
        // No progress: refunded, and a refund pays no rakeback.
        expect(pots(idle)).toEqual({ rakeback: 0, visitors: 0 })
        expect([coinsOf(idle).coins, chipsOf(idle)]).toEqual([10_000, 0])
    })

    it('pays a live table stake at settle, to the seat host, and never on a refund', () => {
        const me = player()
        const owner = player(0, true)
        const hosted = stakeWagers(me, 'blackjack', 1, [{ amount: 500, kind: 'bet' }, { amount: 100, kind: 'pairs' }]).value
        const settled = settleWagers({ playerId: me, game: 'blackjack', wagerIds: hosted.wagerIds, staked: 600, payout: 1_000, summary: {}, host: owner }).value
        expect(settled).toMatchObject({ kind: 'settled', chips: 1_000, rakeback: 0, rakebackPot: null })
        expect(pots(owner)).toEqual({ rakeback: 0, visitors: 6 })

        // Refunded in full: nothing.
        const refunded = stakeWagers(me, 'blackjack', 2, [{ amount: 300, kind: 'bet' }]).value
        refundWagers(me, 'blackjack', refunded.wagerIds)
        // Partly closed before the settle: what is left comes back as a refund, with no rakeback either.
        const partial = stakeWagers(me, 'blackjack', 3, [{ amount: 100, kind: 'bet' }, { amount: 100, kind: 'double' }]).value
        refundWagers(me, 'blackjack', [partial.wagerIds[1]!])
        expect(settleWagers({ playerId: me, game: 'blackjack', wagerIds: partial.wagerIds, staked: 200, payout: 400, summary: {}, host: owner }).value).toMatchObject({ kind: 'refunded' })
        expect(pots(me)).toEqual({ rakeback: 0, visitors: 0 })
        expect(pots(owner)).toEqual({ rakeback: 0, visitors: 6 })
        expect(chipsOf(me)).toBe(1_000)
        expect(chipLedgerSum(me)).toBe(1_000)
    })

    it('pays nothing on a stake too small to round to a coin unit, and survives a host that does not exist', () => {
        const me = player()
        const tiny = stakeWagers(me, 'baccarat', 1, [{ amount: 0.0099, kind: 'player' }]).value
        expect(settleWagers({ playerId: me, game: 'baccarat', wagerIds: tiny.wagerIds, staked: 0.0099, payout: 0, summary: {} }).value).toMatchObject({ kind: 'settled', rakeback: 0, rakebackPot: null })
        expect(pots(me).rakeback).toBe(0)

        const ghost = stakeWagers(me, 'baccarat', 2, [{ amount: 100, kind: 'player' }]).value
        const settled = settleWagers({ playerId: me, game: 'baccarat', wagerIds: ghost.wagerIds, staked: 100, payout: 0, summary: {}, host: 'no-such-casino' }).value
        // Never throws at settle: the rakeback falls back to the player.
        expect(settled).toMatchObject({ kind: 'settled', rakeback: 1, rakebackPot: 1, chips: 0 })
        expect(pots(me)).toEqual({ rakeback: 1, visitors: 0 })
    })

    it('fills the pots past a full cage: rakeback is never lost to the capacity', async () => {
        const me = player(10_000, true)
        const now = Date.now()
        const full = cageCapacity(0)
        db.update(casinoProfiles).set({ cageStored: full, cageAt: new Date(now) }).where(eq(casinoProfiles.playerId, me)).run()
        await playRound(me, 'dice', { bet: 1_000, ...DICE })
        const state = getTycoonState(me, now)
        expect(state.cage).toMatchObject({ stored: full, capacity: full, rakeback: 10 })
        // A collect takes the full cage and the pot.
        const collected = await collectCage(me, now)
        expect(collected.collected).toBe(full + 10)
        expect(collected.state.cage).toMatchObject({ stored: 0, rakeback: 0, visitors: 0 })
    })

    it("collects the cage and both pots once, however many collects race; the pots as 'rakeback' coins", async () => {
        const me = player(10_000, true)
        const visitor = player()
        const now = Date.now()
        db.update(casinoProfiles).set({ cageStored: 500, cageAt: new Date(now) }).where(eq(casinoProfiles.playerId, me)).run()
        await playRound(me, 'dice', { bet: 250, ...DICE })
        await playRound(visitor, 'dice', { bet: 1_000.5, ...DICE, host: me })
        expect(pots(me)).toEqual({ rakeback: 2.5, visitors: 10.005 })
        const before = coinsOf(me).coins
        const results = await Promise.all(Array.from({ length: 10 }, () => collectCage(me, now)))
        expect(results.map(r => r.collected).filter(Boolean)).toEqual([512.505])
        expect(coinsOf(me).coins).toBe(normalizeCoins(before + 512.505))
        expect(coinCredits(me, 'cage')).toEqual([500])
        expect(coinCredits(me, 'rakeback')).toEqual([12.505])
        expect(pots(me)).toEqual({ rakeback: 0, visitors: 0 })
        expect(ledgerSum(me)).toBe(normalizeCoins(coinsOf(me).coins - 10_000))
        // Nothing left: a later collect at the same moment pays nothing.
        expect((await collectCage(me, now)).collected).toBe(0)
    })

    it('collects a pot when the cage itself is empty', async () => {
        const me = player(10_000, true)
        const now = Date.now()
        db.update(casinoProfiles).set({ cageStored: 0, cageAt: new Date(now) }).where(eq(casinoProfiles.playerId, me)).run()
        await playRound(me, 'dice', { bet: 50, ...DICE })
        expect(getTycoonState(me, now).cage).toMatchObject({ stored: 0, rakeback: 0.5 })
        const coins = coinsOf(me).coins
        const collected = await collectCage(me, now)
        expect(collected).toMatchObject({ collected: 0.5, coins: normalizeCoins(coins + 0.5) })
        expect(coinCredits(me, 'cage')).toEqual([])
        expect(coinCredits(me, 'rakeback')).toEqual([0.5])
        expect(collected.state.cage.rakeback).toBe(0)
    })

    it("tells the host's open floor about a visitor's rakeback once the round committed, and nobody else", async () => {
        const owner = player(0, true)
        const me = player()
        const heard: VisitorRakeback[] = []
        const stop = onVisitorRakeback(event => heard.push(event))
        const inbox: PresenceServerMessage[] = []
        const guestInbox: PresenceServerMessage[] = []
        const peer = { send: (data: string) => inbox.push(JSON.parse(data)), close: () => undefined }
        const guest = { send: (data: string) => guestInbox.push(JSON.parse(data)), close: () => undefined }
        floorPresence.open(peer, { casinoId: owner, playerId: owner, name: 'Owner', image: null })
        floorPresence.open(guest, { casinoId: owner, playerId: me, name: 'Guest', image: null })
        try {
            await playRound(me, 'dice', { bet: 1_000, ...DICE, host: owner })
            await playRound(me, 'dice', { bet: 500, ...DICE, host: owner })
            // A round at home is no visitor's.
            await playRound(owner, 'plinko', { ...PLINKO }).catch(() => null)
            expect(heard).toEqual([
                { host: owner, playerId: me, game: 'dice', amount: 10, pot: 10 },
                { host: owner, playerId: me, game: 'dice', amount: 5, pot: 15 }
            ])
            expect(inbox.filter(m => m.t === 'rakeback')).toEqual([
                { t: 'rakeback', amount: 10, pot: 10, from: 'Test player', game: 'dice', at: expect.any(Number) },
                { t: 'rakeback', amount: 5, pot: 15, from: 'Test player', game: 'dice', at: expect.any(Number) }
            ])
            expect(guestInbox.filter(m => m.t === 'rakeback')).toEqual([])
            // A stake the player can't cover rolls back: no pot, no news.
            await expect(playRound(me, 'dice', { bet: 1_000_000, ...DICE, host: owner })).rejects.toMatchObject({ statusCode: 400 })
            expect(heard).toHaveLength(2)
            expect(pots(owner).visitors).toBe(15)
        } finally {
            stop()
            floorPresence.close(peer)
            floorPresence.close(guest)
        }
    })

    it("shows the host what visitors' bets put in the cage while they were away, in coins", async () => {
        const owner = player(0, true)
        const me = player()
        const t0 = Date.now() - 1_000
        getTycoonState(owner, t0)
        await playRound(me, 'dice', { bet: 1_000, ...DICE, host: owner })
        await playRound(me, 'dice', { bet: 500, ...DICE, host: owner })
        // The owner's own rakeback is not a visitor's.
        await playRound(owner, 'plinko', { ...PLINKO }).catch(() => null)
        const away = getTycoonState(owner, t0 + WELCOME_AFTER_MS + 60_000, { welcome: true }).welcome!
        expect(away.visitorCoins).toBe(15)
        // Collected since the last read: the next welcome counts only what came in after.
        await collectCage(owner, t0 + WELCOME_AFTER_MS + 60_000)
        await playRound(me, 'dice', { bet: 200, ...DICE, host: owner })
        const next = getTycoonState(owner, t0 + 2 * WELCOME_AFTER_MS + 120_000, { welcome: true }).welcome!
        expect(next.visitorCoins).toBe(2)
        expect(pots(owner).visitors).toBe(2)
    })
})
