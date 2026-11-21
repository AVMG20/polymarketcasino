import { parseDiceOptions, playDice } from '#shared/games/dice'
import { parseLimboOptions, playLimbo } from '#shared/games/limbo'
import { GAMES, type GameInfo } from '#shared/games/registry'
import { parseRouletteBets, playRoulette, totalStake } from '#shared/games/roulette'
import type { Rng } from '#shared/rng'
import { playSlot, SLOT_CONFIGS, slotPayout, type SlotConfig } from '#shared/slots'

/**
 * The server half of every listed game: validate the player's options, play
 * with the server's RNG, and say what was staked and what comes back. Pure:
 * settling coins is rounds.ts's job.
 */

export interface PlayInput {
    bet: number
    options: Record<string, unknown>
    rng: Rng
}

export interface PlayOutcome<T = unknown> {
    stake: number
    payout: number
    /** Sent to the client to replay. */
    result: T
    /** Kept with the round in game_rounds. */
    summary: Record<string, unknown>
}

export interface ServerGame {
    info: GameInfo
    /** The stake comes from the options (a roulette layout); the `bet` field is ignored. */
    stakeFromOptions?: boolean
    /** Throws RangeError for bad options; rounds.ts turns that into a 400. */
    play(input: PlayInput): PlayOutcome
}

function slotGame(info: GameInfo, config: SlotConfig): ServerGame {
    return {
        info,
        play({ bet, options, rng }) {
            const buy = options.buy === true
            if (buy && !config.buyCost) throw new RangeError('This slot has no feature buy')
            const outcome = playSlot(config, rng, { buy })
            return {
                stake: buy ? bet * config.buyCost! : bet,
                payout: slotPayout(outcome, bet),
                result: outcome,
                summary: { bet, buy, win: outcome.win, freeSpins: outcome.freeSpins.length, capped: outcome.capped }
            }
        }
    }
}

function info(slug: string): GameInfo {
    const game = GAMES.find(g => g.slug === slug)
    if (!game) throw new Error(`${slug} is not in the registry`)
    return game
}

const implementations: Record<string, ServerGame> = {
    spinata: slotGame(info('spinata'), SLOT_CONFIGS.spinata!),
    trashpanda: slotGame(info('trashpanda'), SLOT_CONFIGS.trashpanda!),
    candyrush: slotGame(info('candyrush'), SLOT_CONFIGS.candyrush!),

    dice: {
        info: info('dice'),
        play({ bet, options, rng }) {
            const result = playDice(rng, parseDiceOptions(options))
            const payout = result.won ? Math.floor(bet * result.multiplier) : 0
            return { stake: bet, payout, result, summary: { ...result } }
        }
    },

    limbo: {
        info: info('limbo'),
        play({ bet, options, rng }) {
            const result = playLimbo(rng, parseLimboOptions(options))
            const payout = result.won ? Math.floor(bet * result.target) : 0
            return { stake: bet, payout, result, summary: { ...result } }
        }
    },

    roulette: {
        info: info('roulette'),
        // The stake is the sum of the bets on the layout.
        stakeFromOptions: true,
        play({ options, rng }) {
            const bets = parseRouletteBets(options.bets)
            const stake = totalStake(bets)
            const { minBet, maxBet } = this.info
            if (bets.some(bet => bet.amount < minBet)) throw new RangeError(`Every bet is at least ${minBet} coins`)
            if (stake > maxBet) throw new RangeError(`At most ${maxBet.toLocaleString('en-US')} coins per spin`)
            const result = playRoulette(rng, bets)
            const payout = result.bets.reduce((sum, b) => sum + b.payout, 0)
            return { stake, payout, result, summary: { pocket: result.pocket, bets: bets.length } }
        }
    }
}

// Every registry entry has an implementation and vice versa. Live tables
// live in server/utils/tables/ instead (and must not have a play endpoint).
for (const game of GAMES) {
    if (!game.live && !implementations[game.slug]) throw new Error(`No server implementation for ${game.slug}`)
    if (game.live && implementations[game.slug]) throw new Error(`${game.slug} is a live table and has no round endpoint`)
}
for (const slug of Object.keys(implementations)) {
    if (!GAMES.some(game => game.slug === slug)) throw new Error(`${slug} is implemented but not in the registry`)
}

export function serverGame(slug: string): ServerGame | undefined {
    return implementations[slug]
}
