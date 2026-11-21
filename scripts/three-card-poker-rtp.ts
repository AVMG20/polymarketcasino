// `bun scripts/three-card-poker-rtp.ts [hands] [bet] [seed]`: ante/play with
// the Q-6-4 strategy (per unit of ante, and per total action), and pair plus.
import { faceOf, Shoe } from '../shared/tables/cards'
import { evaluateTcp, resolveTcp, tcpShouldPlay } from '../shared/tables/three-card-poker'
import { seededRng } from '../shared/rng'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(2_000_000)
const shoe = new Shoe(seededRng(seed), 1, 0)
const perAnte = new Tally()
const pairPlus = new Tally()
let action = 0
let returned = 0
for (let i = 0; i < rounds; i++) {
    shoe.shuffle()
    const player = [shoe.draw(), shoe.draw(), shoe.draw()].map(faceOf)
    const dealer = [shoe.draw(), shoe.draw(), shoe.draw()].map(faceOf)
    const played = tcpShouldPlay(player)
    const ante = resolveTcp({ ante: bet, pairPlus: 0, played }, evaluateTcp(player), evaluateTcp(dealer))
    perAnte.add(bet, ante.payout)
    action += ante.staked
    returned += ante.payout
    pairPlus.add(bet, resolveTcp({ ante: 0, pairPlus: bet, played: false }, evaluateTcp(player), evaluateTcp(dealer)).payout)
}
console.log(`${'ante+play'.padEnd(18)} rtp ${(100 * returned / action).toFixed(2)}% of all wagered, house edge ${(100 * (action - returned) / perAnte.staked).toFixed(2)}% of the ante`)
console.log(pairPlus.line('pair plus'))
