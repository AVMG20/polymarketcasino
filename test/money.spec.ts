import { describe, expect, it } from 'vitest'
import { formatCoins, parseAmount } from '../shared/money'

describe('parseAmount', () => {
    it('reads plain numbers, separators and suffixes', () => {
        expect(parseAmount('2500')).toBe(2500)
        expect(parseAmount('2,500')).toBe(2500)
        expect(parseAmount('10k')).toBe(10_000)
        expect(parseAmount('2.5m')).toBe(2_500_000)
        expect(parseAmount(' 1B ')).toBe(1_000_000_000)
    })

    it('rounds down to whole coins and rejects garbage', () => {
        expect(parseAmount('12.9')).toBe(12)
        expect(parseAmount('1.005k')).toBe(1_005)
        expect(parseAmount('0.29m')).toBe(290_000)
        expect(parseAmount('abc')).toBeNull()
        expect(parseAmount('-5')).toBeNull()
        expect(parseAmount('')).toBeNull()
    })
})

describe('formatCoins', () => {
    it('keeps small amounts exact and compacts large ones without rounding up', () => {
        expect(formatCoins(9_999)).toBe('9,999')
        expect(formatCoins(12_345)).toBe('12.3K')
        expect(formatCoins(999_999)).toBe('999K')
        expect(formatCoins(4_567_890)).toBe('4.56M')
        expect(formatCoins(4_567_890, false)).toBe('4,567,890')
    })
})
