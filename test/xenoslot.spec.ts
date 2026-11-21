import { describe, expect, it } from 'vitest'
import { seededRng, type Rng } from '../shared/rng'
import {
    evaluateLine,
    evaluateLines,
    parseXenoSlotOptions,
    playXenoSlot,
    runBonus,
    XS_BONUS_SPINS,
    XS_BONUS_TRIGGER,
    XS_BUY_COST,
    XS_COLS,
    XS_MAX_WIN,
    XS_ROWS,
    xenoSlotPayout,
    type Cell,
    type XsSymbol
} from '../shared/slots/xenoslot'
import { serverGame } from '../server/utils/games'
import { playRound } from '../server/utils/rounds'
import { coinsOf, seedPlayer } from './setup/players'

/** A grid from three rows of five symbols (top, middle, bottom). */
function gridOf(rows: XsSymbol[][]): XsSymbol[][] {
    return Array.from({ length: XS_COLS }, (_, col) => Array.from({ length: XS_ROWS }, (_, row) => rows[row]![col]!))
}

const fill = (symbol: XsSymbol): XsSymbol[] => Array<XsSymbol>(XS_COLS).fill(symbol)

/** Plays back `values`, then `rest` forever. */
function scripted(values: number[], rest = 0.99): Rng {
    let i = 0
    return { next: () => (i < values.length ? values[i++]! : rest) }
}

// Draw values that land on a weighted table's first or last entry.
const FIRST = 0
const LAST = 0.99999

describe('xenoslot lines', () => {
    it('pays 3+ from the first reel in line bets (bet / 5)', () => {
        const grid = gridOf([fill('jack'), ['ten', 'ten', 'ten', 'jack', 'ace'], fill('queen')])
        expect(evaluateLine(grid, 0)).toMatchObject({ symbol: 'ten', count: 3, win: 5 / 5 })
        expect(evaluateLine(grid, 1)).toMatchObject({ symbol: 'jack', count: 5, win: 25 / 5 })
        expect(evaluateLine(grid, 2)).toMatchObject({ symbol: 'queen', count: 5, win: 40 / 5 })
    })

    it('follows the V and ^ lines', () => {
        const grid = gridOf([
            ['seven', 'ten', 'jack', 'queen', 'king'],
            ['ace', 'seven', 'ace', 'seven', 'ace'],
            ['ten', 'jack', 'seven', 'king', 'seven']
        ])
        // V: top, middle, bottom, middle, top.
        expect(evaluateLine(grid, 3)).toMatchObject({ symbol: 'seven', count: 4, win: 120 / 5 })
        expect(evaluateLine(grid, 3)!.cells).toEqual([{ col: 0, row: 0 }, { col: 1, row: 1 }, { col: 2, row: 2 }, { col: 3, row: 1 }])
        // ^: bottom, middle, top: ten, seven, jack.
        expect(evaluateLine(grid, 4)).toBeNull()
    })

    it('lets the wild stand in for any symbol but the portal', () => {
        const middle = (row: XsSymbol[]) => evaluateLine(gridOf([fill('jack'), row, fill('queen')]), 0)
        expect(middle(['wild', 'ten', 'wild', 'ten', 'king'])).toMatchObject({ symbol: 'ten', count: 4, win: 10 / 5 })
        expect(middle(['bell', 'wild', 'bell', 'ace', 'ace'])).toMatchObject({ symbol: 'bell', count: 3 })
        expect(middle(['bonus', 'ten', 'ten', 'ten', 'ten'])).toBeNull()
        expect(middle(['wild', 'bonus', 'bonus', 'ten', 'ten'])).toBeNull()
        expect(middle(['ten', 'ten', 'bonus', 'ten', 'ten'])).toBeNull()
    })

    it('pays the better reading of leading wilds', () => {
        const middle = (row: XsSymbol[]) => evaluateLine(gridOf([fill('jack'), row, fill('queen')]), 0)
        // Three wilds (120) beat five tens (25).
        expect(middle(['wild', 'wild', 'wild', 'ten', 'ten'])).toMatchObject({ symbol: 'wild', count: 3, win: 120 / 5 })
        // Five diamonds (750) beat nothing: two wilds alone don't pay.
        expect(middle(['wild', 'wild', 'diamond', 'diamond', 'diamond'])).toMatchObject({ symbol: 'diamond', count: 5, win: 750 / 5 })
        // Three wilds then diamonds: 4 diamonds (250) beat 3 wilds (120).
        expect(middle(['wild', 'wild', 'wild', 'diamond', 'ten'])).toMatchObject({ symbol: 'diamond', count: 4, win: 250 / 5 })
        expect(middle(fill('wild'))).toMatchObject({ symbol: 'wild', count: 5, win: 2500 / 5 })
    })

    it('adds every winning line', () => {
        const grid = gridOf([fill('ace'), fill('ace'), fill('ace')])
        const wins = evaluateLines(grid)
        expect(wins).toHaveLength(5)
        expect(wins.reduce((a, w) => a + w.win, 0)).toBeCloseTo(5 * 60 / 5)
    })
})

describe('xenoslot hold & win', () => {
    it('starts with 3+ portals and seeds a coin on each', () => {
        const rng = seededRng(7)
        let triggered = 0
        for (let i = 0; i < 4000; i++) {
            const result = playXenoSlot(rng)
            const portals = result.grid.flat().filter(s => s === 'bonus').length
            expect(result.bonus !== null).toBe(portals >= XS_BONUS_TRIGGER)
            if (!result.bonus) continue
            triggered++
            expect(result.bonus.seed.map(c => c.cell)).toEqual(result.bonusCells)
            expect(result.bonus.waves).toHaveLength(XS_BONUS_SPINS)
        }
        expect(triggered).toBeGreaterThan(0)
    })

    it('keeps coins, multiplies neighbours, and pays only what a UFO collects', () => {
        const rng = seededRng(11)
        const key = (c: Cell) => `${c.col}:${c.row}`
        for (let i = 0; i < 300; i++) {
            const bonus = runBonus(rng, [{ col: 0, row: 0 }, { col: 2, row: 1 }, { col: 4, row: 2 }])
            let board = new Map(bonus.seed.map(c => [key(c.cell), c.value]))
            let collected = 0
            for (const wave of bonus.waves) {
                // Only free cells spin.
                expect(wave.spinning.every(c => !board.has(key(c)))).toBe(true)
                const next = new Map(board)
                for (const coin of wave.coins) next.set(key(coin.cell), coin.value)
                for (const glover of wave.glovers) {
                    for (const up of glover.upgrades) {
                        expect(Math.max(Math.abs(up.cell.col - glover.cell.col), Math.abs(up.cell.row - glover.cell.row))).toBe(1)
                        expect(up.from).toBe(next.get(key(up.cell)))
                        expect(up.to).toBeCloseTo(up.from * glover.mult)
                        next.set(key(up.cell), up.to)
                    }
                }
                if (wave.collectors.length) {
                    const sum = [...next.values()].reduce((a, v) => a + v, 0)
                    expect(wave.collected).toBeCloseTo(sum * wave.collectors.length)
                    expect(wave.board).toEqual([])
                    collected += wave.collected
                    next.clear()
                } else {
                    expect(wave.collected).toBe(0)
                }
                expect(new Map(wave.board.map(c => [key(c.cell), c.value]))).toEqual(next)
                board = next
            }
            expect(bonus.win).toBeCloseTo(collected)
        }
    })

    it('pays nothing for coins left on the board', () => {
        // Three portals on the first reel, tens elsewhere; then nothing lands.
        const rng = scripted([LAST, LAST, LAST, ...Array(12).fill(FIRST), FIRST, FIRST, FIRST])
        const result = playXenoSlot(rng)
        expect(result.bonus!.seed.map(c => c.value)).toEqual([0.2, 0.2, 0.2])
        expect(result.bonus!.waves.at(-1)!.board).toHaveLength(3)
        expect(result.bonus!.win).toBe(0)
        expect(result.lines).toEqual([])
        expect(result.win).toBe(0)
    })

    it('boosts the coins around a core before the UFO collects them', () => {
        const rng = scripted([
            LAST, LAST, LAST, ...Array(12).fill(FIRST), // portals down the first reel
            FIRST, FIRST, FIRST, // three 0.2× seeds
            0.22, LAST, // spin 1: a ×10 core next to the top two coins
            ...Array(11).fill(0.99),
            0.2 // spin 2: a UFO
        ])
        const bonus = playXenoSlot(rng).bonus!
        expect(bonus.waves[0]!.glovers).toMatchObject([{ cell: { col: 1, row: 0 }, mult: 10 }])
        expect(bonus.waves[0]!.glovers[0]!.upgrades.map(u => u.to)).toEqual([2, 2])
        expect(bonus.waves[1]!.collectors).toHaveLength(1)
        expect(bonus.waves[1]!.collected).toBeCloseTo(4.2)
        expect(bonus.win).toBeCloseTo(4.2)
    })

    it('caps the round at the max win', () => {
        const fullBoard = [...Array(14).fill([FIRST, LAST]).flat(), 0.23] // 14 coins of 50× and a UFO
        const rng = scripted([
            ...Array(14).fill(LAST), FIRST, // 14 portals and a ten
            ...Array(14).fill(LAST), // 50× seeds
            0.07, // spin 1: a UFO collects 700×
            ...Array(9).fill(fullBoard).flat()
        ])
        const result = playXenoSlot(rng)
        expect(result.bonus!.win).toBeCloseTo(7000)
        expect(result.win).toBe(XS_MAX_WIN)
        expect(result.capped).toBe(true)
        expect(xenoSlotPayout(result, 100)).toBe(500_000)
    })
})

describe('xenoslot buy and stakes', () => {
    it('always starts the bonus with exactly 3 coins and no line wins', () => {
        const rng = seededRng(3)
        for (let i = 0; i < 500; i++) {
            const result = playXenoSlot(rng, { buy: true })
            expect(result.buy).toBe(true)
            expect(result.lines).toEqual([])
            expect(result.grid.flat().filter(s => s === 'bonus')).toHaveLength(XS_BONUS_TRIGGER)
            expect(result.bonus!.seed).toHaveLength(XS_BONUS_TRIGGER)
            expect(result.win).toBeLessThanOrEqual(XS_MAX_WIN)
        }
    })

    it('stakes the bet, or the buy price, and pays whole coins', () => {
        const game = serverGame('xenoslot')!
        const rng = seededRng(5)
        for (let i = 0; i < 200; i++) {
            const spin = game.play({ bet: 150, options: {}, rng })
            expect(spin.stake).toBe(150)
            expect(Number.isSafeInteger(spin.payout)).toBe(true)
        }
        const buy = game.play({ bet: 150, options: { buy: true }, rng })
        expect(buy.stake).toBe(150 * XS_BUY_COST)
        expect(Number.isSafeInteger(XS_BUY_COST)).toBe(true)
    })

    it('rejects bad options', () => {
        const game = serverGame('xenoslot')!
        const rng = seededRng(1)
        expect(() => game.play({ bet: 100, options: { buy: 'yes' }, rng })).toThrow(RangeError)
        expect(() => game.play({ bet: 100, options: { buyBonus: true }, rng })).toThrow(RangeError)
        expect(parseXenoSlotOptions({ buy: false })).toEqual({ buy: false })
    })

    it('settles through playRound within the bet limits', async () => {
        const id = seedPlayer(100_000)
        await expect(playRound(id, 'xenoslot', { bet: 99 })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'xenoslot', { bet: 1_000_001 })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'xenoslot', { bet: 100, options: { buy: 1 } })).rejects.toMatchObject({ statusCode: 400 })
        expect(coinsOf(id).coins).toBe(100_000)
        const buy = await playRound(id, 'xenoslot', { bet: 100, options: { buy: true } })
        expect(buy.stake).toBe(100 * XS_BUY_COST)
        expect(buy.balance).toBe(100_000 - buy.stake + buy.payout)
        // A player who can't cover the buy is refused and keeps every coin.
        const poor = seedPlayer(1_000)
        await expect(playRound(poor, 'xenoslot', { bet: 100, options: { buy: true } })).rejects.toMatchObject({ statusCode: 400 })
        expect(coinsOf(poor).coins).toBe(1_000)
    })
})
