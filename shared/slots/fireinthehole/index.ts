import type { Rng } from '../../rng'

/**
 * Fire in the Hole: a 6×6 mine shaft that starts with 3 open rows.
 *
 * - Base game: clusters of 5+ touching (up, down, left, right) matching ores
 *   pay per symbol in the cluster. Dynamite is wild; when it pays it blasts
 *   its 8 neighbours too (chaining into other dynamite). Winners and blasted
 *   cells fall away and new symbols drop in; every cascade raises the pay
 *   multiplier. Dynamite that blows up in the bottom two open rows opens one
 *   more row each (up to 6).
 * - Bonus: 3+ lanterns (scatters) on the open rows at rest start 10 free
 *   spins on that many rows. Coins land with values (× bet), pickaxes add
 *   their value to every coin each spin, x2 doubles every coin, and a
 *   collector sweeps all coins into itself. The bonus pays the sum of the
 *   values left on the board after the last spin.
 *
 * Every amount here is a multiple of the bet (bet = 1); the server pays
 * bet × win rounded down to 0.0001 coin. The whole round, bonus included, is resolved in one call.
 */

export const FITH_COLS = 6
export const FITH_ROWS = 6
export const FITH_STARTING_LINES = 3
export const FITH_MAX_LINES = 6
export const FITH_MIN_CONNECTION = 5
export const FITH_MAX_CASCADES = 8
export const FITH_SCATTERS_FOR_BONUS = 3
export const FITH_FREE_SPINS = 10
/** Hard cap on a round's total win, × bet (the old site's cap). */
export const FITH_MAX_WIN = 20_000
/** Feature buy price, × bet. RTP retune: 46 on the old site (~97.7% → ~95.6%). Tuned with scripts/fireinthehole-rtp.ts. */
export const FITH_BUY_COST = 47

export type FireSymbol = 'coal' | 'ore' | 'ruby' | 'sapphire' | 'emerald' | 'bomb' | 'scatter' | 'coin' | 'boost' | 'double' | 'collector' | 'empty' | 'rock'
export type FirePaySymbol = Extract<FireSymbol, 'coal' | 'ore' | 'ruby' | 'sapphire' | 'emerald'>
export type FireBonusSymbol = 'coin' | 'boost' | 'double' | 'collector'
export type FireGrid = FireSymbol[][]

export interface FireCell {
    col: number
    row: number
}

export interface FireBonusDrop extends FireCell {
    symbol: FireBonusSymbol
    multiplier: number
}

export interface FireBonusValueEvent {
    type: 'add' | 'double' | 'collect'
    source: FireBonusDrop
    target: FireBonusDrop
    amount: number
    before: number
    after: number
}

export interface FireBonusStep {
    spin: number
    grid: FireGrid
    drops: FireBonusDrop[]
    /** Every coin, pickaxe and collector on the board after this spin. */
    coins: FireBonusDrop[]
    valueEvents: FireBonusValueEvent[]
    appliedAdd: number
    appliedDouble: boolean
    collected: number
    totalMultiplier: number
}

export interface FireBonusResult {
    freeSpins: number
    activeLines: number
    steps: FireBonusStep[]
    /** What the bonus pays, × bet (before the round cap). */
    totalMultiplier: number
}

export interface FireCascadeStep {
    grid: FireGrid
    activeLinesBefore: number
    activeLinesAfter: number
    winCells: FireCell[]
    bombCells: FireCell[]
    unlockedRows: number[]
    stepPay: number
    totalPay: number
}

export interface FireInTheHoleOutcome {
    bought: boolean
    /** Total win × bet, capped at FITH_MAX_WIN. */
    win: number
    capped: boolean
    /** The bonus ran this round. */
    feature: boolean
    /** The cascades' win × bet (capped). */
    basePayout: number
    /** The first grid that lands. */
    grid: FireGrid
    steps: FireCascadeStep[]
    /** The grid once the cascades stop. */
    restGrid: FireGrid
    scatterCells: FireCell[]
    activeLines: number
    bonus: FireBonusResult | null
}

export const FITH_PAY_SYMBOLS: readonly FirePaySymbol[] = ['coal', 'ore', 'ruby', 'sapphire', 'emerald']
const PAY_WEIGHTS = [34, 28, 18, 13, 9]
const BOMB_WEIGHT = 7
/** RTP retune: 1.104 on the old site (~97.7% → ~96.9%). */
const SCATTER_WEIGHT = 1.1

/** Pay per symbol in a winning connection, × bet. */
export const FITH_SYMBOL_PAY: Record<FirePaySymbol, number> = {
    coal: 0.012,
    ore: 0.017,
    ruby: 0.025,
    sapphire: 0.035,
    emerald: 0.048
}

/** Every cascade after the first adds this much to the step's pay multiplier. */
export const FITH_CHAIN_STEP = 0.18

/** Pay multiplier for cascade `chain` (0 = the first connection of the spin). */
export function fithChainMultiplier(chain: number): number {
    return 1 + chain * FITH_CHAIN_STEP
}

/** Coin values (× bet) and their weights. */
export const FITH_COIN_VALUES: readonly (readonly [number, number])[] = [
    [0.13, 18], [0.33, 22], [0.64, 22], [1.23, 16], [2.07, 8], [3.25, 5], [4.93, 3], [7.4, 2.4], [13.3, 1.1], [24.6, 0.5]
]
/** What a pickaxe adds to every coin each spin (× bet), and the weights. */
export const FITH_BOOST_VALUES: readonly (readonly [number, number])[] = [
    [1.23, 45], [3.25, 30], [7.4, 18], [18.2, 7]
]

/** Strip float noise: every amount is kept to a millionth of the bet. */
const round6 = (value: number) => Math.round(value * 1e6) / 1e6

function weightedValue(rng: Rng, table: readonly (readonly [number, number])[]): number {
    let total = 0
    for (const [, weight] of table) total += weight
    let roll = rng.next() * total
    for (const [value, weight] of table) {
        roll -= weight
        if (roll < 0) return value
    }
    return table[table.length - 1]![0]
}

const DRAW_ALL = [...FITH_PAY_SYMBOLS, 'bomb', 'scatter'] as const
const DRAW_ALL_WEIGHTS = [...PAY_WEIGHTS, BOMB_WEIGHT, SCATTER_WEIGHT]
const DRAW_NO_BOMB = [...FITH_PAY_SYMBOLS, 'scatter'] as const
const DRAW_NO_BOMB_WEIGHTS = [...PAY_WEIGHTS, SCATTER_WEIGHT]

function pick<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
    let total = 0
    for (const weight of weights) total += weight
    let roll = rng.next() * total
    for (let i = 0; i < items.length; i++) {
        roll -= weights[i]!
        if (roll < 0) return items[i]!
    }
    return items[items.length - 1]!
}

function drawSymbol(rng: Rng, canBomb = true): FireSymbol {
    return canBomb ? pick(rng, DRAW_ALL, DRAW_ALL_WEIGHTS) : pick(rng, DRAW_NO_BOMB, DRAW_NO_BOMB_WEIGHTS)
}

function cloneGrid(grid: FireGrid): FireGrid {
    return grid.map(col => [...col])
}

function isLocked(row: number, activeLines: number): boolean {
    return row >= activeLines
}

function createGrid(rng: Rng, activeLines: number): FireGrid {
    return Array.from({ length: FITH_COLS }, () =>
        Array.from({ length: FITH_ROWS }, (_, row): FireSymbol => (isLocked(row, activeLines) ? 'rock' : drawSymbol(rng))))
}

function key(cell: FireCell): string {
    return `${cell.col}:${cell.row}`
}

function inBounds(col: number, row: number): boolean {
    return col >= 0 && col < FITH_COLS && row >= 0 && row < FITH_ROWS
}

function neighbours(cell: FireCell): FireCell[] {
    return [
        { col: cell.col + 1, row: cell.row },
        { col: cell.col - 1, row: cell.row },
        { col: cell.col, row: cell.row + 1 },
        { col: cell.col, row: cell.row - 1 }
    ].filter(next => inBounds(next.col, next.row))
}

function surroundingCells(cell: FireCell): FireCell[] {
    const cells: FireCell[] = []
    for (let col = cell.col - 1; col <= cell.col + 1; col++) {
        for (let row = cell.row - 1; row <= cell.row + 1; row++) {
            if (col === cell.col && row === cell.row) continue
            if (inBounds(col, row)) cells.push({ col, row })
        }
    }
    return cells
}

/**
 * Cells in winning clusters: 5+ orthogonally touching cells of one ore (with
 * dynamite as wild, at least one real ore). An earlier, cheaper ore claims a
 * shared dynamite first.
 */
export function detectConnections(grid: FireGrid, activeLines: number): FireCell[] {
    const claimed = new Set<string>()
    const winners: FireCell[] = []

    for (const symbol of FITH_PAY_SYMBOLS) {
        const visited = new Set<string>()
        for (let col = 0; col < FITH_COLS; col++) {
            for (let row = 0; row < activeLines; row++) {
                const id = `${col}:${row}`
                const value = grid[col]![row]
                if (visited.has(id) || claimed.has(id) || (value !== symbol && value !== 'bomb')) continue

                const stack: FireCell[] = [{ col, row }]
                const cluster: FireCell[] = []
                let hasPaySymbol = false
                visited.add(id)

                while (stack.length > 0) {
                    const current = stack.pop()!
                    cluster.push(current)
                    if (grid[current.col]![current.row] === symbol) hasPaySymbol = true
                    for (const next of neighbours(current)) {
                        if (isLocked(next.row, activeLines)) continue
                        const nextId = key(next)
                        const nextValue = grid[next.col]![next.row]
                        if (visited.has(nextId) || claimed.has(nextId)) continue
                        if (nextValue !== symbol && nextValue !== 'bomb') continue
                        visited.add(nextId)
                        stack.push(next)
                    }
                }

                if (hasPaySymbol && cluster.length >= FITH_MIN_CONNECTION) {
                    for (const cell of cluster) {
                        const cellKey = key(cell)
                        if (!claimed.has(cellKey)) {
                            claimed.add(cellKey)
                            winners.push(cell)
                        }
                    }
                }
            }
        }
    }
    return winners
}

/**
 * Every winning dynamite blasts its 8 neighbours (lanterns survive), and
 * blasted dynamite blasts in turn. Dynamite in the bottom two open rows
 * opens a row each.
 */
export function resolveBombExplosions(grid: FireGrid, connectionCells: FireCell[], activeLines: number) {
    const winByKey = new Map(connectionCells.map(cell => [key(cell), cell]))
    const bombByKey = new Map<string, FireCell>()
    const queue = connectionCells.filter(cell => grid[cell.col]![cell.row] === 'bomb')
    for (const bomb of queue) bombByKey.set(key(bomb), bomb)

    for (let index = 0; index < queue.length; index++) {
        const bomb = queue[index]!
        for (const cell of surroundingCells(bomb)) {
            if (isLocked(cell.row, activeLines)) continue
            const cellKey = key(cell)
            const symbol = grid[cell.col]![cell.row]
            if (symbol !== 'scatter' && !winByKey.has(cellKey)) winByKey.set(cellKey, cell)
            if (symbol === 'bomb' && !bombByKey.has(cellKey)) {
                bombByKey.set(cellKey, cell)
                queue.push(cell)
            }
        }
    }

    return {
        winCells: [...winByKey.values()],
        bombCells: [...bombByKey.values()],
        lineBombCells: [...bombByKey.values()].filter(cell => cell.row >= activeLines - 2)
    }
}

function collapseGrid(rng: Rng, grid: FireGrid, winners: FireCell[], activeLines: number): FireGrid {
    const next = cloneGrid(grid)
    const removed = new Set(winners.map(key))
    for (let col = 0; col < FITH_COLS; col++) {
        const survivors: FireSymbol[] = []
        for (let row = activeLines - 1; row >= 0; row--) {
            if (!removed.has(`${col}:${row}`)) survivors.push(next[col]![row]!)
        }
        for (let row = activeLines - 1; row >= 0; row--) next[col]![row] = survivors.shift() ?? drawSymbol(rng)
        for (let row = activeLines; row < FITH_ROWS; row++) next[col]![row] = 'rock'
    }
    return next
}

function applyUnlockedRows(rng: Rng, grid: FireGrid, activeLines: number, nextActiveLines: number): number[] {
    const unlocked: number[] = []
    for (let row = activeLines; row < nextActiveLines; row++) {
        unlocked.push(row)
        for (let col = 0; col < FITH_COLS; col++) grid[col]![row] = drawSymbol(rng, false)
    }
    return unlocked
}

/** Ores among the cleared cells pay their value × the cascade multiplier; dynamite and blasted lanterns pay nothing. */
export function calculateStepPay(grid: FireGrid, winCells: FireCell[], chain: number): number {
    let symbolPay = 0
    for (const cell of winCells) {
        const symbol = grid[cell.col]![cell.row]! as FirePaySymbol
        if (FITH_SYMBOL_PAY[symbol] !== undefined) symbolPay += FITH_SYMBOL_PAY[symbol]
    }
    return round6(symbolPay * fithChainMultiplier(chain))
}

export function findScatters(grid: FireGrid, activeLines: number): FireCell[] {
    const cells: FireCell[] = []
    for (let col = 0; col < FITH_COLS; col++) {
        for (let row = 0; row < activeLines; row++) {
            if (grid[col]![row] === 'scatter') cells.push({ col, row })
        }
    }
    return cells
}

/** A fresh grid with exactly enough lanterns forced in to start the bonus. */
function buyBonusGrid(rng: Rng, activeLines: number): FireGrid {
    const grid = createGrid(rng, activeLines)
    const cells: FireCell[] = []
    for (let row = 0; row < activeLines; row++) {
        for (let col = 0; col < FITH_COLS; col++) cells.push({ col, row })
    }
    for (let i = 0; i < FITH_SCATTERS_FOR_BONUS; i++) {
        const [cell] = cells.splice(Math.floor(rng.next() * cells.length), 1)
        grid[cell!.col]![cell!.row] = 'scatter'
    }
    return grid
}

function createBonusGrid(activeLines: number): FireGrid {
    return Array.from({ length: FITH_COLS }, () =>
        Array.from({ length: FITH_ROWS }, (_, row): FireSymbol => (isLocked(row, activeLines) ? 'rock' : 'empty')))
}

function bonusDropChances(occupied: number, capacity: number) {
    // Coins, pickaxes and x2 thin out as the board fills; collectors don't.
    const scale = Math.max(0, (capacity - occupied - 1) / Math.max(1, capacity - 1))
    return {
        coin: 0.04 * scale,
        boost: 0.0034 * scale,
        double: 0.006 * scale,
        collector: 0.0017
    }
}

type BonusValue = { symbol: Exclude<FireBonusSymbol, 'double'>, multiplier: number }

function parseKey(id: string): FireCell {
    const [col, row] = id.split(':').map(Number)
    return { col: col!, row: row! }
}

function bonusTotal(values: Map<string, BonusValue>): number {
    let total = 0
    for (const value of values.values()) if (value.symbol !== 'boost') total += value.multiplier
    return round6(total)
}

/** The free spins, resolved in full: what lands each spin and how values move. */
export function playBonus(rng: Rng, activeLines: number): FireBonusResult {
    const board = createBonusGrid(activeLines)
    const values = new Map<string, BonusValue>()
    const steps: FireBonusStep[] = []
    const capacity = FITH_COLS * activeLines

    for (let spin = 1; spin <= FITH_FREE_SPINS; spin++) {
        const emptyCells: FireCell[] = []
        for (let col = 0; col < FITH_COLS; col++) {
            for (let row = 0; row < activeLines; row++) if (board[col]![row] === 'empty') emptyCells.push({ col, row })
        }

        const drops: FireBonusDrop[] = []
        const valueEvents: FireBonusValueEvent[] = []
        let appliedAdd = 0
        let appliedDouble = false
        let collected = 0
        let collectorDropped = false

        for (const cell of emptyCells) {
            const roll = rng.next()
            const chances = bonusDropChances(values.size, capacity)
            const coinLimit = chances.coin
            const boostLimit = coinLimit + (values.size > 0 ? chances.boost : 0)
            const doubleLimit = boostLimit + (values.size > 0 ? chances.double : 0)
            // One collector per spin: a second would find every coin already swept.
            const canCollect = !collectorDropped && [...values.values()].some(value => value.symbol === 'coin')
            const collectorLimit = doubleLimit + (canCollect ? chances.collector : 0)

            if (roll < coinLimit) {
                const multiplier = weightedValue(rng, FITH_COIN_VALUES)
                board[cell.col]![cell.row] = 'coin'
                values.set(key(cell), { symbol: 'coin', multiplier })
                drops.push({ ...cell, symbol: 'coin', multiplier })
            } else if (roll < boostLimit) {
                const multiplier = weightedValue(rng, FITH_BOOST_VALUES)
                board[cell.col]![cell.row] = 'boost'
                values.set(key(cell), { symbol: 'boost', multiplier })
                drops.push({ ...cell, symbol: 'boost', multiplier })
            } else if (roll < doubleLimit) {
                drops.push({ ...cell, symbol: 'double', multiplier: 2 })
            } else if (roll < collectorLimit) {
                board[cell.col]![cell.row] = 'collector'
                values.set(key(cell), { symbol: 'collector', multiplier: 0 })
                drops.push({ ...cell, symbol: 'collector', multiplier: 0 })
                collectorDropped = true
            }
        }

        // Pickaxes (old and new) add their value to every coin and collector.
        for (const [sourceId, sourceState] of [...values.entries()]) {
            if (sourceState.symbol !== 'boost') continue
            const source: FireBonusDrop = { ...parseKey(sourceId), symbol: 'boost', multiplier: sourceState.multiplier }
            appliedAdd = round6(appliedAdd + sourceState.multiplier)
            for (const [id, state] of values) {
                if (state.symbol === 'boost') continue
                const before = state.multiplier
                const after = round6(before + sourceState.multiplier)
                state.multiplier = after
                valueEvents.push({ type: 'add', source, target: { ...parseKey(id), symbol: state.symbol, multiplier: after }, amount: sourceState.multiplier, before, after })
            }
        }

        // x2 doubles every coin and collector, then vanishes.
        for (const drop of drops) {
            if (drop.symbol !== 'double') continue
            appliedDouble = true
            for (const [id, state] of values) {
                if (state.symbol === 'boost') continue
                const before = state.multiplier
                const after = round6(before * 2)
                state.multiplier = after
                valueEvents.push({ type: 'double', source: drop, target: { ...parseKey(id), symbol: state.symbol, multiplier: after }, amount: round6(after - before), before, after })
            }
        }

        // A collector sweeps every coin into itself; the cells free up.
        for (const collector of drops.filter(drop => drop.symbol === 'collector')) {
            const collectorState = values.get(key(collector))
            if (!collectorState) continue
            for (const [id, state] of [...values.entries()]) {
                if (state.symbol !== 'coin') continue
                const cell = parseKey(id)
                const before = collectorState.multiplier
                const amount = state.multiplier
                const after = round6(before + amount)
                collectorState.multiplier = after
                collected = round6(collected + amount)
                board[cell.col]![cell.row] = 'empty'
                values.delete(id)
                valueEvents.push({ type: 'collect', source: { ...collector, multiplier: after }, target: { ...cell, symbol: 'coin', multiplier: amount }, amount, before, after })
            }
        }

        const grid = createBonusGrid(activeLines)
        for (const drop of drops) grid[drop.col]![drop.row] = drop.symbol
        const coins = [...values.entries()].map(([id, state]): FireBonusDrop => ({ ...parseKey(id), symbol: state.symbol, multiplier: state.multiplier }))

        steps.push({ spin, grid, drops, coins, valueEvents, appliedAdd, appliedDouble, collected, totalMultiplier: bonusTotal(values) })
    }

    return { freeSpins: FITH_FREE_SPINS, activeLines, steps, totalMultiplier: steps.at(-1)?.totalMultiplier ?? 0 }
}

/** A round's total win × bet, held to the max win. */
export function capWin(raw: number): { win: number, capped: boolean } {
    return raw >= FITH_MAX_WIN ? { win: FITH_MAX_WIN, capped: true } : { win: raw, capped: false }
}

/** One paid round: the cascades, then the bonus if 3+ lanterns rest on the open rows. A buy skips straight to the bonus on 3 rows. */
export function playFireInTheHole(rng: Rng, opts: { buy?: boolean } = {}): FireInTheHoleOutcome {
    if (opts.buy) {
        const activeLines = FITH_STARTING_LINES
        const grid = buyBonusGrid(rng, activeLines)
        const bonus = playBonus(rng, activeLines)
        return {
            bought: true,
            ...capWin(bonus.totalMultiplier),
            feature: true,
            basePayout: 0,
            grid,
            steps: [],
            restGrid: grid,
            scatterCells: findScatters(grid, activeLines),
            activeLines,
            bonus
        }
    }

    let activeLines = FITH_STARTING_LINES
    let grid = createGrid(rng, activeLines)
    const first = grid
    const steps: FireCascadeStep[] = []
    let payout = 0

    for (let chain = 0; chain < FITH_MAX_CASCADES; chain++) {
        const connectionCells = detectConnections(grid, activeLines)
        if (connectionCells.length === 0) break

        const { winCells, bombCells, lineBombCells } = resolveBombExplosions(grid, connectionCells, activeLines)
        const stepPay = calculateStepPay(grid, winCells, chain)
        const activeLinesBefore = activeLines
        const nextActiveLines = Math.min(FITH_MAX_LINES, activeLines + lineBombCells.length)
        const nextGrid = collapseGrid(rng, grid, winCells, activeLines)
        const unlockedRows = applyUnlockedRows(rng, nextGrid, activeLines, nextActiveLines)

        activeLines = nextActiveLines
        payout = round6(payout + stepPay)
        steps.push({ grid: cloneGrid(grid), activeLinesBefore, activeLinesAfter: activeLines, winCells, bombCells, unlockedRows, stepPay, totalPay: payout })
        grid = nextGrid
    }

    const scatterCells = findScatters(grid, activeLines)
    const bonus = scatterCells.length >= FITH_SCATTERS_FOR_BONUS ? playBonus(rng, activeLines) : null
    return {
        bought: false,
        ...capWin(round6(payout + (bonus?.totalMultiplier ?? 0))),
        feature: bonus !== null,
        basePayout: Math.min(FITH_MAX_WIN, payout),
        grid: cloneGrid(first),
        steps,
        restGrid: cloneGrid(grid),
        scatterCells,
        activeLines,
        bonus
    }
}
