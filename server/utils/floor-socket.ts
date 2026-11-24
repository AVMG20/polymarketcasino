import { eq } from 'drizzle-orm'
import type { ZoneId } from '#shared/tycoon'
// The floor plan lives with the client's floor renderer; the server reads the same walkable grid.
import { NavGrid } from '../../shared/floor/nav'
import { db } from '../database'
import { casinoProfiles } from '../database/schema'
import { avatarOf } from './cosmetics'
import { createFloorPresence, type PresenceContext, type PresenceSource } from './floor-presence'
import { refuseCrossSiteSocket, socketPlayer, type SocketUpgradeRequest } from './socket-auth'
import { peekCasino } from './tycoon'

/** The casino a socket URL names: /api/floor/<casinoId>/ws. */
export function floorCasinoFromUrl(url: string): string | null {
    const match = /\/api\/floor\/([\w-]{1,128})\/ws(?:[?#]|$)/.exec(new URL(url, 'http://x').pathname)
    return match ? match[1]! : null
}

/**
 * Decide a floor socket upgrade, like the tables': the casino's own pages
 * only, a valid session for a player that exists, and a casino that exists.
 */
export async function authorizeFloorUpgrade(request: SocketUpgradeRequest): Promise<PresenceContext | Response> {
    const crossSite = refuseCrossSiteSocket(request)
    if (crossSite) return crossSite
    const casinoId = floorCasinoFromUrl(request.url)
    if (!casinoId) return new Response('Unknown casino', { status: 404 })
    const player = await socketPlayer(request)
    if (player instanceof Response) return player
    const casino = db.select({ id: casinoProfiles.playerId }).from(casinoProfiles).where(eq(casinoProfiles.playerId, casinoId)).get()
    if (!casino) return new Response('Unknown casino', { status: 404 })
    return { casinoId, ...player }
}

/** Walkable tiles from the casino's owned zones and decor, as its floor draws them. */
export const dbPresenceSource: PresenceSource = {
    walkable(casinoId) {
        const casino = peekCasino(casinoId)
        const zones = new Set<ZoneId>(casino.zones.length ? casino.zones : ['backroom'])
        const decor = Math.max(0, Math.min(5, Math.round(casino.upgrades.decor ?? 0)))
        const nav = new NavGrid(zones, decor)
        return (x, y) => nav.isWalkable(x, y)
    },
    look: playerId => avatarOf(playerId)
}

/** The process's floor rooms. */
export const floorPresence = createFloorPresence(dbPresenceSource)
