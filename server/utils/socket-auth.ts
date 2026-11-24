import { eq } from 'drizzle-orm'
import { db } from '../database'
import { players } from '../database/schema'
import { casinoEnv } from './env'
import { playerIdFromCookieHeader } from './session'

/** What a WebSocket upgrade hook sees of the request. */
export interface SocketUpgradeRequest {
    url: string
    headers: Headers
}

/** The signed-in player behind a socket (name and avatar image from the players row). */
export interface SocketPlayer {
    playerId: string
    name: string
    image: string | null
}

/**
 * The casino's own pages only: the Origin header must be PUBLIC_URL exactly.
 * SameSite=Lax alone would let any *.avmg.nl page open a socket with the
 * player's cookie. Returns the refusal, or null to go on.
 */
export function refuseCrossSiteSocket(request: SocketUpgradeRequest): Response | null {
    const origin = request.headers.get('origin')
    if (!origin || origin !== casinoEnv().publicUrl) return new Response('Cross-site socket refused', { status: 403 })
    return null
}

/** A valid casino session cookie for a player that exists, else a 401 to send. */
export async function socketPlayer(request: SocketUpgradeRequest): Promise<SocketPlayer | Response> {
    const playerId = await playerIdFromCookieHeader(request.headers.get('cookie'))
    if (!playerId) return new Response('Unauthorized', { status: 401 })
    const player = db.select({ name: players.name, image: players.image }).from(players).where(eq(players.id, playerId)).get()
    if (!player) return new Response('Unauthorized', { status: 401 })
    return { playerId, name: player.name, image: player.image }
}
