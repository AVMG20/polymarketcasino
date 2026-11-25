import { and, eq, like } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../server/database'
import { casinoProfiles, chipTransactions, players, stepRounds } from '../server/database/schema'
import { playRound } from '../server/utils/rounds'
import { actStepRound, cashOutStepRound, settleAbandonedRounds, startStepRound } from '../server/utils/steps'
import { refundWagers, settleWagers, stakeWagers } from '../server/utils/tables/escrow'
import { getTycoonState } from '../server/utils/tycoon'
import { WELCOME_AFTER_MS } from '../shared/missions'
import { normalizeCoins } from '../shared/money'
import { RAKEBACK, rakebackOf } from '../shared/rakeback'
import { chipLedgerSum, chipsOf, coinsOf, seedPlayer } from './setup/players'

/** A dev player (no hub) with coins and only the backroom starters, or every game when `all`. */
function player(coins = 10_000, all = false) {
    const id = seedPlayer(coins, coins, { origin: 'dev' })
    if (!all) db.update(casinoProfiles).set({ zones: ['backroom'], games: { plinko: 1, spinata: 1 } }).where(eq(casinoProfiles.playerId, id)).run()
    return id
}

/** Chip ledger rows of `id` whose reason starts with `prefix`. */
function rows(id: string, prefix: string) {
    return db.select({ amount: chipTransactions.amount, reason: chipTransactions.reason, type: chipTransactions.type })
        .from(chipTransactions)
        .where(and(eq(chipTransactions.playerId, id), like(chipTransactions.reason, `${prefix}%`)))
        .all()
}

/** A tile without a bomb in the Gem Dig round `roundId`. */
function safeTile(roundId: string): number {
    const state = db.select({ state: stepRounds.state }).from(stepRounds).where(eq(stepRounds.id, roundId)).get()!.state as { bombs: number[] }
    let tile = 0
    while (state.bombs.includes(tile)) tile++
    return tile
}

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

    it('pays the player 1% of a round in their own casino, in the same unit as the round', async () => {
        const me = player(10_000, true)
        const round = await playRound(me, 'dice', { bet: 250, options: { chance: 50 } })
        expect(round.rakeback).toBe(2.5)
        expect(round.chips).toBe(normalizeCoins(round.payout + 2.5))
        expect(chipsOf(me)).toBe(round.chips)
        expect(rows(me, 'rakeback:')).toEqual([{ amount: 2.5, reason: 'rakeback:dice', type: 'credit' }])
        // A host that is the player themselves is their own casino.
        const own = await playRound(me, 'dice', { bet: 100, options: { chance: 50 }, host: me })
        expect(own.rakeback).toBe(1)
        expect(rows(me, 'host:')).toEqual([])
    })

    it("pays the host, not the player, for a round in the host's casino", async () => {
        const me = player()
        const owner = player(0, true)
        const round = await playRound(me, 'dice', { bet: 1_000, options: { chance: 50 }, host: owner })
        expect(round.rakeback).toBe(0)
        // The player gets the payout only; the response's chips agree with the ledger.
        expect(round.chips).toBe(round.payout)
        expect(chipsOf(me)).toBe(round.payout)
        expect(rows(me, 'rakeback:')).toEqual([])
        expect(chipsOf(owner)).toBe(10)
        expect(rows(owner, 'host:')).toEqual([{ amount: 10, reason: 'host:dice', type: 'credit' }])
        expect(coinsOf(owner).coins).toBe(0)
        // A game the player built too still pays the host when played in the host's casino.
        const mine = await playRound(me, 'plinko', { bet: 100, options: { rows: 8, risk: 'low', balls: 1 }, host: owner })
        expect(mine.rakeback).toBe(0)
        expect(chipsOf(owner)).toBe(11)
    })

    it('pays the player when the named host has no casino or not the game', async () => {
        const me = player()
        const casinoless = seedPlayer(0, 0, { origin: 'dev', casino: 'none' })
        const round = await playRound(me, 'plinko', { bet: 100, options: { rows: 8, risk: 'low', balls: 1 }, host: casinoless })
        expect(round.rakeback).toBe(1)
        // A host without Pegfall: the round was the player's own casino's.
        const bare = player(0)
        db.update(casinoProfiles).set({ games: { spinata: 1 } }).where(eq(casinoProfiles.playerId, bare)).run()
        const other = await playRound(me, 'plinko', { bet: 100, options: { rows: 8, risk: 'low', balls: 1 }, host: bare })
        expect(other.rakeback).toBe(1)
        expect(chipsOf(bare)).toBe(0)
        expect(rows(me, 'rakeback:')).toHaveLength(2)
    })

    it('pays a step game at settle only, on the stake, to the host it was started in', async () => {
        const me = player()
        const owner = player(0, true)
        const start = await startStepRound(me, 'mines', { bet: 200, options: { mines: 1 }, host: owner })
        expect(start.rakeback).toBe(0)
        expect(rows(owner, 'host:')).toEqual([])
        const dug = await actStepRound(me, 'mines', { step: 0, action: { type: 'reveal', tile: safeTile(start.round.id) } })
        expect(dug.round.status).toBe('open')
        expect(rows(owner, 'host:')).toEqual([])
        const out = await cashOutStepRound(me, 'mines')
        expect(out.rakeback).toBe(0)
        expect(out.chips).toBe(out.chipsEarned)
        expect(rows(owner, 'host:')).toEqual([{ amount: 2, reason: 'host:mines', type: 'credit' }])

        // At home (Gem Dig built): the player's own, at cash-out.
        const home = player(10_000, true)
        const own = await startStepRound(home, 'mines', { bet: 200, options: { mines: 1 } })
        expect(chipsOf(home)).toBe(0)
        await actStepRound(home, 'mines', { step: 0, action: { type: 'reveal', tile: safeTile(own.round.id) } })
        const cashed = await cashOutStepRound(home, 'mines')
        expect(cashed.rakeback).toBe(2)
        expect(cashed.chips).toBe(normalizeCoins(cashed.chipsEarned + 2))
        expect(rows(home, 'rakeback:')).toEqual([{ amount: 2, reason: 'rakeback:mines', type: 'credit' }])
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
        expect(rows(me, 'rakeback:')).toEqual([{ amount: 1, reason: 'rakeback:mines', type: 'credit' }])
        // No progress: refunded, and a refund pays no rakeback.
        expect(rows(idle, 'rakeback:')).toEqual([])
        expect([coinsOf(idle).coins, chipsOf(idle)]).toEqual([10_000, 0])
    })

    it('pays a live table stake at settle, to the seat host, and never on a refund', () => {
        const me = player()
        const owner = player(0, true)
        const hosted = stakeWagers(me, 'blackjack', 1, [{ amount: 500, kind: 'bet' }, { amount: 100, kind: 'pairs' }]).value
        const settled = settleWagers({ playerId: me, game: 'blackjack', wagerIds: hosted.wagerIds, staked: 600, payout: 1_000, summary: {}, host: owner }).value
        expect(settled).toMatchObject({ kind: 'settled', chips: 1_000, rakeback: 0 })
        expect(rows(owner, 'host:')).toEqual([{ amount: 6, reason: 'host:blackjack', type: 'credit' }])

        // Refunded in full: nothing.
        const refunded = stakeWagers(me, 'blackjack', 2, [{ amount: 300, kind: 'bet' }]).value
        refundWagers(me, 'blackjack', refunded.wagerIds)
        // Partly closed before the settle: what is left comes back as a refund, with no rakeback either.
        const partial = stakeWagers(me, 'blackjack', 3, [{ amount: 100, kind: 'bet' }, { amount: 100, kind: 'double' }]).value
        refundWagers(me, 'blackjack', [partial.wagerIds[1]!])
        expect(settleWagers({ playerId: me, game: 'blackjack', wagerIds: partial.wagerIds, staked: 200, payout: 400, summary: {}, host: owner }).value).toMatchObject({ kind: 'refunded' })
        expect(rows(me, 'rakeback:')).toEqual([])
        expect(rows(owner, 'host:')).toHaveLength(1)
        expect(chipsOf(me)).toBe(1_000)
        expect(chipLedgerSum(me)).toBe(1_000)
    })

    it('pays nothing on a stake too small to round to a chip unit, and survives a host that does not exist', () => {
        const me = player()
        const tiny = stakeWagers(me, 'baccarat', 1, [{ amount: 0.0099, kind: 'player' }]).value
        expect(settleWagers({ playerId: me, game: 'baccarat', wagerIds: tiny.wagerIds, staked: 0.0099, payout: 0, summary: {} }).value).toMatchObject({ kind: 'settled', rakeback: 0 })
        expect(rows(me, 'rakeback:')).toEqual([])

        const ghost = stakeWagers(me, 'baccarat', 2, [{ amount: 100, kind: 'player' }]).value
        const settled = settleWagers({ playerId: me, game: 'baccarat', wagerIds: ghost.wagerIds, staked: 100, payout: 0, summary: {}, host: 'no-such-casino' }).value
        // Never throws at settle: the rakeback falls back to the player.
        expect(settled).toMatchObject({ kind: 'settled', rakeback: 1, chips: 1 })
        expect(rows(me, 'rakeback:')).toEqual([{ amount: 1, reason: 'rakeback:baccarat', type: 'credit' }])
    })

    it("shows the host what visitors' bets paid while they were away", async () => {
        const owner = player(0, true)
        const me = player()
        const t0 = Date.now() - 1_000
        getTycoonState(owner, t0)
        await playRound(me, 'dice', { bet: 1_000, options: { chance: 50 }, host: owner })
        await playRound(me, 'dice', { bet: 500, options: { chance: 50 }, host: owner })
        // The owner's own rakeback is not a visitor's.
        await playRound(owner, 'plinko', { bet: 10, options: { rows: 8, risk: 'low', balls: 1 } }).catch(() => null)
        const away = getTycoonState(owner, t0 + WELCOME_AFTER_MS + 60_000, { welcome: true }).welcome!
        expect(away.visitorChips).toBe(15)
    })
})
