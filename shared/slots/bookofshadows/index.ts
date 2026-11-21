import { randomInt, randomSample, weightedPick, type Rng } from '../../rng'

/**
 * Book of Shadows: a 5×6 grid where wins connect from the leftmost reel to
 * the right. From one reel to the next a matching symbol may sit in the same
 * row or one row up or down, so a run can zigzag. BOOK is wild and scatter.
 * Runs of 3+ reels pay.
 *
 * 3+ BOOKs anywhere start 10 free spins. In free spins an unlocked reel can
 * land the rare BONUS_WILD, which fills the reel and stays for the rest of the
 * feature. 3 BOOKs on one free spin add 4 spins once, and BOOKs stop landing
 * after that. Before the spins a bonus symbol is drawn; its multiplier scales
 * only the wins that run through a BONUS_WILD reel.
 *
 * The whole round, free spins included, is resolved here in one go. Every
 * amount is a multiple of the bet; the server pays floor(bet × win).
 */

export const BOS_COLS = 5
export const BOS_ROWS = 6
export const BOS_MIN_CONNECTION = 3

/** Hard cap on a round's total win, in × bet (the old site's cap). */
export const BOS_MAX_WIN = 20_000

/**
 * A feature buy costs this many bets and starts the free spins for sure.
 * Old site 56.5; the casino's buy costs are whole multiples of the bet.
 */
export const BOS_BUY_COST = 56

export const BONUS_TRIGGER_COUNT = 3
export const BONUS_SPINS = 10
export const BONUS_RETRIGGER_BOOKS = 3
export const BONUS_RETRIGGER_SPINS = 4
/** Chance an unlocked reel turns into a BONUS_WILD reel on a free spin. */
export const BONUS_WILD_CHANCE = 0.07

export type SlotSymbol
    = 'ten' | 'jack' | 'queen' | 'king' | 'ace'
        | 'sword' | 'orb' | 'scythe' | 'hood'
        | 'book' | 'bonuswild'

export type ReelSymbol = Exclude<SlotSymbol, 'bonuswild'>

/** Reel weights, the same on every reel. BONUS_WILD only comes from the free-spin reel roll. */
export const SYMBOL_WEIGHTS: Readonly<Record<ReelSymbol, number>> = {
    ten: 26, jack: 24, queen: 20, king: 18, ace: 14,
    sword: 10, orb: 8, scythe: 6, hood: 4,
    book: 2
}

const NO_BOOK_WEIGHTS: Readonly<Record<Exclude<ReelSymbol, 'book'>, number>> = (() => {
    const { book: _book, ...rest } = SYMBOL_WEIGHTS
    return rest
})()

/**
 * × bet for a connected run of [3, 4, 5] reels. One table for base and free spins.
 * RTP retune: bonuswild was [4.6, 14, 42] on the old site (paid spins ~96.8% → ~95.5%,
 * the buy ~98% → ~97%; scripts/bookofshadows-rtp.ts).
 */
export const PAYTABLE: Readonly<Record<SlotSymbol, readonly [number, number, number]>> = {
    ten: [0.18, 0.45, 0.9],
    jack: [0.18, 0.45, 0.9],
    queen: [0.22, 0.65, 1.3],
    king: [0.26, 0.9, 1.8],
    ace: [0.44, 1.1, 2.2],
    sword: [0.55, 1.3, 3],
    orb: [0.66, 1.8, 4.4],
    scythe: [0.9, 2.2, 5.3],
    hood: [1.1, 3, 8],
    book: [1.2, 3.6, 12],
    bonuswild: [4.4, 13.4, 40]
}

export interface BonusTier {
    id: string
    symbol: Exclude<SlotSymbol, 'ten' | 'bonuswild'>
    label: string
    multiplier: number
    weight: number
}

/** The drawn bonus symbol. Its multiplier applies to wild-reel wins only. */
export const BONUS_TIERS: readonly BonusTier[] = [
    { id: 'book', symbol: 'book', label: 'Book', multiplier: 1, weight: 33 },
    { id: 'jack', symbol: 'jack', label: 'Jack', multiplier: 1, weight: 27 },
    { id: 'queen', symbol: 'queen', label: 'Queen', multiplier: 1.6, weight: 19 },
    { id: 'king', symbol: 'king', label: 'King', multiplier: 3.5, weight: 10 },
    { id: 'ace', symbol: 'ace', label: 'Ace', multiplier: 6, weight: 5.5 },
    { id: 'sword', symbol: 'sword', label: 'Sword', multiplier: 12, weight: 2.6 },
    { id: 'orb', symbol: 'orb', label: 'Orb', multiplier: 22, weight: 1.2 },
    { id: 'scythe', symbol: 'scythe', label: 'Scythe', multiplier: 35, weight: 0.55 },
    { id: 'hood', symbol: 'hood', label: 'Hood', multiplier: 60, weight: 0.33 }
]

const TIER_WEIGHTS: Record<string, number> = Object.fromEntries(BONUS_TIERS.map(tier => [tier.id, tier.weight]))

export type Grid = SlotSymbol[][]

export interface Cell { col: number, row: number }

export interface ConnectionWin {
    symbol: SlotSymbol
    /** Connected reels: 3, 4 or 5. */
    length: number
    /** × bet, before any bonus tier multiplier. */
    amount: number
    cells: Cell[]
}

export interface BonusSpin {
    /** The reels as they land (a new wild reel shows one BONUS_WILD). */
    landedGrid: Grid
    /** After new wild reels fill: what pays. */
    expandedGrid: Grid
    newlyLocked: number[]
    wins: ConnectionWin[]
    /** Wins without a BONUS_WILD, × bet. */
    ordinaryWin: number
    /** Wins through a BONUS_WILD, × bet, before the tier multiplier. */
    wildWin: number
    booksLanded: number
    retriggered: boolean
}

export interface BonusResult {
    tier: BonusTier
    spins: BonusSpin[]
    lockedColumns: number[]
    ordinaryWin: number
    wildBaseline: number
    /** wildBaseline × tier multiplier. */
    wildWin: number
    /** ordinaryWin + wildWin, before the round's cap. */
    totalWin: number
    retriggered: boolean
    totalSpins: number
}

export interface BookOfShadowsOutcome {
    bought: boolean
    grid: Grid
    wins: ConnectionWin[]
    /** The base grid's own wins, × bet (capped). */
    baseWin: number
    bonus: BonusResult | null
    /** The whole round, × bet, capped at BOS_MAX_WIN. */
    win: number
    capped: boolean
    feature: boolean
}

function drawColumn(rng: Rng, booksAllowed = true): SlotSymbol[] {
    const weights = booksAllowed ? SYMBOL_WEIGHTS : NO_BOOK_WEIGHTS
    return Array.from({ length: BOS_ROWS }, () => weightedPick(rng, weights))
}

function drawGrid(rng: Rng): Grid {
    return Array.from({ length: BOS_COLS }, () => drawColumn(rng))
}

/** Put BOOKs on BONUS_TRIGGER_COUNT distinct cells (a feature buy). */
function placeBooks(rng: Rng, grid: Grid) {
    const cells = Array.from({ length: BOS_COLS * BOS_ROWS }, (_, i) => i)
    for (const index of randomSample(rng, cells, BONUS_TRIGGER_COUNT)) {
        grid[Math.floor(index / BOS_ROWS)]![index % BOS_ROWS] = 'book'
    }
}

export function countBooks(grid: Grid): number {
    let books = 0
    for (const column of grid) for (const symbol of column) if (symbol === 'book') books++
    return books
}

/**
 * Groups of cells matching `symbol` (or a wild), linked reel to reel within
 * one row up or down. Two matches on the first reel only belong together when
 * a path of matching cells joins them.
 */
function connectedGroups(grid: Grid, symbol: SlotSymbol, wilds: readonly SlotSymbol[]): Cell[][] {
    const matches = (col: number, row: number) => {
        const value = grid[col]![row]!
        return value === symbol || wilds.includes(value)
    }
    const parent = new Map<number, number>()
    const id = (col: number, row: number) => col * BOS_ROWS + row
    const find = (x: number): number => {
        let root = x
        while (parent.get(root) !== root) root = parent.get(root)!
        while (parent.get(x) !== root) {
            const next = parent.get(x)!
            parent.set(x, root)
            x = next
        }
        return root
    }

    for (let col = 0; col < BOS_COLS; col++) {
        for (let row = 0; row < BOS_ROWS; row++) if (matches(col, row)) parent.set(id(col, row), id(col, row))
    }
    for (let col = 0; col < BOS_COLS - 1; col++) {
        for (let row = 0; row < BOS_ROWS; row++) {
            if (!matches(col, row)) continue
            for (const next of [row - 1, row, row + 1]) {
                if (next < 0 || next >= BOS_ROWS || !matches(col + 1, next)) continue
                const a = find(id(col, row))
                const b = find(id(col + 1, next))
                if (a !== b) parent.set(a, b)
            }
        }
    }

    const groups = new Map<number, Cell[]>()
    for (let col = 0; col < BOS_COLS; col++) {
        for (let row = 0; row < BOS_ROWS; row++) {
            if (!matches(col, row)) continue
            const root = find(id(col, row))
            if (!groups.has(root)) groups.set(root, [])
            groups.get(root)!.push({ col, row })
        }
    }
    return [...groups.values()]
}

const SCAN_ORDER = Object.keys(SYMBOL_WEIGHTS) as ReelSymbol[]

/**
 * Every paying connection on a grid. Base spins pass BOOK as the only wild;
 * free spins pass BOOK and BONUS_WILD. A wild-only group pays at the rate of
 * the best wild in it (a BONUS_WILD group pays the bonus-wild rate); BONUS_WILD
 * is never scanned as its own target, or the same cells would pay twice.
 */
export function evaluateGrid(grid: Grid, wilds: readonly SlotSymbol[] = ['book']): ConnectionWin[] {
    const wins: ConnectionWin[] = []
    for (const symbol of SCAN_ORDER) {
        for (const cells of connectedGroups(grid, symbol, wilds)) {
            if (!cells.some(cell => cell.col === 0)) continue
            const length = Math.max(...cells.map(cell => cell.col)) + 1
            if (length < BOS_MIN_CONNECTION) continue

            let pays: SlotSymbol = symbol
            if (symbol === 'book') {
                const upgrade = cells.find(cell => grid[cell.col]![cell.row] !== 'book' && wilds.includes(grid[cell.col]![cell.row]!))
                if (upgrade) pays = grid[upgrade.col]![upgrade.row]!
            }
            // A run made only of wilds pays once, on the wild scan, not on every symbol's.
            if (!cells.some(cell => grid[cell.col]![cell.row] === pays)) continue

            wins.push({ symbol: pays, length, amount: PAYTABLE[pays][length - BOS_MIN_CONNECTION]!, cells })
        }
    }
    return wins
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0)
}

/** Pays have at most three decimals; drop the float noise sums pick up so floor(bet × win) never loses a coin. */
function clean(value: number): number {
    return Math.round(value * 1e6) / 1e6
}

function bonusSpin(rng: Rng, locked: Set<number>, booksAllowed: boolean) {
    const landedGrid: Grid = []
    const expandedGrid: Grid = []
    const newlyLocked: number[] = []
    for (let col = 0; col < BOS_COLS; col++) {
        if (locked.has(col)) {
            landedGrid.push(Array<SlotSymbol>(BOS_ROWS).fill('bonuswild'))
            expandedGrid.push(Array<SlotSymbol>(BOS_ROWS).fill('bonuswild'))
            continue
        }
        const column = drawColumn(rng, booksAllowed)
        if (rng.next() < BONUS_WILD_CHANCE) {
            // One BONUS_WILD lands, then the whole reel fills with it.
            column[randomInt(rng, 0, BOS_ROWS - 1)] = 'bonuswild'
            landedGrid.push(column)
            expandedGrid.push(Array<SlotSymbol>(BOS_ROWS).fill('bonuswild'))
            newlyLocked.push(col)
            locked.add(col)
        } else {
            landedGrid.push(column)
            expandedGrid.push(column.slice())
        }
    }
    return { landedGrid, expandedGrid, newlyLocked }
}

export function playBonus(rng: Rng): BonusResult {
    const locked = new Set<number>()
    const spins: BonusSpin[] = []
    let totalSpins = BONUS_SPINS
    let booksAllowed = true
    let retriggered = false

    for (let i = 0; i < totalSpins; i++) {
        const { landedGrid, expandedGrid, newlyLocked } = bonusSpin(rng, locked, booksAllowed)
        const booksLanded = countBooks(landedGrid)
        let spinRetriggered = false
        if (booksAllowed && booksLanded >= BONUS_RETRIGGER_BOOKS) {
            retriggered = true
            spinRetriggered = true
            booksAllowed = false
            totalSpins += BONUS_RETRIGGER_SPINS
        }
        const wins = evaluateGrid(expandedGrid, ['book', 'bonuswild'])
        const wildWin = sum(wins.filter(win => win.symbol === 'bonuswild').map(win => win.amount))
        const ordinaryWin = sum(wins.filter(win => win.symbol !== 'bonuswild').map(win => win.amount))
        spins.push({ landedGrid, expandedGrid, newlyLocked, wins, ordinaryWin, wildWin, booksLanded, retriggered: spinRetriggered })
    }

    const tierId = weightedPick(rng, TIER_WEIGHTS)
    const tier = BONUS_TIERS.find(t => t.id === tierId)!
    const ordinaryWin = sum(spins.map(spin => spin.ordinaryWin))
    const wildBaseline = sum(spins.map(spin => spin.wildWin))
    const wildWin = wildBaseline * tier.multiplier
    return {
        tier,
        spins,
        lockedColumns: [...locked].sort((a, b) => a - b),
        ordinaryWin,
        wildBaseline,
        wildWin,
        totalWin: ordinaryWin + wildWin,
        retriggered,
        totalSpins
    }
}

export function playBookOfShadows(rng: Rng, opts: { buy?: boolean } = {}): BookOfShadowsOutcome {
    const bought = opts.buy === true
    const grid = drawGrid(rng)
    if (bought) placeBooks(rng, grid)

    const wins = evaluateGrid(grid)
    const rawBase = sum(wins.map(win => win.amount))
    const bonus = bought || countBooks(grid) >= BONUS_TRIGGER_COUNT ? playBonus(rng) : null
    const raw = clean(rawBase + (bonus?.totalWin ?? 0))
    const capped = raw >= BOS_MAX_WIN
    return {
        bought,
        grid,
        wins,
        baseWin: Math.min(clean(rawBase), BOS_MAX_WIN),
        bonus,
        win: Math.min(raw, BOS_MAX_WIN),
        capped,
        feature: bonus !== null
    }
}
