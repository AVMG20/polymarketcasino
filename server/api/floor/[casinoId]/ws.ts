import { PRESENCE_CLOSE } from '#shared/floor-presence'
import type { PresenceContext } from '#server/utils/floor-presence'
import { authorizeFloorUpgrade, floorPresence } from '#server/utils/floor-socket'

/**
 * Live presence on a casino floor: /api/floor/<casinoId>/ws. Who walks where,
 * for the owner and everyone visiting. Same upgrade rules as the tables.
 */
export default defineWebSocketHandler({
    async upgrade(request) {
        const decision = await authorizeFloorUpgrade(request)
        if (decision instanceof Response) return decision
        ;(request as unknown as { context: Record<string, unknown> }).context.floor = decision
    },

    open(peer) {
        const context = (peer.context as { floor?: PresenceContext }).floor
        if (!context) return peer.close(PRESENCE_CLOSE.unauthorized, 'Unauthorized')
        floorPresence.open(peer, context)
    },

    message(peer, message) {
        floorPresence.message(peer, message.text())
    },

    close(peer) {
        floorPresence.close(peer)
    },

    error(peer) {
        floorPresence.close(peer)
    }
})
