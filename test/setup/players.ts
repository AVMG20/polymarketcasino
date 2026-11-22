import { eq, sql } from 'drizzle-orm'
import { db } from '../../server/database'
import { coinTransactions, players } from '../../server/database/schema'
import { fromUnits } from '../../shared/money'

let counter = 0

/** A fresh player with `coins` (set directly: test fixtures only; the schema stores them as units). */
export function seedPlayer(coins = 0, peakCoins = coins) {
    const id = `test-${process.pid}-${Date.now()}-${counter++}`
    db.insert(players).values({ id, name: 'Test player', coins, peakCoins }).run()
    return id
}

export function coinsOf(id: string) {
    return db.select({ coins: players.coins, peak: players.peakCoins }).from(players).where(eq(players.id, id)).get()!
}

/** The net of every ledger row, in coins (the raw sum is in database units). */
export function ledgerSum(id: string) {
    const row = db.select({ net: sql<number>`coalesce(sum(case when ${coinTransactions.type} = 'credit' then ${coinTransactions.amount} else -${coinTransactions.amount} end), 0)` })
        .from(coinTransactions).where(eq(coinTransactions.playerId, id)).get()
    return fromUnits(Number(row?.net ?? 0))
}
