import { describe, expect, it } from 'vitest'
import { GAMES } from '../shared/games/registry'
import { TPH_BUY_FREE_SPINS_COST } from '../shared/slots/trashpanda'
import { serverGame } from '../server/utils/games'
import { playRound } from '../server/utils/rounds'
import { TABLES } from '../server/utils/tables'
import { coinsOf, ledgerSum, seedPlayer } from './setup/players'

describe('playRound', () => {
    it('has a server implementation for every listed game, and a live table for every live one', () => {
        for (const game of GAMES) {
            if (game.live) {
                expect(TABLES[game.slug]?.config.slug).toBe(game.slug)
                expect(serverGame(game.slug)).toBeUndefined()
            } else {
                expect(serverGame(game.slug)?.info.slug).toBe(game.slug)
            }
        }
        for (const slug of Object.keys(TABLES)) expect(GAMES.find(game => game.slug === slug)?.live).toBe(true)
    })

    it('debits the stake, credits the payout and returns the new balance', async () => {
        const id = seedPlayer(10_000)
        let expected = 10_000
        for (let i = 0; i < 30; i++) {
            const round = await playRound(id, 'dice', { bet: 100, options: { chance: 50 } })
            expected += round.payout - round.stake
            expect(round.balance).toBe(expected)
            expect(round.payout === 0 || round.payout === 196).toBe(true)
        }
        expect(coinsOf(id).coins).toBe(expected)
        expect(ledgerSum(id)).toBe(expected - 10_000)
    })

    it('settles slot rounds and feature buys', async () => {
        const id = seedPlayer(100_000)
        const spin = await playRound(id, 'trashpanda', { bet: 100 })
        expect(spin.stake).toBe(100)
        const buy = await playRound(id, 'trashpanda', { bet: 100, options: { feature: 'buyFreeSpins' } })
        expect(buy.stake).toBe(100 * TPH_BUY_FREE_SPINS_COST)
        expect((buy.result as { freeSpins: { spins: unknown[] } }).freeSpins.spins.length).toBeGreaterThan(0)
    })

    it('takes the roulette stake from the bets on the layout', async () => {
        const id = seedPlayer(1_000)
        const round = await playRound(id, 'roulette', { options: { bets: [{ kind: 'red', amount: 30 }, { kind: 'straight', value: 7, amount: 20 }] } })
        expect(round.stake).toBe(50)
    })

    it('rejects bad bets and unknown games', async () => {
        const id = seedPlayer(1_000)
        await expect(playRound(id, 'nope', { bet: 100 })).rejects.toMatchObject({ statusCode: 404 })
        await expect(playRound(id, 'dice', { bet: 50 })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'dice', { bet: 150.5 })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'dice', { bet: 100, options: { chance: 99 } })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'dice', { bet: 2_000 })).rejects.toMatchObject({ statusCode: 400 })
        expect(coinsOf(id).coins).toBe(1_000)
    })

    it('takes the bet only as a JSON number', async () => {
        const id = seedPlayer(10_000)
        for (const bet of ['100', [100], true, null, undefined, Number.NaN, Infinity, -100, 1e300]) {
            await expect(playRound(id, 'dice', { bet, options: { chance: 50 } })).rejects.toMatchObject({ statusCode: 400 })
        }
        await expect(playRound(id, 'dice', { bet: 100, options: ['chance'] })).resolves.toMatchObject({ stake: 100 })
        // Only that last round moved coins: lost 100 or won 196 - 100.
        expect([9_900, 10_096]).toContain(coinsOf(id).coins)
        expect(ledgerSum(id)).toBe(coinsOf(id).coins - 10_000)
    })

    it('rejects malformed roulette layouts without charging', async () => {
        const id = seedPlayer(10_000)
        const layouts: unknown[] = [
            [{ kind: 'straight', amount: 10 }],
            [{ kind: 'straight', value: null, amount: 10 }],
            [{ kind: 'straight', value: '7', amount: 10 }],
            [{ kind: 'dozen', value: 4, amount: 10 }],
            [{ kind: 'red', amount: '10' }],
            [{ kind: 'red', amount: 10.5 }],
            [null],
            // 41 different spots: one more than a layout holds.
            [...Array.from({ length: 37 }, (_, n) => ({ kind: 'straight', value: n, amount: 10 })), { kind: 'red', amount: 10 }, { kind: 'black', amount: 10 }, { kind: 'odd', amount: 10 }, { kind: 'even', amount: 10 }]
        ]
        for (const bets of layouts) {
            await expect(playRound(id, 'roulette', { options: { bets } })).rejects.toMatchObject({ statusCode: 400 })
        }
        expect(coinsOf(id).coins).toBe(10_000)
        // A value on an outside bet is ignored: it is the same spot as without one.
        const round = await playRound(id, 'roulette', { options: { bets: [{ kind: 'red', value: 3, amount: 10 }, { kind: 'red', amount: 10 }] } })
        expect((round.result as { bets: unknown[] }).bets).toHaveLength(1)
    })

    it('never lets parallel bets spend more than the balance', async () => {
        const id = seedPlayer(500)
        // Win chance 1%: nearly every round loses, so payouts can't fund extra bets.
        const results = await Promise.allSettled(Array.from({ length: 20 }, () => playRound(id, 'dice', { bet: 100, options: { chance: 1 } })))
        const played = results.filter(r => r.status === 'fulfilled').length
        const { coins } = coinsOf(id)
        expect(coins).toBeGreaterThanOrEqual(0)
        expect(ledgerSum(id)).toBe(coins - 500)
        expect(played).toBeGreaterThanOrEqual(5)
        for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ statusCode: 400 })
    })
})

describe('roulette limits', () => {
    it('rejects chips under the minimum and layouts over the maximum', async () => {
        const id = seedPlayer(5_000_000)
        await expect(playRound(id, 'roulette', { options: { bets: [{ kind: 'red', amount: 5 }] } })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'roulette', { options: { bets: [{ kind: 'red', amount: 600_000 }, { kind: 'black', amount: 600_000 }] } })).rejects.toMatchObject({ statusCode: 400 })
    })
})
