import type { TycoonActionResponse } from '#shared/tycoon'
import { claimMission, parseMissionBody } from '#server/utils/missions'
import { requirePlayerId } from '#server/utils/session'

/** POST /api/tycoon/mission { id }: claim a finished daily mission (or the bonus) for coins. */
export default defineEventHandler(async (event): Promise<TycoonActionResponse> => {
    const playerId = await requirePlayerId(event)
    return claimMission(playerId, parseMissionBody(await readBody(event)))
})
