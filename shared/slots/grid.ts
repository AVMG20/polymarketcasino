import { randomSample, weightedPick, type Rng } from '../rng'
import type { Cell, Grid, SymbolId, Weights } from './types'

/** The weight table for one reel. */
export function reelWeights(weights: Weights, col: number): Readonly<Record<SymbolId, number>> {
    return Array.isArray(weights) ? weights[col] ?? weights[weights.length - 1]! : weights as Readonly<Record<SymbolId, number>>
}

function without(table: Readonly<Record<SymbolId, number>>, symbol: SymbolId | undefined) {
    if (!symbol || !(symbol in table)) return table
    const { [symbol]: _dropped, ...rest } = table
    return rest
}

/**
 * A fresh grid, every cell an independent weighted draw. With `onePerReel`,
 * a reel never shows that symbol twice (classic reel-strip behaviour).
 */
export function drawGrid(rng: Rng, cols: number, rows: number, weights: Weights, onePerReel?: SymbolId): Grid {
    const grid: Grid = []
    for (let col = 0; col < cols; col++) {
        const table = reelWeights(weights, col)
        const reel: SymbolId[] = []
        for (let row = 0; row < rows; row++) {
            const pick = weightedPick(rng, onePerReel && reel.includes(onePerReel) ? without(table, onePerReel) : table)
            reel.push(pick)
        }
        grid.push(reel)
    }
    return grid
}

export function countSymbol(grid: Grid, symbol: SymbolId): number {
    let n = 0
    for (const reel of grid) for (const s of reel) if (s === symbol) n++
    return n
}

export function cellsOf(grid: Grid, symbol: SymbolId): Cell[] {
    const cells: Cell[] = []
    grid.forEach((reel, col) => reel.forEach((s, row) => {
        if (s === symbol) cells.push([col, row])
    }))
    return cells
}

/**
 * Put `count` of `symbol` on the grid at random: one per distinct reel when
 * `onePerReel`, otherwise on distinct cells. Used by feature buys.
 */
export function forceSymbol(rng: Rng, grid: Grid, symbol: SymbolId, count: number, onePerReel: boolean) {
    const present = countSymbol(grid, symbol)
    if (present >= count) return
    if (onePerReel) {
        const free = grid.map((reel, col) => col).filter(col => !grid[col]!.includes(symbol))
        for (const col of randomSample(rng, free, count - present)) {
            grid[col]![Math.floor(rng.next() * grid[col]!.length)] = symbol
        }
        return
    }
    const free: Cell[] = []
    grid.forEach((reel, col) => reel.forEach((s, row) => {
        if (s !== symbol) free.push([col, row])
    }))
    for (const [col, row] of randomSample(rng, free, count - present)) grid[col]![row] = symbol
}

/**
 * Remove `cells`, let what is above fall down, and fill the gaps from the top
 * with fresh draws (never `exclude`, so a tumble can't add scatters).
 */
export function tumble(rng: Rng, grid: Grid, cells: readonly Cell[], weights: Weights, exclude?: SymbolId): Grid {
    const gone = new Set(cells.map(([col, row]) => `${col}:${row}`))
    return grid.map((reel, col) => {
        const kept = reel.filter((_, row) => !gone.has(`${col}:${row}`))
        const table = without(reelWeights(weights, col), exclude)
        const fresh: SymbolId[] = []
        for (let i = kept.length; i < reel.length; i++) fresh.push(weightedPick(rng, table))
        return [...fresh, ...kept]
    })
}
