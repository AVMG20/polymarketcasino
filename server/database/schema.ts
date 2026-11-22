import { sql } from 'drizzle-orm'
import { customType, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { fromUnits, toUnits } from '../../shared/money'

/**
 * Coins carry four decimals and are stored as whole units of 1/10,000 coin
 * (SQLite INTEGER, 64-bit), so the database never holds a float. Every coin
 * column is a `coins()` column: Drizzle converts coins ↔ units on the way in
 * and out, so code reads and writes coins. Raw `sql` fragments are not
 * converted: bind `toUnits(x)` there yourself (see ledger.ts). Payouts round
 * down to 0.0001 coin, so rounding never creates coins. Timestamps are Unix
 * milliseconds.
 */

const coins = customType<{ data: number, driverData: number }>({
    dataType: () => 'integer',
    toDriver: value => toUnits(value),
    fromDriver: value => fromUnits(Number(value))
})

const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`)

/**
 * A hub account as the casino knows it. The id is the hub user id (the launch
 * token's `sub`); name, image and title mirror the token at each launch.
 * `coins` and `peak_coins` only move through server/utils/ledger.ts.
 */
export const players = sqliteTable('players', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    image: text('image'),
    title: text('title'),
    // 'hub' players arrived with a launch token and exist at the hub; 'dev'
    // players come from the dev login and never touch the hub.
    origin: text('origin', { enum: ['hub', 'dev'] }).notNull().default('hub'),
    coins: coins('coins').notNull().default(0),
    // Highest balance ever held (a stat), raised in the same statement as the
    // credit that beats it.
    peakCoins: coins('peak_coins').notNull().default(0),
    // The star level the hub last confirmed, and the ledger row id (`seq`) it
    // was reported with. When starLevel(coins) differs, a report is due.
    starsReported: integer('stars_reported').notNull().default(0),
    starsSeq: integer('stars_seq').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`)
})

/** The coin ledger: one row per credit or debit. Category is the game's plain lowercase name. */
export const coinTransactions = sqliteTable(
    'coin_transactions',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        // Always positive; `type` says which way it moved.
        amount: coins('amount').notNull(),
        type: text('type', { enum: ['credit', 'debit'] }).notNull(),
        category: text('category').notNull(),
        // The player's own money coming back (a crash refund): never income.
        refund: integer('refund', { mode: 'boolean' }).notNull().default(false),
        balanceAfter: coins('balance_after').notNull(),
        createdAt: createdAt()
    },
    table => [index('coin_transactions_player_idx').on(table.playerId, table.id)]
)

/** Launch-token ids already exchanged for a session; a jti is accepted once. */
export const launchTokens = sqliteTable('launch_tokens', {
    jti: text('jti').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull()
}, table => [index('launch_tokens_expires_idx').on(table.expiresAt)])

/**
 * Gem to coin conversions. A row is `pending` before the hub is asked to spend,
 * so a crash between the spend and the credit leaves a row to retry with the
 * same idempotency key (the hub replays it and never charges twice).
 */
export const gemConversions = sqliteTable(
    'gem_conversions',
    {
        id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
        playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        gems: integer('gems').notNull(),
        coins: coins('coins').notNull(),
        status: text('status', { enum: ['pending', 'done', 'failed'] }).notNull().default('pending'),
        idempotencyKey: text('idempotency_key').notNull().unique(),
        spendId: text('spend_id'),
        error: text('error'),
        attempts: integer('attempts').notNull().default(0),
        createdAt: createdAt(),
        settledAt: integer('settled_at', { mode: 'timestamp_ms' })
    },
    table => [index('gem_conversions_status_idx').on(table.status, table.createdAt)]
)

/** One row per player per Amsterdam day. The primary key is the claim guard. */
export const allowanceClaims = sqliteTable(
    'allowance_claims',
    {
        playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        day: text('day').notNull(),
        amount: coins('amount').notNull(),
        createdAt: createdAt()
    },
    table => [primaryKey({ columns: [table.playerId, table.day] })]
)

/**
 * One settled round of any game: stake, payout and a small summary. Written in
 * the same transaction as its ledger rows.
 */
export const gameRounds = sqliteTable(
    'game_rounds',
    {
        id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
        playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        game: text('game').notNull(),
        stake: coins('stake').notNull(),
        payout: coins('payout').notNull(),
        summary: text('summary', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
        createdAt: createdAt()
    },
    table => [index('game_rounds_player_idx').on(table.playerId, table.createdAt)]
)

/**
 * Escrow for the live tables. Every stake (a bet, a double, a call) is debited
 * in the same transaction that writes its row here, and settling or refunding
 * flips the row out of `open` in the same transaction as the payout. The flip
 * is the guard: a row pays out once. Table state lives in memory, so after a
 * restart every row still `open` belonged to a hand that can no longer finish,
 * and the boot sweep refunds it.
 */
export const tableWagers = sqliteTable(
    'table_wagers',
    {
        id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
        playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        // The table's slug, which is also the ledger category.
        game: text('game').notNull(),
        roundId: integer('round_id').notNull(),
        amount: coins('amount').notNull(),
        // What the stake was for: 'bet', 'double', 'split', 'ante', 'call', …
        kind: text('kind').notNull(),
        status: text('status', { enum: ['open', 'settled', 'refunded'] }).notNull().default('open'),
        createdAt: createdAt(),
        closedAt: integer('closed_at', { mode: 'timestamp_ms' })
    },
    table => [index('table_wagers_status_idx').on(table.status, table.createdAt)]
)
