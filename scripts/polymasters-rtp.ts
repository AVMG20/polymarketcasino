// `bun scripts/polymasters-rtp.ts [rounds] [bet] [seed]`: RTP per mode, hit
// rate, landings and max win. `--tune` re-solves the rocket weight (normal)
// and the multiplier weight (Safe Landing) for their target RTPs on common
// random numbers; paste the values into shared/games/polymasters.ts and
// re-run the plain check.
import { costFor, payFor } from '../shared/money'
import {
    PM_MAX_WIN,
    PM_NORMAL,
    PM_RTP_BAND,
    PM_SAFE,
    PM_TARGET_RTP,
    PM_TARGET_SAFE_RTP,
    playPolyMasters,
    type PmMode,
    type PmModeConfig
} from '../shared/games/polymasters'
import { seededRng } from '../shared/rng'
import { Tally } from './lib/report'

const pct = (n: number) => `${(100 * n).toFixed(3)}%`
const args = process.argv.slice(2)
const positional = args.filter(a => !a.startsWith('--'))

function check(mode: PmMode, rounds: number, bet: number, seed: number): boolean {
    const rng = seededRng(seed)
    const tally = new Tally()
    const landings: Record<string, number> = {}
    for (let i = 0; i < rounds; i++) {
        const outcome = playPolyMasters(rng, mode)
        tally.add(costFor(bet, outcome.cost), payFor(bet, outcome.win))
        landings[outcome.landing] = (landings[outcome.landing] ?? 0) + 1
    }
    const rtp = tally.paid / tally.staked
    const ok = rtp >= PM_RTP_BAND.min && rtp <= PM_RTP_BAND.max
    console.log(`${tally.line(mode)}  ${ok ? 'in band' : 'OUT OF BAND'}`)
    console.log(`  landings ${Object.entries(landings).map(([k, v]) => `${k} ${pct(v / rounds)}`).join(' · ')}  max ${PM_MAX_WIN}× bet`)
    return ok
}

function seededRtp(cfg: PmModeConfig, mode: PmMode, rounds: number, seed: number) {
    const rng = seededRng(seed)
    let win = 0
    let cost = 0
    for (let i = 0; i < rounds; i++) {
        const outcome = playPolyMasters(rng, mode, cfg)
        win += outcome.win
        cost += outcome.cost
    }
    return win / cost
}

function solve(lo: number, hi: number, target: number, f: (x: number) => number, increasing: boolean) {
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2
        if ((f(mid) < target) === increasing) lo = mid
        else hi = mid
    }
    return (lo + hi) / 2
}

if (args.includes('--tune')) {
    const rounds = Number(positional[0] ?? 3_000_000)
    // More rockets → lower RTP; more multipliers → higher RTP.
    const rocket = +solve(20, 200, PM_TARGET_RTP, x => seededRtp({ ...PM_NORMAL, rocket: x }, 'normal', rounds, 1), false).toFixed(3)
    console.log(`normal rocket: ${rocket}  (check seed: ${pct(seededRtp({ ...PM_NORMAL, rocket }, 'normal', rounds, 7))})`)
    const mul = +solve(1, 40, PM_TARGET_SAFE_RTP, x => seededRtp({ ...PM_SAFE, mul: x }, 'safe', rounds, 1), true).toFixed(3)
    console.log(`safe mul: ${mul}  (check seed: ${pct(seededRtp({ ...PM_SAFE, mul }, 'safe', rounds, 7))})`)
} else {
    const rounds = Number(positional[0] ?? 5_000_000)
    const bet = Number(positional[1] ?? 100)
    const seed = Number(positional[2] ?? 1234)
    const results = (['normal', 'safe'] as const).map(mode => check(mode, rounds, bet, seed))
    if (results.includes(false)) process.exitCode = 1
}
