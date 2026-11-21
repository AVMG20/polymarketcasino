import { requirePlayerId } from '#server/utils/session'
import { claimAllowance } from '#server/utils/wallet'

export default defineEventHandler(async event => claimAllowance(await requirePlayerId(event)))
