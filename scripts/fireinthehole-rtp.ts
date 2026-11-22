// `bun scripts/fireinthehole-rtp.ts [rounds] [bet] [seed] [buys]`: RTP, hit rate, bonus rate and max win,
// paid in whole coins like the server.
import { payFor } from '../shared/money'
import { seededRng } from '../shared/rng'
import { FITH_BUY_COST, FITH_MAX_LINES, FITH_MAX_WIN, FITH_STARTING_LINES, playBonus, playFireInTheHole } from '../shared/slots/fireinthehole'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(1_000_000)
const buyRounds = Number(process.argv[5] ?? 200_000)
const rng = seededRng(seed)
const pay = (win: number) => payFor(bet, win)

const spins = new Tally()
let exact = 0
let base = 0
let features = 0
let featureWin = 0
let capped = 0
const triggersAt: number[] = Array(FITH_MAX_LINES + 1).fill(0)
for (let i = 0; i < rounds; i++) {
    const outcome = playFireInTheHole(rng)
    spins.add(bet, pay(outcome.win))
    exact += outcome.win
    base += outcome.basePayout
    if (outcome.feature) {
        features++
        featureWin += outcome.bonus!.totalMultiplier
        triggersAt[outcome.activeLines]!++
    }
    if (outcome.capped) capped++
}

console.log(`fireinthehole at bet ${bet}, seed ${seed}, max win ${FITH_MAX_WIN}×`)
console.log(spins.line('paid spins'))
console.log(`${''.padEnd(18)} exact rtp ${(100 * exact / rounds).toFixed(2)}%  base game ${(100 * base / rounds).toFixed(2)}%  `
    + `bonus 1 in ${features ? Math.round(rounds / features) : '∞'}, avg ${(featureWin / Math.max(1, features)).toFixed(1)}×  capped ${capped}`)

// The bonus dominates the variance. A steadier estimate: the base game's
// share, plus how often the bonus starts at each depth times what a bonus at
// that depth averages over many runs of its own.
const bonusRuns = Math.max(50_000, Math.floor(rounds / 10))
let steady = base / rounds
const depths: string[] = []
for (let lines = FITH_STARTING_LINES; lines <= FITH_MAX_LINES; lines++) {
    if (!triggersAt[lines]) continue
    let sum = 0
    for (let i = 0; i < bonusRuns; i++) sum += Math.min(FITH_MAX_WIN, playBonus(rng, lines).totalMultiplier)
    steady += (triggersAt[lines]! / rounds) * (sum / bonusRuns)
    depths.push(`${lines} rows: 1 in ${Math.round(rounds / triggersAt[lines]!)}, avg ${(sum / bonusRuns).toFixed(1)}×`)
}
console.log(`${''.padEnd(18)} steady rtp ${(100 * steady).toFixed(2)}% (bonus by depth: ${depths.join('; ')})`)

const buys = new Tally()
let buyCapped = 0
for (let i = 0; i < buyRounds; i++) {
    const outcome = playFireInTheHole(rng, { buy: true })
    buys.add(bet * FITH_BUY_COST, pay(outcome.win))
    if (outcome.capped) buyCapped++
}
console.log(`${buys.line(`buy at ${FITH_BUY_COST}×`)}  capped ${buyCapped}`)
