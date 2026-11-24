import type { TycoonActionResponse } from '#shared/tycoon'
import { requirePlayerId } from '#server/utils/session'
import { parseRulesBody, setHouseRules } from '#server/utils/tycoon'

/** POST /api/tycoon/rules: change house rules (only the given keys; a locked rule is a 403, within the cooldown a 429). */
export default defineEventHandler(async (event): Promise<TycoonActionResponse> => {
    const playerId = await requirePlayerId(event)
    return setHouseRules(playerId, parseRulesBody(await readBody(event)))
})
