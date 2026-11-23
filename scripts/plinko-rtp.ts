// `bun scripts/plinko-rtp.ts [balls] [bet] [seed]`: Pegfall's exact RTP for
// every risk and row count, and a simulation of each (one ball per round).
// Every table should read 97-98%.
import { payFor } from '../shared/money'
import { playPlinko, PLINKO_MAX_ROWS, PLINKO_MIN_ROWS, PLINKO_RISKS, plinkoRtp, plinkoTable } from '../shared/games/plinko'
import { seededRng } from '../shared/rng'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(200_000)
const rng = seededRng(seed)
let low = Infinity
let high = 0
for (const risk of PLINKO_RISKS) {
    for (let rows = PLINKO_MIN_ROWS; rows <= PLINKO_MAX_ROWS; rows++) {
        const tally = new Tally()
        for (let i = 0; i < rounds; i++) {
            const result = playPlinko(rng, { rows, risk, balls: 1 })
            tally.add(bet, payFor(bet, result.multiplier))
        }
        const exact = plinkoRtp(rows, risk)
        low = Math.min(low, exact)
        high = Math.max(high, exact)
        console.log(`${tally.line(`${risk} ${rows} rows`)}  exact ${(100 * exact).toFixed(2)}%  edge ${Math.max(...plinkoTable(rows, risk))}×`)
    }
}
console.log(`\nExact RTP across every table: ${(100 * low).toFixed(2)}% to ${(100 * high).toFixed(2)}%`)
