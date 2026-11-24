import type { TycoonActionResponse } from '#shared/tycoon'
import { requirePlayerId } from '#server/utils/session'
import { buyDecor, parseBuyDecorBody } from '#server/utils/tycoon'

/** POST /api/tycoon/decor { type, x?, y? }: buy a decoration (placed at x, y, or into storage). */
export default defineEventHandler(async (event): Promise<TycoonActionResponse> => {
    const playerId = await requirePlayerId(event)
    return buyDecor(playerId, parseBuyDecorBody(await readBody(event)))
})
