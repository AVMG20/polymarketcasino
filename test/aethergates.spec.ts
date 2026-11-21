import { describe, expect, it } from 'vitest'
import { seededRng } from '../shared/rng'
import {
    aetherPayMult,
    aetherPayout,
    aetherStake,
    AG_BONUS_CHANCE_COST,
    AG_BUY_FREESPINS_COST,
    AG_BUY_SUPERBONUS_COST,
    AG_COLS,
    AG_FREE_SPINS,
    AG_FREE_SPINS_SUPER,
    AG_MAX_WIN_MULT,
    AG_MIN_MATCH,
    AG_RETRIGGER_SPINS,
    AG_ROWS,
    AG_SCATTER_TRIGGER,
    AG_SCATTER_TRIGGER_SUPER,
    findScatters,
    findWins,
    parseAetherOptions,
    playAethergates,
    type AetherGatesResult,
    type AetherSequence,
    type AetherSymbol
} from '../shared/slots/aethergates'
import { serverGame } from '../server/utils/games'

/** A grid of `fill` with `cells` overridden, as [col][row]. */
function grid(fill: AetherSymbol, cells: [number, number, AetherSymbol][] = []): AetherSymbol[][] {
    const g = Array.from({ length: AG_COLS }, () => Array.from({ length: AG_ROWS }, () => fill))
    for (const [col, row, sym] of cells) g[col]![row] = sym
    return g
}

function sequenceRules(seq: AetherSequence) {
    let meter = seq.meterBefore
    let pays = 0
    seq.steps.forEach((step, i) => {
        expect(step.wins.length).toBeGreaterThan(0)
        for (const win of step.wins) {
            expect(win.count).toBeGreaterThanOrEqual(AG_MIN_MATCH)
            expect(win.cells.every(c => step.grid[c.col]![c.row] === win.symbol)).toBe(true)
            expect(win.payMult).toBe(aetherPayMult(win.symbol, win.count))
        }
        // Every relic on the board joins the meter on a paying step.
        const relics = step.grid.flat().filter(s => s === 'multiplier').length
        expect(step.multipliers).toHaveLength(relics)
        expect(step.meterBefore).toBe(meter)
        meter += step.multipliers.reduce((sum, m) => sum + m.value, 0)
        expect(step.meterAfter).toBe(meter)
        pays += step.stepPayMult
        // Tumbles never bring in new scatters.
        const next = seq.steps[i + 1]?.grid ?? seq.restGrid
        expect(findScatters(next).length).toBeLessThanOrEqual(findScatters(step.grid).length)
    })
    expect(findWins(seq.restGrid)).toEqual([])
    expect(seq.meterAfter).toBe(meter)
    expect(seq.basePayMult).toBeCloseTo(pays, 9)
    expect(seq.winMult).toBeCloseTo(pays > 0 ? pays * Math.max(1, meter) : 0, 9)
}

function bonusRules(result: AetherGatesResult) {
    const bonus = result.bonus!
    const initial = result.bonusTier === 'super' ? AG_FREE_SPINS_SUPER : AG_FREE_SPINS
    expect(bonus.retriggers).toBeLessThanOrEqual(1)
    expect(bonus.totalSpins).toBe(initial + bonus.retriggers * AG_RETRIGGER_SPINS)
    expect(bonus.spins).toHaveLength(bonus.totalSpins)
    // The meter never resets: it carries from the trigger through every spin.
    let meter = result.base.meterAfter
    let retriggered = false
    for (const spin of bonus.spins) {
        expect(spin.sequence.meterBefore).toBe(meter)
        sequenceRules(spin.sequence)
        meter = spin.sequence.meterAfter
        const first = spin.sequence.steps[0]?.grid ?? spin.sequence.restGrid
        if (retriggered) expect(findScatters(first)).toEqual([])
        if (spin.retriggered) retriggered = true
    }
    expect(bonus.finalMeter).toBe(meter)
}

describe('aethergates pays', () => {
    it('pays 8+ of a symbol anywhere, by count bracket', () => {
        const g = grid('ring', [[0, 0, 'star'], [5, 4, 'star'], [2, 2, 'star'], [3, 1, 'star'], [1, 3, 'star'], [4, 0, 'star'], [0, 4, 'star']])
        expect(findWins(g).map(w => w.symbol)).toEqual(['ring'])
        g[3]![3] = 'star'
        const wins = findWins(g)
        expect(wins.map(w => [w.symbol, w.count])).toEqual([['ring', 22], ['star', 8]])
        expect(wins[1]!.payMult).toBe(aetherPayMult('star', 8))
        expect(aetherPayMult('star', 7)).toBe(0)
        expect(aetherPayMult('star', 9)).toBe(aetherPayMult('star', 8))
        expect(aetherPayMult('star', 10)).toBeGreaterThan(aetherPayMult('star', 9))
        expect(aetherPayMult('star', 30)).toBeGreaterThan(aetherPayMult('coin', 30))
    })

    it('never counts relics or scatters toward a win', () => {
        const g = grid('multiplier', [[0, 0, 'coin'], [0, 1, 'coin'], [0, 2, 'coin'], [0, 3, 'coin'], [0, 4, 'coin'], [1, 0, 'coin'], [1, 1, 'coin'], [1, 2, 'scatter']])
        expect(findWins(g)).toEqual([])
        expect(findScatters(g)).toEqual([{ col: 1, row: 2 }])
    })

    it('tumbles, sweeps every relic into the meter and multiplies the sequence', () => {
        const rng = seededRng(42)
        let tumbled = 0
        for (let i = 0; i < 3000; i++) {
            const result = playAethergates(rng)
            sequenceRules(result.base)
            if (result.base.steps.length > 1) tumbled++
            expect(result.base.meterBefore).toBe(0)
            expect(result.grid).toEqual(result.base.steps[0]?.grid ?? result.base.restGrid)
            if (!result.bonus) expect(result.totalWinMult).toBeCloseTo(result.base.winMult, 9)
        }
        expect(tumbled).toBeGreaterThan(0)
    })
})

describe('aethergates features', () => {
    it('triggers free spins on 3 scatters and the super bonus on 4+', () => {
        const rng = seededRng(7)
        let triggers = 0
        for (let i = 0; i < 4000; i++) {
            const result = playAethergates(rng, 'bonusChance')
            const scatters = findScatters(result.grid).length
            expect(result.scatterCount).toBe(scatters)
            expect(result.bonusTriggered).toBe(scatters >= AG_SCATTER_TRIGGER)
            if (scatters >= AG_SCATTER_TRIGGER_SUPER) expect(result.bonusTier).toBe('super')
            else if (scatters >= AG_SCATTER_TRIGGER) expect(result.bonusTier).toBe('normal')
            if (result.bonus) {
                triggers++
                bonusRules(result)
            }
        }
        expect(triggers).toBeGreaterThan(0)
    })

    it('buys always land in the bonus with the trigger on screen and no paid base spin', () => {
        const rng = seededRng(3)
        for (const [feature, tier, scatters] of [['buyFreeSpins', 'normal', AG_SCATTER_TRIGGER], ['superBonus', 'super', AG_SCATTER_TRIGGER_SUPER]] as const) {
            for (let i = 0; i < 150; i++) {
                const result = playAethergates(rng, feature)
                expect(result.bonusTier).toBe(tier)
                expect(result.scatterCount).toBe(scatters)
                expect(result.base.steps).toEqual([])
                expect(result.baseWinMult).toBe(0)
                bonusRules(result)
                expect(result.totalWinMult).toBeLessThanOrEqual(AG_MAX_WIN_MULT)
                expect(result.totalWinMult).toBeCloseTo(Math.min(AG_MAX_WIN_MULT, result.bonus!.bonusWinMult), 9)
            }
        }
    })
})

describe('aethergates stakes and payouts', () => {
    it('validates the feature option', () => {
        expect(parseAetherOptions({})).toBeNull()
        expect(parseAetherOptions({ feature: 'superBonus' })).toBe('superBonus')
        expect(() => parseAetherOptions({ feature: 'free' })).toThrow(RangeError)
        expect(() => parseAetherOptions({ feature: 1 })).toThrow(RangeError)
    })

    it('rounds feature stakes up to whole coins', () => {
        expect(aetherStake(100, null)).toBe(100)
        expect(aetherStake(101, 'buyFreeSpins')).toBe(Math.ceil(101 * AG_BUY_FREESPINS_COST))
        expect(aetherStake(101, 'superBonus')).toBe(Math.ceil(101 * AG_BUY_SUPERBONUS_COST))
        expect(aetherStake(101, 'bonusChance')).toBe(Math.ceil(101 * AG_BONUS_CHANCE_COST))
        for (const feature of [null, 'buyFreeSpins', 'superBonus', 'bonusChance'] as const) {
            for (const bet of [100, 333, 1_000_000]) expect(Number.isSafeInteger(aetherStake(bet, feature))).toBe(true)
        }
    })

    it('pays whole coins, rounded down, and never past the cap', () => {
        const result = { totalWinMult: 0.0786 } as AetherGatesResult
        expect(aetherPayout(result, 100)).toBe(7)
        expect(aetherPayout({ totalWinMult: AG_MAX_WIN_MULT } as AetherGatesResult, 1_000_000)).toBe(AG_MAX_WIN_MULT * 1_000_000)
    })

    it('plays through the server game with the stake of the chosen feature', () => {
        const game = serverGame('aethergates')!
        const rng = seededRng(11)
        const plain = game.play({ bet: 250, options: {}, rng })
        expect(plain.stake).toBe(250)
        const buy = game.play({ bet: 250, options: { feature: 'superBonus' }, rng })
        expect(buy.stake).toBe(Math.ceil(250 * AG_BUY_SUPERBONUS_COST))
        const result = buy.result as AetherGatesResult
        expect(result.bonusTier).toBe('super')
        expect(buy.payout).toBe(aetherPayout(result, 250))
        expect(buy.payout).toBeLessThanOrEqual(250 * AG_MAX_WIN_MULT)
        expect(() => game.play({ bet: 250, options: { feature: 'everything' }, rng })).toThrow(RangeError)
    })
})
