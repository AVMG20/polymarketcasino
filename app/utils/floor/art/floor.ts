import type { ZoneId } from '#shared/tycoon'
import { HH, HW, INK, Painter, artRng, darken, desaturate, faceColors, hashString, lighten, mix, rgba, roundRect } from '../iso'
import { EMBLEMS, ZONE_RECTS, areaAt, type Rect } from '#shared/floor/layout'
import type { SkinId } from '#shared/cosmetics'
import { PAL, ZONE_STYLE, skinStyle, type Motif, type SkinStyle, type ZoneStyle } from './palette'

/**
 * Floors and walls. Each zone's floor is one texture (re-baked when the zone
 * is bought or decor changes); walls are per-edge segments so they depth-sort
 * with the characters walking past them.
 */

export const SLAB = 16
export const WALL_TALL = 82
export const WALL_LOW = 18
export const WALL_T = 0.16

export type ZoneLook = 'owned' | 'available' | 'building' | 'locked'

/** World-space bounding box of a grid rect's floor, plus the slab below. */
export function rectBounds(rect: Rect, below = SLAB): { minX: number, minY: number, maxX: number, maxY: number } {
    return {
        minX: (rect.x - rect.y - rect.h) * HW,
        maxX: (rect.x + rect.w - rect.y) * HW,
        minY: (rect.x + rect.y) * HH,
        maxY: (rect.x + rect.w + rect.y + rect.h) * HH + below
    }
}

function slabSides(p: Painter, rect: Rect, owned: boolean) {
    const { ctx } = p
    const left = owned ? PAL.slab : darken(PAL.slab, 0.2)
    const right = darken(left, 0.3)
    const side = (a: [number, number], b: [number, number], color: string) => {
        const [x1, y1] = p.pt(a[0], a[1], 0)
        const [x2, y2] = p.pt(b[0], b[1], 0)
        const g = ctx.createLinearGradient(0, Math.min(y1, y2), 0, Math.max(y1, y2) + SLAB)
        g.addColorStop(0, lighten(color, 0.08))
        g.addColorStop(1, darken(color, 0.25))
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.lineTo(x2, y2 + SLAB)
        ctx.lineTo(x1, y1 + SLAB)
        ctx.closePath()
        ctx.fillStyle = g
        ctx.fill()
        ctx.strokeStyle = INK
        ctx.lineWidth = 1.2
        ctx.stroke()
        // Gold lip along the edge.
        ctx.strokeStyle = owned ? rgba(PAL.gold, 0.85) : rgba(PAL.gold, 0.25)
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(x1, y1 + 1.2)
        ctx.lineTo(x2, y2 + 1.2)
        ctx.stroke()
    }
    const x2 = rect.x + rect.w
    const y2 = rect.y + rect.h
    for (let j = rect.y; j < y2; j++) {
        if (!areaAt(x2, j)) side([x2, j], [x2, j + 1], right)
    }
    for (let i = rect.x; i < x2; i++) {
        if (!areaAt(i, y2)) side([i, y2], [i + 1, y2], left)
    }
}

function woodFloor(ctx: CanvasRenderingContext2D, w: number, h: number, style: ZoneStyle, seed: number) {
    const rng = artRng(seed)
    const rows = h * 3
    const rowH = 32 / 3
    for (let r = 0; r < rows; r++) {
        let u = -rng() * 60
        while (u < w * 32) {
            const len = 50 + rng() * 60
            const shade = rng()
            ctx.fillStyle = mix(style.floor, style.floorAlt, shade)
            ctx.fillRect(u, r * rowH, len, rowH)
            // Grain.
            ctx.strokeStyle = 'rgba(90, 50, 25, 0.12)'
            ctx.lineWidth = 0.6
            ctx.beginPath()
            ctx.moveTo(u + 4, r * rowH + rowH * (0.3 + rng() * 0.4))
            ctx.lineTo(u + len - 6, r * rowH + rowH * (0.3 + rng() * 0.4))
            ctx.stroke()
            ctx.strokeStyle = 'rgba(70, 35, 20, 0.35)'
            ctx.lineWidth = 0.8
            ctx.beginPath()
            ctx.moveTo(u, r * rowH)
            ctx.lineTo(u, (r + 1) * rowH)
            ctx.stroke()
            u += len
        }
        ctx.strokeStyle = 'rgba(70, 35, 20, 0.28)'
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.moveTo(0, r * rowH)
        ctx.lineTo(w * 32, r * rowH)
        ctx.stroke()
    }
}

function carpet(ctx: CanvasRenderingContext2D, w: number, h: number, style: ZoneStyle, decor: number) {
    const W = w * 32
    const H = h * 32
    ctx.fillStyle = style.floor
    ctx.fillRect(0, 0, W, H)
    // Soft alternating tiles even at decor 0, so walkable tiles read.
    for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
            if ((i + j) % 2) continue
            ctx.fillStyle = rgba(style.floorAlt, decor >= 2 ? 0.35 : 0.6)
            ctx.fillRect(i * 32, j * 32, 32, 32)
        }
    }
    const pat = style.pattern
    if (decor >= 2) {
        // A diamond lattice.
        ctx.strokeStyle = rgba(pat, decor >= 4 ? 0.5 : 0.38)
        ctx.lineWidth = 1.1
        for (let k = -h; k < w + h; k++) {
            ctx.beginPath()
            ctx.moveTo(k * 32, 0)
            ctx.lineTo((k + h) * 32, H)
            ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(k * 32, H)
            ctx.lineTo((k + h) * 32, 0)
            ctx.stroke()
        }
        ctx.fillStyle = rgba(pat, 0.65)
        for (let i = 0; i <= w; i++) {
            for (let j = 0; j <= h; j++) {
                ctx.beginPath()
                ctx.arc(i * 32, j * 32, decor >= 3 ? 2.6 : 1.8, 0, Math.PI * 2)
                ctx.fill()
            }
        }
    }
    if (decor >= 3) {
        // Four-point stars in the lattice cells.
        ctx.fillStyle = rgba(pat, 0.55)
        for (let i = 0; i < w; i++) {
            for (let j = 0; j < h; j++) {
                const cx = i * 32 + 16
                const cy = j * 32 + 16
                ctx.beginPath()
                ctx.moveTo(cx, cy - 6)
                ctx.quadraticCurveTo(cx, cy, cx + 6, cy)
                ctx.quadraticCurveTo(cx, cy, cx, cy + 6)
                ctx.quadraticCurveTo(cx, cy, cx - 6, cy)
                ctx.quadraticCurveTo(cx, cy, cx, cy - 6)
                ctx.fill()
            }
        }
    }
    if (decor >= 4) {
        // Medallions every other tile.
        for (let i = 1; i < w; i += 2) {
            for (let j = 1; j < h; j += 2) {
                const cx = i * 32
                const cy = j * 32
                ctx.fillStyle = rgba(darken(style.floor, 0.25), 0.85)
                ctx.beginPath()
                ctx.arc(cx, cy, 13, 0, Math.PI * 2)
                ctx.fill()
                ctx.strokeStyle = rgba(pat, 0.85)
                ctx.lineWidth = 1.4
                ctx.stroke()
                ctx.beginPath()
                for (let k = 0; k < 8; k++) {
                    const a = (k / 8) * Math.PI * 2
                    ctx.moveTo(cx, cy)
                    ctx.lineTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10)
                }
                ctx.stroke()
                ctx.fillStyle = rgba(pat, 0.9)
                ctx.beginPath()
                ctx.arc(cx, cy, 3, 0, Math.PI * 2)
                ctx.fill()
            }
        }
    }
    if (decor >= 1) {
        // A border band inside the walls.
        const inset = 9
        ctx.strokeStyle = rgba(darken(style.floor, 0.3), 0.9)
        ctx.lineWidth = 7
        ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2)
        ctx.strokeStyle = rgba(pat, decor >= 3 ? 0.95 : 0.6)
        ctx.lineWidth = decor >= 3 ? 1.6 : 1
        ctx.strokeRect(inset - 4.5, inset - 4.5, W - inset * 2 + 9, H - inset * 2 + 9)
        if (decor >= 3) ctx.strokeRect(inset + 4.5, inset + 4.5, W - inset * 2 - 9, H - inset * 2 - 9)
    }
}

function marble(ctx: CanvasRenderingContext2D, w: number, h: number, style: ZoneStyle, decor: number, seed: number) {
    const rng = artRng(seed)
    for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
            ctx.fillStyle = (i + j) % 2 ? style.floor : style.floorAlt
            ctx.fillRect(i * 32, j * 32, 32, 32)
            ctx.strokeStyle = 'rgba(160, 140, 120, 0.25)'
            ctx.lineWidth = 0.7
            ctx.beginPath()
            const x = i * 32 + rng() * 32
            ctx.moveTo(x, j * 32)
            ctx.bezierCurveTo(x + rng() * 20 - 10, j * 32 + 10, x + rng() * 20 - 10, j * 32 + 22, i * 32 + rng() * 32, j * 32 + 32)
            ctx.stroke()
        }
    }
    ctx.strokeStyle = decor >= 3 ? rgba(PAL.gold, 0.85) : 'rgba(150, 130, 110, 0.35)'
    ctx.lineWidth = decor >= 3 ? 1.2 : 0.8
    for (let i = 0; i <= w; i++) {
        ctx.beginPath()
        ctx.moveTo(i * 32, 0)
        ctx.lineTo(i * 32, h * 32)
        ctx.stroke()
    }
    for (let j = 0; j <= h; j++) {
        ctx.beginPath()
        ctx.moveTo(0, j * 32)
        ctx.lineTo(w * 32, j * 32)
        ctx.stroke()
    }
}

/** A tiny six-armed frost crystal, stroked. */
function crystal(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.beginPath()
    for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3 + Math.PI / 6
        ctx.moveTo(x - Math.cos(a) * s, y - Math.sin(a) * s)
        ctx.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s)
    }
    ctx.stroke()
}

/** A glint with a soft glow round it (baked; nothing twinkles per frame). */
function glint(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, alpha: number) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, s * 1.6)
    glow.addColorStop(0, rgba(color, alpha * 0.45))
    glow.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = glow
    ctx.fillRect(x - s * 1.6, y - s * 1.6, s * 3.2, s * 3.2)
    ctx.fillStyle = rgba('#ffffff', alpha)
    ctx.beginPath()
    sparkle(ctx, x, y, s)
    ctx.fill()
}

/** A long marble vein wandering across the floor. */
function vein(ctx: CanvasRenderingContext2D, rng: () => number, W: number, H: number) {
    const fromLeft = rng() < 0.5
    let x = fromLeft ? -10 : rng() * W
    let y = fromLeft ? rng() * H : -10
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let k = 0; k < 6; k++) {
        const nx = x + 20 + rng() * 40
        const ny = y + 20 + rng() * 40
        ctx.quadraticCurveTo(x + (rng() - 0.3) * 50, y + (rng() - 0.3) * 50, nx, ny)
        x = nx
        y = ny
    }
    ctx.stroke()
}

/** A double band inside the walls (decor 1+), in the pattern colour. */
function band(ctx: CanvasRenderingContext2D, W: number, H: number, color: string, under: string, decor: number) {
    const inset = 9
    ctx.strokeStyle = rgba(under, 0.85)
    ctx.lineWidth = 7
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2)
    ctx.strokeStyle = rgba(color, 0.9)
    ctx.lineWidth = 1.4
    ctx.strokeRect(inset - 4.5, inset - 4.5, W - inset * 2 + 9, H - inset * 2 + 9)
    ctx.strokeRect(inset + 4.5, inset + 4.5, W - inset * 2 - 9, H - inset * 2 - 9)
    if (decor < 3) return
    // Studs along the band.
    ctx.fillStyle = rgba(color, 0.95)
    for (let u = inset + 16; u < W - inset - 8; u += 32) {
        for (const v of [inset, H - inset]) {
            ctx.beginPath()
            ctx.arc(u, v, 1.8, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    for (let v = inset + 16; v < H - inset - 8; v += 32) {
        for (const u of [inset, W - inset]) {
            ctx.beginPath()
            ctx.arc(u, v, 1.8, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

/** A premium skin's own floor (palette Finish): stone or stars instead of carpet or marble. */
function finishFloor(ctx: CanvasRenderingContext2D, w: number, h: number, style: SkinStyle, decor: number, seed: number) {
    const rng = artRng(seed)
    const W = w * 32
    const H = h * 32
    const veinColor = style.vein ?? '#ffffff'
    const pat = style.pattern
    if (style.finish === 'ice') {
        // Frosted slabs two tiles wide, lit from their top corner, with a bevel.
        for (let i = 0; i < w; i += 2) {
            for (let j = 0; j < h; j += 2) {
                const x = i * 32
                const y = j * 32
                const sw = Math.min(2, w - i) * 32
                const sh = Math.min(2, h - j) * 32
                const base = ((i + j) / 2) % 2 ? style.floorAlt : style.floor
                const g = ctx.createLinearGradient(x, y, x + sw, y + sh)
                g.addColorStop(0, lighten(base, 0.3))
                g.addColorStop(0.55, base)
                g.addColorStop(1, darken(base, 0.04))
                ctx.fillStyle = g
                ctx.fillRect(x, y, sw, sh)
            }
        }
        ctx.lineCap = 'round'
        for (let k = 0; k < (w + h) * 1.2; k++) {
            ctx.strokeStyle = k % 3 ? rgba(veinColor, 0.6) : rgba(pat, 0.22)
            ctx.lineWidth = k % 3 ? 0.9 : 1.4
            vein(ctx, rng, W, H)
        }
        // Frost crystals.
        ctx.strokeStyle = rgba('#ffffff', 0.75)
        ctx.lineWidth = 0.7
        for (let k = 0; k < w * h * 0.6; k++) crystal(ctx, rng() * W, rng() * H, 1.6 + rng() * 2.4)
        // Slab bevels: lit top-left edges, shaded bottom-right ones.
        for (let i = 0; i <= w; i += 2) {
            for (let j = 0; j <= h; j += 2) {
                ctx.strokeStyle = rgba('#ffffff', 0.85)
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.moveTo(i * 32 + 0.5, Math.min(H, (j + 2) * 32))
                ctx.lineTo(i * 32 + 0.5, j * 32 + 0.5)
                ctx.lineTo(Math.min(W, (i + 2) * 32), j * 32 + 0.5)
                ctx.stroke()
                ctx.strokeStyle = rgba(pat, 0.4)
                ctx.beginPath()
                ctx.moveTo(i * 32 - 0.5, (j - 2) * 32)
                ctx.lineTo(i * 32 - 0.5, j * 32 - 0.5)
                ctx.lineTo((i - 2) * 32, j * 32 - 0.5)
                ctx.stroke()
            }
        }
        for (let k = 0; k < w * h * 0.12; k++) glint(ctx, rng() * W, rng() * H, 2.4 + rng() * 2, '#e8f7ff', 0.9)
        if (decor >= 2) {
            // Ice-blue diamonds where four slabs meet.
            ctx.fillStyle = rgba(pat, 0.75)
            for (let i = 2; i < w; i += 2) {
                for (let j = 2; j < h; j += 2) {
                    ctx.beginPath()
                    ctx.moveTo(i * 32, j * 32 - 5)
                    ctx.lineTo(i * 32 + 5, j * 32)
                    ctx.lineTo(i * 32, j * 32 + 5)
                    ctx.lineTo(i * 32 - 5, j * 32)
                    ctx.closePath()
                    ctx.fill()
                }
            }
        }
        if (decor >= 1) band(ctx, W, H, pat, lighten(style.floorAlt, 0.2), decor)
        return
    }
    if (style.finish === 'gold') {
        // Black marble: a checker of two stones, each tile a little lit.
        for (let i = 0; i < w; i++) {
            for (let j = 0; j < h; j++) {
                const base = (i + j) % 2 ? style.floor : style.floorAlt
                const g = ctx.createLinearGradient(i * 32, j * 32, i * 32 + 32, j * 32 + 32)
                g.addColorStop(0, lighten(base, 0.07))
                g.addColorStop(1, darken(base, 0.1))
                ctx.fillStyle = g
                ctx.fillRect(i * 32, j * 32, 32, 32)
            }
        }
        // Veins: gold ones and faint white ones, running across the tiles.
        ctx.lineCap = 'round'
        for (let k = 0; k < (w + h) * 1.4; k++) {
            ctx.strokeStyle = k % 2 ? rgba(veinColor, 0.42) : rgba('#ffffff', 0.12)
            ctx.lineWidth = k % 2 ? 0.9 : 0.7
            vein(ctx, rng, W, H)
        }
        // Gold inlay between the tiles.
        ctx.strokeStyle = rgba(pat, 0.7)
        ctx.lineWidth = 1.2
        for (let i = 1; i < w; i++) {
            ctx.beginPath()
            ctx.moveTo(i * 32, 0)
            ctx.lineTo(i * 32, H)
            ctx.stroke()
        }
        for (let j = 1; j < h; j++) {
            ctx.beginPath()
            ctx.moveTo(0, j * 32)
            ctx.lineTo(W, j * 32)
            ctx.stroke()
        }
        // Little gold diamonds where the inlay crosses.
        for (let i = 1; i < w; i++) {
            for (let j = 1; j < h; j++) {
                const s = decor >= 2 ? 4.2 : 3.2
                ctx.fillStyle = pat
                ctx.beginPath()
                ctx.moveTo(i * 32, j * 32 - s)
                ctx.lineTo(i * 32 + s, j * 32)
                ctx.lineTo(i * 32, j * 32 + s)
                ctx.lineTo(i * 32 - s, j * 32)
                ctx.closePath()
                ctx.fill()
                ctx.fillStyle = rgba(PAL.goldLight, 0.9)
                ctx.beginPath()
                ctx.arc(i * 32 - s * 0.2, j * 32 - s * 0.2, s * 0.32, 0, Math.PI * 2)
                ctx.fill()
            }
        }
        if (decor >= 3) {
            // A gold star inlaid in every other tile.
            ctx.fillStyle = rgba(pat, 0.55)
            for (let i = 0; i < w; i++) {
                for (let j = 0; j < h; j++) {
                    if ((i + j) % 2) continue
                    ctx.beginPath()
                    sparkle(ctx, i * 32 + 16, j * 32 + 16, 6)
                    ctx.fill()
                }
            }
        }
        for (let k = 0; k < w * h * 0.22; k++) glint(ctx, rng() * W, rng() * H, 2 + rng() * 2.4, PAL.goldLight, 0.85)
        if (decor >= 1) band(ctx, W, H, pat, darken(style.floorAlt, 0.35), decor)
        return
    }
    if (style.finish === 'jade') {
        // Polished green stone: each tile mottled, cloudy and veined.
        for (let i = 0; i < w; i++) {
            for (let j = 0; j < h; j++) {
                ctx.fillStyle = mix(style.floor, style.floorAlt, rng())
                ctx.fillRect(i * 32, j * 32, 32, 32)
                for (let k = 0; k < 2; k++) {
                    const x = i * 32 + rng() * 32
                    const y = j * 32 + rng() * 32
                    const r = 8 + rng() * 12
                    const cloud = ctx.createRadialGradient(x, y, 0, x, y, r)
                    cloud.addColorStop(0, rgba(veinColor, 0.16 + rng() * 0.1))
                    cloud.addColorStop(1, rgba(veinColor, 0))
                    ctx.fillStyle = cloud
                    ctx.fillRect(i * 32, j * 32, 32, 32)
                }
                const lit = ctx.createLinearGradient(i * 32, j * 32, i * 32 + 32, j * 32 + 32)
                lit.addColorStop(0, 'rgba(255, 255, 255, 0.12)')
                lit.addColorStop(1, 'rgba(0, 30, 15, 0.08)')
                ctx.fillStyle = lit
                ctx.fillRect(i * 32, j * 32, 32, 32)
            }
        }
        ctx.lineCap = 'round'
        ctx.strokeStyle = rgba(veinColor, 0.32)
        ctx.lineWidth = 0.7
        for (let k = 0; k < w + h; k++) vein(ctx, rng, W, H)
        // Grout, then gold studs where the tiles meet.
        ctx.strokeStyle = rgba(darken(style.floorAlt, 0.45), 0.55)
        ctx.lineWidth = 1
        for (let i = 1; i < w; i++) {
            ctx.beginPath()
            ctx.moveTo(i * 32, 0)
            ctx.lineTo(i * 32, H)
            ctx.stroke()
        }
        for (let j = 1; j < h; j++) {
            ctx.beginPath()
            ctx.moveTo(0, j * 32)
            ctx.lineTo(W, j * 32)
            ctx.stroke()
        }
        for (let i = 1; i < w; i++) {
            for (let j = 1; j < h; j++) {
                ctx.fillStyle = rgba(darken(pat, 0.4), 0.6)
                ctx.fillRect(i * 32 - 2.6, j * 32 - 2, 5.2, 5.2)
                ctx.fillStyle = pat
                ctx.fillRect(i * 32 - 2.6, j * 32 - 2.6, 5.2, 5.2)
            }
        }
        if (decor >= 3) {
            // Gold rings inlaid in every other tile.
            ctx.strokeStyle = rgba(pat, 0.6)
            ctx.lineWidth = 1.2
            for (let i = 0; i < w; i++) {
                for (let j = 0; j < h; j++) {
                    if ((i + j) % 2) continue
                    ctx.beginPath()
                    ctx.arc(i * 32 + 16, j * 32 + 16, 6, 0, Math.PI * 2)
                    ctx.stroke()
                }
            }
        }
        if (decor >= 1) {
            band(ctx, W, H, pat, darken(style.floorAlt, 0.4), decor)
            // A gold key pattern along the band.
            ctx.strokeStyle = rgba(pat, 0.85)
            ctx.lineWidth = 1
            const inset = 9
            const key = (x: number, y: number, dx: number, dy: number) => {
                // One hook of the fret, 8 px long along (dx, dy), pointing inward.
                const px = -dy
                const py = dx
                ctx.moveTo(x, y)
                ctx.lineTo(x + px * 2.5, y + py * 2.5)
                ctx.lineTo(x + dx * 5 + px * 2.5, y + dy * 5 + py * 2.5)
                ctx.lineTo(x + dx * 5 - px * 1, y + dy * 5 - py * 1)
                ctx.lineTo(x + dx * 2.5 - px * 1, y + dy * 2.5 - py * 1)
            }
            ctx.beginPath()
            for (let u = inset + 4; u < W - inset - 8; u += 8) {
                key(u, inset + 1, 1, 0)
                key(u, H - inset - 1, 1, 0)
            }
            for (let v = inset + 4; v < H - inset - 8; v += 8) {
                key(inset + 1, v, 0, 1)
                key(W - inset - 1, v, 0, 1)
            }
            ctx.stroke()
        }
        return
    }
    // Space: a deep starfield with soft nebula clouds.
    const sky = ctx.createLinearGradient(0, 0, W, H)
    sky.addColorStop(0, lighten(style.floor, 0.06))
    sky.addColorStop(1, style.floorAlt)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, W, H)
    const nebulae = ['#b04ad8', '#3f8fe0', '#e0569e', '#6c5cf0', '#36c2d0']
    for (let k = 0; k < Math.max(4, (w * h) / 6); k++) {
        const x = rng() * W
        const y = rng() * H
        const r = 50 + rng() * 80
        const cloud = ctx.createRadialGradient(x, y, 0, x, y, r)
        const c = nebulae[k % nebulae.length]!
        cloud.addColorStop(0, rgba(c, 0.3 + rng() * 0.12))
        cloud.addColorStop(0.6, rgba(c, 0.1))
        cloud.addColorStop(1, rgba(c, 0))
        ctx.fillStyle = cloud
        ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // Tile edges, faint, so the walkable grid still reads.
    ctx.strokeStyle = rgba(veinColor, 0.16)
    ctx.lineWidth = 0.8
    for (let i = 1; i < w; i++) {
        ctx.beginPath()
        ctx.moveTo(i * 32, 0)
        ctx.lineTo(i * 32, H)
        ctx.stroke()
    }
    for (let j = 1; j < h; j++) {
        ctx.beginPath()
        ctx.moveTo(0, j * 32)
        ctx.lineTo(W, j * 32)
        ctx.stroke()
    }
    const tints = ['#ffffff', '#ffffff', '#ffffff', '#ffe7b0', '#cfe3ff', '#e7cfff']
    for (let k = 0; k < w * h * 7; k++) {
        ctx.fillStyle = rgba(tints[Math.floor(rng() * tints.length)]!, 0.3 + rng() * 0.6)
        ctx.beginPath()
        ctx.arc(rng() * W, rng() * H, 0.4 + rng() * rng() * 1.2, 0, Math.PI * 2)
        ctx.fill()
    }
    // A few constellations: bright stars joined by faint lines.
    const stars = decor >= 3 ? 0.3 : 0.2
    for (let k = 0; k < Math.max(2, (w * h) / 14); k++) {
        let x = rng() * W
        let y = rng() * H
        ctx.strokeStyle = 'rgba(220, 210, 255, 0.22)'
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.moveTo(x, y)
        const pts: [number, number][] = [[x, y]]
        for (let n = 0; n < 3; n++) {
            x += (rng() - 0.5) * 50
            y += (rng() - 0.5) * 50
            ctx.lineTo(x, y)
            pts.push([x, y])
        }
        ctx.stroke()
        for (const [px, py] of pts) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
            ctx.beginPath()
            ctx.arc(px, py, 1.1, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    for (let k = 0; k < w * h * stars; k++) glint(ctx, rng() * W, rng() * H, 2.2 + rng() * 2.6, k % 3 ? '#cfe0ff' : '#ffd7a0', 0.9)
    if (decor >= 1) band(ctx, W, H, style.trim, darken(style.floorAlt, 0.4), decor)
}

function rug(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, style: ZoneStyle, decor: number) {
    ctx.fillStyle = rgba(INK, 0.25)
    roundRect(ctx, x + 2, y + 3, w, h, 6)
    ctx.fill()
    ctx.fillStyle = style.rug
    roundRect(ctx, x, y, w, h, 6)
    ctx.fill()
    ctx.strokeStyle = rgba(PAL.gold, 0.9)
    ctx.lineWidth = 1.6
    roundRect(ctx, x + 5, y + 5, w - 10, h - 10, 4)
    ctx.stroke()
    if (decor >= 3) {
        ctx.fillStyle = rgba(PAL.gold, 0.7)
        const cx = x + w / 2
        const cy = y + h / 2
        ctx.beginPath()
        ctx.moveTo(cx, cy - h * 0.3)
        ctx.lineTo(cx + w * 0.3, cy)
        ctx.lineTo(cx, cy + h * 0.3)
        ctx.lineTo(cx - w * 0.3, cy)
        ctx.closePath()
        ctx.fill()
    }
    // Fringe.
    ctx.strokeStyle = rgba(PAL.cream, 0.8)
    ctx.lineWidth = 0.8
    for (let i = 3; i < w - 2; i += 3) {
        ctx.beginPath()
        ctx.moveTo(x + i, y)
        ctx.lineTo(x + i, y - 3)
        ctx.moveTo(x + i, y + h)
        ctx.lineTo(x + i, y + h + 3)
        ctx.stroke()
    }
}

/** One motif centred at (cx, cy), about r tall, in the current fill/stroke. */
export function motifPath(ctx: CanvasRenderingContext2D, motif: Motif, cx: number, cy: number, r: number) {
    ctx.beginPath()
    switch (motif) {
        case 'fan': {
            // An art deco sunburst: a half disc of rays over a base line.
            for (let k = 0; k < 7; k++) {
                const a0 = Math.PI + (k / 7) * Math.PI
                const a1 = Math.PI + ((k + 0.55) / 7) * Math.PI
                ctx.moveTo(cx, cy + r * 0.4)
                ctx.arc(cx, cy + r * 0.4, r * 1.1, a0, a1)
                ctx.closePath()
            }
            ctx.moveTo(cx + r * 0.3, cy + r * 0.4)
            ctx.arc(cx, cy + r * 0.4, r * 0.3, 0, Math.PI, true)
            ctx.closePath()
            return
        }
        case 'palm':
            ctx.moveTo(cx - r * 0.1, cy + r)
            ctx.quadraticCurveTo(cx + r * 0.25, cy + r * 0.2, cx, cy - r * 0.2)
            ctx.lineTo(cx + r * 0.12, cy - r * 0.2)
            ctx.quadraticCurveTo(cx + r * 0.4, cy + r * 0.2, cx + r * 0.1, cy + r)
            ctx.closePath()
            for (let k = 0; k < 5; k++) {
                const a = -Math.PI * 0.95 + (k / 4) * Math.PI * 0.9
                const lx = cx + Math.cos(a) * r * 0.55
                const ly = cy - r * 0.25 + Math.sin(a) * r * 0.45
                ctx.moveTo(lx + r * 0.42, ly)
                ctx.ellipse(lx, ly, r * 0.42, r * 0.13, a, 0, Math.PI * 2)
            }
            return
        case 'horseshoe':
            ctx.arc(cx, cy, r * 0.8, Math.PI * 0.8, Math.PI * 0.2)
            ctx.arc(cx, cy, r * 0.45, Math.PI * 0.2, Math.PI * 0.8, true)
            ctx.closePath()
            return
        case 'crown':
            ctx.moveTo(cx - r * 0.8, cy + r * 0.5)
            ctx.lineTo(cx - r * 0.9, cy - r * 0.5)
            ctx.lineTo(cx - r * 0.4, cy - r * 0.05)
            ctx.lineTo(cx, cy - r * 0.7)
            ctx.lineTo(cx + r * 0.4, cy - r * 0.05)
            ctx.lineTo(cx + r * 0.9, cy - r * 0.5)
            ctx.lineTo(cx + r * 0.8, cy + r * 0.5)
            ctx.closePath()
            return
        case 'moon':
            ctx.arc(cx, cy, r * 0.75, Math.PI * 0.3, Math.PI * 1.7)
            ctx.arc(cx + r * 0.35, cy - r * 0.1, r * 0.6, Math.PI * 1.55, Math.PI * 0.45, true)
            ctx.closePath()
            // A little star beside it.
            for (let k = 0; k < 10; k++) {
                const rr = k % 2 ? r * 0.1 : r * 0.26
                const a = -Math.PI / 2 + (k * Math.PI) / 5
                const px = cx + r * 0.75 + Math.cos(a) * rr
                const py = cy - r * 0.45 + Math.sin(a) * rr
                if (k === 0) ctx.moveTo(px, py)
                else ctx.lineTo(px, py)
            }
            ctx.closePath()
            return
        case 'snowflake':
            // Six arms with a pair of twigs each, round a hub.
            ctx.moveTo(cx + r * 0.24, cy)
            ctx.arc(cx, cy, r * 0.24, Math.PI * 2, 0, true)
            for (let k = 0; k < 6; k++) {
                const a = -Math.PI / 2 + (k * Math.PI) / 3
                const ax = Math.cos(a)
                const ay = Math.sin(a)
                bar(ctx, cx, cy, cx + ax * r, cy + ay * r, r * 0.08)
                for (const at of [0.42, 0.7]) {
                    const bx = cx + ax * r * at
                    const by = cy + ay * r * at
                    const len = at < 0.5 ? r * 0.34 : r * 0.24
                    for (const side of [-1, 1]) bar(ctx, bx, by, bx + Math.cos(a + side * 0.85) * len, by + Math.sin(a + side * 0.85) * len, r * 0.06)
                }
            }
            return
        case 'diamond':
            // A cut gem (its facets cut out of it) with a glint beside it.
            ctx.moveTo(cx - r * 0.9, cy - r * 0.2)
            ctx.lineTo(cx - r * 0.5, cy - r * 0.65)
            ctx.lineTo(cx + r * 0.5, cy - r * 0.65)
            ctx.lineTo(cx + r * 0.9, cy - r * 0.2)
            ctx.lineTo(cx, cy + r * 0.85)
            ctx.closePath()
            bar(ctx, cx - r * 0.74, cy - r * 0.2, cx + r * 0.74, cy - r * 0.2, r * 0.05)
            for (const side of [-1, 1]) {
                bar(ctx, cx + side * r * 0.3, cy - r * 0.08, cx + side * r * 0.04, cy + r * 0.62, r * 0.045)
                bar(ctx, cx + side * r * 0.2, cy - r * 0.56, cx + side * r * 0.3, cy - r * 0.31, r * 0.045)
            }
            sparkle(ctx, cx + r * 0.86, cy - r * 0.8, r * 0.3)
            return
        case 'lotus': {
            // Five petals over a lily pad.
            const by = cy + r * 0.45
            ctx.moveTo(cx + r * 0.8, by + r * 0.12)
            ctx.ellipse(cx, by + r * 0.12, r * 0.8, r * 0.17, 0, 0, Math.PI * 2)
            for (const [a, len, wd] of [[-1.3, 0.72, 0.32], [1.3, 0.72, 0.32], [-0.66, 0.95, 0.38], [0.66, 0.95, 0.38], [0, 1.12, 0.42]] as const) {
                const c = Math.cos(a)
                const sn = Math.sin(a)
                // Petal points pointing up from the base, turned by a.
                const pt = (x: number, y: number) => [cx + (x * c - y * sn) * r, by + (x * sn + y * c) * r] as const
                const [tx, ty] = pt(0, -len)
                const [lx, ly] = pt(-wd, -len * 0.45)
                const [rx, ry] = pt(wd, -len * 0.45)
                ctx.moveTo(cx, by)
                ctx.quadraticCurveTo(lx, ly, tx, ty)
                ctx.quadraticCurveTo(rx, ry, cx, by)
                ctx.closePath()
            }
            return
        }
        case 'planet': {
            // A ringed planet (the ring clear of it inside) and two stars.
            const tilt = -0.32
            ctx.moveTo(cx + r * 0.5, cy)
            ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2)
            ctx.moveTo(cx + Math.cos(tilt) * r * 1.02, cy + Math.sin(tilt) * r * 1.02)
            ctx.ellipse(cx, cy, r * 1.02, r * 0.32, tilt, 0, Math.PI * 2)
            ctx.moveTo(cx + Math.cos(tilt) * r * 0.74, cy + Math.sin(tilt) * r * 0.74)
            ctx.ellipse(cx, cy, r * 0.74, r * 0.17, tilt, Math.PI * 2, 0, true)
            sparkle(ctx, cx - r * 0.78, cy - r * 0.72, r * 0.26)
            sparkle(ctx, cx + r * 0.72, cy + r * 0.66, r * 0.18)
            return
        }
        case 'none':
    }
}

/** A bar from (x0, y0) to (x1, y1), half as thick as `w`, wound anticlockwise (a hole in a clockwise shape). */
function bar(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number) {
    const len = Math.hypot(x1 - x0, y1 - y0) || 1
    const nx = (-(y1 - y0) / len) * w
    const ny = ((x1 - x0) / len) * w
    ctx.moveTo(x0 + nx, y0 + ny)
    ctx.lineTo(x1 + nx, y1 + ny)
    ctx.lineTo(x1 - nx, y1 - ny)
    ctx.lineTo(x0 - nx, y0 - ny)
    ctx.closePath()
}

/** A four-point glint at (x, y), s from the middle to a tip. */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.moveTo(x, y - s)
    ctx.quadraticCurveTo(x, y, x + s, y)
    ctx.quadraticCurveTo(x, y, x, y + s)
    ctx.quadraticCurveTo(x, y, x - s, y)
    ctx.quadraticCurveTo(x, y, x, y - s)
    ctx.closePath()
}

/**
 * A motif at (cx, cy) on a floor texture (local u/v, see Painter.top), drawn
 * upright on screen as a decal lying on the floor: the iso map is undone
 * around its centre, then squashed a little so it still reads as flat.
 */
function uprightMotif(ctx: CanvasRenderingContext2D, motif: Motif, cx: number, cy: number, r: number) {
    ctx.save()
    ctx.translate(cx, cy)
    // Inverse of the top face's (u - v, (u + v) / 2): screen x/y in local units.
    ctx.transform(0.5, -0.5, 1, 1, 0, 0)
    ctx.scale(1.15, 0.78)
    motifPath(ctx, motif, 0, 0, r)
    ctx.restore()
}

/** A skin's motif on the floor: a big emblem (in the middle, or where EMBLEMS puts it) and small ones strewn across the tiles. */
function motifs(ctx: CanvasRenderingContext2D, w: number, h: number, style: SkinStyle, motif: Motif, place?: { x: number, y: number, r: number }) {
    const W = w * 32
    const H = h * 32
    ctx.fillStyle = rgba(style.pattern, style.kind === 'wood' ? 0.16 : 0.2)
    for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
            if ((i * 2 + j) % 5) continue
            uprightMotif(ctx, motif, i * 32 + 16, j * 32 + 16, 8)
            ctx.fill()
        }
    }
    // The emblem's spot: the middle, unless the zone's furniture covers it there (layout EMBLEMS).
    const r = place ? place.r * 32 : Math.min(W, H) * 0.2
    const cx = place ? place.x * 32 : W / 2
    const cy = place ? place.y * 32 : H / 2
    const rich = !!style.finish
    if (rich) {
        // The dear skins' medallion: a soft halo, a ring of studs and a fine inner ring.
        const halo = ctx.createRadialGradient(cx, cy, r * 1.3, cx, cy, r * 2.1)
        halo.addColorStop(0, rgba(style.pattern, 0.3))
        halo.addColorStop(1, rgba(style.pattern, 0))
        ctx.fillStyle = halo
        ctx.fillRect(cx - r * 2.1, cy - r * 2.1, r * 4.2, r * 4.2)
    }
    ctx.fillStyle = rgba(style.medal ?? darken(style.floor, 0.3), rich ? 0.92 : 0.55)
    ctx.beginPath()
    ctx.arc(cx, cy, r * 1.35, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = rgba(style.pattern, rich ? 1 : 0.8)
    ctx.lineWidth = rich ? 2.6 : 2
    ctx.stroke()
    if (rich) {
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(cx, cy, r * 1.62, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = rgba(lighten(style.pattern, 0.3), 0.5)
        ctx.beginPath()
        ctx.arc(cx, cy, r * 1.16, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = style.pattern
        for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2
            ctx.beginPath()
            ctx.arc(cx + Math.cos(a) * r * 1.49, cy + Math.sin(a) * r * 1.49, k % 2 ? 1.3 : 2, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    // The emblem: a soft drop shadow, the motif in the skin's colour, a lit top edge.
    ctx.save()
    ctx.translate(1.5, 1.5)
    ctx.fillStyle = rgba(darken(style.medal ?? style.floor, 0.5), 0.45)
    uprightMotif(ctx, motif, cx, cy, r)
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = rgba(style.emblem ?? style.pattern, rich ? 0.96 : 0.8)
    uprightMotif(ctx, motif, cx, cy, r)
    ctx.fill()
    ctx.strokeStyle = rgba(lighten(style.emblem ?? style.pattern, 0.35), 0.55)
    ctx.lineWidth = 1
    ctx.stroke()
}

/** A skin's echo on a tall wall: its motif above the wainscot, plus a pattern of its own. */
function wallMotif(ctx: CanvasRenderingContext2D, style: SkinStyle, base: string, trim: string, H: number, plain: boolean, seed: number) {
    const motif = style.motif
    if (style.finish) {
        wallFinish(ctx, style, base, trim, H, plain, seed)
        return
    }
    if (motif === 'fan' || motif === 'crown') {
        // Pinstripes (deco) or damask dots (royal).
        ctx.fillStyle = rgba(trim, 0.28)
        if (motif === 'fan') for (let u = 3; u < 32; u += 6) ctx.fillRect(u, 5, 0.9, H - 36)
        else for (let u = 4; u < 32; u += 8) for (let v = 12; v < H - 34; v += 10) ctx.fillRect(u + ((v / 10) % 2) * 4 - 1, v - 1, 2, 2)
    } else if (motif === 'horseshoe') {
        // Planks.
        ctx.strokeStyle = rgba(darken(base, 0.35), 0.45)
        ctx.lineWidth = 0.8
        for (let u = 8; u < 32; u += 8) {
            ctx.beginPath()
            ctx.moveTo(u, 3)
            ctx.lineTo(u, H - 6)
            ctx.stroke()
        }
    } else if (motif === 'moon') {
        ctx.fillStyle = rgba('#ffffff', 0.5)
        for (const [u, v] of [[5, 12], [22, 18], [13, 30], [27, 40], [8, 46]] as const) if (v < H - 32) ctx.fillRect(u, v, 1.2, 1.2)
    } else if (motif === 'palm') {
        ctx.fillStyle = rgba(lighten(base, 0.3), 0.3)
        for (let u = 0; u < 32; u += 10) {
            ctx.beginPath()
            ctx.ellipse(u + 5, 14, 5, 1.6, -0.5, 0, Math.PI * 2)
            ctx.ellipse(u + 5, 26, 5, 1.6, 0.5, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

/**
 * The premium skins' walls: ice (a frosted glow, crystals and icicles), gold
 * (a harlequin of gold lines under a row of marquee bulbs), jade (gold panels
 * under a fret border) and space (nebula and stars). A plain segment (no
 * picture, window or sconce) also carries the skin's emblem.
 */
function wallFinish(ctx: CanvasRenderingContext2D, style: SkinStyle, base: string, trim: string, H: number, plain: boolean, seed: number) {
    const rng = artRng(seed)
    const top = 5
    const bottom = H - 34
    const emblem = (color: string, alpha: number) => {
        if (!plain) return
        ctx.fillStyle = rgba(darken(base, 0.5), 0.5)
        motifPath(ctx, style.motif, 16.6, 29.6, 8)
        ctx.fill()
        ctx.fillStyle = rgba(color, alpha)
        motifPath(ctx, style.motif, 16, 29, 8)
        ctx.fill()
    }
    if (style.finish === 'ice') {
        const frost = ctx.createLinearGradient(0, 0, 0, H)
        frost.addColorStop(0, 'rgba(255, 255, 255, 0.4)')
        frost.addColorStop(0.55, 'rgba(255, 255, 255, 0.05)')
        frost.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.fillStyle = frost
        ctx.fillRect(0, 0, 32, H)
        ctx.strokeStyle = rgba('#ffffff', 0.55)
        ctx.lineWidth = 0.7
        for (let k = 0; k < 4; k++) crystal(ctx, 3 + rng() * 26, top + 10 + rng() * (bottom - top - 10), 1.8 + rng() * 2.2)
        emblem('#f4fbff', 0.85)
        // Icicles under the crown.
        ctx.fillStyle = rgba(trim, 0.92)
        ctx.beginPath()
        for (let u = 0; u < 32; u += 4) {
            const len = 3 + rng() * 7
            ctx.moveTo(u, 3)
            ctx.lineTo(u + 4, 3)
            ctx.lineTo(u + 1.6 + rng() * 0.8, 3 + len)
            ctx.closePath()
        }
        ctx.fill()
        return
    }
    if (style.finish === 'gold') {
        // Harlequin: gold diagonals with studs where they cross.
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 12, 32, bottom - 12)
        ctx.clip()
        ctx.strokeStyle = rgba(trim, 0.32)
        ctx.lineWidth = 0.8
        ctx.beginPath()
        for (let k = -6; k < 6; k++) {
            ctx.moveTo(k * 16, 12)
            ctx.lineTo(k * 16 + H, 12 + H * 2)
            ctx.moveTo(32 - k * 16, 12)
            ctx.lineTo(32 - k * 16 - H, 12 + H * 2)
        }
        ctx.stroke()
        ctx.fillStyle = rgba(trim, 0.75)
        for (let v = 12; v < bottom + 16; v += 16) {
            for (const u of [0, 16, 32]) ctx.fillRect(u - 1, v - 1, 2, 2)
            for (const u of [8, 24]) ctx.fillRect(u - 1, v + 7, 2, 2)
        }
        ctx.restore()
        emblem(PAL.goldLight, 0.9)
        // A gold rule and a row of marquee bulbs under the crown.
        ctx.fillStyle = trim
        ctx.fillRect(0, 11, 32, 1.2)
        for (const u of [4, 12, 20, 28]) {
            const glow = ctx.createRadialGradient(u, 7, 0, u, 7, 4.5)
            glow.addColorStop(0, 'rgba(255, 236, 160, 0.7)')
            glow.addColorStop(1, 'rgba(255, 236, 160, 0)')
            ctx.fillStyle = glow
            ctx.fillRect(u - 4.5, 2.5, 9, 9)
            ctx.fillStyle = '#fff3c4'
            ctx.beginPath()
            ctx.arc(u, 7, 1.6, 0, Math.PI * 2)
            ctx.fill()
        }
        return
    }
    if (style.finish === 'jade') {
        // Gold-framed panels under a fret border.
        ctx.strokeStyle = rgba(trim, 0.6)
        ctx.lineWidth = 1
        ctx.strokeRect(3.5, 14.5, 25, bottom - 14)
        ctx.strokeStyle = rgba(trim, 0.25)
        ctx.strokeRect(6, 17, 20, bottom - 19)
        ctx.strokeStyle = rgba(trim, 0.85)
        ctx.lineWidth = 0.9
        ctx.beginPath()
        for (let u = 0; u < 32; u += 8) {
            ctx.moveTo(u, 11)
            ctx.lineTo(u, 6)
            ctx.lineTo(u + 6, 6)
            ctx.lineTo(u + 6, 9)
            ctx.lineTo(u + 3, 9)
            ctx.lineTo(u + 3, 11)
            ctx.lineTo(u + 8, 11)
        }
        ctx.stroke()
        emblem(PAL.gold, 0.85)
        return
    }
    // Space.
    const cloud = ctx.createRadialGradient(6 + rng() * 20, 16 + rng() * 20, 0, 16, 26, 30)
    cloud.addColorStop(0, rgba(rng() < 0.5 ? '#b04ad8' : '#3f8fe0', 0.35))
    cloud.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = cloud
    ctx.fillRect(0, 0, 32, bottom)
    for (let k = 0; k < 16; k++) {
        ctx.fillStyle = rgba('#ffffff', 0.35 + rng() * 0.6)
        ctx.beginPath()
        ctx.arc(rng() * 32, top + rng() * (bottom - top), 0.4 + rng() * 0.7, 0, Math.PI * 2)
        ctx.fill()
    }
    emblem(style.emblem ?? style.pattern, 0.85)
    for (let k = 0; k < 2; k++) glint(ctx, 3 + rng() * 26, top + 4 + rng() * (bottom - top - 8), 1.8 + rng() * 1.6, '#cfe0ff', 0.9)
}

/** A zone's floor: pattern by style (its skin) and decor, fogged when not owned. */
export function drawZoneFloor(p: Painter, zone: ZoneId, look: ZoneLook, decor: number, name: string, skin: SkinId = 'classic') {
    const { ctx } = p
    const rect = ZONE_RECTS[zone]
    // A skin only shows on an owned zone; the blueprint of one for sale stays the zone's own.
    const style = look === 'owned' ? skinStyle(zone, skin) : skinStyle(zone)
    const owned = look === 'owned'
    const W = rect.w * 32
    const H = rect.h * 32
    if (owned) slabSides(p, rect, owned)
    p.top(rect.x, rect.y, 0)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, W, H)
    ctx.clip()
    if (owned) {
        if (style.finish) {
            finishFloor(ctx, rect.w, rect.h, style, decor, hashString(zone))
        } else if (style.kind === 'wood') {
            woodFloor(ctx, rect.w, rect.h, style, hashString(zone))
            if (decor >= 2) rug(ctx, 3 * 32 + 4, 1.2 * 32, 2 * 32 - 8, 4.6 * 32, style, decor)
            if (decor >= 4) {
                ctx.strokeStyle = rgba(PAL.gold, 0.6)
                ctx.lineWidth = 1.4
                ctx.strokeRect(4, 4, W - 8, H - 8)
            }
        } else if (style.kind === 'marble') {
            marble(ctx, rect.w, rect.h, style, decor, hashString(zone))
            if (decor >= 4) rug(ctx, 2 * 32, 2 * 32, 3.4 * 32, 1.6 * 32, style, decor)
        } else {
            carpet(ctx, rect.w, rect.h, style, decor)
        }
        if (style.motif !== 'none') motifs(ctx, rect.w, rect.h, style, style.motif, EMBLEMS[zone])
        // Faint tile grid for click-to-walk.
        ctx.strokeStyle = 'rgba(30, 10, 40, 0.07)'
        ctx.lineWidth = 0.8
        for (let i = 1; i < rect.w; i++) {
            ctx.beginPath()
            ctx.moveTo(i * 32, 0)
            ctx.lineTo(i * 32, H)
            ctx.stroke()
        }
        for (let j = 1; j < rect.h; j++) {
            ctx.beginPath()
            ctx.moveTo(0, j * 32)
            ctx.lineTo(W, j * 32)
            ctx.stroke()
        }
        // A soft sheen toward the middle.
        const sheen = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.max(W, H) * 0.7)
        sheen.addColorStop(0, 'rgba(255, 236, 200, 0.2)')
        sheen.addColorStop(1, 'rgba(255, 240, 210, 0)')
        ctx.fillStyle = sheen
        ctx.fillRect(0, 0, W, H)
    } else {
        // A zone for sale: a soft, dusky floor that fades out away from the doorway side.
        ctx.globalAlpha = 0.85
        ctx.fillStyle = look === 'locked' ? PAL.fogAlt : PAL.fog
        ctx.fillRect(0, 0, W, H)
        // The zone's own checkered tiles, dimmed: a blueprint of what's to come.
        for (let i = 0; i < rect.w; i++) {
            for (let j = 0; j < rect.h; j++) {
                ctx.fillStyle = rgba(desaturate((i + j) % 2 ? style.floor : style.floorAlt, 0.45), (i + j) % 2 ? 0.2 : 0.3)
                ctx.fillRect(i * 32, j * 32, 32, 32)
            }
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
        ctx.lineWidth = 0.8
        for (let i = 1; i < rect.w; i++) {
            ctx.beginPath()
            ctx.moveTo(i * 32, 0)
            ctx.lineTo(i * 32, H)
            ctx.stroke()
        }
        for (let j = 1; j < rect.h; j++) {
            ctx.beginPath()
            ctx.moveTo(0, j * 32)
            ctx.lineTo(W, j * 32)
            ctx.stroke()
        }
        if (look === 'locked') {
            ctx.setLineDash([8, 7])
            ctx.strokeStyle = 'rgba(255, 240, 220, 0.22)'
            ctx.lineWidth = 1.8
            ctx.strokeRect(7, 7, W - 14, H - 14)
            ctx.setLineDash([])
        }
        if (look === 'available') {
            ctx.setLineDash([10, 7])
            ctx.strokeStyle = rgba(PAL.gold, 0.6)
            ctx.lineWidth = 2.2
            ctx.strokeRect(7, 7, W - 14, H - 14)
            ctx.setLineDash([])
        }
        if (look === 'building') {
            ctx.lineWidth = 6
            for (let k = 0; k < (W + H) / 8; k++) {
                ctx.strokeStyle = k % 2 ? 'rgba(255, 210, 63, 0.55)' : 'rgba(42, 27, 48, 0.55)'
                ctx.beginPath()
                ctx.moveTo(k * 8, 0)
                ctx.lineTo(k * 8, 6)
                ctx.stroke()
            }
            ctx.strokeStyle = 'rgba(255, 210, 63, 0.45)'
            ctx.lineWidth = 2
            ctx.setLineDash([12, 8])
            ctx.strokeRect(7, 7, W - 14, H - 14)
            ctx.setLineDash([])
        }
        // The zone's name painted on the floor.
        const size = Math.min(26, (Math.min(W, H) / 4.2))
        ctx.font = `${size}px "Lilita One", system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = look === 'locked' ? 'rgba(255, 240, 220, 0.16)' : 'rgba(255, 233, 166, 0.28)'
        ctx.fillText(name.toUpperCase(), W / 2, H / 2, W - 24)
    }
    ctx.restore()
    if (!owned) {
        p.reset()
        return
    }
    // Ambient occlusion along the back edges, where walls stand.
    const ao = 0.3
    let g = ctx.createLinearGradient(0, 0, 16, 0)
    g.addColorStop(0, `rgba(25, 10, 35, ${ao})`)
    g.addColorStop(1, 'rgba(25, 10, 35, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 16, H)
    g = ctx.createLinearGradient(0, 0, 0, 16)
    g.addColorStop(0, `rgba(25, 10, 35, ${ao})`)
    g.addColorStop(1, 'rgba(25, 10, 35, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, 16)
    p.reset()
}

/** The entrance porch: a red carpet with gold edges. */
export function drawPorch(p: Painter, tiles: { x: number, y: number }[]) {
    const { ctx } = p
    const minX = Math.min(...tiles.map(t => t.x))
    const maxX = Math.max(...tiles.map(t => t.x)) + 1
    const y = tiles[0]!.y
    const rect = { x: minX, y, w: maxX - minX, h: 1 }
    // Steps down at the front.
    for (const [dz, inset] of [[0, 0], [-SLAB / 2, 0.15]] as const) {
        const [x1, y1] = p.pt(rect.x + inset, y + 1 + inset * 0.6, dz)
        const [x2, y2] = p.pt(maxX - inset, y + 1 + inset * 0.6, dz)
        p.reset()
        ctx.fillStyle = darken(PAL.slab, 0.1)
        ctx.strokeStyle = INK
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.lineTo(x2, y2 + SLAB / 2)
        ctx.lineTo(x1, y1 + SLAB / 2)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
    }
    const [rx1, ry1] = p.pt(maxX, y, 0)
    const [rx2, ry2] = p.pt(maxX, y + 1, 0)
    ctx.fillStyle = darken(PAL.slab, 0.35)
    ctx.beginPath()
    ctx.moveTo(rx1, ry1)
    ctx.lineTo(rx2, ry2)
    ctx.lineTo(rx2, ry2 + SLAB)
    ctx.lineTo(rx1, ry1 + SLAB)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    p.top(rect.x, rect.y, 0)
    ctx.fillStyle = PAL.slab
    ctx.fillRect(0, 0, rect.w * 32, 32)
    ctx.fillStyle = PAL.velvet
    ctx.fillRect(6, 0, rect.w * 32 - 12, 32)
    ctx.strokeStyle = PAL.gold
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(8, 0)
    ctx.lineTo(8, 32)
    ctx.moveTo(rect.w * 32 - 8, 0)
    ctx.lineTo(rect.w * 32 - 8, 32)
    ctx.stroke()
    p.reset()
}

/** The soft shadow under every visible zone, on the backdrop. */
export function drawBuildingShadow(p: Painter, rects: Rect[], owned: ReadonlySet<ZoneId>) {
    const { ctx } = p
    ctx.save()
    p.reset()
    const off = 6000
    // Shadow settings are in canvas pixels (not scaled by the transform).
    ctx.shadowBlur = 20 * p.res
    ctx.shadowOffsetX = off * p.res
    ctx.shadowOffsetY = 18 * p.res
    for (const pass of [true, false]) {
        ctx.shadowColor = pass ? 'rgba(5, 2, 12, 0.7)' : 'rgba(5, 2, 12, 0.3)'
        ctx.beginPath()
        for (const id of Object.keys(ZONE_RECTS) as ZoneId[]) {
            const r = ZONE_RECTS[id]
            if (!rects.includes(r) || owned.has(id) !== pass) continue
            const pts: [number, number][] = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]
            pts.forEach(([gx, gy], i) => {
                const [x, y] = p.pt(gx, gy, -SLAB)
                if (i === 0) ctx.moveTo(x - off, y)
                else ctx.lineTo(x - off, y)
            })
            ctx.closePath()
        }
        ctx.fillStyle = '#000'
        ctx.fill()
    }
    ctx.restore()
}

/** The backdrop behind the floor: a warm dusk with soft bokeh lights. */
export function drawBackdrop(ctx: CanvasRenderingContext2D, size: number) {
    const g = ctx.createLinearGradient(0, 0, 0, size)
    g.addColorStop(0, '#4b2f63')
    g.addColorStop(0.55, '#33224d')
    g.addColorStop(1, '#1f1633')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    const glow = ctx.createRadialGradient(size / 2, size * 0.55, 0, size / 2, size * 0.55, size * 0.62)
    glow.addColorStop(0, 'rgba(255, 166, 92, 0.30)')
    glow.addColorStop(0.5, 'rgba(240, 110, 120, 0.12)')
    glow.addColorStop(1, 'rgba(240, 110, 120, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, size, size)
    const rng = artRng(7)
    const colors = ['255, 214, 120', '255, 140, 170', '140, 220, 255', '255, 255, 255']
    for (let i = 0; i < 46; i++) {
        const x = rng() * size
        const y = rng() * size
        const r = 1.5 + rng() * rng() * 12
        const c = colors[Math.floor(rng() * colors.length)]!
        const b = ctx.createRadialGradient(x, y, 0, x, y, r)
        b.addColorStop(0, `rgba(${c}, ${0.1 + rng() * 0.16})`)
        b.addColorStop(1, `rgba(${c}, 0)`)
        ctx.fillStyle = b
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
    }
}

// ── walls ──────────────────────────────────────────────────────────────────

export type WallVariant = 'plain' | 'art' | 'window' | 'sconce'

export interface WallLook {
    zone: ZoneId
    owned: boolean
    tall: boolean
    decor: number
    variant: WallVariant
    /** The zone's skin (owned walls only). */
    skin?: SkinId
}

export function wallKey(axis: 'x' | 'y', look: WallLook): string {
    const skin = look.owned && look.skin && look.skin !== 'classic' ? `:${look.skin}` : ''
    return `wall:${axis}:${look.zone}:${look.owned ? 1 : 0}:${look.tall ? 1 : 0}:${look.owned ? look.decor : 0}:${look.owned ? look.variant : 'plain'}${skin}`
}

function wallColors(look: WallLook): { base: string, trim: string } {
    const style = skinStyle(look.zone, look.owned ? look.skin : 'classic')
    if (!look.owned) return { base: PAL.fogWall, trim: PAL.fogWallDark }
    // Decor 3 gilds the trim, except on the premium skins (theirs is part of the theme).
    return { base: style.wall, trim: look.decor >= 3 && !style.finish ? PAL.gold : style.trim }
}

/** Where a sconce's light sits on a wall segment (local px). */
export function sconceLight(axis: 'x' | 'y'): { x: number, y: number } {
    // Middle of the segment's face, about two thirds up the wall.
    return axis === 'y' ? { x: 16, y: 8 - WALL_TALL + 30 } : { x: -16, y: 8 - WALL_TALL + 30 }
}

function wallFace(ctx: CanvasRenderingContext2D, look: WallLook, H: number, shade: boolean, seed: number) {
    const { base, trim } = wallColors(look)
    if (look.owned && look.tall) {
        if (look.decor >= 2) {
            // Wallpaper stripes.
            for (let u = 0; u < 32; u += 8) {
                ctx.fillStyle = rgba(lighten(base, 0.2), 0.16)
                ctx.fillRect(u, 6, 4, H - 12)
            }
        }
        if (look.decor >= 4) {
            ctx.fillStyle = rgba(trim, 0.35)
            for (let u = 4; u < 32; u += 8) {
                for (let v = 14; v < H - 34; v += 12) {
                    ctx.beginPath()
                    ctx.arc(u + ((v / 12) % 2) * 4, v, 1.3, 0, Math.PI * 2)
                    ctx.fill()
                }
            }
        }
        const style = skinStyle(look.zone, look.skin)
        if (style.motif !== 'none') wallMotif(ctx, style, base, trim, H, look.variant === 'plain', seed)
        if (look.decor >= 1) {
            ctx.fillStyle = rgba(darken(base, 0.25), 0.9)
            ctx.fillRect(0, H - 30, 32, 24)
            ctx.strokeStyle = rgba(lighten(base, 0.15), 0.5)
            ctx.lineWidth = 0.8
            ctx.strokeRect(4, H - 26, 24, 16)
            ctx.fillStyle = trim
            ctx.fillRect(0, H - 31.5, 32, 2.4)
        }
        if (look.variant === 'art') {
            const rng = artRng(seed)
            ctx.fillStyle = INK
            roundRect(ctx, 6, 14, 20, 22, 2)
            ctx.fill()
            ctx.fillStyle = look.decor >= 3 ? PAL.gold : PAL.woodLight
            roundRect(ctx, 7, 15, 18, 20, 1.5)
            ctx.fill()
            const sky = ctx.createLinearGradient(0, 17, 0, 33)
            const hues = [['#ffb86b', '#ff6f91'], ['#7dd3fc', '#a78bfa'], ['#fde68a', '#34d399']][Math.floor(rng() * 3)]!
            sky.addColorStop(0, hues[0]!)
            sky.addColorStop(1, hues[1]!)
            ctx.fillStyle = sky
            ctx.fillRect(9, 17, 14, 16)
            ctx.fillStyle = rgba(INK, 0.45)
            ctx.beginPath()
            ctx.moveTo(9, 33)
            ctx.lineTo(14, 25)
            ctx.lineTo(18, 29)
            ctx.lineTo(23, 22)
            ctx.lineTo(23, 33)
            ctx.closePath()
            ctx.fill()
            ctx.fillStyle = '#fff6d5'
            ctx.beginPath()
            ctx.arc(12, 21, 2, 0, Math.PI * 2)
            ctx.fill()
        } else if (look.variant === 'window') {
            ctx.fillStyle = INK
            roundRect(ctx, 6.5, 10, 19, 32, 9)
            ctx.fill()
            ctx.fillStyle = PAL.cream
            roundRect(ctx, 7.5, 11, 17, 30, 8)
            ctx.fill()
            const night = ctx.createLinearGradient(0, 12, 0, 40)
            night.addColorStop(0, '#1b2a5e')
            night.addColorStop(1, '#6b4fa0')
            ctx.fillStyle = night
            roundRect(ctx, 9.5, 13, 13, 26, 6.5)
            ctx.fill()
            ctx.fillStyle = '#fff6d5'
            ctx.beginPath()
            ctx.arc(18, 19, 2.6, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = rgba('#ffffff', 0.8)
            for (const [sx, sy] of [[12, 17], [14, 27], [20, 31], [11, 34]]) ctx.fillRect(sx!, sy!, 1, 1)
            ctx.strokeStyle = PAL.cream
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.moveTo(16, 13)
            ctx.lineTo(16, 39)
            ctx.moveTo(9.5, 26)
            ctx.lineTo(22.5, 26)
            ctx.stroke()
        } else if (look.variant === 'sconce') {
            ctx.fillStyle = INK
            roundRect(ctx, 12.5, 24, 7, 12, 3)
            ctx.fill()
            ctx.fillStyle = PAL.gold
            roundRect(ctx, 13.5, 25, 5, 10, 2.5)
            ctx.fill()
            ctx.fillStyle = PAL.cream
            ctx.fillRect(15, 18, 2, 7)
            ctx.fillStyle = '#ffd23f'
            ctx.beginPath()
            ctx.ellipse(16, 16, 1.8, 3, 0, 0, Math.PI * 2)
            ctx.fill()
        }
        // Skirting board.
        ctx.fillStyle = darken(base, 0.45)
        ctx.fillRect(0, H - 6, 32, 6)
        // Crown.
        ctx.fillStyle = trim
        ctx.fillRect(0, 0, 32, 3)
    } else if (look.tall) {
        ctx.fillStyle = 'rgba(0,0,0,0.12)'
        ctx.fillRect(0, H - 6, 32, 6)
    } else {
        // Low partition: a panel line.
        ctx.strokeStyle = rgba(lighten(base, 0.2), 0.5)
        ctx.lineWidth = 0.8
        ctx.strokeRect(3, 4, 26, H - 8)
    }
    if (shade) {
        ctx.fillStyle = 'rgba(25, 10, 35, 0.22)'
        ctx.fillRect(-1, -1, 34, H + 2)
    }
}

/**
 * One wall segment. Axis 'y': along gx on the line gy = 0, from gx 0 to 1,
 * thickness behind (gy < 0). Axis 'x': along gy on gx = 0, from gy 0 to 1.
 */
export function drawWall(p: Painter, axis: 'x' | 'y', look: WallLook, seed: number) {
    const { ctx } = p
    const H = look.tall ? WALL_TALL : WALL_LOW
    const { base, trim } = wallColors(look)
    const cols = faceColors(base, 0.1)
    if (axis === 'y') {
        p.box(0, -WALL_T, 0, 1, WALL_T, H, cols, { shine: false })
        p.faceY(0, 0, H)
        wallFace(ctx, look, H, false, seed)
        p.reset()
    } else {
        p.box(-WALL_T, 0, 0, WALL_T, 1, H, cols, { shine: false })
        p.faceX(0, 1, H)
        wallFace(ctx, look, H, true, seed)
        p.reset()
    }
    // Cap rail.
    const capCols = look.owned && !look.tall ? faceColors(look.decor >= 3 ? PAL.gold : PAL.woodLight) : faceColors(trim, 0.12)
    if (axis === 'y') p.box(0, -WALL_T - 0.03, H, 1, WALL_T + 0.06, look.tall ? 4 : 4, capCols, { lineWidth: 1.2 })
    else p.box(-WALL_T - 0.03, 0, H, WALL_T + 0.06, 1, 4, capCols, { lineWidth: 1.2 })
}

/** A pillar where walls meet or end. Centred on the vertex. */
export function drawPillar(p: Painter, look: WallLook) {
    const H = (look.tall ? WALL_TALL : WALL_LOW) + 6
    const { base, trim } = wallColors(look)
    const s = 0.13
    p.box(-s, -s, 0, s * 1.4, s * 1.4, H, faceColors(darken(base, 0.12), 0.12))
    p.box(-s - 0.03, -s - 0.03, H, s * 1.4 + 0.06, s * 1.4 + 0.06, 4, faceColors(look.owned ? trim : PAL.fogWallDark, 0.12), { lineWidth: 1.2 })
}

export function wallHeight(tall: boolean): number {
    return tall ? WALL_TALL + 6 : WALL_LOW + 6
}
