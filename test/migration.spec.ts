import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { afterAll, describe, expect, it } from 'vitest'
import * as schema from '../server/database/schema'

/**
 * 0002_decimal_coins turns every stored whole-coin value into units of
 * 1/10,000 coin. These tests build a database the way production has it
 * (0000 + 0001 applied, whole coins in it), then run the real migrator over
 * the full folder, as the container does at start.
 */

const DRIZZLE = resolve(import.meta.dirname, '../drizzle')
const scratch = mkdtempSync(join(tmpdir(), 'pnxcasino-migration-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A copy of drizzle/ whose journal stops before the decimal-coins migration. */
function beforeDecimalCoins(): string {
    const folder = join(scratch, `drizzle-${crypto.randomUUID()}`)
    cpSync(DRIZZLE, folder, { recursive: true })
    const journalPath = join(folder, 'meta/_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
    const at = journal.entries.findIndex(entry => entry.tag === '0002_decimal_coins')
    expect(at).toBeGreaterThan(0)
    journal.entries = journal.entries.slice(0, at)
    writeFileSync(journalPath, JSON.stringify(journal))
    return folder
}

function oldDatabase(coins: number) {
    const sqlite = new Database(join(scratch, `${crypto.randomUUID()}.sqlite`), { create: true, strict: true })
    sqlite.exec('PRAGMA foreign_keys = ON')
    const db = drizzle({ client: sqlite, schema })
    migrate(db, { migrationsFolder: beforeDecimalCoins() })
    // Whole coins, written the way the old code stored them.
    sqlite.run(`insert into players (id, name, coins, peak_coins) values ('p1', 'Old player', ?, ?)`, [coins, coins + 500])
    sqlite.run(`insert into players (id, name, coins, peak_coins) values ('p2', 'Broke player', 0, 2500)`)
    sqlite.run(`insert into coin_transactions (player_id, amount, type, category, balance_after) values ('p1', 2500, 'credit', 'allowance', 2500), ('p1', 100, 'debit', 'dice', 2400)`)
    sqlite.run(`insert into gem_conversions (id, player_id, gems, coins, status, idempotency_key) values ('c1', 'p1', 3, 3000, 'done', 'key-1')`)
    sqlite.run(`insert into allowance_claims (player_id, day, amount) values ('p1', '2026-11-20', 2500)`)
    sqlite.run(`insert into game_rounds (id, player_id, game, stake, payout, summary) values ('r1', 'p1', 'dice', 100, 196, '{"bet":100}')`)
    sqlite.run(`insert into table_wagers (id, player_id, game, round_id, amount, kind) values ('w1', 'p1', 'blackjack', 7, 500, 'bet')`)
    return { sqlite, db }
}

describe('0002_decimal_coins', () => {
    it('multiplies every stored coin value by 10,000 and reads back as the same coins', () => {
        const { sqlite, db } = oldDatabase(2_400)
        migrate(db, { migrationsFolder: DRIZZLE })

        expect(sqlite.query('select id, coins, peak_coins as peak from players order by id').all()).toEqual([
            { id: 'p1', coins: 24_000_000, peak: 29_000_000 },
            { id: 'p2', coins: 0, peak: 25_000_000 }
        ])
        expect(sqlite.query('select amount, balance_after as after from coin_transactions order by id').all()).toEqual([
            { amount: 25_000_000, after: 25_000_000 },
            { amount: 1_000_000, after: 24_000_000 }
        ])
        expect(sqlite.query('select coins from gem_conversions').get()).toEqual({ coins: 30_000_000 })
        expect(sqlite.query('select amount from allowance_claims').get()).toEqual({ amount: 25_000_000 })
        expect(sqlite.query('select stake, payout, summary from game_rounds').get()).toEqual({ stake: 1_000_000, payout: 1_960_000, summary: '{"bet":100}' })
        expect(sqlite.query('select amount from table_wagers').get()).toEqual({ amount: 5_000_000 })

        // Through the schema, the same values read as coins again.
        expect(db.select({ coins: schema.players.coins, peak: schema.players.peakCoins }).from(schema.players).where(eq(schema.players.id, 'p1')).get())
            .toEqual({ coins: 2_400, peak: 2_900 })
        expect(db.select({ stake: schema.gameRounds.stake, payout: schema.gameRounds.payout }).from(schema.gameRounds).get()).toEqual({ stake: 100, payout: 196 })
        expect(db.select({ amount: schema.tableWagers.amount }).from(schema.tableWagers).get()).toEqual({ amount: 500 })
        sqlite.close()
    })

    it('runs once: starting the container again leaves the units alone', () => {
        const { sqlite, db } = oldDatabase(2_400)
        migrate(db, { migrationsFolder: DRIZZLE })
        migrate(db, { migrationsFolder: DRIZZLE })
        expect(sqlite.query(`select coins from players where id = 'p1'`).get()).toEqual({ coins: 24_000_000 })
        // One row per migration in the folder: none ran twice.
        const journal = JSON.parse(readFileSync(join(DRIZZLE, 'meta/_journal.json'), 'utf8')) as { entries: unknown[] }
        expect(sqlite.query(`select count(*) as n from __drizzle_migrations`).get()).toEqual({ n: journal.entries.length })
        sqlite.close()
    })

    it('refuses balances that would not fit to the unit and changes nothing', () => {
        const { sqlite, db } = oldDatabase(900_719_925_475)
        expect(() => migrate(db, { migrationsFolder: DRIZZLE })).toThrow()
        expect(sqlite.query(`select coins from players where id = 'p1'`).get()).toEqual({ coins: 900_719_925_475 })
        expect(sqlite.query(`select amount from coin_transactions order by id limit 1`).get()).toEqual({ amount: 2_500 })
        expect(sqlite.query(`select count(*) as n from __drizzle_migrations`).get()).toEqual({ n: 2 })
        sqlite.close()
    })
})
