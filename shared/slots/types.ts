/**
 * The slot engine's vocabulary. A slot is pure data (a `SlotConfig`); the
 * engine draws grids, evaluates wins, runs tumbles and free spins, and returns
 * a fully resolved `SlotOutcome` that the client only replays.
 *
 * Every pay is a multiple of the TOTAL bet, for every pay model, so a win's
 * coins are always `floor(bet × win)`.
 */

export type SymbolId = string

/** grid[col][row], row 0 at the top. */
export type Grid = SymbolId[][]

export type Cell = readonly [col: number, row: number]

export type SymbolKind = 'pay' | 'wild' | 'scatter'

export interface SymbolDef {
    kind: SymbolKind
    /**
     * Pays by count (lines and ways: symbols in a row from the left; clusters:
     * cluster size, the highest listed size at or below the actual one wins).
     * In × total bet, before `payScale`.
     */
    pays?: Readonly<Record<number, number>>
}

/** Weights per symbol for every cell, or one weight table per reel. */
export type Weights = Readonly<Record<SymbolId, number>> | readonly Readonly<Record<SymbolId, number>>[]

export type PayModel =
    | { type: 'lines', lines: readonly (readonly number[])[] }
    | { type: 'ways' }
    | { type: 'cluster', minSize: number }

export interface FreeSpinRules {
    /** Scatters on the triggering spin → spins awarded (highest listed count at or below). */
    awards: Readonly<Record<number, number>>
    /** Scatters during free spins that add spins, and how many. */
    retrigger?: { count: number, spins: number }
    /** Weights used while free spins run (defaults to the base weights). */
    weights?: Weights
    /** Wilds stay where they landed for the rest of the feature. */
    stickyWilds?: boolean
    /** Every wild that lands raises the feature multiplier by this much. */
    wildMultiplierStep?: number
    /** The feature multiplier never exceeds this. */
    multiplierCap?: number
}

export interface SlotConfig {
    id: string
    cols: number
    rows: number
    symbols: Readonly<Record<SymbolId, SymbolDef>>
    weights: Weights
    pay: PayModel
    /** Global factor on every pay; the RTP tuning knob (scripts/<slot>-rtp.ts). */
    payScale: number
    scatter?: {
        symbol: SymbolId
        /** Scatter count → pay in × total bet (paid anywhere, before payScale). */
        pays?: Readonly<Record<number, number>>
        /** At most one scatter per reel (classic reel slots). */
        onePerReel?: boolean
    }
    freeSpins?: FreeSpinRules
    /**
     * Winning symbols vanish and new ones fall in, repeated until a drop does
     * not win. With `step`, each further win in a sequence raises the
     * multiplier by that much (×1, ×2, ×3, …); in free spins it carries over
     * from spin to spin instead of resetting.
     */
    tumble?: { multiplierStep?: number }
    /** Cost of buying straight into free spins, in × bet. */
    buyCost?: number
    /** Total win cap per round, in × bet. */
    maxWin: number
}

export interface SlotWin {
    symbol: SymbolId
    /** In a row (lines/ways) or cluster size. */
    count: number
    cells: Cell[]
    /** In × total bet, after payScale and before the spin multiplier. */
    pay: number
    /** Payline index (lines). */
    line?: number
    /** Number of ways (ways). */
    ways?: number
}

export interface SlotStep {
    grid: Grid
    wins: SlotWin[]
    /** Multiplier applied to this step's wins. */
    multiplier: number
    /** This step's win in × bet, multiplier included. */
    win: number
}

export interface SlotSpin {
    /** The drop and, for tumbling slots, every tumble after it. */
    steps: SlotStep[]
    scatters: number
    scatterWin: number
    /** Free spins this spin awarded (trigger or retrigger). */
    awarded: number
    /** Sticky wilds held after this spin (free spins with stickyWilds). */
    sticky?: Cell[]
    /** Spin total in × bet. */
    win: number
}

export interface SlotOutcome {
    slot: string
    bought: boolean
    base: SlotSpin
    freeSpins: SlotSpin[]
    /** Round total in × bet, after the max-win cap. */
    win: number
    capped: boolean
}
