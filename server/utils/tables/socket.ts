import { eq } from 'drizzle-orm'
import { db } from '../../database'
import { players } from '../../database/schema'
import type { ClientMessage } from '#shared/tables/protocol'
import { takeToken } from '../rate-limit'
import { refuseCrossSiteSocket, socketPlayer, type SocketUpgradeRequest } from '../socket-auth'
import { chipBalance } from '../tycoon'
import type { TablePeer } from './bus'
import { TableError, type LiveTable } from './table'
import { TABLES } from './index'

/** What the upgrade hook stores on the socket for `open`. */
export interface TableSocketContext {
    slug: string
    playerId: string
    name: string
    image: string | null
}

/** The table a socket URL names: /api/tables/<slug>/ws. */
export function tableSlugFromUrl(url: string): string | null {
    const match = /\/api\/tables\/([a-z0-9-]+)\/ws(?:[?#]|$)/.exec(new URL(url, 'http://x').pathname)
    return match && TABLES[match[1]!] ? match[1]! : null
}

/**
 * Decide an upgrade: the casino's own pages only (the Origin header must be
 * PUBLIC_URL; SameSite=Lax alone would let any *.avmg.nl page open a socket
 * with the player's cookie), a known table, and a valid casino session for a
 * player that exists. Returns the socket's context, or the refusal to send.
 */
export async function authorizeTableUpgrade(request: SocketUpgradeRequest): Promise<TableSocketContext | Response> {
    const crossSite = refuseCrossSiteSocket(request)
    if (crossSite) return crossSite
    const slug = tableSlugFromUrl(request.url)
    if (!slug) return new Response('Unknown table', { status: 404 })
    const player = await socketPlayer(request)
    if (player instanceof Response) return player
    return { slug, ...player }
}

const MAX_MESSAGE_BYTES = 2_048
/** Per socket: a burst of this many messages, refilled at RATE per second. */
const BURST = 20
const RATE = 10

interface PeerState {
    table: LiveTable<unknown, unknown, unknown>
    context: TableSocketContext
    tokens: number
    refilledAt: number
}

const peers = new WeakMap<TablePeer, PeerState>()

export function openTableSocket(peer: TablePeer, context: TableSocketContext, table: LiveTable<unknown, unknown, unknown> = TABLES[context.slug]!) {
    peers.set(peer, { table, context, tokens: BURST, refilledAt: Date.now() })
    // Announced before this peer joins, so it is news to everyone already here.
    if (!table.bus.isConnected(context.playerId)) table.bus.broadcast({ t: 'event', kind: 'watch', name: context.name, joined: true })
    table.bus.add(peer, { playerId: context.playerId, name: context.name, image: context.image })
    const balance = db.select({ coins: players.coins }).from(players).where(eq(players.id, context.playerId)).get()?.coins ?? 0
    table.bus.sendTo(peer, { t: 'you', playerId: context.playerId, seat: table.seatIndexOf(context.playerId), balance, chips: chipBalance(context.playerId) })
    // Reconnecting clears the seat's disconnect timer; the publish delivers the first snapshot.
    table.run(() => table.setConnected(context.playerId, true))
}

export function tableSocketMessage(peer: TablePeer, text: string) {
    const state = peers.get(peer)
    if (!state || text.length > MAX_MESSAGE_BYTES || !takeToken(state, BURST, RATE)) return
    let message: ClientMessage
    try {
        message = JSON.parse(text)
    } catch {
        return
    }
    if (!message || typeof message !== 'object') return
    const { table, context } = state
    try {
        table.run(() => {
            switch (message.t) {
                case 'sit': return table.sit(context.playerId, context.name, context.image, message.seat, message.host)
                case 'leave': return table.leave(context.playerId)
                case 'voteStart': return table.voteStart(context.playerId)
                case 'chat': return table.chat(context.playerId, context.name, message.text)
                case 'action': return table.action(context.playerId, message.action)
            }
        })
    } catch (error) {
        const text = error instanceof TableError ? error.message : 'Something went wrong'
        if (!(error instanceof TableError)) console.error(`[tables] ${context.slug}: message failed`, error)
        table.bus.sendTo(peer, { t: 'error', message: text })
    }
}

/** Only the last tab closing counts as leaving. */
export function closeTableSocket(peer: TablePeer) {
    const state = peers.get(peer)
    if (!state) return
    peers.delete(peer)
    const { table, context } = state
    table.bus.remove(peer)
    if (table.bus.isConnected(context.playerId)) return
    table.bus.broadcast({ t: 'event', kind: 'watch', name: context.name, joined: false })
    table.run(() => table.setConnected(context.playerId, false))
}
