import { eq } from 'drizzle-orm'
// The floor plan lives with the client's floor renderer; the server reads the same walkable grid.
import { NavGrid } from '../../shared/floor/nav'
import { db } from '../database'
import { casinoProfiles, players } from '../database/schema'
import { avatarOf } from './cosmetics'
import { createFloorPresence, type PresenceContext, type PresenceSource } from './floor-presence'
import { onVisitorRakeback } from './rakeback'
import { refuseCrossSiteSocket, socketPlayer, type SocketUpgradeRequest } from './socket-auth'
import { tablesOccupancy } from './tables'
import { onTableOccupancyChange } from './tables/table'
import { casinoLayout, onFloorChange, peekCasino } from './tycoon'

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

/** Walkable tiles from what stands on the casino's floor (its rooms, games and placed decorations), as its floor draws them. */
export const dbPresenceSource: PresenceSource = {
    walkable(casinoId) {
        const casino = peekCasino(casinoId)
        const nav = new NavGrid(casinoLayout({ ...casino, zones: casino.zones.length ? casino.zones : ['backroom'] }))
        return (x, y) => nav.isWalkable(x, y)
    },
    look: playerId => avatarOf(playerId),
    tables: tablesOccupancy
}

/** The process's floor rooms. */
export const floorPresence = createFloorPresence(dbPresenceSource)

// A build, a placement or a decoration changes the floor: the room reads its walk grid again on the next move.
onFloorChange(casinoId => floorPresence.invalidate(casinoId))

// A visitor's settled bet put its rakeback in the host's cage (the unit has committed): tell the host's open floor.
onVisitorRakeback(event => floorPresence.toOwner(event.host, () => {
    const from = db.select({ name: players.name }).from(players).where(eq(players.id, event.playerId)).get()?.name ?? 'A visitor'
    return { t: 'rakeback', amount: event.amount, pot: event.pot, from, game: event.game, at: Date.now() }
}))

// Someone sat down or left a seat at a live table: tell every open floor.
onTableOccupancyChange(() => floorPresence.toAll(() => ({ t: 'tables', tables: tablesOccupancy() })))
