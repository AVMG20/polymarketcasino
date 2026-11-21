import { describe, expect, it } from 'vitest'
import { seededRng, type Rng } from '../shared/rng'
import {
    BONUS_PAY,
    evalGrid,
    parseSpinataOptions,
    PAYLINES,
    PAYTABLE,
    PINATA_POT_PRIZES,
    playSpinata,
    SCATTER_PAY,
    SPN_BUY_BONUS_COST,
    SPN_COLS,
    SPN_FREE_SPINS,
    SPN_LINES,
    SPN_MAX_WIN_MULT,
    SPN_ROWS,
    SPN_SCATTER_TRIGGER,
    SPN_TRACK_CAP,
    SPN_TRACK_START,
    SYMBOL_WEIGHTS,
    spinataStake,
    type SpinSymbol
} from '../shared/slots/spinata'
import { playRound } from '../server/utils/rounds'
import { coinsOf, ledgerSum, seedPlayer } from './setup/players'

/** A grid from three rows of five symbols (top, middle, bottom). */
function gridOf(rows: SpinSymbol[][]): SpinSymbol[][] {
    return Array.from({ length: SPN_COLS }, (_, col) => Array.from({ length: SPN_ROWS }, (_, row) => rows[row]![col]!))
}

const TOP: SpinSymbol[] = ['ten', 'jack', 'queen', 'king', 'maracas']
const BOTTOM: SpinSymbol[] = ['cactus', 'sombrero', 'flower', 'jack', 'queen']

/** Every draw lands on `symbol` (weighted picks walk the table in key order). */
function always(symbol: SpinSymbol): Rng {
    const keys = Object.keys(SYMBOL_WEIGHTS) as SpinSymbol[]
    const total = keys.reduce((sum, k) => sum + SYMBOL_WEIGHTS[k], 0)
    let before = 0
    for (const k of keys) {
        if (k === symbol) break
        before += SYMBOL_WEIGHTS[k]
    }
    const value = (before + SYMBOL_WEIGHTS[symbol] / 2) / total
    return { next: () => value }
}

const count = (grid: SpinSymbol[][], symbol: SpinSymbol) => grid.flat().filter(s => s === symbol).length

describe('spinata lines', () => {
    it('pays left to right with wilds standing in, best symbol per line', () => {
        const grid = gridOf([TOP, ['wild', 'wild', 'ace', 'ace', 'ten'], BOTTOM])
        expect(evalGrid(grid).find(w => w.line === 0)).toMatchObject({ symbol: 'ace', count: 4, pay: PAYTABLE.ace[1] })
        // Three wilds pay more as wilds than as five tens.
        const wilds = gridOf([TOP, ['wild', 'wild', 'wild', 'ten', 'ten'], BOTTOM])
        expect(evalGrid(wilds).find(w => w.line === 0)).toMatchObject({ symbol: 'wild', count: 3, pay: PAYTABLE.wild[0] })
    })

    it('never pays through a scatter or a piñata', () => {
        for (const blocker of ['scatter', 'bonus'] as const) {
            const grid = gridOf([TOP, ['ace', blocker, 'ace', 'ace', 'ace'], BOTTOM])
            expect(evalGrid(grid).find(w => w.line === 0)).toBeUndefined()
        }
    })

    it('pays a full board on every line, in line bets', () => {
        // The old site lists 53 lines but prices them as 50 (line bet = bet / 50); kept as it was.
        const result = playSpinata(always('ten'), 100)
        expect(result.lines).toHaveLength(PAYLINES.length)
        expect(result.payout).toBe(PAYTABLE.ten[2] * 2 * PAYLINES.length)
        expect(result.freeSpinsTriggered).toBe(false)
    })
})

describe('spinata features', () => {
    it('pays scatters and piñatas anywhere and starts the free spins on 3 scatters', () => {
        const rng = seededRng(5)
        let triggered = 0
        let prizes = 0
        for (let i = 0; i < 20_000; i++) {
            const r = playSpinata(rng, 100)
            const scatters = count(r.grid, 'scatter')
            const pinatas = count(r.grid, 'bonus')
            expect(r.scatterCount).toBe(scatters)
            expect(r.freeSpinsTriggered).toBe(scatters >= SPN_SCATTER_TRIGGER)
            expect(r.bonusPrizeTriggered).toBe(pinatas >= 3)
            expect(r.bonusPrizePayout).toBe(pinatas >= 3 ? BONUS_PAY[Math.min(pinatas, 5)]! * 100 : 0)
            const lineWin = r.lines.reduce((sum, w) => sum + w.pay, 0) * 100 / SPN_LINES
            expect(r.basePayout).toBeCloseTo(lineWin + (SCATTER_PAY[Math.min(scatters, 5)] ?? 0) * 100, 3)
            if (r.freeSpinsTriggered) triggered++
            if (r.bonusPrizeTriggered) prizes++
        }
        expect(triggered).toBeGreaterThan(0)
        expect(prizes).toBeGreaterThan(0)
    })

    it('climbs the multiplier by one per wild up to ×20 and fills the pot from piñatas', () => {
        const rng = seededRng(9)
        for (let i = 0; i < 300; i++) {
            const r = playSpinata(rng, 100, { feature: 'buyBonus' })
            expect(r.freeSpins).toHaveLength(SPN_FREE_SPINS)
            let track = SPN_TRACK_START
            let lines = 0
            let pot = 0
            for (const fs of r.freeSpins!) {
                expect(count(fs.grid, 'scatter')).toBe(0)
                expect(fs.trackBefore).toBe(track)
                track = Math.min(track + count(fs.grid, 'wild'), SPN_TRACK_CAP)
                expect(fs.trackAfter).toBe(track)
                expect(fs.spinPayout).toBeCloseTo(fs.lines.reduce((sum, w) => sum + w.pay, 0) * 100 / SPN_LINES * track, 6)
                expect(fs.pinataPrizes).toHaveLength(count(fs.grid, 'bonus'))
                for (const prize of fs.pinataPrizes) expect(PINATA_POT_PRIZES).toContain(prize)
                lines += fs.spinPayout
                pot += fs.pinataPrizes.reduce((sum, p) => sum + p * 100, 0)
            }
            expect(r.freeSpinsPayout).toBeCloseTo(lines, 3)
            expect(r.pinataPotTotal).toBeCloseTo(pot, 3)
        }
    })

    it('a bought round always lands the scatters and costs 52× the bet', () => {
        const rng = seededRng(3)
        for (let i = 0; i < 200; i++) {
            const r = playSpinata(rng, 250, { feature: 'buyBonus' })
            expect(r.scatterCount).toBeGreaterThanOrEqual(SPN_SCATTER_TRIGGER)
            expect(r.freeSpinsTriggered).toBe(true)
            expect(r.cost).toBe(250 * SPN_BUY_BONUS_COST)
        }
        expect(spinataStake(250, { feature: 'buyBonus' })).toBe(250 * SPN_BUY_BONUS_COST)
        expect(spinataStake(250, {})).toBe(250)
    })
})

describe('spinata payout', () => {
    it('pays whole coins, rounded down, of the capped win', () => {
        const rng = seededRng(17)
        for (let i = 0; i < 20_000; i++) {
            const bet = 100 + (i % 37) * 13
            const r = playSpinata(rng, bet, i % 50 === 0 ? { feature: 'buyBonus' } : {})
            const total = Math.min(r.basePayout + r.bonusPayout, SPN_MAX_WIN_MULT * bet)
            expect(Number.isSafeInteger(r.payout)).toBe(true)
            expect(r.payout).toBe(Math.floor(bet * r.win + 1e-6))
            expect(Math.abs(r.payout - total)).toBeLessThan(1.001)
            expect(r.payout).toBeLessThanOrEqual(total + 1e-6)
        }
    })

    it('caps a round at 5,000× the bet', () => {
        const r = playSpinata(always('wild'), 100)
        expect(r.basePayout).toBeGreaterThan(SPN_MAX_WIN_MULT * 100)
        expect(r.capped).toBe(true)
        expect(r.win).toBe(SPN_MAX_WIN_MULT)
        expect(r.payout).toBe(SPN_MAX_WIN_MULT * 100)
    })

    it('validates options and the bet', () => {
        expect(parseSpinataOptions({})).toEqual({})
        expect(parseSpinataOptions({ feature: 'buyBonus' })).toEqual({ feature: 'buyBonus' })
        for (const options of [{ feature: 'buy' }, { feature: true }, { buy: true }, { feature: 'buyBonus', ante: true }]) {
            expect(() => parseSpinataOptions(options)).toThrow(RangeError)
        }
        for (const bet of [0, -5, Number.NaN, Infinity]) expect(() => playSpinata(seededRng(1), bet)).toThrow(RangeError)
    })
})

describe('spinata rounds', () => {
    it('settles spins and bought free spins through playRound', async () => {
        const id = seedPlayer(1_000_000)
        let expected = 1_000_000
        for (let i = 0; i < 40; i++) {
            const round = await playRound(id, 'spinata', { bet: 100 })
            const result = round.result as ReturnType<typeof playSpinata>
            expect(round.stake).toBe(100)
            expect(round.payout).toBe(result.payout)
            expected += round.payout - round.stake
            expect(round.balance).toBe(expected)
        }
        const buy = await playRound(id, 'spinata', { bet: 200, options: { feature: 'buyBonus' } })
        expect(buy.stake).toBe(200 * SPN_BUY_BONUS_COST)
        expect((buy.result as ReturnType<typeof playSpinata>).freeSpins).toHaveLength(SPN_FREE_SPINS)
        expected += buy.payout - buy.stake
        expect(coinsOf(id).coins).toBe(expected)
        expect(ledgerSum(id)).toBe(expected - 1_000_000)
    })

    it('rejects bad bets and options without charging', async () => {
        const id = seedPlayer(100_000)
        await expect(playRound(id, 'spinata', { bet: 50 })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'spinata', { bet: 150.5 })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'spinata', { bet: 2_000_000 })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'spinata', { bet: '100' })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'spinata', { bet: 100, options: { feature: 'free' } })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'spinata', { bet: 100, options: { buy: true } })).rejects.toMatchObject({ statusCode: 400 })
        // A buy the balance can't cover is refused by the debit guard.
        await expect(playRound(id, 'spinata', { bet: 10_000, options: { feature: 'buyBonus' } })).rejects.toMatchObject({ statusCode: 400 })
        expect(coinsOf(id).coins).toBe(100_000)
        expect(ledgerSum(id)).toBe(0)
    })
})
