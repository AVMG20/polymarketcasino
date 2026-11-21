import { describe, expect, it } from 'vitest'
import { seededRng } from '../shared/rng'
import { evaluateGrid, payFor, playSlot, SLOT_CONFIGS, slotPayout, triggerCount, type Cell, type Grid, type SlotConfig } from '../shared/slots'
import { tumble } from '../shared/slots/grid'

// A tiny 3×3 config per pay model, with round pays, so wins are easy to read.
const base = {
    id: 'test',
    cols: 3,
    rows: 3,
    weights: { a: 1, b: 1 },
    payScale: 1,
    maxWin: 1000
}
const symbols = {
    a: { kind: 'pay' as const, pays: { 3: 1 } },
    b: { kind: 'pay' as const, pays: { 3: 2 } },
    w: { kind: 'wild' as const, pays: { 3: 10 } },
    s: { kind: 'scatter' as const }
}

/** Build a grid from rows as written on screen (top row first). */
function fromRows(...rows: string[][]): Grid {
    return rows[0]!.map((_, col) => rows.map(row => row[col]!))
}

describe('payFor', () => {
    it('uses the highest listed count at or below the actual one', () => {
        const pays = { 5: 1, 8: 2, 12: 5 }
        expect(payFor(pays, 4)).toBe(0)
        expect(payFor(pays, 5)).toBe(1)
        expect(payFor(pays, 11)).toBe(2)
        expect(payFor(pays, 30)).toBe(5)
    })
})

describe('lines', () => {
    const config: SlotConfig = { ...base, symbols, pay: { type: 'lines', lines: [[0, 0, 0], [1, 1, 1], [0, 1, 2]] } }

    it('pays left-to-right runs with wild substitution', () => {
        const wins = evaluateGrid(config, fromRows(['a', 'w', 'a'], ['b', 'b', 'a'], ['a', 'a', 'b']))
        expect(wins.map(win => [win.line, win.symbol, win.count, win.pay])).toEqual([[0, 'a', 3, 1]])
    })

    it('pays leading wilds as wilds when that beats the symbol', () => {
        const wins = evaluateGrid(config, fromRows(['w', 'w', 'w'], ['b', 'a', 'b'], ['a', 'a', 'b']))
        expect(wins.find(win => win.line === 0)).toMatchObject({ symbol: 'w', count: 3, pay: 10 })
    })

    it('never pays through a scatter', () => {
        expect(evaluateGrid(config, fromRows(['a', 's', 'a'], ['b', 'a', 'b'], ['a', 'b', 'b']))).toEqual([])
    })
})

describe('ways', () => {
    const config: SlotConfig = { ...base, symbols: { a: symbols.a, b: symbols.b, w: { kind: 'wild' } }, pay: { type: 'ways' } }

    it('multiplies matches per reel into ways', () => {
        // a on reel 1 (twice), reel 2 (once + a wild), reel 3 (once): 2 × 2 × 1 = 4 ways.
        const wins = evaluateGrid(config, fromRows(['a', 'a', 'b'], ['a', 'w', 'a'], ['b', 'b', 'b']))
        const a = wins.find(win => win.symbol === 'a')!
        expect(a).toMatchObject({ count: 3, ways: 4, pay: 4 })
    })

    it('stops at the first reel without a match', () => {
        const wins = evaluateGrid(config, fromRows(['a', 'b', 'a'], ['a', 'b', 'a'], ['b', 'b', 'a']))
        expect(wins.find(win => win.symbol === 'a')).toBeUndefined()
    })
})

describe('clusters', () => {
    const config: SlotConfig = {
        ...base,
        symbols: { a: { kind: 'pay', pays: { 4: 1, 6: 3 } }, b: { kind: 'pay', pays: { 4: 2 } }, w: { kind: 'wild' } },
        pay: { type: 'cluster', minSize: 4 }
    }

    it('pays orthogonally connected groups by size, wilds joining any cluster', () => {
        const wins = evaluateGrid(config, fromRows(['a', 'a', 'b'], ['a', 'w', 'b'], ['b', 'b', 'b']))
        expect(wins.find(win => win.symbol === 'a')).toMatchObject({ count: 4, pay: 1 })
        expect(wins.find(win => win.symbol === 'b')).toMatchObject({ count: 6, pay: 2 })
    })

    it('ignores diagonal neighbours', () => {
        expect(evaluateGrid(config, fromRows(['a', 'b', 'a'], ['b', 'a', 'b'], ['a', 'b', 'a']))).toEqual([])
    })
})

describe('tumble', () => {
    it('drops survivors down and refills from the top', () => {
        const grid = fromRows(['a', 'b', 'a'], ['b', 'b', 'b'], ['a', 'a', 'b'])
        const next = tumble(seededRng(1), grid, [[0, 2], [1, 1], [1, 2]], { s: 1 })
        expect(next[0]).toEqual(['s', 'a', 'b'])
        expect(next[1]).toEqual(['s', 's', 'b'])
        expect(next[2]).toEqual(grid[2])
    })
})

describe('playSlot', () => {
    it('is deterministic for a seed and bounded by the max win', () => {
        for (const config of Object.values(SLOT_CONFIGS)) {
            const a = playSlot(config, seededRng(7))
            const b = playSlot(config, seededRng(7))
            expect(a).toEqual(b)
            for (let i = 0; i < 300; i++) {
                const outcome = playSlot(config, seededRng(i))
                expect(outcome.win).toBeLessThanOrEqual(config.maxWin)
                expect(outcome.win).toBeGreaterThanOrEqual(0)
            }
        }
    })

    it('a bought round always reaches free spins', () => {
        for (const config of Object.values(SLOT_CONFIGS)) {
            for (let seed = 0; seed < 25; seed++) {
                const outcome = playSlot(config, seededRng(seed), { buy: true })
                expect(outcome.bought).toBe(true)
                expect(outcome.base.scatters).toBeGreaterThanOrEqual(triggerCount(config))
                expect(outcome.freeSpins.length).toBeGreaterThan(0)
            }
        }
    })

    it('adds up step wins, scatter pays and free spins into the round win', () => {
        const config = SLOT_CONFIGS.trashpanda!
        for (let seed = 0; seed < 50; seed++) {
            const outcome = playSlot(config, seededRng(seed), { buy: seed % 2 === 0 })
            const spins = [outcome.base, ...outcome.freeSpins]
            for (const spin of spins) {
                const steps = spin.steps.reduce((sum, step) => sum + step.win, 0)
                expect(spin.win).toBeCloseTo(steps + spin.scatterWin, 9)
            }
            const total = spins.reduce((sum, spin) => sum + spin.win, 0)
            expect(outcome.win).toBeCloseTo(Math.min(total, config.maxWin), 9)
        }
    })

    it('keeps sticky wilds in place for the rest of the feature', () => {
        const config = SLOT_CONFIGS.trashpanda!
        const outcome = playSlot(config, seededRng(3), { buy: true })
        let held: readonly Cell[] = []
        for (const spin of outcome.freeSpins) {
            const grid = spin.steps[0]!.grid
            for (const [col, row] of held) expect(grid[col]![row]).toBe('wild')
            held = spin.sticky ?? []
        }
    })

    it('pays whole coins, rounded down', () => {
        const outcome = playSlot(SLOT_CONFIGS.spinata!, seededRng(11))
        expect(slotPayout({ ...outcome, win: 1.239 }, 100)).toBe(123)
        expect(slotPayout({ ...outcome, win: 0 }, 100)).toBe(0)
    })
})
