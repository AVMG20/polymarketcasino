import { requirePlayerId } from '#server/utils/session'
import { convertGems, parseGemAmount } from '#server/utils/wallet'

export default defineEventHandler(async (event) => {
    const playerId = await requirePlayerId(event)
    const body = await readBody<{ gems?: unknown }>(event)
    return convertGems(playerId, parseGemAmount(body?.gems))
})
