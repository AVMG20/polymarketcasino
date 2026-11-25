import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../server/database'
import { gameRounds, stepRounds } from '../server/database/schema'
import { actStepRound, cashOutStepRound, currentStepRound, settleAbandonedRounds, startStepRound } from '../server/utils/steps'
import { mines, MINES_RTP, MINES_TILES, minesMultiplier, minesSafeChance, type MinesState, type MinesView } from '../shared/games/mines'
import { normalizeCoins, payFor } from '../shared/money'
import { seededRng } from '../shared/rng'
import { chipLedgerSum, chipsOf, coinsOf, giveChips, ledgerSum, seedPlayer } from './setup/players'

function stateOf(roundId: string): MinesState {
    return db.select({ state: stepRounds.state }).from(stepRounds).where(eq(stepRounds.id, roundId)).get()!.state as unknown as MinesState
}

function safeTiles(state: MinesState): number[] {
    return Array.from({ length: MINES_TILES }, (_, i) => i).filter(tile => !state.bombs.includes(tile))
}

describe('gem dig rules', () => {
    it('pays RTP over the chance of k gems in a row, whatever the bombs', () => {
        for (let m = 1; m <= 24; m++) {
            let chance = 1
            for (let k = 1; k <= MINES_TILES - m; k++) {
                chance *= minesSafeChance(m, k - 1)
                const multiplier = minesMultiplier(m, k)
                if (multiplier >= 1_000_000) break
                // Cashing out after k gems returns RTP (rounded down to 0.0001).
                expect(multiplier * chance).toBeLessThanOrEqual(MINES_RTP + 1e-9)
                expect(multiplier * chance).toBeGreaterThan(MINES_RTP - 0.0001)
            }
        }
        expect(minesMultiplier(1, 1)).toBe(1.0156)
        expect(minesMultiplier(24, 1)).toBe(24.375)
        expect(minesMultiplier(3, 0)).toBe(1)
    })

    it('places the bombs at the start and ends on a bomb, a full board or a cash-out', () => {
        const state = mines.start(seededRng(5), { mines: 5 })
        expect(new Set(state.bombs).size).toBe(5)
        const safe = safeTiles(state)
        let s = mines.act(state, { type: 'reveal', tile: safe[0] }, seededRng(1))
        expect(s.status).toBe('open')
        expect(() => mines.act(s, { type: 'reveal', tile: safe[0] }, seededRng(1))).toThrow(RangeError)
        expect(mines.view(s).bombs).toBeNull()
        const bust = mines.act(s, { type: 'reveal', tile: state.bombs[0] }, seededRng(1))
        expect(bust).toMatchObject({ status: 'lost', hit: state.bombs[0] })
        expect(mines.multiplier(bust)).toBe(0)
        expect(mines.view(bust).bombs).toEqual(state.bombs)
        for (const tile of safe.slice(1)) s = mines.act(s, { type: 'reveal', tile }, seededRng(1))
        expect(s.status).toBe('cashed')
        expect(mines.multiplier(s)).toBe(minesMultiplier(5, 20))
        expect(() => mines.cashOut(mines.start(seededRng(5), { mines: 5 }))).toThrow(RangeError)
        for (const bad of [{ mines: 0 }, { mines: 25 }, { mines: 2.5 }, { mines: '3' }]) expect(() => mines.start(seededRng(1), bad)).toThrow(RangeError)
        for (const tile of [-1, 25, 1.5, '3', null]) expect(() => mines.act(state, { type: 'reveal', tile }, seededRng(1))).toThrow(RangeError)
    })
})

describe('gem dig rounds', () => {
    it('debits the stake at the start and pays the cash-out in chips once', async () => {
        const id = seedPlayer(1_000, 1_000, { origin: 'dev' })
        const start = await startStepRound(id, 'mines', { bet: 100, options: { mines: 3 } })
        expect(start.balance).toBe(900)
        expect(start.round).toMatchObject({ step: 0, status: 'open', canCashOut: false, bet: 100 })
        expect((start.round.view as MinesView).bombs).toBeNull()
        // The bombs never leave the server while the round runs.
        expect(JSON.stringify(start)).not.toContain('"bombs":[')
        await expect(startStepRound(id, 'mines', { bet: 100, options: { mines: 3 } })).rejects.toMatchObject({ statusCode: 409 })
        expect(coinsOf(id).coins).toBe(900)

        const safe = safeTiles(stateOf(start.round.id))
        const one = await actStepRound(id, 'mines', { step: 0, action: { type: 'reveal', tile: safe[0] } })
        expect(one.round).toMatchObject({ step: 1, status: 'open', canCashOut: true, multiplier: minesMultiplier(3, 1) })
        // A repeated tap on the old step is refused.
        await expect(actStepRound(id, 'mines', { step: 0, action: { type: 'reveal', tile: safe[1] } })).rejects.toMatchObject({ statusCode: 409 })
        const two = await actStepRound(id, 'mines', { step: 1, action: { type: 'reveal', tile: safe[1] } })
        expect(currentStepRound(id, 'mines')?.step).toBe(2)

        const out = await cashOutStepRound(id, 'mines', { step: 2 })
        const paid = payFor(100, minesMultiplier(3, 2))
        expect(out.round).toMatchObject({ status: 'cashed', payout: paid })
        expect(out.chipsEarned).toBe(paid)
        expect(two.round.payout).toBe(paid)
        expect((out.round.view as MinesView).bombs).toHaveLength(3)
        // The cash-out in chips; the 1% rakeback on the bet goes into the cage.
        expect(out).toMatchObject({ rakeback: 1, rakebackPot: 1, chips: paid })
        expect(chipsOf(id)).toBe(paid)
        expect(chipLedgerSum(id)).toBe(paid)
        expect(ledgerSum(id)).toBe(-100)
        await expect(cashOutStepRound(id, 'mines')).rejects.toMatchObject({ statusCode: 409 })
        expect(currentStepRound(id, 'mines')).toBeNull()
        const rounds = db.select().from(gameRounds).where(and(eq(gameRounds.playerId, id), eq(gameRounds.game, 'mines'))).all()
        expect(rounds).toHaveLength(1)
        expect(rounds[0]).toMatchObject({ stake: 100, payout: paid })
    })

    it('pays nothing on a bomb and refuses a cash-out before the first gem', async () => {
        const id = seedPlayer(1_000, 1_000, { origin: 'dev' })
        const start = await startStepRound(id, 'mines', { bet: 50, options: { mines: 24 } })
        await expect(cashOutStepRound(id, 'mines')).rejects.toMatchObject({ statusCode: 400 })
        const bomb = stateOf(start.round.id).bombs[0]!
        const bust = await actStepRound(id, 'mines', { step: 0, action: { type: 'reveal', tile: bomb } })
        expect(bust.round).toMatchObject({ status: 'lost', payout: 0, multiplier: 0 })
        expect((bust.round.view as MinesView).hit).toBe(bomb)
        expect(chipsOf(id)).toBe(0)
        expect(coinsOf(id).coins).toBe(950)
        // A new round can start once the last one is over.
        await expect(startStepRound(id, 'mines', { bet: 50, options: { mines: 1 } })).resolves.toMatchObject({ balance: 900 })
    })

    it('stakes coins first, then chips, and validates the bet', async () => {
        const id = seedPlayer(30, 30, { origin: 'dev' })
        giveChips(id, 100)
        await expect(startStepRound(id, 'mines', { bet: '50' })).rejects.toMatchObject({ statusCode: 400 })
        await expect(startStepRound(id, 'mines', { bet: 5 })).rejects.toMatchObject({ statusCode: 400 })
        await expect(startStepRound(id, 'mines', { bet: 50, options: { mines: 0 } })).rejects.toMatchObject({ statusCode: 400 })
        await expect(startStepRound(id, 'mines', { bet: 500 })).rejects.toMatchObject({ statusCode: 400 })
        const start = await startStepRound(id, 'mines', { bet: 50 })
        expect(start).toMatchObject({ balance: 0, chips: 80 })
        expect(start.round.stakeChips).toBe(20)
    })

    it('never pays twice under a burst of parallel cash-outs and digs', async () => {
        const id = seedPlayer(1_000, 1_000, { origin: 'dev' })
        const start = await startStepRound(id, 'mines', { bet: 100, options: { mines: 2 } })
        const safe = safeTiles(stateOf(start.round.id))
        await actStepRound(id, 'mines', { step: 0, action: { type: 'reveal', tile: safe[0] } })
        const burst = await Promise.allSettled([
            ...Array.from({ length: 10 }, () => cashOutStepRound(id, 'mines')),
            ...safe.slice(1, 8).map(tile => actStepRound(id, 'mines', { step: 1, action: { type: 'reveal', tile } }))
        ])
        const won = burst.flatMap(r => r.status === 'fulfilled' ? [r.value] : [])
        const cashOuts = won.filter(r => r.round.status === 'cashed')
        expect(cashOuts.length).toBeLessThanOrEqual(1)
        for (const r of burst) if (r.status === 'rejected') expect([400, 409]).toContain(r.reason.statusCode)
        const paid = chipsOf(id)
        expect(chipLedgerSum(id)).toBe(paid)
        expect(paid).toBe(normalizeCoins(cashOuts.reduce((sum, r) => sum + r.chipsEarned, 0)))
        // Whatever won the race, the round paid at most once and is closed or still open with one step taken.
        const open = currentStepRound(id, 'mines')
        if (cashOuts.length) expect(open).toBeNull()
        else expect(open?.step).toBe(2)
        expect(db.select().from(gameRounds).where(and(eq(gameRounds.playerId, id), eq(gameRounds.game, 'mines'))).all().length).toBe(cashOuts.length)
    })

    it('never lets parallel starts open two rounds or charge twice', async () => {
        const id = seedPlayer(1_000, 1_000, { origin: 'dev' })
        const burst = await Promise.allSettled(Array.from({ length: 12 }, () => startStepRound(id, 'mines', { bet: 100, options: { mines: 3 } })))
        expect(burst.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        for (const r of burst) if (r.status === 'rejected') expect(r.reason).toMatchObject({ statusCode: 409 })
        expect(coinsOf(id).coins).toBe(900)
        expect(ledgerSum(id)).toBe(-100)
    })

    it('settles abandoned rounds: cashes out progress, refunds the rest in kind', async () => {
        const played = seedPlayer(1_000, 1_000, { origin: 'dev' })
        const idle = seedPlayer(30, 30, { origin: 'dev' })
        giveChips(idle, 100)
        const a = await startStepRound(played, 'mines', { bet: 100, options: { mines: 3 } })
        await actStepRound(played, 'mines', { step: 0, action: { type: 'reveal', tile: safeTiles(stateOf(a.round.id))[0] } })
        await startStepRound(idle, 'mines', { bet: 50 })
        expect(coinsOf(idle).coins).toBe(0)
        expect(chipsOf(idle)).toBe(80)

        // Nothing is old enough yet.
        expect(await settleAbandonedRounds(new Date(Date.now() - 60_000))).toBe(0)
        const closed = await settleAbandonedRounds(new Date(Date.now() + 1_000))
        expect(closed).toBeGreaterThanOrEqual(2)
        expect(currentStepRound(played, 'mines')).toBeNull()
        expect(chipsOf(played)).toBe(payFor(100, minesMultiplier(3, 1)))
        // The idle round had no gem: 30 coins and 20 chips go back as they came.
        expect(coinsOf(idle).coins).toBe(30)
        expect(chipsOf(idle)).toBe(100)
        expect(ledgerSum(idle)).toBe(0)
        expect(currentStepRound(idle, 'mines')).toBeNull()
        // A second sweep finds nothing to do.
        expect(await settleAbandonedRounds(new Date(Date.now() + 1_000))).toBe(0)
        expect(chipsOf(played)).toBe(payFor(100, minesMultiplier(3, 1)))
    })

    it('needs the game built', async () => {
        const id = seedPlayer(1_000, 1_000, { origin: 'dev', casino: 'none' })
        await expect(startStepRound(id, 'mines', { bet: 100 })).rejects.toMatchObject({ statusCode: 403 })
        expect(coinsOf(id).coins).toBe(1_000)
        await expect(startStepRound(id, 'nope', { bet: 100 })).rejects.toMatchObject({ statusCode: 404 })
    })
})
