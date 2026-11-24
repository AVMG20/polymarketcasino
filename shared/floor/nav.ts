import type { ZoneId } from '../tycoon'
import { CAGE, DESK, GRID_H, GRID_W, PLOTS, PORCH, PROPS, areaAt, doorwayBetween, inGrid, type Rect, type Tile } from './layout'

/**
 * Walkable tiles and A* for the floor. Plots block whatever their status (an
 * empty plot is still reserved floor), so the grid only changes when a zone
 * is bought or decor adds furniture.
 */
export class NavGrid {
    readonly walkable: Uint8Array

    constructor(readonly owned: ReadonlySet<ZoneId>, readonly decor: number) {
        this.walkable = new Uint8Array(GRID_W * GRID_H)
        for (let y = 0; y < GRID_H; y++) {
            for (let x = 0; x < GRID_W; x++) {
                const area = areaAt(x, y)
                if (area && (area === 'porch' || owned.has(area))) this.walkable[y * GRID_W + x] = 1
            }
        }
        for (const t of PORCH) this.walkable[t.y * GRID_W + t.x] = 1
        const block = (r: Rect) => {
            for (let x = r.x; x < r.x + r.w; x++) {
                for (let y = r.y; y < r.y + r.h; y++) if (inGrid(x, y)) this.walkable[y * GRID_W + x] = 0
            }
        }
        for (const plot of Object.values(PLOTS)) block(plot.rect)
        block(CAGE.rect)
        block(DESK.rect)
        for (const p of PROPS) if (p.decor <= decor) block(p.rect)
    }

    isWalkable(x: number, y: number): boolean {
        return inGrid(x, y) && this.walkable[y * GRID_W + x] === 1
    }

    /** Block or free one tile (a FOR SALE sign stands in a doorway). */
    setBlocked(t: Tile, blocked: boolean) {
        if (inGrid(t.x, t.y)) this.walkable[t.y * GRID_W + t.x] = blocked ? 0 : 1
    }

    /** One orthogonal step: both tiles walkable and no wall between them. */
    canStep(ax: number, ay: number, bx: number, by: number): boolean {
        if (!this.isWalkable(bx, by)) return false
        const a = areaAt(ax, ay)
        const b = areaAt(bx, by)
        if (a === b) return true
        return doorwayBetween(ax, ay, bx, by) !== null
    }

    /** A diagonal step needs both orthogonal routes open (no corner cutting). */
    canMove(ax: number, ay: number, dx: number, dy: number): boolean {
        if (dx === 0 || dy === 0) return this.canStep(ax, ay, ax + dx, ay + dy)
        return this.canStep(ax, ay, ax + dx, ay) && this.canStep(ax + dx, ay, ax + dx, ay + dy)
            && this.canStep(ax, ay, ax, ay + dy) && this.canStep(ax, ay + dy, ax + dx, ay + dy)
    }

    /** Nearest walkable tile to (x, y), searching outward a few rings. */
    nearestWalkable(x: number, y: number, maxRing = 4): Tile | null {
        const fx = Math.floor(x)
        const fy = Math.floor(y)
        if (this.isWalkable(fx, fy)) return { x: fx, y: fy }
        for (let ring = 1; ring <= maxRing; ring++) {
            let best: Tile | null = null
            let bestD = Infinity
            for (let dx = -ring; dx <= ring; dx++) {
                for (let dy = -ring; dy <= ring; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
                    const tx = fx + dx
                    const ty = fy + dy
                    if (!this.isWalkable(tx, ty)) continue
                    const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y)
                    if (d < bestD) {
                        bestD = d
                        best = { x: tx, y: ty }
                    }
                }
            }
            if (best) return best
        }
        return null
    }

    /** A* over 8 directions. Returns the tiles after `from`, ending at `to`; null if unreachable. */
    findPath(from: Tile, to: Tile): Tile[] | null {
        if (from.x === to.x && from.y === to.y) return []
        if (!this.isWalkable(to.x, to.y)) return null
        const size = GRID_W * GRID_H
        const g = new Float32Array(size).fill(Infinity)
        const came = new Int32Array(size).fill(-1)
        const closed = new Uint8Array(size)
        const start = from.y * GRID_W + from.x
        const goal = to.y * GRID_W + to.x
        const h = (i: number) => {
            const dx = Math.abs((i % GRID_W) - to.x)
            const dy = Math.abs(Math.floor(i / GRID_W) - to.y)
            return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
        }
        // A small binary heap of [f, index].
        const heap: [number, number][] = []
        const push = (f: number, i: number) => {
            heap.push([f, i])
            let c = heap.length - 1
            while (c > 0) {
                const p = (c - 1) >> 1
                if (heap[p]![0] <= heap[c]![0]) break
                ;[heap[p], heap[c]] = [heap[c]!, heap[p]!]
                c = p
            }
        }
        const pop = (): number => {
            const top = heap[0]!
            const last = heap.pop()!
            if (heap.length) {
                heap[0] = last
                let p = 0
                for (;;) {
                    const l = p * 2 + 1
                    const r = l + 1
                    let m = p
                    if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l
                    if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r
                    if (m === p) break
                    ;[heap[p], heap[m]] = [heap[m]!, heap[p]!]
                    p = m
                }
            }
            return top[1]
        }
        g[start] = 0
        push(h(start), start)
        while (heap.length) {
            const cur = pop()
            if (cur === goal) break
            if (closed[cur]) continue
            closed[cur] = 1
            const cx = cur % GRID_W
            const cy = Math.floor(cur / GRID_W)
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (!dx && !dy) continue
                    const nx = cx + dx
                    const ny = cy + dy
                    if (!inGrid(nx, ny)) continue
                    // The start tile may be blocked (standing in a doorway that just closed): still allow leaving it.
                    if (!this.canMove(cx, cy, dx, dy)) continue
                    const ni = ny * GRID_W + nx
                    if (closed[ni]) continue
                    const cost = g[cur]! + (dx && dy ? Math.SQRT2 : 1)
                    if (cost < g[ni]!) {
                        g[ni] = cost
                        came[ni] = cur
                        push(cost + h(ni), ni)
                    }
                }
            }
        }
        if (came[goal] === -1) return null
        const out: Tile[] = []
        for (let i = goal; i !== start; i = came[i]!) out.push({ x: i % GRID_W, y: Math.floor(i / GRID_W) })
        return out.reverse()
    }

    /** All walkable tiles, for guests picking somewhere to wander. */
    tiles(): Tile[] {
        const out: Tile[] = []
        for (let y = 0; y < GRID_H; y++) {
            for (let x = 0; x < GRID_W; x++) if (this.walkable[y * GRID_W + x]) out.push({ x, y })
        }
        return out
    }
}
