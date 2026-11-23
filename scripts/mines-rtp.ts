// `bun scripts/mines-rtp.ts [rounds] [bet] [seed]`: Gem Dig's return for a
// player who digs `target` gems and cashes out, for a spread of bomb counts.
// The multiplier is RTP over the chance of the gems, so every strategy should
// read about 97.5% (a little under: payouts and multipliers round down).
import { mines, MINES_MAX_MULTIPLIER, MINES_TILES, minesMultiplier, minesSafeChance } from '../shared/games/mines'
import { payFor } from '../shared/money'
import { seededRng } from '../shared/rng'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(200_000)
const rng = seededRng(seed)

/** The exact return of cashing out after `gems` gems. */
function exact(bombs: number, gems: number): number {
    let chance = 1
    for (let k = 0; k < gems; k++) chance *= minesSafeChance(bombs, k)
    return chance * minesMultiplier(bombs, gems)
}

let low = Infinity
let high = 0
let capped = 0
for (let bombs = 1; bombs <= 24; bombs++) {
    for (let gems = 1; gems <= MINES_TILES - bombs; gems++) {
        // Past the cap a round pays the cap (it cashes out on its own there).
        if (minesMultiplier(bombs, gems) >= MINES_MAX_MULTIPLIER) {
            capped++
            continue
        }
        low = Math.min(low, exact(bombs, gems))
        high = Math.max(high, exact(bombs, gems))
    }
}
console.log(`Exact return of every bomb count and cash-out point under the cap: ${(100 * low).toFixed(3)}% to ${(100 * high).toFixed(3)}% (${capped} points past the ${MINES_MAX_MULTIPLIER.toLocaleString('nl-NL')}× cap)\n`)

for (const [bombs, target] of [[1, 1], [1, 10], [3, 3], [3, 8], [5, 5], [10, 4], [20, 2], [24, 1]] as const) {
    const tally = new Tally()
    for (let i = 0; i < rounds; i++) {
        let state = mines.start(rng, { mines: bombs })
        // Dig random tiles until the target or a bomb.
        const order = Array.from({ length: MINES_TILES }, (_, t) => t).sort(() => rng.next() - 0.5)
        for (const tile of order) {
            if (state.status !== 'open' || state.revealed.length >= target) break
            state = mines.act(state, { type: 'reveal', tile }, rng)
        }
        if (state.status === 'open') state = mines.cashOut(state)
        tally.add(bet, payFor(bet, mines.multiplier(state)))
    }
    console.log(`${tally.line(`${bombs} bombs, ${target} gems`)}  exact ${(100 * exact(bombs, target)).toFixed(2)}%  pays ${minesMultiplier(bombs, target)}×`)
}
