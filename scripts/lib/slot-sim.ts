import { seededRng } from '../../shared/rng'
import { playSlot, slotPayout, type SlotConfig } from '../../shared/slots'
import { simArgs, Tally } from './report'

/**
 * Paid spins and feature buys for one slot, paid in whole coins at `bet` like
 * the server does. Pays scale with payScale, so retune by ratio:
 * payScale × target / measured (the max-win cap rarely binds).
 */
export function runSlotSim(config: SlotConfig) {
    const { rounds, bet, seed } = simArgs(300_000)
    const rng = seededRng(seed)
    const spins = new Tally()
    let multiples = 0
    let features = 0
    let featureWin = 0
    for (let i = 0; i < rounds; i++) {
        const outcome = playSlot(config, rng)
        spins.add(bet, slotPayout(outcome, bet))
        multiples += outcome.win
        if (outcome.freeSpins.length) {
            features++
            featureWin += outcome.win
        }
    }
    console.log(`${config.id} at bet ${bet}, seed ${seed}`)
    console.log(spins.line('paid spins'))
    console.log(`${''.padEnd(18)} exact rtp ${(100 * multiples / rounds).toFixed(2)}% (before whole-coin rounding)  `
        + `feature 1 in ${features ? Math.round(rounds / features) : '∞'}, avg ${(featureWin / Math.max(1, features)).toFixed(1)}×`)
    if (config.buyCost) {
        const buys = new Tally()
        // Feature buys are high variance: below ~100k of them the RTP moves by ±1%.
        const buyRounds = Number(process.argv[5] ?? Math.max(20_000, Math.floor(rounds / 10)))
        for (let i = 0; i < buyRounds; i++) {
            buys.add(bet * config.buyCost, slotPayout(playSlot(config, rng, { buy: true }), bet))
        }
        console.log(buys.line(`buy at ${config.buyCost}×`))
    }
}
