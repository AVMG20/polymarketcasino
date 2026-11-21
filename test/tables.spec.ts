import { and, eq } from 'drizzle-orm'
import { sealSession, type H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../server/database'
import { coinTransactions, gameRounds, tableWagers } from '../server/database/schema'
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
import { coinsOf, ledgerSum, seedPlayer } from './setup/players'

// Balances stay under the first star threshold (10,000), so no test talks to the hub.
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
        expect(settleWagers(input).value).toEqual({ kind: 'settled', balance: START - 300 + 490 })
        expect(settleWagers(input).value).toEqual({ kind: 'closed' })
        expect(coinsOf(id).coins).toBe(START + 190)
        expect(ledgerSum(id)).toBe(190)
        expect(openRows(id)).toHaveLength(0)
        expect(rounds(id)).toMatchObject([{ game: 'baccarat', stake: 300, payout: 490 }])
    })

    it('refunds instead of paying when part of the round was already closed', () => {
        const id = seedPlayer(START)
        const { wagerIds } = stakeWagers(id, 'blackjack', 1, [{ amount: 100, kind: 'bet' }, { amount: 100, kind: 'double' }]).value
        refundWagers(id, 'blackjack', [wagerIds[1]!])
        const result = settleWagers({ playerId: id, game: 'blackjack', wagerIds, staked: 200, payout: 400, summary: {} }).value
        expect(result).toMatchObject({ kind: 'refunded', refunded: 100 })
        expect(coinsOf(id).coins).toBe(START)
        expect(rounds(id)).toHaveLength(0)
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

function seat(table: AnyTable, index: number, coins = START) {
    const id = seedPlayer(coins)
    const inbox: ServerMessage[] = []
    const peer = { send: (data: string) => inbox.push(JSON.parse(data)) }
    openTableSocket(peer, { slug: table.config.slug, playerId: id, name: `P${index}`, image: null }, table)
    table.run(() => table.sit(id, `P${index}`, null, index))
    return { id, peer, inbox, act: (action: unknown) => table.run(() => table.action(id, action)) }
}

function settledCorrectly(id: string) {
    expect(openRows(id)).toHaveLength(0)
    const net = rounds(id).reduce((sum, round) => sum + round.payout - round.stake, 0)
    expect(coinsOf(id).coins).toBe(START + net)
    expect(ledgerSum(id)).toBe(net)
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
        expect(inbox[0]).toMatchObject({ t: 'you', playerId: id, seat: null, balance: START })
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
