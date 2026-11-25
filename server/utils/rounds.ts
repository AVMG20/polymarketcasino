import { gameRounds } from '../database/schema'
import { formatCoins, isCoinAmount, MAX_COINS, normalizeCoins } from '../../shared/money'
import { cryptoRng } from '../../shared/rng'
import { coinTransaction } from './ledger'
import { serverGame } from './games'
import { ownStarChange, type StarChange } from './stars'
import { hostHasGame, parseHost } from './social'
import { recordMissions } from './missions'
import { roundMissionEvents } from '../../shared/missions'
import { advanceCasino, notBuiltError } from './tycoon'
import { payRakeback } from './rakeback'

export interface RoundResponse {
    roundId: string
    game: string
    stake: number
    payout: number
    result: unknown
    /** The coin balance after the round. Apply it once the client's animation is done. */
    balance: number
    /** The star level change this round caused (a casino goal reached), once the hub confirmed it. */
    stars: StarChange | null
    /** The chip balance after the round (every payout is chips). */
    chips: number
    /** The stake's two parts: coins first, then chips for the rest. */
    stakeCoins: number
    stakeChips: number
    /** The round's payout, paid in chips (0 on a loss); the same number as `payout`. */
    chipsEarned: number
    /** The rakeback the player got on the stake, in chips (0 when it went to the casino they visit); `chips` includes it. */
    rakeback: number
}

/**
 * Play and settle one round. The outcome is decided first (pure, CSPRNG), then
 * stake and payout land in one immediate transaction: the debit's
 * `coins >= stake` (or `chips >= stake`) guard is what enforces
 * affordability, so a round the player can't cover never pays. No pre-check,
 * no read-then-write.
 *
 * Economy v2: the stake is paid from coins first, then chips for whatever
 * coins don't cover (each part a guarded debit), and the whole payout, stake
 * included, is paid in **chips**, in the same transaction. A `funding` field
 * from an older client is ignored. The game must be built in My Casino (403
 * otherwise). The stake's rakeback (1% in chips) lands in the same
 * transaction: the player's, or the host's when played in their casino.
 */
export interface PlayBody {
    bet?: unknown
    options?: unknown
    /** Ignored: clients from before the coins-then-chips split still send it. */
    funding?: unknown
    /** The casino the player is visiting (a player id): its games may be played too. The player's own coins and chips pay. */
    host?: unknown
}

export async function playRound(playerId: string, slug: string, body: PlayBody): Promise<RoundResponse> {
    const game = serverGame(slug)
    if (!game) throw createError({ statusCode: 404, statusMessage: 'Unknown game' })

    const options = body.options && typeof body.options === 'object' && !Array.isArray(body.options) ? body.options as Record<string, unknown> : {}
    const host = parseHost(body.host)
    // A bet is a JSON number (no strings, arrays or booleans that Number()
    // would coerce) with at most four decimals.
    const bet = game.stakeFromOptions ? 0 : body.bet
    if (typeof bet !== 'number' || (!game.stakeFromOptions && (!isCoinAmount(bet) || bet < game.info.minBet || bet > game.info.maxBet))) {
        throw createError({ statusCode: 400, statusMessage: `Bet between ${formatCoins(game.info.minBet)} and ${formatCoins(game.info.maxBet)} coins, at most 4 decimals` })
    }

    let outcome
    try {
        outcome = game.play({ bet: normalizeCoins(bet), options, rng: cryptoRng })
    } catch (error) {
        if (error instanceof RangeError) throw createError({ statusCode: 400, statusMessage: error.message })
        throw error
    }
    // Every implementation bounds its own stake (bet × buy cost, or the sum of a layout).
    if (!isCoinAmount(outcome.stake) || outcome.stake <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'Stake out of range' })
    }
    // A win above MAX_COINS (limbo's top target on the top bet) pays MAX_COINS: the chip ledger refuses more.
    const won = Math.min(MAX_COINS, outcome.payout)
    // A payout past four decimals is a rules bug (it must go through payFor/roundCoins), not a player error.
    if (!isCoinAmount(won)) throw new Error(`${slug} paid ${outcome.payout}, not a coin amount`)
    // Snap off float noise (0.1 × 3) so the response and game_rounds read clean.
    const stake = normalizeCoins(outcome.stake)
    const payout = normalizeCoins(won)

    const { value, stars } = await coinTransaction((coins) => {
        const casino = advanceCasino(coins.tx, playerId)
        // Played in the casino the player is visiting (it has the game built): its owner gets the rakeback.
        const hosted = !!host && host !== playerId && hostHasGame(host, slug, coins.tx)
        // Built in the player's own casino, or in the one they are visiting.
        if ((casino.games[slug] ?? 0) < 1 && !hosted) throw notBuiltError(slug)

        const paid = coins.stake({ playerId, amount: stake, category: slug })
        const afterWin = payout > 0 ? coins.creditChips({ playerId, amount: payout, reason: `win:${slug}` }) : paid.chipBalance
        const back = payRakeback(coins, { playerId, game: slug, stake, host: hosted ? host : null })
        const chips = back.chipBalance ?? afterWin
        const round = coins.tx.insert(gameRounds).values({
            playerId,
            game: slug,
            stake,
            stakeChips: paid.chips,
            payout,
            funding: paid.coins > 0 ? 'coins' : 'chips',
            summary: outcome.summary
        }).returning({ id: gameRounds.id }).get()
        recordMissions(coins.tx, playerId, roundMissionEvents({ playerId, game: slug, stake, payout, multiple: outcome.multiple, host }))
        return { roundId: round.id, balance: paid.balance, chips, chipsEarned: payout, rakeback: back.rakeback, stakeCoins: paid.coins, stakeChips: paid.chips }
    }, playerId)

    // The unit may have moved the host's chips too: theirs is reported in the background, the response carries the player's own.
    return { ...value, game: slug, stake, payout, result: outcome.result, stars: ownStarChange(playerId, stars) }
}
