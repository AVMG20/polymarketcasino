import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { db } from '../server/database'
import { stepRounds } from '../server/database/schema'
import { actStepRound, cashOutStepRound, currentStepRound, settleAbandonedRounds, startStepRound } from '../server/utils/steps'
import { hilo, HILO_RTP, HILO_SKIPS, hiloMultiplier, hiloOptions, hiloWins, type HiloState, type HiloView } from '../shared/games/hilo'
import { MAX_COINS, normalizeCoins, payFor } from '../shared/money'
import type { Rng } from '../shared/rng'
import { chipLedgerSum, chipsOf, coinsOf, giveChips, ledgerSum, seedPlayer } from './setup/players'

/** Draws exactly these card indexes (0..51: rank = i % 13 + 1). */
function deck(...cards: number[]): Rng {
    let i = 0
    return { next: () => (cards[i++ % cards.length]! + 0.5) / 52 }
}

describe('card climb rules', () => {
    it('offers higher/lower or same, and every guess has the same edge', () => {
        expect(hiloOptions(1).map(o => [o.guess, o.wins])).toEqual([['higher', 12], ['same', 1]])
        expect(hiloOptions(13).map(o => [o.guess, o.wins])).toEqual([['lower', 12], ['same', 1]])
        expect(hiloOptions(7).map(o => [o.guess, o.wins])).toEqual([['higher', 7], ['lower', 7]])
        for (let rank = 1; rank <= 13; rank++) {
            for (const option of hiloOptions(rank)) {
                // The count of winning ranks is right.
                const wins = Array.from({ length: 13 }, (_, i) => i + 1).filter(next => hiloWins(rank, option.guess, next)).length
                expect(wins).toBe(option.wins)
                // A first right guess returns RTP, rounded down.
                expect(hiloMultiplier([option.wins]) * option.chance).toBeLessThanOrEqual(HILO_RTP + 1e-9)
                expect(hiloMultiplier([option.wins]) * option.chance).toBeGreaterThan(HILO_RTP - 0.0001)
            }
        }
        // The edge is taken once: two right 50/50-ish guesses are fair after the first.
        expect(hiloMultiplier([7, 7])).toBe(Math.floor(HILO_RTP * (13 / 7) ** 2 * 10_000) / 10_000)
        expect(hiloMultiplier([])).toBe(1)
    })

    it('climbs on right guesses, busts on a wrong one and skips a limited number of times', () => {
        // 7♠, then 9♠ (higher), then 2♠ (higher: bust).
        let s = hilo.start(deck(6, 8, 1), {})
        expect(s.card).toEqual({ rank: 7, suit: 0 })
        const rng = deck(8, 1)
        s = hilo.act(s, { type: 'guess', guess: 'higher' }, rng)
        expect(s).toMatchObject({ status: 'open', wins: [7], card: { rank: 9 } })
        expect(hilo.canCashOut(s)).toBe(true)
        const bust = hilo.act(s, { type: 'guess', guess: 'higher' }, rng)
        expect(bust.status).toBe('lost')
        expect(hilo.multiplier(bust)).toBe(0)
        expect(() => hilo.act(bust, { type: 'skip' }, rng)).toThrow(RangeError)

        let skip: HiloState = hilo.start(deck(0), {})
        for (let i = 0; i < HILO_SKIPS; i++) skip = hilo.act(skip, { type: 'skip' }, deck(i + 2))
        expect(() => hilo.act(skip, { type: 'skip' }, deck(0))).toThrow(RangeError)
        expect(hilo.canCashOut(skip)).toBe(false)
        // An ace only offers higher or same.
        const ace = hilo.start(deck(0), {})
        expect(() => hilo.act(ace, { type: 'guess', guess: 'lower' }, deck(5))).toThrow(RangeError)
        expect(hilo.act(ace, { type: 'guess', guess: 'same' }, deck(13)).status).toBe('open')
    })
})

describe('card climb rounds', () => {
    it('stakes at the start, multiplies on right guesses and pays the cash-out in chips', async () => {
        const id = seedPlayer(1_000, 1_000, { origin: 'dev' })
        // 7, then 10 (higher wins), then 10 (lower or same wins).
        const start = await startStepRound(id, 'hilo', { bet: 100 }, deck(6))
        expect(start.balance).toBe(900)
        expect((start.round.view as HiloView).card.rank).toBe(7)
        const one = await actStepRound(id, 'hilo', { step: 0, action: { type: 'guess', guess: 'higher' } }, deck(9))
        expect(one.round).toMatchObject({ status: 'open', canCashOut: true, multiplier: hiloMultiplier([7]) })
        const two = await actStepRound(id, 'hilo', { step: 1, action: { type: 'guess', guess: 'lower' } }, deck(22))
        expect(two.round.multiplier).toBe(hiloMultiplier([7, 10]))
        await expect(actStepRound(id, 'hilo', { step: 1, action: { type: 'skip' } })).rejects.toMatchObject({ statusCode: 409 })
        await expect(actStepRound(id, 'hilo', { step: 2, action: { type: 'guess', guess: 'same' } })).rejects.toMatchObject({ statusCode: 400 })
        await expect(actStepRound(id, 'hilo', { action: { type: 'skip' } })).rejects.toMatchObject({ statusCode: 400 })
        const out = await cashOutStepRound(id, 'hilo')
        const paid = payFor(100, hiloMultiplier([7, 10]))
        expect(out).toMatchObject({ chipsEarned: paid, chips: paid, balance: 900 })
        expect(chipsOf(id)).toBe(paid)
        expect(chipLedgerSum(id)).toBe(paid)
        expect(ledgerSum(id)).toBe(-100)
        expect(currentStepRound(id, 'hilo')).toBeNull()
    })

    it('pays nothing on a wrong guess', async () => {
        const id = seedPlayer(1_000, 1_000, { origin: 'dev' })
        await startStepRound(id, 'hilo', { bet: 100 }, deck(6))
        const bust = await actStepRound(id, 'hilo', { step: 0, action: { type: 'guess', guess: 'higher' } }, deck(2))
        expect(bust.round).toMatchObject({ status: 'lost', payout: 0 })
        expect(chipsOf(id)).toBe(0)
        expect(coinsOf(id).coins).toBe(900)
    })

    it('settles one move per step under a burst of parallel guesses and cash-outs', async () => {
        const id = seedPlayer(1_000, 1_000, { origin: 'dev' })
        await startStepRound(id, 'hilo', { bet: 100 }, deck(0))
        // On an ace, "higher" wins on everything but another ace.
        await actStepRound(id, 'hilo', { step: 0, action: { type: 'guess', guess: 'higher' } }, deck(5))
        const burst = await Promise.allSettled([
            ...Array.from({ length: 8 }, () => actStepRound(id, 'hilo', { step: 1, action: { type: 'skip' } })),
            ...Array.from({ length: 8 }, () => cashOutStepRound(id, 'hilo', { step: 1 }))
        ])
        const ok = burst.flatMap(r => r.status === 'fulfilled' ? [r.value] : [])
        expect(ok).toHaveLength(1)
        for (const r of burst) if (r.status === 'rejected') expect([400, 409]).toContain(r.reason.statusCode)
        const paid = normalizeCoins(ok.reduce((sum, r) => sum + r.chipsEarned, 0))
        expect(chipsOf(id)).toBe(paid)
        expect(chipLedgerSum(id)).toBe(paid)
    })

    it('caps a cash-out at MAX_COINS, so the top bet at the top multiplier still pays', async () => {
        const id = seedPlayer(1_000_000, 1_000_000, { origin: 'dev' })
        const start = await startStepRound(id, 'hilo', { bet: 1_000_000 }, deck(6))
        // Seven right "same" calls: past the 1,000,000× cap, the round's top.
        const state = { ...(db.select({ state: stepRounds.state }).from(stepRounds).where(eq(stepRounds.id, start.round.id)).get()!.state as unknown as HiloState), wins: [1, 1, 1, 1, 1, 1] }
        db.update(stepRounds).set({ state: state as unknown as Record<string, unknown> }).where(eq(stepRounds.id, start.round.id)).run()
        expect(hiloMultiplier(state.wins)).toBe(1_000_000)
        expect(payFor(1_000_000, 1_000_000)).toBeGreaterThan(MAX_COINS)
        expect(currentStepRound(id, 'hilo')!.payout).toBe(MAX_COINS)
        const out = await cashOutStepRound(id, 'hilo')
        expect(out.chipsEarned).toBe(MAX_COINS)
        expect(chipsOf(id)).toBe(MAX_COINS)
        expect(chipLedgerSum(id)).toBe(MAX_COINS)
        expect(currentStepRound(id, 'hilo')).toBeNull()
    })

    it('settles abandoned rounds: cashes out a right call, refunds one without, and gets past a row that fails', async () => {
        const played = seedPlayer(1_000, 1_000, { origin: 'dev' })
        const idle = seedPlayer(30, 30, { origin: 'dev' })
        giveChips(idle, 100)
        await startStepRound(played, 'hilo', { bet: 100 }, deck(6))
        await actStepRound(played, 'hilo', { step: 0, action: { type: 'guess', guess: 'higher' } }, deck(9))
        await startStepRound(idle, 'hilo', { bet: 50 }, deck(3))
        expect([coinsOf(idle).coins, chipsOf(idle)]).toEqual([0, 80])
        // A round whose chip refund can't land (its player has no casino), scanned before the others.
        const broken = seedPlayer(0, 0, { origin: 'dev', casino: 'none' })
        db.insert(stepRounds).values({ playerId: broken, game: 'hilo', bet: 50, stakeChips: 50, state: { status: 'open', card: { rank: 5, suit: 0 }, steps: [], wins: [], skips: 0 }, updatedAt: new Date(Date.now() - 60_000) }).run()

        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const closed = await settleAbandonedRounds(new Date(Date.now() + 1_000))
            expect(closed).toBeGreaterThanOrEqual(2)
            expect(logged).toHaveBeenCalledWith(expect.stringContaining(broken), expect.anything())
        } finally {
            logged.mockRestore()
        }
        expect(currentStepRound(played, 'hilo')).toBeNull()
        expect(chipsOf(played)).toBe(payFor(100, hiloMultiplier([7])))
        expect([coinsOf(idle).coins, chipsOf(idle)]).toEqual([30, 100])
        expect(ledgerSum(idle)).toBe(0)
        expect(currentStepRound(idle, 'hilo')).toBeNull()
        // The broken one stays open for a later sweep (rolled back, nothing paid).
        expect(currentStepRound(broken, 'hilo')).not.toBeNull()
        db.delete(stepRounds).where(eq(stepRounds.playerId, broken)).run()
    })
})
