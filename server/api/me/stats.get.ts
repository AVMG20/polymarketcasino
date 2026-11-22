import { requirePlayerId } from '#server/utils/session'
import { parseStatsQuery, playerStats } from '#server/utils/stats'

/** GET /api/me/stats?range=7d|30d|90d|all&game=<slug>: the signed-in player's results. */
export default defineEventHandler(async (event) => {
    const playerId = await requirePlayerId(event)
    return playerStats(playerId, parseStatsQuery(getQuery(event)))
})
