import { sealSession, type H3Event } from 'h3'
import { describe, expect, it } from 'vitest'
import { DEFAULT_AVATAR, type AvatarLook } from '../shared/cosmetics'
import { PRESENCE_CLOSE, type PresenceServerMessage } from '../shared/floor-presence'
import type { TableOccupancy } from '../shared/tycoon'
import { PRESENCE_LIMITS, createFloorPresence, type PresenceSource } from '../server/utils/floor-presence'
import { authorizeFloorUpgrade, dbPresenceSource, floorPresence } from '../server/utils/floor-socket'
import { SESSION_COOKIE, sessionConfig } from '../server/utils/session'
import { TABLES } from '../server/utils/tables'
import { TableError } from '../server/utils/tables/table'
import { seedPlayer } from './setup/players'

/** A floor of 10×10 open tiles, with (5, 5) blocked; looks come from a map the test can change. */
function fakeSource() {
    const looks = new Map<string, AvatarLook>()
    let gridReads = 0
    const source: PresenceSource = {
        walkable: () => {
            gridReads++
            return (x, y) => x >= 0 && y >= 0 && x < 10 && y < 10 && !(x === 5 && y === 5)
        },
        look: id => looks.get(id) ?? DEFAULT_AVATAR
    }
    return { source, looks, gridReads: () => gridReads }
}

function fakePeer() {
    const inbox: PresenceServerMessage[] = []
    const closed: { code?: number, reason?: string }[] = []
    return {
        inbox,
        closed,
        send: (data: string) => inbox.push(JSON.parse(data)),
        close: (code?: number, reason?: string) => closed.push({ code, reason }),
        last: () => inbox.at(-1)
    }
}

function setup() {
    let clock = 1_000_000
    const fake = fakeSource()
    const presence = createFloorPresence(fake.source, () => clock)
    const join = (playerId: string, casinoId = 'owner') => {
        const peer = fakePeer()
        presence.open(peer, { casinoId, playerId, name: playerId.toUpperCase(), image: null })
        return peer
    }
    return { presence, fake, join, tick: (ms: number) => (clock += ms) }
}

const move = (x: unknown, y: unknown, walk: unknown = true) => JSON.stringify({ t: 'move', x, y, walk })

describe('floor presence rooms', () => {
    it("sends owner news (a visitor's rakeback) to the owner's own tabs in their room only", () => {
        const { presence, join } = setup()
        const guest = join('guest')
        const elsewhere = join('owner', 'other')
        // Nobody to tell yet: the message is not even made.
        let made = 0
        const news = () => {
            made++
            return { t: 'rakeback', amount: 1.5, pot: 3, from: 'GUEST', game: 'dice', at: 1 } as const
        }
        expect(presence.toOwner('owner', news)).toBe(false)
        expect(made).toBe(0)
        const tab1 = join('owner')
        const tab2 = join('owner')
        expect(presence.toOwner('owner', news)).toBe(true)
        expect(made).toBe(1)
        expect(tab1.last()).toEqual({ t: 'rakeback', amount: 1.5, pot: 3, from: 'GUEST', game: 'dice', at: 1 })
        expect(tab2.last()).toEqual({ t: 'rakeback', amount: 1.5, pot: 3, from: 'GUEST', game: 'dice', at: 1 })
        expect(guest.inbox.some(m => m.t === 'rakeback')).toBe(false)
        expect(elsewhere.inbox.some(m => m.t === 'rakeback')).toBe(false)
    })

    it('sends a joiner everyone there, and tells the others who joined', () => {
        const { presence, join } = setup()
        const owner = join('owner')
        expect(owner.inbox).toEqual([{ t: 'snapshot', you: 'owner', members: [] }])
        presence.message(owner, move(3, 4, false))

        const guest = join('guest')
        const snapshot = guest.inbox[0] as Extract<PresenceServerMessage, { t: 'snapshot' }>
        expect(snapshot.t).toBe('snapshot')
        // Late joiners see people where they stand; the owner is flagged.
        expect(snapshot.members).toEqual([expect.objectContaining({ id: 'owner', name: 'OWNER', owner: true, x: 3, y: 4, walk: false })])
        expect(owner.last()).toMatchObject({ t: 'join', member: { id: 'guest', owner: false, x: null, y: null } })
    })

    it('broadcasts a valid move to the others only, and drops junk', () => {
        const { presence, join } = setup()
        const a = join('a')
        const b = join('b')
        const c = join('c')
        const before = { a: a.inbox.length, b: b.inbox.length, c: c.inbox.length }

        presence.message(a, move(2, 7))
        expect(a.inbox.length).toBe(before.a)
        expect(b.last()).toEqual({ t: 'move', id: 'a', x: 2, y: 7, walk: true })
        expect(c.last()).toEqual({ t: 'move', id: 'a', x: 2, y: 7, walk: true })

        const count = b.inbox.length
        for (const junk of [
            move(5, 5), // blocked
            move(-1, 0), move(10, 0), move(0, 10), // off the grid
            move(1.5, 2), move('1', 2), move(null, 2), move(Number.NaN, 2), // not whole tiles
            move(1, 2, 'yes'), // walk must be a boolean
            move(2, 7), // nothing changed
            'not json', '[]', 'null', '42', JSON.stringify({ t: 'teleport', x: 1, y: 1 }),
            JSON.stringify({ t: 'move', x: 1, y: 1, walk: true, pad: 'x'.repeat(PRESENCE_LIMITS.maxMessageBytes) }) // too big
        ]) presence.message(a, junk)
        expect(b.inbox.length).toBe(count)
        expect(presence.members('owner').find(m => m.id === 'a')).toMatchObject({ x: 2, y: 7, walk: true })
    })

    it('rate limits each socket with a token bucket', () => {
        const { presence, join, tick } = setup()
        const a = join('a')
        const b = join('b')
        const start = b.inbox.length
        for (let i = 0; i < 30; i++) presence.message(a, move(i % 2, 0))
        expect(b.inbox.length - start).toBe(PRESENCE_LIMITS.burst)
        tick(1_000)
        for (let i = 0; i < 30; i++) presence.message(a, move(i % 2 ? 3 : 4, 1))
        expect(b.inbox.length - start).toBe(PRESENCE_LIMITS.burst + PRESENCE_LIMITS.rate)
    })

    it('re-reads the look from the source, never from the message', () => {
        const { presence, join, fake } = setup()
        const a = join('a')
        const b = join('b')
        const count = b.inbox.length
        presence.message(a, JSON.stringify({ t: 'look', avatar: { hat: 'crown' } }))
        expect(b.inbox.length).toBe(count) // nothing changed in the profile
        const crowned = { ...DEFAULT_AVATAR, hat: 'crown' }
        fake.looks.set('a', crowned)
        presence.message(a, JSON.stringify({ t: 'look' }))
        expect(b.last()).toEqual({ t: 'look', id: 'a', avatar: crowned })
        expect(join('c').inbox[0]).toMatchObject({ members: expect.arrayContaining([expect.objectContaining({ id: 'a', avatar: crowned })]) })
    })

    it('shares a member between two tabs and leaves when the last one closes', () => {
        const { presence, join } = setup()
        const watcher = join('w')
        const tab1 = join('a')
        const tab2 = join('a')
        expect(watcher.inbox.filter(m => m.t === 'join')).toHaveLength(1)
        expect(presence.members('owner').map(m => m.id).sort()).toEqual(['a', 'w'])
        // Either tab moves the one figure; the other tab doesn't hear its own moves.
        presence.message(tab2, move(1, 1))
        expect(watcher.last()).toMatchObject({ t: 'move', id: 'a', x: 1, y: 1 })
        expect(tab1.inbox.some(m => m.t === 'move')).toBe(false)

        presence.close(tab1)
        expect(watcher.last()?.t).toBe('move')
        presence.close(tab2)
        expect(watcher.last()).toEqual({ t: 'leave', id: 'a' })
        presence.close(tab2) // twice is harmless
        presence.close(watcher)
        expect(presence.roomCount).toBe(0)
        expect(presence.socketCount).toBe(0)
    })

    it('keeps rooms apart', () => {
        const { presence, join } = setup()
        const here = join('a', 'casino-1')
        const there = join('b', 'casino-2')
        presence.message(here, move(1, 1))
        expect(there.inbox.map(m => m.t)).toEqual(['snapshot'])
        expect(presence.roomCount).toBe(2)
    })

    it('caps a room, but its owner always gets in', () => {
        const { presence, join } = setup()
        for (let i = 0; i < PRESENCE_LIMITS.roomCap; i++) join(`p${i}`)
        const late = join('late')
        expect(late.closed).toEqual([{ code: PRESENCE_CLOSE.full, reason: expect.any(String) }])
        expect(late.inbox).toEqual([])
        presence.message(late, move(1, 1)) // ignored: never joined
        expect(presence.members('owner')).toHaveLength(PRESENCE_LIMITS.roomCap)
        // A second tab of someone inside is no new player.
        expect(join('p0').closed).toEqual([])
        const owner = join('owner')
        expect(owner.closed).toEqual([])
        expect(presence.members('owner')).toHaveLength(PRESENCE_LIMITS.roomCap + 1)
    })

    it('reads the walkable grid again after a while', () => {
        const { presence, join, fake, tick } = setup()
        const a = join('a')
        presence.message(a, move(1, 1))
        presence.message(a, move(2, 1))
        expect(fake.gridReads()).toBe(1)
        tick(PRESENCE_LIMITS.gridTtlMs + 1)
        presence.message(a, move(3, 1))
        expect(fake.gridReads()).toBe(2)
    })

    it('sends live table occupancy in snapshot and broadcasts updates across rooms with toAll', () => {
        const fake = fakeSource()
        let tables: TableOccupancy[] = [{ slug: 'blackjack', seated: [], seats: 5, watching: 0 }]
        const presence = createFloorPresence({ ...fake.source, tables: () => tables })
        let made = 0
        const broadcast = () => presence.toAll(() => {
            made++
            return { t: 'tables', tables }
        })
        // Nobody connected: the payload is not even built.
        expect(broadcast()).toBe(0)
        expect(made).toBe(0)

        const a = fakePeer()
        const b = fakePeer()
        presence.open(a, { casinoId: 'casino-1', playerId: 'a', name: 'A', image: null })
        presence.open(b, { casinoId: 'casino-2', playerId: 'b', name: 'B', image: null })
        expect(a.inbox[0]).toEqual({ t: 'snapshot', you: 'a', members: [], tables })

        tables = [{ slug: 'blackjack', seated: [{ name: 'A', image: null }], seats: 5, watching: 1 }]
        expect(broadcast()).toBe(2)
        expect(made).toBe(1)
        expect(a.last()).toEqual({ t: 'tables', tables })
        expect(b.last()).toEqual({ t: 'tables', tables })
    })

    it('reads the walkable grid again at once when the floor changed', () => {
        const { presence, join, fake } = setup()
        const a = join('a')
        presence.message(a, move(1, 1))
        expect(fake.gridReads()).toBe(1)
        presence.invalidate('elsewhere')
        presence.message(a, move(2, 1))
        expect(fake.gridReads()).toBe(1)
        presence.invalidate('owner')
        presence.message(a, move(3, 1))
        expect(fake.gridReads()).toBe(2)
    })
})

describe('floor presence source', () => {
    it('walks the casino\'s own floor: owned zones only, never through a machine', () => {
        const starter = seedPlayer(0, 0, { casino: 'none' })
        const full = seedPlayer(0)
        // A brand-new casino (no profile yet) is the backroom.
        const fresh = dbPresenceSource.walkable(starter)
        expect(fresh(18, 19)).toBe(true) // backroom floor
        expect(fresh(18, 22)).toBe(true) // the porch
        expect(fresh(10, 16)).toBe(false) // main floor, not owned
        expect(fresh(14, 20)).toBe(false) // the builder desk
        expect(fresh(-1, 0)).toBe(false)
        expect(dbPresenceSource.walkable(full)(10, 16)).toBe(true)
        expect(dbPresenceSource.look(full)).toEqual(DEFAULT_AVATAR)
    })

    it('pushes live table seating changes to open floors', () => {
        const owner = seedPlayer(1_000)
        const broke = seedPlayer(0, 0, { casino: 'none' })
        const table = TABLES.blackjack!
        const peer = fakePeer()
        floorPresence.open(peer, { casinoId: owner, playerId: owner, name: 'Owner', image: null })
        try {
            const snapshot = peer.inbox[0] as Extract<PresenceServerMessage, { t: 'snapshot' }>
            expect(snapshot.tables?.find(t => t.slug === 'blackjack')?.seated).toEqual([])

            // A failed sit changes no seat and sends no push.
            const before = peer.inbox.length
            expect(() => table.run(() => table.sit(broke, 'Broke', null, 0))).toThrow(TableError)
            expect(peer.inbox.length).toBe(before)

            table.run(() => table.sit(owner, 'Owner', null, 0))
            const sat = peer.last() as Extract<PresenceServerMessage, { t: 'tables' }>
            expect(sat.t).toBe('tables')
            expect(sat.tables.find(t => t.slug === 'blackjack')?.seated).toEqual([
                { name: 'Owner', image: null, avatar: DEFAULT_AVATAR }
            ])

            table.run(() => table.leave(owner))
            const left = peer.last() as Extract<PresenceServerMessage, { t: 'tables' }>
            expect(left.t).toBe('tables')
            expect(left.tables.find(t => t.slug === 'blackjack')?.seated).toEqual([])
        } finally {
            table.run(() => table.leave(owner))
            floorPresence.close(peer)
        }
    })
})

describe('floor socket auth', () => {
    const origin = 'http://localhost:3200'
    const cookieFor = async (playerId: string) => {
        const event = { context: { sessions: { [SESSION_COOKIE]: { id: 's', createdAt: Date.now(), data: { playerId } } } } }
        return `${SESSION_COOKIE}=${await sealSession(event as unknown as H3Event, sessionConfig())}`
    }
    const upgrade = (headers: Record<string, string>, casinoId: string) =>
        authorizeFloorUpgrade({ url: `${origin}/api/floor/${casinoId}/ws`, headers: new Headers(headers) })
    const status = async (headers: Record<string, string>, casinoId: string) => ((await upgrade(headers, casinoId)) as Response).status

    it('lets a signed-in player into a casino that exists', async () => {
        const owner = seedPlayer(0)
        const visitor = seedPlayer(0)
        expect(await upgrade({ origin, cookie: await cookieFor(visitor) }, owner)).toEqual({ casinoId: owner, playerId: visitor, name: 'Test player', image: null })
    })

    it('refuses a foreign origin, no session, and a casino that does not exist', async () => {
        const owner = seedPlayer(0)
        const cookie = await cookieFor(seedPlayer(0))
        expect(await status({ cookie }, owner)).toBe(403)
        expect(await status({ cookie, origin: 'https://evil.avmg.nl' }, owner)).toBe(403)
        expect(await status({ origin }, owner)).toBe(401)
        expect(await status({ origin, cookie: await cookieFor('nobody') }, owner)).toBe(401)
        expect(await status({ origin, cookie }, seedPlayer(0, 0, { casino: 'none' }))).toBe(404)
        expect(await status({ origin, cookie }, 'bad%20id')).toBe(404)
    })
})
