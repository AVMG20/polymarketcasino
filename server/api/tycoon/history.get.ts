import type { HistoryResponse } from '#shared/visitors'
import { requirePlayerId } from '#server/utils/session'
import { getHistory, parseHistoryRange } from '#server/utils/tycoon'

/** GET /api/tycoon/history?range=24h|3d: the player's own floor hour by hour (visitors per tier, income, lost). */
export default defineEventHandler(async (event): Promise<HistoryResponse> => {
    const playerId = await requirePlayerId(event)
    return getHistory(playerId, parseHistoryRange(getQuery(event).range))
})
