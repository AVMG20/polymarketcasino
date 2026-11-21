// `bun scripts/roulette-rtp.ts [rounds] [bet] [seed]`: RTP per bet type.
import { playRoulette, type RouletteBet } from '../shared/games/roulette'
import { seededRng } from '../shared/rng'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(1_000_000)
const rng = seededRng(seed)
const layouts: [string, RouletteBet[]][] = [
    ['straight 17', [{ kind: 'straight', value: 17, amount: bet }]],
    ['red', [{ kind: 'red', amount: bet }]],
    ['dozen 2', [{ kind: 'dozen', value: 2, amount: bet }]],
    ['column 3', [{ kind: 'column', value: 3, amount: bet }]],
    ['mixed', [{ kind: 'straight', value: 0, amount: bet }, { kind: 'odd', amount: bet }, { kind: 'high', amount: bet }]]
]
for (const [label, bets] of layouts) {
    const tally = new Tally()
    const stake = bets.reduce((sum, b) => sum + b.amount, 0)
    for (let i = 0; i < rounds / layouts.length; i++) {
        tally.add(stake, playRoulette(rng, bets).bets.reduce((sum, b) => sum + b.payout, 0))
    }
    console.log(tally.line(label))
}
