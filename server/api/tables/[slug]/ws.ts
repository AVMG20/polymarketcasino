import { authorizeTableUpgrade, closeTableSocket, openTableSocket, tableSocketMessage, type TableSocketContext } from '#server/utils/tables/socket'

/**
 * The live tables' socket: /api/tables/<slug>/ws. The upgrade is refused
 * unless it comes from the casino's own page with a valid session cookie; the
 * table and the player ride on the socket's context from then on.
 */
export default defineWebSocketHandler({
    async upgrade(request) {
        const decision = await authorizeTableUpgrade(request)
        if (decision instanceof Response) return decision
        ;(request as unknown as { context: Record<string, unknown> }).context.table = decision
    },

    open(peer) {
        const context = (peer.context as { table?: TableSocketContext }).table
        if (!context) return peer.close(4401, 'Unauthorized')
        openTableSocket(peer, context)
    },

    message(peer, message) {
        tableSocketMessage(peer, message.text())
    },

    close(peer) {
        closeTableSocket(peer)
    },

    error(peer) {
        closeTableSocket(peer)
    }
})
