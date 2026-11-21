import type { Rng } from '../../rng'

/**
 * Ember Portals: a 7×7 cluster-pays tumble slot built around portal wilds
 * that grow, wander and merge. Pure: every outcome comes from the `rng`
 * passed in, and every amount is a multiple of the bet (the server pays
 * `floor(bet × win)`).
 *
 * Base game: every cell is a weighted draw. A win is 5+ cells of one pay
 * symbol joined horizontally or vertically; portal wilds join any cluster
 * they touch. A cluster pays PAYTABLE[symbol][bracket(size)] × the sum of the
 * wild multipliers inside it (×1 without wilds). Paying symbols burn away,
 * everything above falls and fresh symbols drop in until no cluster is left.
 * Wilds never fall: they hold their cell.
 *
 * Portals: a winning cluster without a wild opens a ×1 portal on one of its
 * cells. A wild in a win grows by +1 and jumps to a cell of that win. Wilds
 * that share a win (directly or through clusters that share a wild) merge
 * into one portal worth the product of their multipliers, never less than
 * their sum + 1, up to EP_WILD_MAX_MULT. Base game portals close when the
 * tumbles end, unless the spin triggers free spins: then they carry over.
 *
 * Free spins: 3-7 scatters on the settled screen award 10-18 spins. Portals
 * stay open for the whole feature. 3+ scatters in the feature add
 * FS_RETRIGGER_SPINS. Ante: EP_ANTE_COST × bet, scatters land more often.
 * Buy: EP_BUY_COST × bet starts the free spins. The round pays at most
 * EP_MAX_WIN_MULT × bet; the feature stops at the cap.
 */

export const EP_COLS = 7
export const EP_ROWS = 7
export const EP_MIN_CLUSTER = 5
export const EP_MAX_WIN_MULT = 10_000
export const EP_WILD_MAX_MULT = 256
/** Safety bound on tumbles in one spin. */
export const EP_MAX_TUMBLES = 200

export type EpPaySymbol = 'ember' | 'rune' | 'potion' | 'hourglass' | 'chalice' | 'amulet' | 'grimoire' | 'phoenix'
export type EpSymbol = EpPaySymbol | 'wild' | 'scatter'

/** Low to high. */
export const EP_PAY_SYMBOLS: EpPaySymbol[] = ['ember', 'rune', 'potion', 'hourglass', 'chalice', 'amulet', 'grimoire', 'phoenix']

/** Smallest cluster size of each paytable column. */
export const EP_BRACKETS = [5, 6, 7, 8, 9, 10, 11, 13, 15] as const

/** Pays × bet per cluster before EP_PAY_SCALE, one column per bracket in EP_BRACKETS. */
const PAYTABLE: Record<EpPaySymbol, number[]> = {
    ember: [0.3, 0.4, 0.5, 0.7, 0.8, 1.4, 2.8, 5.5, 14],
    rune: [0.4, 0.5, 0.7, 0.8, 1.1, 1.6, 3.3, 6.6, 16],
    potion: [0.5, 0.7, 0.8, 1.1, 1.4, 2.2, 4.4, 8, 22],
    hourglass: [0.7, 0.8, 1.1, 1.4, 1.6, 2.8, 5.5, 11, 28],
    chalice: [0.8, 1.1, 1.4, 1.6, 2.8, 3.3, 6.6, 16, 44],
    amulet: [1.1, 1.4, 1.6, 2.8, 3.3, 5.5, 11, 28, 70],
    grimoire: [1.4, 1.6, 2.8, 3.3, 5.5, 8, 16, 40, 140],
    phoenix: [1.6, 2.8, 3.3, 5.5, 8, 14, 28, 70, 275]
}

/**
 * Every pay is scaled by this, in base game and free spins alike; tuned with
 * scripts/emberportals-rtp.ts (retune by ratio). Measured over 52M spins:
 * paid spins ~96.0%, ante ~95.9% (20M), buy ~96.9% (3M buys). The old site
 * paid the table unscaled (1 → 0.982, from ~97.5%).
 */
export const EP_PAY_SCALE = 0.982

export function bracketIndex(size: number): number {
    let i = -1
    for (let b = 0; b < EP_BRACKETS.length; b++) if (size >= EP_BRACKETS[b]!) i = b
    return i
}

/** What a cluster of `size` pays, × bet, before wild multipliers. */
export function clusterPay(symbol: EpPaySymbol, size: number): number {
    const i = bracketIndex(size)
    return i < 0 ? 0 : round4(PAYTABLE[symbol][i]! * EP_PAY_SCALE)
}

type Weights = Record<EpPaySymbol | 'scatter', number>

const BASE_PAY = { ember: 150, rune: 145, potion: 135, hourglass: 125, chalice: 100, amulet: 85, grimoire: 70, phoenix: 55 }

export const BASE_WEIGHTS: Weights = { ...BASE_PAY, scatter: 6.4 }
/** Ante: same symbols, free spins trigger more often. */
export const ANTE_WEIGHTS: Weights = { ...BASE_PAY, scatter: 7.12 }
/** Free spins drop the embers, so clusters (and portals) land more often. */
export const FS_WEIGHTS: Weights = { ember: 0, rune: 218, potion: 160, hourglass: 140, chalice: 110, amulet: 90, grimoire: 70, phoenix: 50, scatter: 4 }

export const FS_TRIGGER = 3
/** Free spins for 3, 4, 5, 6 and 7+ scatters. */
export const FS_AWARD = [10, 12, 14, 16, 18] as const
export const FS_RETRIGGER_SPINS = 5
export const FS_MAX_SPINS = 60

/** Ante bet cost, × bet (the stake rounds up to whole coins). */
export const EP_ANTE_COST = 1.25
/** Free-spins buy cost, × bet. The old site charged 103 (103 → 102 with EP_PAY_SCALE). */
export const EP_BUY_COST = 102

export function fsAward(scatters: number): number {
    if (scatters < FS_TRIGGER) return 0
    return FS_AWARD[Math.min(scatters, 7) - FS_TRIGGER]!
}

// --- result shapes ----------------------------------------------------------

export interface Cell { col: number, row: number }

export interface EpWild {
    /** Stable id for animation: a merged portal keeps the id of the biggest one. */
    id: number
    col: number
    row: number
    mult: number
}

export interface EpCluster {
    symbol: EpPaySymbol
    /** Every cell, wilds included. */
    cells: Cell[]
    size: number
    /** Ids of the wilds in this cluster. */
    wilds: number[]
    /** Sum of those wilds' multipliers, 1 without wilds. */
    mult: number
    /** Paytable value × bet, before the multiplier. */
    base: number
    /** × bet. */
    amount: number
}

export interface EpWildChange {
    /** Id of the portal after this step. */
    id: number
    kind: 'spawn' | 'grow'
    /** Ids folded into this portal (merge), besides itself. */
    merged: number[]
    from: Cell | null
    to: Cell
    prevMult: number
    mult: number
}

export interface EpTumble {
    /** The screen these clusters were found on. */
    grid: EpSymbol[][]
    clusters: EpCluster[]
    /** × bet. */
    win: number
    /** Portals after this step's grow / move / merge / spawn. */
    wilds: EpWild[]
    wildChanges: EpWildChange[]
    /** Cells emptied by this step (burnt symbols and portals that moved away). */
    removed: Cell[]
    /** Symbols that fell: same column, from row → to row. */
    falls: { col: number, from: number, to: number }[]
    /** Symbols dropped in from above to fill the gaps. */
    fresh: { col: number, row: number, symbol: EpSymbol }[]
}

export interface EpSpin {
    /** Screen as it lands (open portals already in place). */
    grid: EpSymbol[][]
    /** Portals open when the spin lands. */
    wildsStart: EpWild[]
    tumbles: EpTumble[]
    /** Screen once the tumbles settle. */
    finalGrid: EpSymbol[][]
    /** Portals once the tumbles settle (before the base game closes them). */
    wildsEnd: EpWild[]
    /** × bet. */
    win: number
    scatters: Cell[]
}

export interface EpFreeSpin extends EpSpin {
    index: number
    /** Spins added by this spin's scatters. */
    retrigger: number
    totalSpins: number
    /** × bet, the feature so far. */
    runningTotal: number
}

export interface EpFreeSpins {
    source: 'scatter' | 'buy'
    awarded: number
    spins: EpFreeSpin[]
    /** × bet. */
    total: number
    capped: boolean
}

export type EpMode = 'normal' | 'ante' | 'buy'

/** One round. Every amount is a multiple of the bet. */
export interface EmberPortalsResult {
    mode: EpMode
    base: EpSpin
    freeSpins: EpFreeSpins | null
    bonusTriggered: boolean
    /** Total win, × bet (base + feature, capped). */
    win: number
    capped: boolean
}

// --- rng helpers ------------------------------------------------------------

interface Table { items: EpSymbol[], cum: number[], total: number }

function table(w: Weights): Table {
    const items = (Object.keys(w) as (keyof Weights)[]).filter(k => w[k] > 0)
    const cum: number[] = []
    let total = 0
    for (const k of items) {
        total += w[k]
        cum.push(total)
    }
    return { items, cum, total }
}

function pick(t: Table, rng: Rng): EpSymbol {
    const r = rng.next() * t.total
    for (let i = 0; i < t.cum.length; i++) if (r < t.cum[i]!) return t.items[i]!
    return t.items[t.items.length - 1]!
}

const BASE_TABLE = table(BASE_WEIGHTS)
const ANTE_TABLE = table(ANTE_WEIGHTS)
const FS_TABLE = table(FS_WEIGHTS)
const PLAIN_TABLE = table({ ...BASE_PAY, scatter: 0 })

function round4(v: number) {
    return Math.round(v * 10000) / 10000
}
const key = (col: number, row: number) => col * EP_ROWS + row

// --- clusters ---------------------------------------------------------------

/** All paying clusters on a screen. `wildAt` maps a cell key to the portal on it. */
export function findClusters(grid: EpSymbol[][], wildAt: Map<number, EpWild>): EpCluster[] {
    const out: EpCluster[] = []
    const seen = new Uint8Array(EP_COLS * EP_ROWS)
    for (const sym of EP_PAY_SYMBOLS) {
        seen.fill(0)
        for (let col = 0; col < EP_COLS; col++) {
            for (let row = 0; row < EP_ROWS; row++) {
                if (grid[col]![row] !== sym || seen[key(col, row)]) continue
                // Flood fill over this symbol and wilds. Wilds are marked per
                // fill so two separate clusters can share one.
                const cells: Cell[] = []
                const wildSeen = new Set<number>()
                const stack: Cell[] = [{ col, row }]
                seen[key(col, row)] = 1
                while (stack.length) {
                    const c = stack.pop()!
                    cells.push(c)
                    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                        const nc = c.col + dc
                        const nr = c.row + dr
                        if (nc < 0 || nr < 0 || nc >= EP_COLS || nr >= EP_ROWS) continue
                        const k = key(nc, nr)
                        const s = grid[nc]![nr]
                        if (s === sym && !seen[k]) {
                            seen[k] = 1
                            stack.push({ col: nc, row: nr })
                        } else if (s === 'wild' && !wildSeen.has(k)) {
                            wildSeen.add(k)
                            stack.push({ col: nc, row: nr })
                        }
                    }
                }
                if (cells.length < EP_MIN_CLUSTER) continue
                const wilds: number[] = []
                let mult = 0
                for (const k of wildSeen) {
                    const w = wildAt.get(k)
                    if (!w) throw new Error('A wild cell without a portal')
                    wilds.push(w.id)
                    mult += w.mult
                }
                if (!wilds.length) mult = 1
                const base = clusterPay(sym, cells.length)
                out.push({ symbol: sym, cells, size: cells.length, wilds, mult, base, amount: round4(base * mult) })
            }
        }
    }
    return out
}

function cloneGrid(grid: EpSymbol[][]): EpSymbol[][] {
    return grid.map(col => col.slice())
}

function drawGrid(t: Table, rng: Rng, wilds: EpWild[] = []): EpSymbol[][] {
    const grid: EpSymbol[][] = []
    for (let col = 0; col < EP_COLS; col++) {
        const column: EpSymbol[] = []
        for (let row = 0; row < EP_ROWS; row++) column.push(pick(t, rng))
        grid.push(column)
    }
    for (const w of wilds) grid[w.col]![w.row] = 'wild'
    return grid
}

function scattersOf(grid: EpSymbol[][]): Cell[] {
    const out: Cell[] = []
    for (let col = 0; col < EP_COLS; col++) {
        for (let row = 0; row < EP_ROWS; row++) if (grid[col]![row] === 'scatter') out.push({ col, row })
    }
    return out
}

export interface IdSource { next: number }

/** The merged multiplier of a group of portals that share a win. */
export function mergedMult(mults: number[]): number {
    const sum = mults.reduce((a, m) => a + m, 0)
    const product = mults.reduce((a, m) => a * m, 1)
    const grown = mults.length > 1 ? Math.max(product, sum + 1) : sum + 1
    return Math.min(EP_WILD_MAX_MULT, grown)
}

/**
 * Play one spin's tumble sequence on `startGrid` (portals already placed).
 * `room` is how much the sequence may still pay (× bet) before the max win.
 */
export function runTumbles(
    startGrid: EpSymbol[][],
    startWilds: EpWild[],
    t: Table,
    room: number,
    ids: IdSource,
    rng: Rng
): EpSpin {
    let grid = cloneGrid(startGrid)
    let wilds = startWilds.map(w => ({ ...w }))
    const tumbles: EpTumble[] = []
    let win = 0

    while (tumbles.length < EP_MAX_TUMBLES) {
        const wildAt = new Map<number, EpWild>()
        for (const w of wilds) wildAt.set(key(w.col, w.row), w)
        const clusters = findClusters(grid, wildAt)
        if (!clusters.length || win >= room) break

        let stepWin = round4(clusters.reduce((a, c) => a + c.amount, 0))
        if (win + stepWin > room) {
            // The max win cuts this step short: scale each cluster down so
            // the amounts shown still add up to what is paid.
            const scale = (room - win) / stepWin
            for (const c of clusters) c.amount = round4(c.amount * scale)
            stepWin = round4(room - win)
        }
        win = round4(win + stepWin)

        // Group clusters that share a wild (union-find over cluster indexes).
        const parent = clusters.map((_, i) => i)
        const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
        const owner = new Map<number, number>()
        clusters.forEach((c, i) => {
            for (const id of c.wilds) {
                const o = owner.get(id)
                if (o === undefined) owner.set(id, i)
                else parent[find(i)] = find(o)
            }
        })
        const groups = new Map<number, number[]>()
        clusters.forEach((_, i) => {
            const r = find(i)
            if (!groups.has(r)) groups.set(r, [])
            groups.get(r)!.push(i)
        })

        const removed = new Set<number>()
        for (const c of clusters) for (const cell of c.cells) if (grid[cell.col]![cell.row] !== 'wild') removed.add(key(cell.col, cell.row))

        const byId = new Map(wilds.map(w => [w.id, w]))
        const nextWilds = new Map(wilds.map(w => [w.id, w]))
        const changes: EpWildChange[] = []
        for (const members of groups.values()) {
            const area = new Map<number, Cell>()
            const groupIds = new Set<number>()
            for (const i of members) {
                for (const cell of clusters[i]!.cells) area.set(key(cell.col, cell.row), cell)
                for (const id of clusters[i]!.wilds) groupIds.add(id)
            }
            const cells = [...area.values()]
            const target = cells[Math.floor(rng.next() * cells.length)]!
            if (!groupIds.size) {
                const w = { id: ids.next++, col: target.col, row: target.row, mult: 1 }
                nextWilds.set(w.id, w)
                changes.push({ id: w.id, kind: 'spawn', merged: [], from: null, to: target, prevMult: 0, mult: 1 })
                continue
            }
            const group = [...groupIds].map(id => byId.get(id)!).sort((a, b) => b.mult - a.mult || a.id - b.id)
            const keep = group[0]!
            const mult = mergedMult(group.map(w => w.mult))
            for (const w of group) {
                nextWilds.delete(w.id)
                removed.add(key(w.col, w.row))
            }
            const w = { id: keep.id, col: target.col, row: target.row, mult }
            nextWilds.set(w.id, w)
            changes.push({
                id: w.id,
                kind: 'grow',
                merged: group.slice(1).map(g => g.id),
                from: { col: keep.col, row: keep.row },
                to: target,
                prevMult: keep.mult,
                mult
            })
        }

        wilds = [...nextWilds.values()]
        const wildCells = new Set(wilds.map(w => key(w.col, w.row)))
        for (const k of wildCells) removed.delete(k)

        // Gravity: symbols fall past portals into the emptied cells below.
        const next = cloneGrid(grid)
        const falls: EpTumble['falls'] = []
        const fresh: EpTumble['fresh'] = []
        for (let col = 0; col < EP_COLS; col++) {
            const survivors: { row: number, symbol: EpSymbol }[] = []
            for (let row = EP_ROWS - 1; row >= 0; row--) {
                const k = key(col, row)
                if (wildCells.has(k) || removed.has(k)) continue
                survivors.push({ row, symbol: grid[col]![row]! })
            }
            let s = 0
            for (let row = EP_ROWS - 1; row >= 0; row--) {
                if (wildCells.has(key(col, row))) {
                    next[col]![row] = 'wild'
                    continue
                }
                const sv = survivors[s++]
                if (sv) {
                    next[col]![row] = sv.symbol
                    if (sv.row !== row) falls.push({ col, from: sv.row, to: row })
                } else {
                    const symbol = pick(t, rng)
                    next[col]![row] = symbol
                    fresh.push({ col, row, symbol })
                }
            }
        }

        tumbles.push({
            grid,
            clusters,
            win: stepWin,
            wilds: wilds.map(w => ({ ...w })),
            wildChanges: changes,
            removed: [...removed].map(k => ({ col: Math.floor(k / EP_ROWS), row: k % EP_ROWS })),
            falls,
            fresh
        })
        grid = next
    }

    return {
        grid: cloneGrid(startGrid),
        wildsStart: startWilds.map(w => ({ ...w })),
        tumbles,
        finalGrid: grid,
        wildsEnd: wilds,
        win,
        scatters: scattersOf(grid)
    }
}

// --- free spins -------------------------------------------------------------

/** `startWilds` are the portals the triggering spin left open; they carry into the feature. */
export function runFreeSpins(
    awarded: number,
    source: EpFreeSpins['source'],
    room: number,
    rng: Rng,
    ids: IdSource = { next: 1 },
    startWilds: EpWild[] = []
): EpFreeSpins {
    const spins: EpFreeSpin[] = []
    let wilds = startWilds.map(w => ({ ...w }))
    let totalSpins = Math.min(awarded, FS_MAX_SPINS)
    let total = 0
    let capped = false

    for (let i = 0; i < totalSpins; i++) {
        const grid = drawGrid(FS_TABLE, rng, wilds)
        const spin = runTumbles(grid, wilds, FS_TABLE, round4(room - total), ids, rng)
        total = round4(total + spin.win)
        if (total >= room) capped = true
        wilds = spin.wildsEnd

        let retrigger = 0
        if (!capped && spin.scatters.length >= FS_TRIGGER && totalSpins < FS_MAX_SPINS) {
            retrigger = Math.min(FS_RETRIGGER_SPINS, FS_MAX_SPINS - totalSpins)
            totalSpins += retrigger
        }
        spins.push({ ...spin, index: i, retrigger, totalSpins, runningTotal: total })
        if (capped) break
    }
    return { source, awarded, spins, total, capped }
}

// --- main entry -------------------------------------------------------------

/** A screen with exactly FS_TRIGGER scatters on random cells (feature buy). */
function buyGrid(rng: Rng): EpSymbol[][] {
    const grid = drawGrid(PLAIN_TABLE, rng)
    const cells: number[] = []
    for (let i = 0; i < EP_COLS * EP_ROWS; i++) cells.push(i)
    for (let i = 0; i < FS_TRIGGER; i++) {
        const j = i + Math.floor(rng.next() * (cells.length - i))
        const tmp = cells[i]!
        cells[i] = cells[j]!
        cells[j] = tmp
        grid[Math.floor(cells[i]! / EP_ROWS)]![cells[i]! % EP_ROWS] = 'scatter'
    }
    return grid
}

/** Options from the client: `{ ante: true }` or `{ buy: true }`, never both. */
export function parseEmberPortalsMode(options: Record<string, unknown>): EpMode {
    const { ante, buy } = options
    if (ante !== undefined && typeof ante !== 'boolean') throw new RangeError('ante is true or false')
    if (buy !== undefined && typeof buy !== 'boolean') throw new RangeError('buy is true or false')
    if (ante && buy) throw new RangeError('A feature buy has no ante')
    if (buy) return 'buy'
    if (ante) return 'ante'
    return 'normal'
}

/** What a round costs in whole coins. */
export function emberPortalsStake(mode: EpMode, bet: number): number {
    if (mode === 'buy') return bet * EP_BUY_COST
    if (mode === 'ante') return Math.ceil(bet * EP_ANTE_COST)
    return bet
}

export function playEmberPortals(rng: Rng, mode: EpMode): EmberPortalsResult {
    const t = mode === 'ante' ? ANTE_TABLE : BASE_TABLE
    const ids: IdSource = { next: 1 }

    const grid = mode === 'buy' ? buyGrid(rng) : drawGrid(t, rng)
    const base = runTumbles(grid, [], t, EP_MAX_WIN_MULT, ids, rng)

    // Scatters count on the settled screen; a buy always has its three.
    const scatterCount = Math.max(base.scatters.length, mode === 'buy' ? FS_TRIGGER : 0)
    const bonusTriggered = scatterCount >= FS_TRIGGER
    let freeSpins: EpFreeSpins | null = null
    const room = round4(EP_MAX_WIN_MULT - base.win)
    if (bonusTriggered && room > 0) {
        freeSpins = runFreeSpins(fsAward(scatterCount), mode === 'buy' ? 'buy' : 'scatter', room, rng, ids, base.wildsEnd)
    }

    const win = Math.min(EP_MAX_WIN_MULT, round4(base.win + (freeSpins?.total ?? 0)))
    return { mode, base, freeSpins, bonusTriggered, win, capped: win >= EP_MAX_WIN_MULT }
}

/** Whole coins paid for a round at `bet`. */
export function emberPortalsPayout(result: EmberPortalsResult, bet: number): number {
    return Math.floor(bet * result.win + 1e-9)
}
