import type { LeaderboardResponse } from '#shared/social'
import { requirePlayerId } from '#server/utils/session'
import { getLeaderboard } from '#server/utils/social'

/** GET /api/tycoon/leaderboard: the most valuable casinos (top 50) and the player's own rank. */
export default defineEventHandler(async (event): Promise<LeaderboardResponse> => getLeaderboard(await requirePlayerId(event)))
