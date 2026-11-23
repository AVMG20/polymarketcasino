import type { TycoonActionResponse } from '#shared/tycoon'
import { buyCosmeticWithChips, parseCosmeticBody } from '#server/utils/cosmetics'
import { requirePlayerId } from '#server/utils/session'

/** POST /api/tycoon/cosmetics/buy { key, zone? }: buy a cosmetic priced in chips (a zone skin), optionally putting it on a zone. */
export default defineEventHandler(async (event): Promise<TycoonActionResponse> => {
    const playerId = await requirePlayerId(event)
    return buyCosmeticWithChips(playerId, parseCosmeticBody(await readBody(event)))
})
