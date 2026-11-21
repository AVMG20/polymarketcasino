// `bun scripts/spinata-rtp.ts [rounds] [bet] [seed] [buys]`: paid spin RTP (lines,
// scatters, piñata prize and free spins apart), feature rate, buy RTP and max
// win, paid in whole coins like the server.
import { seededRng } from '../shared/rng'
import { playSpinata, SPN_BUY_BONUS_COST, spinataStake } from '../shared/slots/spinata'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(2_000_000)
const buyRounds = Number(process.argv[5] ?? 300_000)
const rng = seededRng(seed)

const spins = new Tally()
let lines = 0
let scatters = 0
let prizes = 0
let features = 0
let featureWin = 0
let capped = 0
for (let i = 0; i < rounds; i++) {
    const result = playSpinata(rng, bet)
    spins.add(bet, result.payout)
    lines += result.lines.reduce((sum, w) => sum + w.pay, 0) / 50
    scatters += result.basePayout / bet - result.lines.reduce((sum, w) => sum + w.pay, 0) / 50
    prizes += result.bonusPrizePayout / bet
    if (result.freeSpinsTriggered) {
        features++
        featureWin += (result.freeSpinsPayout + result.pinataPotTotal) / bet
    }
    if (result.capped) capped++
}

const buys = new Tally()
let buyWin = 0
for (let i = 0; i < buyRounds; i++) {
    const result = playSpinata(rng, bet, { feature: 'buyBonus' })
    buys.add(spinataStake(bet, { feature: 'buyBonus' }), result.payout)
    buyWin += result.win
}

const pct = (x: number, n: number) => `${(100 * x / n).toFixed(2)}%`
console.log(`spinata at bet ${bet}, seed ${seed}`)
console.log(spins.line('paid spins'))
console.log(`${''.padEnd(18)} lines ${pct(lines, rounds)}  scatters ${pct(scatters, rounds)}  piñata prize ${pct(prizes, rounds)}  `
    + `free spins ${pct(featureWin, rounds)} (1 in ${features ? Math.round(rounds / features) : '∞'}, avg ${(featureWin / Math.max(1, features)).toFixed(1)}×)  capped ${capped}`)
console.log(buys.line(`buy at ${SPN_BUY_BONUS_COST}×`))
console.log(`${''.padEnd(18)} avg round ${(buyWin / buyRounds).toFixed(2)}× bet`)
