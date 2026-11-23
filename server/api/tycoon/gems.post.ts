import type { TycoonActionResponse } from '#shared/tycoon'
import { requirePlayerId } from '#server/utils/session'
import { buyWithGems, parseGemBody } from '#server/utils/tycoon-gems'

/** POST /api/tycoon/gems { item, target? }: a skip, rush, builder, golden skin or cosmetic, paid in gems at the hub. */
export default defineEventHandler(async (event): Promise<TycoonActionResponse> => {
    const playerId = await requirePlayerId(event)
    return buyWithGems(playerId, parseGemBody(await readBody(event)))
})
