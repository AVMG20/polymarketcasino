import { randomInt, randomSample, type Rng } from '../rng'

/**
 * Magic Hands: a grid reveal game on 5 columns × 8 rows (40 tiles, index =
 * row × 5 + col). The player puts hands on tiles, each hand worth the bet.
 *
 * 1. A top bar of five slots spins, one per column. A slot lands on nothing,
 *    a multiplier (stamped onto 1-4 random tiles of its column) or a reroll
 *    (the whole bar spins again after this pass). Multipliers that land on a
 *    tile that already has one stack multiplicatively, capped per tile.
 * 2. Then 2-8 random tiles are revealed as winners.
 * 3. A hand on a winning tile pays bet × that tile's multiplier (1× without one).
 *
 * The cap sits on each tile, so every hand has the same expected return
 * however many hands are placed:
 *   RTP = P(tile wins) × E[capped tile multiplier]
 */
export const MH_COLS = 5
export const MH_ROWS = 8
export const MH_TILES = MH_COLS * MH_ROWS
export const MH_MAX_HANDS = MH_TILES
/** Highest multiplier a tile can reach, and so the max win per hand (× bet). */
export const MH_TILE_CAP = 2500

export const MH_MULTIPLIERS = [2, 5, 10, 15, 20, 25, 35, 50, 75, 100] as const
/** Relative weights of MH_MULTIPLIERS. */
export const MH_MULTIPLIER_WEIGHTS = [0.296, 0.212, 0.131, 0.086, 0.068, 0.057, 0.048, 0.042, 0.036, 0.024] as const

/**
 * Per-slot odds; the rest is nothing. `multiplier` is the RTP knob
 * (scripts/magichands-rtp.ts computes the exact return). The old site ran
 * 0.50 for 97.9%; 0.4927 gives 96.0%.
 */
export const MH_SLOT_ODDS = { multiplier: 0.4927, reroll: 0.08 } as const

export const MH_TILES_PER_MULTIPLIER = [1, 4] as const
export const MH_WINNERS = [2, 8] as const
/** Reroll chains stop after this many passes. */
export const MH_MAX_PASSES = 6

export type MhSlotType = 'nothing' | 'multiplier' | 'reroll'

export interface MhPassSlot {
    col: number
    type: MhSlotType
    /** The multiplier, for a multiplier slot. */
    value: number | null
    /** Tiles it stamped, for a multiplier slot. */
    tiles: number[]
}

export interface MhPass {
    slots: MhPassSlot[]
    /** Another pass follows. */
    reroll: boolean
}

export interface MhHandWin {
    tile: number
    multiplier: number
}

export interface MagicHandsResult {
    placements: number[]
    passes: MhPass[]
    /** Final (stacked, capped) multiplier per tile that has one. */
    multipliers: Record<number, number>
    winners: number[]
    /** Hands on winning tiles. */
    wins: MhHandWin[]
    /** Sum of the winning hands' multipliers: the payout is bet × this. */
    win: number
}

export interface MagicHandsOptions {
    placements: number[]
}

export function parseMagicHandsOptions(input: Record<string, unknown> | undefined): MagicHandsOptions {
    const raw = input?.placements
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MH_MAX_HANDS) {
        throw new RangeError(`Place between 1 and ${MH_MAX_HANDS} hands`)
    }
    const placements: number[] = []
    for (const tile of raw) {
        if (typeof tile !== 'number' || !Number.isInteger(tile) || tile < 0 || tile >= MH_TILES) throw new RangeError('A hand is on a tile that does not exist')
        placements.push(tile)
    }
    if (new Set(placements).size !== placements.length) throw new RangeError('Two hands on one tile')
    return { placements }
}

function multiplierValue(rng: Rng): number {
    const total = MH_MULTIPLIER_WEIGHTS.reduce((sum, w) => sum + w, 0)
    let roll = rng.next() * total
    for (let i = 0; i < MH_MULTIPLIERS.length; i++) {
        roll -= MH_MULTIPLIER_WEIGHTS[i]!
        if (roll < 0) return MH_MULTIPLIERS[i]!
    }
    return MH_MULTIPLIERS[MH_MULTIPLIERS.length - 1]!
}

function slotType(rng: Rng): MhSlotType {
    const roll = rng.next()
    if (roll < MH_SLOT_ODDS.multiplier) return 'multiplier'
    if (roll < MH_SLOT_ODDS.multiplier + MH_SLOT_ODDS.reroll) return 'reroll'
    return 'nothing'
}

function columnTiles(col: number): number[] {
    return Array.from({ length: MH_ROWS }, (_, row) => row * MH_COLS + col)
}

export function playMagicHands(rng: Rng, options: MagicHandsOptions): MagicHandsResult {
    const passes: MhPass[] = []
    const multipliers: Record<number, number> = {}

    for (let p = 1; p <= MH_MAX_PASSES; p++) {
        const slots: MhPassSlot[] = []
        let reroll = false
        for (let col = 0; col < MH_COLS; col++) {
            const type = slotType(rng)
            if (type === 'multiplier') {
                const value = multiplierValue(rng)
                const tiles = randomSample(rng, columnTiles(col), randomInt(rng, ...MH_TILES_PER_MULTIPLIER)).sort((a, b) => a - b)
                for (const tile of tiles) multipliers[tile] = Math.min((multipliers[tile] ?? 1) * value, MH_TILE_CAP)
                slots.push({ col, type, value, tiles })
            } else {
                if (type === 'reroll') reroll = true
                slots.push({ col, type, value: null, tiles: [] })
            }
        }
        // The last pass can't promise another one.
        if (p === MH_MAX_PASSES) reroll = false
        passes.push({ slots, reroll })
        if (!reroll) break
    }

    const all = Array.from({ length: MH_TILES }, (_, i) => i)
    const winners = randomSample(rng, all, randomInt(rng, ...MH_WINNERS)).sort((a, b) => a - b)
    const winning = new Set(winners)
    const wins = options.placements.filter(tile => winning.has(tile)).map(tile => ({ tile, multiplier: multipliers[tile] ?? 1 }))
    return {
        placements: options.placements,
        passes,
        multipliers,
        winners,
        wins,
        win: wins.reduce((sum, w) => sum + w.multiplier, 0)
    }
}
