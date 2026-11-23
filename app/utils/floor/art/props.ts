import { INK, Painter, circlePoly, darken, faceColors, lighten, mix, project, rgba, roundRect, type Pt } from '../iso'
import type { PropKind } from '../layout'
import { ARCHITECT_LOOK, CASHIER_LOOK, drawFigure } from './characters'
import { PAL } from './palette'

/**
 * Everything on the floor that is not a game: the cashier cage, the
 * architect's desk, furniture and decoration, signs and scaffolding.
 */

const gold = () => ({ top: PAL.goldLight, left: PAL.gold, right: PAL.goldDark })

// ── cashier cage (2×2) ─────────────────────────────────────────────────────

export const CAGE_HEIGHT = 92
/** Where the chip pile sits on the counter (local px), and the label anchor. */
export const CAGE_PILE = project(1.0, 1.55, 26)
export const CAGE_TOP = project(1.0, 1.0, 96)

export function drawCage(p: Painter, decor: number) {
    const { ctx } = p
    p.shadow([[0, 0], [2, 0], [2, 2], [0, 2]], 8, 0.4)
    const wall = decor >= 3 ? '#6b2a3a' : '#7a4a35'
    const trim = decor >= 3 ? gold() : faceColors(PAL.woodLight)
    // Back and side walls of the booth.
    p.box(0.04, 0.04, 0, 1.92, 0.16, 70, wall)
    p.box(0.04, 0.2, 0, 0.16, 1.2, 70, wall)
    // Shelves of chips on the back wall.
    p.faceY(0.2, 0.2, 60)
    for (let row = 0; row < 3; row++) {
        ctx.fillStyle = PAL.woodDark
        ctx.fillRect(4, 12 + row * 14, 50, 2.5)
        for (let i = 0; i < 8; i++) {
            ctx.fillStyle = [PAL.chip, '#3b82f6', '#16a34a', '#f59e0b'][(i + row) % 4]!
            roundRect(ctx, 5 + i * 6, 5 + row * 14, 5, 7, 1.5)
            ctx.fill()
        }
    }
    p.reset()
    // The cashier behind the counter.
    const [cx, cy] = p.pt(1.05, 0.95, 0)
    p.reset()
    drawFigure(ctx, cx, cy, CASHIER_LOOK, 'front', 0, 0)
    // Counter.
    p.box(0.04, 1.3, 0, 1.92, 0.62, 26, faceColors(PAL.wood))
    p.faceY(0.04, 1.92, 26)
    roundRect(ctx, 4, 5, 1.92 * 32 - 8, 15, 3)
    ctx.fillStyle = rgba('#000000', 0.15)
    ctx.fill()
    ctx.strokeStyle = rgba(PAL.goldLight, 0.6)
    ctx.lineWidth = 1
    ctx.stroke()
    p.reset()
    p.box(0.0, 1.26, 26, 2.0, 0.7, 4, trim)
    // The grille: gold bars on the counter's front edge.
    for (let i = 0; i <= 8; i++) {
        const gx = 0.06 + i * 0.235
        p.box(gx, 1.3, 30, 0.04, 0.04, 30, gold(), { lineWidth: 0.8, shine: false })
    }
    p.box(0.02, 1.27, 58, 1.96, 0.1, 4, gold(), { lineWidth: 1 })
    // Side post at the front right corner, up to the sign.
    p.box(1.9, 1.3, 30, 0.08, 0.08, 40, trim)
    p.box(0.02, 1.25, 70, 0.08, 0.08, 0, trim)
    // Roof sign.
    p.box(0.0, 0.0, 70, 2.0, 1.5, 6, faceColors(darken(wall, 0.15)))
    p.box(0.2, 1.3, 76, 1.6, 0.14, 18, decor >= 3 ? gold() : faceColors('#e11d48'))
    p.faceY(0.2, 1.44, 94)
    roundRect(ctx, 2.5, 2.5, 1.6 * 32 - 5, 13, 4)
    ctx.fillStyle = PAL.cream
    ctx.fill()
    p.text('CASHIER', 0.8 * 32, 9.5, 10, '#9f1239', { maxWidth: 1.6 * 32 - 8 })
    p.reset()
}

// ── architect's desk (2×1) ─────────────────────────────────────────────────

export const DESK_TOP = project(1.0, 0.5, 74)

export function drawDesk(p: Painter) {
    const { ctx } = p
    p.shadow([[0, 0], [2, 0], [2, 1], [0, 1]], 7, 0.38)
    const [ax, ay] = p.pt(1.35, 0.18, 0)
    p.reset()
    drawFigure(ctx, ax, ay, ARCHITECT_LOOK, 'front', 0, 0)
    // Legs and the drafting board.
    const legs = faceColors(PAL.woodDark)
    for (const [gx, gy] of [[0.12, 0.34], [1.8, 0.34], [0.12, 0.84], [1.8, 0.84]] as const) p.box(gx, gy, 0, 0.08, 0.08, 22, legs, { lineWidth: 1 })
    p.box(0.06, 0.3, 22, 1.88, 0.64, 4, faceColors(PAL.wood))
    p.top(0.16, 0.36, 26)
    roundRect(ctx, 0, 0, 1.2 * 32, 0.5 * 32, 2)
    ctx.fillStyle = '#2f6fb5'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'
    ctx.lineWidth = 0.6
    for (let i = 4; i < 38; i += 5) {
        ctx.beginPath()
        ctx.moveTo(i, 1)
        ctx.lineTo(i, 15)
        ctx.stroke()
    }
    for (let j = 3; j < 16; j += 4) {
        ctx.beginPath()
        ctx.moveTo(1, j)
        ctx.lineTo(37, j)
        ctx.stroke()
    }
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.1
    ctx.strokeRect(8, 4, 14, 8)
    ctx.strokeRect(22, 6, 8, 6)
    p.reset()
    // A rolled-up blueprint and a desk lamp.
    p.cylinder(1.62, 0.62, 26, 0.07, 3, faceColors('#7fb6e8'), { lineWidth: 1 })
    p.box(1.7, 0.38, 26, 0.12, 0.12, 2, faceColors(PAL.slate), { lineWidth: 1 })
    const [lx, ly] = p.pt(1.76, 0.44, 28)
    p.reset()
    ctx.strokeStyle = INK
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(lx, ly)
    ctx.lineTo(lx - 4, ly - 14)
    ctx.lineTo(lx + 5, ly - 22)
    ctx.stroke()
    ctx.strokeStyle = '#f2a23d'
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.fillStyle = '#f2a23d'
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(lx + 1, ly - 25)
    ctx.lineTo(lx + 9, ly - 19)
    ctx.lineTo(lx + 4, ly - 16)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
}

// ── furniture and decoration ───────────────────────────────────────────────

export function propHeight(kind: PropKind): number {
    switch (kind) {
        case 'plant': return 40
        case 'palm': return 66
        case 'lamp': return 64
        case 'rope': return 26
        case 'statue': return 58
        case 'sofa': return 30
        case 'bar': return 70
        case 'piano': return 52
        case 'fountain': return 60
    }
}

/** Where a lamp's light sits (local px), for a glow overlay. */
export const LAMP_LIGHT = project(0.5, 0.5, 54)

function leafBlob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
}

export function drawProp(p: Painter, kind: PropKind, w: number, h: number, accent: string) {
    const { ctx } = p
    switch (kind) {
        case 'plant': {
            p.shadow(circlePoly(0.5, 0.5, 0.3, 12), 5, 0.35, 0)
            p.cylinder(0.5, 0.5, 0, 0.24, 14, faceColors(PAL.pot))
            p.flat(circlePoly(0.5, 0.5, 0.2, 14), 14, '#5a3a22')
            const [x, y] = p.pt(0.5, 0.5, 26)
            p.reset()
            const blobs: [number, number, number][] = [[-7, 2, 7], [7, 2, 7], [0, -6, 8], [-4, -12, 6], [5, -11, 6], [0, 4, 7]]
            ctx.fillStyle = INK
            for (const [dx, dy, r] of blobs) leafBlob(ctx, x + dx, y + dy, r + 1.4, INK)
            blobs.forEach(([dx, dy, r], i) => leafBlob(ctx, x + dx, y + dy, r, i % 2 ? PAL.leaf : PAL.leafDark))
            ctx.fillStyle = 'rgba(255,255,255,0.25)'
            ctx.beginPath()
            ctx.ellipse(x - 3, y - 12, 3, 1.6, -0.5, 0, Math.PI * 2)
            ctx.fill()
            return
        }
        case 'palm': {
            p.shadow(circlePoly(0.5, 0.5, 0.3, 12), 5, 0.35, 0)
            p.cylinder(0.5, 0.5, 0, 0.26, 16, faceColors(PAL.gold))
            const [x, y] = p.pt(0.5, 0.5, 16)
            p.reset()
            ctx.strokeStyle = INK
            ctx.lineWidth = 6
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.quadraticCurveTo(x + 5, y - 20, x + 2, y - 40)
            ctx.stroke()
            ctx.strokeStyle = '#a0703f'
            ctx.lineWidth = 3.6
            ctx.stroke()
            const tx = x + 2
            const ty = y - 40
            for (const [dx, dy] of [[-1, -0.1], [1, -0.15], [-0.9, 0.55], [0.9, 0.5], [0.15, -0.95], [-0.5, -0.8]]) {
                ctx.beginPath()
                ctx.ellipse(tx + dx! * 11, ty + dy! * 8, 12, 4.4, Math.atan2(dy!, dx!), 0, Math.PI * 2)
                ctx.fillStyle = PAL.leaf
                ctx.strokeStyle = INK
                ctx.lineWidth = 1.5
                ctx.fill()
                ctx.stroke()
            }
            return
        }
        case 'lamp': {
            p.shadow(circlePoly(0.5, 0.5, 0.2, 12), 5, 0.3, 0)
            p.cylinder(0.5, 0.5, 0, 0.18, 3, gold())
            p.cylinder(0.5, 0.5, 3, 0.035, 42, gold(), { lineWidth: 1, shine: false })
            const [x, y] = p.pt(0.5, 0.5, 46)
            p.reset()
            ctx.fillStyle = PAL.cream
            ctx.strokeStyle = INK
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.moveTo(x - 6, y - 14)
            ctx.lineTo(x + 6, y - 14)
            ctx.lineTo(x + 10, y + 1)
            ctx.quadraticCurveTo(x, y + 4, x - 10, y + 1)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = 'rgba(255, 210, 120, 0.5)'
            ctx.beginPath()
            ctx.ellipse(x, y + 1, 8, 2.2, 0, 0, Math.PI * 2)
            ctx.fill()
            return
        }
        case 'rope': {
            const post = gold()
            p.cylinder(0.2, 0.5, 0, 0.1, 2, post)
            p.cylinder(0.2, 0.5, 2, 0.035, 20, post, { lineWidth: 1, shine: false })
            p.cylinder(0.8, 0.5, 0, 0.1, 2, post)
            p.cylinder(0.8, 0.5, 2, 0.035, 20, post, { lineWidth: 1, shine: false })
            const [ax, ay] = p.pt(0.2, 0.5, 20)
            const [bx, by] = p.pt(0.8, 0.5, 20)
            p.reset()
            ctx.lineCap = 'round'
            ctx.strokeStyle = INK
            ctx.lineWidth = 4.4
            ctx.beginPath()
            ctx.moveTo(ax, ay)
            ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + 9, bx, by)
            ctx.stroke()
            ctx.strokeStyle = PAL.velvet
            ctx.lineWidth = 2.6
            ctx.stroke()
            for (const [x, y] of [[ax, ay], [bx, by]] as const) {
                ctx.fillStyle = INK
                ctx.beginPath()
                ctx.arc(x, y - 1, 3.2, 0, Math.PI * 2)
                ctx.fill()
                ctx.fillStyle = PAL.goldLight
                ctx.beginPath()
                ctx.arc(x, y - 1, 2.1, 0, Math.PI * 2)
                ctx.fill()
            }
            return
        }
        case 'statue': {
            p.shadow([[0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85]], 6, 0.35, 0)
            p.box(0.2, 0.2, 0, 0.6, 0.6, 16, faceColors('#efe6da'))
            p.box(0.15, 0.15, 16, 0.7, 0.7, 4, faceColors('#e2d6c4'))
            // A giant gold chip on its edge.
            const [x, y] = p.pt(0.5, 0.5, 40)
            p.reset()
            ctx.fillStyle = INK
            ctx.beginPath()
            ctx.ellipse(x, y, 14, 17, 0, 0, Math.PI * 2)
            ctx.fill()
            const g = ctx.createLinearGradient(x - 12, y - 14, x + 12, y + 14)
            g.addColorStop(0, PAL.goldLight)
            g.addColorStop(0.5, PAL.gold)
            g.addColorStop(1, PAL.goldDark)
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.ellipse(x, y, 12.5, 15.5, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = 'rgba(255,255,255,0.7)'
            ctx.lineWidth = 2
            ctx.setLineDash([3, 4])
            ctx.beginPath()
            ctx.ellipse(x, y, 10.5, 13.5, 0, 0, Math.PI * 2)
            ctx.stroke()
            ctx.setLineDash([])
            p.text('P', x, y + 1, 14, PAL.goldDark)
            return
        }
        case 'sofa': {
            p.shadow([[0, 0.1], [w, 0.1], [w, h - 0.05], [0, h - 0.05]], 6, 0.35, 0)
            const fabric = faceColors(mix(accent, PAL.velvet, 0.4))
            p.box(0.08, 0.15, 0, w - 0.16, 0.3, 30, fabric)
            p.box(0.08, 0.45, 0, w - 0.16, 0.45, 13, fabric)
            p.box(0.04, 0.15, 0, 0.18, 0.78, 20, fabric)
            p.box(w - 0.22, 0.15, 0, 0.18, 0.78, 20, fabric)
            for (let i = 0; i < w; i++) p.box(0.26 + i * ((w - 0.52) / w), 0.47, 13, (w - 0.52) / w - 0.04, 0.4, 4, faceColors(lighten(mix(accent, PAL.velvet, 0.4), 0.12)), { lineWidth: 1 })
            return
        }
        case 'bar': {
            p.shadow([[0, 0], [w, 0], [w, h], [0, h]], 7, 0.35)
            // Bottle shelf on the back wall, then the counter.
            p.box(0.1, 0.02, 30, w - 0.2, 0.18, 4, faceColors(PAL.woodDark), { lineWidth: 1 })
            for (let i = 0; i < 11; i++) {
                const gx = 0.25 + i * ((w - 0.5) / 10)
                const c = ['#3f8a45', '#b91c1c', '#f2a23d', '#6b4a6e', '#9fdcf5'][i % 5]!
                p.cylinder(gx, 0.11, 34, 0.045, 12, faceColors(c, 0.25), { lineWidth: 0.8 })
            }
            p.box(0.1, 0.02, 56, w - 0.2, 0.18, 4, faceColors(PAL.woodDark), { lineWidth: 1 })
            for (let i = 0; i < 9; i++) {
                const gx = 0.3 + i * ((w - 0.6) / 8)
                p.cylinder(gx, 0.11, 60, 0.05, 8, faceColors('#e9f5fb', 0.25), { lineWidth: 0.8 })
            }
            p.box(0.05, 0.42, 0, w - 0.1, 0.5, 28, faceColors(PAL.woodDark))
            p.box(0.0, 0.38, 28, w, 0.6, 4, gold())
            return
        }
        case 'piano': {
            p.shadow([[0.1, 0.1], [w - 0.1, 0.1], [w - 0.1, h - 0.1], [0.1, h - 0.1]], 7, 0.38)
            const lacquer = faceColors('#25202f', 0.12)
            p.box(0.25, 0.25, 0, 0.06, 0.06, 20, lacquer, { lineWidth: 1 })
            p.box(1.6, 0.4, 0, 0.06, 0.06, 20, lacquer, { lineWidth: 1 })
            p.box(0.4, 1.5, 0, 0.06, 0.06, 20, lacquer, { lineWidth: 1 })
            const body: [number, number][] = [[0.1, 0.1], [1.2, 0.1], [1.85, 0.7], [1.85, 1.3], [0.1, 1.65]]
            p.prism(body, 20, 12, lacquer)
            // Keys along the front.
            p.box(0.15, 1.6, 22, 1.1, 0.22, 6, faceColors('#f7f3ea'), { lineWidth: 1 })
            p.faceY(0.15, 1.82, 28)
            ctx.fillStyle = '#25202f'
            for (let i = 0; i < 12; i++) ctx.fillRect(2 + i * 2.9, 0, 1.4, 3.2)
            p.reset()
            // The lid, propped open.
            const [x1, y1] = p.pt(0.15, 0.15, 32)
            const [x2, y2] = p.pt(1.8, 0.75, 32)
            const [x3, y3] = p.pt(1.3, 0.3, 64)
            p.reset()
            ctx.fillStyle = '#3a3346'
            ctx.strokeStyle = INK
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.moveTo(x1, y1)
            ctx.lineTo(x3, y3)
            ctx.lineTo(x2, y2)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            return
        }
        case 'fountain': {
            p.shadow(circlePoly(1, 1, 0.95, 20), 8, 0.35, 0)
            p.cylinder(1, 1, 0, 0.92, 12, faceColors('#e9dfd0'))
            p.flat(circlePoly(1, 1, 0.8, 24), 12, PAL.water)
            p.top(1, 1, 12)
            ctx.strokeStyle = 'rgba(255,255,255,0.55)'
            ctx.lineWidth = 1.2
            for (const r of [10, 17]) {
                ctx.beginPath()
                ctx.arc(0, 0, r, 0, Math.PI * 2)
                ctx.stroke()
            }
            p.reset()
            p.cylinder(1, 1, 12, 0.14, 22, faceColors('#e9dfd0'))
            p.cylinder(1, 1, 34, 0.42, 4, faceColors('#e9dfd0'))
            p.flat(circlePoly(1, 1, 0.34, 18), 38, lighten(PAL.water, 0.15))
            p.cylinder(1, 1, 38, 0.06, 10, gold(), { lineWidth: 1 })
            const [x, y] = p.pt(1, 1, 52)
            p.reset()
            ctx.fillStyle = INK
            ctx.beginPath()
            ctx.arc(x, y, 6.5, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = PAL.gold
            ctx.beginPath()
            ctx.arc(x, y, 5.2, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = '#ffffff'
            ctx.beginPath()
            ctx.arc(x - 1.6, y - 1.8, 1.4, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

// ── chandelier (hangs above the floor) ─────────────────────────────────────

export const CHANDELIER_Z = 118

/** Drawn with its anchor at the floor tile below it; light at CHANDELIER_LIGHT. */
export const CHANDELIER_LIGHT = project(0, 0, CHANDELIER_Z - 6)

export function drawChandelier(p: Painter) {
    const { ctx } = p
    const [x, y] = p.pt(0, 0, CHANDELIER_Z)
    p.reset()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(x, y - 40)
    ctx.lineTo(x, y - 12)
    ctx.stroke()
    // Arms with candles.
    const arms = 6
    for (let i = 0; i < arms; i++) {
        const a = (i / arms) * Math.PI * 2
        const ex = x + Math.cos(a) * 16
        const ey = y + Math.sin(a) * 6
        ctx.strokeStyle = INK
        ctx.lineWidth = 3.4
        ctx.beginPath()
        ctx.moveTo(x, y - 2)
        ctx.quadraticCurveTo((x + ex) / 2, ey + 6, ex, ey)
        ctx.stroke()
        ctx.strokeStyle = PAL.gold
        ctx.lineWidth = 1.8
        ctx.stroke()
    }
    // Back candles first, then the body, then the front candles.
    const candles = Array.from({ length: arms }, (_, i) => {
        const a = (i / arms) * Math.PI * 2
        return { x: x + Math.cos(a) * 16, y: y + Math.sin(a) * 6, front: Math.sin(a) > 0 }
    })
    const candle = (cx: number, cy: number) => {
        ctx.fillStyle = INK
        roundRect(ctx, cx - 2.2, cy - 8, 4.4, 8, 1.5)
        ctx.fill()
        ctx.fillStyle = PAL.cream
        roundRect(ctx, cx - 1.4, cy - 7.4, 2.8, 7, 1)
        ctx.fill()
        ctx.fillStyle = '#ffd23f'
        ctx.beginPath()
        ctx.ellipse(cx, cy - 10, 1.8, 3, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = PAL.goldDark
        ctx.beginPath()
        ctx.ellipse(cx, cy, 3.6, 1.4, 0, 0, Math.PI * 2)
        ctx.fill()
    }
    candles.filter(c => !c.front).forEach(c => candle(c.x, c.y))
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.ellipse(x, y - 4, 7.5, 9.5, 0, 0, Math.PI * 2)
    ctx.fill()
    const g = ctx.createLinearGradient(x - 6, y - 12, x + 6, y + 4)
    g.addColorStop(0, PAL.goldLight)
    g.addColorStop(1, PAL.goldDark)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(x, y - 4, 6, 8, 0, 0, Math.PI * 2)
    ctx.fill()
    // Crystal drops.
    for (let i = 0; i < 7; i++) {
        const dx = (i - 3) * 4.2
        ctx.fillStyle = 'rgba(220, 240, 255, 0.95)'
        ctx.strokeStyle = INK
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(x + dx, y + 4)
        ctx.lineTo(x + dx - 1.6, y + 8 + (i % 2) * 2)
        ctx.lineTo(x + dx, y + 11 + (i % 2) * 2)
        ctx.lineTo(x + dx + 1.6, y + 8 + (i % 2) * 2)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
    }
    candles.filter(c => c.front).forEach(c => candle(c.x, c.y))
}

// ── signs (screen-facing boards on posts) ──────────────────────────────────

function post(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number) {
    ctx.fillStyle = INK
    roundRect(ctx, x - 2.6, top, 5.2, bottom - top + 1, 2)
    ctx.fill()
    ctx.fillStyle = PAL.woodDark
    roundRect(ctx, x - 1.5, top + 1, 3, bottom - top - 1, 1.5)
    ctx.fill()
}

function board(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string | CanvasGradient, r = 6) {
    ctx.fillStyle = INK
    roundRect(ctx, x - 1.6, y - 1.6, w + 3.2, h + 3.2, r + 1.4)
    ctx.fill()
    ctx.fillStyle = fill
    roundRect(ctx, x, y, w, h, r)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    roundRect(ctx, x + 3, y + 2, w - 6, 3, 1.5)
    ctx.fill()
}

function hammer(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-0.6)
    ctx.fillStyle = INK
    roundRect(ctx, -1.8 * s, -2 * s, 3.6 * s, 13 * s, 1.5 * s)
    ctx.fill()
    ctx.fillStyle = PAL.woodLight
    roundRect(ctx, -1 * s, -1.4 * s, 2 * s, 11.8 * s, 1 * s)
    ctx.fill()
    ctx.fillStyle = INK
    roundRect(ctx, -6 * s, -6 * s, 12 * s, 5.4 * s, 1.6 * s)
    ctx.fill()
    ctx.fillStyle = '#c9cbd6'
    roundRect(ctx, -5.2 * s, -5.3 * s, 10.4 * s, 4 * s, 1.2 * s)
    ctx.fill()
    ctx.restore()
}

/** "Build here" sign for an empty plot: a small board with a hammer and a plus. */
export const BUILD_SIGN = { width: 46, height: 58, ox: 23, oy: 54 }

export function drawBuildSign(ctx: CanvasRenderingContext2D, accent: string) {
    const { ox, oy } = BUILD_SIGN
    ctx.fillStyle = 'rgba(20,8,30,0.35)'
    ctx.beginPath()
    ctx.ellipse(ox + 3, oy, 12, 4, 0, 0, Math.PI * 2)
    ctx.fill()
    post(ctx, ox, oy - 26, oy)
    const g = ctx.createLinearGradient(0, oy - 52, 0, oy - 22)
    g.addColorStop(0, lighten(accent, 0.25))
    g.addColorStop(1, darken(accent, 0.1))
    board(ctx, ox - 19, oy - 52, 38, 28, g, 8)
    hammer(ctx, ox - 5, oy - 37, 1)
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(ox + 9, oy - 38, 7.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(ox + 9, oy - 38, 6.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = darken(accent, 0.2)
    ctx.fillRect(ox + 8, oy - 42, 2, 8)
    ctx.fillRect(ox + 5, oy - 39, 8, 2)
}

/** A padlock on a post for a plot that can't be built yet. */
export function drawLockSign(ctx: CanvasRenderingContext2D) {
    const { ox, oy } = BUILD_SIGN
    ctx.fillStyle = 'rgba(20,8,30,0.3)'
    ctx.beginPath()
    ctx.ellipse(ox + 3, oy, 10, 3.5, 0, 0, Math.PI * 2)
    ctx.fill()
    post(ctx, ox, oy - 22, oy)
    ctx.strokeStyle = INK
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(ox, oy - 38, 7, Math.PI, 0)
    ctx.stroke()
    ctx.strokeStyle = '#c9cbd6'
    ctx.lineWidth = 2.6
    ctx.stroke()
    board(ctx, ox - 11, oy - 39, 22, 18, '#8c87a6', 5)
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(ox, oy - 31, 2.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(ox - 1, oy - 31, 2, 6)
}

/** FOR SALE sign for the next zone: a big cream board with a red header. */
export const SALE_SIGN = { width: 92, height: 84, ox: 46, oy: 78 }

export function drawSaleSign(ctx: CanvasRenderingContext2D, zoneName: string, building: boolean) {
    const { ox, oy } = SALE_SIGN
    ctx.fillStyle = 'rgba(20,8,30,0.35)'
    ctx.beginPath()
    ctx.ellipse(ox + 4, oy, 30, 7, 0, 0, Math.PI * 2)
    ctx.fill()
    post(ctx, ox - 24, oy - 40, oy)
    post(ctx, ox + 24, oy - 40, oy)
    const top = oy - 74
    if (building) {
        board(ctx, ox - 40, top, 80, 46, '#ffd23f', 8)
        ctx.save()
        roundRect(ctx, ox - 40, top, 80, 13, 8)
        ctx.clip()
        for (let i = -2; i < 12; i++) {
            ctx.fillStyle = i % 2 ? '#2a1b30' : '#ffd23f'
            ctx.beginPath()
            ctx.moveTo(ox - 40 + i * 10, top)
            ctx.lineTo(ox - 30 + i * 10, top)
            ctx.lineTo(ox - 40 + i * 10, top + 13)
            ctx.lineTo(ox - 50 + i * 10, top + 13)
            ctx.closePath()
            ctx.fill()
        }
        ctx.restore()
        ctx.font = '13px "Lilita One", system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = INK
        ctx.fillText('OPENING SOON', ox, top + 24, 72)
        ctx.font = '10px "Fredoka", system-ui, sans-serif'
        ctx.fillText(zoneName, ox, top + 37, 72)
        return
    }
    board(ctx, ox - 40, top, 80, 46, PAL.paper, 8)
    ctx.fillStyle = PAL.chip
    roundRect(ctx, ox - 36, top + 4, 72, 19, 5)
    ctx.fill()
    ctx.font = '15px "Lilita One", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.fillText('FOR SALE', ox, top + 14, 68)
    ctx.font = '600 11px "Fredoka", system-ui, sans-serif'
    ctx.fillStyle = INK
    ctx.fillText(zoneName, ox, top + 34, 72)
}

/** The architect's floating "build" badge over the desk. */
export const BADGE = { width: 40, height: 40, ox: 20, oy: 20 }

export function drawBuildBadge(ctx: CanvasRenderingContext2D) {
    const { ox, oy } = BADGE
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(ox, oy, 15, 0, Math.PI * 2)
    ctx.fill()
    const g = ctx.createLinearGradient(0, oy - 14, 0, oy + 14)
    g.addColorStop(0, '#ffe38a')
    g.addColorStop(1, '#f2a23d')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(ox, oy, 13.4, 0, Math.PI * 2)
    ctx.fill()
    hammer(ctx, ox + 1, oy + 1, 1.15)
}

// ── construction ───────────────────────────────────────────────────────────

/** Scaffolding around a w×h footprint, `height` px tall, with the accent tarp. */
export function drawScaffold(p: Painter, w: number, h: number, height: number, accent: string, crane: boolean) {
    const { ctx } = p
    p.shadow([[0, 0], [w, 0], [w, h], [0, h]], 6, 0.25)
    const pole = faceColors('#c9cbd6')
    const plank = faceColors(PAL.woodLight)
    const levels = Math.max(2, Math.round(height / 32))
    const step = height / levels
    const corners: [number, number][] = [[0.05, 0.05], [w - 0.11, 0.05], [0.05, h - 0.11], [w - 0.11, h - 0.11]]
    if (crane) {
        // A little tower crane at the back corner.
        const yellow = faceColors('#f5c22a')
        p.box(0.1, 0.1, 0, 0.16, 0.16, height + 44, yellow, { lineWidth: 1.2 })
        p.box(0.1, 0.1, height + 44, w * 0.95, 0.12, 5, yellow, { lineWidth: 1.2 })
        p.box(-0.35, 0.1, height + 44, 0.45, 0.12, 5, yellow, { lineWidth: 1.2 })
        p.box(-0.32, 0.06, height + 34, 0.22, 0.2, 10, faceColors('#6b6f80'), { lineWidth: 1 })
    }
    // Back poles first.
    for (const [gx, gy] of corners.slice(0, 2)) p.box(gx, gy, 0, 0.06, 0.06, height, pole, { lineWidth: 1 })
    for (let i = 1; i <= levels; i++) {
        const z = i * step - 3
        p.box(0.02, 0.02, z, w - 0.04, 0.2, 3, plank, { lineWidth: 1 })
        p.box(0.02, 0.02, z, 0.2, h - 0.04, 3, plank, { lineWidth: 1 })
    }
    // The tarp on the front face, striped in the game's accent.
    p.faceY(0.08, h - 0.08, height - 4)
    const tw = (w - 0.16) * 32
    const th = height - 10
    ctx.globalAlpha = 0.82
    for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? lighten(accent, 0.2) : '#f4f1fa'
        ctx.fillRect((i * tw) / 8, 0, tw / 8 + 0.5, th)
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.4
    ctx.strokeRect(0, 0, tw, th)
    p.reset()
    for (const [gx, gy] of corners.slice(2)) p.box(gx, gy, 0, 0.06, 0.06, height, pole, { lineWidth: 1 })
    // Front cross braces.
    p.faceY(0, h - 0.05, height)
    ctx.strokeStyle = '#8d93a8'
    ctx.lineWidth = 1.4
    for (let i = 0; i < levels; i++) {
        ctx.beginPath()
        ctx.moveTo(2, height - i * step)
        ctx.lineTo(w * 32 - 2, height - (i + 1) * step + 4)
        ctx.stroke()
    }
    p.reset()
    for (let i = 1; i <= levels; i++) p.box(0.02, h - 0.2, i * step - 3, w - 0.04, 0.18, 3, plank, { lineWidth: 1 })
    // Hazard plates at the foot.
    p.faceY(0, h, 6)
    for (let i = 0; i < w * 4; i++) {
        ctx.fillStyle = i % 2 ? INK : '#ffd23f'
        ctx.beginPath()
        ctx.moveTo(i * 8, 0)
        ctx.lineTo(i * 8 + 8, 0)
        ctx.lineTo(i * 8 + 4, 6)
        ctx.lineTo(i * 8 - 4, 6)
        ctx.closePath()
        ctx.fill()
    }
    p.reset()
}

/** Where a crane's hook hangs from (local px). */
export function craneHook(w: number, height: number): Pt {
    return project(w * 0.75, 0.16, height + 44)
}

/** Dashed outline of a plot on the floor. */
export function drawPlotOutline(p: Painter, w: number, h: number, color: string, alpha: number) {
    const { ctx } = p
    p.top(0, 0, 0)
    roundRect(ctx, 3, 3, w * 32 - 6, h * 32 - 6, 8)
    ctx.fillStyle = rgba(color, alpha * 0.28)
    ctx.fill()
    ctx.setLineDash([6, 5])
    ctx.lineWidth = 2
    ctx.strokeStyle = rgba(color, alpha)
    ctx.stroke()
    ctx.setLineDash([])
    p.reset()
}

/** Entrance lamp post (stands outside the building by the door). */
export function drawLampPost(p: Painter) {
    const { ctx } = p
    p.shadow(circlePoly(0.5, 0.5, 0.18, 10), 4, 0.35, 0)
    p.cylinder(0.5, 0.5, 0, 0.16, 6, faceColors('#2f2a3d'))
    p.cylinder(0.5, 0.5, 6, 0.04, 54, faceColors('#2f2a3d'), { lineWidth: 1, shine: false })
    const [x, y] = p.pt(0.5, 0.5, 66)
    p.reset()
    ctx.fillStyle = INK
    roundRect(ctx, x - 7, y - 9, 14, 16, 4)
    ctx.fill()
    const g = ctx.createRadialGradient(x, y - 1, 1, x, y - 1, 8)
    g.addColorStop(0, '#fffbe6')
    g.addColorStop(1, '#ffc94d')
    ctx.fillStyle = g
    roundRect(ctx, x - 5.4, y - 7.4, 10.8, 12.8, 3)
    ctx.fill()
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.moveTo(x - 9, y - 9)
    ctx.lineTo(x + 9, y - 9)
    ctx.lineTo(x, y - 16)
    ctx.closePath()
    ctx.fill()
}

export const LAMP_POST_LIGHT = project(0.5, 0.5, 65)

/** A rope across a doorway to a zone not yet owned (posts at both ends). */
export function drawDoorRope(p: Painter, axis: 'x' | 'y', len: number) {
    const { ctx } = p
    const post = gold()
    const a: [number, number] = axis === 'y' ? [0.12, -0.05] : [-0.05, 0.12]
    const b: [number, number] = axis === 'y' ? [len - 0.12, -0.05] : [-0.05, len - 0.12]
    for (const [gx, gy] of [a, b]) {
        p.cylinder(gx, gy, 0, 0.09, 2, post, { lineWidth: 1 })
        p.cylinder(gx, gy, 2, 0.03, 20, post, { lineWidth: 1, shine: false })
    }
    const [ax, ay] = p.pt(a[0], a[1], 20)
    const [bx, by] = p.pt(b[0], b[1], 20)
    p.reset()
    ctx.lineCap = 'round'
    ctx.strokeStyle = INK
    ctx.lineWidth = 4.4
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + 12, bx, by)
    ctx.stroke()
    ctx.strokeStyle = PAL.velvet
    ctx.lineWidth = 2.6
    ctx.stroke()
}

