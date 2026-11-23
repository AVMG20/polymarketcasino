import { HH, HW } from './iso'
import { GRID_H, GRID_W } from './layout'

/**
 * Depth order for an isometric floor. Static things (walls, machines,
 * furniture) never overlap on the grid, so they are ordered once with a
 * topological sort; characters then slot in between per tile.
 */

export interface DepthBox {
    minX: number
    minY: number
    maxX: number
    maxY: number
    /** Height above the floor in px (for the screen overlap test). */
    height: number
}

const EPS = 1e-6

/** True when `a` must be drawn before `b`. */
export function behind(a: DepthBox, b: DepthBox): boolean {
    const aBeforeB = a.maxX <= b.minX + EPS || a.maxY <= b.minY + EPS
    const bBeforeA = b.maxX <= a.minX + EPS || b.maxY <= a.minY + EPS
    return aBeforeB && !bBeforeA
}

interface ScreenBox {
    x0: number
    x1: number
    y0: number
    y1: number
}

function screenBox(b: DepthBox): ScreenBox {
    return {
        x0: (b.minX - b.maxY) * HW,
        x1: (b.maxX - b.minY) * HW,
        y0: (b.minX + b.minY) * HH - b.height,
        y1: (b.maxX + b.maxY) * HH
    }
}

function overlaps(a: ScreenBox, b: ScreenBox): boolean {
    return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

/** A rank per box: draw in increasing rank. */
export function rankStatics(boxes: DepthBox[]): number[] {
    const n = boxes.length
    const screens = boxes.map(screenBox)
    const before: number[][] = Array.from({ length: n }, () => [])
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (i !== j && overlaps(screens[i]!, screens[j]!) && behind(boxes[j]!, boxes[i]!)) before[i]!.push(j)
        }
    }
    const order: number[] = []
    const state = new Uint8Array(n)
    const visit = (i: number) => {
        if (state[i]) return
        state[i] = 1
        for (const j of before[i]!) visit(j)
        state[i] = 2
        order.push(i)
    }
    const seq = boxes.map((_, i) => i).sort((a, b) => (boxes[a]!.minX + boxes[a]!.minY) - (boxes[b]!.minX + boxes[b]!.minY) || a - b)
    for (const i of seq) visit(i)
    const rank = new Array<number>(n)
    order.forEach((i, r) => (rank[i] = r))
    return rank
}

/**
 * For every tile, the highest rank among statics that must draw before a
 * character standing there (and overlap it on screen). -1 when none.
 */
export function tileRanks(boxes: DepthBox[], rank: number[]): Int32Array {
    const out = new Int32Array(GRID_W * GRID_H).fill(-1)
    const screens = boxes.map(screenBox)
    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            const me: DepthBox = { minX: x + 0.3, minY: y + 0.3, maxX: x + 0.7, maxY: y + 0.7, height: 70 }
            const ms = screenBox(me)
            let best = -1
            for (let i = 0; i < boxes.length; i++) {
                if (rank[i]! <= best) continue
                if (!overlaps(ms, screens[i]!)) continue
                if (behind(boxes[i]!, me)) best = rank[i]!
            }
            out[y * GRID_W + x] = best
        }
    }
    return out
}
