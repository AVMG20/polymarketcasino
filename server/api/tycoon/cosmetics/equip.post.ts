import type { TycoonActionResponse } from '#shared/tycoon'
import { equipCosmetic, parseCosmeticBody } from '#server/utils/cosmetics'
import { requirePlayerId } from '#server/utils/session'

/** POST /api/tycoon/cosmetics/equip { key, zone? }: wear an owned avatar item, or put an owned skin on one of your zones. */
export default defineEventHandler(async (event): Promise<TycoonActionResponse> => {
    const playerId = await requirePlayerId(event)
    return equipCosmetic(playerId, parseCosmeticBody(await readBody(event)))
})
