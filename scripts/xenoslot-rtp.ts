// `bun scripts/xenoslot-rtp.ts [rounds] [bet] [seed] [buys]`: base RTP (lines and
// Hold & Win apart), feature rate, buy RTP and max win, paid in whole coins.
import { seededRng } from '../shared/rng'
import { playXenoSlot, XS_BUY_COST, xenoSlotPayout, xenoSlotStake } from '../shared/slots/xenoslot'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(2_000_000)
const buyRounds = Number(process.argv[5] ?? 300_000)
const rng = seededRng(seed)

const spins = new Tally()
let lineWin = 0
let bonusWin = 0
let features = 0
let capped = 0
for (let i = 0; i < rounds; i++) {
    const result = playXenoSlot(rng)
    spins.add(bet, xenoSlotPayout(result, bet))
    lineWin += result.baseWin
    if (result.bonus) {
        features++
        bonusWin += Math.min(result.win - result.baseWin, result.bonus.win)
    }
    if (result.capped) capped++
}

const buys = new Tally()
let buyMultiples = 0
for (let i = 0; i < buyRounds; i++) {
    const result = playXenoSlot(rng, { buy: true })
    buys.add(xenoSlotStake(bet, true), xenoSlotPayout(result, bet))
    buyMultiples += result.win
}

console.log(`xenoslot at bet ${bet}, seed ${seed}`)
console.log(spins.line('paid spins'))
console.log(`${''.padEnd(18)} lines ${(100 * lineWin / rounds).toFixed(2)}%  hold & win ${(100 * bonusWin / rounds).toFixed(2)}%  `
    + `feature 1 in ${features ? Math.round(rounds / features) : '∞'}, avg ${(bonusWin / Math.max(1, features)).toFixed(1)}×  capped ${capped}`)
console.log(buys.line(`buy at ${XS_BUY_COST}×`))
console.log(`${''.padEnd(18)} avg bonus ${(buyMultiples / buyRounds).toFixed(2)}× bet`)
