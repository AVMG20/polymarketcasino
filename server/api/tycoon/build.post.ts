import type { TycoonActionResponse } from '#shared/tycoon'
import { requirePlayerId } from '#server/utils/session'
import { parseBuildBody, startBuild } from '#server/utils/tycoon'

/** POST /api/tycoon/build { kind, id }: start the next step of a zone, game or upgrade. */
export default defineEventHandler(async (event): Promise<TycoonActionResponse> => {
    const playerId = await requirePlayerId(event)
    return startBuild(playerId, parseBuildBody(await readBody(event)))
})
