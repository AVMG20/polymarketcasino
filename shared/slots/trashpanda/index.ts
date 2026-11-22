// "Trash Panda Heist": a 5×4 ways slot (1024 ways) with two features.
// Ported from the old site (shared/utils/gamelogic/trashpanda.ts); the rules are
// unchanged, the RNG is passed in and the payout rounds down to 0.0001 coin.
//
// ── Base game ────────────────────────────────────────────────────────────────
//   Every cell is an independent weighted draw from its reel's table. A win is
//   3+ adjacent reels from the leftmost reel that each show the symbol (or a
//   WILD). Ways multiply: two pizzas on reel 1, one on reel 2 and three on
//   reel 3 is 2 × 1 × 3 = 6 ways. Each way pays PAYTABLE[symbol][length - 3]
//   × bet. WILD lands on reels 2-5 only and pays nothing on its own.
//
// ── Night Heist (free spins) ─────────────────────────────────────────────────
//   3/4/5 SAFE scatters anywhere award 8/10/12 free spins. Every WILD that
//   lands during the feature carries a multiplier (×2, ×3, ×5 or ×10) and
//   sticks to its cell until the feature ends. A way's multiplier is the SUM
//   of the wild multipliers on it (a way without wilds pays ×1). 3+ SAFEs
//   during the feature add FS_RETRIGGER_SPINS spins. Wilds never leave, so a
//   long run keeps getting richer; this is where the big wins come from.
//
// ── Dumpster Dive (pick game) ────────────────────────────────────────────────
//   3+ DUMPSTER scatters anywhere open a 12-bin pick game. Bins hide
//   cash (× bet), a Double (doubles the pot), a Donut (the next guard dog eats
//   it instead of ending the game), a Golden Key (awards Night Heist free spins
//   after the dive) and two Guard Dogs. The dive ends on an uneaten dog or once
//   only dogs are left. The reveal order is decided here; whichever bin the
//   player clicks just shows the next item.
//
// ── Fairness ────────────────────────────────────────────────────────────────
//   Base + dive + free spins are capped at TPH_MAX_WIN_MULT × bet; free spins
//   stop early once the cap is reached, and the round pays rounded down to
//   0.0001 coin. Tuned with scripts/trashpanda-rtp.ts.

import { costFor, roundCoins } from '../../money'
import type { Rng } from '../../rng'

export const TPH_COLS = 5
export const TPH_ROWS = 4
export const TPH_WAYS = TPH_ROWS ** TPH_COLS
export const TPH_MAX_WIN_MULT = 10_000

export type TphPaySymbol = 'fish' | 'banana' | 'can' | 'apple' | 'pizza' | 'donut' | 'cash' | 'bag' | 'gem' | 'boss'
export type TphSymbol = TphPaySymbol | 'wild' | 'safe' | 'bin'

export const TPH_PAY_SYMBOLS: TphPaySymbol[] = ['fish', 'banana', 'can', 'apple', 'pizza', 'donut', 'cash', 'bag', 'gem', 'boss']

// Pays per way, × total bet, for 3 / 4 / 5 reels.
export const PAYTABLE: Record<TphPaySymbol, [number, number, number]> = {
    fish: [0.1, 0.2, 0.5],
    banana: [0.1, 0.2, 0.5],
    can: [0.1, 0.2, 0.5],
    apple: [0.1, 0.2, 0.5],
    pizza: [0.2, 0.3, 0.8],
    donut: [0.2, 0.4, 1],
    cash: [0.4, 0.8, 2],
    bag: [0.5, 1.2, 3],
    gem: [0.8, 2, 5],
    boss: [1.2, 3, 10]
}

type Weights = Record<TphSymbol, number>

// The old site ran the safe at 21 (≈98.2% paid spins over 120M); 20.65 brings
// them to ≈96.3% (scripts/trashpanda-rtp.ts, 100M) and leaves every pay and the
// buys (97.9% / 97.5%, they force their scatters) as they were.
const BASE_COMMON = { fish: 170, banana: 170, can: 170, apple: 170, pizza: 150, donut: 140, cash: 90, bag: 70, gem: 52, boss: 38, safe: 20.65, bin: 27.5 }

// Per-reel weights. WILD sits on reels 2-5; SAFE and DUMPSTER land anywhere.
export const BASE_REEL_WEIGHTS: Weights[] = [
    { ...BASE_COMMON, wild: 0 },
    { ...BASE_COMMON, wild: 12 },
    { ...BASE_COMMON, wild: 12 },
    { ...BASE_COMMON, wild: 12 },
    { ...BASE_COMMON, wild: 12 }
]

const FS_COMMON = { fish: 0, banana: 0, can: 170, apple: 170, pizza: 150, donut: 140, cash: 90, bag: 70, gem: 52, boss: 38, safe: 17, bin: 0 }

// Free-spin reels: no dumpsters, fish or banana peels, so wins land more
// often; wilds are rarer than they look because every one of them sticks.
export const FS_REEL_WEIGHTS: Weights[] = [
    { ...FS_COMMON, wild: 0 },
    { ...FS_COMMON, wild: 15.3 },
    { ...FS_COMMON, wild: 15.3 },
    { ...FS_COMMON, wild: 15.3 },
    { ...FS_COMMON, wild: 15.3 }
]

export const FS_TRIGGER = 3
/** Free spins for 3, 4 and 5+ scatters. */
export const FS_AWARD: Record<3 | 4 | 5, number> = { 3: 8, 4: 10, 5: 12 }
export const FS_RETRIGGER_SPINS = 5
/** Hard stop on retriggers so a feature can't run forever. */
export const FS_MAX_SPINS = 60

/** Multiplier carried by a free-spin wild, and how often each lands. */
export const FS_WILD_MULTS: { mult: number, weight: number }[] = [
    { mult: 2, weight: 62 },
    { mult: 3, weight: 26 },
    { mult: 5, weight: 10 },
    { mult: 10, weight: 2 }
]

/** DUMPSTERs anywhere that start the dive. */
export const DIVE_TRIGGER = 3
export const DIVE_BINS = 12
export const DIVE_DOGS = 2
/** Free spins the Golden Key awards. */
export const DIVE_KEY_SPINS = 8

/** Chance each special lands in the 12 bins; the rest is cash. */
export const DIVE_DONUT_CHANCE = 0.5
export const DIVE_DOUBLE_CHANCE = 0.45
export const DIVE_KEY_CHANCE = 0.1

/** Cash bins, × bet. */
export const DIVE_CASH: { value: number, weight: number }[] = [
    { value: 1, weight: 30 },
    { value: 2, weight: 28 },
    { value: 3, weight: 18 },
    { value: 5, weight: 12 },
    { value: 10, weight: 7 },
    { value: 25, weight: 3.4 },
    { value: 50, weight: 1.2 },
    { value: 100, weight: 0.4 }
]

/** Buy prices, × bet. Tuned so each buy returns about the same as natural play. */
export const TPH_BUY_FREE_SPINS_COST = 110
export const TPH_BUY_DIVE_COST = 21.75

export type TphFeature = 'buyFreeSpins' | 'buyDive'

// --- result shapes ----------------------------------------------------------

export interface Cell { col: number, row: number }

export interface TphWayWin {
    symbol: TphPaySymbol
    /** Reels in the win (3-5). */
    length: number
    /** Number of ways. */
    ways: number
    /** Ways summed with their wild multipliers (equals `ways` without multiplier wilds). */
    weight: number
    amount: number
    cells: Cell[]
}

export interface TphStickyWild {
    col: number
    row: number
    mult: number
}

export interface TphFreeSpin {
    index: number
    /** Landed grid with every sticky wild in place. */
    grid: TphSymbol[][]
    /** Wilds that landed this spin (already included in `sticky`). */
    newWilds: TphStickyWild[]
    /** All sticky wilds after this spin. */
    sticky: TphStickyWild[]
    wins: TphWayWin[]
    win: number
    scatters: Cell[]
    /** Spins added by this spin's scatters. */
    retrigger: number
    /** Total spins in the feature after this spin. */
    totalSpins: number
    /** Feature total after this spin. */
    runningTotal: number
}

export interface TphFreeSpins {
    source: 'scatter' | 'key' | 'buy'
    awarded: number
    spins: TphFreeSpin[]
    total: number
    /** The max win was hit and the feature stopped early. */
    capped: boolean
}

export type TphDiveItem
    = { kind: 'cash', value: number }
        | { kind: 'double' }
        | { kind: 'donut' }
        | { kind: 'key' }
        | { kind: 'dog' }

export interface TphDivePick {
    item: TphDiveItem
    /** Pot after this pick, × bet. */
    pot: number
    /** A donut is waiting for the next dog. */
    shield: boolean
    /** A dog ate the donut on this pick. */
    ateDonut: boolean
}

export interface TphDive {
    picks: TphDivePick[]
    /** Unopened bins, shown after the dive. */
    leftovers: TphDiveItem[]
    /** Pot, × bet. */
    pot: number
    total: number
    keyFound: boolean
    /** Every bin except the dogs was opened. */
    cleared: boolean
}

export interface TrashPandaResult {
    bet: number
    cost: number
    feature: TphFeature | null
    grid: TphSymbol[][]
    wins: TphWayWin[]
    scatters: Cell[]
    bins: Cell[]
    basePayout: number
    dive: TphDive | null
    divePayout: number
    freeSpins: TphFreeSpins | null
    freeSpinsPayout: number
    bonusTriggered: boolean
    payout: number
    won: boolean
    maxWin: number
    capped: boolean
    /** The round's win in × bet, after the cap. */
    win: number
}

// --- rng helpers ------------------------------------------------------------

interface Table<T> { items: T[], cum: number[], total: number }

function table<T>(items: T[], weights: number[]): Table<T> {
    const cum: number[] = []
    let total = 0
    for (const w of weights) {
        total += w
        cum.push(total)
    }
    return { items, cum, total }
}

function pick<T>(t: Table<T>, rng: Rng): T {
    const r = rng.next() * t.total
    for (let i = 0; i < t.cum.length; i++) if (r < t.cum[i]!) return t.items[i]!
    return t.items[t.items.length - 1]!
}

function reelTable(w: Weights, exclude: TphSymbol[] = []): Table<TphSymbol> {
    const ids = (Object.keys(w) as TphSymbol[]).filter(id => w[id] > 0 && !exclude.includes(id))
    return table(ids, ids.map(id => w[id]))
}

const BASE_TABLES = BASE_REEL_WEIGHTS.map(w => reelTable(w))
const BASE_PLAIN_TABLES = BASE_REEL_WEIGHTS.map(w => reelTable(w, ['safe', 'bin']))
const FS_TABLES = FS_REEL_WEIGHTS.map(w => reelTable(w))
const WILD_MULT_TABLE = table(FS_WILD_MULTS.map(m => m.mult), FS_WILD_MULTS.map(m => m.weight))
const DIVE_CASH_TABLE = table(DIVE_CASH.map(c => c.value), DIVE_CASH.map(c => c.weight))

const round4 = (v: number) => Math.round(v * 10000) / 10000

// --- grid + ways evaluation -------------------------------------------------

function drawGrid(tables: Table<TphSymbol>[], rng: Rng): TphSymbol[][] {
    const grid: TphSymbol[][] = []
    for (let col = 0; col < TPH_COLS; col++) {
        const column: TphSymbol[] = []
        for (let row = 0; row < TPH_ROWS; row++) column.push(pick(tables[col]!, rng))
        grid.push(column)
    }
    return grid
}

function cellsOf(grid: TphSymbol[][], sym: TphSymbol): Cell[] {
    const out: Cell[] = []
    for (let col = 0; col < TPH_COLS; col++) {
        for (let row = 0; row < TPH_ROWS; row++) if (grid[col]![row] === sym) out.push({ col, row })
    }
    return out
}

/**
 * Ways wins for a grid. `mults` maps "col:row" of a wild to its multiplier;
 * without it every wild counts ×1 and a way pays once.
 */
export function evaluateWays(grid: TphSymbol[][], bet: number, mults?: Map<string, number>): TphWayWin[] {
    const wins: TphWayWin[] = []
    // Wild count and multiplier sum per reel.
    const wildCount: number[] = []
    const wildSum: number[] = []
    for (let col = 0; col < TPH_COLS; col++) {
        let n = 0
        let s = 0
        for (let row = 0; row < TPH_ROWS; row++) {
            if (grid[col]![row] !== 'wild') continue
            n++
            s += mults?.get(`${col}:${row}`) ?? 1
        }
        wildCount.push(n)
        wildSum.push(s)
    }

    for (const sym of TPH_PAY_SYMBOLS) {
        const plain: number[] = []
        const all: number[] = []
        for (let col = 0; col < TPH_COLS; col++) {
            let n = 0
            for (let row = 0; row < TPH_ROWS; row++) if (grid[col]![row] === sym) n++
            if (n + wildCount[col]! === 0) break
            plain.push(n)
            all.push(n + wildCount[col]!)
        }
        const length = all.length
        if (length < 3 || plain[0] === 0) continue

        let ways = 1
        for (const c of all) ways *= c
        let weight = ways
        if (mults) {
            // Ways without a wild pay ×1; every wild adds its multiplier to
            // each way that runs through it.
            weight = 1
            for (const n of plain) weight *= n
            for (let col = 0; col < length; col++) {
                if (!wildSum[col]) continue
                let others = 1
                for (let c = 0; c < length; c++) if (c !== col) others *= all[c]!
                weight += wildSum[col]! * others
            }
        }

        const cells: Cell[] = []
        for (let col = 0; col < length; col++) {
            for (let row = 0; row < TPH_ROWS; row++) {
                const s = grid[col]![row]
                if (s === sym || s === 'wild') cells.push({ col, row })
            }
        }
        const amount = round4(PAYTABLE[sym][length - 3]! * weight * bet)
        wins.push({ symbol: sym, length, ways, weight, amount, cells })
    }
    return wins
}

function awardFor(scatters: number): number {
    if (scatters >= 5) return FS_AWARD[5]
    if (scatters === 4) return FS_AWARD[4]
    return FS_AWARD[3]
}

// --- free spins ---------------------------------------------------------------

/** Play out a free-spin feature; `room` is how much it may still pay before the max win. */
export function runFreeSpins(bet: number, awarded: number, source: TphFreeSpins['source'], room: number, rng: Rng): TphFreeSpins {
    const sticky = new Map<string, TphStickyWild>()
    const spins: TphFreeSpin[] = []
    let totalSpins = awarded
    let total = 0
    let capped = false

    for (let i = 0; i < totalSpins; i++) {
        const grid = drawGrid(FS_TABLES, rng)
        const newWilds: TphStickyWild[] = []
        for (let col = 1; col < TPH_COLS; col++) {
            for (let row = 0; row < TPH_ROWS; row++) {
                const key = `${col}:${row}`
                const held = sticky.get(key)
                if (held) {
                    grid[col]![row] = 'wild'
                } else if (grid[col]![row] === 'wild') {
                    const w = { col, row, mult: pick(WILD_MULT_TABLE, rng) }
                    sticky.set(key, w)
                    newWilds.push(w)
                }
            }
        }

        const mults = new Map<string, number>()
        for (const [key, w] of sticky) mults.set(key, w.mult)
        const wins = evaluateWays(grid, bet, mults)
        let win = round4(wins.reduce((a, w) => a + w.amount, 0))
        if (total + win >= room) {
            win = round4(room - total)
            capped = true
        }
        total = round4(total + win)

        const scatters = cellsOf(grid, 'safe')
        let retrigger = 0
        if (!capped && scatters.length >= FS_TRIGGER && totalSpins < FS_MAX_SPINS) {
            retrigger = Math.min(FS_RETRIGGER_SPINS, FS_MAX_SPINS - totalSpins)
            totalSpins += retrigger
        }

        spins.push({
            index: i,
            grid,
            newWilds,
            sticky: [...sticky.values()].map(w => ({ ...w })),
            wins,
            win,
            scatters,
            retrigger,
            totalSpins,
            runningTotal: total
        })
        if (capped) break
    }

    return { source, awarded, spins, total, capped }
}

// --- dumpster dive -----------------------------------------------------------

function shuffle<T>(items: T[], rng: Rng): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1))
        const t = items[i]!
        items[i] = items[j]!
        items[j] = t
    }
    return items
}

function runDive(bet: number, rng: Rng): TphDive {
    const bins: TphDiveItem[] = []
    for (let i = 0; i < DIVE_DOGS; i++) bins.push({ kind: 'dog' })
    if (rng.next() < DIVE_DONUT_CHANCE) bins.push({ kind: 'donut' })
    if (rng.next() < DIVE_DOUBLE_CHANCE) bins.push({ kind: 'double' })
    if (rng.next() < DIVE_KEY_CHANCE) bins.push({ kind: 'key' })
    while (bins.length < DIVE_BINS) bins.push({ kind: 'cash', value: pick(DIVE_CASH_TABLE, rng) })
    shuffle(bins, rng)

    const picks: TphDivePick[] = []
    let pot = 0
    let shield = false
    let keyFound = false
    let opened = 0
    let nonDogsLeft = bins.filter(b => b.kind !== 'dog').length

    for (const item of bins) {
        if (nonDogsLeft === 0) break
        opened++
        let ateDonut = false
        if (item.kind === 'dog') {
            if (!shield) {
                picks.push({ item, pot, shield, ateDonut })
                break
            }
            shield = false
            ateDonut = true
        } else {
            nonDogsLeft--
            if (item.kind === 'cash') pot += item.value
            else if (item.kind === 'double') pot *= 2
            else if (item.kind === 'donut') shield = true
            else if (item.kind === 'key') keyFound = true
        }
        picks.push({ item, pot, shield, ateDonut })
    }

    return {
        picks,
        leftovers: bins.slice(opened),
        pot,
        total: round4(pot * bet),
        keyFound,
        cleared: nonDogsLeft === 0
    }
}

// --- main entry -------------------------------------------------------------

/** Grid with forced feature symbols on top of a plain draw (feature buys). */
function forcedGrid(feature: TphFeature, rng: Rng): TphSymbol[][] {
    const grid = drawGrid(BASE_PLAIN_TABLES, rng)
    if (feature === 'buyDive') {
        const cols = shuffle([0, 1, 2, 3, 4], rng).slice(0, DIVE_TRIGGER)
        for (const col of cols) grid[col]![Math.floor(rng.next() * TPH_ROWS)] = 'bin'
    } else {
        const cols = shuffle([0, 1, 2, 3, 4], rng).slice(0, FS_TRIGGER)
        for (const col of cols) grid[col]![Math.floor(rng.next() * TPH_ROWS)] = 'safe'
    }
    return grid
}

export interface TrashPandaOptions {
    feature?: TphFeature
}

/** Options as the play endpoint receives them. Throws RangeError on anything else. */
export function parseTrashPandaOptions(options: Record<string, unknown>): TrashPandaOptions {
    for (const name of Object.keys(options)) {
        if (name !== 'feature') throw new RangeError(`Unknown option ${name}`)
    }
    if (options.feature === undefined) return {}
    if (options.feature !== 'buyFreeSpins' && options.feature !== 'buyDive') throw new RangeError('feature is buyFreeSpins, buyDive or nothing')
    return { feature: options.feature }
}

/** What a round costs, in coins. The dive's 21.75× rounds up to 0.0001 coin. */
export function trashPandaStake(bet: number, options: TrashPandaOptions): number {
    if (options.feature === 'buyFreeSpins') return costFor(bet, TPH_BUY_FREE_SPINS_COST)
    if (options.feature === 'buyDive') return costFor(bet, TPH_BUY_DIVE_COST)
    return bet
}

/** Coin amounts are for `bet`; `payout` is what is actually paid (rounded down to 0.0001). */
export function playTrashPanda(rng: Rng, bet: number, options: TrashPandaOptions = {}): TrashPandaResult {
    if (!Number.isFinite(bet) || bet <= 0) throw new RangeError('Invalid bet amount')

    const feature: TphFeature | null = options.feature ?? null
    const cost = trashPandaStake(bet, options)
    const maxWin = bet * TPH_MAX_WIN_MULT

    const grid = feature ? forcedGrid(feature, rng) : drawGrid(BASE_TABLES, rng)
    const wins = evaluateWays(grid, bet)
    const scatters = cellsOf(grid, 'safe')
    const bins = cellsOf(grid, 'bin')

    const basePayout = Math.min(maxWin, round4(wins.reduce((a, w) => a + w.amount, 0)))

    const diveOn = bins.length >= DIVE_TRIGGER
    let dive: TphDive | null = null
    let divePayout = 0
    if (diveOn) {
        dive = runDive(bet, rng)
        divePayout = round4(Math.min(dive.total, maxWin - basePayout))
    }

    const scatterFs = scatters.length >= FS_TRIGGER
    const keyFs = dive?.keyFound ?? false
    let freeSpins: TphFreeSpins | null = null
    let freeSpinsPayout = 0
    if (scatterFs || keyFs) {
        const awarded = (scatterFs ? awardFor(scatters.length) : 0) + (keyFs ? DIVE_KEY_SPINS : 0)
        const source = feature === 'buyFreeSpins' ? 'buy' : scatterFs ? 'scatter' : 'key'
        const room = round4(maxWin - basePayout - divePayout)
        if (room > 0) {
            freeSpins = runFreeSpins(bet, Math.min(awarded, FS_MAX_SPINS), source, room, rng)
            freeSpinsPayout = freeSpins.total
        }
    }

    const total = Math.min(maxWin, round4(basePayout + divePayout + freeSpinsPayout))
    // Rounded down to 0.0001 coin (float noise in the sum can't cost a unit).
    const payout = roundCoins(total)
    return {
        bet,
        cost,
        feature,
        grid,
        wins,
        scatters,
        bins,
        basePayout,
        dive,
        divePayout,
        freeSpins,
        freeSpinsPayout,
        bonusTriggered: diveOn || scatterFs,
        payout,
        win: total / bet,
        won: payout > cost,
        maxWin,
        capped: total >= maxWin
    }
}
