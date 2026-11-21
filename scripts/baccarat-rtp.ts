// `bun scripts/baccarat-rtp.ts [hands] [bet] [seed]`: RTP of each baccarat bet.
import { Shoe } from '../shared/tables/cards'
import { BAC_SPOTS, bacSpotReturn, dealBaccarat } from '../shared/tables/baccarat'
import { seededRng } from '../shared/rng'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(2_000_000)
const shoe = new Shoe(seededRng(seed), 8, 0.85)
const tallies = Object.fromEntries(BAC_SPOTS.map(spot => [spot, new Tally()]))
for (let i = 0; i < rounds; i++) {
    if (shoe.needsShuffle) shoe.shuffle()
    const round = dealBaccarat(shoe)
    for (const spot of BAC_SPOTS) tallies[spot]!.add(bet, bacSpotReturn(spot, bet, round))
}
for (const spot of BAC_SPOTS) console.log(tallies[spot]!.line(spot))
