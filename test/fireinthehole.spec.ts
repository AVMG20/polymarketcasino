import { describe, expect, it } from 'vitest'
import { isCoinAmount, payFor } from '../shared/money'
import { seededRng } from '../shared/rng'
import {
    calculateStepPay,
    capWin,
    detectConnections,
    findScatters,
    FITH_BUY_COST,
    FITH_COLS,
    FITH_MAX_LINES,
    FITH_MAX_WIN,
    FITH_ROWS,
    FITH_SCATTERS_FOR_BONUS,
    FITH_STARTING_LINES,
    FITH_SYMBOL_PAY,
    fithChainMultiplier,
    playBonus,
    playFireInTheHole,
    resolveBombExplosions,
    type FireGrid,
    type FireSymbol
} from '../shared/slots/fireinthehole'
import { serverGame } from '../server/utils/games'

/**
 * A grid from rows as written on screen (top row first). Missing rows are
 * rock; `.` is filler (ruby, sapphire, emerald) that never touches its own kind.
 */
function fromRows(...rows: string[]): FireGrid {
    const names: Record<string, FireSymbol> = { c: 'coal', o: 'ore', b: 'bomb', l: 'scatter' }
    return Array.from({ length: FITH_COLS }, (_, col) => Array.from({ length: FITH_ROWS }, (_, row) => {
        const ch = rows[row]?.[col]
        if (ch === undefined) return 'rock'
        if (ch === '.') return (['ruby', 'sapphire', 'emerald'] as const)[(col + 2 * row) % 3]!
        return names[ch]!
    }))
}

const keys = (cells: { col: number, row: number }[]) => cells.map(c => `${c.col}:${c.row}`).sort()

describe('fire in the hole clusters', () => {
    it('pays 5+ touching symbols, not 4', () => {
        expect(keys(detectConnections(fromRows('ccccc.', '......', '......'), 3))).toEqual(['0:0', '1:0', '2:0', '3:0', '4:0'])
        expect(detectConnections(fromRows('cccc..', '.....c', '......'), 3)).toEqual([])
    })

    it('counts only up, down, left and right as touching', () => {
        // A diagonal staircase of coal never connects.
        expect(detectConnections(fromRows('c.....', '.c....', '..cc..'), 3)).toEqual([])
        // An L shape does.
        expect(detectConnections(fromRows('c.....', 'c.....', 'ccc...'), 3)).toHaveLength(5)
    })

    it('lets dynamite stand in, but a cluster needs a real symbol', () => {
        expect(detectConnections(fromRows('ccbcc.', '......', '......'), 3)).toHaveLength(5)
        // One open row of dynamite and a lantern: nothing real to match.
        expect(detectConnections(fromRows('bbbbbl'), 1)).toEqual([])
    })

    it('ignores the locked rows below the open ones', () => {
        const grid = fromRows('c.....', 'c.....', 'c.....', 'c.....', 'c.....')
        expect(detectConnections(grid, 3)).toEqual([])
        expect(detectConnections(grid, 5)).toHaveLength(5)
    })

    it('pays each cleared ore at its value times the cascade multiplier', () => {
        const grid = fromRows('ccccc.', '......', '......')
        const cells = detectConnections(grid, 3)
        expect(calculateStepPay(grid, cells, 0)).toBeCloseTo(5 * FITH_SYMBOL_PAY.coal, 9)
        expect(calculateStepPay(grid, cells, 2)).toBeCloseTo(5 * FITH_SYMBOL_PAY.coal * fithChainMultiplier(2), 9)
        expect(fithChainMultiplier(0)).toBe(1)
        // Dynamite in a cluster pays nothing itself.
        const withBomb = fromRows('ccbcc.', '......', '......')
        expect(calculateStepPay(withBomb, detectConnections(withBomb, 3), 0)).toBeCloseTo(4 * FITH_SYMBOL_PAY.coal, 9)
    })
})

describe('fire in the hole dynamite', () => {
    it('blasts its 8 neighbours, chains into other dynamite and spares lanterns', () => {
        const grid = fromRows('ccbcc.', '.l...b', '......')
        const { winCells, bombCells, lineBombCells } = resolveBombExplosions(grid, detectConnections(grid, 3), 3)
        const won = new Set(keys(winCells))
        // Around the bomb at (2,0): (1,1) is a lantern and survives, (2,1) and (3,1) go.
        expect(won.has('1:1')).toBe(false)
        expect(won.has('2:1')).toBe(true)
        expect(won.has('3:1')).toBe(true)
        // The bomb's blast reaches nothing at (5,1), so that dynamite stays.
        expect(won.has('5:1')).toBe(false)
        expect(keys(bombCells)).toEqual(['2:0'])
        // Row 0 is not in the bottom two of three open rows.
        expect(lineBombCells).toEqual([])
    })

    it('opens a row for dynamite that goes off in the bottom two open rows', () => {
        const grid = fromRows('......', 'ccbcc.', '..b...')
        const { bombCells, lineBombCells } = resolveBombExplosions(grid, detectConnections(grid, 3), 3)
        // The bomb at (2,1) sets off the one at (2,2).
        expect(keys(bombCells)).toEqual(['2:1', '2:2'])
        expect(keys(lineBombCells)).toEqual(['2:1', '2:2'])
    })
})

describe('fire in the hole rounds', () => {
    it('replays consistently: cascades add up, rows only open, the bonus needs 3 lanterns at rest', () => {
        const rng = seededRng(42)
        let features = 0
        for (let i = 0; i < 1200; i++) {
            const outcome = playFireInTheHole(rng)
            let total = 0
            let lines = FITH_STARTING_LINES
            for (const step of outcome.steps) {
                expect(step.activeLinesBefore).toBe(lines)
                expect(step.activeLinesAfter).toBeGreaterThanOrEqual(lines)
                expect(step.activeLinesAfter).toBeLessThanOrEqual(FITH_MAX_LINES)
                expect(step.unlockedRows).toHaveLength(step.activeLinesAfter - step.activeLinesBefore)
                total += step.stepPay
                expect(step.totalPay).toBeCloseTo(total, 6)
                lines = step.activeLinesAfter
            }
            expect(outcome.activeLines).toBe(lines)
            expect(outcome.basePayout).toBeCloseTo(total, 6)
            const scatters = findScatters(outcome.restGrid, outcome.activeLines)
            expect(outcome.scatterCells).toEqual(scatters)
            expect(outcome.feature).toBe(scatters.length >= FITH_SCATTERS_FOR_BONUS)
            expect(outcome.feature).toBe(outcome.bonus !== null)
            if (outcome.bonus) {
                features++
                expect(outcome.bonus.activeLines).toBe(outcome.activeLines)
            }
            expect(outcome.win).toBeCloseTo(Math.min(FITH_MAX_WIN, outcome.basePayout + (outcome.bonus?.totalMultiplier ?? 0)), 6)
        }
        expect(features).toBeGreaterThan(0)
    })

    it('a buy goes straight to the free spins on the starting rows', () => {
        const rng = seededRng(7)
        for (let i = 0; i < 200; i++) {
            const outcome = playFireInTheHole(rng, { buy: true })
            expect(outcome).toMatchObject({ bought: true, feature: true, basePayout: 0, steps: [], activeLines: FITH_STARTING_LINES })
            expect(outcome.scatterCells.length).toBeGreaterThanOrEqual(FITH_SCATTERS_FOR_BONUS)
            expect(outcome.bonus!.steps).toHaveLength(outcome.bonus!.freeSpins)
            expect(outcome.win).toBeCloseTo(outcome.bonus!.totalMultiplier, 6)
        }
    })

    it('caps the round at the max win', () => {
        expect(capWin(FITH_MAX_WIN * 3)).toEqual({ win: FITH_MAX_WIN, capped: true })
        expect(capWin(FITH_MAX_WIN)).toEqual({ win: FITH_MAX_WIN, capped: true })
        expect(capWin(12.5)).toEqual({ win: 12.5, capped: false })
    })
})

describe('fire in the hole bonus', () => {
    it('moves values by the rules: pickaxes add, x2 doubles, the collector sweeps the coins', () => {
        const rng = seededRng(3)
        const seen = new Set<string>()
        for (let run = 0; run < 200; run++) {
            const lines = 3 + (run % 4)
            const bonus = playBonus(rng, lines)
            const occupied = new Set<string>()
            for (const step of bonus.steps) {
                for (const drop of step.drops) {
                    seen.add(drop.symbol)
                    expect(drop.row).toBeLessThan(lines)
                    // Drops only land on empty tiles.
                    expect(occupied.has(`${drop.col}:${drop.row}`)).toBe(false)
                }
                expect(step.drops.filter(d => d.symbol === 'collector').length).toBeLessThanOrEqual(1)
                for (const event of step.valueEvents) {
                    if (event.type === 'add') expect(event.after).toBeCloseTo(event.before + event.amount, 6)
                    if (event.type === 'double') expect(event.after).toBeCloseTo(event.before * 2, 6)
                    if (event.type === 'collect') {
                        expect(event.target.symbol).toBe('coin')
                        expect(event.after).toBeCloseTo(event.before + event.amount, 6)
                    }
                    expect(event.target.symbol).not.toBe('boost')
                }
                // No x2 stays on the board; collected coins leave it.
                expect(step.coins.some(c => c.symbol === 'double')).toBe(false)
                if (step.collected > 0) expect(step.coins.some(c => c.symbol === 'coin')).toBe(false)
                const total = step.coins.reduce((sum, c) => (c.symbol === 'boost' ? sum : sum + c.multiplier), 0)
                expect(step.totalMultiplier).toBeCloseTo(total, 6)
                occupied.clear()
                for (const c of step.coins) occupied.add(`${c.col}:${c.row}`)
            }
            expect(bonus.totalMultiplier).toBe(bonus.steps.at(-1)!.totalMultiplier)
        }
        expect([...seen].sort()).toEqual(['boost', 'coin', 'collector', 'double'])
    })
})

describe('fire in the hole on the server', () => {
    const game = serverGame('fireinthehole')!

    it('stakes the bet, or bet × the buy cost, and pays rounded down to 0.0001 coin', () => {
        const spin = game.play({ bet: 12.5, options: {}, rng: seededRng(1) })
        expect(spin.stake).toBe(12.5)
        const buy = game.play({ bet: 12.5, options: { buy: true }, rng: seededRng(1) })
        expect(buy.stake).toBe(12.5 * FITH_BUY_COST)
        expect(Number.isInteger(FITH_BUY_COST)).toBe(true)
        for (const outcome of [spin, buy]) {
            const result = outcome.result as { win: number }
            expect(outcome.payout).toBe(payFor(12.5, result.win))
            expect(isCoinAmount(outcome.payout)).toBe(true)
            expect(outcome.payout).toBeLessThanOrEqual(12.5 * FITH_MAX_WIN)
        }
    })

    it('refuses a buy flag that is not a boolean', () => {
        expect(() => game.play({ bet: 100, options: { buy: 'yes' }, rng: seededRng(1) })).toThrow(RangeError)
        expect(() => game.play({ bet: 100, options: { buy: 1 }, rng: seededRng(1) })).toThrow(RangeError)
    })
})
