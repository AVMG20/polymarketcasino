import { requirePlayerId } from '#server/utils/session'
import { getWallet } from '#server/utils/wallet'

export default defineEventHandler(async event => getWallet(await requirePlayerId(event)))
