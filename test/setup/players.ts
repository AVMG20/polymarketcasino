import { eq, sql } from 'drizzle-orm'
import { db } from '../../server/database'
import { casinoProfiles, chipTransactions, coinTransactions, players } from '../../server/database/schema'
import { fromUnits } from '../../shared/money'
import { STARTER_CAGE, TYCOON_GAMES, UPGRADE_IDS, ZONES } from '../../shared/tycoon'

let counter = 0

export interface SeedOptions {
    /**
     * 'built' (default): a casino with every zone and every game at level 1,
     * so any game plays and any table seats. 'none': no casino yet (created
     * on first use with only the starters, like a real new player).
     */
    casino?: 'built' | 'none'
    origin?: 'hub' | 'dev'
    chips?: number
}

/** A fresh player with `coins` (set directly: test fixtures only; the schema stores them as units). */
export function seedPlayer(coins = 0, peakCoins = coins, options: SeedOptions = {}) {
    const id = `test-${process.pid}-${Date.now()}-${counter++}`
    db.insert(players).values({ id, name: 'Test player', coins, peakCoins, origin: options.origin ?? 'hub' }).run()
    if ((options.casino ?? 'built') === 'built') {
        db.insert(casinoProfiles).values({
            playerId: id,
            chips: options.chips ?? 0,
            zones: ZONES.map(zone => zone.id),
            games: Object.fromEntries(TYCOON_GAMES.map(game => [game.slug, 1])),
            upgrades: Object.fromEntries(UPGRADE_IDS.map(upgrade => [upgrade, 0])),
            golden: [],
            builders: 1,
            cageStored: STARTER_CAGE,
            cageAt: new Date()
        }).run()
    }
    return id
}

export function coinsOf(id: string) {
    return db.select({ coins: players.coins, peak: players.peakCoins }).from(players).where(eq(players.id, id)).get()!
}

export function chipsOf(id: string) {
    return db.select({ chips: casinoProfiles.chips }).from(casinoProfiles).where(eq(casinoProfiles.playerId, id)).get()?.chips ?? 0
}

/** The net of every ledger row, in coins (the raw sum is in database units). */
export function ledgerSum(id: string) {
    const row = db.select({ net: sql<number>`coalesce(sum(case when ${coinTransactions.type} = 'credit' then ${coinTransactions.amount} else -${coinTransactions.amount} end), 0)` })
        .from(coinTransactions).where(eq(coinTransactions.playerId, id)).get()
    return fromUnits(Number(row?.net ?? 0))
}

/** The net of every chip ledger row, in chips. */
export function chipLedgerSum(id: string) {
    const row = db.select({ net: sql<number>`coalesce(sum(case when ${chipTransactions.type} = 'credit' then ${chipTransactions.amount} else -${chipTransactions.amount} end), 0)` })
        .from(chipTransactions).where(eq(chipTransactions.playerId, id)).get()
    return fromUnits(Number(row?.net ?? 0))
}

/** Chips straight into the profile (fixture only: no ledger row, no star report). */
export function giveChips(id: string, chips: number) {
    db.update(casinoProfiles).set({ chips }).where(eq(casinoProfiles.playerId, id)).run()
}
