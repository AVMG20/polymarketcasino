import { describe, expect, it } from 'vitest'
import { isCoinAmount, normalizeCoins, roundCoins } from '../shared/money'
import { seededRng, type Rng } from '../shared/rng'
import {
    DIVE_BINS,
    DIVE_DOGS,
    DIVE_KEY_SPINS,
    DIVE_TRIGGER,
    evaluateWays,
    FS_AWARD,
    FS_MAX_SPINS,
    FS_RETRIGGER_SPINS,
    FS_TRIGGER,
    FS_WILD_MULTS,
    parseTrashPandaOptions,
    PAYTABLE,
    playTrashPanda,
    TPH_BUY_FREE_SPINS_COST,
    TPH_COLS,
    TPH_MAX_WIN_MULT,
    TPH_ROWS,
    trashPandaStake,
    type TphSymbol,
    type TrashPandaResult
} from '../shared/slots/trashpanda'
import { playRound } from '../server/utils/rounds'
import { chipsOf, coinsOf, ledgerSum, seedPlayer } from './setup/players'

/** A grid from four rows of five symbols (top row first). */
function gridOf(rows: TphSymbol[][]): TphSymbol[][] {
    return Array.from({ length: TPH_COLS }, (_, col) => Array.from({ length: TPH_ROWS }, (_, row) => rows[row]![col]!))
}

// Fillers that never connect: each one sits on a single reel.
const FILL: TphSymbol[] = ['fish', 'banana', 'can', 'apple', 'donut']

const count = (grid: TphSymbol[][], symbol: TphSymbol) => grid.flat().filter(s => s === symbol).length

describe('trashpanda ways', () => {
    it('multiplies the matches per reel into ways, wilds standing in', () => {
        const grid = gridOf([
            ['pizza', 'pizza', 'pizza', 'apple', 'donut'],
            ['pizza', 'banana', 'pizza', 'apple', 'donut'],
            ['fish', 'banana', 'pizza', 'apple', 'donut'],
            ['fish', 'wild', 'can', 'apple', 'donut']
        ])
        const pizza = evaluateWays(grid, 100).find(w => w.symbol === 'pizza')!
        // 2 on reel 1, 1 + a wild on reel 2, 3 on reel 3: 2 × 2 × 3 ways.
        expect(pizza).toMatchObject({ length: 3, ways: 12, weight: 12, amount: expect.closeTo(PAYTABLE.pizza[0] * 12 * 100, 6) })
        expect(pizza.cells).toHaveLength(2 + 2 + 3)
    })

    it('needs the symbol itself on the first reel and stops at the first reel without it', () => {
        const noFirst = gridOf([
            ['fish', 'boss', 'boss', 'boss', 'boss'],
            ['fish', 'banana', 'can', 'apple', 'donut'],
            ['fish', 'banana', 'can', 'apple', 'donut'],
            ['fish', 'banana', 'can', 'apple', 'donut']
        ])
        expect(evaluateWays(noFirst, 100).find(w => w.symbol === 'boss')).toBeUndefined()
        const gap = gridOf([
            ['boss', 'boss', 'can', 'boss', 'boss'],
            ...Array.from({ length: 3 }, () => FILL)
        ])
        expect(evaluateWays(gap, 100).find(w => w.symbol === 'boss')).toBeUndefined()
    })

    it('pays 3, 4 and 5 reels from the paytable', () => {
        for (const length of [3, 4, 5]) {
            const top = FILL.map((f, col) => (col < length ? 'gem' : f)) as TphSymbol[]
            const grid = gridOf([top, FILL, FILL, FILL])
            const gem = evaluateWays(grid, 200).find(w => w.symbol === 'gem')!
            expect(gem).toMatchObject({ length, ways: 1, amount: expect.closeTo(PAYTABLE.gem[length - 3]! * 200, 6) })
        }
    })

    it('adds the multipliers of the wilds on each way', () => {
        const grid = gridOf([
            ['pizza', 'wild', 'pizza', 'apple', 'donut'],
            ['fish', 'banana', 'wild', 'apple', 'donut'],
            ['fish', 'banana', 'can', 'apple', 'donut'],
            ['fish', 'banana', 'can', 'apple', 'donut']
        ])
        // Ways: pizza-×2-pizza pays ×2, pizza-×2-×3 pays ×5.
        const mults = new Map([['1:0', 2], ['2:1', 3]])
        const pizza = evaluateWays(grid, 100, mults).find(w => w.symbol === 'pizza')!
        expect(pizza).toMatchObject({ ways: 2, weight: 7, amount: expect.closeTo(PAYTABLE.pizza[0] * 7 * 100, 6) })
        // Without multipliers every way pays once.
        expect(evaluateWays(grid, 100).find(w => w.symbol === 'pizza')).toMatchObject({ ways: 2, weight: 2 })
    })
})

describe('trashpanda features', () => {
    it('starts the free spins on 3+ safes and the dive on 3+ dumpsters', () => {
        const rng = seededRng(5)
        let fs = 0
        let dives = 0
        for (let i = 0; i < 20_000; i++) {
            const r = playTrashPanda(rng, 100)
            expect(r.grid.every((col, c) => c > 0 || !col.includes('wild'))).toBe(true)
            expect(r.scatters).toHaveLength(count(r.grid, 'safe'))
            expect(r.bins).toHaveLength(count(r.grid, 'bin'))
            expect(r.dive !== null).toBe(r.bins.length >= DIVE_TRIGGER)
            const scatterFs = r.scatters.length >= FS_TRIGGER
            expect(r.bonusTriggered).toBe(scatterFs || r.bins.length >= DIVE_TRIGGER)
            if (scatterFs) {
                const award = FS_AWARD[Math.min(r.scatters.length, 5) as 3 | 4 | 5]
                expect(r.freeSpins!.awarded).toBe(award + (r.dive?.keyFound ? DIVE_KEY_SPINS : 0))
                expect(r.freeSpins!.source).toBe('scatter')
                fs++
            } else {
                expect(r.freeSpins === null).toBe(!r.dive?.keyFound)
            }
            if (r.dive) dives++
            expect(r.basePayout).toBeCloseTo(r.wins.reduce((sum, w) => sum + w.amount, 0), 3)
        }
        expect(fs).toBeGreaterThan(0)
        expect(dives).toBeGreaterThan(0)
    })

    it('keeps every free-spin wild in place with its multiplier until the feature ends', () => {
        const rng = seededRng(9)
        let retriggers = 0
        for (let i = 0; i < 300; i++) {
            const r = playTrashPanda(rng, 100, { feature: 'buyFreeSpins' })
            const fs = r.freeSpins!
            expect(fs.source).toBe('buy')
            expect(fs.awarded).toBeGreaterThanOrEqual(FS_AWARD[3])
            const held = new Map<string, number>()
            let totalSpins = fs.awarded
            let total = 0
            for (const spin of fs.spins) {
                for (const sym of ['bin', 'fish', 'banana'] as const) expect(count(spin.grid, sym)).toBe(0)
                for (const [key] of held) {
                    const [col, row] = key.split(':').map(Number)
                    expect(spin.grid[col!]![row!]).toBe('wild')
                }
                for (const w of spin.newWilds) {
                    expect(held.has(`${w.col}:${w.row}`)).toBe(false)
                    expect(w.col).toBeGreaterThan(0)
                    expect(FS_WILD_MULTS.map(m => m.mult)).toContain(w.mult)
                    held.set(`${w.col}:${w.row}`, w.mult)
                }
                expect(new Map(spin.sticky.map(w => [`${w.col}:${w.row}`, w.mult]))).toEqual(held)
                if (!fs.capped) expect(spin.win).toBeCloseTo(spin.wins.reduce((sum, w) => sum + w.amount, 0), 3)
                if (spin.retrigger) {
                    retriggers++
                    expect(spin.scatters.length).toBeGreaterThanOrEqual(FS_TRIGGER)
                    expect(spin.retrigger).toBeLessThanOrEqual(FS_RETRIGGER_SPINS)
                }
                totalSpins += spin.retrigger
                expect(spin.totalSpins).toBe(totalSpins)
                total += spin.win
                expect(spin.runningTotal).toBeCloseTo(total, 3)
            }
            expect(totalSpins).toBeLessThanOrEqual(FS_MAX_SPINS)
            if (!fs.capped) expect(fs.spins).toHaveLength(totalSpins)
            expect(r.freeSpinsPayout).toBeCloseTo(total, 3)
        }
        expect(retriggers).toBeGreaterThan(0)
    })

    it('plays the dive in order: cash, doubles and donuts until an uneaten dog', () => {
        const rng = seededRng(3)
        let keys = 0
        let eaten = 0
        for (let i = 0; i < 2_000; i++) {
            const r = playTrashPanda(rng, 100, { feature: 'buyDive' })
            expect(r.bins.length).toBeGreaterThanOrEqual(DIVE_TRIGGER)
            expect(r.scatters).toHaveLength(0)
            const d = r.dive!
            const items = [...d.picks.map(p => p.item), ...d.leftovers]
            expect(items).toHaveLength(DIVE_BINS)
            expect(items.filter(it => it.kind === 'dog')).toHaveLength(DIVE_DOGS)
            for (const kind of ['donut', 'double', 'key'] as const) expect(items.filter(it => it.kind === kind).length).toBeLessThanOrEqual(1)
            let pot = 0
            let shield = false
            for (const [n, pick] of d.picks.entries()) {
                const item = pick.item
                if (item.kind === 'cash') pot += item.value
                else if (item.kind === 'double') pot *= 2
                else if (item.kind === 'donut') shield = true
                else if (item.kind === 'dog') {
                    expect(pick.ateDonut).toBe(shield)
                    if (!shield) expect(n).toBe(d.picks.length - 1)
                    if (shield) eaten++
                    shield = false
                }
                expect(pick.pot).toBe(pot)
                expect(pick.shield).toBe(shield)
            }
            expect(d.pot).toBe(pot)
            expect(d.total).toBeCloseTo(pot * 100, 6)
            expect(d.cleared).toBe(d.leftovers.every(it => it.kind === 'dog'))
            expect(d.keyFound).toBe(d.picks.some(p => p.item.kind === 'key'))
            if (d.keyFound) {
                keys++
                expect(r.freeSpins).toMatchObject({ source: 'key', awarded: DIVE_KEY_SPINS })
            } else {
                expect(r.freeSpins).toBeNull()
            }
        }
        expect(keys).toBeGreaterThan(0)
        expect(eaten).toBeGreaterThan(0)
    })

    it('prices the buys at 110× and 21.75× the bet, exact to 0.0001 coin', () => {
        expect(trashPandaStake(100, {})).toBe(100)
        expect(trashPandaStake(100, { feature: 'buyFreeSpins' })).toBe(100 * TPH_BUY_FREE_SPINS_COST)
        expect(trashPandaStake(100, { feature: 'buyDive' })).toBe(2_175)
        expect(trashPandaStake(101, { feature: 'buyDive' })).toBe(2_196.75)
        // 10.0001 × 21.75 = 217.502175: the fraction past four decimals rounds up.
        expect(trashPandaStake(10.0001, { feature: 'buyDive' })).toBe(217.5022)
        const r = playTrashPanda(seededRng(1), 101, { feature: 'buyDive' })
        expect(r.cost).toBe(2_196.75)
        expect(r.feature).toBe('buyDive')
    })
})

describe('trashpanda payout', () => {
    it('is deterministic for a seed and pays the capped win rounded down to 0.0001 coin', () => {
        expect(playTrashPanda(seededRng(7), 100)).toEqual(playTrashPanda(seededRng(7), 100))
        const rng = seededRng(17)
        for (let i = 0; i < 20_000; i++) {
            const bet = normalizeCoins(10 + (i % 37) * 13.37)
            const feature = i % 50 === 0 ? 'buyFreeSpins' : i % 50 === 25 ? 'buyDive' : undefined
            const r = playTrashPanda(rng, bet, feature ? { feature } : {})
            const total = Math.min(r.basePayout + r.divePayout + r.freeSpinsPayout, TPH_MAX_WIN_MULT * bet)
            expect(isCoinAmount(r.payout)).toBe(true)
            expect(r.payout).toBe(roundCoins(bet * r.win))
            expect(Math.abs(r.payout - total)).toBeLessThan(0.00011)
            expect(r.payout).toBeLessThanOrEqual(total + 1e-9)
            expect(r.won).toBe(r.payout > r.cost)
        }
    })

    it('caps a round at 10,000× the bet', () => {
        // Every draw lands in the boss band on every reel: 4 bosses per reel, 1,024 ways of 10×.
        const boss: Rng = { next: () => 0.94 }
        const r = playTrashPanda(boss, 100)
        expect(r.grid.flat().every(s => s === 'boss')).toBe(true)
        expect(r.capped).toBe(true)
        expect(r.win).toBe(TPH_MAX_WIN_MULT)
        expect(r.payout).toBe(TPH_MAX_WIN_MULT * 100)
    })

    it('validates options and the bet', () => {
        expect(parseTrashPandaOptions({})).toEqual({})
        expect(parseTrashPandaOptions({ feature: 'buyFreeSpins' })).toEqual({ feature: 'buyFreeSpins' })
        expect(parseTrashPandaOptions({ feature: 'buyDive' })).toEqual({ feature: 'buyDive' })
        for (const options of [{ feature: 'buy' }, { feature: true }, { buy: true }, { feature: 'buyDive', ante: true }]) {
            expect(() => parseTrashPandaOptions(options)).toThrow(RangeError)
        }
        for (const bet of [0, -5, Number.NaN, Infinity]) expect(() => playTrashPanda(seededRng(1), bet)).toThrow(RangeError)
    })
})

describe('trashpanda rounds', () => {
    it('settles spins and both buys through playRound', async () => {
        const id = seedPlayer(1_000_000)
        let expected = 1_000_000
        let chips = 0
        for (let i = 0; i < 40; i++) {
            const round = await playRound(id, 'trashpanda', { bet: 100 })
            expect(round.stake).toBe(100)
            expect(round.payout).toBe((round.result as TrashPandaResult).payout)
            expected = normalizeCoins(expected - round.stake)
            chips = normalizeCoins(chips + round.payout + round.rakeback)
            expect(round.balance).toBe(expected)
        }
        const heist = await playRound(id, 'trashpanda', { bet: 200, options: { feature: 'buyFreeSpins' } })
        expect(heist.stake).toBe(200 * TPH_BUY_FREE_SPINS_COST)
        expect((heist.result as TrashPandaResult).freeSpins?.source).toBe('buy')
        expected = normalizeCoins(expected - heist.stake)
            chips = normalizeCoins(chips + heist.payout + heist.rakeback)
        const dive = await playRound(id, 'trashpanda', { bet: 101, options: { feature: 'buyDive' } })
        expect(dive.stake).toBe(2_196.75)
        expect((dive.result as TrashPandaResult).dive).not.toBeNull()
        expected = normalizeCoins(expected - dive.stake)
            chips = normalizeCoins(chips + dive.payout + dive.rakeback)
        expect(dive.balance).toBe(expected)
        expect(coinsOf(id).coins).toBe(expected)
        expect(ledgerSum(id)).toBe(normalizeCoins(expected - 1_000_000))
        // Every payout is chips.
        expect(chipsOf(id)).toBe(chips)
    })

    it('rejects bad bets and options without charging', async () => {
        const id = seedPlayer(100_000)
        await expect(playRound(id, 'trashpanda', { bet: 9.99 })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'trashpanda', { bet: 150.00001 })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'trashpanda', { bet: 2_000_000 })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'trashpanda', { bet: '100' })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'trashpanda', { bet: 100, options: { feature: 'free' } })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'trashpanda', { bet: 100, options: { buy: true } })).rejects.toMatchObject({ statusCode: 400 })
        // A buy the balance can't cover is refused by the debit guard.
        await expect(playRound(id, 'trashpanda', { bet: 1_000, options: { feature: 'buyFreeSpins' } })).rejects.toMatchObject({ statusCode: 400 })
        expect(coinsOf(id).coins).toBe(100_000)
        expect(ledgerSum(id)).toBe(0)
    })
})
