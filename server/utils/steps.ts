import { and, eq, lt } from 'drizzle-orm'
import { db, type Tx } from '../database'
import { casinoProfiles, gameRounds, players, stepRounds } from '../database/schema'
import { hilo } from '../../shared/games/hilo'
import { mines } from '../../shared/games/mines'
import { GAMES, type GameInfo } from '../../shared/games/registry'
import type { StepGame, StepState, StepStatus } from '../../shared/games/steps'
import { formatCoins, isCoinAmount, MAX_COINS, normalizeCoins, payFor } from '../../shared/money'
import { cryptoRng, type Rng } from '../../shared/rng'
import { coinTransaction, type CoinWork } from './ledger'
import type { StarChange } from './stars'
import { hostHasGame, parseHost } from './social'
import { recordMissions } from './missions'
import { roundMissionEvents } from '../../shared/missions'
import { advanceCasino, notBuiltError } from './tycoon'

/**
 * Multi-step rounds (Gem Dig, Card Climb): the server half of every game
 * flagged `steps` in the registry. The rules are pure state machines
 * (shared/games/steps.ts); this keeps their state in step_rounds and moves
 * the money, each step one immediate transaction:
 *
 * - **start**: the stake is split coins first, then chips (`coins.stake`)
 *   and debited in the transaction that inserts the `open` row. The partial
 *   unique index (one open round per player and game) refuses a second
 *   start, which rolls the debit back (409).
 * - **act**: reads the open round inside the transaction, applies the move
 *   and writes it back guarded by `status = 'open' AND step = <read step>`.
 *   The client sends the step it saw, so a repeated tap can't land on the
 *   next card (409). A bust settles with nothing; a cleared board or the cap
 *   cashes out on the player's behalf.
 * - **cashout**: flips `open → settled` (same guard) and credits the payout
 *   (bet × multiplier, rounded down) in **chips**, with its game_rounds row,
 *   in one transaction. Parallel cash-outs and moves serialise on the write
 *   lock and the flip; a round pays once.
 *
 * Abandoned rounds stay open: the player finds them again on the game's page
 * (GET /round) and plays on or cashes out. A round nobody touched for
 * ABANDONED_MS is settled by the sweep (server/plugins/step-rounds.ts): with
 * progress it is cashed out at its current multiplier, exactly as the player
 * could have; without any it is refunded, each part of the stake in its own
 * currency.
 */

export const ABANDONED_MS = 24 * 60 * 60_000

type AnyStepGame = StepGame<StepState, unknown>

const STEP_GAMES: Record<string, AnyStepGame> = {
    mines: mines as unknown as AnyStepGame,
    hilo: hilo as unknown as AnyStepGame
}

// Every `steps` game in the registry has rules here and vice versa.
for (const game of GAMES) {
    if (game.steps && !STEP_GAMES[game.slug]) throw new Error(`No step rules for ${game.slug}`)
}
for (const slug of Object.keys(STEP_GAMES)) {
    if (!GAMES.some(game => game.slug === slug && game.steps)) throw new Error(`${slug} has step rules but is not a steps game in the registry`)
}

export function stepGame(slug: string): AnyStepGame | undefined {
    return STEP_GAMES[slug]
}

export interface StepRoundView<V = unknown> {
    id: string
    game: string
    bet: number
    /** The part of the bet paid with chips (the rest was coins). */
    stakeChips: number
    /** Moves made; send it back with the next move. */
    step: number
    status: StepStatus
    /** Cash-out value now, as a multiple of the bet (0 once lost). */
    multiplier: number
    /** What cashing out pays now; what it paid once the round is over. */
    payout: number
    canCashOut: boolean
    view: V
}

export interface StepResponse<V = unknown> {
    round: StepRoundView<V>
    /** Balances after (coins, chips). */
    balance: number
    chips: number
    /** The star level change the round caused (stars follow chips), once the hub confirmed it. */
    stars: StarChange | null
    /** Chips this response paid (the cash-out); 0 otherwise. */
    chipsEarned: number
}

interface Row {
    id: string
    game: string
    bet: number
    stakeChips: number
    step: number
    state: Record<string, unknown>
}

function requireGame(slug: string): { info: GameInfo, rules: AnyStepGame } {
    const rules = STEP_GAMES[slug]
    const info = GAMES.find(game => game.slug === slug)
    if (!rules || !info) throw createError({ statusCode: 404, statusMessage: 'Unknown game' })
    return { info, rules }
}

/** Runs the rules, turning a RangeError (a bad option or move) into a 400. */
function rule<T>(work: () => T): T {
    try {
        return work()
    } catch (error) {
        if (error instanceof RangeError) throw createError({ statusCode: 400, statusMessage: error.message })
        throw error
    }
}

/**
 * What cashing out pays: bet × multiplier, rounded down, never above
 * MAX_COINS (the cap 1,000,000× on the top bet would pass it, and the chip
 * ledger refuses an amount that large, so the round could never close).
 */
function cashValue(bet: number, multiplier: number): number {
    return Math.min(MAX_COINS, payFor(bet, multiplier))
}

function toView(rules: AnyStepGame, row: Pick<Row, 'id' | 'game' | 'bet' | 'stakeChips'>, state: StepState, step: number, paid?: number): StepRoundView {
    const multiplier = rules.multiplier(state)
    return {
        id: row.id,
        game: row.game,
        bet: row.bet,
        stakeChips: row.stakeChips,
        step,
        status: state.status,
        multiplier,
        payout: paid ?? cashValue(row.bet, multiplier),
        canCashOut: rules.canCashOut(state),
        view: rules.view(state)
    }
}

function balances(tx: Tx, playerId: string): { balance: number, chips: number } {
    const row = tx.select({ coins: players.coins, chips: casinoProfiles.chips })
        .from(players)
        .leftJoin(casinoProfiles, eq(casinoProfiles.playerId, players.id))
        .where(eq(players.id, playerId))
        .get()
    return { balance: row?.coins ?? 0, chips: row?.chips ?? 0 }
}

function openRow(tx: Tx, playerId: string, slug: string): Row | null {
    return tx.select({ id: stepRounds.id, game: stepRounds.game, bet: stepRounds.bet, stakeChips: stepRounds.stakeChips, step: stepRounds.step, state: stepRounds.state })
        .from(stepRounds)
        .where(and(eq(stepRounds.playerId, playerId), eq(stepRounds.game, slug), eq(stepRounds.status, 'open')))
        .get() ?? null
}

/**
 * End a round that the rules say is over (lost or cashed): flip it
 * `open → settled` guarded by the step it was read at, pay the cash-out in
 * chips and record it in game_rounds. Returns the payout.
 */
function settle(coins: CoinWork, playerId: string, row: Row, rules: AnyStepGame, state: StepState, now: Date): number {
    const payout = state.status === 'cashed' ? cashValue(row.bet, rules.multiplier(state)) : 0
    const flipped = coins.tx.update(stepRounds)
        .set({ status: 'settled', state: state as unknown as Record<string, unknown>, step: row.step + 1, payout, updatedAt: now, settledAt: now })
        .where(and(eq(stepRounds.id, row.id), eq(stepRounds.status, 'open'), eq(stepRounds.step, row.step)))
        .returning({ id: stepRounds.id })
        .get()
    if (!flipped) throw createError({ statusCode: 409, statusMessage: 'The round has moved on' })
    if (payout > 0) coins.creditChips({ playerId, amount: payout, reason: `win:${row.game}` })
    coins.tx.insert(gameRounds).values({
        playerId,
        game: row.game,
        stake: row.bet,
        stakeChips: row.stakeChips,
        payout,
        funding: row.stakeChips >= row.bet ? 'chips' : 'coins',
        summary: { bet: row.bet, ...rules.summary(state) }
    }).run()
    recordMissions(coins.tx, playerId, roundMissionEvents({ playerId, game: row.game, stake: row.bet, payout }), now.getTime())
    return payout
}

/** POST /api/games/<slug>/start: stake and deal a new round. */
export async function startStepRound(playerId: string, slug: string, body: { bet?: unknown, options?: unknown, host?: unknown }, rng: Rng = cryptoRng): Promise<StepResponse> {
    const { info, rules } = requireGame(slug)
    const bet = body.bet
    if (typeof bet !== 'number' || !isCoinAmount(bet) || bet < info.minBet || bet > info.maxBet) {
        throw createError({ statusCode: 400, statusMessage: `Bet between ${formatCoins(info.minBet)} and ${formatCoins(info.maxBet)} coins, at most 4 decimals` })
    }
    const options = body.options && typeof body.options === 'object' && !Array.isArray(body.options) ? body.options as Record<string, unknown> : {}
    const stake = normalizeCoins(bet)
    // The casino the player is visiting: its games may be played too.
    const host = parseHost(body.host)
    const state = rule(() => rules.start(rng, options))

    const { value, stars } = await coinTransaction((coins) => {
        const casino = advanceCasino(coins.tx, playerId)
        if ((casino.games[slug] ?? 0) < 1 && !(host && hostHasGame(host, slug, coins.tx))) throw notBuiltError(slug)
        const paid = coins.stake({ playerId, amount: stake, category: slug })
        const row = coins.tx.insert(stepRounds)
            .values({ playerId, game: slug, bet: stake, stakeChips: paid.chips, state: state as unknown as Record<string, unknown> })
            .onConflictDoNothing()
            .returning({ id: stepRounds.id })
            .get()
        // The unique index holds one open round per player and game; throwing rolls the stake back.
        if (!row) throw createError({ statusCode: 409, statusMessage: 'Finish your open round first' })
        // A round started in someone else's casino counts toward the visit mission.
        if (host && host !== playerId) recordMissions(coins.tx, playerId, ['visit'])
        const round = toView(rules, { id: row.id, game: slug, bet: stake, stakeChips: paid.chips }, state, 0)
        return { round, balance: paid.balance, chips: paid.chipBalance }
    })
    return { ...value, stars: stars[0] ?? null, chipsEarned: 0 }
}

/** POST /api/games/<slug>/act: one move on the open round, made on the step the client saw. */
export async function actStepRound(playerId: string, slug: string, body: { step?: unknown, action?: unknown }, rng: Rng = cryptoRng): Promise<StepResponse> {
    const { rules } = requireGame(slug)
    const action = body.action && typeof body.action === 'object' && !Array.isArray(body.action) ? body.action as Record<string, unknown> : null
    if (!action) throw createError({ statusCode: 400, statusMessage: 'Which move?' })
    if (typeof body.step !== 'number' || !Number.isInteger(body.step)) throw createError({ statusCode: 400, statusMessage: 'Send the step you are on' })
    const seen = body.step

    const { value, stars } = await coinTransaction((coins) => {
        const now = new Date()
        const row = openRow(coins.tx, playerId, slug)
        if (!row) throw createError({ statusCode: 409, statusMessage: 'No open round' })
        if (row.step !== seen) throw createError({ statusCode: 409, statusMessage: 'The round has moved on' })
        const next = rule(() => rules.act(row.state as unknown as StepState, action, rng))
        if (next.status !== 'open') {
            const payout = settle(coins, playerId, row, rules, next, now)
            return { round: toView(rules, row, next, row.step + 1, payout), chipsEarned: payout, ...balances(coins.tx, playerId) }
        }
        const moved = coins.tx.update(stepRounds)
            .set({ state: next as unknown as Record<string, unknown>, step: row.step + 1, updatedAt: now })
            .where(and(eq(stepRounds.id, row.id), eq(stepRounds.status, 'open'), eq(stepRounds.step, row.step)))
            .returning({ id: stepRounds.id })
            .get()
        if (!moved) throw createError({ statusCode: 409, statusMessage: 'The round has moved on' })
        return { round: toView(rules, row, next, row.step + 1), chipsEarned: 0, ...balances(coins.tx, playerId) }
    })
    return { ...value, stars: stars[0] ?? null }
}

/** POST /api/games/<slug>/cashout: end the open round and pay its multiplier in chips. */
export async function cashOutStepRound(playerId: string, slug: string, body: { step?: unknown } = {}): Promise<StepResponse> {
    const { rules } = requireGame(slug)
    if (body.step !== undefined && (typeof body.step !== 'number' || !Number.isInteger(body.step))) throw createError({ statusCode: 400, statusMessage: 'Bad step' })

    const { value, stars } = await coinTransaction((coins) => {
        const row = openRow(coins.tx, playerId, slug)
        if (!row) throw createError({ statusCode: 409, statusMessage: 'No open round' })
        if (body.step !== undefined && row.step !== body.step) throw createError({ statusCode: 409, statusMessage: 'The round has moved on' })
        const state = row.state as unknown as StepState
        const cashed = rule(() => rules.cashOut(state))
        const payout = settle(coins, playerId, row, rules, cashed, new Date())
        return { round: toView(rules, row, cashed, row.step + 1, payout), chipsEarned: payout, ...balances(coins.tx, playerId) }
    })
    return { ...value, stars: stars[0] ?? null }
}

/** GET /api/games/<slug>/round: the player's open round, or null. */
export function currentStepRound(playerId: string, slug: string): StepRoundView | null {
    const { rules } = requireGame(slug)
    const row = db.select({ id: stepRounds.id, game: stepRounds.game, bet: stepRounds.bet, stakeChips: stepRounds.stakeChips, step: stepRounds.step, state: stepRounds.state })
        .from(stepRounds)
        .where(and(eq(stepRounds.playerId, playerId), eq(stepRounds.game, slug), eq(stepRounds.status, 'open')))
        .get()
    return row ? toView(rules, row, row.state as unknown as StepState, row.step) : null
}

/**
 * Settle open rounds nobody touched since `olderThan`: cash out the ones
 * with progress at their current multiplier, refund the rest (each part of
 * the stake in its own currency). One transaction per round, each guarded
 * by the step it read. Returns how many it closed.
 */
export async function settleAbandonedRounds(olderThan: Date): Promise<number> {
    const stale = db.select({ id: stepRounds.id, playerId: stepRounds.playerId })
        .from(stepRounds)
        .where(and(eq(stepRounds.status, 'open'), lt(stepRounds.updatedAt, olderThan)))
        .all()
    let closed = 0
    for (const { id, playerId } of stale) {
        // One bad row must not hold up the rest: log it and move on (it stays open for the next sweep).
        try {
            if (await settleAbandoned(id, playerId, olderThan)) closed++
        } catch (error) {
            console.error(`[steps] settling abandoned round ${id} of ${playerId} failed`, error)
        }
    }
    return closed
}

/** Settle one abandoned round in its own transaction. False when it moved or closed since the scan. */
async function settleAbandoned(id: string, playerId: string, olderThan: Date): Promise<boolean> {
    const { value } = await coinTransaction((coins) => {
        const row = coins.tx.select({ id: stepRounds.id, game: stepRounds.game, bet: stepRounds.bet, stakeChips: stepRounds.stakeChips, step: stepRounds.step, state: stepRounds.state, updatedAt: stepRounds.updatedAt })
            .from(stepRounds)
            .where(and(eq(stepRounds.id, id), eq(stepRounds.status, 'open')))
            .get()
        // Played (or closed) since the scan: leave it.
        if (!row || row.updatedAt >= olderThan) return false
        const rules = STEP_GAMES[row.game]
        if (!rules) return false
        const state = row.state as unknown as StepState
        const now = new Date()
        if (rules.canCashOut(state)) {
            settle(coins, playerId, row, rules, rules.cashOut(state), now)
            return true
        }
        const flipped = coins.tx.update(stepRounds)
            .set({ status: 'refunded', step: row.step + 1, updatedAt: now, settledAt: now })
            .where(and(eq(stepRounds.id, row.id), eq(stepRounds.status, 'open'), eq(stepRounds.step, row.step)))
            .returning({ id: stepRounds.id })
            .get()
        if (!flipped) return false
        const chipPart = row.stakeChips
        const coinPart = normalizeCoins(row.bet - chipPart)
        if (coinPart > 0) coins.credit({ playerId, amount: coinPart, category: row.game, refund: true })
        if (chipPart > 0) coins.creditChips({ playerId, amount: chipPart, reason: `refund:${row.game}` })
        return true
    })
    return value
}
