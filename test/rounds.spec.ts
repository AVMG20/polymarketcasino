import { describe, expect, it } from 'vitest'
import { normalizeCoins, sumCoins } from '../shared/money'
import { GAMES } from '../shared/games/registry'
import { TPH_BUY_FREE_SPINS_COST } from '../shared/slots/trashpanda'
import { serverGame } from '../server/utils/games'
import { playRound } from '../server/utils/rounds'
import { stepGame } from '../server/utils/steps'
import { TABLES } from '../server/utils/tables'
import { chipLedgerSum, chipsOf, coinsOf, ledgerSum, seedPlayer } from './setup/players'

describe('playRound', () => {
    it('has a server implementation for every listed game, and a live table for every live one', () => {
        for (const game of GAMES) {
            if (game.live) {
                expect(TABLES[game.slug]?.config.slug).toBe(game.slug)
                expect(serverGame(game.slug)).toBeUndefined()
            } else if (game.steps) {
                expect(stepGame(game.slug)?.slug).toBe(game.slug)
                expect(serverGame(game.slug)).toBeUndefined()
            } else {
                expect(serverGame(game.slug)?.info.slug).toBe(game.slug)
            }
        }
        for (const slug of Object.keys(TABLES)) expect(GAMES.find(game => game.slug === slug)?.live).toBe(true)
    })

    it('debits the coin stake, pays the payout in chips, puts 1% rakeback in the cage and returns both balances', async () => {
        const id = seedPlayer(10_000)
        let chips = 0
        for (let i = 0; i < 30; i++) {
            const round = await playRound(id, 'dice', { bet: 100, options: { chance: 50 } })
            expect(round.rakeback).toBe(1)
            expect(round.rakebackPot).toBe(i + 1)
            chips = normalizeCoins(chips + round.payout)
            expect(round.balance).toBe(10_000 - 100 * (i + 1))
            expect(round.chips).toBe(chips)
            expect(round.chipsEarned).toBe(round.payout)
            expect(round.payout === 0 || round.payout === 196).toBe(true)
        }
        expect(coinsOf(id).coins).toBe(7_000)
        expect(ledgerSum(id)).toBe(-3_000)
        expect(chipsOf(id)).toBe(chips)
        expect(chipLedgerSum(id)).toBe(chips)
    })

    it('settles slot rounds and feature buys', async () => {
        const id = seedPlayer(100_000)
        const spin = await playRound(id, 'trashpanda', { bet: 100 })
        expect(spin.stake).toBe(100)
        const buy = await playRound(id, 'trashpanda', { bet: 100, options: { feature: 'buyFreeSpins' } })
        expect(buy.stake).toBe(100 * TPH_BUY_FREE_SPINS_COST)
        expect((buy.result as { freeSpins: { spins: unknown[] } }).freeSpins.spins.length).toBeGreaterThan(0)
    })

    it('plays a decimal bet from the minimum of 10 and pays to 0.0001 chip', async () => {
        const id = seedPlayer(100)
        let coins = 100
        let chips = 0
        for (let i = 0; i < 9; i++) {
            const round = await playRound(id, 'dice', { bet: 10.0001, options: { chance: 50 } })
            expect(round.stake).toBe(10.0001)
            // 10.0001 × 1.96 = 19.600196: rounded down to 19.6001; the rakeback (into the cage) 0.100001 to 0.1.
            expect([0, 19.6001]).toContain(round.payout)
            expect(round.rakeback).toBe(0.1)
            coins = normalizeCoins(coins - round.stake)
            chips = normalizeCoins(chips + round.payout)
            expect(round.balance).toBe(coins)
            expect(round.chips).toBe(chips)
        }
        expect(coinsOf(id).coins).toBe(coins)
        expect(ledgerSum(id)).toBe(normalizeCoins(coins - 100))
        expect(chipLedgerSum(id)).toBe(chips)
    })

    it('takes the roulette stake from the bets on the layout', async () => {
        const id = seedPlayer(1_000)
        const round = await playRound(id, 'roulette', { options: { bets: [{ kind: 'red', amount: 30 }, { kind: 'straight', value: 7, amount: 20 }] } })
        expect(round.stake).toBe(50)
    })

    it('rejects bad bets and unknown games', async () => {
        const id = seedPlayer(1_000)
        await expect(playRound(id, 'nope', { bet: 100 })).rejects.toMatchObject({ statusCode: 404 })
        await expect(playRound(id, 'dice', { bet: 9.9999 })).rejects.toMatchObject({ statusCode: 400 })
        await expect(playRound(id, 'dice', { bet: 150.00001 })).rejects.toMatchObject({ statusCode: 400 })
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
        // Only that last round moved money: 100 coins staked, 0 or 196 chips paid (and 1 coin rakeback in the cage).
        expect(coinsOf(id).coins).toBe(9_900)
        expect([0, 196]).toContain(chipsOf(id))
        expect(ledgerSum(id)).toBe(-100)
    })

    it('rejects malformed roulette layouts without charging', async () => {
        const id = seedPlayer(10_000)
        const layouts: unknown[] = [
            [{ kind: 'straight', amount: 10 }],
            [{ kind: 'straight', value: null, amount: 10 }],
            [{ kind: 'straight', value: '7', amount: 10 }],
            [{ kind: 'dozen', value: 4, amount: 10 }],
            [{ kind: 'red', amount: '10' }],
            [{ kind: 'red', amount: 10.00001 }],
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
        // Wins pay chips, and chips stake once the coins are gone.
        const results = await Promise.allSettled(Array.from({ length: 20 }, () => playRound(id, 'dice', { bet: 100, options: { chance: 50 } })))
        const played = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : [])
        expect(played.length).toBeGreaterThanOrEqual(5)
        expect(sumCoins(played.map(round => round.stakeCoins))).toBe(500)
        expect(coinsOf(id).coins).toBe(0)
        expect(ledgerSum(id)).toBe(-500)
        expect(chipsOf(id)).toBeGreaterThanOrEqual(0)
        expect(chipsOf(id)).toBe(normalizeCoins(sumCoins(played.map(round => round.payout)) - sumCoins(played.map(round => round.stakeChips))))
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
