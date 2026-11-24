import { findDecor, isSpecial, type DecorType } from '#shared/decor'
import { INK, Painter, circlePoly, darken, faceColors, footprintCanvas, lighten, project, rgba, roundRect, roundRectPoly, type PrismColors } from '../iso'
import { PAL } from './palette'
import { LAMP_LIGHT, drawProp, propHeight, type PropKind } from './props'

/**
 * Decorations a casino places on its floor (shared/decor.ts). The plain ones
 * reuse the old furniture (props.ts) at the catalog footprints; the specials
 * are richer: gold trim, lights, and on the floor a soft gold glow and
 * sparkles (DecorView), so a special reads as one at a glance.
 *
 * Every drawing has its grid origin at the footprint's back corner and faces
 * +gy, like the machines. `decorIcon` renders one to an image for the menus.
 */

/** Gold with a real gold top (goldLight on a big top face reads as butter). */
const gold = (): PrismColors => ({ top: '#efb944', left: '#e3aa3a', right: PAL.goldDark })
const MARBLE = '#f4f0ea'

/** Footprint in tiles. */
export function decorSize(type: DecorType): { w: number, h: number } {
    const def = findDecor(type)
    return { w: def?.w ?? 1, h: def?.h ?? 1 }
}

/** Flat things (a rug) lie under everything and guests walk over them. */
export function decorFlat(type: DecorType): boolean {
    return findDecor(type)?.blocks === false
}

const PLAIN: Partial<Record<DecorType, PropKind>> = {
    plant: 'plant',
    palm: 'palm',
    lamp: 'lamp',
    rope: 'rope',
    statue: 'statue',
    sofa: 'sofa',
    bar: 'bar',
    piano: 'piano',
    fountain: 'fountain'
}

/** Height above the floor in px (depth sorting and the canvas size). */
export function decorHeight(type: DecorType): number {
    const kind = PLAIN[type]
    if (kind === 'piano') return 64
    if (kind === 'statue') return 74
    if (kind) return propHeight(kind)
    switch (type) {
        case 'flowers': return 62
        case 'rug': return 1
        case 'neon': return 46
        case 'golden-statue': return 76
        case 'jackpot-sign': return 104
        case 'aquarium': return 74
        case 'grand-piano': return 84
        case 'grand-fountain': return 88
        case 'champagne-bar': return 80
        case 'red-carpet': return 3
        case 'diamond-display': return 70
        case 'showcase-car': return 40
        case 'vip-booth': return 40
        case 'gold-slot': return 74
        case 'ice-sculpture': return 62
        default: return 40
    }
}

/** A glow (additive sprite) on a decoration, local px from its origin. */
export interface DecorLight {
    x: number
    y: number
    scale: number
    alpha: number
    tint: number
    /** Twinkles (bulbs) rather than breathing slowly. */
    twinkle?: boolean
}

function bulbRing(gx0: number, gy: number, w: number, zTop: number, h: number, step: number): DecorLight[] {
    const out: DecorLight[] = []
    const add = (u: number, v: number) => {
        const p = project(gx0 + u / 32, gy, zTop - v)
        out.push({ x: p.x, y: p.y, scale: 0.13, alpha: 0.9, tint: 0xffe39a, twinkle: true })
    }
    const pw = w * 32
    for (let u = 3; u <= pw - 3; u += step) {
        add(u, 3)
        add(u, h - 3)
    }
    for (let v = 3 + step; v < h - 3; v += step) {
        add(3, v)
        add(pw - 3, v)
    }
    return out
}

/** The lights a decoration gives off. */
export function decorLights(type: DecorType): DecorLight[] {
    switch (type) {
        case 'lamp': return [{ ...LAMP_LIGHT, scale: 1.1, alpha: 0.6, tint: 0xffc76b }]
        case 'neon': {
            const p = project(0.5, 0.57, 28)
            return [{ x: p.x, y: p.y, scale: 1.25, alpha: 0.7, tint: 0xff4fd8 }]
        }
        case 'jackpot-sign': {
            const p = project(1, 0.54, 66)
            return [{ x: p.x, y: p.y, scale: 1.5, alpha: 0.42, tint: 0xff6b5a }, ...bulbRing(0.05, 0.54, 1.9, 96, 58, 9)]
        }
        case 'aquarium': {
            const p = project(1, 0.88, 46)
            return [{ x: p.x, y: p.y, scale: 1.3, alpha: 0.45, tint: 0x45b6e6 }]
        }
        case 'diamond-display': {
            const g = project(0.5, 0.5, 46)
            return [{ x: g.x, y: g.y, scale: 0.8, alpha: 0.55, tint: 0x9fe8ff }, { x: g.x - 3, y: g.y - 3, scale: 0.16, alpha: 1, tint: 0xffffff, twinkle: true }]
        }
        case 'vip-booth': {
            const c = project(1, 0.8, 27)
            return [{ x: c.x, y: c.y, scale: 0.7, alpha: 0.6, tint: 0xffb84a }, { x: c.x, y: c.y - 2, scale: 0.12, alpha: 1, tint: 0xfff1c4, twinkle: true }]
        }
        case 'gold-slot': {
            const out: DecorLight[] = []
            for (const [gx, z] of [[0.3, 56], [0.5, 66], [0.7, 30], [0.4, 20]] as const) {
                const q = project(gx, 0.78, z)
                out.push({ x: q.x, y: q.y, scale: 0.14, alpha: 0.9, tint: 0xfff1b8, twinkle: true })
            }
            const c = project(0.5, 0.5, 40)
            return [{ x: c.x, y: c.y, scale: 1, alpha: 0.4, tint: 0xffd25a }, ...out]
        }
        case 'ice-sculpture': {
            const c = project(0.5, 0.5, 38)
            const t = project(0.5, 0.5, 23)
            return [{ x: c.x, y: c.y, scale: 1.1, alpha: 0.5, tint: 0x8fdcff }, { x: t.x, y: t.y, scale: 0.9, alpha: 0.35, tint: 0x45b6e6 }]
        }
        case 'showcase-car': {
            const ring: DecorLight[] = []
            for (let i = 0; i < 14; i++) {
                const a = (i / 14) * Math.PI * 2
                const q = project(1 + Math.cos(a) * 0.92, 1 + Math.sin(a) * 0.92, 6)
                ring.push({ x: q.x, y: q.y, scale: 0.12, alpha: 0.9, tint: 0xffe39a, twinkle: true })
            }
            const top = project(1, 1, 30)
            return [{ x: top.x, y: top.y, scale: 1.3, alpha: 0.32, tint: 0xffd25a }, ...ring]
        }
        case 'champagne-bar': {
            const p = project(1.5, 0.68, 52)
            return [{ x: p.x, y: p.y, scale: 1.2, alpha: 0.45, tint: 0xffe39a }]
        }
        case 'grand-fountain': {
            const p = project(1, 1, 74)
            const w = project(1, 1, 16)
            return [{ x: p.x, y: p.y, scale: 1.1, alpha: 0.4, tint: 0xffd25a }, { x: w.x, y: w.y, scale: 1.7, alpha: 0.32, tint: 0x45d0ff }]
        }
        case 'golden-statue': {
            const p = project(0.5, 0.5, 52)
            return [{ x: p.x, y: p.y, scale: 0.9, alpha: 0.4, tint: 0xffd23f }]
        }
        default: return []
    }
}

/** A pool of light on the floor under it (lamps, specials), in grid units from its origin. */
export function decorPool(type: DecorType): { gx: number, gy: number, scale: number, alpha: number, tint: number } | null {
    const { w, h } = decorSize(type)
    if (type === 'lamp') return { gx: 0.5, gy: 0.5, scale: 1.4, alpha: 0.32, tint: 0xffc76b }
    if (type === 'neon') return { gx: 0.5, gy: 0.9, scale: 1.3, alpha: 0.3, tint: 0xff4fd8 }
    if (type === 'aquarium') return { gx: w / 2, gy: h, scale: 1.8, alpha: 0.3, tint: 0x45b6e6 }
    if (isSpecial(type)) return { gx: w / 2, gy: h / 2, scale: 0.9 + (w + h) * 0.45, alpha: 0.38, tint: 0xffc93a }
    return null
}

// ── drawing helpers ────────────────────────────────────────────────────────

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
}

function goldGradient(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
    const g = ctx.createLinearGradient(x0, y0, x1, y1)
    g.addColorStop(0, PAL.goldLight)
    g.addColorStop(0.45, PAL.gold)
    g.addColorStop(1, PAL.goldDark)
    return g
}

/** An outlined ellipse: ink first, a little larger, then the fill. */
function inked(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient, rot = 0, line = 1.5) {
    ctx.beginPath()
    ctx.ellipse(x, y, rx + line, ry + line, rot, 0, Math.PI * 2)
    ctx.fillStyle = INK
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | CanvasGradient, inner = 0.45) {
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2
        const rr = i % 2 ? r * inner : r
        if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
        else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    }
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.4
    ctx.lineJoin = 'round'
    ctx.stroke()
}

function note(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string) {
    for (const [color, grow] of [[INK, 1.4], [fill, 0]] as const) {
        ctx.fillStyle = color
        ctx.strokeStyle = color
        ctx.lineWidth = 1.6 + grow
        ctx.beginPath()
        ctx.ellipse(x, y, 3.2 * s + grow / 2, 2.4 * s + grow / 2, -0.4, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(x + 2.8 * s, y - 0.5)
        ctx.lineTo(x + 2.8 * s, y - 11 * s)
        ctx.lineTo(x + 7 * s, y - 8 * s)
        ctx.stroke()
    }
}

// ── plain decorations ──────────────────────────────────────────────────────

function drawFlowers(p: Painter) {
    const { ctx } = p
    p.shadow(circlePoly(0.5, 0.5, 0.3, 12), 5, 0.35, 0)
    const porcelain = faceColors('#f1f4fb', 0.1)
    p.cylinder(0.5, 0.5, 0, 0.18, 4, porcelain)
    p.cylinder(0.5, 0.5, 4, 0.26, 16, porcelain)
    p.cylinder(0.5, 0.5, 20, 0.15, 10, porcelain)
    // A blue band round the belly (the front half shows).
    ctx.strokeStyle = '#3d6fd1'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    for (let i = 0; i <= 12; i++) {
        const a = -Math.PI / 4 + (i / 12) * Math.PI
        const [x, y] = p.pt(0.5 + Math.cos(a) * 0.262, 0.5 + Math.sin(a) * 0.262, 11)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
    }
    ctx.stroke()
    const [x, y] = p.pt(0.5, 0.5, 30)
    p.reset()
    // Stems and leaves.
    const heads: [number, number, string][] = [[-10, -17, '#ff6fa5'], [9, -19, '#ffd23f'], [0, -27, '#f43f5e'], [-4, -11, '#c084fc'], [11, -8, '#ff8a3d']]
    ctx.lineCap = 'round'
    for (const [dx, dy] of heads) {
        ctx.strokeStyle = INK
        ctx.lineWidth = 3.8
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(x + dx * 0.3, y + dy * 0.5, x + dx, y + dy)
        ctx.stroke()
        ctx.strokeStyle = PAL.leafDark
        ctx.lineWidth = 1.8
        ctx.stroke()
    }
    inked(ctx, x - 8.5, y - 5, 5.5, 2.4, PAL.leaf, -0.5, 1.2)
    inked(ctx, x + 8.5, y - 4, 5.5, 2.4, PAL.leaf, 0.5, 1.2)
    for (const [dx, dy, color] of heads) {
        const hx = x + dx
        const hy = y + dy
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2
            blob(ctx, hx + Math.cos(a) * 3.4, hy + Math.sin(a) * 3.4, 4.1, INK)
        }
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2
            blob(ctx, hx + Math.cos(a) * 3.4, hy + Math.sin(a) * 3.4, 3.1, color)
        }
        blob(ctx, hx, hy, 2.2, '#fff3c4')
    }
}

/** A white marble bust (cool shading, no gold: the Golden Statue is the gold one). */
function drawMarbleStatue(p: Painter) {
    const { ctx } = p
    p.shadow([[0.14, 0.14], [0.86, 0.14], [0.86, 0.86], [0.14, 0.86]], 6, 0.35, 0)
    const stone = faceColors('#dedce8', 0.1)
    p.box(0.15, 0.15, 0, 0.7, 0.7, 6, stone)
    p.box(0.22, 0.22, 6, 0.56, 0.56, 16, faceColors('#eeedf4', 0.06))
    p.box(0.17, 0.17, 22, 0.66, 0.66, 4, stone)
    const [x, y] = p.pt(0.5, 0.5, 26)
    p.reset()
    const g = ctx.createLinearGradient(x - 14, y - 48, x + 14, y)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.55, '#e6e4ef')
    g.addColorStop(1, '#b5b1c7')
    const line = (draw: () => void, fill: string | CanvasGradient) => {
        draw()
        ctx.fillStyle = fill
        ctx.fill()
        ctx.strokeStyle = INK
        ctx.lineWidth = 1.5
        ctx.lineJoin = 'round'
        ctx.stroke()
    }
    // Socle, shoulders and draped chest.
    line(() => {
        ctx.beginPath()
        ctx.moveTo(x - 6, y - 1)
        ctx.lineTo(x + 6, y - 1)
        ctx.lineTo(x + 4, y - 7)
        ctx.lineTo(x - 4, y - 7)
        ctx.closePath()
    }, g)
    line(() => {
        ctx.beginPath()
        ctx.moveTo(x - 14, y - 9)
        ctx.quadraticCurveTo(x - 15, y - 21, x - 6, y - 24)
        ctx.lineTo(x + 6, y - 24)
        ctx.quadraticCurveTo(x + 15, y - 21, x + 14, y - 9)
        ctx.quadraticCurveTo(x, y - 5, x - 14, y - 9)
        ctx.closePath()
    }, g)
    ctx.strokeStyle = 'rgba(110, 102, 140, 0.55)'
    ctx.lineWidth = 1
    ctx.lineCap = 'round'
    for (const [x0, y0, x1, y1] of [[-11, -20, 3, -9], [-7, -22, 7, -10], [-2, -23, 10, -13]] as const) {
        ctx.beginPath()
        ctx.moveTo(x + x0, y + y0)
        ctx.quadraticCurveTo(x + (x0 + x1) / 2 + 2, y + (y0 + y1) / 2 + 2, x + x1, y + y1)
        ctx.stroke()
    }
    // Neck and head, with curls.
    line(() => {
        ctx.beginPath()
        ctx.rect(x - 3.5, y - 30, 7, 8)
    }, g)
    line(() => {
        ctx.beginPath()
        ctx.ellipse(x, y - 36, 7.5, 8.5, 0, 0, Math.PI * 2)
    }, g)
    for (const [dx, dy] of [[-6.5, -39], [-3.5, -43], [0.5, -44.5], [4.5, -42.5], [7, -38.5], [-7.5, -34.5]] as const) {
        inked(ctx, x + dx, y + dy, 2.6, 2.6, '#f4f3f9', 0, 1.1)
    }
    // Closed eyes, a nose, and the shade on its far side.
    ctx.strokeStyle = 'rgba(80, 72, 110, 0.8)'
    ctx.lineWidth = 1
    for (const side of [-1, 1]) {
        ctx.beginPath()
        ctx.arc(x + side * 3, y - 36, 1.6, Math.PI * 0.15, Math.PI * 0.85)
        ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(x + 0.5, y - 35.5)
    ctx.lineTo(x + 1.5, y - 32.5)
    ctx.lineTo(x, y - 32.2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(120, 112, 160, 0.16)'
    ctx.beginPath()
    ctx.ellipse(x + 4, y - 34, 3.6, 7, 0, 0, Math.PI * 2)
    ctx.fill()
}

function drawRug(p: Painter) {
    const { ctx } = p
    const z = 0.6
    p.flat(roundRectPoly(0.08, 0.08, 1.84, 1.84, 0.12), z, '#8e2944', INK, 1.4)
    p.flat(roundRectPoly(0.2, 0.2, 1.6, 1.6, 0.08), z, PAL.gold)
    p.flat(roundRectPoly(0.27, 0.27, 1.46, 1.46, 0.06), z, '#b3243f')
    p.flat(roundRectPoly(0.42, 0.42, 1.16, 1.16, 0.04), z, '#9b1d38')
    // A gold medallion in the middle, a diamond in each corner.
    p.flat([[1, 0.5], [1.5, 1], [1, 1.5], [0.5, 1]], z, PAL.gold, darken(PAL.gold, 0.35), 1)
    p.flat([[1, 0.68], [1.32, 1], [1, 1.32], [0.68, 1]], z, '#7a1d33')
    p.flat(circlePoly(1, 1, 0.1, 12), z, PAL.goldLight)
    for (const [cx, cy] of [[0.4, 0.4], [1.6, 0.4], [1.6, 1.6], [0.4, 1.6]] as const) {
        p.flat([[cx, cy - 0.08], [cx + 0.08, cy], [cx, cy + 0.08], [cx - 0.08, cy]], z, PAL.goldLight)
    }
    // Fringe on the two short ends.
    p.top(0, 0, z)
    ctx.strokeStyle = PAL.cream
    ctx.lineWidth = 0.9
    for (let u = 5; u <= 59; u += 3) {
        ctx.beginPath()
        ctx.moveTo(2.6, u)
        ctx.lineTo(0.2, u)
        ctx.moveTo(61.4, u)
        ctx.lineTo(63.8, u)
        ctx.stroke()
    }
    p.reset()
}

function drawNeon(p: Painter) {
    const { ctx } = p
    p.shadow([[0.06, 0.42], [0.94, 0.42], [0.94, 0.72], [0.06, 0.72]], 5, 0.35, 0)
    const dark = faceColors('#2a2140', 0.12)
    // A low base, two short posts and a board wider than tall: the tubes make the picture.
    p.box(0.12, 0.46, 0, 0.76, 0.2, 4, dark)
    p.box(0.24, 0.53, 4, 0.06, 0.06, 10, faceColors(PAL.slate), { lineWidth: 1, shine: false })
    p.box(0.7, 0.53, 4, 0.06, 0.06, 10, faceColors(PAL.slate), { lineWidth: 1, shine: false })
    p.box(0.03, 0.5, 14, 0.94, 0.07, 28, faceColors('#1d1530', 0.1))
    p.faceY(0.03, 0.57, 42)
    const W = 0.94 * 32
    const H = 28
    const tube = (draw: () => void, color: string, width: number) => {
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.shadowColor = color
        ctx.shadowBlur = 8 * p.res
        ctx.strokeStyle = color
        ctx.lineWidth = width
        draw()
        ctx.stroke()
        ctx.shadowBlur = 0
        ctx.strokeStyle = '#fff0fc'
        ctx.lineWidth = width * 0.38
        draw()
        ctx.stroke()
    }
    // A magenta rim round the board, a big heart and LUCKY.
    tube(() => roundRect(ctx, 1.8, 1.8, W - 3.6, H - 3.6, 3), '#ff4fd8', 2.2)
    tube(() => {
        const x = W / 2
        const y = 9.5
        const s = 5.6
        ctx.beginPath()
        ctx.moveTo(x, y + s * 0.95)
        ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35)
        ctx.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.95)
    }, '#ff4fd8', 3.6)
    ctx.font = '8.5px "Lilita One", "Fredoka", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = '#7df9ff'
    ctx.shadowBlur = 6 * p.res
    ctx.strokeStyle = '#7df9ff'
    ctx.lineWidth = 2.2
    ctx.lineJoin = 'round'
    ctx.strokeText('LUCKY', W / 2, H - 7.6, W - 7)
    ctx.shadowBlur = 0
    ctx.fillStyle = '#e9feff'
    ctx.fillText('LUCKY', W / 2, H - 7.6, W - 7)
    p.reset()
}

// ── specials ───────────────────────────────────────────────────────────────

/** A dark velvet plinth with gold trim: what every small special stands on. */
function plinth(p: Painter, x: number, y: number, w: number, d: number, h: number) {
    p.box(x - 0.04, y - 0.04, 0, w + 0.08, d + 0.08, 5, faceColors('#3a2346', 0.12))
    p.box(x, y, 5, w, d, h - 9, faceColors('#5b2a4e', 0.14))
    p.box(x - 0.01, y - 0.01, 9, w + 0.02, d + 0.02, 2, gold(), { lineWidth: 1, shine: false })
    p.box(x - 0.05, y - 0.05, h - 4, w + 0.1, d + 0.1, 4, gold())
}

function drawGoldenStatue(p: Painter) {
    const { ctx } = p
    p.shadow([[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]], 6, 0.4, 0)
    plinth(p, 0.2, 0.2, 0.6, 0.6, 26)
    // A golden lucky cat, paw raised.
    const [x, y] = p.pt(0.5, 0.5, 26)
    p.reset()
    const g = goldGradient(ctx, x - 12, y - 52, x + 12, y)
    // Raised paw (behind the head).
    inked(ctx, x + 10.5, y - 38, 3.6, 6.5, g, 0.25)
    // Body, head, ears.
    inked(ctx, x, y - 12, 11.5, 12, g)
    for (const side of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(x + side * 9.5, y - 33)
        ctx.lineTo(x + side * 8, y - 46)
        ctx.lineTo(x + side * 2, y - 39)
        ctx.closePath()
        ctx.fillStyle = g
        ctx.strokeStyle = INK
        ctx.lineWidth = 1.5
        ctx.lineJoin = 'round'
        ctx.fill()
        ctx.stroke()
    }
    inked(ctx, x, y - 31, 11, 9.5, g)
    // Face.
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.3
    ctx.lineCap = 'round'
    for (const side of [-1, 1]) {
        ctx.beginPath()
        ctx.arc(x + side * 4, y - 31.5, 2, Math.PI * 1.1, Math.PI * 1.9)
        ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(x - 1.6, y - 27.6)
    ctx.quadraticCurveTo(x, y - 26.2, x + 1.6, y - 27.6)
    ctx.stroke()
    // A thin gold collar under the chin with a red bell, and a big coin in its paws.
    ctx.strokeStyle = INK
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(x, y - 31, 10.2, Math.PI * 0.33, Math.PI * 0.67)
    ctx.stroke()
    ctx.strokeStyle = PAL.goldDark
    ctx.lineWidth = 1.5
    ctx.stroke()
    inked(ctx, x, y - 20, 1.9, 1.9, '#e11d48', 0, 1)
    inked(ctx, x, y - 11, 6.5, 7.5, goldGradient(ctx, x - 6, y - 18, x + 6, y - 4), 0, 1.3)
    p.text('P', x, y - 10.5, 9, PAL.goldDark)
    // Shine.
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.beginPath()
    ctx.ellipse(x - 5, y - 36, 2.6, 1.4, -0.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(x - 7, y - 17, 1.6, 3.2, 0.3, 0, Math.PI * 2)
    ctx.fill()
}

function drawJackpotSign(p: Painter) {
    const { ctx } = p
    p.shadow([[0.1, 0.35], [1.9, 0.35], [1.9, 0.75], [0.1, 0.75]], 6, 0.38, 0)
    // Two gold posts on dark feet.
    for (const gx of [0.3, 1.62]) {
        p.box(gx - 0.06, 0.43, 0, 0.2, 0.2, 4, faceColors('#3a2346', 0.12), { lineWidth: 1 })
        p.box(gx, 0.49, 4, 0.08, 0.08, 36, gold(), { lineWidth: 1, shine: false })
    }
    // The board.
    p.box(0.05, 0.4, 38, 1.9, 0.14, 58, faceColors('#b3122f', 0.14))
    p.faceY(0.05, 0.54, 96)
    const W = 1.9 * 32
    const H = 58
    roundRect(ctx, 1.5, 1.5, W - 3, H - 3, 4)
    ctx.fillStyle = goldGradient(ctx, 0, 0, 0, H)
    ctx.fill()
    roundRect(ctx, 6, 6, W - 12, H - 12, 3)
    const red = ctx.createLinearGradient(0, 6, 0, H - 6)
    red.addColorStop(0, '#e0233f')
    red.addColorStop(1, '#8c0f26')
    ctx.fillStyle = red
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1
    ctx.stroke()
    p.text('JACKPOT', W / 2, 18, 12.5, PAL.goldLight, { stroke: INK, strokeWidth: 3, maxWidth: W - 16 })
    p.text('777', W / 2, 37, 15, '#ffffff', { stroke: '#7a0c20', strokeWidth: 3.4 })
    // Bulbs round the edge (they twinkle as sprites on the floor; these are the sockets).
    ctx.fillStyle = '#fff1c4'
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.8
    const bulb = (u: number, v: number) => {
        ctx.beginPath()
        ctx.arc(u, v, 1.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
    }
    for (let u = 3; u <= W - 3; u += 9) {
        bulb(u, 3)
        bulb(u, H - 3)
    }
    for (let v = 12; v < H - 3; v += 9) {
        bulb(3, v)
        bulb(W - 3, v)
    }
    p.reset()
    // A gold star on top.
    const [sx, sy] = p.pt(1, 0.47, 104)
    p.reset()
    star(ctx, sx, sy - 2, 8, goldGradient(ctx, sx - 8, sy - 10, sx + 8, sy + 6))
}

function drawAquarium(p: Painter) {
    const { ctx } = p
    p.shadow([[0, 0.1], [2, 0.1], [2, 0.95], [0, 0.95]], 7, 0.4, 0)
    // Cabinet with gold trim.
    p.box(0.04, 0.14, 0, 1.92, 0.78, 22, faceColors('#3a2346', 0.12))
    p.box(0.02, 0.12, 22, 1.96, 0.82, 3, gold())
    // The tank: water inside glass.
    const water: PrismColors = { top: '#8fdcf7', left: '#2f9fd6', right: '#1f78b0' }
    p.box(0.08, 0.18, 25, 1.84, 0.7, 42, water)
    // Front glass: sand, weed, fish (and a little shark), bubbles.
    p.faceY(0.08, 0.88, 67)
    const W = 1.84 * 32
    const H = 42
    const deep = ctx.createLinearGradient(0, 0, 0, H)
    deep.addColorStop(0, '#5cc6ef')
    deep.addColorStop(1, '#1f7fb8')
    ctx.fillStyle = deep
    ctx.fillRect(0.6, 0.6, W - 1.2, H - 1.2)
    ctx.fillStyle = PAL.sand
    ctx.beginPath()
    ctx.moveTo(0.6, H - 6)
    ctx.quadraticCurveTo(W * 0.3, H - 9, W * 0.55, H - 6)
    ctx.quadraticCurveTo(W * 0.8, H - 3, W - 0.6, H - 7)
    ctx.lineTo(W - 0.6, H - 0.6)
    ctx.lineTo(0.6, H - 0.6)
    ctx.closePath()
    ctx.fill()
    ctx.lineCap = 'round'
    for (const [u, hgt] of [[6, 20], [10, 14], [46, 24], [51, 16]] as const) {
        ctx.strokeStyle = PAL.leafDark
        ctx.lineWidth = 2.4
        ctx.beginPath()
        ctx.moveTo(u, H - 5)
        ctx.bezierCurveTo(u - 3, H - 5 - hgt * 0.35, u + 3, H - 5 - hgt * 0.65, u - 1, H - 5 - hgt)
        ctx.stroke()
    }
    const fish = (u: number, v: number, s: number, body: string, dir: number) => {
        ctx.save()
        ctx.translate(u, v)
        ctx.scale(dir * s, s)
        ctx.beginPath()
        ctx.moveTo(-4, 0)
        ctx.lineTo(-8, -3.5)
        ctx.lineTo(-8, 3.5)
        ctx.closePath()
        ctx.fillStyle = body
        ctx.strokeStyle = INK
        ctx.lineWidth = 0.9
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.ellipse(0, 0, 5, 3.2, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = INK
        ctx.beginPath()
        ctx.arc(2.6, -0.8, 0.8, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
    }
    fish(17, 15, 1, '#ff8a3d', 1)
    fish(38, 25, 0.85, '#ffd23f', -1)
    fish(26, 31, 0.7, '#ff6fa5', 1)
    // The shark.
    ctx.save()
    ctx.translate(40, 11)
    ctx.beginPath()
    ctx.moveTo(-10, 0)
    ctx.quadraticCurveTo(-2, -5, 8, -1)
    ctx.lineTo(11, 0)
    ctx.lineTo(8, 1.5)
    ctx.quadraticCurveTo(-2, 4, -10, 0)
    ctx.moveTo(-9, 0)
    ctx.lineTo(-14, -4)
    ctx.lineTo(-13, 3)
    ctx.closePath()
    ctx.fillStyle = '#9aa3c2'
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.9
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-2, -3.4)
    ctx.lineTo(1, -8)
    ctx.lineTo(3, -2.6)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'
    ctx.lineWidth = 0.8
    for (const [u, v, r] of [[12, 8, 1.6], [14, 4, 1.1], [30, 12, 1.3], [31, 6, 0.9], [50, 9, 1.4]] as const) {
        ctx.beginPath()
        ctx.arc(u, v, r, 0, Math.PI * 2)
        ctx.stroke()
    }
    // Glass glints.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(4, 30)
    ctx.lineTo(16, 4)
    ctx.moveTo(10, 34)
    ctx.lineTo(20, 13)
    ctx.stroke()
    p.reset()
    // A dark lid on a thin gold band, a gold line round its top.
    p.box(0.05, 0.15, 66, 1.9, 0.76, 2, gold(), { lineWidth: 1, shine: false })
    p.box(0.06, 0.16, 68, 1.88, 0.74, 4, faceColors('#3a2346', 0.1), { lineWidth: 1.2 })
    p.polyPath([[0.12, 0.22], [1.88, 0.22], [1.88, 0.84], [0.12, 0.84]], 72)
    ctx.strokeStyle = PAL.gold
    ctx.lineWidth = 1.3
    ctx.stroke()
}

interface PianoLook {
    lacquer: PrismColors
    trim: PrismColors | null
    keys: string
    lid: string
    /** The lid's edge seen below its top. */
    under: string
    /** How far the lid's curved side is propped up (px). */
    lidZ: number
    /** What it stands on (a stage), px. */
    z0: number
}

function drawPiano(p: Painter, look: PianoLook) {
    const { ctx } = p
    const { lacquer, trim, z0 } = look
    if (!z0) p.shadow([[0.1, 0.1], [1.9, 0.1], [1.9, 1.9], [0.1, 1.9]], 7, 0.38)
    const legs = trim ?? lacquer
    p.box(0.25, 0.25, z0, 0.07, 0.07, 20, legs, { lineWidth: 1 })
    p.box(1.6, 0.4, z0, 0.07, 0.07, 20, legs, { lineWidth: 1 })
    p.box(0.4, 1.5, z0, 0.07, 0.07, 20, legs, { lineWidth: 1 })
    const body: [number, number][] = [[0.1, 0.1], [1.2, 0.1], [1.85, 0.7], [1.85, 1.3], [0.1, 1.65]]
    p.prism(body, z0 + 20, 12, lacquer)
    if (trim) p.prism(body, z0 + 30.5, 2, trim, { lineWidth: 1, shine: false, noTop: true })
    p.box(0.15, 1.6, z0 + 22, 1.1, 0.22, 6, faceColors(look.keys), { lineWidth: 1 })
    p.faceY(0.15, 1.82, z0 + 28)
    ctx.fillStyle = '#25202f'
    for (let i = 0; i < 12; i++) ctx.fillRect(2 + i * 2.9, 0, 1.4, 3.2)
    p.reset()
    // The lid: the body's own shape, hinged on its straight left side and propped up on the curved one.
    const top = z0 + 32.5
    const hinge = 0.1
    const reach = 1.75
    const lid = body.map(([gx, gy]) => {
        const d = gx - hinge
        return p.pt(hinge + d * 0.93, gy, top + 1.5 + (d / reach) * look.lidZ)
    })
    const shade = body.map(([gx, gy]) => p.pt(gx, gy, top))
    const [sx, sy] = p.pt(1.45, 0.85, top)
    const [ex, ey] = p.pt(hinge + 1.35 * 0.93, 0.85, top + 1.5 + (1.35 / reach) * look.lidZ)
    p.reset()
    const poly = (pts: [number, number][], dy = 0) => {
        ctx.beginPath()
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + dy) : ctx.moveTo(x, y + dy)))
        ctx.closePath()
    }
    // Its shadow on the body, the prop stick, the lid's edge, then its top.
    poly(shade)
    ctx.fillStyle = 'rgba(36, 23, 46, 0.12)'
    ctx.fill()
    ctx.lineCap = 'round'
    ctx.strokeStyle = INK
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(ex, ey)
    ctx.stroke()
    ctx.strokeStyle = trim ? PAL.gold : '#5a4e66'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.lineJoin = 'round'
    poly(lid, 3)
    ctx.fillStyle = look.under
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.6
    ctx.fill()
    ctx.stroke()
    poly(lid)
    ctx.fillStyle = look.lid
    ctx.fill()
    ctx.stroke()
    if (trim) {
        // A gold line just inside the lid's rim.
        const cx = lid.reduce((t, q) => t + q[0], 0) / lid.length
        const cy = lid.reduce((t, q) => t + q[1], 0) / lid.length
        poly(lid.map(([x, y]) => [cx + (x - cx) * 0.86, cy + (y - cy) * 0.86] as [number, number]))
        ctx.strokeStyle = PAL.gold
        ctx.lineWidth = 1.4
        ctx.stroke()
    }
}

function drawGrandPiano(p: Painter) {
    const { ctx } = p
    // A raised velvet stage with a wide gold rim, the white piano with its velvet bench, and music in the air.
    const stage = roundRectPoly(0.02, 0.02, 1.96, 1.96, 0.5)
    p.shadow(stage, 7, 0.4, 0.02)
    p.prism(stage, 0, 7, faceColors('#5b2a4e', 0.14))
    p.flat(stage, 7, PAL.gold, INK, 1.2)
    p.flat(roundRectPoly(0.16, 0.16, 1.68, 1.68, 0.4), 7, '#7a2f5e', darken(PAL.gold, 0.3), 1)
    drawPiano(p, { lacquer: faceColors('#f7f2e8', 0.06), trim: gold(), keys: '#fffdf6', lid: '#fbf7ef', under: '#cfc5da', lidZ: 22, z0: 7 })
    // The bench.
    for (const [gx, gy] of [[0.46, 1.86], [0.96, 1.86], [0.46, 1.94], [0.96, 1.94]] as const) p.box(gx, gy, 7, 0.04, 0.04, 8, gold(), { lineWidth: 0.8, shine: false })
    p.box(0.42, 1.84, 15, 0.62, 0.14, 4, faceColors(PAL.velvet, 0.18), { lineWidth: 1.2 })
    const [x, y] = p.pt(1.4, 0.5, 72)
    p.reset()
    note(ctx, x - 4, y + 2, 1, PAL.gold)
    note(ctx, x + 12, y - 6, 0.8, PAL.goldLight)
}

function drawGrandFountain(p: Painter) {
    const { ctx } = p
    const marble = faceColors(MARBLE, 0.08)
    p.shadow(circlePoly(1, 1, 0.98, 24), 9, 0.4, 0)
    p.cylinder(1, 1, 0, 0.95, 13, marble)
    p.cylinder(1, 1, 12, 0.99, 4, gold())
    p.flat(circlePoly(1, 1, 0.84, 28), 16, PAL.water)
    p.flat(circlePoly(1, 1, 0.5, 24), 16, lighten(PAL.water, 0.18))
    p.top(1, 1, 16)
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 1.2
    for (const r of [9, 16, 22]) {
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.stroke()
    }
    p.reset()
    // Water falling from the upper bowl into the basin (behind the column first).
    const arc = (a: number) => {
        const [x0, y0] = p.pt(1 + Math.cos(a) * 0.48, 1 + Math.sin(a) * 0.48, 46)
        const [x1, y1] = p.pt(1 + Math.cos(a) * 0.78, 1 + Math.sin(a) * 0.78, 17)
        const [cx, cy] = p.pt(1 + Math.cos(a) * 0.8, 1 + Math.sin(a) * 0.8, 46)
        ctx.lineCap = 'round'
        ctx.strokeStyle = rgba('#1f78b0', 0.55)
        ctx.lineWidth = 3.4
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.quadraticCurveTo(cx, cy, x1, y1)
        ctx.stroke()
        ctx.strokeStyle = '#d6f3ff'
        ctx.lineWidth = 1.8
        ctx.stroke()
    }
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8
        if (Math.cos(a) + Math.sin(a) < 0) arc(a)
    }
    p.cylinder(1, 1, 16, 0.15, 26, marble)
    p.cylinder(1, 1, 42, 0.5, 4, marble)
    p.cylinder(1, 1, 45, 0.55, 3, gold(), { lineWidth: 1.2 })
    p.flat(circlePoly(1, 1, 0.42, 22), 48, lighten(PAL.water, 0.15))
    p.cylinder(1, 1, 48, 0.08, 14, gold(), { lineWidth: 1 })
    p.cylinder(1, 1, 62, 0.24, 2, marble, { lineWidth: 1.2 })
    p.cylinder(1, 1, 64, 0.27, 2.5, gold(), { lineWidth: 1.1 })
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8
        if (Math.cos(a) + Math.sin(a) >= 0) arc(a)
    }
    // A gold star crowns it, with a jet of spray.
    const [x, y] = p.pt(1, 1, 68)
    p.reset()
    ctx.strokeStyle = '#d6f3ff'
    ctx.lineWidth = 1.6
    ctx.lineCap = 'round'
    for (const dx of [-7, 7]) {
        ctx.beginPath()
        ctx.moveTo(x, y - 8)
        ctx.quadraticCurveTo(x + dx * 0.6, y - 18, x + dx, y - 4)
        ctx.stroke()
    }
    inked(ctx, x, y - 4, 3.4, 3.4, goldGradient(ctx, x - 3, y - 7, x + 3, y - 1), 0, 1.2)
    star(ctx, x, y - 14, 8.5, goldGradient(ctx, x - 8, y - 22, x + 8, y - 6))
}

function drawRedCarpet(p: Painter) {
    const { ctx } = p
    // A plush red runner with gold edging, gold tassels on its ends and VIP stitched in gold.
    const runner = roundRectPoly(0.04, 0.12, 1.92, 0.76, 0.06)
    p.prism(runner, 0, 2, { top: '#c8102e', left: '#9e0c24', right: '#7a0a1c' }, { lineWidth: 1.4 })
    p.top(0, 0, 2)
    const red = ctx.createLinearGradient(0, 4, 0, 28)
    red.addColorStop(0, '#e0233f')
    red.addColorStop(1, '#b00f2a')
    ctx.fillStyle = red
    ctx.fillRect(3, 6, 58, 16)
    ctx.fillStyle = PAL.gold
    ctx.fillRect(2, 4.6, 60, 1.8)
    ctx.fillRect(2, 21.6, 60, 1.8)
    ctx.strokeStyle = 'rgba(255, 233, 166, 0.55)'
    ctx.lineWidth = 0.5
    ctx.setLineDash([1.4, 1.4])
    ctx.strokeRect(4.5, 8, 55, 12)
    ctx.setLineDash([])
    // Tassels on both ends.
    ctx.fillStyle = PAL.gold
    for (const u of [0.6, 63.4]) {
        for (let v = 6.5; v <= 21.5; v += 3) {
            ctx.beginPath()
            ctx.arc(u, v, 0.9, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    ctx.font = '9px "Lilita One", "Fredoka", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 2
    ctx.strokeStyle = '#7a0a1c'
    ctx.strokeText('VIP', 32, 14.4)
    ctx.fillStyle = PAL.gold
    ctx.fillText('VIP', 32, 14.4)
    for (const u of [16, 48]) star(ctx, u, 14, 2.6, PAL.gold, 0.45)
    p.reset()
}

function drawDiamondDisplay(p: Painter) {
    const { ctx } = p
    p.shadow([[0.12, 0.12], [0.88, 0.12], [0.88, 0.88], [0.12, 0.88]], 6, 0.4, 0)
    plinth(p, 0.22, 0.22, 0.56, 0.56, 32)
    // A velvet cushion, and the diamond on it.
    const [x, y] = p.pt(0.5, 0.5, 32)
    p.reset()
    inked(ctx, x, y - 3, 11, 4.5, '#7a2f5e', 0, 1.4)
    inked(ctx, x, y - 4.5, 9, 3.4, '#a63d7a', 0, 0)
    const gy = y - 10
    const gem = (draw: () => void, fill: string | CanvasGradient) => {
        draw()
        ctx.fillStyle = fill
        ctx.fill()
        ctx.strokeStyle = INK
        ctx.lineWidth = 1.3
        ctx.lineJoin = 'round'
        ctx.stroke()
    }
    // Pavilion (point down), then the crown with its table.
    const ice = ctx.createLinearGradient(x - 9, gy - 8, x + 9, gy + 8)
    ice.addColorStop(0, '#ffffff')
    ice.addColorStop(0.45, '#bfefff')
    ice.addColorStop(1, '#6fc8ef')
    gem(() => {
        ctx.beginPath()
        ctx.moveTo(x - 9, gy - 3)
        ctx.lineTo(x + 9, gy - 3)
        ctx.lineTo(x, gy + 8)
        ctx.closePath()
    }, ice)
    gem(() => {
        ctx.beginPath()
        ctx.moveTo(x - 9, gy - 3)
        ctx.lineTo(x - 5, gy - 9)
        ctx.lineTo(x + 5, gy - 9)
        ctx.lineTo(x + 9, gy - 3)
        ctx.closePath()
    }, '#e6f9ff')
    ctx.strokeStyle = 'rgba(42, 27, 48, 0.55)'
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(x - 5, gy - 9)
    ctx.lineTo(x - 3, gy - 3)
    ctx.lineTo(x, gy + 8)
    ctx.lineTo(x + 3, gy - 3)
    ctx.lineTo(x + 5, gy - 9)
    ctx.moveTo(x - 3, gy - 3)
    ctx.lineTo(x, gy - 9)
    ctx.lineTo(x + 3, gy - 3)
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(x - 6, gy - 4)
    ctx.lineTo(x - 4, gy - 8)
    ctx.lineTo(x - 2.5, gy - 4)
    ctx.closePath()
    ctx.fill()
    // The glass case: faint panes, bright edges, a gold cap.
    const lo = 33
    const hi = 60
    const a = 0.27
    const b = 0.73
    const glass = (pts: [number, number, number][]) => {
        ctx.beginPath()
        pts.forEach(([gx2, gy2, z], i) => {
            const [px, py] = p.pt(gx2, gy2, z)
            if (i) ctx.lineTo(px, py)
            else ctx.moveTo(px, py)
        })
        ctx.closePath()
        ctx.fillStyle = 'rgba(200, 235, 255, 0.16)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
        ctx.lineWidth = 1
        ctx.stroke()
    }
    glass([[a, b, lo], [b, b, lo], [b, b, hi], [a, b, hi]])
    glass([[b, a, lo], [b, b, lo], [b, b, hi], [b, a, hi]])
    // Glints on the front pane.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.lineWidth = 1.6
    const [g1x, g1y] = p.pt(a + 0.06, b, hi - 6)
    const [g2x, g2y] = p.pt(a + 0.16, b, lo + 10)
    ctx.beginPath()
    ctx.moveTo(g1x, g1y)
    ctx.lineTo(g2x, g2y)
    ctx.stroke()
    p.box(a - 0.03, a - 0.03, hi, b - a + 0.06, b - a + 0.06, 3, gold(), { lineWidth: 1.2 })
    const [kx, ky] = p.pt(0.5, 0.5, hi + 3)
    p.reset()
    inked(ctx, kx, ky - 2.5, 2.4, 2.4, goldGradient(ctx, kx - 2, ky - 5, kx + 2, ky), 0, 1.1)
}

function drawShowcaseCar(p: Painter) {
    const { ctx } = p
    // A round turntable with a gold rim and a ring of lights.
    p.shadow(circlePoly(1, 1, 0.98, 28), 8, 0.4, 0)
    p.cylinder(1, 1, 0, 0.97, 5, faceColors('#2a2140', 0.12))
    p.cylinder(1, 1, 5, 0.97, 2, gold(), { lineWidth: 1.2 })
    p.flat(circlePoly(1, 1, 0.86, 32), 7, '#3a2f52')
    p.top(1, 1, 7)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
    ctx.lineWidth = 1
    for (const r of [12, 20]) {
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.stroke()
    }
    p.reset()
    // The car, nose toward +gx: red body, gold stripe, dark glass, gold rims.
    const red: PrismColors = { top: '#ff4a5e', left: '#e0233f', right: '#a8172f' }
    const body = roundRectPoly(0.22, 0.62, 1.56, 0.76, 0.22)
    p.prism(body, 10, 9, red, { lineWidth: 1.6 })
    // Wheels on the near side (behind the body's lower edge) and the nose.
    const wheel = (gx: number) => {
        const [wx, wy] = p.pt(gx, 1.38, 10)
        p.reset()
        inked(ctx, wx, wy, 5.4, 5.6, '#25202f', 0, 1.2)
        inked(ctx, wx, wy, 2.6, 2.8, goldGradient(ctx, wx - 3, wy - 3, wx + 3, wy + 3), 0, 0.8)
    }
    wheel(0.55)
    wheel(1.45)
    p.faceY(0.22, 1.38, 19)
    ctx.fillStyle = PAL.gold
    ctx.fillRect(4, 3.5, 1.56 * 32 - 8, 2)
    p.reset()
    const cabin = roundRectPoly(0.62, 0.74, 0.7, 0.52, 0.14)
    p.prism(cabin, 19, 7, { top: '#e0233f', left: '#3b5b8c', right: '#2b4268' }, { lineWidth: 1.4 })
    p.prism(roundRectPoly(0.66, 0.78, 0.62, 0.44, 0.12), 26, 1.5, red, { lineWidth: 1.2 })
    // Window glints, headlights on the nose, a spoiler.
    p.faceY(0.62, 1.26, 26)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(6, 6)
    ctx.lineTo(10, 1.5)
    ctx.moveTo(10, 6)
    ctx.lineTo(13, 3)
    ctx.stroke()
    p.reset()
    for (const gy2 of [0.78, 1.22]) {
        const [hx, hy] = p.pt(1.78, gy2, 15)
        p.reset()
        inked(ctx, hx, hy, 2.2, 1.7, '#fff6c8', 0, 0.9)
    }
    p.box(0.2, 0.7, 19, 0.08, 0.6, 4, faceColors('#25202f', 0.12), { lineWidth: 1 })
    p.box(0.16, 0.66, 23, 0.14, 0.68, 1.5, red, { lineWidth: 1 })
    // Shine along the bonnet.
    const [s1x, s1y] = p.pt(1.4, 0.8, 19)
    const [s2x, s2y] = p.pt(1.68, 1.1, 19)
    p.reset()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)'
    ctx.lineWidth = 1.6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(s1x, s1y)
    ctx.lineTo(s2x, s2y)
    ctx.stroke()
}

function drawVipBooth(p: Painter) {
    const { ctx } = p
    p.shadow([[0, 0.04], [2, 0.04], [2, 1], [0, 1]], 7, 0.38, 0)
    const velvet: PrismColors = { top: '#d63352', left: '#b3243f', right: '#86182f' }
    // A tufted velvet banquette: a high back with rounded ends, arms, and a deep seat.
    p.prism(roundRectPoly(0.06, 0.06, 1.88, 0.26, 0.12), 0, 34, velvet, { lineWidth: 1.6 })
    p.faceY(0.18, 0.32, 32)
    ctx.fillStyle = 'rgba(60, 8, 22, 0.55)'
    for (let u = 6; u < 1.64 * 32; u += 9) {
        for (const v of [8, 18]) {
            ctx.beginPath()
            ctx.arc(u + (v === 18 ? 4.5 : 0), v, 1.1, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    p.reset()
    p.prism(roundRectPoly(0.04, 0.04, 1.92, 0.3, 0.13), 34, 2.5, gold(), { lineWidth: 1.2 })
    p.box(0.08, 0.3, 0, 1.84, 0.34, 12, velvet)
    p.box(0.08, 0.62, 2, 1.84, 0.03, 2, gold(), { lineWidth: 0.8, shine: false })
    for (const gx of [0.04, 1.74]) p.prism(roundRectPoly(gx, 0.1, 0.22, 0.58, 0.08), 0, 20, velvet, { lineWidth: 1.4 })
    for (const gx of [0.04, 1.74]) p.prism(roundRectPoly(gx, 0.1, 0.22, 0.58, 0.08), 20, 2, gold(), { lineWidth: 1, shine: false })
    // A small round table with a candle and two glasses.
    p.cylinder(1, 0.8, 0, 0.12, 2, gold(), { lineWidth: 1 })
    p.cylinder(1, 0.8, 2, 0.04, 14, gold(), { lineWidth: 1, shine: false })
    p.cylinder(1, 0.8, 16, 0.2, 2.5, { top: '#2e2638', left: '#221b2b', right: '#17121e' }, { lineWidth: 1.2 })
    p.cylinder(1, 0.8, 16, 0.21, 1, gold(), { lineWidth: 0.8, shine: false, noTop: true })
    p.cylinder(1, 0.8, 18.5, 0.035, 7, faceColors(PAL.cream, 0.1), { lineWidth: 0.8 })
    const [fx, fy] = p.pt(1, 0.8, 26)
    const [ga, gb] = p.pt(0.88, 0.86, 18.5)
    const [gc, gd] = p.pt(1.12, 0.74, 18.5)
    p.reset()
    ctx.fillStyle = '#ffb84a'
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(fx, fy - 4.5)
    ctx.quadraticCurveTo(fx + 2.2, fy - 1, fx, fy + 0.5)
    ctx.quadraticCurveTo(fx - 2.2, fy - 1, fx, fy - 4.5)
    ctx.fill()
    ctx.stroke()
    for (const [x, y] of [[ga, gb], [gc, gd]] as const) {
        ctx.fillStyle = INK
        ctx.fillRect(x - 0.6, y - 4, 1.2, 4)
        ctx.fillStyle = '#ffe9a6'
        ctx.beginPath()
        ctx.moveTo(x - 2.4, y - 8)
        ctx.lineTo(x + 2.4, y - 8)
        ctx.lineTo(x, y - 4)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = INK
        ctx.lineWidth = 0.7
        ctx.stroke()
    }
}

function drawGoldSlot(p: Painter) {
    const { ctx } = p
    p.shadow([[0.12, 0.12], [0.88, 0.12], [0.88, 0.88], [0.12, 0.88]], 6, 0.4, 0)
    // A low velvet plinth with a gold plaque, the solid gold cabinet on it.
    p.box(0.1, 0.1, 0, 0.8, 0.8, 8, faceColors('#5b2a4e', 0.14))
    p.box(0.08, 0.08, 8, 0.84, 0.84, 2, gold(), { lineWidth: 1, shine: false })
    p.faceY(0.3, 0.9, 6)
    roundRect(ctx, 0, 0, 0.4 * 32, 4, 1)
    ctx.fillStyle = PAL.gold
    ctx.fill()
    p.reset()
    const g: PrismColors = { top: '#ffd25a', left: '#e9ac34', right: '#b8801f' }
    p.box(0.22, 0.28, 10, 0.56, 0.5, 46, g, { lineWidth: 1.6 })
    p.box(0.18, 0.62, 10, 0.64, 0.2, 16, g, { lineWidth: 1.4 })
    p.box(0.2, 0.3, 56, 0.6, 0.46, 9, { top: '#ffe08a', left: '#f2bd47', right: '#c48b25' }, { lineWidth: 1.4 })
    // The window with 777, on the front.
    p.faceY(0.22, 0.78, 50)
    roundRect(ctx, 2.5, 3, 0.56 * 32 - 5, 13, 2)
    ctx.fillStyle = '#2a1b30'
    ctx.fill()
    for (let i = 0; i < 3; i++) {
        const u = 4 + i * 4.3
        ctx.fillStyle = '#fff8ea'
        ctx.fillRect(u, 4.5, 3.6, 10)
        p.text('7', u + 1.8, 9.8, 7, '#e11d48')
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fillRect(3, 3.5, 12, 1.5)
    // A coin tray and a glint line.
    roundRect(ctx, 4, 24, 0.56 * 32 - 8, 4, 1.5)
    ctx.fillStyle = '#8a5a14'
    ctx.fill()
    p.reset()
    // The lever on its right side.
    const [lx, ly] = p.pt(0.78, 0.5, 34)
    p.reset()
    ctx.lineCap = 'round'
    ctx.strokeStyle = INK
    ctx.lineWidth = 3.2
    ctx.beginPath()
    ctx.moveTo(lx, ly)
    ctx.lineTo(lx + 5, ly - 14)
    ctx.stroke()
    ctx.strokeStyle = PAL.gold
    ctx.lineWidth = 1.6
    ctx.stroke()
    inked(ctx, lx + 5, ly - 15, 2.6, 2.6, '#e11d48', 0, 1.1)
    // A crown of a star on top.
    const [sx, sy] = p.pt(0.5, 0.53, 65)
    p.reset()
    star(ctx, sx, sy - 5, 6.5, goldGradient(ctx, sx - 6, sy - 11, sx + 6, sy + 1))
}

function drawIceSculpture(p: Painter) {
    const { ctx } = p
    p.shadow(circlePoly(0.5, 0.5, 0.34, 16), 6, 0.35, 0)
    // A silver pedestal and tray.
    const silver = faceColors('#c9d1e6', 0.2)
    p.cylinder(0.5, 0.5, 0, 0.26, 4, silver)
    p.cylinder(0.5, 0.5, 4, 0.12, 16, silver, { lineWidth: 1.2 })
    p.cylinder(0.5, 0.5, 20, 0.36, 2.5, silver)
    p.flat(circlePoly(0.5, 0.5, 0.3, 24), 22.5, '#dfe9f7')
    const [x, y] = p.pt(0.5, 0.5, 23)
    p.reset()
    // The swan: translucent ice, a blue rim and white highlights.
    const ice = ctx.createLinearGradient(x - 12, y - 40, x + 12, y)
    ice.addColorStop(0, 'rgba(240, 252, 255, 0.95)')
    ice.addColorStop(0.5, 'rgba(178, 226, 248, 0.85)')
    ice.addColorStop(1, 'rgba(120, 190, 232, 0.85)')
    const shape = (draw: () => void) => {
        draw()
        ctx.fillStyle = ice
        ctx.fill()
        ctx.strokeStyle = '#3d7fb8'
        ctx.lineWidth = 1.3
        ctx.lineJoin = 'round'
        ctx.stroke()
    }
    // Neck and head (behind the body's front).
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#3d7fb8'
    ctx.lineWidth = 6.4
    const neck = () => {
        ctx.beginPath()
        ctx.moveTo(x - 3, y - 8)
        ctx.bezierCurveTo(x - 9, y - 18, x + 3, y - 26, x - 4, y - 34)
    }
    neck()
    ctx.stroke()
    ctx.strokeStyle = 'rgba(214, 240, 252, 0.95)'
    ctx.lineWidth = 4
    neck()
    ctx.stroke()
    shape(() => {
        ctx.beginPath()
        ctx.ellipse(x - 4.5, y - 35, 3.4, 2.8, -0.3, 0, Math.PI * 2)
    })
    ctx.fillStyle = '#ffb84a'
    ctx.beginPath()
    ctx.moveTo(x - 7.5, y - 35.5)
    ctx.lineTo(x - 11, y - 34)
    ctx.lineTo(x - 7.5, y - 33.5)
    ctx.fill()
    // Body and a raised wing.
    shape(() => {
        ctx.beginPath()
        ctx.ellipse(x + 1, y - 6, 10.5, 6, 0, 0, Math.PI * 2)
    })
    shape(() => {
        ctx.beginPath()
        ctx.moveTo(x - 2, y - 7)
        ctx.quadraticCurveTo(x + 2, y - 24, x + 13, y - 22)
        ctx.quadraticCurveTo(x + 10, y - 12, x + 9, y - 5)
        ctx.closePath()
    })
    ctx.strokeStyle = 'rgba(61, 127, 184, 0.6)'
    ctx.lineWidth = 0.8
    for (const k of [0.3, 0.55, 0.8]) {
        ctx.beginPath()
        ctx.moveTo(x + 1 + k * 6, y - 8)
        ctx.lineTo(x + 2 + k * 10, y - 19 + k * 4)
        ctx.stroke()
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.beginPath()
    ctx.ellipse(x - 3, y - 8, 3.4, 1.2, -0.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(x - 6, y - 22, 0.9, 3, 0.4, 0, Math.PI * 2)
    ctx.fill()
    // Meltwater drips on the tray.
    ctx.fillStyle = 'rgba(120, 200, 240, 0.85)'
    for (const [dx, dy] of [[-12, 1], [10, 2], [-5, 3]] as const) {
        ctx.beginPath()
        ctx.ellipse(x + dx, y + dy, 2, 0.9, 0, 0, Math.PI * 2)
        ctx.fill()
    }
}

function drawChampagneBar(p: Painter) {
    const { ctx } = p
    p.shadow([[0, 0], [3, 0], [3, 1], [0, 1]], 7, 0.38)
    // The back bar: a dark wood cabinet from the floor, a mirror between gold uprights,
    // two shelves of champagne in gold foil, and a CHAMPAGNE plaque on top.
    const wood = faceColors('#4a2a3a', 0.12)
    p.box(0.06, 0.0, 0, 2.88, 0.26, 32, wood)
    p.box(0.05, 0.0, 30, 2.9, 0.27, 2, gold(), { lineWidth: 1, shine: false })
    p.box(0.12, 0.0, 32, 2.76, 0.05, 32, { top: '#c9d6e8', left: '#9fb3cc', right: '#7d8fab' }, { lineWidth: 1 })
    p.faceY(0.12, 0.05, 64)
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 2.4
    for (const u of [10, 34, 58]) {
        ctx.beginPath()
        ctx.moveTo(u, 28)
        ctx.lineTo(u + 12, 4)
        ctx.stroke()
    }
    p.reset()
    for (const gx of [0.06, 2.86]) p.box(gx, 0.02, 32, 0.08, 0.1, 34, gold(), { lineWidth: 1 })
    for (const z of [32, 47]) {
        p.box(0.12, 0.05, z, 2.76, 0.18, 2.5, faceColors(PAL.woodDark), { lineWidth: 1 })
        for (let i = 0; i < 12; i++) {
            const gx = 0.26 + i * (2.48 / 11)
            p.cylinder(gx, 0.14, z + 2.5, 0.045, 9, faceColors('#24583a', 0.25), { lineWidth: 0.7 })
            p.cylinder(gx, 0.14, z + 11.5, 0.026, 3, gold(), { lineWidth: 0.5, shine: false })
        }
    }
    p.box(0.04, 0.0, 64, 2.92, 0.16, 3, gold(), { lineWidth: 1 })
    p.box(0.9, 0.02, 67, 1.2, 0.1, 12, gold())
    p.faceY(0.9, 0.12, 79)
    roundRect(ctx, 2, 2, 1.2 * 32 - 4, 8, 2)
    ctx.fillStyle = '#2a1b30'
    ctx.fill()
    p.text('CHAMPAGNE', 0.6 * 32, 6.2, 6.5, PAL.goldLight, { maxWidth: 1.2 * 32 - 8 })
    p.reset()
    // White marble counter with a gold band, a black marble top with a gold edge.
    p.box(0.05, 0.42, 0, 2.9, 0.5, 28, faceColors(MARBLE, 0.06))
    p.faceY(0.05, 0.92, 28)
    ctx.fillStyle = PAL.gold
    ctx.fillRect(0, 9, 2.9 * 32, 3)
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.6
    ctx.strokeRect(0, 9, 2.9 * 32, 3)
    for (let u = 10; u < 2.9 * 32 - 4; u += 15) {
        ctx.beginPath()
        ctx.moveTo(u, 15)
        ctx.lineTo(u + 3.5, 19)
        ctx.lineTo(u, 23)
        ctx.lineTo(u - 3.5, 19)
        ctx.closePath()
        ctx.fillStyle = PAL.gold
        ctx.fill()
        ctx.stroke()
    }
    p.reset()
    p.box(0.0, 0.38, 28, 3, 0.6, 2, gold(), { lineWidth: 1, shine: false })
    p.box(0.03, 0.41, 30, 2.94, 0.54, 2.5, { top: '#2e2638', left: '#221b2b', right: '#17121e' }, { lineWidth: 1.2 })
    p.top(0.03, 0.41, 32.5)
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 0.8
    for (const [u0, v0, u1, v1] of [[8, 3, 30, 14], [40, 2, 70, 15], [76, 4, 90, 12]] as const) {
        ctx.beginPath()
        ctx.moveTo(u0, v0)
        ctx.quadraticCurveTo((u0 + u1) / 2, v0 + 8, u1, v1)
        ctx.stroke()
    }
    p.reset()
    // Ice buckets with a bottle each.
    for (const gx of [0.45, 2.55]) {
        p.cylinder(gx, 0.68, 32.5, 0.15, 9, faceColors('#c9d1e6', 0.2), { lineWidth: 1.2 })
        const [bx, by] = p.pt(gx, 0.68, 41.5)
        p.reset()
        ctx.save()
        ctx.translate(bx, by)
        ctx.rotate(0.35)
        ctx.fillStyle = INK
        roundRect(ctx, -3.4, -15, 6.8, 16, 2.5)
        ctx.fill()
        ctx.fillStyle = '#24583a'
        roundRect(ctx, -2.4, -14, 4.8, 14, 2)
        ctx.fill()
        ctx.fillStyle = PAL.gold
        ctx.fillRect(-1.6, -19, 3.2, 6)
        ctx.restore()
    }
    // The champagne tower: coupes stacked 3-2-1, bubbling.
    const [tx, ty] = p.pt(1.5, 0.68, 32)
    p.reset()
    const coupe = (x: number, y: number) => {
        ctx.fillStyle = INK
        ctx.fillRect(x - 0.9, y - 6, 1.8, 6)
        ctx.beginPath()
        ctx.ellipse(x, y, 3.2, 1.2, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(x - 6.2, y - 9.5)
        ctx.lineTo(x + 6.2, y - 9.5)
        ctx.quadraticCurveTo(x + 5, y - 4.4, x, y - 4.6)
        ctx.quadraticCurveTo(x - 5, y - 4.4, x - 6.2, y - 9.5)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#ffe9a6'
        ctx.beginPath()
        ctx.moveTo(x - 4.8, y - 8.6)
        ctx.lineTo(x + 4.8, y - 8.6)
        ctx.quadraticCurveTo(x + 3.8, y - 5.6, x, y - 5.8)
        ctx.quadraticCurveTo(x - 3.8, y - 5.6, x - 4.8, y - 8.6)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#fff8e0'
        ctx.fillRect(x - 0.4, y - 5.2, 0.8, 4.6)
    }
    for (let row = 0; row < 3; row++) {
        const n = 3 - row
        for (let i = 0; i < n; i++) coupe(tx + (i - (n - 1) / 2) * 11, ty - row * 9.5)
    }
    ctx.fillStyle = '#ffffff'
    for (const [dx, dy] of [[-3, -33], [2, -37], [0, -41], [-8, -24], [9, -22]] as const) {
        ctx.beginPath()
        ctx.arc(tx + dx, ty + dy, 0.9, 0, Math.PI * 2)
        ctx.fill()
    }
}

/** Draw a decoration with its grid origin at the painter's origin. */
export function drawDecor(p: Painter, type: DecorType) {
    const kind = PLAIN[type]
    if (kind) {
        const { w, h } = decorSize(type)
        if (kind === 'piano') drawPiano(p, { lacquer: faceColors('#25202f', 0.12), trim: null, keys: '#f7f3ea', lid: '#3a3346', under: '#1d1826', lidZ: 30, z0: 0 })
        else if (kind === 'statue') drawMarbleStatue(p)
        else drawProp(p, kind, w, h, PAL.velvet)
        return
    }
    switch (type) {
        case 'flowers': return drawFlowers(p)
        case 'rug': return drawRug(p)
        case 'neon': return drawNeon(p)
        case 'golden-statue': return drawGoldenStatue(p)
        case 'jackpot-sign': return drawJackpotSign(p)
        case 'aquarium': return drawAquarium(p)
        case 'grand-piano': return drawGrandPiano(p)
        case 'grand-fountain': return drawGrandFountain(p)
        case 'champagne-bar': return drawChampagneBar(p)
        case 'red-carpet': return drawRedCarpet(p)
        case 'diamond-display': return drawDiamondDisplay(p)
        case 'showcase-car': return drawShowcaseCar(p)
        case 'vip-booth': return drawVipBooth(p)
        case 'gold-slot': return drawGoldSlot(p)
        case 'ice-sculpture': return drawIceSculpture(p)
    }
}

/** Canvas size and origin for a decoration's baked texture (world px). */
export function decorCanvas(type: DecorType): { width: number, height: number, ox: number, oy: number } {
    const { w, h } = decorSize(type)
    return footprintCanvas(w, h, decorHeight(type) + 14, 12)
}

// ── icons for the menus ────────────────────────────────────────────────────

const icons = new Map<string, Promise<string>>()

/**
 * A decoration drawn as the floor draws it, as a PNG data URL: `size` px
 * square (the art centred, fitted with a little air), transparent around it.
 * Cached per type and size. Shop cards and the storage tray use it as
 * `<img :src>`; specials get no frame here (the card adds its own).
 */
export function decorIcon(type: DecorType, size = 128): Promise<string> {
    const key = `${type}:${size}`
    let icon = icons.get(key)
    if (!icon) {
        icon = renderIcon(type, size)
        icons.set(key, icon)
        icon.catch(() => icons.delete(key))
    }
    return icon
}

async function renderIcon(type: DecorType, size: number): Promise<string> {
    // The jackpot sign has lettering: wait for the display font.
    await document.fonts?.load('16px "Lilita One"').catch(() => {})
    const res = 2
    const c = decorCanvas(type)
    const art = document.createElement('canvas')
    art.width = Math.ceil(c.width * res)
    art.height = Math.ceil(c.height * res)
    const ctx = art.getContext('2d')
    if (!ctx) throw new Error('decorIcon: no 2d canvas')
    drawDecor(new Painter(ctx, c.ox, c.oy, res), type)
    // Trim to the solid pixels (not the soft floor shadow), then fit into the square.
    const box = opaqueBox(ctx, art.width, art.height)
    const out = document.createElement('canvas')
    out.width = size
    out.height = size
    const octx = out.getContext('2d')
    if (!octx) throw new Error('decorIcon: no 2d canvas')
    if (box) {
        const pad = size * 0.07
        const avail = size - pad * 2
        const short = Math.min(box.w, box.h)
        const long = Math.max(box.w, box.h)
        let k = avail / long
        // Tall thin things (a lamp) and long flat ones (a bar) would end up slivers: zoom in
        // until the short side fills about half, cropping a little of the long side.
        if (short * k < size * 0.5) k = Math.min((size * 0.5) / short, (avail * (box.h > box.w ? 1.12 : 1.05)) / long)
        const w = box.w * k
        const h = box.h * k
        const x = (size - w) / 2
        // Tall ones keep their top (the shade, the leaves) and lose a bit of the foot.
        const y = h > avail ? pad : (size - h) / 2
        octx.imageSmoothingQuality = 'high'
        // A light rim first, so dark things (the piano, the neon board) stand off a dark card.
        octx.shadowColor = 'rgba(255, 240, 222, 0.75)'
        octx.shadowBlur = Math.max(2, size * 0.028)
        octx.drawImage(art, box.x, box.y, box.w, box.h, x, y, w, h)
        octx.shadowBlur = 0
        octx.shadowColor = 'transparent'
        octx.drawImage(art, box.x, box.y, box.w, box.h, x, y, w, h)
    }
    return out.toDataURL('image/png')
}

function opaqueBox(ctx: CanvasRenderingContext2D, w: number, h: number): { x: number, y: number, w: number, h: number } | null {
    const data = ctx.getImageData(0, 0, w, h).data
    let minX = w
    let minY = h
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3]! < 110) continue
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }
    }
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}
