import type { TycoonState } from '#shared/tycoon'
import { requirePlayerId } from '#server/utils/session'
import { readTycoonState } from '#server/utils/tycoon'

/**
 * GET /api/tycoon: the player's casino (created on first visit, finished builds applied) and today's
 * missions. `?welcome=1` (the page opening, the tab coming back) adds "while you were away" after a gap.
 */
export default defineEventHandler(async (event): Promise<TycoonState> => {
    const playerId = await requirePlayerId(event)
    return readTycoonState(playerId, Date.now(), { welcome: getQuery(event).welcome === '1' })
})
