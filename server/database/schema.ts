import { sql } from 'drizzle-orm'
import { customType, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
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

/**
 * A JSON list of running campaigns ([{ id, until }]). A malformed value reads
 * as [] instead of throwing, so one bad row can't lock a player out of their
 * casino (the code drops unknown kinds itself).
 */
const campaignList = customType<{ data: { id: string, until: number }[], driverData: string }>({
    dataType: () => 'text',
    toDriver: value => JSON.stringify(value),
    fromDriver: (value) => {
        try {
            const parsed: unknown = JSON.parse(String(value))
            return Array.isArray(parsed) ? parsed.filter((c): c is { id: string, until: number } => !!c && typeof c === 'object' && typeof c.id === 'string' && typeof c.until === 'number') : []
        } catch {
            return []
        }
    }
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
    // The star level the hub last confirmed, and the `seq` it was reported
    // with (STAR_SEQ_BASE + a chip ledger id, server/utils/stars.ts; coin
    // ledger ids before economy v2). Stars follow the chip balance
    // (casino_profiles.chips): when starLevel(chips) differs, a report is due.
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
    table => [
        index('coin_transactions_player_idx').on(table.playerId, table.id),
        // The stats page: the balance at each day's end is one seek per day,
        // and the allowance and conversion totals a seek per category.
        index('coin_transactions_player_time_idx').on(table.playerId, table.createdAt),
        index('coin_transactions_player_category_idx').on(table.playerId, table.category, table.createdAt)
    ]
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
        // The part of `stake` paid with My Casino chips; the rest was coins
        // (economy v2: coins first, then chips). The payout is always chips.
        stakeChips: coins('stake_chips').notNull().default(0),
        // Legacy (rounds before economy v2 picked one currency): 'chips' when
        // the whole stake was chips, else 'coins'. stake_chips is the truth.
        funding: text('funding', { enum: ['coins', 'chips'] }).notNull().default('coins'),
        createdAt: createdAt()
    },
    // Covers the stats page: a player's rounds of one game over a day are one
    // range of this index, summed without reading the rows (or their JSON).
    table => [index('game_rounds_player_game_idx').on(table.playerId, table.game, table.createdAt, table.stake, table.stakeChips, table.payout)]
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
        // The part of `amount` paid with chips (coins first, then chips); a
        // refund hands each part back in its own currency. The payout is
        // always chips.
        amountChips: coins('amount_chips').notNull().default(0),
        status: text('status', { enum: ['open', 'settled', 'refunded'] }).notNull().default('open'),
        createdAt: createdAt(),
        closedAt: integer('closed_at', { mode: 'timestamp_ms' })
    },
    table => [index('table_wagers_status_idx').on(table.status, table.createdAt)]
)

/**
 * My Casino: one row per player, created on first use (shared/tycoon.ts).
 * `chips` only moves through server/utils/chips.ts, in the same transaction
 * as its chip_transactions row; the star level follows it. The cage holds
 * `cage_stored` **coins** (guest income) at `cage_at`; guest income since
 * then is worked out on read. Finished
 * constructions are applied on every read and action (server/utils/tycoon.ts).
 */
export const casinoProfiles = sqliteTable('casino_profiles', {
    playerId: text('player_id').primaryKey().references(() => players.id, { onDelete: 'cascade' }),
    chips: coins('chips').notNull().default(0),
    zones: text('zones', { mode: 'json' }).$type<string[]>().notNull(),
    games: text('games', { mode: 'json' }).$type<Record<string, number>>().notNull(),
    upgrades: text('upgrades', { mode: 'json' }).$type<Record<string, number>>().notNull(),
    golden: text('golden', { mode: 'json' }).$type<string[]>().notNull(),
    /** 1, or 2 with the gem builder hired. The Construction Crew (upgrades.crew) adds its builder on top on read. */
    builders: integer('builders').notNull().default(1),
    cageStored: coins('cage_stored').notNull().default(0),
    cageAt: integer('cage_at', { mode: 'timestamp_ms' }).notNull(),
    rushUntil: integer('rush_until', { mode: 'timestamp_ms' }),
    /** The running ad campaign that ends first and when (kept for old readers; `campaigns` has them all). */
    campaign: text('campaign'),
    campaignUntil: integer('campaign_until', { mode: 'timestamp_ms' }),
    /** Every ad campaign running, one per kind: [{ id, until (ms) }]. */
    campaigns: campaignList('campaigns').notNull().default([]),
    /** What the avatar wears, { hat, outfit, accessory } item ids (shared/cosmetics.ts); {} = the defaults. */
    avatar: text('avatar', { mode: 'json' }).$type<Record<string, string>>().notNull().default({}),
    /** The skin on each zone, { zone: skin }; missing = classic. */
    skins: text('skins', { mode: 'json' }).$type<Record<string, string>>().notNull().default({}),
    /**
     * When the owner last read their casino, and what it looked like then
     * (server/utils/welcome.ts): the "while you were away" card replays the
     * guest income from this snapshot. Null until the first read.
     */
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
    lastSeen: text('last_seen', { mode: 'json' }).$type<Record<string, unknown>>(),
    /**
     * House rules (shared/visitors.ts): the door (open, limit, closed) and the
     * VIP room. `rules_at` is the last change: the next is allowed
     * RULES_COOLDOWN_MS later (the update is guarded on it).
     */
    door: text('door', { enum: ['open', 'limit', 'closed'] }).notNull().default('open'),
    vip: integer('vip', { mode: 'boolean' }).notNull().default(false),
    rulesAt: integer('rules_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt()
})

/**
 * The floor hour by hour (GET /api/tycoon/history, the welcome-back card),
 * written while the cage accrues: accrual covers stretches of one build and
 * one set of rules, so each piece is exact, and the pieces of an hour add up
 * (insert … on conflict add). `*_hours` are guest-hours per tier (seated
 * guests × hours), `covered_ms` the part of the hour they cover, so the
 * average is guest-hours ÷ covered hours. Income is before the cage cap,
 * `lost` what a full cage had no room for. Rows older than HISTORY_KEEP_MS
 * are pruned on write.
 */
export const casinoHistory = sqliteTable(
    'casino_history',
    {
        playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        hour: integer('hour', { mode: 'timestamp_ms' }).notNull(),
        touristHours: real('tourist_hours').notNull().default(0),
        regularHours: real('regular_hours').notNull().default(0),
        highrollerHours: real('highroller_hours').notNull().default(0),
        whaleHours: real('whale_hours').notNull().default(0),
        coveredMs: integer('covered_ms').notNull().default(0),
        income: coins('income').notNull().default(0),
        lost: coins('lost').notNull().default(0)
    },
    table => [primaryKey({ columns: [table.playerId, table.hour] })]
)

/**
 * Running constructions. One per player and thing being built (the unique
 * index is the guard against building it twice); deleting a finished row is
 * the guard that applies it once.
 */
export const casinoConstructions = sqliteTable(
    'casino_constructions',
    {
        id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
        playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        kind: text('kind', { enum: ['zone', 'game', 'upgrade'] }).notNull(),
        target: text('target').notNull(),
        // The level it reaches when done (1 for a zone or a new game).
        level: integer('level').notNull(),
        startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
        readyAt: integer('ready_at', { mode: 'timestamp_ms' }).notNull()
    },
    table => [
        uniqueIndex('casino_constructions_target_idx').on(table.playerId, table.kind, table.target),
        index('casino_constructions_ready_idx').on(table.playerId, table.readyAt)
    ]
)

/**
 * The chip ledger: one row per chip change. `reason` says what moved them:
 * 'bet:dice', 'win:dice', 'refund:blackjack', 'build:zone:main',
 * 'campaign:flyers' (and from before economy v2: 'housecut:dice', 'cage',
 * 'gems:chips'). Its id (plus an offset) is the `seq` star reports use.
 */
export const chipTransactions = sqliteTable(
    'chip_transactions',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        // Always positive; `type` says which way it moved.
        amount: coins('amount').notNull(),
        type: text('type', { enum: ['credit', 'debit'] }).notNull(),
        reason: text('reason').notNull(),
        balanceAfter: coins('balance_after').notNull(),
        createdAt: createdAt()
    },
    table => [index('chip_transactions_player_idx').on(table.playerId, table.id)]
)

/**
 * Gem purchases in My Casino (skips, rushes, the second builder, golden
 * skins, cosmetics; 'chips' is a chip pack from before economy v2, no longer sold).
 * Same flow as gem_conversions: a `pending` row before the hub spends,
 * settled in its own guarded transaction, retried with the same key.
 * `target` is '' when the item has none; one pending purchase per player,
 * item and target (the partial unique index) keeps a double tap from paying
 * twice for one thing. A purchase with nothing left to deliver (a skip that
 * finished on its own, an item owned already) goes `done → refund_due`, then
 * `refunded` once the hub confirms the refund (retried by the sweep), or
 * `refund_failed` when the hub refuses it.
 */
export const gemPurchases = sqliteTable(
    'gem_purchases',
    {
        id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
        playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        item: text('item', { enum: ['skip', 'rush', 'builder', 'chips', 'golden', 'cosmetic'] }).notNull(),
        target: text('target').notNull().default(''),
        gems: integer('gems').notNull(),
        status: text('status', { enum: ['pending', 'done', 'failed', 'refund_due', 'refunded', 'refund_failed'] }).notNull().default('pending'),
        idempotencyKey: text('idempotency_key').notNull().unique(),
        spendId: text('spend_id'),
        error: text('error'),
        attempts: integer('attempts').notNull().default(0),
        createdAt: createdAt(),
        settledAt: integer('settled_at', { mode: 'timestamp_ms' })
    },
    table => [
        index('gem_purchases_status_idx').on(table.status, table.createdAt),
        uniqueIndex('gem_purchases_pending_idx').on(table.playerId, table.item, table.target).where(sql`status = 'pending'`)
    ]
)

/**
 * Multi-step rounds (Gem Dig, Card Climb; server/utils/steps.ts). The stake
 * is debited in the transaction that inserts the `open` row; every move
 * rewrites `state` guarded by `status = 'open' AND step = <the step read>`,
 * and the round ends by flipping `open → settled` (paying the cash-out in
 * chips, or nothing on a bust) or `open → refunded` (an abandoned round with
 * no progress: each part of the stake back in its own currency), in the same
 * transaction as the money. The flip is the guard: a round pays once. One
 * open round per player and game (the partial unique index). `state` holds
 * the secrets (the bomb tiles) and never leaves the server whole.
 */
export const stepRounds = sqliteTable(
    'step_rounds',
    {
        id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
        playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        game: text('game').notNull(),
        bet: coins('bet').notNull(),
        // The part of `bet` paid with chips (coins first, then chips).
        stakeChips: coins('stake_chips').notNull().default(0),
        status: text('status', { enum: ['open', 'settled', 'refunded'] }).notNull().default('open'),
        state: text('state', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
        // Moves made so far: each move bumps it, and its update is guarded by the old value.
        step: integer('step').notNull().default(0),
        payout: coins('payout').notNull().default(0),
        createdAt: createdAt(),
        updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
        settledAt: integer('settled_at', { mode: 'timestamp_ms' })
    },
    table => [
        uniqueIndex('step_rounds_open_idx').on(table.playerId, table.game).where(sql`status = 'open'`),
        index('step_rounds_status_idx').on(table.status, table.updatedAt)
    ]
)

/**
 * Hearts visitors leave on a casino (GET /api/tycoon/visit/:id, POST …/like):
 * one per visitor, casino and Amsterdam day. The primary key is the guard
 * (insert … on conflict do nothing). Hearts are only a count: no coins,
 * chips or gems ever move between players.
 */
export const casinoLikes = sqliteTable(
    'casino_likes',
    {
        ownerId: text('owner_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        visitorId: text('visitor_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        day: text('day').notNull(),
        createdAt: createdAt()
    },
    table => [primaryKey({ columns: [table.ownerId, table.visitorId, table.day] })]
)

/**
 * Cosmetics a player bought (avatar items, zone skins; shared/cosmetics.ts):
 * one row per player and item key, for good. The primary key is the guard
 * (insert … on conflict do nothing), so a burst of buys pays once. Free
 * items are never stored. What is worn lives on casino_profiles.
 */
export const casinoCosmetics = sqliteTable(
    'casino_cosmetics',
    {
        playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        item: text('item').notNull(),
        /** How it was paid: 'chips' or 'gems'. */
        paid: text('paid', { enum: ['chips', 'gems'] }).notNull(),
        createdAt: createdAt()
    },
    table => [primaryKey({ columns: [table.playerId, table.item] })]
)

/**
 * Daily missions (shared/missions.ts, server/utils/missions.ts): three per
 * player and Amsterdam day plus the bonus for clearing all three (`mission`
 * = 'bonus'), assigned on the first read or event of the day. Progress is
 * bumped in the same transaction as the event that made it (a settled round,
 * a collect, a build, a campaign), capped at `target`. The reward (coins) is
 * fixed at assignment. Claiming flips `claimed_at` from null, guarded by
 * `progress >= target`, in the same transaction as the coin credit: a
 * mission pays once.
 */
export const dailyMissions = sqliteTable(
    'daily_missions',
    {
        playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
        day: text('day').notNull(),
        mission: text('mission').notNull(),
        /** Display order: 0-2 the missions, 3 the bonus. */
        slot: integer('slot').notNull(),
        target: integer('target').notNull(),
        progress: integer('progress').notNull().default(0),
        reward: coins('reward').notNull(),
        claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
        createdAt: createdAt()
    },
    table => [primaryKey({ columns: [table.playerId, table.day, table.mission] })]
)
