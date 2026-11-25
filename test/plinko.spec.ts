import { describe, expect, it } from 'vitest'
import { normalizeCoins, payFor } from '../shared/money'
import { parsePlinkoOptions, playPlinko, PLINKO_MAX_ROWS, PLINKO_MIN_ROWS, PLINKO_RISKS, PLINKO_TABLES, plinkoOdds, plinkoRtp } from '../shared/games/plinko'
import { seededRng, type Rng } from '../shared/rng'
import { playRound } from '../server/utils/rounds'
import { chipLedgerSum, chipsOf, coinsOf, ledgerSum, seedPlayer } from './setup/players'

const fixed = (value: number): Rng => ({ next: () => value })

describe('pegfall rules', () => {
    it('has a symmetric table per risk and row count', () => {
        for (const risk of PLINKO_RISKS) {
            for (let rows = PLINKO_MIN_ROWS; rows <= PLINKO_MAX_ROWS; rows++) {
                const table = PLINKO_TABLES[risk][rows]!
                expect(table).toHaveLength(rows + 1)
                expect([...table].reverse()).toEqual([...table])
                // At most one decimal, so a summed round stays exact in tenths.
                for (const m of table) expect(Math.round(m * 10) / 10).toBe(m)
                // Below 1, so chips stay bounded by coins (the exact figures are scripts/plinko-rtp.ts's job).
                expect(plinkoRtp(rows, risk)).toBeLessThan(1)
            }
        }
        expect(plinkoOdds(8).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    })

    it('lands where the path goes: the slot is the number of rights', () => {
        expect(playPlinko(fixed(0.1), { rows: 8, risk: 'high', balls: 1 }).balls[0]).toMatchObject({ slot: 0, multiplier: 29, path: [0, 0, 0, 0, 0, 0, 0, 0] })
        expect(playPlinko(fixed(0.9), { rows: 16, risk: 'high', balls: 1 }).balls[0]).toMatchObject({ slot: 16, multiplier: 1000 })
        const round = playPlinko(seededRng(3), { rows: 12, risk: 'medium', balls: 10 })
        expect(round.balls).toHaveLength(10)
        for (const ball of round.balls) {
            expect(ball.path).toHaveLength(12)
            expect(ball.slot).toBe(ball.path.filter(step => step === 1).length)
            expect(ball.multiplier).toBe(PLINKO_TABLES.medium[12]![ball.slot])
        }
        expect(round.multiplier).toBe(normalizeCoins(round.balls.reduce((sum, ball) => sum + ball.multiplier, 0)))
    })

    it('validates the options', () => {
        expect(parsePlinkoOptions({})).toEqual({ rows: 12, risk: 'medium', balls: 1 })
        for (const bad of [{ rows: 7 }, { rows: 17 }, { rows: 12.5 }, { rows: '12' }, { risk: 'wild' }, { balls: 0 }, { balls: 11 }, { balls: 1.5 }]) {
            expect(() => parsePlinkoOptions(bad)).toThrow(RangeError)
        }
    })
})

describe('pegfall rounds', () => {
    it('stakes a bet per ball and pays the slots and the 1% rakeback in chips', async () => {
        const id = seedPlayer(10_000, 10_000, { origin: 'dev' })
        const round = await playRound(id, 'plinko', { bet: 10.5, options: { rows: 8, risk: 'low', balls: 4 } })
        expect(round.stake).toBe(42)
        const result = round.result as { multiplier: number, balls: unknown[] }
        expect(result.balls).toHaveLength(4)
        expect(round.payout).toBe(payFor(10.5, result.multiplier))
        expect(coinsOf(id).coins).toBe(10_000 - 42)
        expect(ledgerSum(id)).toBe(-42)
        expect(chipsOf(id)).toBe(normalizeCoins(round.payout + 0.42))
        expect(chipLedgerSum(id)).toBe(normalizeCoins(round.payout + 0.42))
    })

    it('refuses a drop over the maximum stake without charging', async () => {
        const id = seedPlayer(10_000_000, 10_000_000, { origin: 'dev' })
        await expect(playRound(id, 'plinko', { bet: 200_000, options: { balls: 10 } })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'plinko', { bet: 100, options: { rows: 20 } })).rejects.toMatchObject({ statusCode: 400 })
        expect(coinsOf(id).coins).toBe(10_000_000)
    })
})
