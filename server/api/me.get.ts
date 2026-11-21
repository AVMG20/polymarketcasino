import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { players } from '#server/database/schema'
import { requirePlayerId } from '#server/utils/session'

export default defineEventHandler(async (event) => {
    const playerId = await requirePlayerId(event)
    const player = db.select({
        id: players.id,
        name: players.name,
        image: players.image,
        title: players.title,
        coins: players.coins,
        peakCoins: players.peakCoins
    }).from(players).where(eq(players.id, playerId)).get()!
    return { player }
})
