// `bun scripts/hilo-rtp.ts [rounds] [bet] [seed]`: Card Climb's return for a
// few strategies. The house share is taken once per round, so every strategy
// should read about 97.5% however long it climbs (a little under: payouts
// and multipliers round down). Exactly: every guess pays 13 / winning ranks,
// so it is fair, and the round's multiplier starts at HILO_RTP; the long
// climbs only add variance.
import { hilo, hiloOptions, type HiloState } from '../shared/games/hilo'
import { payFor } from '../shared/money'
import { seededRng } from '../shared/rng'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(500_000)
const rng = seededRng(seed)

type Strategy = (state: HiloState) => 'cash' | 'skip' | 'higher' | 'lower' | 'same'

/** The likelier guess, cashing out after `n` right ones. */
const safest = (n: number): Strategy => state => {
    if (state.wins.length >= n) return 'cash'
    const options = hiloOptions(state.card.rank)
    return options.reduce((a, b) => (b.chance > a.chance ? b : a)).guess
}
/** The long shot ("same" on an ace or king, else the less likely side), once. */
const longShot: Strategy = (state) => {
    if (state.wins.length >= 1) return 'cash'
    return hiloOptions(state.card.rank).reduce((a, b) => (b.chance < a.chance ? b : a)).guess
}
/** Skips middling cards while it can, then plays safe for three. */
const skipper: Strategy = (state) => {
    if (state.wins.length >= 3) return 'cash'
    if (state.card.rank >= 5 && state.card.rank <= 9 && state.skips < 3) return 'skip'
    return safest(3)(state)
}

const strategies: [string, Strategy][] = [['safe ×1', safest(1)], ['safe ×3', safest(3)], ['safe ×6', safest(6)], ['safe ×10', safest(10)], ['long shot', longShot], ['skipper ×3', skipper]]
for (const [label, strategy] of strategies) {
    const tally = new Tally()
    for (let i = 0; i < rounds; i++) {
        let state = hilo.start(rng, {})
        while (state.status === 'open') {
            const move = strategy(state)
            if (move === 'cash') state = hilo.cashOut(state)
            else state = hilo.act(state, move === 'skip' ? { type: 'skip' } : { type: 'guess', guess: move }, rng)
        }
        tally.add(bet, payFor(bet, hilo.multiplier(state)))
    }
    console.log(tally.line(label))
}
