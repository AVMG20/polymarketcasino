import type { TableOccupancy } from '#shared/tycoon'
import { requirePlayerId } from '#server/utils/session'
import { tablesOccupancy } from '#server/utils/tables'

/** GET /api/tables: who sits at each live table and how many watch, for the casino floor. */
export default defineEventHandler(async (event): Promise<TableOccupancy[]> => {
    await requirePlayerId(event)
    return tablesOccupancy()
})
