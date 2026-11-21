import { describe, expect, it } from 'vitest'
import {
    candyMadnessStake,
    CM_BUY_FREESPINS_COST,
    CM_COLS,
    CM_FREE_SPINS,
    CM_MAX_WIN_MULT,
    CM_MIN_CLUSTER,
    CM_ROWS,
    findClusters,
    parseCandyMadnessOptions,
    playCandyMadness,
    type CandyMadnessResult,
    type TumbleSequence
} from '../shared/games/candymadness'
import { MH_COLS, MH_MAX_PASSES, MH_TILE_CAP, MH_TILES, parseMagicHandsOptions, playMagicHands } from '../shared/games/magichands'
import { parsePolyMastersOptions, playPolyMasters, PM_MAX_WIN, PM_SAFE_LANDING_COST } from '../shared/games/polymasters'
import { parseWheelOptions, playWheel, WHEEL_RISKS, WHEEL_TABLES, wheelLayout } from '../shared/games/wheel'
import { seededRng, type Rng } from '../shared/rng'
import { playRound } from '../server/utils/rounds'
import { coinsOf, ledgerSum, seedPlayer } from './setup/players'

const fixed = (value: number): Rng => ({ next: () => value })

describe('wheel', () => {
    it('lays out ten segments that match the table and add up to 9.6', () => {
        for (const risk of WHEEL_RISKS) {
            const layout = wheelLayout(risk)
            expect(layout).toHaveLength(10)
            for (const seg of WHEEL_TABLES[risk]) expect(layout.filter(s => s.multiplier === seg.multiplier)).toHaveLength(seg.count)
            expect(layout.reduce((sum, s) => sum + s.multiplier, 0)).toBeCloseTo(9.6, 9)
        }
    })

    it('pays the segment it draws and validates the risk', () => {
        const result = playWheel(fixed(0.95), { risk: 'hard' })
        expect(result.index).toBe(9)
        expect(result.multiplier).toBe(wheelLayout('hard')[9]!.multiplier)
        expect(result.won).toBe(result.multiplier > 0)
        expect(parseWheelOptions({})).toEqual({ risk: 'medium' })
        expect(() => parseWheelOptions({ risk: 'insane' })).toThrow(RangeError)
        expect(() => parseWheelOptions({ risk: 3 })).toThrow(RangeError)
    })
})

describe('magic hands', () => {
    it('validates placements', () => {
        for (const placements of [undefined, [], 'all', [0, 0], [40], [-1], [1.5], ['3'], Array.from({ length: 41 }, (_, i) => i % 40)]) {
            expect(() => parseMagicHandsOptions({ placements })).toThrow(RangeError)
        }
        expect(parseMagicHandsOptions({ placements: [0, 39, 7] }).placements).toEqual([0, 39, 7])
    })

    it('pays the multiplier of every hand on a winning tile', () => {
        const rng = seededRng(11)
        const all = Array.from({ length: MH_TILES }, (_, i) => i)
        for (let i = 0; i < 2_000; i++) {
            const placements = all.filter(tile => (tile + i) % 3 === 0)
            const result = playMagicHands(rng, { placements })
            const winning = new Set(result.winners)
            expect(result.winners.length).toBeGreaterThanOrEqual(2)
            expect(result.winners.length).toBeLessThanOrEqual(8)
            expect(result.wins.map(w => w.tile)).toEqual(placements.filter(t => winning.has(t)))
            for (const win of result.wins) expect(win.multiplier).toBe(result.multipliers[win.tile] ?? 1)
            expect(result.win).toBe(result.wins.reduce((sum, w) => sum + w.multiplier, 0))
            for (const value of Object.values(result.multipliers)) expect(value).toBeLessThanOrEqual(MH_TILE_CAP)
        }
    })

    it('stamps multipliers in their own column and rerolls at most MH_MAX_PASSES times', () => {
        const rng = seededRng(3)
        let rerolled = false
        for (let i = 0; i < 2_000; i++) {
            const result = playMagicHands(rng, { placements: [0] })
            expect(result.passes.length).toBeLessThanOrEqual(MH_MAX_PASSES)
            expect(result.passes.at(-1)!.reroll).toBe(false)
            result.passes.slice(0, -1).forEach(pass => expect(pass.reroll).toBe(true))
            for (const pass of result.passes) {
                for (const slot of pass.slots) {
                    for (const tile of slot.tiles) expect(tile % MH_COLS).toBe(slot.col)
                    expect(slot.tiles.length > 0).toBe(slot.type === 'multiplier')
                    if (slot.type === 'reroll') rerolled = true
                }
            }
        }
        expect(rerolled).toBe(true)
    })
})

describe('poly masters', () => {
    it('validates the mode', () => {
        expect(parsePolyMastersOptions({})).toEqual({ mode: 'normal' })
        expect(parsePolyMastersOptions({ mode: 'safe' })).toEqual({ mode: 'safe' })
        expect(() => parsePolyMastersOptions({ mode: 'turbo' })).toThrow(RangeError)
    })

    it('pays the counter on a landing, nothing in the sea, and caps at the max win', () => {
        const rng = seededRng(21)
        const landings = new Set<string>()
        for (let i = 0; i < 20_000; i++) {
            const result = playPolyMasters(rng, 'normal')
            landings.add(result.landing)
            expect(result.cost).toBe(1)
            if (result.landing === 'water' || result.landing === 'crash') expect(result.win).toBe(0)
            else expect(result.win).toBe(result.counter)
            expect(result.win).toBeLessThanOrEqual(PM_MAX_WIN)
            if (result.landing === 'crash') expect(result.events.at(-1)).toMatchObject({ kind: 'rocket', fall: 'crash' })
        }
        expect([...landings].sort()).toEqual(expect.arrayContaining(['crash', 'island', 'water']))
    })

    it('always lands with Safe Landing', () => {
        const rng = seededRng(5)
        for (let i = 0; i < 5_000; i++) {
            const result = playPolyMasters(rng, 'safe')
            expect(result.cost).toBe(PM_SAFE_LANDING_COST)
            expect(['island', 'max']).toContain(result.landing)
            expect(result.win).toBeGreaterThan(0)
        }
    })
})

describe('candy madness', () => {
    const sequences = (result: CandyMadnessResult): TumbleSequence[] => [result.base, ...(result.bonus?.spins.map(s => s.sequence) ?? [])]

    it('validates the feature and prices it in whole coins', () => {
        expect(parseCandyMadnessOptions({})).toEqual({ feature: null })
        expect(() => parseCandyMadnessOptions({ feature: 'free' })).toThrow(RangeError)
        expect(candyMadnessStake(100, null)).toBe(100)
        expect(candyMadnessStake(100, 'buyFreeSpins')).toBe(100 * CM_BUY_FREESPINS_COST)
        expect(candyMadnessStake(100, 'bonusHunt')).toBe(360)
        expect(candyMadnessStake(101, 'bonusHunt')).toBe(364)
        expect(Number.isSafeInteger(candyMadnessStake(1_000_000, 'bonusHunt'))).toBe(true)
    })

    it('pays clusters of 4+, tumbles until no win, and multiplies by the spot sum', () => {
        const rng = seededRng(8)
        for (let i = 0; i < 500; i++) {
            const result = playCandyMadness(rng, { feature: i % 10 === 0 ? 'bonusHunt' : null })
            let total = 0
            for (const seq of sequences(result)) {
                for (const step of seq.steps) {
                    expect(step.clusters.length).toBeGreaterThan(0)
                    for (const cluster of step.clusters) expect(cluster.size).toBeGreaterThanOrEqual(CM_MIN_CLUSTER)
                    expect(findClusters(step.grid)).toEqual(step.clusters)
                }
                expect(findClusters(seq.restGrid)).toEqual([])
                const basePay = seq.steps.reduce((sum, s) => sum + s.stepPay, 0)
                expect(seq.win).toBeCloseTo(basePay > 0 ? basePay * Math.max(1, seq.multiplierSum) : 0, 9)
                total += seq.win
            }
            expect(result.win).toBeCloseTo(Math.min(CM_MAX_WIN_MULT, total), 9)
            expect(result.capped).toBe(total > CM_MAX_WIN_MULT)
            // Free spins start on 3+ lollipops on the first drop, never otherwise.
            expect(!!result.bonus).toBe(result.scatterCells.length >= 3)
            if (result.feature === 'bonusHunt') expect(result.scatterCells.length).toBeGreaterThanOrEqual(1)
        }
    })

    it('starts the free spins straight away on a buy', () => {
        const rng = seededRng(9)
        for (let i = 0; i < 30; i++) {
            const result = playCandyMadness(rng, { feature: 'buyFreeSpins' })
            expect(result.base.steps).toEqual([])
            expect(result.base.win).toBe(0)
            expect(result.scatterCells.length).toBe(3)
            expect(result.bonus!.spins).toHaveLength(CM_FREE_SPINS)
            expect(result.grid).toHaveLength(CM_COLS)
            expect(result.grid[0]).toHaveLength(CM_ROWS)
            // No lollipops drop during the free spins.
            for (const spin of result.bonus!.spins) expect(spin.sequence.steps.flatMap(s => s.grid.flat()).includes('scatter')).toBe(false)
        }
    })
})

describe('ported games through playRound', () => {
    it('stakes one hand per placed tile and bounds the stake', async () => {
        const id = seedPlayer(10_000_000)
        const round = await playRound(id, 'magichands', { bet: 100, options: { placements: [1, 2, 3] } })
        expect(round.stake).toBe(300)
        expect(round.payout).toBe(100 * (round.result as { win: number }).win)
        const before = coinsOf(id).coins
        await expect(playRound(id, 'magichands', { bet: 100_000, options: { placements: Array.from({ length: 11 }, (_, i) => i) } })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'magichands', { bet: 100, options: { placements: [] } })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'magichands', { bet: 100, options: { placements: [5, 5] } })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'magichands', { bet: 5, options: { placements: [5] } })).rejects.toMatchObject({ statusCode: 400 })
        expect(coinsOf(id).coins).toBe(before)
        expect(ledgerSum(id)).toBe(coinsOf(id).coins - 10_000_000)
    })

    it('charges Safe Landing and feature buys as multiples of the bet', async () => {
        const id = seedPlayer(10_000_000)
        expect((await playRound(id, 'polymasters', { bet: 100, options: { mode: 'safe' } })).stake).toBe(100 * PM_SAFE_LANDING_COST)
        expect((await playRound(id, 'polymasters', { bet: 100 })).stake).toBe(100)
        await expect(playRound(id, 'polymasters', { bet: 100, options: { mode: 'auto' } })).rejects.toMatchObject({ statusCode: 400 })
        const buy = await playRound(id, 'candymadness', { bet: 100, options: { feature: 'buyFreeSpins' } })
        expect(buy.stake).toBe(100 * CM_BUY_FREESPINS_COST)
        expect((buy.result as CandyMadnessResult).bonus).not.toBeNull()
        expect((await playRound(id, 'candymadness', { bet: 101, options: { feature: 'bonusHunt' } })).stake).toBe(364)
        await expect(playRound(id, 'candymadness', { bet: 100, options: { feature: 'free' } })).rejects.toMatchObject({ statusCode: 400 })
        expect(ledgerSum(id)).toBe(coinsOf(id).coins - 10_000_000)
    })

    it('pays the wheel in whole coins, rounded down', async () => {
        const id = seedPlayer(1_000_000)
        for (let i = 0; i < 20; i++) {
            const round = await playRound(id, 'wheel', { bet: 101, options: { risk: 'easy' } })
            expect(round.payout).toBe(Math.floor(101 * (round.result as { multiplier: number }).multiplier + 1e-6))
        }
        await expect(playRound(id, 'wheel', { bet: 100, options: { risk: 'x' } })).rejects.toMatchObject({ statusCode: 400 })
    })
})
