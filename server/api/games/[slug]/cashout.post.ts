import { requirePlayerId } from '#server/utils/session'
import { cashOutStepRound } from '#server/utils/steps'

/** Cash out the open multi-step round (paid in chips). */
export default defineEventHandler(async (event) => {
    const playerId = await requirePlayerId(event)
    const body = await readBody<{ step?: unknown }>(event)
    return cashOutStepRound(playerId, getRouterParam(event, 'slug') ?? '', body ?? {})
})
