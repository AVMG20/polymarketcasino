import type { CasinoVisit } from '#shared/social'
import { requirePlayerId } from '#server/utils/session'
import { getCasinoVisit, parsePlayerParam } from '#server/utils/social'

/** GET /api/tycoon/visit/:playerId: another player's casino, read-only and without balances. */
export default defineEventHandler(async (event): Promise<CasinoVisit> => {
    const visitorId = await requirePlayerId(event)
    return getCasinoVisit(visitorId, parsePlayerParam(getRouterParam(event, 'playerId')))
})
