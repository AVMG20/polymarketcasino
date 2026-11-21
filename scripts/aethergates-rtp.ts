// `bun scripts/aethergates-rtp.ts [rounds] [bet] [seed] [buys]`: RTP of paid
// spins, bonus chance and both feature buys, plus feature rate and max win.
import { seededRng } from '../shared/rng'
import {
    aetherPayout,
    aetherStake,
    AG_BONUS_CHANCE_COST,
    AG_BUY_FREESPINS_COST,
    AG_BUY_SUPERBONUS_COST,
    playAethergates,
    type AetherFeature
} from '../shared/slots/aethergates'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(1_000_000)
// Feature buys are high variance: judge them on 100k+.
const buys = Number(process.argv[5] ?? 100_000)
const rng = seededRng(seed)

function run(label: string, feature: AetherFeature | null, count: number) {
    const tally = new Tally()
    let exact = 0
    let features = 0
    let featureWin = 0
    let capped = 0
    for (let i = 0; i < count; i++) {
        const result = playAethergates(rng, feature)
        tally.add(aetherStake(bet, feature), aetherPayout(result, bet))
        exact += result.totalWinMult
        if (result.capped) capped++
        if (result.bonusTriggered) {
            features++
            featureWin += result.totalWinMult
        }
    }
    const cost = aetherStake(bet, feature) / bet
    console.log(tally.line(label))
    console.log(`${''.padEnd(18)} exact rtp ${(100 * exact / count / cost).toFixed(2)}%  `
        + `feature 1 in ${features ? Math.round(count / features) : '∞'}, avg ${(featureWin / Math.max(1, features)).toFixed(1)}×  capped ${capped}`)
}

console.log(`aethergates at bet ${bet}, seed ${seed}`)
run('paid spins', null, rounds)
run(`bonus chance ${AG_BONUS_CHANCE_COST}×`, 'bonusChance', rounds)
run(`buy ${AG_BUY_FREESPINS_COST}×`, 'buyFreeSpins', buys)
run(`super ${AG_BUY_SUPERBONUS_COST}×`, 'superBonus', buys)
