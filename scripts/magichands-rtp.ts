// `bun scripts/magichands-rtp.ts [rounds] [bet] [seed]`: the exact RTP, then a
// simulation per hand count (RTP, hit rate, max win).
import {
    MH_COLS,
    MH_MAX_PASSES,
    MH_MULTIPLIER_WEIGHTS,
    MH_MULTIPLIERS,
    MH_ROWS,
    MH_SLOT_ODDS,
    MH_TILE_CAP,
    MH_TILES,
    MH_TILES_PER_MULTIPLIER,
    MH_WINNERS,
    playMagicHands
} from '../shared/games/magichands'
import { randomSample, seededRng } from '../shared/rng'
import { simArgs, Tally } from './lib/report'

/**
 * RTP = P(a tile wins) × E[its capped multiplier]. Walks one tile's
 * multiplier distribution through the passes: its own column's slot can stamp
 * it, and a reroll anywhere on the bar (its own slot or one of the other four)
 * brings another pass.
 */
function exactRtp(): number {
    const total = MH_MULTIPLIER_WEIGHTS.reduce((sum, w) => sum + w, 0)
    const [lo, hi] = MH_TILES_PER_MULTIPLIER
    const stamp = MH_SLOT_ODDS.multiplier * ((lo + hi) / 2) / MH_ROWS
    const othersReroll = 1 - (1 - MH_SLOT_ODDS.reroll) ** (MH_COLS - 1)
    const add = (map: Map<number, number>, value: number, p: number) => map.set(value, (map.get(value) ?? 0) + p)
    let alive = new Map([[1, 1]])
    const settled = new Map<number, number>()
    for (let pass = 1; pass <= MH_MAX_PASSES; pass++) {
        const next = new Map<number, number>()
        for (const [value, p] of alive) {
            const outcomes: [number, number, boolean][] = MH_MULTIPLIERS.map((m, i) => [Math.min(MH_TILE_CAP, value * m), stamp * MH_MULTIPLIER_WEIGHTS[i]! / total, false])
            outcomes.push([value, MH_SLOT_ODDS.multiplier - stamp, false])
            outcomes.push([value, 1 - MH_SLOT_ODDS.multiplier - MH_SLOT_ODDS.reroll, false])
            outcomes.push([value, MH_SLOT_ODDS.reroll, true])
            for (const [v, po, ownReroll] of outcomes) {
                const again = pass === MH_MAX_PASSES ? 0 : ownReroll ? 1 : othersReroll
                add(next, v, p * po * again)
                add(settled, v, p * po * (1 - again))
            }
        }
        alive = next
    }
    let mean = 0
    for (const [value, p] of settled) mean += value * p
    return mean * ((MH_WINNERS[0] + MH_WINNERS[1]) / 2) / MH_TILES
}

console.log(`exact RTP ${(100 * exactRtp()).toFixed(3)}%  max win ${MH_TILE_CAP}× per hand`)

const { rounds, bet, seed } = simArgs(1_000_000)
const rng = seededRng(seed)
const tiles = Array.from({ length: MH_TILES }, (_, i) => i)

for (const hands of [1, 5, 10, 40]) {
    const tally = new Tally()
    let capped = 0
    const n = hands === 40 ? rounds / 4 : rounds
    for (let i = 0; i < n; i++) {
        const result = playMagicHands(rng, { placements: randomSample(rng, tiles, hands) })
        tally.add(bet * hands, bet * result.win)
        if (result.wins.some(w => w.multiplier >= MH_TILE_CAP)) capped++
    }
    console.log(`${tally.line(`${hands} hand${hands > 1 ? 's' : ''}`)}  capped tile won 1 in ${capped ? Math.round(n / capped).toLocaleString('en-US') : '∞'}`)
}
