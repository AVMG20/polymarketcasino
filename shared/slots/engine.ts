import type { Rng } from '../rng'
import { payFor, evaluateGrid } from './evaluate'
import { cellsOf, countSymbol, drawGrid, forceSymbol, tumble } from './grid'
import type { Cell, Grid, SlotConfig, SlotOutcome, SlotSpin, SlotStep, SymbolId } from './types'

/** Safety net on retriggers: a feature never runs more spins than this. */
export const MAX_FREE_SPINS = 200

interface FeatureState {
    /** Feature multiplier (wild track or carried tumble level). */
    multiplier: number
    sticky: Cell[]
}

function wildSymbols(config: SlotConfig): SymbolId[] {
    return Object.entries(config.symbols).filter(([, def]) => def.kind === 'wild').map(([id]) => id)
}

function capMultiplier(config: SlotConfig, value: number) {
    const cap = config.freeSpins?.multiplierCap
    return cap ? Math.min(cap, value) : value
}

function uniqueCells(cells: Cell[]): Cell[] {
    const seen = new Set<string>()
    return cells.filter(([c, r]) => {
        const key = `${c}:${r}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

/**
 * One spin: draw, apply sticky wilds, evaluate, and tumble while it keeps
 * winning. `feature` is null in the base game and the running free-spin state
 * otherwise (mutated: multiplier and sticky wilds carry to the next spin).
 */
function playSpin(config: SlotConfig, rng: Rng, feature: FeatureState | null, forceScatters = 0): SlotSpin {
    const weights = feature && config.freeSpins?.weights ? config.freeSpins.weights : config.weights
    const scatter = config.scatter?.symbol
    const onePerReel = config.scatter?.onePerReel ? scatter : undefined
    let grid: Grid = drawGrid(rng, config.cols, config.rows, weights, onePerReel)
    if (forceScatters && scatter) forceSymbol(rng, grid, scatter, forceScatters, !!config.scatter?.onePerReel)

    const wilds = wildSymbols(config)
    if (feature?.sticky.length && wilds[0]) {
        for (const [col, row] of feature.sticky) grid[col]![row] = wilds[0]
    }

    // Wild multiplier track: wilds landing this spin raise the feature level first.
    const step = config.freeSpins?.wildMultiplierStep
    if (feature && step) {
        const landed = wilds.reduce((n, wild) => n + countSymbol(grid, wild), 0) - feature.sticky.length
        feature.multiplier = capMultiplier(config, feature.multiplier + step * Math.max(0, landed))
    }

    const tumbleStep = config.tumble?.multiplierStep ?? 0
    // Tumble level: in the base game it starts over every spin, in free spins it carries.
    let level = feature && config.tumble ? feature.multiplier : 1
    const steps: SlotStep[] = []
    for (let guard = 0; guard < 100; guard++) {
        const wins = evaluateGrid(config, grid)
        const base = wins.reduce((sum, win) => sum + win.pay, 0)
        const multiplier = config.tumble ? level : feature && step ? feature.multiplier : 1
        steps.push({ grid, wins, multiplier, win: base * multiplier })
        if (!config.tumble || !wins.length) break
        if (tumbleStep) level = capMultiplier(config, level + tumbleStep)
        grid = tumble(rng, grid, uniqueCells(wins.flatMap(win => win.cells)), weights, scatter)
    }
    if (feature && config.tumble) feature.multiplier = level

    const first = steps[0]!.grid
    const scatters = scatter ? countSymbol(first, scatter) : 0
    const scatterWin = payFor(config.scatter?.pays, scatters) * config.payScale
    let awarded = 0
    const rules = config.freeSpins
    if (rules) {
        if (!feature) awarded = payFor(rules.awards, scatters)
        else if (rules.retrigger && scatters >= rules.retrigger.count) awarded = rules.retrigger.spins
    }

    if (feature && rules?.stickyWilds) {
        const last = steps[steps.length - 1]!.grid
        feature.sticky = uniqueCells([...feature.sticky, ...wilds.flatMap(wild => cellsOf(last, wild))])
    }

    const win = steps.reduce((sum, s) => sum + s.win, 0) + scatterWin
    return { steps, scatters, scatterWin, awarded, sticky: feature ? feature.sticky.slice() : undefined, win }
}

/** The smallest scatter count that triggers free spins. */
export function triggerCount(config: SlotConfig): number {
    const counts = Object.keys(config.freeSpins?.awards ?? {}).map(Number)
    return counts.length ? Math.min(...counts) : 0
}

/**
 * Play a whole round: the paid spin plus every free spin it triggers, fully
 * resolved. `buy` pays `buyCost` and forces the trigger onto the base spin.
 */
export function playSlot(config: SlotConfig, rng: Rng, options: { buy?: boolean } = {}): SlotOutcome {
    const buy = !!options.buy && !!config.buyCost && !!config.freeSpins
    const base = playSpin(config, rng, null, buy ? triggerCount(config) : 0)
    const freeSpins: SlotSpin[] = []
    let total = base.win
    let capped = false

    if (base.awarded > 0) {
        const feature: FeatureState = { multiplier: 1, sticky: [] }
        let left = base.awarded
        let played = 0
        while (left > 0 && played < MAX_FREE_SPINS) {
            const spin = playSpin(config, rng, feature)
            freeSpins.push(spin)
            total += spin.win
            left += spin.awarded - 1
            played++
            if (total >= config.maxWin) break
        }
    }
    if (total >= config.maxWin) {
        total = config.maxWin
        capped = true
    }
    return { slot: config.id, bought: buy, base, freeSpins, win: total, capped }
}

/** Coins a round pays for `bet`: the win multiple, rounded down to the coin. */
export function slotPayout(outcome: SlotOutcome, bet: number): number {
    return Math.floor(bet * outcome.win + 1e-9)
}
