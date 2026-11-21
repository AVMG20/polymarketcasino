import { listCoinHistory } from '#server/utils/ledger'
import { requirePlayerId } from '#server/utils/session'

export default defineEventHandler(async (event) => {
    const playerId = await requirePlayerId(event)
    const limit = Number(getQuery(event).limit ?? 50)
    return { entries: listCoinHistory(playerId, limit) }
})
