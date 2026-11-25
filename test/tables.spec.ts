import { and, eq } from 'drizzle-orm'
import { sealSession, type H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../server/database'
import { casinoProfiles, chipTransactions, coinTransactions, dailyMissions, gameRounds, tableWagers } from '../server/database/schema'
import { refundOrphanedWagers, refundWagers, settleWagers, stakeWager, stakeWagers } from '../server/utils/tables/escrow'
import { BaccaratTable } from '../server/utils/tables/baccarat'
import { BlackjackTable } from '../server/utils/tables/blackjack'
import { CasinoHoldemTable } from '../server/utils/tables/casino-holdem'
import { ThreeCardPokerTable } from '../server/utils/tables/three-card-poker'
import type { LiveTable } from '../server/utils/tables/table'
import { authorizeTableUpgrade, closeTableSocket, openTableSocket, tableSocketMessage } from '../server/utils/tables/socket'
import { TABLES } from '../server/utils/tables'
import { SESSION_COOKIE, sessionConfig } from '../server/utils/session'
import { seededRng } from '../shared/rng'
import type { ServerMessage } from '../shared/tables/protocol'
import { sumCoins } from '../shared/money'
import { amsterdamDay } from '../shared/economy'
import { BONUS_MISSION } from '../shared/missions'
import { chipLedgerSum, chipsOf, coinsOf, giveChips, ledgerSum, seedPlayer } from './setup/players'

// Chip balances stay under the first star threshold (10,000), so no test talks to the hub.
const START = 9_000

const openRows = (playerId: string) => db.select().from(tableWagers).where(and(eq(tableWagers.playerId, playerId), eq(tableWagers.status, 'open'))).all()
const rounds = (playerId: string) => db.select().from(gameRounds).where(eq(gameRounds.playerId, playerId)).all()

function stakeOne(playerId: string, amount: number, game = 'baccarat') {
    return stakeWager({ playerId, game, roundId: 1, amount, kind: 'bet' }).value
}

describe('table escrow', () => {
    it('debits a stake and opens its row in one transaction; refuses what the player cannot cover', () => {
        const id = seedPlayer(START)
        const { wagerId, balance } = stakeOne(id, 1_000)
        expect(balance).toBe(START - 1_000)
        expect(openRows(id).map(row => row.id)).toEqual([wagerId])
        expect(() => stakeOne(id, 10_000)).toThrow(expect.objectContaining({ statusCode: 400 }))
        // All or nothing: the second stake can't be covered, so neither lands.
        expect(() => stakeWagers(id, 'baccarat', 1, [{ amount: 100, kind: 'player' }, { amount: 9_000, kind: 'tie' }])).toThrow()
        expect(coinsOf(id).coins).toBe(START - 1_000)
        expect(openRows(id)).toHaveLength(1)
    })

    it('settles a round once: a second settle of the same rows pays nothing', () => {
        const id = seedPlayer(START)
        const { wagerIds } = stakeWagers(id, 'baccarat', 1, [{ amount: 100, kind: 'player' }, { amount: 200, kind: 'banker' }]).value
        const input = { playerId: id, game: 'baccarat', wagerIds, staked: 300, payout: 490, summary: {} }
        // The stake was coins; the whole payout comes as chips, and the 1% rakeback on the 300 staked goes into the cage.
        expect(settleWagers(input).value).toEqual({ kind: 'settled', balance: START - 300, chips: 490, chipsEarned: 490, rakeback: 3, rakebackPot: 3 })
        expect(settleWagers(input).value).toEqual({ kind: 'closed' })
        expect(coinsOf(id).coins).toBe(START - 300)
        expect(ledgerSum(id)).toBe(-300)
        expect(chipsOf(id)).toBe(490)
        expect(chipLedgerSum(id)).toBe(490)
        expect(openRows(id)).toHaveLength(0)
        expect(rounds(id)).toMatchObject([{ game: 'baccarat', stake: 300, payout: 490, funding: 'coins' }])
    })

    it('settles decimal stakes and payouts to 0.0001 coin, matching the escrow without float noise', () => {
        const id = seedPlayer(START)
        const { wagerIds } = stakeWagers(id, 'baccarat', 1, [{ amount: 0.1, kind: 'banker' }, { amount: 0.2, kind: 'player' }, { amount: 50, kind: 'tie' }]).value
        // 0.1 + 0.2 + 50 in floats is 50.300000000000004: still the same escrow.
        const result = settleWagers({ playerId: id, game: 'baccarat', wagerIds, staked: 0.1 + 0.2 + 50, payout: 97.5, summary: {} }).value
        // Rakeback (into the cage): 1% of 50.3 is 0.503.
        expect(result).toMatchObject({ kind: 'settled', balance: START - 50.3, chips: 97.5, rakeback: 0.503 })
        expect(coinsOf(id).coins).toBe(START - 50.3)
        expect(ledgerSum(id)).toBe(-50.3)
        expect(chipsOf(id)).toBe(97.5)
        expect(() => settleWagers({ playerId: id, game: 'baccarat', wagerIds: [], staked: 0, payout: 1.23456, summary: {} })).toThrow('4 decimals')
    })

    it('stakes coins first, then chips for the rest, records the chip part and pays chips', () => {
        const id = seedPlayer(300)
        giveChips(id, 5_000)
        const { wagerIds, balance, chips } = stakeWagers(id, 'blackjack', 1, [{ amount: 500, kind: 'bet' }, { amount: 400, kind: 'pairs' }]).value
        // 300 coins cover part of the first stake; chips pay the rest of both.
        expect({ balance, chips }).toEqual({ balance: 0, chips: 4_400 })
        expect(openRows(id).map(row => [row.amount, row.amountChips]).sort()).toEqual([[400, 400], [500, 200]])
        expect(() => stakeWagers(id, 'blackjack', 1, [{ amount: 5_000, kind: 'double' }])).toThrow(expect.objectContaining({ statusMessage: 'Not enough coins or chips' }))
        expect(settleWagers({ playerId: id, game: 'blackjack', wagerIds, staked: 900, payout: 1_800, summary: {} }).value)
            .toEqual({ kind: 'settled', balance: 0, chips: 6_200, chipsEarned: 1_800, rakeback: 9, rakebackPot: 9 })
        expect(rounds(id)).toMatchObject([{ stake: 900, stakeChips: 600, payout: 1_800, funding: 'coins' }])
        const reasons = db.select({ reason: chipTransactions.reason }).from(chipTransactions).where(eq(chipTransactions.playerId, id)).all().map(row => row.reason)
        expect(reasons).toEqual(['bet:blackjack', 'bet:blackjack', 'win:blackjack'])
    })

    it('stakes chips alone once the coins are gone, and refunds each part in its own currency', async () => {
        const id = seedPlayer(250)
        giveChips(id, 1_000)
        stakeOne(id, 300, 'three-card-poker')
        stakeOne(id, 200, 'three-card-poker')
        expect([coinsOf(id).coins, chipsOf(id)]).toEqual([0, 750])
        expect(openRows(id).map(row => row.amountChips).sort()).toEqual([200, 50])
        await refundOrphanedWagers()
        expect([coinsOf(id).coins, chipsOf(id)]).toEqual([250, 1_000])
        expect(openRows(id)).toHaveLength(0)
        expect(ledgerSum(id)).toBe(0)
        expect(chipLedgerSum(id)).toBe(0)
    })

    it('never lets a burst of stakes spend more than coins and chips together', () => {
        const id = seedPlayer(450)
        giveChips(id, 550)
        let landed = 0
        for (let i = 0; i < 20; i++) {
            try {
                stakeOne(id, 100, 'baccarat')
                landed++
            } catch { /* over the bankroll */ }
        }
        expect(landed).toBe(10)
        expect([coinsOf(id).coins, chipsOf(id)]).toEqual([0, 0])
        expect(ledgerSum(id)).toBe(-450)
        expect(chipLedgerSum(id)).toBe(-550)
    })

    it('refunds instead of paying when part of the round was already closed', () => {
        const id = seedPlayer(START)
        const { wagerIds } = stakeWagers(id, 'blackjack', 1, [{ amount: 100, kind: 'bet' }, { amount: 100, kind: 'double' }]).value
        refundWagers(id, 'blackjack', [wagerIds[1]!])
        const result = settleWagers({ playerId: id, game: 'blackjack', wagerIds, staked: 200, payout: 400, summary: {} }).value
        expect(result).toMatchObject({ kind: 'refunded', refunded: 100 })
        expect(coinsOf(id).coins).toBe(START)
        expect(rounds(id)).toHaveLength(0)
        // A refund returns the stake: no rakeback on it.
        expect(chipsOf(id)).toBe(0)
        expect(chipLedgerSum(id)).toBe(0)
    })

    it('refuses to settle when the payout and the escrow disagree', () => {
        const id = seedPlayer(START)
        const { wagerIds } = stakeWagers(id, 'blackjack', 1, [{ amount: 100, kind: 'bet' }]).value
        const result = settleWagers({ playerId: id, game: 'blackjack', wagerIds, staked: 500, payout: 1_000, summary: {} }).value
        expect(result).toMatchObject({ kind: 'refunded', refunded: 100 })
        expect(coinsOf(id).coins).toBe(START)
    })

    it('refunds every open stake left by a restart, once, flagged as a refund', async () => {
        const id = seedPlayer(START)
        stakeOne(id, 300, 'three-card-poker')
        stakeOne(id, 200, 'casino-holdem')
        expect(coinsOf(id).coins).toBe(START - 500)
        // Earlier tests in this file leave open rows too: the sweep takes them all.
        expect(await refundOrphanedWagers()).toBeGreaterThanOrEqual(2)
        expect(await refundOrphanedWagers()).toBe(0)
        expect(coinsOf(id).coins).toBe(START)
        const refunds = db.select().from(coinTransactions).where(and(eq(coinTransactions.playerId, id), eq(coinTransactions.type, 'credit'))).all()
        expect(refunds.map(row => [row.category, row.refund]).sort()).toEqual([['casino-holdem', true], ['three-card-poker', true]])
    })

    it('leaves stakes a live table still holds to the table', async () => {
        const id = seedPlayer(START)
        const held = stakeOne(id, 300)
        const orphan = stakeOne(id, 200)
        await refundOrphanedWagers({ held: new Set([held.wagerId]) })
        expect(openRows(id).map(row => row.id)).toEqual([held.wagerId])
        expect(coinsOf(id).coins).toBe(START - 300)
        expect(orphan.wagerId).not.toBe(held.wagerId)
    })
})

// ─── table flows ─────────────────────────────────────────────────────────────

type AnyTable = LiveTable<unknown, unknown, unknown>

function seat(table: AnyTable, index: number, coins = START, chips = 0) {
    const id = seedPlayer(coins)
    if (chips) giveChips(id, chips)
    const inbox: ServerMessage[] = []
    const peer = { send: (data: string) => inbox.push(JSON.parse(data)) }
    openTableSocket(peer, { slug: table.config.slug, playerId: id, name: `P${index}`, image: null }, table)
    table.run(() => table.sit(id, `P${index}`, null, index))
    return { id, peer, inbox, act: (action: unknown) => table.run(() => table.action(id, action)) }
}

/** Every round settled: coin stakes left the coins, every payout came as chips. */
function settledCorrectly(id: string) {
    expect(openRows(id)).toHaveLength(0)
    const staked = sumCoins(rounds(id).filter(round => round.funding === 'coins').map(round => round.stake))
    const paid = sumCoins(rounds(id).map(round => round.payout))
    expect(coinsOf(id).coins).toBe(START - staked)
    expect(ledgerSum(id)).toBe(-staked)
    expect(chipLedgerSum(id)).toBe(paid)
}

describe('live tables', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('baccarat: two players bet, the hand deals and both settle once', () => {
        const table = new BaccaratTable(seededRng(11)) as unknown as AnyTable
        const a = seat(table, 0)
        const b = seat(table, 1)
        a.act({ t: 'bet', spot: 'banker', amount: 1_000 })
        a.act({ t: 'bet', spot: 'tie', amount: 100 })
        b.act({ t: 'bet', spot: 'player', amount: 500 })
        expect(coinsOf(a.id).coins).toBe(START)
        vi.advanceTimersByTime(15_000)
        expect(coinsOf(a.id).coins).toBe(START - 1_100)
        expect(coinsOf(b.id).coins).toBe(START - 500)
        vi.advanceTimersByTime(4_000 + 2_500)
        settledCorrectly(a.id)
        settledCorrectly(b.id)
        expect(rounds(a.id)).toMatchObject([{ stake: 1_100 }])
        expect(a.inbox.some(m => m.t === 'balance')).toBe(true)
        // Betting reopens for the next round.
        vi.advanceTimersByTime(3_500)
        expect(table.snapshot(a.id).phase).toBe('betting')
    })

    it('three card poker: a player who drops mid-hand folds on the clock and is still settled', () => {
        const table = new ThreeCardPokerTable(seededRng(5)) as unknown as AnyTable
        const a = seat(table, 2)
        a.act({ t: 'bet', spot: 'ante', amount: 500 })
        a.act({ t: 'bet', spot: 'pairPlus', amount: 100 })
        // Every seat has an ante down: betting is cut to 3 seconds.
        vi.advanceTimersByTime(3_000)
        expect(coinsOf(a.id).coins).toBe(START - 600)
        closeTableSocket(a.peer)
        vi.advanceTimersByTime(1_800 + 700 + 1_500)
        settledCorrectly(a.id)
        expect(rounds(a.id)).toMatchObject([{ stake: 600, summary: expect.objectContaining({ decision: 'fold' }) }])
    })

    it("three card poker: other seats' cards stay face down until the showdown", () => {
        const table = new ThreeCardPokerTable(seededRng(9)) as unknown as AnyTable
        const a = seat(table, 0)
        const b = seat(table, 1)
        a.act({ t: 'bet', spot: 'ante', amount: 100 })
        b.act({ t: 'bet', spot: 'ante', amount: 100 })
        vi.advanceTimersByTime(3_000 + 1_800)
        const seen = table.snapshot(a.id) as { seats: { game: { cards: { rank?: string }[] } }[], game: { dealer: { cards: { rank?: string }[] } } }
        expect(seen.seats[0]!.game.cards.every(c => c.rank)).toBe(true)
        expect(seen.seats[1]!.game.cards.every(c => !c.rank)).toBe(true)
        expect(seen.game.dealer.cards.every(c => !c.rank)).toBe(true)
        a.act({ t: 'decide', play: true })
        // A second decision (a double click, a replayed frame) is refused and stakes nothing.
        expect(() => a.act({ t: 'decide', play: true })).toThrow('You already decided')
        expect(coinsOf(a.id).coins).toBe(START - 200)
        b.act({ t: 'decide', play: false })
        vi.advanceTimersByTime(700)
        const shown = table.snapshot(a.id) as typeof seen
        expect(shown.seats[1]!.game.cards.every(c => c.rank)).toBe(true)
        vi.advanceTimersByTime(1_500)
        settledCorrectly(a.id)
        settledCorrectly(b.id)
    })

    it('blackjack: a burst of chips stops at the balance, a dropped player stands on the clock and is settled', () => {
        const table = new BlackjackTable(seededRng(3)) as unknown as AnyTable
        const a = seat(table, 0, START)
        for (let i = 0; i < 20; i++) {
            try {
                a.act({ t: 'bet', spot: 'main', amount: 1_000 })
            } catch { /* over the balance */ }
        }
        expect((table.snapshot(a.id) as { seats: { game: { pendingBet: number } }[] }).seats[0]!.game.pendingBet).toBe(9_000)
        a.act({ t: 'clear' })
        a.act({ t: 'bet', spot: 'main', amount: 1_000 })
        a.act({ t: 'bet', spot: 'perfectPairs', amount: 100 })
        table.run(() => table.voteStart(a.id))
        expect(coinsOf(a.id).coins).toBe(START - 1_100)
        closeTableSocket(a.peer)
        // Dealing, maybe insurance, every hand standing on a short clock, the dealer, the payout.
        vi.advanceTimersByTime(60_000)
        settledCorrectly(a.id)
        expect(rounds(a.id)).toHaveLength(1)
    })

    it("casino hold'em: calls stake once, an abandoned round refunds every stake", () => {
        const table = new CasinoHoldemTable(seededRng(21)) as unknown as AnyTable
        const a = seat(table, 0)
        a.act({ t: 'bet', spot: 'ante', amount: 1_000 })
        a.act({ t: 'bet', spot: 'aa', amount: 500 })
        expect(() => a.act({ t: 'bet', spot: 'aa', amount: 1_000 })).toThrow('exceed your ante')
        vi.advanceTimersByTime(3_000 + 2_400)
        a.act({ t: 'decide', call: true })
        expect(() => a.act({ t: 'decide', call: true })).toThrow('You already decided')
        expect(coinsOf(a.id).coins).toBe(START - 3_500)
        table.run(() => table.abortRound())
        expect(coinsOf(a.id).coins).toBe(START)
        expect(openRows(a.id)).toHaveLength(0)
        const refund = db.select().from(coinTransactions).where(and(eq(coinTransactions.playerId, a.id), eq(coinTransactions.type, 'credit'))).all()
        expect(refund).toMatchObject([{ amount: 3_500, refund: true, category: 'casino-holdem' }])
    })

    it("casino hold'em: a full hand settles", () => {
        const table = new CasinoHoldemTable(seededRng(8)) as unknown as AnyTable
        const a = seat(table, 1)
        a.act({ t: 'bet', spot: 'ante', amount: 500 })
        vi.advanceTimersByTime(3_000 + 2_400)
        a.act({ t: 'decide', call: true })
        vi.advanceTimersByTime(700 + 2_600 + 1_500)
        settledCorrectly(a.id)
        expect(rounds(a.id)).toMatchObject([{ stake: 1_500 }])
    })
})

describe('live tables with chips', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('stakes coins first, then chips, pays chips and pushes both balances', () => {
        const table = new BaccaratTable(seededRng(4)) as unknown as AnyTable
        const a = seat(table, 0, 400, 5_000)
        // A currency field from an older client is ignored.
        a.act({ t: 'bet', spot: 'banker', amount: 1_000, currency: 'coins' })
        vi.advanceTimersByTime(15_000)
        expect(coinsOf(a.id).coins).toBe(0)
        expect(chipsOf(a.id)).toBe(4_400)
        expect(openRows(a.id)).toMatchObject([{ amount: 1_000, amountChips: 600 }])
        expect(a.inbox.filter(m => m.t === 'balance').at(-1)).toEqual({ t: 'balance', balance: 0, chips: 4_400 })
        vi.advanceTimersByTime(4_000 + 2_500)
        const [round] = rounds(a.id)
        expect(round).toMatchObject({ stake: 1_000, stakeChips: 600 })
        // The payout in chips; the 1% rakeback (10 on 1,000) goes into the cage and the pot comes with the balance.
        expect(chipsOf(a.id)).toBe(4_400 + round!.payout)
        expect(a.inbox.filter(m => m.t === 'balance').at(-1)).toEqual({ t: 'balance', balance: 0, chips: 4_400 + round!.payout, rakebackPot: 10 })
    })

    it('an abandoned round hands each part back in its own currency', () => {
        const table = new CasinoHoldemTable(seededRng(21)) as unknown as AnyTable
        const a = seat(table, 0, 1_500, 5_000)
        a.act({ t: 'bet', spot: 'ante', amount: 1_000 })
        vi.advanceTimersByTime(3_000 + 2_400)
        // The call (2× the ante) takes the last 500 coins, then 1,500 chips.
        a.act({ t: 'decide', call: true })
        expect([coinsOf(a.id).coins, chipsOf(a.id)]).toEqual([0, 3_500])
        table.run(() => table.abortRound())
        expect([coinsOf(a.id).coins, chipsOf(a.id)]).toEqual([1_500, 5_000])
        expect(openRows(a.id)).toHaveLength(0)
    })

    it('seats a player whose coins and chips together cover the table, and refuses one without', () => {
        const table = new BlackjackTable(seededRng(2)) as unknown as AnyTable
        const mixed = seedPlayer(60)
        giveChips(mixed, 40)
        table.run(() => table.sit(mixed, 'Mixed', null, 0))
        expect(table.seatIndexOf(mixed)).toBe(0)
        const broke = seedPlayer(50)
        giveChips(broke, 40)
        expect(() => table.run(() => table.sit(broke, 'Broke', null, 1))).toThrow('coins or chips to sit')
        table.run(() => table.leave(mixed))
    })

    it('seats a visitor at the host\'s table: their casino is made, the win pays and the hand counts as a visit', () => {
        const host = seedPlayer(0)
        // Never opened their own casino, and has nothing built.
        const visitor = seedPlayer(START, START, { casino: 'none' })
        const day = amsterdamDay(new Date())
        db.insert(dailyMissions).values([
            { playerId: visitor, day, mission: 'visit', slot: 0, target: 3, reward: 500 },
            { playerId: visitor, day, mission: 'table-hands', slot: 1, target: 5, reward: 500 },
            { playerId: visitor, day, mission: 'collects', slot: 2, target: 2, reward: 500 },
            { playerId: visitor, day, mission: BONUS_MISSION, slot: 3, target: 3, reward: 1_000 }
        ]).run()
        const table = new BaccaratTable(seededRng(11)) as unknown as AnyTable
        openTableSocket({ send: () => {} }, { slug: table.config.slug, playerId: visitor, name: 'V', image: null }, table)
        expect(() => table.run(() => table.sit(visitor, 'V', null, 0))).toThrow('Build')
        table.run(() => table.sit(visitor, 'V', null, 0, host))
        expect(db.select().from(casinoProfiles).where(eq(casinoProfiles.playerId, visitor)).get()).toBeTruthy()
        table.run(() => table.action(visitor, { t: 'bet', spot: 'banker', amount: 1_000 }))
        table.run(() => table.action(visitor, { t: 'bet', spot: 'player', amount: 1_000 }))
        vi.advanceTimersByTime(15_000 + 4_000 + 2_500)

        // Settled, not refunded: one of banker and player wins (or a tie pushes), paid in chips.
        expect(openRows(visitor)).toHaveLength(0)
        const [round] = rounds(visitor)
        expect(round).toMatchObject({ stake: 2_000 })
        expect(round!.payout).toBeGreaterThan(0)
        expect(chipsOf(visitor)).toBe(round!.payout)
        expect(db.select().from(coinTransactions).where(and(eq(coinTransactions.playerId, visitor), eq(coinTransactions.refund, true))).all()).toHaveLength(0)
        const progress = (mission: string) => db.select({ progress: dailyMissions.progress }).from(dailyMissions)
            .where(and(eq(dailyMissions.playerId, visitor), eq(dailyMissions.day, day), eq(dailyMissions.mission, mission))).get()!.progress
        expect(progress('visit')).toBe(1)
        expect(progress('table-hands')).toBe(1)
        table.run(() => table.leave(visitor))
    })

    it('does not count a hand at a table of your own as a visit', () => {
        const owner = seedPlayer(START)
        const day = amsterdamDay(new Date())
        db.insert(dailyMissions).values([
            { playerId: owner, day, mission: 'visit', slot: 0, target: 3, reward: 500 },
            { playerId: owner, day, mission: BONUS_MISSION, slot: 3, target: 1, reward: 1_000 }
        ]).run()
        const table = new BaccaratTable(seededRng(11)) as unknown as AnyTable
        openTableSocket({ send: () => {} }, { slug: table.config.slug, playerId: owner, name: 'O', image: null }, table)
        // Naming yourself as the host is no visit.
        table.run(() => table.sit(owner, 'O', null, 0, owner))
        table.run(() => table.action(owner, { t: 'bet', spot: 'banker', amount: 1_000 }))
        vi.advanceTimersByTime(15_000 + 4_000 + 2_500)
        expect(rounds(owner)).toHaveLength(1)
        expect(db.select({ progress: dailyMissions.progress }).from(dailyMissions)
            .where(and(eq(dailyMissions.playerId, owner), eq(dailyMissions.mission, 'visit'))).get()!.progress).toBe(0)
        table.run(() => table.leave(owner))
    })
})

// ─── socket auth ─────────────────────────────────────────────────────────────

async function sessionCookieFor(playerId: string) {
    const event = { context: { sessions: { [SESSION_COOKIE]: { id: 's', createdAt: Date.now(), data: { playerId } } } } }
    return `${SESSION_COOKIE}=${await sealSession(event as unknown as H3Event, sessionConfig())}`
}

const upgrade = (headers: Record<string, string>, path = '/api/tables/blackjack/ws') =>
    authorizeTableUpgrade({ url: `http://localhost:3200${path}`, headers: new Headers(headers) })

describe('table socket auth', () => {
    const origin = 'http://localhost:3200'

    it('accepts the casino page with a valid session', async () => {
        const id = seedPlayer(START)
        const result = await upgrade({ origin, cookie: await sessionCookieFor(id) })
        expect(result).toEqual({ slug: 'blackjack', playerId: id, name: 'Test player', image: null })
    })

    it('refuses a foreign or missing Origin, even with a valid cookie', async () => {
        const cookie = await sessionCookieFor(seedPlayer(START))
        for (const headers of <Record<string, string>[]>[{ cookie }, { cookie, origin: 'https://evil.avmg.nl' }, { cookie, origin: 'http://localhost:3200.evil.test' }, { cookie, origin: 'null' }]) {
            const result = await upgrade(headers)
            expect(result).toBeInstanceOf(Response)
            expect((result as Response).status).toBe(403)
        }
    })

    it('refuses a missing, forged or expired session, and an unknown table', async () => {
        const id = seedPlayer(START)
        const status = async (headers: Record<string, string>, path?: string) => ((await upgrade({ origin, ...headers }, path)) as Response).status
        expect(await status({})).toBe(401)
        expect(await status({ cookie: `${SESSION_COOKIE}=forged` })).toBe(401)
        expect(await status({ cookie: await sessionCookieFor('nobody') })).toBe(401)
        const old = { context: { sessions: { [SESSION_COOKIE]: { id: 's', createdAt: Date.now() - 31 * 86_400_000, data: { playerId: id } } } } }
        expect(await status({ cookie: `${SESSION_COOKIE}=${await sealSession(old as unknown as H3Event, sessionConfig())}` })).toBe(401)
        expect(await status({ cookie: await sessionCookieFor(id) }, '/api/tables/roulette/ws')).toBe(404)
    })

    it('runs messages through the table and answers bad ones with an error', async () => {
        const id = seedPlayer(START)
        const inbox: ServerMessage[] = []
        const peer = { send: (data: string) => inbox.push(JSON.parse(data)) }
        openTableSocket(peer, { slug: 'baccarat', playerId: id, name: 'Sam', image: null })
        expect(inbox[0]).toMatchObject({ t: 'you', playerId: id, seat: null, balance: START, chips: 0 })
        tableSocketMessage(peer, JSON.stringify({ t: 'action', action: { t: 'bet', spot: 'player', amount: 100 } }))
        expect(inbox.at(-1)).toMatchObject({ t: 'error', message: 'Take a seat first' })
        tableSocketMessage(peer, JSON.stringify({ t: 'sit', seat: 4 }))
        tableSocketMessage(peer, JSON.stringify({ t: 'action', action: { t: 'bet', spot: 'player', amount: 123 } }))
        expect(inbox.at(-1)).toMatchObject({ t: 'error', message: 'Invalid chip' })
        tableSocketMessage(peer, 'not json')
        const state = inbox.filter(m => m.t === 'state').at(-1) as Extract<ServerMessage, { t: 'state' }>
        expect(state.state.seats[4]).toMatchObject({ playerId: id, name: 'Sam' })
        closeTableSocket(peer)
        TABLES.baccarat!.run(() => TABLES.baccarat!.leave(id))
        expect(TABLES.baccarat!.seatIndexOf(id)).toBeNull()
    })
})
