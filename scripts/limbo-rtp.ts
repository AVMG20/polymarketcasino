// `bun scripts/limbo-rtp.ts [rounds] [bet] [seed]`: RTP at a spread of targets.
import { playLimbo } from '../shared/games/limbo'
import { seededRng } from '../shared/rng'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(1_000_000)
const rng = seededRng(seed)
for (const target of [1.01, 1.5, 2, 10, 100, 1000]) {
    const tally = new Tally()
    for (let i = 0; i < rounds / 6; i++) {
        const result = playLimbo(rng, { target })
        tally.add(bet, result.won ? Math.floor(bet * target) : 0)
    }
    console.log(tally.line(`target ${target}×`))
}
