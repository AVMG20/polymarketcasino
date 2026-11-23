import type { Rng } from '../rng'

/**
 * Pegfall (plinko): drop balls through a triangle of pegs. At every row a
 * ball bounces left or right with even odds, so after `rows` rows it lands
 * in slot k (the number of rights) with probability C(rows, k) / 2^rows.
 * Each slot pays a multiple of the bet: the edges pay most and the middle,
 * where most balls land, pays least. Risk trades a softer middle for bigger
 * edges.
 *
 * The tables are our own (shaped by a power curve from the middle to the
 * edge, rounded to friendly numbers) and every one returns 97.0-97.8%:
 * scripts/plinko-rtp.ts works out each exactly. A round drops 1-10 balls,
 * each costs the bet and pays its own slot.
 */
export type PlinkoRisk = 'low' | 'medium' | 'high'

export const PLINKO_RISKS: readonly PlinkoRisk[] = ['low', 'medium', 'high']
export const PLINKO_MIN_ROWS = 8
export const PLINKO_MAX_ROWS = 16
export const PLINKO_MAX_BALLS = 10

/** Slot multipliers by risk and rows (index = slot, left to right). Symmetric. */
export const PLINKO_TABLES: Readonly<Record<PlinkoRisk, Readonly<Record<number, readonly number[]>>>> = {
    low: {
        8: [5.5, 2.8, 1.3, 0.7, 0.6, 0.7, 1.3, 2.8, 5.5],
        9: [6.3, 3.4, 1.7, 0.9, 0.6, 0.6, 0.9, 1.7, 3.4, 6.3],
        10: [7.2, 4.3, 2.1, 1.1, 0.7, 0.6, 0.7, 1.1, 2.1, 4.3, 7.2],
        11: [8.2, 4.9, 2.7, 1.5, 0.8, 0.6, 0.6, 0.8, 1.5, 2.7, 4.9, 8.2],
        12: [9.4, 5.8, 3.3, 1.7, 1, 0.7, 0.6, 0.7, 1, 1.7, 3.3, 5.8, 9.4],
        13: [11, 7, 4.4, 2.4, 1.3, 0.7, 0.6, 0.6, 0.7, 1.3, 2.4, 4.4, 7, 11],
        14: [12, 8, 4.9, 3, 1.7, 0.9, 0.6, 0.6, 0.6, 0.9, 1.7, 3, 4.9, 8, 12],
        15: [14, 9.4, 6, 3.6, 2.1, 1.1, 0.7, 0.6, 0.6, 0.7, 1.1, 2.1, 3.6, 6, 9.4, 14],
        16: [16, 11, 7.1, 4.6, 2.6, 1.3, 0.9, 0.6, 0.6, 0.6, 0.9, 1.3, 2.6, 4.6, 7.1, 11, 16]
    },
    medium: {
        8: [13, 4.5, 1.2, 0.5, 0.4, 0.5, 1.2, 4.5, 13],
        9: [17, 6.6, 2, 0.6, 0.4, 0.4, 0.6, 2, 6.6, 17],
        10: [22, 9.1, 3.2, 0.9, 0.4, 0.4, 0.4, 0.9, 3.2, 9.1, 22],
        11: [29, 13, 4.5, 1.4, 0.5, 0.4, 0.4, 0.5, 1.4, 4.5, 13, 29],
        12: [38, 18, 7.5, 2.4, 0.7, 0.3, 0.3, 0.3, 0.7, 2.4, 7.5, 18, 38],
        13: [49, 25, 10, 3.6, 1.1, 0.4, 0.3, 0.3, 0.4, 1.1, 3.6, 10, 25, 49],
        14: [64, 31, 14, 5.5, 1.8, 0.5, 0.3, 0.3, 0.3, 0.5, 1.8, 5.5, 14, 31, 64],
        15: [84, 43, 20, 8, 2.7, 0.8, 0.3, 0.3, 0.3, 0.3, 0.8, 2.7, 8, 20, 43, 84],
        16: [110, 60, 27, 11, 4.2, 1.2, 0.4, 0.3, 0.3, 0.3, 0.4, 1.2, 4.2, 11, 27, 60, 110]
    },
    high: {
        8: [29, 6.6, 0.9, 0.2, 0.2, 0.2, 0.9, 6.6, 29],
        9: [45, 11, 1.5, 0.3, 0.2, 0.2, 0.3, 1.5, 11, 45],
        10: [70, 17, 3.2, 0.4, 0.2, 0.2, 0.2, 0.4, 3.2, 17, 70],
        11: [110, 29, 5.4, 0.7, 0.2, 0.2, 0.2, 0.2, 0.7, 5.4, 29, 110],
        12: [170, 45, 9.1, 1.3, 0.3, 0.2, 0.2, 0.2, 0.3, 1.3, 9.1, 45, 170],
        13: [270, 73, 15, 2.5, 0.4, 0.2, 0.2, 0.2, 0.2, 0.4, 2.5, 15, 73, 270],
        14: [410, 120, 26, 4.4, 0.6, 0.2, 0.2, 0.2, 0.2, 0.2, 0.6, 4.4, 26, 120, 410],
        15: [640, 190, 44, 7.6, 1.1, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 1.1, 7.6, 44, 190, 640],
        16: [1000, 290, 71, 14, 1.9, 0.3, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 1.9, 14, 71, 290, 1000]
    }
}

export interface PlinkoOptions {
    rows: number
    risk: PlinkoRisk
    balls: number
}

export interface PlinkoBall {
    /** One bounce per row: 0 = left, 1 = right. The client animates exactly this path. */
    path: number[]
    /** The slot it lands in (the number of rights), 0..rows. */
    slot: number
    multiplier: number
}

export interface PlinkoResult {
    rows: number
    risk: PlinkoRisk
    balls: PlinkoBall[]
    /** What the round paid in all, in multiples of one ball's bet. */
    multiplier: number
}

export function plinkoTable(rows: number, risk: PlinkoRisk): readonly number[] {
    const table = PLINKO_TABLES[risk][rows]
    if (!table) throw new RangeError(`Rows must be ${PLINKO_MIN_ROWS} to ${PLINKO_MAX_ROWS}`)
    return table
}

/** The chance a ball lands in each slot: C(rows, k) / 2^rows. */
export function plinkoOdds(rows: number): number[] {
    const odds: number[] = []
    let c = 1
    for (let k = 0; k <= rows; k++) {
        odds.push(c / 2 ** rows)
        c = (c * (rows - k)) / (k + 1)
    }
    return odds
}

/** What one ball returns per coin, exactly. */
export function plinkoRtp(rows: number, risk: PlinkoRisk): number {
    const odds = plinkoOdds(rows)
    return plinkoTable(rows, risk).reduce((sum, m, k) => sum + m * odds[k]!, 0)
}

export function parsePlinkoOptions(input: Record<string, unknown> | undefined): PlinkoOptions {
    const rows = input?.rows ?? 12
    const risk = input?.risk ?? 'medium'
    const balls = input?.balls ?? 1
    if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < PLINKO_MIN_ROWS || rows > PLINKO_MAX_ROWS) {
        throw new RangeError(`Rows must be ${PLINKO_MIN_ROWS} to ${PLINKO_MAX_ROWS}`)
    }
    if (typeof risk !== 'string' || !PLINKO_RISKS.includes(risk as PlinkoRisk)) throw new RangeError('Risk is low, medium or high')
    if (typeof balls !== 'number' || !Number.isInteger(balls) || balls < 1 || balls > PLINKO_MAX_BALLS) {
        throw new RangeError(`Drop 1 to ${PLINKO_MAX_BALLS} balls`)
    }
    return { rows, risk: risk as PlinkoRisk, balls }
}

export function playPlinko(rng: Rng, options: PlinkoOptions): PlinkoResult {
    const table = plinkoTable(options.rows, options.risk)
    const balls: PlinkoBall[] = []
    for (let b = 0; b < options.balls; b++) {
        const path = Array.from({ length: options.rows }, () => (rng.next() < 0.5 ? 0 : 1))
        const slot = path.reduce<number>((sum, step) => sum + step, 0)
        balls.push({ path, slot, multiplier: table[slot]! })
    }
    // Summed in tenths: every slot multiplier has at most one decimal.
    const multiplier = Math.round(balls.reduce((sum, ball) => sum + ball.multiplier * 10, 0)) / 10
    return { rows: options.rows, risk: options.risk, balls, multiplier }
}
