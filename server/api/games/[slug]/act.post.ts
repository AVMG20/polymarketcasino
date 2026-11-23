import { requirePlayerId } from '#server/utils/session'
import { actStepRound } from '#server/utils/steps'

/** One move on the open multi-step round: `{ step, action }`. */
export default defineEventHandler(async (event) => {
    const playerId = await requirePlayerId(event)
    const body = await readBody<{ step?: unknown, action?: unknown }>(event)
    return actStepRound(playerId, getRouterParam(event, 'slug') ?? '', body ?? {})
})
