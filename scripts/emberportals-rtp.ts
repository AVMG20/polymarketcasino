// `bun scripts/emberportals-rtp.ts [rounds] [bet] [seed] [buys]`: RTP of paid
// spins, ante spins and feature buys, hit rate, feature rate and max win.
// Feature buys are high variance: judge the buy price on 100k+ buys.
import { seededRng } from '../shared/rng'
import { emberPortalsPayout, emberPortalsStake, EP_PAY_SCALE, playEmberPortals, type EpMode } from '../shared/slots/emberportals'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(300_000)
const buyRounds = Number(process.argv[5] ?? 100_000)
const rng = seededRng(seed)

function run(mode: EpMode, count: number) {
    const tally = new Tally()
    let exact = 0
    let features = 0
    let featureWin = 0
    let baseWin = 0
    let capped = 0
    for (let i = 0; i < count; i++) {
        const result = playEmberPortals(rng, mode)
        tally.add(emberPortalsStake(mode, bet), emberPortalsPayout(result, bet))
        exact += result.win
        baseWin += result.base.win
        if (result.capped) capped++
        if (result.freeSpins) {
            features++
            featureWin += result.freeSpins.total
        }
    }
    const cost = emberPortalsStake(mode, bet) / bet
    console.log(tally.line(mode === 'buy' ? 'buy' : `${mode} spins`))
    console.log(`${''.padEnd(18)} exact rtp ${(100 * exact / count / cost).toFixed(2)}%  base ${(100 * baseWin / count / cost).toFixed(2)}%  `
        + `feature 1 in ${features ? Math.round(count / features) : '∞'}, avg ${(featureWin / Math.max(1, features)).toFixed(1)}×  capped ${capped}`)
}

console.log(`emberportals at bet ${bet}, seed ${seed}, pay scale ${EP_PAY_SCALE}`)
run('normal', rounds)
run('ante', rounds)
run('buy', buyRounds)
