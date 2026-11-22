import { costFor, payFor } from '../../money'
import { randomInt, type Rng } from '../../rng'

/**
 * Xeno Slot: a 5×3 slot on 5 fixed lines with a Hold & Win bonus.
 *
 * Base game: every cell is an independent weighted draw. 3+ matching symbols
 * from the first reel pay along a line; WILD stands in for everything but
 * BONUS, and a line pays the better of its wild-only and symbol reading. Line
 * pays are × the line bet (bet / 5).
 *
 * Hold & Win: 3+ BONUS symbols anywhere start 10 spins on the same 5×3 board,
 * seeded with a coin on every BONUS cell. Each spin, every free cell may land:
 * - a coin: sticks to the board with a value (× bet),
 * - a glover: multiplies the coins in its 8 neighbours, then vanishes,
 * - a collector (UFO): pulls in the value of every coin on the board, then
 *   wipes it clean. Several collectors in one spin each pull the full board.
 * Only collected value pays: coins left on the board at the end pay nothing.
 *
 * The buy starts the bonus with exactly 3 seeds. Every amount here is a
 * multiple of the bet; the server pays floor(bet × win). The round is capped
 * at MAX_WIN × bet. Pure: all randomness comes from the `rng` passed in.
 */

export const XS_COLS = 5
export const XS_ROWS = 3
export const XS_CELLS = XS_COLS * XS_ROWS
export const XS_MAX_WIN = 5000
export const XS_BONUS_TRIGGER = 3
export const XS_BONUS_SPINS = 10
/** Feature buy price, × bet. */
export const XS_BUY_COST = 52

export type XsSymbol
    = 'ten' | 'jack' | 'queen' | 'king' | 'ace'
        | 'bell' | 'seven' | 'diamond'
        | 'wild' | 'bonus'
export type XsPaySymbol = Exclude<XsSymbol, 'bonus'>

/** Reel weights, the same on every reel. RTP retune: wild 4 → 3.6 (the old site ran ~98%). */
export const XS_WEIGHTS: Record<XsSymbol, number> = {
    ten: 30, jack: 28, queen: 24, king: 20, ace: 16,
    bell: 12, seven: 7, diamond: 4,
    wild: 3.6, bonus: 5
}

/** × line bet for 3, 4 and 5 of a kind. */
export const XS_PAYTABLE: Record<XsPaySymbol, readonly [number, number, number]> = {
    ten: [5, 10, 25],
    jack: [5, 10, 25],
    queen: [8, 15, 40],
    king: [8, 18, 50],
    ace: [12, 25, 60],
    bell: [18, 50, 120],
    seven: [40, 120, 360],
    diamond: [60, 250, 750],
    wild: [120, 600, 2500]
}

/** Row per reel, left to right: middle, top, bottom, V, ^. */
export const XS_PAYLINES: readonly (readonly number[])[] = [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0],
    [2, 1, 0, 1, 2]
]
export const XS_LINES = XS_PAYLINES.length

// Hold & Win odds per free cell and spin. The coin chance tapers as the
// board fills, so a board choked with coins (no room for a collector) stays
// rare.
const P_COIN_EMPTY = 0.22
const P_COIN_FULL = 0.06
const P_COLLECTOR = 0.028
const P_GLOVER = 0.028

/** Coin faces, × bet. */
export const XS_COIN_VALUES = [0.2, 0.5, 1, 2, 5, 10, 25, 50] as const
// RTP retune for the buy (~98% → ~96%): 0.2× 0.360 → 0.3625, 10× 0.033 → 0.0305.
const COIN_WEIGHTS = [0.3625, 0.254, 0.17, 0.1, 0.06, 0.0305, 0.02, 0.003] as const
export const XS_GLOVER_MULTS = [2, 5, 10] as const
const GLOVER_WEIGHTS = [0.7, 0.24, 0.06] as const

export interface Cell { col: number, row: number }

export interface XsLineWin {
    line: number
    symbol: XsPaySymbol
    count: number
    cells: Cell[]
    /** × bet. */
    win: number
}

export interface XsCoin { cell: Cell, value: number }
export interface XsCollector { cell: Cell, collected: number }
export interface XsGloverUpgrade { cell: Cell, from: number, to: number }
export interface XsGlover { cell: Cell, mult: number, upgrades: XsGloverUpgrade[] }

export interface XsWave {
    round: number
    /** Free cells that spun this wave. */
    spinning: Cell[]
    coins: XsCoin[]
    glovers: XsGlover[]
    collectors: XsCollector[]
    /** Every coin a collector pulled in this wave. */
    collectedCoins: XsCoin[]
    /** × bet collected this wave. */
    collected: number
    cleared: boolean
    spinsLeft: number
    /** Coins on the board once the wave resolved. */
    board: XsCoin[]
}

export interface XsBonus {
    seed: XsCoin[]
    waves: XsWave[]
    /** × bet, before the cap. */
    win: number
}

export interface XenoSlotResult {
    buy: boolean
    grid: XsSymbol[][]
    lines: XsLineWin[]
    /** × bet. */
    baseWin: number
    bonusCells: Cell[]
    bonus: XsBonus | null
    /** × bet, capped at XS_MAX_WIN. */
    win: number
    capped: boolean
}

function weightedPick<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
    let total = 0
    for (const w of weights) total += w
    let r = rng.next() * total
    for (let i = 0; i < items.length; i++) {
        r -= weights[i]!
        if (r < 0) return items[i]!
    }
    return items[items.length - 1]!
}

const SYMBOLS = Object.keys(XS_WEIGHTS) as XsSymbol[]
const SYMBOL_WEIGHTS = SYMBOLS.map(s => XS_WEIGHTS[s])
const PLAIN_SYMBOLS = SYMBOLS.filter(s => s !== 'bonus')
const PLAIN_WEIGHTS = PLAIN_SYMBOLS.map(s => XS_WEIGHTS[s])

const key = (c: Cell) => c.col * XS_ROWS + c.row

function allCells(): Cell[] {
    const cells: Cell[] = []
    for (let col = 0; col < XS_COLS; col++) for (let row = 0; row < XS_ROWS; row++) cells.push({ col, row })
    return cells
}

function neighbours(c: Cell): Cell[] {
    const out: Cell[] = []
    for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
            if (!dc && !dr) continue
            const col = c.col + dc
            const row = c.row + dr
            if (col >= 0 && col < XS_COLS && row >= 0 && row < XS_ROWS) out.push({ col, row })
        }
    }
    return out
}

export function coinChance(coinsOnBoard: number): number {
    const t = Math.min(coinsOnBoard / (XS_CELLS - 1), 1)
    return P_COIN_EMPTY - (P_COIN_EMPTY - P_COIN_FULL) * t
}

/** The best reading of one line, or null. */
export function evaluateLine(grid: XsSymbol[][], index: number): XsLineWin | null {
    const rows = XS_PAYLINES[index]!
    const symbols = rows.map((row, col) => grid[col]![row]!)
    const first = symbols.find(s => s !== 'wild')

    const payFor = (symbol: XsPaySymbol): XsLineWin | null => {
        let count = 0
        for (const s of symbols) {
            if (s === symbol || s === 'wild') count++
            else break
        }
        if (count < 3) return null
        return {
            line: index,
            symbol,
            count,
            cells: rows.slice(0, count).map((row, col) => ({ col, row })),
            win: XS_PAYTABLE[symbol][count - 3]! / XS_LINES
        }
    }

    let best = payFor('wild')
    if (first && first !== 'bonus') {
        const own = payFor(first)
        if (own && (!best || own.win > best.win)) best = own
    }
    return best
}

export function evaluateLines(grid: XsSymbol[][]): XsLineWin[] {
    const wins: XsLineWin[] = []
    for (let i = 0; i < XS_LINES; i++) {
        const win = evaluateLine(grid, i)
        if (win) wins.push(win)
    }
    return wins
}

export function findBonusCells(grid: XsSymbol[][]): Cell[] {
    return allCells().filter(c => grid[c.col]![c.row] === 'bonus')
}

/** Plays the Hold & Win from its seed cells. */
export function runBonus(rng: Rng, seedCells: Cell[]): XsBonus {
    const board = new Map<number, XsCoin>()
    const pickCoin = () => weightedPick(rng, XS_COIN_VALUES, COIN_WEIGHTS)
    const seed = seedCells.map(cell => ({ cell, value: pickCoin() }))
    for (const coin of seed) board.set(key(coin.cell), { ...coin })

    const cells = allCells()
    const waves: XsWave[] = []
    let win = 0

    for (let round = 1; round <= XS_BONUS_SPINS; round++) {
        const free = cells.filter(c => !board.has(key(c)))
        const coins: XsCoin[] = []
        const collectors: XsCollector[] = []
        const glovers: XsGlover[] = []

        const pCoin = coinChance(board.size)
        for (const cell of free) {
            const r = rng.next()
            if (r < pCoin) coins.push({ cell, value: pickCoin() })
            else if (r < pCoin + P_COLLECTOR) collectors.push({ cell, collected: 0 })
            else if (r < pCoin + P_COLLECTOR + P_GLOVER) glovers.push({ cell, mult: weightedPick(rng, XS_GLOVER_MULTS, GLOVER_WEIGHTS), upgrades: [] })
        }

        // Keep one cell free so a glover or collector can still land, unless a
        // collector is about to wipe the board anyway.
        if (!collectors.length && coins.length && board.size + coins.length >= XS_CELLS) coins.pop()

        for (const coin of coins) board.set(key(coin.cell), { ...coin })

        // Glovers resolve after the coins lock; a coin next to two is boosted twice.
        for (const glover of glovers) {
            for (const cell of neighbours(glover.cell)) {
                const coin = board.get(key(cell))
                if (!coin) continue
                const from = coin.value
                coin.value = from * glover.mult
                glover.upgrades.push({ cell, from, to: coin.value })
            }
        }

        let collectedCoins: XsCoin[] = []
        let collected = 0
        if (collectors.length) {
            collectedCoins = [...board.values()].map(c => ({ cell: c.cell, value: c.value }))
            const sum = collectedCoins.reduce((a, c) => a + c.value, 0)
            for (const collector of collectors) collector.collected = sum
            collected = sum * collectors.length
            win += collected
            board.clear()
        }

        waves.push({
            round,
            spinning: free,
            coins,
            glovers,
            collectors,
            collectedCoins,
            collected,
            cleared: collectors.length > 0,
            spinsLeft: XS_BONUS_SPINS - round,
            board: [...board.values()].map(c => ({ cell: c.cell, value: c.value }))
        })
    }

    return { seed, waves, win }
}

function drawGrid(rng: Rng, symbols: readonly XsSymbol[], weights: readonly number[]): XsSymbol[][] {
    return Array.from({ length: XS_COLS }, () => Array.from({ length: XS_ROWS }, () => weightedPick(rng, symbols, weights)))
}

/** A bought bonus: no stray BONUS symbols, then exactly 3 forced ones. */
function buyGrid(rng: Rng): { grid: XsSymbol[][], cells: Cell[] } {
    const grid = drawGrid(rng, PLAIN_SYMBOLS, PLAIN_WEIGHTS)
    const pool = allCells()
    const cells: Cell[] = []
    for (let i = 0; i < XS_BONUS_TRIGGER; i++) {
        const [cell] = pool.splice(randomInt(rng, 0, pool.length - 1), 1)
        grid[cell!.col]![cell!.row] = 'bonus'
        cells.push(cell!)
    }
    return { grid, cells }
}

export function playXenoSlot(rng: Rng, options: { buy?: boolean } = {}): XenoSlotResult {
    const buy = options.buy === true
    let grid: XsSymbol[][]
    let lines: XsLineWin[] = []
    let bonusCells: Cell[]

    if (buy) {
        ({ grid, cells: bonusCells } = buyGrid(rng))
    } else {
        grid = drawGrid(rng, SYMBOLS, SYMBOL_WEIGHTS)
        lines = evaluateLines(grid)
        bonusCells = findBonusCells(grid)
    }

    const baseWin = lines.reduce((a, l) => a + l.win, 0)
    const bonus = bonusCells.length >= XS_BONUS_TRIGGER ? runBonus(rng, bonusCells) : null
    const total = baseWin + (bonus?.win ?? 0)
    const capped = total >= XS_MAX_WIN
    return { buy, grid, lines, baseWin, bonusCells, bonus, win: Math.min(XS_MAX_WIN, total), capped }
}

/** Options as the play endpoint receives them. Throws RangeError on anything else. */
export function parseXenoSlotOptions(options: Record<string, unknown>): { buy: boolean } {
    for (const name of Object.keys(options)) {
        if (name !== 'buy') throw new RangeError(`Unknown option ${name}`)
    }
    if (options.buy !== undefined && typeof options.buy !== 'boolean') throw new RangeError('buy is true or false')
    return { buy: options.buy === true }
}

/** What a round costs, in coins. */
export function xenoSlotStake(bet: number, buy: boolean): number {
    return buy ? costFor(bet, XS_BUY_COST) : bet
}

/** What a round pays, in coins rounded down to 0.0001. */
export function xenoSlotPayout(result: XenoSlotResult, bet: number): number {
    return payFor(bet, result.win)
}
