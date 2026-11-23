/**
 * Isometric 2:1 projection and the canvas painter every baked texture uses.
 *
 * Grid space: `gx` runs right-down on screen, `gy` left-down, `z` up in
 * screen pixels. A tile is 64×32 on screen. World (Pixi) coordinates are the
 * projection of grid space, with grid (0, 0, 0) at world (0, 0).
 *
 * Art is drawn once into canvases (gradients, soft shadows, outlines) and
 * uploaded as textures; nothing here runs per frame except `project`.
 */

export const TILE_W = 64
export const TILE_H = 32
export const HW = TILE_W / 2
export const HH = TILE_H / 2
/** Default pixels per world pixel for baked textures (the engine picks its own, see TextureBank). */
export const RES = 2

export interface Pt {
    x: number
    y: number
}

export function isoX(gx: number, gy: number): number {
    return (gx - gy) * HW
}

export function isoY(gx: number, gy: number, z = 0): number {
    return (gx + gy) * HH - z
}

export function project(gx: number, gy: number, z = 0): Pt {
    return { x: (gx - gy) * HW, y: (gx + gy) * HH - z }
}

/** World point on the floor (z = 0) back to grid space. */
export function unproject(wx: number, wy: number): Pt {
    const a = wx / HW
    const b = wy / HH
    return { x: (a + b) / 2, y: (b - a) / 2 }
}

// ── colour ─────────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '')
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
    const n = Number.parseInt(full, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
    return `#${c(r)}${c(g)}${c(b)}`
}

export function hexNum(hex: string): number {
    const [r, g, b] = hexToRgb(hex)
    return (r << 16) | (g << 8) | b
}

/** Mix two colours, t = 0 → a, 1 → b. */
export function mix(a: string, b: string, t: number): string {
    const [r1, g1, b1] = hexToRgb(a)
    const [r2, g2, b2] = hexToRgb(b)
    return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

export const lighten = (c: string, t: number) => mix(c, '#ffffff', t)
/** Darken toward a warm plum rather than black, so shadows stay cosy. */
export const darken = (c: string, t: number) => mix(c, '#24172e', t)

export function rgba(hex: string, alpha: number): string {
    const [r, g, b] = hexToRgb(hex)
    return `rgba(${r},${g},${b},${alpha})`
}

/** Grey it out (fogged or locked things). */
export function desaturate(hex: string, t: number): string {
    const [r, g, b] = hexToRgb(hex)
    const l = 0.3 * r + 0.59 * g + 0.11 * b
    return rgbToHex(r + (l - r) * t, g + (l - g) * t, b + (l - b) * t)
}

/** Small deterministic PRNG for art variation (never for outcomes). */
export function artRng(seed: number): () => number {
    let s = seed >>> 0 || 1
    return () => {
        s ^= s << 13
        s ^= s >>> 17
        s ^= s << 5
        return ((s >>> 0) % 100000) / 100000
    }
}

export function hashString(text: string): number {
    let h = 2166136261
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}

// ── painter ────────────────────────────────────────────────────────────────

/** The outline colour of every silhouette: a deep plum, never pure black. */
export const INK = '#2a1b30'

type GPt = [number, number]

export interface PrismColors {
    top: string
    /** Colour of a face pointing straight at +gy (bottom-left on screen). */
    left: string
    /** Colour of a face pointing straight at +gx (bottom-right on screen). */
    right: string
}

export function faceColors(base: string, topLight = 0.16): PrismColors {
    return { top: lighten(base, topLight), left: base, right: darken(base, 0.24) }
}

export interface PrismOptions {
    outline?: boolean
    lineWidth?: number
    /** Thin highlight along the top's front rim. */
    shine?: boolean
    /** Skip the top face (something else covers it). */
    noTop?: boolean
}

/**
 * Draws in grid space on a canvas. `ox, oy` is where grid (0, 0, 0) lands in
 * world pixels inside the canvas; the context is scaled by `res` (canvas
 * pixels per world pixel).
 */
export class Painter {
    constructor(readonly ctx: CanvasRenderingContext2D, readonly ox: number, readonly oy: number, readonly res = RES) {
        this.reset()
    }

    reset() {
        this.ctx.setTransform(this.res, 0, 0, this.res, 0, 0)
    }

    pt(gx: number, gy: number, z = 0): [number, number] {
        return [this.ox + (gx - gy) * HW, this.oy + (gx + gy) * HH - z]
    }

    /** Local (u right, v down, in px) on the plane gy = const, u running along +gx. */
    faceY(gx: number, gy: number, z: number) {
        const [x, y] = this.pt(gx, gy, z)
        const r = this.res
        this.ctx.setTransform(r, r * 0.5, 0, r, r * x, r * y)
    }

    /** Local (u right, v down, px) on the plane gx = const, u running along -gy. */
    faceX(gx: number, gy: number, z: number) {
        const [x, y] = this.pt(gx, gy, z)
        const r = this.res
        this.ctx.setTransform(r, -r * 0.5, 0, r, r * x, r * y)
    }

    /** Local (u along +gx, v along +gy; 32 units per tile) on the plane z = const. */
    top(gx: number, gy: number, z: number) {
        const [x, y] = this.pt(gx, gy, z)
        const r = this.res
        this.ctx.setTransform(r, r * 0.5, -r, r * 0.5, r * x, r * y)
    }

    polyPath(points: GPt[], z: number) {
        const { ctx } = this
        ctx.beginPath()
        points.forEach(([gx, gy], i) => {
            const [x, y] = this.pt(gx, gy, z)
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
        })
        ctx.closePath()
    }

    /** A soft drop shadow for a footprint, offset to the front-right (light from the top-left). */
    shadow(points: GPt[], blur = 7, alpha = 0.42, grow = 0.08) {
        const { ctx } = this
        const cx = points.reduce((s, p) => s + p[0], 0) / points.length
        const cy = points.reduce((s, p) => s + p[1], 0) / points.length
        const grown = points.map(([x, y]) => [cx + (x - cx) * (1 + grow) + 0.12, cy + (y - cy) * (1 + grow) + 0.1] as GPt)
        ctx.save()
        this.reset()
        // Draw the shape far off-canvas and let only its blurred shadow land here.
        const off = 4000
        ctx.shadowColor = `rgba(20, 8, 30, ${alpha})`
        ctx.shadowBlur = blur * this.res
        ctx.shadowOffsetX = off * this.res
        ctx.shadowOffsetY = 0
        ctx.beginPath()
        grown.forEach(([gx, gy], i) => {
            const [x, y] = this.pt(gx, gy, 0)
            if (i === 0) ctx.moveTo(x - off, y)
            else ctx.lineTo(x - off, y)
        })
        ctx.closePath()
        ctx.fillStyle = '#000'
        ctx.fill()
        ctx.restore()
    }

    /**
     * A vertical prism over a convex footprint polygon (grid points in
     * clockwise screen order). Faces pointing at the viewer are drawn and
     * shaded by their direction; the silhouette gets one clean outline.
     */
    prism(points: GPt[], z: number, h: number, colors: PrismColors | string, opts: PrismOptions = {}) {
        const { ctx } = this
        const col = typeof colors === 'string' ? faceColors(colors) : colors
        const n = points.length
        // Centroid to orient normals outward regardless of winding.
        const cx = points.reduce((s, p) => s + p[0], 0) / n
        const cy = points.reduce((s, p) => s + p[1], 0) / n
        const faces: { a: GPt, b: GPt, depth: number, shade: number }[] = []
        for (let i = 0; i < n; i++) {
            const a = points[i]!
            const b = points[(i + 1) % n]!
            let nx = b[1] - a[1]
            let ny = -(b[0] - a[0])
            const mx = (a[0] + b[0]) / 2 - cx
            const my = (a[1] + b[1]) / 2 - cy
            if (nx * mx + ny * my < 0) {
                nx = -nx
                ny = -ny
            }
            const len = Math.hypot(nx, ny) || 1
            nx /= len
            ny /= len
            // Faces whose normal points away from the viewer are hidden.
            if (nx + ny <= 0.001) continue
            // 0 = pure +gy face (lit), 1 = pure +gx face (shaded).
            const shade = Math.max(0, Math.min(1, (nx - ny + 1) / 2))
            faces.push({ a, b, depth: a[0] + a[1] + b[0] + b[1], shade })
        }
        faces.sort((f1, f2) => f1.depth - f2.depth)
        if (h > 0) {
            for (const f of faces) {
                const base = mix(col.left, col.right, f.shade)
                const [x1, y1] = this.pt(f.a[0], f.a[1], z + h)
                const [x2, y2] = this.pt(f.b[0], f.b[1], z + h)
                const [x3, y3] = this.pt(f.b[0], f.b[1], z)
                const [x4, y4] = this.pt(f.a[0], f.a[1], z)
                const top = Math.min(y1, y2)
                const bottom = Math.max(y3, y4)
                const grad = ctx.createLinearGradient(0, top, 0, bottom)
                grad.addColorStop(0, lighten(base, 0.07))
                grad.addColorStop(1, darken(base, 0.1))
                ctx.beginPath()
                ctx.moveTo(x1, y1)
                ctx.lineTo(x2, y2)
                ctx.lineTo(x3, y3)
                ctx.lineTo(x4, y4)
                ctx.closePath()
                ctx.fillStyle = grad
                ctx.fill()
                // Hairline seams between facets keep curved prisms from banding.
                ctx.strokeStyle = base
                ctx.lineWidth = 0.6
                ctx.stroke()
            }
        }
        if (!opts.noTop) {
            this.polyPath(points, z + h)
            ctx.fillStyle = col.top
            ctx.fill()
        }
        if (opts.shine !== false && h > 0) {
            // A light rim along the top's front edges reads as a rounded bevel.
            ctx.save()
            ctx.strokeStyle = 'rgba(255,255,255,0.38)'
            ctx.lineWidth = 1.2
            ctx.lineCap = 'round'
            for (const f of faces) {
                const [x1, y1] = this.pt(f.a[0], f.a[1], z + h)
                const [x2, y2] = this.pt(f.b[0], f.b[1], z + h)
                ctx.beginPath()
                ctx.moveTo(x1, y1 + 0.8)
                ctx.lineTo(x2, y2 + 0.8)
                ctx.stroke()
            }
            ctx.restore()
        }
        if (opts.outline !== false) this.outlineHull(points, z, h, opts.lineWidth ?? 1.6)
    }

    box(x: number, y: number, z: number, w: number, d: number, h: number, colors: PrismColors | string, opts: PrismOptions = {}) {
        this.prism([[x, y], [x + w, y], [x + w, y + d], [x, y + d]], z, h, colors, opts)
    }

    /** Outline of the convex silhouette of a prism. */
    outlineHull(points: GPt[], z: number, h: number, lineWidth = 1.6, color = INK) {
        const screen: [number, number][] = []
        for (const [gx, gy] of points) {
            screen.push(this.pt(gx, gy, z))
            if (h > 0) screen.push(this.pt(gx, gy, z + h))
        }
        const hull = convexHull(screen)
        const { ctx } = this
        ctx.beginPath()
        hull.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
        ctx.closePath()
        ctx.strokeStyle = color
        ctx.lineWidth = lineWidth
        ctx.lineJoin = 'round'
        ctx.stroke()
    }

    /** Upright cylinder centred on (cx, cy). r in tiles. */
    cylinder(cx: number, cy: number, z: number, r: number, h: number, colors: PrismColors | string, opts: PrismOptions = {}) {
        this.prism(circlePoly(cx, cy, r, 28), z, h, colors, opts)
    }

    /** Filled polygon on the floor plane at height z (decals, felt, rugs). */
    flat(points: GPt[], z: number, fill: string | CanvasGradient, stroke?: string, lineWidth = 1.4) {
        this.polyPath(points, z)
        this.ctx.fillStyle = fill
        this.ctx.fill()
        if (stroke) {
            this.ctx.strokeStyle = stroke
            this.ctx.lineWidth = lineWidth
            this.ctx.lineJoin = 'round'
            this.ctx.stroke()
        }
    }

    /** Centered text in the current transform. */
    text(text: string, x: number, y: number, size: number, fill: string, opts: { font?: string, stroke?: string, strokeWidth?: number, align?: CanvasTextAlign, maxWidth?: number } = {}) {
        const { ctx } = this
        ctx.font = `${size}px ${opts.font ?? '"Lilita One", "Fredoka", system-ui, sans-serif'}`
        ctx.textAlign = opts.align ?? 'center'
        ctx.textBaseline = 'middle'
        if (opts.stroke) {
            ctx.strokeStyle = opts.stroke
            ctx.lineWidth = opts.strokeWidth ?? 3
            ctx.lineJoin = 'round'
            ctx.strokeText(text, x, y, opts.maxWidth)
        }
        ctx.fillStyle = fill
        ctx.fillText(text, x, y, opts.maxWidth)
    }
}

export function convexHull(points: [number, number][]): [number, number][] {
    const pts = points.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]))
    if (pts.length < 3) return pts
    const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const lower: [number, number][] = []
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
        lower.push(p)
    }
    const upper: [number, number][] = []
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i]!
        while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
        upper.push(p)
    }
    upper.pop()
    lower.pop()
    return lower.concat(upper)
}

export function circlePoly(cx: number, cy: number, r: number, segments = 24): GPt[] {
    const out: GPt[] = []
    for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2
        out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
    return out
}

/** A rounded rectangle footprint in grid space. */
export function roundRectPoly(x: number, y: number, w: number, d: number, r: number, steps = 5): GPt[] {
    const rr = Math.min(r, w / 2, d / 2)
    const out: GPt[] = []
    const corners: [number, number, number][] = [
        [x + w - rr, y + rr, -Math.PI / 2],
        [x + w - rr, y + d - rr, 0],
        [x + rr, y + d - rr, Math.PI / 2],
        [x + rr, y + rr, Math.PI]
    ]
    for (const [cx, cy, start] of corners) {
        for (let i = 0; i <= steps; i++) {
            const a = start + (i / steps) * (Math.PI / 2)
            out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr])
        }
    }
    return out
}

/** A canvas sized for a footprint of w×d tiles and `height` px above the floor, plus margin. */
export function footprintCanvas(w: number, d: number, height: number, margin = 14): { width: number, height: number, ox: number, oy: number } {
    const width = Math.ceil((w + d) * HW + margin * 2)
    const h = Math.ceil((w + d) * HH + height + margin * 2)
    return { width, height: h, ox: d * HW + margin, oy: height + margin }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + w, y, x + w, y + h, rr)
    ctx.arcTo(x + w, y + h, x, y + h, rr)
    ctx.arcTo(x, y + h, x, y, rr)
    ctx.arcTo(x, y, x + w, y, rr)
    ctx.closePath()
}
