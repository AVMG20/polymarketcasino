import { consumeLaunchToken, upsertPlayer, verifyLaunchToken } from '#server/utils/launch'
import { setSessionPlayer } from '#server/utils/session'

/** Exchange a hub launch token (`#pnx=…`) for a casino session. */
export default defineEventHandler(async (event) => {
    const body = await readBody<{ token?: unknown }>(event)
    if (typeof body?.token !== 'string' || body.token.length > 4096) {
        throw createError({ statusCode: 400, statusMessage: 'Missing token' })
    }
    const claims = await verifyLaunchToken(body.token)
    consumeLaunchToken(claims.jti, claims.exp)
    const player = upsertPlayer(claims)
    await setSessionPlayer(event, player.id)
    return { player: { id: player.id, name: player.name, image: player.image, title: player.title, coins: player.coins } }
})
