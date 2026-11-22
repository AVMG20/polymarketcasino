import { describe, expect, it } from 'vitest'
import {
    costFor, formatCoins, formatCoinsExact, formatNumber, fromUnits, isCoinAmount, MAX_COINS, normalizeCoins,
    parseAmount, payFor, roundCoins, sameCoins, sumCoins, toUnits
} from '../shared/money'

describe('coin units', () => {
    it('converts coins to database units and back exactly', () => {
        expect(toUnits(1)).toBe(10_000)
        expect(toUnits(2137.5)).toBe(21_375_000)
        expect(toUnits(0.0001)).toBe(1)
        expect(toUnits(0.1 + 0.2)).toBe(3_000)
        expect(fromUnits(21_375_000)).toBe(2137.5)
        expect(fromUnits(1)).toBe(0.0001)
        for (const coins of [0, 0.0001, 0.3, 1.2345, 99.99, 123_456.7891, MAX_COINS]) expect(fromUnits(toUnits(coins))).toBe(coins)
    })

    it('rounds down to four decimals, never up', () => {
        expect(roundCoins(12.34567)).toBe(12.3456)
        expect(roundCoins(0.99999)).toBe(0.9999)
        expect(roundCoins(0.7 * 3)).toBe(2.1)
        expect(roundCoins(5)).toBe(5)
        expect(roundCoins(Number.NaN)).toBe(0)
    })

    it('adds and compares on the unit, free of float noise', () => {
        expect(sumCoins([0.1, 0.2])).toBe(0.3)
        expect(sumCoins([100, 0.0001, 47.5])).toBe(147.5001)
        expect(sumCoins([])).toBe(0)
        expect(normalizeCoins(10.3 - 0.1)).toBe(10.2)
        expect(sameCoins(0.1 + 0.2, 0.3)).toBe(true)
        expect(sameCoins(0.3, 0.3001)).toBe(false)
    })

    it('accepts amounts with at most four decimals', () => {
        expect(isCoinAmount(10)).toBe(true)
        expect(isCoinAmount(0)).toBe(true)
        expect(isCoinAmount(12.3456)).toBe(true)
        expect(isCoinAmount(0.1 + 0.2)).toBe(true)
        expect(isCoinAmount(1_000_000.1234)).toBe(true)
        expect(isCoinAmount(12.34567)).toBe(false)
        expect(isCoinAmount(-1)).toBe(false)
        expect(isCoinAmount(Number.NaN)).toBe(false)
        expect(isCoinAmount(Number.POSITIVE_INFINITY)).toBe(false)
        expect(isCoinAmount(MAX_COINS + 1)).toBe(false)
        expect(isCoinAmount('10')).toBe(false)
    })

    it('pays bet × multiple rounded down and prices bet × cost rounded up', () => {
        expect(payFor(10, 1.96)).toBe(19.6)
        expect(payFor(0.7, 3)).toBe(2.1)
        expect(payFor(100, 1.3)).toBe(130)
        expect(payFor(1, 0.33333)).toBe(0.3333)
        expect(payFor(10, 0)).toBe(0)
        expect(payFor(1_000_000, 10_000)).toBe(10_000_000_000)
        expect(costFor(101, 21.75)).toBe(2196.75)
        expect(costFor(1, 1 / 3)).toBe(0.3334)
        expect(costFor(10, 56)).toBe(560)
    })
})

describe('parseAmount', () => {
    it('reads plain numbers and suffixes', () => {
        expect(parseAmount('2500')).toBe(2500)
        expect(parseAmount('10k')).toBe(10_000)
        expect(parseAmount(' 1B ')).toBe(1_000_000_000)
        expect(parseAmount('0,5t')).toBe(500_000_000_000)
        expect(parseAmount('1t')).toBeNull()
        expect(parseAmount('0')).toBe(0)
        expect(parseAmount('1 000 000')).toBe(1_000_000)
    })

    it('reads a dot followed by three digits as Dutch thousands', () => {
        expect(parseAmount('2.137')).toBe(2137)
        expect(parseAmount('1.000.000')).toBe(1_000_000)
        expect(parseAmount('2.137,5')).toBe(2137.5)
        expect(parseAmount('0.125')).toBe(0.125)
    })

    it('reads a single comma as the decimal comma', () => {
        expect(parseAmount('2,5')).toBe(2.5)
        expect(parseAmount('2,137')).toBe(2.137)
        expect(parseAmount('0,0001')).toBe(0.0001)
        expect(parseAmount('12,75')).toBe(12.75)
    })

    it('reads English spellings where they are unambiguous', () => {
        expect(parseAmount('2.5')).toBe(2.5)
        expect(parseAmount('2,137.5')).toBe(2137.5)
        expect(parseAmount('1,000,000')).toBe(1_000_000)
        expect(parseAmount('.5')).toBe(0.5)
    })

    it('treats a separator before a suffix as decimal', () => {
        expect(parseAmount('2,5m')).toBe(2_500_000)
        expect(parseAmount('2.5m')).toBe(2_500_000)
        expect(parseAmount('1.005k')).toBe(1_005)
        expect(parseAmount('0.29M')).toBe(290_000)
        expect(parseAmount('1.000k')).toBe(1_000)
        expect(parseAmount('1.000.000k')).toBeNull()
    })

    it('rounds down to four decimals', () => {
        expect(parseAmount('12,34567')).toBe(12.3456)
        expect(parseAmount('0,00009')).toBe(0)
    })

    it('rejects garbage and malformed groups', () => {
        for (const text of ['abc', '-5', '', ' ', '.', ',', '1.00.000', '1,00,000', '2.137.5', '1.2.3', '10kk', '1e5', '2,137,5.5']) {
            expect(parseAmount(text), text).toBeNull()
        }
    })
})

describe('formatNumber (the old site port)', () => {
    it('compacts in nl-NL with the old suffixes', () => {
        expect(formatNumber(2137)).toBe('2,14K')
        expect(formatNumber(12_345)).toBe('12,35K')
        expect(formatNumber(1_234_567)).toBe('1,23m')
        expect(formatNumber(2.5e9)).toBe('2,5B')
        expect(formatNumber(3.2e12)).toBe('3,2T')
        expect(formatNumber(47.5)).toBe('47,5')
    })

    it('prints the standard nl-NL form with at most two decimals', () => {
        expect(formatNumber(2137, false)).toBe('2.137')
        expect(formatNumber(2137.456, false)).toBe('2.137,46')
        expect(formatNumber(5, false, 2)).toBe('5,00')
    })
})

describe('formatCoins', () => {
    it('shows whole coins with Dutch thousands, never rounding up', () => {
        expect(formatCoins(2137)).toBe('2.137')
        expect(formatCoins(2137.99)).toBe('2.137')
        expect(formatCoins(1_000_000)).toBe('1.000.000')
        expect(formatCoins(10.5)).toBe('10')
        expect(formatCoins(0)).toBe('0')
        expect(formatCoins(-2137.5)).toBe('-2.137')
    })

    it('shows up to two decimals under 10 coins', () => {
        expect(formatCoins(2.5)).toBe('2,5')
        expect(formatCoins(9.999)).toBe('9,99')
        expect(formatCoins(0.07)).toBe('0,07')
        expect(formatCoins(0.0001)).toBe('0')
        expect(formatCoins(5)).toBe('5')
    })

    it('compacts on request like the old site', () => {
        expect(formatCoins(25_000, true)).toBe('25K')
        expect(formatCoins(1_000_000, true)).toBe('1m')
        expect(formatCoins(500, true)).toBe('500')
    })

    it('prints every decimal for tooltips', () => {
        expect(formatCoinsExact(2137.5)).toBe('2.137,5')
        expect(formatCoinsExact(0.0001)).toBe('0,0001')
        expect(formatCoinsExact(1_234_567.8912)).toBe('1.234.567,8912')
        expect(formatCoinsExact(0.1 + 0.2)).toBe('0,3')
    })
})

describe('amount inputs', () => {
    it('write values back in a form parseAmount reads as the same amount', async () => {
        const { amountShorthand, plainAmount } = await import('../app/composables/amount-input')
        expect(plainAmount(2.137)).toBe('2,137')
        expect(plainAmount(2137)).toBe('2137')
        expect(amountShorthand(2_500_000_000)).toBe('2,5b')
        expect(amountShorthand(12_000)).toBe('12k')
        for (const value of [10, 2.137, 2137, 2137.5, 0.0001, 12_345.6789, 1_000_000, 2_500_000, 999_999.9999]) {
            expect(parseAmount(plainAmount(value)), String(value)).toBe(value)
            expect(parseAmount(amountShorthand(value)), String(value)).toBe(value)
        }
    })
})
