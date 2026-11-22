import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../server/database'
import { coinTransactions, gameRounds, players } from '../server/database/schema'
import { claimAllowance } from '../server/utils/wallet'
import { playRound } from '../server/utils/rounds'
import { parseStatsQuery, playerStats } from '../server/utils/stats'
import { addDays, amsterdamDayStart } from '../shared/economy'
import { sumCoins } from '../shared/money'
import { coinsOf, seedPlayer } from './setup/players'

// Sunday 22 November 2026, 13:00 in Amsterdam (UTC+1). The 7-day range is
// 16 to 22 November and starts at 15 November 23:00 UTC.
const NOW = new Date('2026-11-22T12:00:00Z')
const WEEK_START = new Date('2026-11-15T23:00:00Z')

const at = (iso: string) => new Date(iso)

function round(playerId: string, game: string, stake: number, payout: number, createdAt: Date) {
    db.insert(gameRounds).values({ playerId, game, stake, payout, summary: {}, createdAt }).run()
}

function ledger(playerId: string, row: { category: string, type: 'credit' | 'debit', amount: number, balanceAfter: number, createdAt: Date, refund?: boolean }) {
    db.insert(coinTransactions).values({ playerId, refund: false, ...row }).run()
}

describe('parseStatsQuery', () => {
    it('defaults to 30 days and every game', () => {
        expect(parseStatsQuery({})).toEqual({ range: '30d', game: null })
        expect(parseStatsQuery({ range: 'all', game: 'casino-holdem' })).toEqual({ range: 'all', game: 'casino-holdem' })
    })

    it('refuses ranges and games that cannot be one', () => {
        for (const query of [{ range: '1y' }, { range: ['7d'] }, { game: 'Dice' }, { game: ['dice'] }, { game: '' }, { game: 'x'.repeat(41) }]) {
            expect(() => parseStatsQuery(query)).toThrow()
        }
    })
})

describe('amsterdamDayStart', () => {
    it('is local midnight in winter and in summer', () => {
        expect(amsterdamDayStart('2026-11-16').toISOString()).toBe('2026-11-15T23:00:00.000Z')
        expect(amsterdamDayStart('2026-07-10').toISOString()).toBe('2026-07-09T22:00:00.000Z')
        // The clocks go back on 25 October 2026: that day lasts 25 hours.
        expect(amsterdamDayStart('2026-10-26').getTime() - amsterdamDayStart('2026-10-25').getTime()).toBe(25 * 3_600_000)
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    })
})

describe('playerStats', () => {
    it('totals rounds overall and per game, most wagered first', () => {
        const id = seedPlayer()
        round(id, 'dice', 100, 196, at('2026-11-20T10:00:00Z'))
        round(id, 'dice', 100.0001, 0, at('2026-11-20T11:00:00Z'))
        round(id, 'spinata', 50, 0, at('2026-11-21T09:00:00Z'))
        round(id, 'spinata', 50, 1000.5, at('2026-11-21T09:30:00Z'))
        round(id, 'blackjack', 300, 400.25, at('2026-11-22T08:00:00Z'))

        const stats = playerStats(id, { range: '7d', game: null }, NOW)
        expect(stats.from).toBe('2026-11-16')
        expect(stats.to).toBe('2026-11-22')
        expect(stats.summary).toEqual({
            rounds: 5,
            wagered: 600.0001,
            paidOut: 1596.75,
            net: 996.7499,
            returnRate: expect.closeTo(1596.75 / 600.0001, 12),
            biggestWin: 950.5,
            biggestWinGame: 'spinata',
            biggestWinDay: '2026-11-21'
        })
        expect(stats.games.map(g => [g.game, g.name, g.rounds, g.wagered, g.paidOut, g.net, g.biggestWin])).toEqual([
            ['blackjack', 'Blackjack', 1, 300, 400.25, 100.25, 100.25],
            ['dice', 'Dice', 2, 200.0001, 196, -4.0001, 96],
            ['spinata', 'Spiñata', 2, 100, 1000.5, 900.5, 950.5]
        ])
        expect(stats.games[1]!.returnRate).toBeCloseTo(196 / 200.0001, 12)

        expect(stats.days.map(d => d.day)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'])
        expect(stats.days.map(d => d.net)).toEqual([0, 0, 0, 0, -4.0001, 900.5, 100.25])
        expect(stats.days.map(d => d.rounds)).toEqual([0, 0, 0, 0, 2, 2, 1])
        expect(sumCoins(stats.days.map(d => d.wagered))).toBe(stats.summary.wagered)
    })

    it('reports nothing won when every round lost', () => {
        const id = seedPlayer()
        round(id, 'limbo', 10, 0, at('2026-11-22T08:00:00Z'))
        const stats = playerStats(id, { range: '7d', game: null }, NOW)
        expect(stats.summary).toMatchObject({ rounds: 1, net: -10, returnRate: 0, biggestWin: 0, biggestWinGame: null, biggestWinDay: null })
    })

    it('has no return before anything was wagered', () => {
        const id = seedPlayer()
        const stats = playerStats(id, { range: 'all', game: null }, NOW)
        expect(stats.summary).toMatchObject({ rounds: 0, wagered: 0, returnRate: null })
        expect(stats.games).toEqual([])
        expect(stats.days).toEqual([{ day: '2026-11-22', rounds: 0, wagered: 0, paidOut: 0, net: 0, balance: 0 }])
    })

    it('starts and ends the range on Amsterdam midnights', () => {
        const id = seedPlayer()
        round(id, 'dice', 10, 0, new Date(WEEK_START.getTime() - 1))
        round(id, 'dice', 20, 0, WEEK_START)
        round(id, 'dice', 30, 0, at('2026-11-22T22:59:59.999Z'))
        // Midnight in Amsterdam: tomorrow, outside every range ending today.
        round(id, 'dice', 40, 0, at('2026-11-22T23:00:00Z'))

        const week = playerStats(id, { range: '7d', game: null }, NOW)
        expect(week.summary.wagered).toBe(50)
        expect(week.days[0]).toMatchObject({ day: '2026-11-16', wagered: 20 })
        expect(week.days.at(-1)).toMatchObject({ day: '2026-11-22', wagered: 30 })

        const month = playerStats(id, { range: '30d', game: null }, NOW)
        expect(month.from).toBe('2026-10-24')
        expect(month.days).toHaveLength(30)
        expect(month.summary.wagered).toBe(60)
        expect(month.days.find(d => d.day === '2026-11-15')!.wagered).toBe(10)

        const all = playerStats(id, { range: 'all', game: null }, NOW)
        expect(all.from).toBe('2026-11-15')
        expect(all.days).toHaveLength(8)
        expect(all.summary.wagered).toBe(60)
    })

    it('puts a round in its Amsterdam day in summer time', () => {
        const id = seedPlayer()
        const now = at('2026-07-10T12:00:00Z')
        round(id, 'dice', 10, 0, at('2026-07-09T21:59:59Z')) // 23:59 on 9 July
        round(id, 'dice', 20, 0, at('2026-07-09T22:30:00Z')) // 00:30 on 10 July
        const stats = playerStats(id, { range: '7d', game: null }, now)
        expect(stats.days.at(-2)).toMatchObject({ day: '2026-07-09', wagered: 10 })
        expect(stats.days.at(-1)).toMatchObject({ day: '2026-07-10', wagered: 20 })
    })

    it('narrows the summary and days to one game, and still lists every game', () => {
        const id = seedPlayer()
        round(id, 'dice', 100, 196, at('2026-11-20T10:00:00Z'))
        round(id, 'roulette', 500, 0, at('2026-11-20T10:05:00Z'))
        round(id, 'roulette', 500, 18_000, at('2026-11-21T10:05:00Z'))

        const dice = playerStats(id, { range: '7d', game: 'dice' }, NOW)
        expect(dice.game).toBe('dice')
        expect(dice.summary).toMatchObject({ rounds: 1, wagered: 100, paidOut: 196, net: 96, biggestWin: 96, biggestWinGame: 'dice' })
        expect(dice.days.map(d => d.net)).toEqual([0, 0, 0, 0, 96, 0, 0])
        expect(dice.games.map(g => g.game)).toEqual(['roulette', 'dice'])

        const none = playerStats(id, { range: '7d', game: 'limbo' }, NOW)
        expect(none.summary).toMatchObject({ rounds: 0, wagered: 0, returnRate: null })
        expect(none.games).toHaveLength(2)
    })

    it('keeps allowance, conversions and refunded table stakes out of the game results', () => {
        const id = seedPlayer()
        ledger(id, { category: 'allowance', type: 'credit', amount: 2_500, balanceAfter: 2_500, createdAt: at('2026-11-20T08:00:00Z') })
        ledger(id, { category: 'convert', type: 'credit', amount: 5_000, balanceAfter: 7_500, createdAt: at('2026-11-20T08:10:00Z') })
        ledger(id, { category: 'convert', type: 'credit', amount: 1_000, balanceAfter: 8_500, createdAt: at('2026-11-21T08:10:00Z') })
        // A blackjack hand lost to a restart: staked, then refunded, never a round.
        ledger(id, { category: 'blackjack', type: 'debit', amount: 400, balanceAfter: 8_100, createdAt: at('2026-11-21T09:00:00Z') })
        ledger(id, { category: 'blackjack', type: 'credit', amount: 400, balanceAfter: 8_500, createdAt: at('2026-11-21T09:01:00Z'), refund: true })
        // One settled blackjack hand: stake and payout in the ledger plus its round.
        ledger(id, { category: 'blackjack', type: 'debit', amount: 100, balanceAfter: 8_400, createdAt: at('2026-11-21T10:00:00Z') })
        ledger(id, { category: 'blackjack', type: 'credit', amount: 200, balanceAfter: 8_600, createdAt: at('2026-11-21T10:01:00Z') })
        round(id, 'blackjack', 100, 200, at('2026-11-21T10:01:00Z'))
        // Last month's allowance is outside the week.
        ledger(id, { category: 'allowance', type: 'credit', amount: 2_500, balanceAfter: 2_500, createdAt: at('2026-10-30T08:00:00Z') })

        const stats = playerStats(id, { range: '7d', game: null }, NOW)
        expect(stats.summary).toMatchObject({ rounds: 1, wagered: 100, paidOut: 200, net: 100, returnRate: 2 })
        expect(stats.games.map(g => g.game)).toEqual(['blackjack'])
        expect(stats.flows).toEqual([
            { category: 'allowance', count: 1, amount: 2_500 },
            { category: 'convert', count: 2, amount: 6_000 }
        ])
        expect(stats.balance).toEqual({ start: 2_500, end: 8_600 })
    })

    it('reads the balance at the end of each day, carrying it over quiet days', () => {
        const id = seedPlayer()
        ledger(id, { category: 'allowance', type: 'credit', amount: 1_000, balanceAfter: 1_000, createdAt: at('2026-11-05T08:00:00Z') })
        ledger(id, { category: 'dice', type: 'credit', amount: 500.5, balanceAfter: 1_500.5, createdAt: at('2026-11-17T08:00:00Z') })
        ledger(id, { category: 'dice', type: 'debit', amount: 300, balanceAfter: 1_200.5, createdAt: at('2026-11-17T22:59:00Z') })
        // 00:30 on the 18th in Amsterdam.
        ledger(id, { category: 'dice', type: 'debit', amount: 200, balanceAfter: 1_000.5, createdAt: at('2026-11-17T23:30:00Z') })
        ledger(id, { category: 'dice', type: 'credit', amount: 1_999.5, balanceAfter: 3_000, createdAt: at('2026-11-20T08:00:00Z') })

        const stats = playerStats(id, { range: '7d', game: null }, NOW)
        expect(stats.balance).toEqual({ start: 1_000, end: 3_000 })
        expect(stats.days.map(d => d.balance)).toEqual([1_000, 1_200.5, 1_000.5, 1_000.5, 3_000, 3_000, 3_000])
    })

    it('never counts another player', () => {
        const id = seedPlayer()
        const other = seedPlayer()
        round(other, 'dice', 100, 0, at('2026-11-20T10:00:00Z'))
        ledger(other, { category: 'allowance', type: 'credit', amount: 2_500, balanceAfter: 2_500, createdAt: at('2026-11-20T08:00:00Z') })
        const stats = playerStats(id, { range: 'all', game: null }, NOW)
        expect(stats.summary.rounds).toBe(0)
        expect(stats.flows.every(f => f.count === 0)).toBe(true)
        expect(stats.balance).toEqual({ start: 0, end: 0 })
    })

    it('matches what real rounds and an allowance claim wrote', async () => {
        const id = seedPlayer()
        db.update(players).set({ origin: 'dev' }).where(eq(players.id, id)).run()
        await claimAllowance(id)
        const played = []
        for (let i = 0; i < 20; i++) played.push(await playRound(id, 'dice', { bet: 25.5, options: { chance: 50 } }))

        const stats = playerStats(id, { range: '7d', game: null })
        const paid = sumCoins(played.map(r => r.payout))
        expect(stats.summary).toMatchObject({ rounds: 20, wagered: 510, paidOut: paid })
        expect(stats.games.map(g => g.game)).toEqual(['dice'])
        expect(stats.flows.find(f => f.category === 'allowance')).toEqual({ category: 'allowance', count: 1, amount: 2_500 })
        expect(stats.balance.end).toBe(coinsOf(id).coins)
        expect(stats.days.at(-1)!.balance).toBe(coinsOf(id).coins)
    })
})
