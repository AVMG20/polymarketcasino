import type { Rng } from '../rng'
import { floorMultiplier, type StepGame, type StepState } from './steps'

/**
 * Gem Dig (mines): a 5×5 field hides 1-24 bombs; the rest are gems. Dig
 * tiles one at a time: a gem raises the multiplier, a bomb ends the round
 * with nothing. Cash out any time after the first gem.
 *
 * After k gems with m bombs on 25 tiles the multiplier is
 *   RTP × C(25, k) / C(25 - m, k)
 * (the house share times the inverse chance of k gems in a row), so cashing
 * out at any point returns RTP: no strategy beats it. The bombs are placed
 * when the round starts (server CSPRNG) and stay on the server until it ends.
 * Digging every gem cashes out on its own, and so does reaching the cap.
 */
export const MINES_TILES = 25
export const MINES_MIN = 1
export const MINES_MAX = 24
export const MINES_RTP = 0.975
/** A round cashes out on its own when its multiplier reaches this. */
export const MINES_MAX_MULTIPLIER = 1_000_000

export interface MinesState extends StepState {
    mines: number
    /** The bomb tiles (0..24, row × 5 + column). Secret until the round ends. */
    bombs: number[]
    /** Gem tiles dug, in order. */
    revealed: number[]
    /** The bomb that ended the round, if one did. */
    hit: number | null
}

export interface MinesView {
    mines: number
    revealed: number[]
    status: MinesState['status']
    /** Cash-out multiplier now, and after one more gem (null when no gem is left). */
    multiplier: number
    next: number | null
    /** Only once the round is over. */
    bombs: number[] | null
    hit: number | null
}

/** The cash-out multiplier after `gems` gems with `mines` bombs (1 before the first gem). */
export function minesMultiplier(mines: number, gems: number): number {
    if (gems <= 0) return 1
    let fair = 1
    for (let i = 0; i < gems; i++) fair *= (MINES_TILES - i) / (MINES_TILES - mines - i)
    return Math.min(MINES_MAX_MULTIPLIER, floorMultiplier(MINES_RTP * fair))
}

/** The chance the next tile is a gem, with `gems` already dug. */
export function minesSafeChance(mines: number, gems: number): number {
    const left = MINES_TILES - gems
    return left > 0 ? (left - mines) / left : 0
}

function parseMines(input: Record<string, unknown>): number {
    const mines = input.mines ?? 3
    if (typeof mines !== 'number' || !Number.isInteger(mines) || mines < MINES_MIN || mines > MINES_MAX) {
        throw new RangeError(`Bombs must be ${MINES_MIN} to ${MINES_MAX}`)
    }
    return mines
}

function parseTile(input: unknown): number {
    if (typeof input !== 'number' || !Number.isInteger(input) || input < 0 || input >= MINES_TILES) throw new RangeError('Pick a tile from 0 to 24')
    return input
}

/** `count` distinct tiles, a partial Fisher-Yates shuffle. */
function placeBombs(rng: Rng, count: number): number[] {
    const tiles = Array.from({ length: MINES_TILES }, (_, i) => i)
    for (let i = 0; i < count; i++) {
        const j = i + Math.floor(rng.next() * (MINES_TILES - i))
        const swap = tiles[i]!
        tiles[i] = tiles[j]!
        tiles[j] = swap
    }
    return tiles.slice(0, count).sort((a, b) => a - b)
}

function gemsLeft(state: MinesState): number {
    return MINES_TILES - state.mines - state.revealed.length
}

export const mines: StepGame<MinesState, MinesView> = {
    slug: 'mines',
    start(rng, options) {
        const count = parseMines(options)
        return { status: 'open', mines: count, bombs: placeBombs(rng, count), revealed: [], hit: null }
    },
    act(state, action) {
        if (state.status !== 'open') throw new RangeError('The round is over')
        if (action.type !== 'reveal') throw new RangeError('Dig a tile')
        const tile = parseTile(action.tile)
        if (state.revealed.includes(tile)) throw new RangeError('That tile is already dug')
        if (state.bombs.includes(tile)) return { ...state, status: 'lost', hit: tile }
        const next: MinesState = { ...state, revealed: [...state.revealed, tile] }
        // Every gem dug, or the cap reached: cash out on the player's behalf.
        if (gemsLeft(next) === 0 || minesMultiplier(next.mines, next.revealed.length) >= MINES_MAX_MULTIPLIER) return { ...next, status: 'cashed' }
        return next
    },
    canCashOut: state => state.status === 'open' && state.revealed.length > 0,
    cashOut(state) {
        if (!mines.canCashOut(state)) throw new RangeError('Dig a gem first')
        return { ...state, status: 'cashed' }
    },
    multiplier: state => (state.status === 'lost' ? 0 : minesMultiplier(state.mines, state.revealed.length)),
    view(state) {
        const over = state.status !== 'open'
        return {
            mines: state.mines,
            revealed: state.revealed,
            status: state.status,
            multiplier: mines.multiplier(state),
            next: state.status === 'open' && gemsLeft(state) > 0 ? minesMultiplier(state.mines, state.revealed.length + 1) : null,
            bombs: over ? state.bombs : null,
            hit: state.hit
        }
    },
    summary: state => ({ mines: state.mines, gems: state.revealed.length, status: state.status, multiplier: mines.multiplier(state) })
}
