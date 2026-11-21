import { playRound } from '#server/utils/rounds'
import { requirePlayerId } from '#server/utils/session'

export default defineEventHandler(async (event) => {
    const playerId = await requirePlayerId(event)
    const body = await readBody<{ bet?: unknown, options?: unknown }>(event)
    return playRound(playerId, getRouterParam(event, 'slug') ?? '', body ?? {})
})
