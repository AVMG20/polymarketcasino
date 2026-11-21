// Aethergates: a pay-anywhere 6×5 tumble slot with a shared multiplier meter.
//
// Base game: a full 6×5 grid drops. A win is 8+ of one pay symbol anywhere
// (no adjacency). Each win pays paytable[symbol][bracket] × bet. Winners and
// every multiplier relic on the board are cleared together and the board
// tumbles (gravity + refill) until a drop has no win.
//
// Meter: relics show a value (×2 and up) as they land. The moment any win
// lands on a tumble step, every relic on the board flies into the meter. When
// the tumbles end, the sequence's total win is multiplied by the meter. In the
// base game the meter resets every paid spin (it carries into a bonus the
// spin triggers).
//
// Bonus: 3 scatters award AG_FREE_SPINS, 4+ the AG_FREE_SPINS_SUPER tier.
// Relics land more often and roll bigger, and the meter never resets. The
// first spin that lands 3+ scatters adds AG_RETRIGGER_SPINS once; after that
// scatters stop landing.
//
// Everything is decided here in one call, in × bet units; the client replays
// it. The total win is capped at AG_MAX_WIN_MULT × bet.

import type { Rng } from '../../rng'

export const AG_COLS = 6
export const AG_ROWS = 5
export const AG_CELLS = AG_COLS * AG_ROWS
export const AG_MIN_MATCH = 8

export const AG_SCATTER_TRIGGER = 3
export const AG_SCATTER_TRIGGER_SUPER = 4
export const AG_FREE_SPINS = 10
export const AG_FREE_SPINS_SUPER = 12
export const AG_RETRIGGER_SPINS = 8
/** Safety rail on free-spin rounds; the one-time retrigger never gets near it. */
export const AG_MAX_FREE_SPIN_ROUNDS = 120
/** Hard cap on the total win, × bet. */
export const AG_MAX_WIN_MULT = 10_000
/** Safety bound on tumbles in one sequence. */
const AG_MAX_TUMBLES = 64

/**
 * Feature costs, × bet. Stakes round up to whole coins.
 *
 * - buyFreeSpins: straight into the 10 free spins.
 * - superBonus: straight into the 12 free spins.
 * - bonusChance: every spin costs more, scatters land about twice as often.
 *
 * Tuned with `bun scripts/aethergates-rtp.ts`.
 */
export const AG_BUY_FREESPINS_COST = 42.5 // old site 43: buys read ~97.5% there
export const AG_BUY_SUPERBONUS_COST = 58.5
export const AG_BONUS_CHANCE_COST = 3.54

export const AG_FEATURES = ['buyFreeSpins', 'superBonus', 'bonusChance'] as const
export type AetherFeature = typeof AG_FEATURES[number]
export type AetherBonusTier = 'normal' | 'super'

export type AetherPaySymbol = 'coin' | 'ring' | 'chalice' | 'laurel' | 'lyre' | 'helm' | 'sun' | 'star'
export type AetherSymbol = AetherPaySymbol | 'scatter' | 'multiplier'

export interface Cell { col: number, row: number }

export interface MultDrop extends Cell {
    value: number
}

export interface AetherWinGroup {
    symbol: AetherPaySymbol
    cells: Cell[]
    count: number
    /** × bet, before the meter. */
    payMult: number
}

export interface AetherStep {
    /** [col][row] at the start of this step. */
    grid: AetherSymbol[][]
    wins: AetherWinGroup[]
    winCells: Cell[]
    /** Every relic on the board this step, about to fly into the meter. */
    multipliers: MultDrop[]
    meterBefore: number
    meterAfter: number
    stepPayMult: number
}

export interface AetherSequence {
    steps: AetherStep[]
    /** The settled grid (no winners) the client lands on. */
    restGrid: AetherSymbol[][]
    /** Relics sitting on restGrid, not collected. */
    restMults: MultDrop[]
    meterBefore: number
    meterAfter: number
    basePayMult: number
    /** basePayMult × max(1, meterAfter). */
    winMult: number
}

export interface AetherFreeSpin {
    round: number
    sequence: AetherSequence
    spinWinMult: number
    scatterCount: number
    retriggered: boolean
}

export interface AetherBonusResult {
    spins: AetherFreeSpin[]
    finalMeter: number
    bonusWinMult: number
    retriggers: number
    totalSpins: number
}

export interface AetherGatesResult {
    feature: AetherFeature | null
    /** The first drop: the base sequence's first grid, or a bought bonus's dressing. */
    grid: AetherSymbol[][]
    /** Relic values on `grid`. */
    gridMults: MultDrop[]
    scatterCells: Cell[]
    scatterCount: number
    base: AetherSequence
    bonusTriggered: boolean
    bonusTier: AetherBonusTier | null
    bonus: AetherBonusResult | null
    /** × bet, after the cap. */
    baseWinMult: number
    bonusWinMult: number
    totalWinMult: number
    capped: boolean
}

// --- symbols & weights -------------------------------------------------------

export const AETHER_PAY_SYMBOLS: AetherPaySymbol[] = ['coin', 'ring', 'chalice', 'laurel', 'lyre', 'helm', 'sun', 'star']

export const AETHER_SYMBOL_WEIGHTS: Record<AetherPaySymbol, number> = {
    coin: 54,
    ring: 48,
    chalice: 42,
    laurel: 35,
    lyre: 28,
    helm: 21,
    sun: 14,
    star: 8
}

export const AETHER_SCATTER_WEIGHT = 3.78
export const AETHER_BONUS_SCATTER_WEIGHT = 1.5
export const AETHER_MULTIPLIER_WEIGHT = 3.2
export const AETHER_BONUS_MULTIPLIER_WEIGHT = 9
const AG_BONUS_CHANCE_SCATTER_MULT = 2.15

// Relic values: small and capped low in the base game, a long thin tail in
// the bonus so a stacked meter can explode.
export const AETHER_MULT_VALUES_BASE = [2, 3, 4, 5, 6, 8, 10, 15] as const
const AETHER_MULT_WEIGHTS_BASE = [100, 70, 50, 34, 22, 14, 8, 4] as const

export const AETHER_MULT_VALUES_BONUS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 250, 500] as const
const AETHER_MULT_WEIGHTS_BONUS = [90, 66, 48, 34, 24, 16, 10, 6, 3.4, 2, 1.1, 0.55, 0.22, 0.07, 0.02, 0.006, 0.0015, 0.0003] as const

/** Smallest count of each paytable column. */
export const AG_COUNT_BRACKETS = [8, 10, 12, 15, 20, 25, 30] as const

/** Pays × bet before PAY_SCALE, one column per bracket. */
const PAYTABLE: Record<AetherPaySymbol, number[]> = {
    coin: [0.20, 0.30, 0.45, 0.70, 1.5, 3.0, 6.0],
    ring: [0.25, 0.40, 0.60, 1.0, 2.0, 4.0, 8.0],
    chalice: [0.30, 0.50, 0.80, 1.3, 2.6, 5.5, 11],
    laurel: [0.40, 0.65, 1.0, 1.7, 3.5, 7.5, 15],
    lyre: [0.60, 1.0, 1.6, 2.6, 5.5, 12, 24],
    helm: [0.90, 1.5, 2.4, 4.0, 8.5, 18, 36],
    sun: [1.5, 2.5, 4.0, 6.5, 14, 30, 60],
    star: [2.5, 4.2, 6.8, 11, 24, 50, 100]
}

/** Scales every pay alike in the base game and the bonus. */
const PAY_SCALE = 0.394 // old site 0.40 (~97.5% RTP), retuned to ~96%

// --- helpers -----------------------------------------------------------------

function weightedPick<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
    let total = 0
    for (const w of weights) total += w
    let r = rng.next() * total
    let last = 0
    for (let i = 0; i < items.length; i++) {
        if (weights[i]! <= 0) continue
        last = i
        r -= weights[i]!
        if (r < 0) return items[i]!
    }
    // Rounding can leave r a hair above 0: the last item that can land, never a zero-weight one.
    return items[last]!
}

interface ValuePool { values: readonly number[], weights: readonly number[] }
const BASE_MULT_POOL: ValuePool = { values: AETHER_MULT_VALUES_BASE, weights: AETHER_MULT_WEIGHTS_BASE }
const BONUS_MULT_POOL: ValuePool = { values: AETHER_MULT_VALUES_BONUS, weights: AETHER_MULT_WEIGHTS_BONUS }

const PAY_WEIGHTS = AETHER_PAY_SYMBOLS.map(s => AETHER_SYMBOL_WEIGHTS[s])
const CELL_ITEMS: AetherSymbol[] = [...AETHER_PAY_SYMBOLS, 'multiplier', 'scatter']

function drawCell(rng: Rng, scatterAllowed: boolean, multWeight: number, scatterWeight = AETHER_SCATTER_WEIGHT): AetherSymbol {
    const weights = [...PAY_WEIGHTS, multWeight, scatterAllowed ? scatterWeight : 0]
    return weightedPick(rng, CELL_ITEMS, weights)
}

export function bracketIndex(count: number): number {
    let idx = -1
    for (let i = 0; i < AG_COUNT_BRACKETS.length; i++) {
        if (count >= AG_COUNT_BRACKETS[i]!) idx = i
        else break
    }
    return idx
}

/** What `count` of `symbol` pays, × bet (0 below AG_MIN_MATCH). */
export function aetherPayMult(symbol: AetherPaySymbol, count: number): number {
    const i = bracketIndex(count)
    return i < 0 ? 0 : PAYTABLE[symbol][i]! * PAY_SCALE
}

const key = (cell: Cell) => `${cell.col}:${cell.row}`

function cloneGrid(grid: AetherSymbol[][]): AetherSymbol[][] {
    return grid.map(col => [...col])
}

function multsToList(mults: Map<string, number>): MultDrop[] {
    return [...mults].map(([k, value]) => {
        const [col, row] = k.split(':').map(Number)
        return { col: col!, row: row!, value }
    })
}

// --- board -------------------------------------------------------------------

interface Board { grid: AetherSymbol[][], mults: Map<string, number> }

function fullDrop(rng: Rng, scatterAllowed: boolean, multWeight: number, scatterWeight: number, pool: ValuePool): Board {
    const grid: AetherSymbol[][] = []
    const mults = new Map<string, number>()
    for (let col = 0; col < AG_COLS; col++) {
        const column: AetherSymbol[] = []
        for (let row = 0; row < AG_ROWS; row++) {
            const sym = drawCell(rng, scatterAllowed, multWeight, scatterWeight)
            column.push(sym)
            if (sym === 'multiplier') mults.set(key({ col, row }), weightedPick(rng, pool.values, pool.weights))
        }
        grid.push(column)
    }
    return { grid, mults }
}

export function findScatters(grid: AetherSymbol[][]): Cell[] {
    const cells: Cell[] = []
    for (let col = 0; col < AG_COLS; col++) {
        for (let row = 0; row < AG_ROWS; row++) if (grid[col]![row] === 'scatter') cells.push({ col, row })
    }
    return cells
}

/** Every pay symbol with AG_MIN_MATCH or more anywhere on the grid. Relics never substitute. */
export function findWins(grid: AetherSymbol[][]): AetherWinGroup[] {
    const bySymbol = new Map<AetherPaySymbol, Cell[]>(AETHER_PAY_SYMBOLS.map(s => [s, []]))
    for (let col = 0; col < AG_COLS; col++) {
        for (let row = 0; row < AG_ROWS; row++) {
            const sym = grid[col]![row]!
            if (sym === 'scatter' || sym === 'multiplier') continue
            bySymbol.get(sym)!.push({ col, row })
        }
    }
    const wins: AetherWinGroup[] = []
    for (const symbol of AETHER_PAY_SYMBOLS) {
        const cells = bySymbol.get(symbol)!
        if (cells.length >= AG_MIN_MATCH) wins.push({ symbol, cells, count: cells.length, payMult: aetherPayMult(symbol, cells.length) })
    }
    return wins
}

/** Clear cells, pack survivors to the bottom, refill the top. Refills never draw scatters. */
function refill(rng: Rng, board: Board, clearCells: Cell[], multWeight: number, pool: ValuePool): Board {
    const clear = new Set(clearCells.map(key))
    const grid: AetherSymbol[][] = []
    const mults = new Map<string, number>()
    for (let col = 0; col < AG_COLS; col++) {
        const survivors: AetherSymbol[] = []
        const survivorVals: (number | undefined)[] = []
        for (let row = 0; row < AG_ROWS; row++) {
            const k = key({ col, row })
            if (clear.has(k)) continue
            survivors.push(board.grid[col]![row]!)
            survivorVals.push(board.mults.get(k))
        }
        const freshSyms: AetherSymbol[] = []
        const freshVals: (number | undefined)[] = []
        for (let i = 0; i < AG_ROWS - survivors.length; i++) {
            const sym = drawCell(rng, false, multWeight)
            freshSyms.push(sym)
            freshVals.push(sym === 'multiplier' ? weightedPick(rng, pool.values, pool.weights) : undefined)
        }
        grid.push([...freshSyms, ...survivors])
        ;[...freshVals, ...survivorVals].forEach((v, row) => {
            if (v !== undefined) mults.set(key({ col, row }), v)
        })
    }
    return { grid, mults }
}

function runSequence(rng: Rng, start: Board, startMeter: number, multWeight: number, pool: ValuePool): AetherSequence {
    let board = start
    let meter = startMeter
    let basePayMult = 0
    const steps: AetherStep[] = []

    for (let chain = 0; chain < AG_MAX_TUMBLES; chain++) {
        const wins = findWins(board.grid)
        if (!wins.length) break
        const winCells = wins.flatMap(w => w.cells)
        const stepPayMult = wins.reduce((sum, w) => sum + w.payMult, 0)
        basePayMult += stepPayMult

        // A win anywhere sweeps every relic on the board into the meter.
        const multipliers = multsToList(board.mults)
        const meterBefore = meter
        for (const drop of multipliers) meter += drop.value

        steps.push({ grid: cloneGrid(board.grid), wins, winCells, multipliers, meterBefore, meterAfter: meter, stepPayMult })
        board = refill(rng, board, [...winCells, ...multipliers], multWeight, pool)
    }

    const winMult = basePayMult > 0 ? basePayMult * Math.max(1, meter) : 0
    return { steps, restGrid: board.grid, restMults: multsToList(board.mults), meterBefore: startMeter, meterAfter: meter, basePayMult, winMult }
}

function runBonus(rng: Rng, startMeter: number, initialSpins: number): AetherBonusResult {
    let meter = startMeter
    let bonusWinMult = 0
    let totalSpins = Math.min(initialSpins, AG_MAX_FREE_SPIN_ROUNDS)
    let retriggers = 0
    let retriggerUsed = false
    const spins: AetherFreeSpin[] = []

    let round = 0
    while (round < totalSpins) {
        round++
        // After the one-time retrigger, scatters stop landing.
        const board = fullDrop(rng, !retriggerUsed, AETHER_BONUS_MULTIPLIER_WEIGHT, AETHER_BONUS_SCATTER_WEIGHT, BONUS_MULT_POOL)
        const sequence = runSequence(rng, board, meter, AETHER_BONUS_MULTIPLIER_WEIGHT, BONUS_MULT_POOL)
        meter = sequence.meterAfter
        bonusWinMult += sequence.winMult

        const scatterCount = retriggerUsed ? 0 : findScatters(board.grid).length
        const retriggered = !retriggerUsed && scatterCount >= AG_SCATTER_TRIGGER
        if (retriggered) {
            totalSpins = Math.min(totalSpins + AG_RETRIGGER_SPINS, AG_MAX_FREE_SPIN_ROUNDS)
            retriggers++
            retriggerUsed = true
        }
        spins.push({ round, sequence, spinWinMult: sequence.winMult, scatterCount, retriggered })
    }
    return { spins, finalMeter: meter, bonusWinMult, retriggers, totalSpins: round }
}

/** Places `count` scatters on distinct random cells (a bought bonus's dressing). */
function forceScatters(rng: Rng, board: Board, count: number) {
    const cells: number[] = Array.from({ length: AG_COLS * AG_ROWS }, (_, i) => i)
    for (let i = 0; i < count; i++) {
        const j = i + Math.floor(rng.next() * (cells.length - i))
        ;[cells[i], cells[j]] = [cells[j]!, cells[i]!]
        const col = Math.floor(cells[i]! / AG_ROWS)
        const row = cells[i]! % AG_ROWS
        board.grid[col]![row] = 'scatter'
        board.mults.delete(key({ col, row }))
    }
}

/** The feature named in the round's options; RangeError for anything else. */
export function parseAetherOptions(options: Record<string, unknown>): AetherFeature | null {
    const feature = options.feature
    if (feature === undefined || feature === null) return null
    if (typeof feature !== 'string' || !(AG_FEATURES as readonly string[]).includes(feature)) throw new RangeError('Unknown feature')
    return feature as AetherFeature
}

/** Whole coins one round costs at `bet`. */
export function aetherStake(bet: number, feature: AetherFeature | null): number {
    if (feature === 'buyFreeSpins') return Math.ceil(bet * AG_BUY_FREESPINS_COST)
    if (feature === 'superBonus') return Math.ceil(bet * AG_BUY_SUPERBONUS_COST)
    if (feature === 'bonusChance') return Math.ceil(bet * AG_BONUS_CHANCE_COST)
    return bet
}

/** Play one round. Every amount is × bet. */
export function playAethergates(rng: Rng, feature: AetherFeature | null = null): AetherGatesResult {
    let board: Board
    let base: AetherSequence
    let bonusTier: AetherBonusTier | null = null
    let bonus: AetherBonusResult | null = null

    if (feature === 'buyFreeSpins' || feature === 'superBonus') {
        const isSuper = feature === 'superBonus'
        // Dressing only: pays nothing, shows the trigger.
        board = fullDrop(rng, false, AETHER_MULTIPLIER_WEIGHT, AETHER_SCATTER_WEIGHT, BASE_MULT_POOL)
        forceScatters(rng, board, isSuper ? AG_SCATTER_TRIGGER_SUPER : AG_SCATTER_TRIGGER)
        base = { steps: [], restGrid: board.grid, restMults: multsToList(board.mults), meterBefore: 0, meterAfter: 0, basePayMult: 0, winMult: 0 }
        bonusTier = isSuper ? 'super' : 'normal'
        bonus = runBonus(rng, 0, isSuper ? AG_FREE_SPINS_SUPER : AG_FREE_SPINS)
    } else {
        const scatterWeight = feature === 'bonusChance' ? AETHER_SCATTER_WEIGHT * AG_BONUS_CHANCE_SCATTER_MULT : AETHER_SCATTER_WEIGHT
        board = fullDrop(rng, true, AETHER_MULTIPLIER_WEIGHT, scatterWeight, BASE_MULT_POOL)
        base = runSequence(rng, board, 0, AETHER_MULTIPLIER_WEIGHT, BASE_MULT_POOL)
        const scatters = findScatters(board.grid).length
        if (scatters >= AG_SCATTER_TRIGGER) {
            bonusTier = scatters >= AG_SCATTER_TRIGGER_SUPER ? 'super' : 'normal'
            // The spin's meter carries into the bonus.
            bonus = runBonus(rng, base.meterAfter, bonusTier === 'super' ? AG_FREE_SPINS_SUPER : AG_FREE_SPINS)
        }
    }

    const scatterCells = findScatters(board.grid)
    const uncapped = base.winMult + (bonus?.bonusWinMult ?? 0)
    const capped = uncapped >= AG_MAX_WIN_MULT
    const totalWinMult = Math.min(AG_MAX_WIN_MULT, uncapped)
    const baseWinMult = Math.min(base.winMult, totalWinMult)

    return {
        feature,
        grid: board.grid,
        gridMults: multsToList(board.mults),
        scatterCells,
        scatterCount: scatterCells.length,
        base,
        bonusTriggered: bonus !== null,
        bonusTier,
        bonus,
        baseWinMult,
        bonusWinMult: totalWinMult - baseWinMult,
        totalWinMult,
        capped
    }
}

/** Whole coins a result pays at `bet`. */
export function aetherPayout(result: AetherGatesResult, bet: number): number {
    return Math.floor(bet * result.totalWinMult + 1e-9)
}
