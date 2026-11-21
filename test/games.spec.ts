import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { diceMultiplier, parseDiceOptions, playDice } from '../shared/games/dice'
import { limboChance, parseLimboOptions, playLimbo, toCents } from '../shared/games/limbo'
import { GAMES } from '../shared/games/registry'
import { betReturn, coveredPockets, parseRouletteBets, playRoulette, pocketColor, WHEEL_ORDER } from '../shared/games/roulette'
import { seededRng, type Rng } from '../shared/rng'
import { casinoManifest } from '../server/utils/manifest'

const PUBLIC = resolve(import.meta.dirname, '../public')

const fixed = (value: number): Rng => ({ next: () => value })

describe('dice', () => {
    it('wins under the chance, or over 100 - chance', () => {
        expect(playDice(fixed(0.4999), { chance: 50, over: false })).toMatchObject({ roll: 49.99, won: true })
        expect(playDice(fixed(0.5), { chance: 50, over: false })).toMatchObject({ roll: 50, won: false })
        expect(playDice(fixed(0.5), { chance: 50, over: true })).toMatchObject({ roll: 50, target: 50, won: true })
        expect(playDice(fixed(0.7), { chance: 25, over: true })).toMatchObject({ target: 75, won: false })
    })

    it('pays 98% / chance and validates options', () => {
        expect(diceMultiplier(50)).toBe(1.96)
        expect(diceMultiplier(1)).toBe(98)
        expect(() => parseDiceOptions({ chance: 0.5 })).toThrow(RangeError)
        expect(() => parseDiceOptions({ chance: 96 })).toThrow(RangeError)
        expect(parseDiceOptions({ chance: 33.333, over: true })).toEqual({ chance: 33.33, over: true })
    })
})

describe('limbo', () => {
    it('wins when the result reaches the target', () => {
        expect(playLimbo(fixed(0.5), { target: 1.96 })).toMatchObject({ result: 1.96, won: true })
        expect(playLimbo(fixed(0.5), { target: 1.97 })).toMatchObject({ won: false })
        expect(playLimbo(fixed(0), { target: 2 }).result).toBe(1)
    })

    it('returns about 98% at any target', () => {
        const rng = seededRng(5)
        let back = 0
        const n = 200_000
        for (let i = 0; i < n; i++) if (playLimbo(rng, { target: 3 }).won) back += 3
        expect(back / n).toBeGreaterThan(0.95)
        expect(back / n).toBeLessThan(1.01)
        expect(limboChance(2)).toBe(0.49)
        expect(() => parseLimboOptions({ target: 1 })).toThrow(RangeError)
    })

    it('keeps a typed target to the cent despite binary floats', () => {
        expect(toCents(1.15)).toBe(1.15)
        expect(toCents(2.675)).toBe(2.67)
        expect(toCents(1.019)).toBe(1.01)
        expect(parseLimboOptions({ target: 1.15 }).target).toBe(1.15)
        expect(parseLimboOptions({ target: 4.35 }).target).toBe(4.35)
    })
})

describe('roulette', () => {
    it('covers the right pockets', () => {
        expect(coveredPockets({ kind: 'red' })).toHaveLength(18)
        expect(coveredPockets({ kind: 'dozen', value: 2 })).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24])
        expect(coveredPockets({ kind: 'column', value: 1 })).toEqual([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34])
        expect(coveredPockets({ kind: 'straight', value: 0 })).toEqual([0])
        expect(() => coveredPockets({ kind: 'straight', value: 37 })).toThrow(RangeError)
    })

    it('pays 36 / covered pockets, so every bet has the same edge', () => {
        expect(betReturn({ kind: 'straight', value: 7 })).toBe(36)
        expect(betReturn({ kind: 'red' })).toBe(2)
        expect(betReturn({ kind: 'dozen', value: 1 })).toBe(3)
    })

    it('settles every bet against one pocket', () => {
        // 0.5 × 37 → pocket 18 (red, even, low, dozen 2, column 3).
        const result = playRoulette(fixed(0.5), parseRouletteBets([
            { kind: 'straight', value: 18, amount: 10 },
            { kind: 'red', amount: 5 },
            { kind: 'odd', amount: 5 },
            { kind: 'straight', value: 18, amount: 5 }
        ]))
        expect(result.pocket).toBe(18)
        expect(result.color).toBe('red')
        expect(result.bets).toEqual([
            { kind: 'straight', value: 18, amount: 15, won: true, payout: 540 },
            { kind: 'red', amount: 5, won: true, payout: 10 },
            { kind: 'odd', amount: 5, won: false, payout: 0 }
        ])
    })

    it('has every pocket on the wheel once and rejects bad bet lists', () => {
        expect(new Set(WHEEL_ORDER).size).toBe(37)
        expect(pocketColor(0)).toBe('green')
        expect(() => parseRouletteBets([])).toThrow(RangeError)
        expect(() => parseRouletteBets([{ kind: 'red', amount: 0 }])).toThrow(RangeError)
        expect(() => parseRouletteBets([{ kind: 'split', amount: 5 }])).toThrow(RangeError)
    })
})

describe('registry', () => {
    it('lists unique slugs in the hub format', () => {
        const slugs = GAMES.map(game => game.slug)
        expect(new Set(slugs).size).toBe(slugs.length)
        expect(slugs.every(slug => /^[a-z0-9-]{2,40}$/.test(slug))).toBe(true)
    })

    it('points every cover, and the hub manifest cover, at a file in public/', () => {
        for (const game of GAMES) expect(existsSync(join(PUBLIC, game.cover)), game.cover).toBe(true)
        const cover = casinoManifest().games[0]!.cover!
        expect(existsSync(join(PUBLIC, new URL(cover).pathname)), cover).toBe(true)
    })
})
