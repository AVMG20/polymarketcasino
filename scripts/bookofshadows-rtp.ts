// `bun scripts/bookofshadows-rtp.ts [rounds] [bet] [seed] [buys]`: RTP, hit rate, feature rate, max win and the buy.
import { payFor } from '../shared/money'
import { seededRng } from '../shared/rng'
import { BOS_BUY_COST, BOS_MAX_WIN, playBookOfShadows } from '../shared/slots/bookofshadows'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(2_000_000)
const rng = seededRng(seed)
const pay = (win: number) => payFor(bet, win)

const spins = new Tally()
let exact = 0
let baseShare = 0
let features = 0
let featureWin = 0
let capped = 0
for (let i = 0; i < rounds; i++) {
    const outcome = playBookOfShadows(rng)
    spins.add(bet, pay(outcome.win))
    exact += outcome.win
    baseShare += outcome.baseWin
    if (outcome.feature) {
        features++
        featureWin += outcome.win - outcome.baseWin
    }
    if (outcome.capped) capped++
}
console.log(`bookofshadows at bet ${bet}, seed ${seed}, max win ${BOS_MAX_WIN}×`)
console.log(spins.line('paid spins'))
console.log(`${''.padEnd(18)} exact rtp ${(100 * exact / rounds).toFixed(2)}% (base grid ${(100 * baseShare / rounds).toFixed(2)}%)  `
    + `feature 1 in ${features ? Math.round(rounds / features) : '∞'}, avg ${(featureWin / Math.max(1, features)).toFixed(1)}×  capped ${capped}`)

// Feature buys are high variance: judge the price on 100k+ of them.
const buyRounds = Number(process.argv[5] ?? 200_000)
const buys = new Tally()
let buyCapped = 0
const buckets = [10, 50, 100, 500, 1000, 5000]
const over = buckets.map(() => 0)
for (let i = 0; i < buyRounds; i++) {
    const outcome = playBookOfShadows(rng, { buy: true })
    buys.add(bet * BOS_BUY_COST, pay(outcome.win))
    if (outcome.capped) buyCapped++
    buckets.forEach((b, j) => {
        if (outcome.win >= b) over[j]!++
    })
}
console.log(buys.line(`buy at ${BOS_BUY_COST}×`))
console.log(`${''.padEnd(18)} capped ${buyCapped}  ${buckets.map((b, j) => `≥${b}× 1 in ${over[j] ? Math.round(buyRounds / over[j]!) : '∞'}`).join('  ')}`)
