// `bun scripts/wheel-rtp.ts [rounds] [bet] [seed]`: exact and simulated RTP per risk.
import { playWheel, WHEEL_RISKS, wheelRtp } from '../shared/games/wheel'
import { seededRng } from '../shared/rng'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(1_000_000)
const rng = seededRng(seed)
for (const risk of WHEEL_RISKS) {
    const tally = new Tally()
    for (let i = 0; i < rounds; i++) {
        const result = playWheel(rng, { risk })
        tally.add(bet, Math.floor(bet * result.multiplier))
    }
    console.log(`${tally.line(risk)}  exact ${(100 * wheelRtp(risk)).toFixed(2)}%`)
}
