// `bun scripts/candymadness-rtp.ts [rounds] [bet] [seed] [buys]`: RTP of the
// plain spin, Bonus Hunter and the free spins buy, with hit rate, bonus rate
// and max win. Feature buys are high variance: judge them on 100k+ buys.
import { payFor } from '../shared/money'
import { candyMadnessStake, CM_MAX_WIN_MULT, playCandyMadness, type CandyFeature } from '../shared/games/candymadness'
import { seededRng } from '../shared/rng'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(1_000_000)
const buys = Number(process.argv[5] ?? 100_000)
const rng = seededRng(seed)

function run(label: string, feature: CandyFeature | null, n: number) {
    const tally = new Tally()
    let bonuses = 0
    let capped = 0
    const started = performance.now()
    for (let i = 0; i < n; i++) {
        const result = playCandyMadness(rng, { feature })
        tally.add(candyMadnessStake(bet, feature), payFor(bet, result.win))
        if (result.bonus) bonuses++
        if (result.capped) capped++
    }
    console.log(`${tally.line(label)}  bonus 1 in ${bonuses ? (n / bonuses).toFixed(0) : '∞'}  capped ${capped}  (${((performance.now() - started) / 1000).toFixed(0)}s)`)
}

console.log(`max win ${CM_MAX_WIN_MULT}× bet`)
run('spin', null, rounds)
run('bonus hunter', 'bonusHunt', Math.max(1, Math.floor(rounds / 4)))
run('buy free spins', 'buyFreeSpins', buys)
