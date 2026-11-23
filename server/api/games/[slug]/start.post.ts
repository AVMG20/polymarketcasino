import { requirePlayerId } from '#server/utils/session'
import { startStepRound } from '#server/utils/steps'

/** Start a multi-step round (Gem Dig, Card Climb): stakes the bet. */
export default defineEventHandler(async (event) => {
    const playerId = await requirePlayerId(event)
    const body = await readBody<{ bet?: unknown, options?: unknown, host?: unknown }>(event)
    return startStepRound(playerId, getRouterParam(event, 'slug') ?? '', body ?? {})
})
