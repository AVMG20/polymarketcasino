import type { Rng } from '../rng'

/**
 * Wheel: ten segments, each with a multiplier (0× loses the bet). The risk
 * level decides how many segments lose and how high the rest pay. Every risk
 * returns 96%: the multipliers of one wheel add up to 9.6.
 */
export type WheelRisk = 'easy' | 'medium' | 'hard'
export type WheelColor = 'red' | 'blue' | 'green' | 'yellow'

export interface WheelSegment {
    multiplier: number
    color: WheelColor
}

export const WHEEL_RISKS: readonly WheelRisk[] = ['easy', 'medium', 'hard']

/** Segment kinds per risk, with how many of the ten segments each takes. */
export const WHEEL_TABLES: Readonly<Record<WheelRisk, readonly (WheelSegment & { count: number })[]>> = {
    easy: [
        { multiplier: 0, color: 'red', count: 4 },
        { multiplier: 1.3, color: 'blue', count: 3 },
        { multiplier: 1.8, color: 'green', count: 2 },
        { multiplier: 2.1, color: 'yellow', count: 1 }
    ],
    medium: [
        { multiplier: 0, color: 'red', count: 5 },
        { multiplier: 1.4, color: 'blue', count: 2 },
        { multiplier: 2, color: 'green', count: 2 },
        { multiplier: 2.8, color: 'yellow', count: 1 }
    ],
    hard: [
        { multiplier: 0, color: 'red', count: 7 },
        { multiplier: 1.6, color: 'blue', count: 1 },
        { multiplier: 3, color: 'green', count: 1 },
        { multiplier: 5, color: 'yellow', count: 1 }
    ]
}

/**
 * The segments in wheel order (clockwise from the top), losses spread evenly
 * between the paying segments. The server draws an index into this list and
 * the client spins to the same index.
 */
export function wheelLayout(risk: WheelRisk): WheelSegment[] {
    const table = WHEEL_TABLES[risk]
    const losses = table.find(seg => seg.multiplier === 0)?.count ?? 0
    // Paying segments round-robin over their kinds, so equal ones don't bunch up.
    const kinds = table.filter(seg => seg.multiplier > 0).map(seg => ({ ...seg }))
    const paying: WheelSegment[] = []
    while (kinds.some(seg => seg.count > 0)) {
        for (const seg of kinds) {
            if (seg.count-- > 0) paying.push({ multiplier: seg.multiplier, color: seg.color })
        }
    }
    const n = paying.length + losses
    const lossAt = new Set(Array.from({ length: losses }, (_, i) => Math.round(i * n / losses)))
    const out: WheelSegment[] = []
    let next = 0
    for (let i = 0; i < n; i++) out.push(lossAt.has(i) ? { multiplier: 0, color: 'red' } : paying[next++]!)
    return out
}

export interface WheelOptions {
    risk: WheelRisk
}

export interface WheelResult {
    risk: WheelRisk
    /** Index into wheelLayout(risk). */
    index: number
    multiplier: number
    won: boolean
}

export function parseWheelOptions(input: Record<string, unknown> | undefined): WheelOptions {
    const risk = input?.risk ?? 'medium'
    if (typeof risk !== 'string' || !WHEEL_RISKS.includes(risk as WheelRisk)) throw new RangeError('Risk is easy, medium or hard')
    return { risk: risk as WheelRisk }
}

export function playWheel(rng: Rng, options: WheelOptions): WheelResult {
    const layout = wheelLayout(options.risk)
    const index = Math.floor(rng.next() * layout.length)
    const multiplier = layout[index]!.multiplier
    return { risk: options.risk, index, multiplier, won: multiplier > 0 }
}

/** What a whole wheel returns per coin staked. */
export function wheelRtp(risk: WheelRisk): number {
    const layout = wheelLayout(risk)
    return layout.reduce((sum, seg) => sum + seg.multiplier, 0) / layout.length
}
