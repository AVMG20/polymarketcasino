// `bun scripts/casino-holdem-rtp.ts [hands] [bet] [seed]`: ante/call with the
// simple calling strategy (per unit of ante, and per total action), and AA bonus.
import { faceOf, Shoe } from '../shared/tables/cards'
import { bestHand, CH_CALL_MULTIPLIER, chShouldCall, evaluateFive, resolveCh } from '../shared/tables/casino-holdem'
import { seededRng } from '../shared/rng'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(1_000_000)
const shoe = new Shoe(seededRng(seed), 1, 0)
const perAnte = new Tally()
const aa = new Tally()
let action = 0
let returned = 0
let folds = 0
for (let i = 0; i < rounds; i++) {
    shoe.shuffle()
    const hole = [shoe.draw(), shoe.draw()].map(faceOf)
    const dealerHole = [shoe.draw(), shoe.draw()].map(faceOf)
    const board = [shoe.draw(), shoe.draw(), shoe.draw(), shoe.draw(), shoe.draw()].map(faceOf)
    const call = chShouldCall(hole, board.slice(0, 3))
    if (!call) folds++
    const dealer = bestHand([...dealerHole, ...board])
    const aaHand = evaluateFive([...hole, ...board.slice(0, 3)])
    const main = resolveCh(
        { ante: bet, call: call ? bet * CH_CALL_MULTIPLIER : 0, aa: 0 },
        { folded: !call, player: call ? bestHand([...hole, ...board]) : null, dealer, aa: null }
    )
    perAnte.add(bet, main.payout)
    action += main.staked
    returned += main.payout
    aa.add(bet, resolveCh({ ante: 0, call: 0, aa: bet }, { folded: true, player: null, dealer, aa: aaHand }).payout)
}
console.log(`${'ante+call'.padEnd(18)} rtp ${(100 * returned / action).toFixed(2)}% of all wagered, house edge ${(100 * (action - returned) / perAnte.staked).toFixed(2)}% of the ante`)
console.log(`fold ${(100 * folds / rounds).toFixed(1)}%`)
console.log(aa.line('aa bonus'))
