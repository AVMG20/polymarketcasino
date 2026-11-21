// `bun scripts/dice-rtp.ts [rounds] [bet] [seed]`: RTP at a spread of win chances.
import { diceMultiplier, playDice } from '../shared/games/dice'
import { seededRng } from '../shared/rng'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(1_000_000)
const rng = seededRng(seed)
for (const chance of [1, 10, 49.5, 75, 95]) {
    for (const over of [false, true]) {
        const tally = new Tally()
        for (let i = 0; i < rounds / 10; i++) {
            const result = playDice(rng, { chance, over })
            tally.add(bet, result.won ? Math.floor(bet * diceMultiplier(chance)) : 0)
        }
        console.log(tally.line(`${chance}% ${over ? 'over' : 'under'}`))
    }
}
