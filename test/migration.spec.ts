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

describe('0004_tycoon', () => {
    it('adds My Casino, marks old rounds as coin rounds and drops the prototype table', () => {
        const { sqlite, db } = oldDatabase(2_400)
        // A table an earlier, deleted prototype left in local databases.
        sqlite.run('create table tycoon_profiles (player_id text primary key, data text)')
        migrate(db, { migrationsFolder: DRIZZLE })

        const tables = sqlite.query(`select name from sqlite_master where type = 'table'`).all().map(row => (row as { name: string }).name)
        expect(tables).not.toContain('tycoon_profiles')
        expect(tables).toEqual(expect.arrayContaining(['casino_profiles', 'casino_constructions', 'chip_transactions', 'gem_purchases']))
        expect(sqlite.query('select funding from game_rounds').get()).toEqual({ funding: 'coins' })
        sqlite.close()
    })
})

describe('0006_economy_v2', () => {
    it('records the chip part of old chip-funded rounds and gives escrow rows a chip part', () => {
        const sqlite = new Database(join(scratch, `${crypto.randomUUID()}.sqlite`), { create: true, strict: true })
        sqlite.exec('PRAGMA foreign_keys = ON')
        const db = drizzle({ client: sqlite, schema })
        // The folder as it was before economy v2.
        const folder = join(scratch, `drizzle-${crypto.randomUUID()}`)
        cpSync(DRIZZLE, folder, { recursive: true })
        const journalPath = join(folder, 'meta/_journal.json')
        const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
        journal.entries = journal.entries.slice(0, journal.entries.findIndex(entry => entry.tag === '0006_economy_v2'))
        writeFileSync(journalPath, JSON.stringify(journal))
        migrate(db, { migrationsFolder: folder })

        sqlite.run(`insert into players (id, name) values ('p1', 'Old')`)
        sqlite.run(`insert into game_rounds (id, player_id, game, stake, payout, summary, funding) values ('r1', 'p1', 'dice', 1000000, 0, '{}', 'chips'), ('r2', 'p1', 'dice', 2000000, 0, '{}', 'coins')`)
        sqlite.run(`insert into table_wagers (id, player_id, game, round_id, amount, kind) values ('w1', 'p1', 'blackjack', 1, 5000000, 'bet')`)
        migrate(db, { migrationsFolder: DRIZZLE })

        expect(sqlite.query('select id, stake_chips as chips from game_rounds order by id').all()).toEqual([{ id: 'r1', chips: 1_000_000 }, { id: 'r2', chips: 0 }])
        expect(sqlite.query('select amount_chips as chips from table_wagers').get()).toEqual({ chips: 0 })
        sqlite.close()
    })
})

/** A copy of drizzle/ whose journal stops before `tag`. */
function before(tag: string): string {
    const folder = join(scratch, `drizzle-${crypto.randomUUID()}`)
    cpSync(DRIZZLE, folder, { recursive: true })
    const journalPath = join(folder, 'meta/_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
    const at = journal.entries.findIndex(entry => entry.tag === tag)
    expect(at).toBeGreaterThan(0)
    journal.entries = journal.entries.slice(0, at)
    writeFileSync(journalPath, JSON.stringify(journal))
    return folder
}

describe('0011_visitor_tiers', () => {
    it('moves Decor from the old 5 levels onto the new 12, running constructions included', () => {
        const sqlite = new Database(join(scratch, `${crypto.randomUUID()}.sqlite`), { create: true, strict: true })
        sqlite.exec('PRAGMA foreign_keys = ON')
        const db = drizzle({ client: sqlite, schema })
        migrate(db, { migrationsFolder: before('0011_visitor_tiers') })
        for (let decor = 0; decor <= 5; decor++) {
            sqlite.run(`insert into players (id, name, coins, peak_coins) values (?, 'Owner', 0, 0)`, [`d${decor}`])
            sqlite.run(`insert into casino_profiles (player_id, zones, games, upgrades, golden, cage_at) values (?, '["backroom"]', '{}', ?, '[]', 0)`, [`d${decor}`, JSON.stringify({ cage: 1, marketing: 2, decor, crew: 0 })])
        }
        sqlite.run(`insert into casino_constructions (id, player_id, kind, target, level, started_at, ready_at) values ('k1', 'd2', 'upgrade', 'decor', 3, 0, 1)`)
        migrate(db, { migrationsFolder: DRIZZLE })
        const decor = sqlite.query(`select player_id as id, json_extract(upgrades, '$.decor') as decor, json_extract(upgrades, '$.marketing') as marketing from casino_profiles order by player_id`).all()
        expect(decor).toEqual([0, 2, 4, 6, 9, 12].map((level, old) => ({ id: `d${old}`, decor: level, marketing: 2 })))
        expect(sqlite.query(`select level from casino_constructions where id = 'k1'`).get()).toEqual({ level: 6 })
        // The new columns read as defaults.
        expect(sqlite.query(`select campaigns, door, vip, rules_at as rulesAt from casino_profiles where player_id = 'd0'`).get()).toEqual({ campaigns: '[]', door: 'open', vip: 0, rulesAt: null })
    })
})

describe('0012_decorations', () => {
    it('gives every casino an empty placements map and guards one special and one grant per casino', () => {
        const sqlite = new Database(join(scratch, `${crypto.randomUUID()}.sqlite`), { create: true, strict: true })
        sqlite.exec('PRAGMA foreign_keys = ON')
        const db = drizzle({ client: sqlite, schema })
        migrate(db, { migrationsFolder: before('0012_decorations') })
        sqlite.run(`insert into players (id, name, coins, peak_coins) values ('o1', 'Owner', 0, 0)`)
        sqlite.run(`insert into casino_profiles (player_id, zones, games, upgrades, golden, cage_at) values ('o1', '["backroom"]', '{"plinko":1}', '{}', '[]', 0)`)
        migrate(db, { migrationsFolder: DRIZZLE })
        expect(sqlite.query(`select placements from casino_profiles where player_id = 'o1'`).get()).toEqual({ placements: '{}' })
        sqlite.run(`insert into casino_decor (player_id, type, x, y, special) values ('o1', 'aquarium', 3, 4, 'aquarium')`)
        expect(() => sqlite.run(`insert into casino_decor (player_id, type, special) values ('o1', 'aquarium', 'aquarium')`)).toThrow()
        sqlite.run(`insert into casino_decor (player_id, type, grant_key) values ('o1', 'plant', 'backroom:plant:21,17')`)
        expect(() => sqlite.run(`insert into casino_decor (player_id, type, grant_key) values ('o1', 'plant', 'backroom:plant:21,17')`)).toThrow()
        // Plain decorations bought (no special, no grant) come as many as you like.
        sqlite.run(`insert into casino_decor (player_id, type) values ('o1', 'plant'), ('o1', 'plant')`)
        expect(sqlite.query(`select count(*) as n from casino_decor`).get()).toEqual({ n: 4 })
    })
})

describe('0014_stars_seen', () => {
    it('counts every level reported before it as seen, so nobody gets a stale celebration', () => {
        const sqlite = new Database(join(scratch, `${crypto.randomUUID()}.sqlite`), { create: true, strict: true })
        sqlite.exec('PRAGMA foreign_keys = ON')
        const db = drizzle({ client: sqlite, schema })
        migrate(db, { migrationsFolder: before('0014_stars_seen') })
        sqlite.run(`insert into players (id, name, coins, peak_coins, stars_reported, stars_seq) values ('s0', 'New', 0, 0, 0, 0), ('s4', 'Starred', 0, 0, 4, 1795600000000)`)
        migrate(db, { migrationsFolder: DRIZZLE })
        expect(sqlite.query(`select id, stars_seen as seen, stars_unseen_bounty as bounty, stars_pending_seq as pending from players order by id`).all()).toEqual([
            { id: 's0', seen: 0, bounty: 0, pending: 0 },
            { id: 's4', seen: 4, bounty: 0, pending: 0 }
        ])
    })
})

describe('0015_cage_rakeback', () => {
    it('gives every casino two empty rakeback pots and leaves the cage alone', () => {
        const sqlite = new Database(join(scratch, `${crypto.randomUUID()}.sqlite`), { create: true, strict: true })
        sqlite.exec('PRAGMA foreign_keys = ON')
        const db = drizzle({ client: sqlite, schema })
        migrate(db, { migrationsFolder: before('0015_cage_rakeback') })
        sqlite.run(`insert into players (id, name, coins, peak_coins) values ('o1', 'Owner', 0, 0)`)
        sqlite.run(`insert into casino_profiles (player_id, zones, games, upgrades, golden, cage_stored, cage_at) values ('o1', '["backroom"]', '{"plinko":1}', '{}', '[]', 1234500, 0)`)
        migrate(db, { migrationsFolder: DRIZZLE })
        expect(sqlite.query(`select cage_stored as stored, cage_rakeback as rakeback, cage_visitors as visitors from casino_profiles`).get()).toEqual({ stored: 1_234_500, rakeback: 0, visitors: 0 })
        // Read through the schema: coins.
        expect(db.select({ rakeback: schema.casinoProfiles.cageRakeback, visitors: schema.casinoProfiles.cageVisitors }).from(schema.casinoProfiles).get()).toEqual({ rakeback: 0, visitors: 0 })
    })
})
