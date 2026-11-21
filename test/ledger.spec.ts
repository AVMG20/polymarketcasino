import { describe, expect, it } from 'vitest'
import { coinTransaction, listCoinHistory } from '../server/utils/ledger'
import { writeTx } from '../server/database'
import { coinsOf, ledgerSum, seedPlayer } from './setup/players'

const credit = (playerId: string, amount: number) => coinTransaction(coins => coins.credit({ playerId, amount, category: 'dice' }))
const debit = (playerId: string, amount: number) => coinTransaction(coins => coins.debit({ playerId, amount, category: 'dice' }))

describe('coin ledger', () => {
    it('credits, debits and logs every change with the balance after it', async () => {
        const id = seedPlayer(1_000)
        expect((await credit(id, 500)).value.coins).toBe(1_500)
        expect((await debit(id, 200)).value.coins).toBe(1_300)
        const history = listCoinHistory(id)
        expect(history.map(row => [row.type, row.amount, row.balanceAfter])).toEqual([['debit', 200, 1_300], ['credit', 500, 1_500]])
        expect(ledgerSum(id)).toBe(300)
    })

    it('refuses to debit more than the balance', async () => {
        const id = seedPlayer(100)
        await expect(debit(id, 101)).rejects.toMatchObject({ statusCode: 400 })
        expect(coinsOf(id).coins).toBe(100)
        expect(listCoinHistory(id)).toHaveLength(0)
    })

    it('rolls back every change in a unit when one fails', async () => {
        const id = seedPlayer(100)
        await expect(coinTransaction((coins) => {
            coins.credit({ playerId: id, amount: 50, category: 'dice' })
            coins.debit({ playerId: id, amount: 1_000, category: 'dice' })
        })).rejects.toMatchObject({ statusCode: 400 })
        expect(coinsOf(id).coins).toBe(100)
        expect(listCoinHistory(id)).toHaveLength(0)
    })

    it('rejects fractional, zero and negative amounts', async () => {
        const id = seedPlayer(100)
        for (const amount of [0, -5, 1.5, Number.NaN]) await expect(credit(id, amount)).rejects.toMatchObject({ statusCode: 400 })
    })

    it('raises the peak only when a credit beats it', async () => {
        const id = seedPlayer(9_000, 9_500)
        expect((await credit(id, 400)).value).toEqual({ coins: 9_400, peakCoins: 9_500 })
        expect((await credit(id, 1_000)).value).toEqual({ coins: 10_400, peakCoins: 10_400 })
        await debit(id, 5_000)
        expect(coinsOf(id)).toEqual({ coins: 5_400, peak: 10_400 })
    })

    it('refuses an async unit of work and rolls back what it wrote', async () => {
        const id = seedPlayer(100)
        await expect(coinTransaction(async (coins) => {
            coins.credit({ playerId: id, amount: 50, category: 'dice' })
        })).rejects.toThrow('synchronous')
        expect(() => writeTx(async () => {})).toThrow('synchronous')
        expect(coinsOf(id).coins).toBe(100)
        expect(listCoinHistory(id)).toHaveLength(0)
    })

    it('never goes negative under a burst of parallel bets', async () => {
        const id = seedPlayer(1_000)
        const results = await Promise.allSettled(Array.from({ length: 25 }, () => debit(id, 100)))
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(10)
        expect(coinsOf(id).coins).toBe(0)
        expect(ledgerSum(id)).toBe(-1_000)
    })
})
