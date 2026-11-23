import type { TycoonActionResponse } from '#shared/tycoon'
import { requirePlayerId } from '#server/utils/session'
import { parseCampaignBody, startCampaign } from '#server/utils/tycoon'

/** POST /api/tycoon/campaign: run (or extend) an ad campaign for chips. */
export default defineEventHandler(async (event): Promise<TycoonActionResponse> => {
    const playerId = await requirePlayerId(event)
    return startCampaign(playerId, parseCampaignBody(await readBody(event)))
})
