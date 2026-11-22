import { candyMadnessStake, parseCandyMadnessOptions, playCandyMadness } from '#shared/games/candymadness'
import { parseDiceOptions, playDice } from '#shared/games/dice'
import { parseLimboOptions, playLimbo } from '#shared/games/limbo'
import { parseMagicHandsOptions, playMagicHands } from '#shared/games/magichands'
import { parsePolyMastersOptions, playPolyMasters } from '#shared/games/polymasters'
import { GAMES, type GameInfo } from '#shared/games/registry'
import { parseRouletteBets, playRoulette, totalStake } from '#shared/games/roulette'
import { parseWheelOptions, playWheel } from '#shared/games/wheel'
import { costFor, formatCoins, payFor, sumCoins } from '#shared/money'
import type { Rng } from '#shared/rng'
import { aetherPayout, aetherStake, parseAetherOptions, playAethergates } from '#shared/slots/aethergates'
import { BOS_BUY_COST, playBookOfShadows } from '#shared/slots/bookofshadows'
import { emberPortalsPayout, emberPortalsStake, parseEmberPortalsMode, playEmberPortals } from '#shared/slots/emberportals'
import { FITH_BUY_COST, playFireInTheHole } from '#shared/slots/fireinthehole'
import { parseSpinataOptions, playSpinata, spinataStake } from '#shared/slots/spinata'
import { parseTrashPandaOptions, playTrashPanda, trashPandaStake } from '#shared/slots/trashpanda'
import { parseXenoSlotOptions, playXenoSlot, xenoSlotPayout, xenoSlotStake } from '#shared/slots/xenoslot'

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

/** What a bespoke slot's round says about itself: the total win in × bet, already capped. */
interface BespokeOutcome {
    win: number
    capped: boolean
    /** The free spins / bonus ran this round. */
    feature: boolean
}

/**
 * A slot with its own rules module that only knows a buy flag. The module
 * resolves the whole round in multiples of the bet; this pays it rounded
 * down to 0.0001 coin and bounds the stake (bet, or bet × the integer buy cost).
 */
function bespokeSlot(info: GameInfo, buyCost: number, play: (rng: Rng, buy: boolean) => BespokeOutcome): ServerGame {
    if (!Number.isSafeInteger(buyCost) || buyCost < 1) throw new Error(`${info.slug}: the buy cost must be a whole multiple of the bet`)
    return {
        info,
        play({ bet, options, rng }) {
            if (options.buy !== undefined && typeof options.buy !== 'boolean') throw new RangeError('buy is true or false')
            const buy = options.buy === true
            const outcome = play(rng, buy)
            return {
                stake: buy ? costFor(bet, buyCost) : bet,
                payout: payFor(bet, outcome.win),
                result: outcome,
                summary: { bet, buy, win: outcome.win, feature: outcome.feature, capped: outcome.capped }
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
    spinata: {
        info: info('spinata'),
        play({ bet, options, rng }) {
            const parsed = parseSpinataOptions(options)
            const result = playSpinata(rng, bet, parsed)
            return {
                stake: spinataStake(bet, parsed),
                payout: result.payout,
                result,
                summary: { bet, feature: parsed.feature ?? null, win: result.win, freeSpins: result.freeSpinsTriggered, capped: result.capped }
            }
        }
    },
    trashpanda: {
        info: info('trashpanda'),
        play({ bet, options, rng }) {
            const parsed = parseTrashPandaOptions(options)
            const result = playTrashPanda(rng, bet, parsed)
            return {
                stake: trashPandaStake(bet, parsed),
                payout: result.payout,
                result,
                summary: { bet, feature: parsed.feature ?? null, win: result.win, dive: result.dive !== null, freeSpins: result.freeSpins?.spins.length ?? 0, capped: result.capped }
            }
        }
    },
    bookofshadows: bespokeSlot(info('bookofshadows'), BOS_BUY_COST, (rng, buy) => playBookOfShadows(rng, { buy })),
    fireinthehole: bespokeSlot(info('fireinthehole'), FITH_BUY_COST, (rng, buy) => playFireInTheHole(rng, { buy })),
    aethergates: {
        info: info('aethergates'),
        play({ bet, options, rng }) {
            const feature = parseAetherOptions(options)
            const result = playAethergates(rng, feature)
            return {
                stake: aetherStake(bet, feature),
                payout: aetherPayout(result, bet),
                result,
                summary: { bet, feature, win: result.totalWinMult, bonus: result.bonusTier, capped: result.capped }
            }
        }
    },
    emberportals: {
        info: info('emberportals'),
        play({ bet, options, rng }) {
            const mode = parseEmberPortalsMode(options)
            const result = playEmberPortals(rng, mode)
            return {
                stake: emberPortalsStake(mode, bet),
                payout: emberPortalsPayout(result, bet),
                result,
                summary: { bet, mode, win: result.win, freeSpins: result.freeSpins?.spins.length ?? 0, capped: result.capped }
            }
        }
    },
    xenoslot: {
        info: info('xenoslot'),
        play({ bet, options, rng }) {
            const { buy } = parseXenoSlotOptions(options)
            const result = playXenoSlot(rng, { buy })
            return {
                stake: xenoSlotStake(bet, buy),
                payout: xenoSlotPayout(result, bet),
                result,
                summary: { bet, buy, win: result.win, bonus: result.bonus !== null, capped: result.capped }
            }
        }
    },

    candymadness: {
        info: info('candymadness'),
        play({ bet, options, rng }) {
            const { feature } = parseCandyMadnessOptions(options)
            const result = playCandyMadness(rng, { feature })
            return {
                stake: candyMadnessStake(bet, feature),
                payout: payFor(bet, result.win),
                result,
                summary: { bet, feature, win: result.win, bonus: !!result.bonus, capped: result.capped }
            }
        }
    },

    polymasters: {
        info: info('polymasters'),
        play({ bet, options, rng }) {
            const { mode } = parsePolyMastersOptions(options)
            const result = playPolyMasters(rng, mode)
            return {
                stake: costFor(bet, result.cost),
                payout: payFor(bet, result.win),
                result,
                summary: { bet, mode, landing: result.landing, win: result.win, events: result.events.length }
            }
        }
    },

    wheel: {
        info: info('wheel'),
        play({ bet, options, rng }) {
            const result = playWheel(rng, parseWheelOptions(options))
            return { stake: bet, payout: payFor(bet, result.multiplier), result, summary: { ...result } }
        }
    },

    magichands: {
        info: info('magichands'),
        // `bet` is one hand; the stake is a hand per placed tile.
        play({ bet, options, rng }) {
            const parsed = parseMagicHandsOptions(options)
            const stake = costFor(bet, parsed.placements.length)
            if (stake > this.info.maxBet) throw new RangeError(`At most ${formatCoins(this.info.maxBet)} coins per round`)
            const result = playMagicHands(rng, parsed)
            return {
                stake,
                payout: payFor(bet, result.win),
                result,
                summary: { bet, hands: parsed.placements.length, winners: result.winners.length, win: result.win }
            }
        }
    },

    dice: {
        info: info('dice'),
        play({ bet, options, rng }) {
            const result = playDice(rng, parseDiceOptions(options))
            const payout = result.won ? payFor(bet, result.multiplier) : 0
            return { stake: bet, payout, result, summary: { ...result } }
        }
    },

    limbo: {
        info: info('limbo'),
        play({ bet, options, rng }) {
            const result = playLimbo(rng, parseLimboOptions(options))
            const payout = result.won ? payFor(bet, result.target) : 0
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
            if (bets.some(bet => bet.amount < minBet)) throw new RangeError(`Every bet is at least ${formatCoins(minBet)} coins`)
            if (stake > maxBet) throw new RangeError(`At most ${formatCoins(maxBet)} coins per spin`)
            const result = playRoulette(rng, bets)
            const payout = sumCoins(result.bets.map(b => b.payout))
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
