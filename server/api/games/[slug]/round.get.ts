import { requirePlayerId } from '#server/utils/session'
import { currentStepRound } from '#server/utils/steps'

/** The player's open multi-step round of this game, or null: an abandoned round picks up where it was. */
export default defineEventHandler(async (event) => {
    const playerId = await requirePlayerId(event)
    return { round: currentStepRound(playerId, getRouterParam(event, 'slug') ?? '') }
})
