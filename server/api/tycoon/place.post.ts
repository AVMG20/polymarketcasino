import type { TycoonActionResponse } from '#shared/tycoon'
import { requirePlayerId } from '#server/utils/session'
import { parsePlaceBody, placeItem } from '#server/utils/tycoon'

/** POST /api/tycoon/place: move a built game, or place, move or put away a decoration. */
export default defineEventHandler(async (event): Promise<TycoonActionResponse> => {
    const playerId = await requirePlayerId(event)
    return placeItem(playerId, parsePlaceBody(await readBody(event)))
})
