import type { TycoonActionResponse } from '#shared/tycoon'
import { requirePlayerId } from '#server/utils/session'
import { collectCage } from '#server/utils/tycoon'

/** POST /api/tycoon/collect: empty the cashier cage (guest income, in coins) into the coin balance. */
export default defineEventHandler(async (event): Promise<TycoonActionResponse> => collectCage(await requirePlayerId(event)))
