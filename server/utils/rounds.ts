import { gameRounds } from '../database/schema'
import { formatCoins, isCoinAmount, normalizeCoins } from '../../shared/money'
import { cryptoRng } from '../../shared/rng'
import { coinTransaction } from './ledger'
import { serverGame } from './games'
import type { StarChange } from './stars'

export interface RoundResponse {
    roundId: string
    game: string
    stake: number
    payout: number
    result: unknown
    /** Balance after the round. Apply it once the client's animation is done. */
    balance: number
    /** The star level change this round caused, once the hub confirmed it. */
    stars: StarChange | null
}

/**
 * Play and settle one round. The outcome is decided first (pure, CSPRNG), then
 * stake and payout land in one immediate transaction: the debit's
 * `coins >= stake` guard is what enforces affordability, so a round the player
 * can't cover never pays. No pre-check, no read-then-write.
 */
export async function playRound(playerId: string, slug: string, body: { bet?: unknown, options?: unknown }): Promise<RoundResponse> {
    const game = serverGame(slug)
    if (!game) throw createError({ statusCode: 404, statusMessage: 'Unknown game' })

    const options = body.options && typeof body.options === 'object' && !Array.isArray(body.options) ? body.options as Record<string, unknown> : {}
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
    // A payout past four decimals is a rules bug (it must go through payFor/roundCoins), not a player error.
    if (!isCoinAmount(outcome.payout)) throw new Error(`${slug} paid ${outcome.payout}, not a coin amount`)
    // Snap off float noise (0.1 × 3) so the response and game_rounds read clean.
    const stake = normalizeCoins(outcome.stake)
    const payout = normalizeCoins(outcome.payout)

    const { value, stars } = await coinTransaction((coins) => {
        let after = coins.debit({ playerId, amount: stake, category: slug })
        if (payout > 0) after = coins.credit({ playerId, amount: payout, category: slug })
        const round = coins.tx.insert(gameRounds).values({
            playerId,
            game: slug,
            stake,
            payout,
            summary: outcome.summary
        }).returning({ id: gameRounds.id }).get()
        return { roundId: round.id, balance: after.coins }
    })

    return { ...value, game: slug, stake, payout, result: outcome.result, stars: stars[0] ?? null }
}
