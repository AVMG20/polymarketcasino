import type { AvatarLook } from '#shared/cosmetics'
import { PRESENCE_CLOSE, type PresenceMember, type PresenceServerMessage } from '#shared/floor-presence'
import type { TableOccupancy } from '#shared/tycoon'
import { takeToken, type TokenBucket } from './rate-limit'

/**
 * Who walks around each casino floor right now: one in-memory room per casino
 * (the app runs as one process), keyed by its owner's player id. Pure: the
 * walkable tiles and the avatars come from a PresenceSource, so tests can run
 * it without sockets or a database. Nothing here moves money or writes.
 *
 * - A player is one member per room. A second tab shares the member (both
 *   tabs get the room's news, either one moves the figure); the member leaves
 *   when its last tab closes.
 * - A room takes ROOM_CAP players; the casino's owner always gets in.
 * - Messages are typed and checked: a move names a whole tile inside the grid
 *   that is walkable on this casino's floor; anything else is dropped. Each
 *   socket has a small token bucket and a size cap.
 */

/** What the room needs from a socket: crossws peers fit, and so do test fakes. */
export interface PresencePeer {
    send(data: string): unknown
    close(code?: number, reason?: string): unknown
}

export interface PresenceSource {
    /** The casino's walkable tiles now (owned zones and furniture decide them). */
    walkable(casinoId: string): (x: number, y: number) => boolean
    /** A player's avatar, read from their profile (never from the client). */
    look(playerId: string): AvatarLook
    /** Live table seating, sent once on join. */
    tables?(): TableOccupancy[]
}

/** Who opens a socket into which room (from the upgrade hook). */
export interface PresenceContext {
    casinoId: string
    playerId: string
    name: string
    image: string | null
}

const ROOM_CAP = 40
const MAX_MESSAGE_BYTES = 256
/** Per socket: a burst of this many messages, refilled at RATE per second (a click to walk is one). */
const BURST = 12
const RATE = 4
/** How long a room trusts its walkable tiles before reading the casino again (a zone opened, decor added). */
const GRID_TTL_MS = 15_000

export const PRESENCE_LIMITS = { roomCap: ROOM_CAP, maxMessageBytes: MAX_MESSAGE_BYTES, burst: BURST, rate: RATE, gridTtlMs: GRID_TTL_MS } as const

interface Member {
    id: string
    name: string
    image: string | null
    avatar: AvatarLook
    owner: boolean
    x: number | null
    y: number | null
    walk: boolean
    peers: Set<PresencePeer>
}

interface Room {
    id: string
    members: Map<string, Member>
    walkable: ((x: number, y: number) => boolean) | null
    walkableAt: number
}

interface PeerState extends TokenBucket {
    room: Room
    playerId: string
}

function view(member: Member): PresenceMember {
    return { id: member.id, name: member.name, image: member.image, avatar: member.avatar, owner: member.owner, x: member.x, y: member.y, walk: member.walk }
}

function write(peer: PresencePeer, payload: string) {
    try {
        peer.send(payload)
    } catch {
        // A dead socket: its close handler takes it out of the room.
    }
}

function sameLook(a: AvatarLook, b: AvatarLook): boolean {
    return a.hat === b.hat && a.outfit === b.outfit && a.accessory === b.accessory && a.hair === b.hair && a.haircolor === b.haircolor && a.skintone === b.skintone
}

export function createFloorPresence(source: PresenceSource, now: () => number = Date.now) {
    const rooms = new Map<string, Room>()
    const peers = new Map<PresencePeer, PeerState>()

    /** Everyone in the room but `except`'s own tabs. */
    function broadcast(room: Room, except: string, message: PresenceServerMessage) {
        const payload = JSON.stringify(message)
        for (const member of room.members.values()) {
            if (member.id === except) continue
            for (const peer of member.peers) write(peer, payload)
        }
    }

    function walkable(room: Room, x: number, y: number): boolean {
        const at = now()
        if (!room.walkable || at - room.walkableAt > GRID_TTL_MS) {
            room.walkable = source.walkable(room.id)
            room.walkableAt = at
        }
        return room.walkable(x, y)
    }

    /** Join a room. Returns false (and closes the socket) when the room is full. */
    function open(peer: PresencePeer, context: PresenceContext): boolean {
        let room = rooms.get(context.casinoId)
        let member = room?.members.get(context.playerId)
        if (!member && room && room.members.size >= ROOM_CAP && context.playerId !== context.casinoId) {
            peer.close(PRESENCE_CLOSE.full, 'This casino is full')
            return false
        }
        if (!room) {
            room = { id: context.casinoId, members: new Map(), walkable: null, walkableAt: 0 }
            rooms.set(room.id, room)
        }
        peers.set(peer, { room, playerId: context.playerId, tokens: BURST, refilledAt: now() })
        if (member) {
            member.peers.add(peer)
        } else {
            member = {
                id: context.playerId,
                name: context.name,
                image: context.image,
                avatar: source.look(context.playerId),
                owner: context.playerId === context.casinoId,
                x: null,
                y: null,
                walk: false,
                peers: new Set([peer])
            }
            room.members.set(member.id, member)
            broadcast(room, member.id, { t: 'join', member: view(member) })
        }
        const others = [...room.members.values()].filter(m => m.id !== context.playerId).map(view)
        const tables = source.tables?.()
        write(peer, JSON.stringify({ t: 'snapshot', you: context.playerId, members: others, ...(tables ? { tables } : {}) } satisfies PresenceServerMessage))
        return true
    }

    function message(peer: PresencePeer, text: string) {
        const state = peers.get(peer)
        if (!state || typeof text !== 'string' || text.length > MAX_MESSAGE_BYTES || !takeToken(state, BURST, RATE, now())) return
        let input: unknown
        try {
            input = JSON.parse(text)
        } catch {
            return
        }
        if (!input || typeof input !== 'object' || Array.isArray(input)) return
        const msg = input as Record<string, unknown>
        const { room, playerId } = state
        const member = room.members.get(playerId)
        if (!member) return
        if (msg.t === 'move') {
            const { x, y, walk } = msg
            if (!Number.isInteger(x) || !Number.isInteger(y) || typeof walk !== 'boolean') return
            if (!walkable(room, x as number, y as number)) return
            if (member.x === x && member.y === y && member.walk === walk) return
            member.x = x as number
            member.y = y as number
            member.walk = walk
            broadcast(room, playerId, { t: 'move', id: playerId, x: member.x, y: member.y, walk })
        } else if (msg.t === 'look') {
            const avatar = source.look(playerId)
            if (sameLook(avatar, member.avatar)) return
            member.avatar = avatar
            broadcast(room, playerId, { t: 'look', id: playerId, avatar })
        }
    }

    /** A socket closed: only the player's last tab leaving counts. */
    function close(peer: PresencePeer) {
        const state = peers.get(peer)
        if (!state) return
        peers.delete(peer)
        const { room, playerId } = state
        const member = room.members.get(playerId)
        if (member) {
            member.peers.delete(peer)
            if (!member.peers.size) {
                room.members.delete(playerId)
                broadcast(room, playerId, { t: 'leave', id: playerId })
            }
        }
        if (!room.members.size) rooms.delete(room.id)
    }

    return {
        open,
        message,
        close,
        /** Read the casino's walkable tiles again on the next move (something was built, placed or put away). */
        invalidate(casinoId: string) {
            const room = rooms.get(casinoId)
            if (room) room.walkable = null
        },
        /**
         * Send `message` to the casino owner's own sockets in their room (display
         * news, like a visitor's rakeback). `make` runs only when the owner is
         * there. Returns whether anyone got it.
         */
        toOwner(casinoId: string, make: () => PresenceServerMessage | null): boolean {
            const owner = rooms.get(casinoId)?.members.get(casinoId)
            if (!owner?.peers.size) return false
            const message = make()
            if (!message) return false
            const payload = JSON.stringify(message)
            for (const peer of owner.peers) write(peer, payload)
            return true
        },
        /**
         * Send `message` to every open floor socket (e.g. live table seating
         * changed). `make` runs only when at least one socket is open. Returns
         * how many sockets got it.
         */
        toAll(make: () => PresenceServerMessage | null): number {
            if (!peers.size) return 0
            const message = make()
            if (!message) return 0
            const payload = JSON.stringify(message)
            for (const peer of peers.keys()) write(peer, payload)
            return peers.size
        },
        /** The players in a casino's room now (tests, diagnostics). */
        members(casinoId: string): PresenceMember[] {
            return [...(rooms.get(casinoId)?.members.values() ?? [])].map(view)
        },
        get roomCount() {
            return rooms.size
        },
        get socketCount() {
            return peers.size
        }
    }
}

export type FloorPresence = ReturnType<typeof createFloorPresence>
