import { describe, expect, it } from 'vitest'
import { seededRng } from '../shared/rng'
import {
    clusterPay,
    emberPortalsPayout,
    emberPortalsStake,
    EP_ANTE_COST,
    EP_BUY_COST,
    EP_COLS,
    EP_MAX_WIN_MULT,
    EP_ROWS,
    EP_WILD_MAX_MULT,
    findClusters,
    FS_MAX_SPINS,
    FS_RETRIGGER_SPINS,
    FS_TRIGGER,
    fsAward,
    mergedMult,
    parseEmberPortalsMode,
    playEmberPortals,
    runFreeSpins,
    runTumbles,
    BASE_WEIGHTS,
    type EpSymbol,
    type EpWild
} from '../shared/slots/emberportals'
import { serverGame } from '../server/utils/games'

/** A board with no cluster anywhere: ember and rune in a checkerboard. */
function board(): EpSymbol[][] {
    return Array.from({ length: EP_COLS }, (_, col) => Array.from({ length: EP_ROWS }, (_, row) => ((col + row) % 2 ? 'ember' : 'rune') as EpSymbol))
}

function wildMap(wilds: EpWild[]) {
    return new Map(wilds.map(w => [w.col * EP_ROWS + w.row, w]))
}

/** The symbol table runTumbles refills from; any table works for first-step checks. */
const table = (() => {
    const items = Object.keys(BASE_WEIGHTS) as EpSymbol[]
    let total = 0
    const cum = items.map((k) => {
        total += BASE_WEIGHTS[k as keyof typeof BASE_WEIGHTS]
        return total
    })
    return { items, cum, total }
})()

describe('ember portals pays', () => {
    it('pays clusters of 5+ by size bracket, nothing below', () => {
        expect(clusterPay('phoenix', 4)).toBe(0)
        expect(clusterPay('phoenix', 5)).toBeGreaterThan(0)
        expect(clusterPay('phoenix', 6)).toBeGreaterThan(clusterPay('phoenix', 5))
        // 13 and 14 share a bracket, 15+ is the top one.
        expect(clusterPay('phoenix', 14)).toBe(clusterPay('phoenix', 13))
        expect(clusterPay('phoenix', 40)).toBe(clusterPay('phoenix', 15))
        expect(clusterPay('phoenix', 5)).toBeGreaterThan(clusterPay('ember', 5))
    })

    it('finds orthogonal clusters only', () => {
        const grid = board()
        expect(findClusters(grid, new Map())).toEqual([])
        for (let row = 0; row < 5; row++) grid[0]![row] = 'phoenix'
        const [cluster, ...rest] = findClusters(grid, new Map())
        expect(rest).toEqual([])
        expect(cluster).toMatchObject({ symbol: 'phoenix', size: 5, mult: 1, wilds: [] })
        expect(cluster!.amount).toBe(clusterPay('phoenix', 5))

        // A diagonal touch does not join.
        const diagonal = board()
        for (let i = 0; i < 5; i++) diagonal[i]![i] = 'phoenix'
        expect(findClusters(diagonal, new Map())).toEqual([])
    })

    it('lets a portal join clusters and multiply them by its value', () => {
        const grid = board()
        for (let row = 0; row < 4; row++) grid[0]![row] = 'phoenix'
        grid[0]![4] = 'wild'
        // The same portal also completes a grimoire cluster on the other side.
        for (let row = 0; row < 4; row++) grid[1]![row + 1] = 'grimoire'
        grid[1]![4] = 'grimoire'
        grid[1]![0] = 'potion'
        const wilds = [{ id: 7, col: 0, row: 4, mult: 3 }]
        const clusters = findClusters(grid, wildMap(wilds))
        const phoenix = clusters.find(c => c.symbol === 'phoenix')!
        const grimoire = clusters.find(c => c.symbol === 'grimoire')!
        expect(phoenix).toMatchObject({ size: 5, wilds: [7], mult: 3 })
        expect(phoenix.amount).toBeCloseTo(clusterPay('phoenix', 5) * 3, 4)
        expect(grimoire.wilds).toEqual([7])
    })
})

describe('ember portals portals', () => {
    it('merges by product, never below sum + 1, capped', () => {
        expect(mergedMult([2])).toBe(3)
        expect(mergedMult([5, 3])).toBe(15)
        expect(mergedMult([1, 1])).toBe(3)
        expect(mergedMult([1, 4])).toBe(6)
        expect(mergedMult([100, 100])).toBe(EP_WILD_MAX_MULT)
    })

    it('opens a ×1 portal on a cell of a win without one', () => {
        const grid = board()
        for (let row = 0; row < 5; row++) grid[3]![row] = 'amulet'
        const spin = runTumbles(grid, [], table, EP_MAX_WIN_MULT, { next: 1 }, seededRng(3))
        const [first] = spin.tumbles
        expect(first!.wildChanges).toEqual([expect.objectContaining({ kind: 'spawn', id: 1, mult: 1, from: null })])
        const portal = first!.wilds[0]!
        expect(portal.col).toBe(3)
        expect(portal.row).toBeLessThan(5)
        // The portal holds its cell on the next screen; the burnt cells refilled.
        const next = spin.tumbles[1]?.grid ?? spin.finalGrid
        expect(next[portal.col]![portal.row]).toBe('wild')
    })

    it('grows a portal in a win by one and moves it into that win', () => {
        const grid = board()
        for (let row = 0; row < 4; row++) grid[2]![row] = 'chalice'
        grid[2]![4] = 'wild'
        const start = [{ id: 4, col: 2, row: 4, mult: 6 }]
        const spin = runTumbles(grid, start, table, EP_MAX_WIN_MULT, { next: 5 }, seededRng(9))
        const change = spin.tumbles[0]!.wildChanges[0]!
        expect(change).toMatchObject({ id: 4, kind: 'grow', prevMult: 6, mult: 7, merged: [] })
        expect(change.to.col).toBe(2)
        expect(change.to.row).toBeLessThanOrEqual(4)
        expect(spin.tumbles[0]!.win).toBeCloseTo(clusterPay('chalice', 5) * 6, 4)
    })

    it('merges portals that share a win into the biggest one', () => {
        const grid = board()
        grid[0]![0] = 'wild'
        for (let row = 1; row < 4; row++) grid[0]![row] = 'phoenix'
        grid[0]![4] = 'wild'
        const start = [{ id: 1, col: 0, row: 0, mult: 3 }, { id: 2, col: 0, row: 4, mult: 5 }]
        const spin = runTumbles(grid, start, table, EP_MAX_WIN_MULT, { next: 3 }, seededRng(5))
        const first = spin.tumbles[0]!
        expect(first.clusters[0]!.mult).toBe(8)
        expect(first.wildChanges).toEqual([expect.objectContaining({ id: 2, kind: 'grow', merged: [1], prevMult: 5, mult: 15 })])
        expect(first.wilds).toHaveLength(1)
    })

    it('keeps portals that are not in a win where they are', () => {
        const grid = board()
        for (let row = 0; row < 5; row++) grid[0]![row] = 'potion'
        grid[6]![6] = 'wild'
        const start = [{ id: 1, col: 6, row: 6, mult: 4 }]
        const spin = runTumbles(grid, start, table, EP_MAX_WIN_MULT, { next: 2 }, seededRng(1))
        const first = spin.tumbles[0]!
        expect(first.wilds).toContainEqual({ id: 1, col: 6, row: 6, mult: 4 })
        expect(first.falls.every(f => !(f.col === 6 && (f.from === 6 || f.to === 6)))).toBe(true)
    })

    it('stops paying at the room left under the max win', () => {
        const grid = board()
        for (let row = 0; row < 5; row++) grid[0]![row] = 'phoenix'
        const spin = runTumbles(grid, [], table, 0.1, { next: 1 }, seededRng(2))
        expect(spin.win).toBe(0.1)
        expect(spin.tumbles).toHaveLength(1)
        expect(spin.tumbles[0]!.clusters.reduce((a, c) => a + c.amount, 0)).toBeCloseTo(0.1, 4)
    })
})

describe('ember portals free spins', () => {
    it('awards 10 to 18 spins for 3 to 7+ scatters', () => {
        expect(fsAward(FS_TRIGGER - 1)).toBe(0)
        expect([3, 4, 5, 6, 7, 9].map(fsAward)).toEqual([10, 12, 14, 16, 18, 18])
    })

    it('carries portals from spin to spin and retriggers on 3+ scatters', () => {
        const rng = seededRng(77)
        let retriggers = 0
        for (let i = 0; i < 300; i++) {
            const fs = runFreeSpins(10, 'buy', EP_MAX_WIN_MULT, rng)
            let wilds: EpWild[] = []
            let total = 10
            for (const spin of fs.spins) {
                expect(spin.wildsStart).toEqual(wilds)
                for (const w of spin.wildsStart) expect(spin.grid[w.col]![w.row]).toBe('wild')
                wilds = spin.wildsEnd
                if (spin.scatters.length >= FS_TRIGGER && total < FS_MAX_SPINS && !fs.capped) {
                    expect(spin.retrigger).toBe(Math.min(FS_RETRIGGER_SPINS, FS_MAX_SPINS - total))
                    retriggers++
                } else {
                    expect(spin.retrigger).toBe(0)
                }
                total += spin.retrigger
                expect(spin.totalSpins).toBe(total)
            }
            if (!fs.capped) expect(fs.spins).toHaveLength(total)
            expect(fs.total).toBeCloseTo(fs.spins.reduce((a, s) => a + s.win, 0), 3)
        }
        expect(retriggers).toBeGreaterThan(0)
    })

    it('ends the feature at the cap', () => {
        const fs = runFreeSpins(10, 'buy', 0.5, seededRng(4))
        expect(fs.capped).toBe(true)
        expect(fs.total).toBe(0.5)
        expect(fs.spins.at(-1)!.runningTotal).toBe(0.5)
    })

    it('always enters the feature on a buy, with three scatters on the screen', () => {
        const rng = seededRng(12)
        for (let i = 0; i < 40; i++) {
            const result = playEmberPortals(rng, 'buy')
            expect(result.bonusTriggered).toBe(true)
            expect(result.freeSpins).toMatchObject({ source: 'buy', awarded: 10 })
            expect(result.base.grid.flat().filter(s => s === 'scatter')).toHaveLength(FS_TRIGGER)
        }
    })

    it('triggers on the settled screen and starts the feature with the base portals', () => {
        const rng = seededRng(31)
        let seen = 0
        for (let i = 0; i < 4000 && seen < 5; i++) {
            const result = playEmberPortals(rng, 'normal')
            expect(result.win).toBeLessThanOrEqual(EP_MAX_WIN_MULT)
            expect(result.bonusTriggered).toBe(result.base.scatters.length >= FS_TRIGGER)
            if (!result.freeSpins) continue
            seen++
            expect(result.freeSpins.awarded).toBe(fsAward(result.base.scatters.length))
            expect(result.freeSpins.spins[0]!.wildsStart).toEqual(result.base.wildsEnd)
            expect(result.win).toBeCloseTo(Math.min(EP_MAX_WIN_MULT, result.base.win + result.freeSpins.total), 3)
        }
        expect(seen).toBeGreaterThan(0)
    })
})

describe('ember portals stakes', () => {
    const game = serverGame('emberportals')!

    it('stakes the bet, the ante or the buy price in whole coins', () => {
        expect(emberPortalsStake('normal', 100)).toBe(100)
        expect(emberPortalsStake('ante', 100)).toBe(100 * EP_ANTE_COST)
        expect(emberPortalsStake('ante', 101)).toBe(Math.ceil(101 * EP_ANTE_COST))
        expect(emberPortalsStake('buy', 100)).toBe(100 * EP_BUY_COST)
        const rng = seededRng(8)
        for (const [options, stake] of [[{}, 333], [{ ante: true }, Math.ceil(333 * EP_ANTE_COST)], [{ buy: true }, 333 * EP_BUY_COST]] as const) {
            const outcome = game.play({ bet: 333, options, rng })
            expect(outcome.stake).toBe(stake)
            expect(Number.isSafeInteger(outcome.stake)).toBe(true)
            expect(outcome.payout).toBe(emberPortalsPayout(outcome.result as ReturnType<typeof playEmberPortals>, 333))
            expect(Number.isSafeInteger(outcome.payout)).toBe(true)
        }
    })

    it('rejects bad options', () => {
        const rng = seededRng(1)
        expect(() => game.play({ bet: 100, options: { ante: true, buy: true }, rng })).toThrow(RangeError)
        expect(() => game.play({ bet: 100, options: { ante: 'yes' }, rng })).toThrow(RangeError)
        expect(() => game.play({ bet: 100, options: { buy: 1 }, rng })).toThrow(RangeError)
        expect(parseEmberPortalsMode({ ante: false, buy: false })).toBe('normal')
    })

    it('pays whole coins, rounded down', () => {
        const result = { ...playEmberPortals(seededRng(1), 'normal'), win: 1.2345 }
        expect(emberPortalsPayout(result, 100)).toBe(123)
        expect(emberPortalsPayout({ ...result, win: 0.29 }, 100)).toBe(29)
    })
})
