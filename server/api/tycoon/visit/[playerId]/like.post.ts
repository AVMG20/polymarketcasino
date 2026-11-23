import type { LikeResponse } from '#shared/social'
import { requirePlayerId } from '#server/utils/session'
import { likeCasino, parsePlayerParam } from '#server/utils/social'

/** POST /api/tycoon/visit/:playerId/like: leave a heart on a casino, once a day. */
export default defineEventHandler(async (event): Promise<LikeResponse> => {
    const visitorId = await requirePlayerId(event)
    return likeCasino(visitorId, parsePlayerParam(getRouterParam(event, 'playerId')))
})
