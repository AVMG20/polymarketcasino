import type { Archetype } from '#shared/tycoon'
import { INK, Painter, circlePoly, darken, faceColors, lighten, mix, project, rgba, roundRect, roundRectPoly, type Pt } from '../iso'
import { ARCH_SIZE } from '../layout'
import { DEALER_LOOK, DEALER_LOOK_2, drawFigure } from './characters'
import { PAL } from './palette'

/**
 * The machines on the floor, one draw function per archetype. Each draws a
 * whole machine in its footprint's grid space (origin = the footprint's back
 * corner) at a level 1..5; higher levels add cabinets, trim, lights and
 * signs, and the golden skin swaps the body for gold. Moving parts (reels,
 * wheels, the rocket) are left out and animated as overlays; the geometry
 * helpers below tell the overlays where to sit.
 */

export interface MachineOpts {
    accent: string
    level: number
    golden: boolean
    name: string
    /** Card tables: number of stools. */
    seats: number
}

export interface MachineInfo {
    /** Bulb positions (local px) for twinkle overlays. */
    lights: Pt[]
    /** How tall the machine stands, px above the floor. */
    height: number
}

/** Px above the floor a machine of this archetype and level reaches (for canvas size and labels). */
export function machineHeight(arch: Archetype, level: number): number {
    switch (arch) {
        case 'slot': return level >= 5 ? 112 : level >= 2 ? 82 : 64
        case 'dice': return level >= 5 ? 96 : level >= 3 ? 76 : 50
        case 'rocket': return level >= 3 ? 96 : 70
        case 'wheel': return level >= 3 ? 116 : 96
        case 'flight': return level >= 3 ? 56 : 40
        case 'hands': return level >= 3 ? 84 : 52
        case 'roulette': return level >= 5 ? 104 : level >= 3 ? 100 : 52
        case 'cards': return level >= 3 ? 100 : 54
        case 'plinko': return level >= 5 ? 116 : level >= 3 ? 102 : 80
        case 'mines': return level >= 4 ? 84 : level >= 3 ? 76 : 52
        case 'hilo': return level >= 4 ? 96 : level >= 3 ? 84 : 66
    }
}

const local = (gx: number, gy: number, z = 0): Pt => project(gx, gy, z)

/** Faces-plane point (u, v) on the plane gy = const starting at `o`. */
const onFaceY = (o: Pt, u: number, v: number): Pt => ({ x: o.x + u, y: o.y + 0.5 * u + v })

function bodyOf(o: MachineOpts): string {
    return o.golden ? PAL.gold : o.accent
}

function trimOf(o: MachineOpts): string {
    return o.golden ? lighten(o.accent, 0.1) : o.level >= 4 ? PAL.gold : darken(o.accent, 0.35)
}

function goldColors(): ReturnType<typeof faceColors> {
    return { top: PAL.goldLight, left: PAL.gold, right: PAL.goldDark }
}

function bulb(p: Painter, at: Pt, r = 1.7, color = PAL.goldLight) {
    const { ctx } = p
    p.reset()
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(p.ox + at.x, p.oy + at.y, r + 0.9, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(p.ox + at.x, p.oy + at.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.beginPath()
    ctx.arc(p.ox + at.x - r * 0.3, p.oy + at.y - r * 0.3, r * 0.4, 0, Math.PI * 2)
    ctx.fill()
}

/** The rounded floor plate every machine stands on. */
function plate(p: Painter, w: number, h: number, o: MachineOpts) {
    const { ctx } = p
    p.top(0, 0, 0)
    roundRect(ctx, 2, 2, w * 32 - 4, h * 32 - 4, 9)
    ctx.fillStyle = rgba(darken(o.accent, 0.35), 0.35)
    ctx.fill()
    ctx.lineWidth = 1.6
    ctx.strokeStyle = o.level >= 3 || o.golden ? rgba(PAL.gold, 0.85) : rgba(lighten(o.accent, 0.2), 0.5)
    ctx.stroke()
    p.reset()
}

function hangingLamp(p: Painter, gx: number, gy: number, z: number, shade: string) {
    const { ctx } = p
    const [x, y] = p.pt(gx, gy, z)
    p.reset()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(x, y - 30)
    ctx.lineTo(x, y - 6)
    ctx.stroke()
    ctx.fillStyle = shade
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(x - 4, y - 7)
    ctx.lineTo(x + 4, y - 7)
    ctx.lineTo(x + 11, y + 2)
    ctx.quadraticCurveTo(x, y + 5, x - 11, y + 2)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = PAL.goldLight
    ctx.beginPath()
    ctx.ellipse(x, y + 2.5, 7, 2, 0, 0, Math.PI * 2)
    ctx.fill()
}

/** A sign board standing on two posts behind a table, with the game's name. */
function backSign(p: Painter, x: number, w: number, z: number, h: number, o: MachineOpts, lights: Pt[]) {
    const post = o.golden || o.level >= 4 ? goldColors() : faceColors(PAL.woodDark)
    p.box(x + 0.08, 0.04, 0, 0.07, 0.07, z, post)
    p.box(x + w - 0.15, 0.04, 0, 0.07, 0.07, z, post)
    p.box(x, 0.02, z, w, 0.12, h, o.golden ? goldColors() : faceColors(darken(o.accent, 0.25)))
    const { ctx } = p
    p.faceY(x, 0.14, z + h)
    roundRect(ctx, 3, 3, w * 32 - 6, h - 6, 4)
    ctx.fillStyle = PAL.screen
    ctx.fill()
    ctx.strokeStyle = PAL.gold
    ctx.lineWidth = 1.2
    ctx.stroke()
    p.text(o.name.toUpperCase(), (w * 32) / 2, h / 2, Math.min(12, h - 7), PAL.goldLight, { stroke: INK, strokeWidth: 2.4, maxWidth: w * 32 - 12 })
    p.reset()
    if (o.level >= 4) {
        const origin = local(x, 0.14, z + h)
        const n = Math.round(w * 4)
        for (let i = 0; i <= n; i++) {
            lights.push(onFaceY(origin, (i / n) * w * 32, 1))
            lights.push(onFaceY(origin, (i / n) * w * 32, h - 1))
        }
    }
}

// ── slot bank ──────────────────────────────────────────────────────────────

export interface SlotCabinet {
    x: number
    w: number
}

export function slotCabinets(level: number): SlotCabinet[] {
    const n = level >= 3 ? 3 : 2
    const w = 0.84
    const step = 0.96
    const start = (3 - (n - 1) * step - w) / 2
    return Array.from({ length: n }, (_, i) => ({ x: start + i * step, w }))
}

const CAB_FRONT = 0.78
const CAB_TOP = 58

/** The reel window of each cabinet: the face-plane origin and the window rect inside it. */
export function slotScreens(level: number): { origin: Pt, x: number, y: number, w: number, h: number }[] {
    return slotCabinets(level).map(cab => ({ origin: local(cab.x, CAB_FRONT, CAB_TOP), x: 5, y: 8, w: cab.w * 32 - 10, h: 16 }))
}

function drawSlot(p: Painter, o: MachineOpts): MachineInfo {
    const { ctx } = p
    const body = bodyOf(o)
    const lights: Pt[] = []
    plate(p, 3, 1, o)
    if (o.level >= 5) {
        // Marquee posts first: they stand behind the cabinets.
        const post = goldColors()
        p.box(0.12, 0.24, 0, 0.08, 0.08, 92, post)
        p.box(2.8, 0.24, 0, 0.08, 0.08, 92, post)
    }
    for (const cab of slotCabinets(o.level)) {
        const { x, w } = cab
        p.box(x - 0.03, 0.14, 0, w + 0.06, 0.72, 8, darken(body, 0.5))
        p.box(x, 0.2, 8, w, CAB_FRONT - 0.2, CAB_TOP - 8, body)
        const fw = w * 32
        // Side panel stripe on the +x face.
        p.faceX(x + w, CAB_FRONT, CAB_TOP)
        ctx.fillStyle = rgba('#ffffff', 0.14)
        roundRect(ctx, 3, 6, (CAB_FRONT - 0.2) * 32 - 6, 5, 2.5)
        ctx.fill()
        // Front: bezel, screen, belly panel.
        p.faceY(x, CAB_FRONT, CAB_TOP)
        roundRect(ctx, 2.5, 5, fw - 5, 22, 4)
        ctx.fillStyle = o.golden || o.level >= 4 ? PAL.goldDark : darken(body, 0.45)
        ctx.fill()
        roundRect(ctx, 4.5, 7, fw - 9, 18, 3)
        ctx.fillStyle = PAL.screen
        ctx.fill()
        ctx.strokeStyle = rgba(o.accent, 0.9)
        ctx.lineWidth = 1
        ctx.stroke()
        roundRect(ctx, 5, 35, fw - 10, 13, 3.5)
        const belly = ctx.createLinearGradient(0, 35, 0, 48)
        belly.addColorStop(0, lighten(o.golden ? o.accent : body, 0.35))
        belly.addColorStop(1, lighten(o.golden ? o.accent : body, 0.1))
        ctx.fillStyle = belly
        ctx.fill()
        ctx.strokeStyle = rgba(INK, 0.6)
        ctx.lineWidth = 1
        ctx.stroke()
        p.text('7', fw / 2, 41.5, 11, o.level >= 4 || o.golden ? PAL.goldLight : '#ffffff', { stroke: INK, strokeWidth: 2.2 })
        p.reset()
        // Button deck sticking out under the screen.
        p.box(x + 0.06, CAB_FRONT, 26, w - 0.12, 0.13, 4, darken(body, 0.25), { lineWidth: 1.2 })
        p.top(x + 0.06, CAB_FRONT, 30)
        const deckW = (w - 0.12) * 32
        const colors = ['#ff5a5f', '#ffd23f', '#4ade80']
        colors.forEach((c, i) => {
            ctx.fillStyle = c
            ctx.beginPath()
            ctx.arc(deckW * (0.25 + i * 0.25), 2, 1.6, 0, Math.PI * 2)
            ctx.fill()
        })
        p.reset()
        if (o.level >= 2) {
            // Topper with an emblem, and the candle light slot machines wear.
            const top = o.golden ? lighten(o.accent, 0.05) : lighten(body, 0.12)
            p.box(x + 0.05, 0.26, CAB_TOP, w - 0.1, 0.46, 14, top)
            p.faceY(x + 0.05, 0.72, CAB_TOP + 14)
            const tw = (w - 0.1) * 32
            roundRect(ctx, 2.5, 2.5, tw - 5, 9, 4)
            ctx.fillStyle = o.level >= 4 || o.golden ? PAL.gold : PAL.cream
            ctx.fill()
            p.text('★', tw / 2, 7.3, 8, o.level >= 4 || o.golden ? '#b91c1c' : darken(o.accent, 0.2))
            p.reset()
            p.cylinder(x + w / 2, 0.49, CAB_TOP + 14, 0.07, 7, faceColors(lighten(o.accent, 0.35), 0.3), { lineWidth: 1.2 })
        } else {
            p.box(x + 0.02, 0.22, CAB_TOP, w - 0.04, CAB_FRONT - 0.24, 4, lighten(body, 0.2))
        }
        if (o.level >= 4) {
            const origin = local(x, CAB_FRONT, CAB_TOP)
            for (let i = 0; i < 4; i++) {
                const at = onFaceY(origin, 4 + (i * (fw - 8)) / 3, 3)
                bulb(p, at, 1.4)
                lights.push(at)
            }
        }
    }
    if (o.level >= 5) {
        p.box(0.06, 0.2, 90, 2.88, 0.14, 22, o.golden ? goldColors() : faceColors(darken(o.accent, 0.3)))
        p.faceY(0.06, 0.34, 112)
        roundRect(ctx, 3, 3, 2.88 * 32 - 6, 16, 5)
        ctx.fillStyle = PAL.screen
        ctx.fill()
        ctx.strokeStyle = PAL.gold
        ctx.lineWidth = 1.4
        ctx.stroke()
        p.text(o.name.toUpperCase(), (2.88 * 32) / 2, 11.5, 12, PAL.goldLight, { stroke: INK, strokeWidth: 2.6, maxWidth: 2.88 * 32 - 14 })
        p.reset()
        const origin = local(0.06, 0.34, 112)
        for (let i = 0; i <= 12; i++) {
            const at = onFaceY(origin, (i / 12) * 2.88 * 32, 0.5)
            bulb(p, at, 1.5)
            lights.push(at)
        }
    }
    return { lights, height: machineHeight('slot', o.level) }
}

// ── dice table ─────────────────────────────────────────────────────────────

export const DICE_SPOTS: Pt[] = [local(0.85, 1.12, 21), local(1.15, 1.28, 21)]

function drawDice(p: Painter, o: MachineOpts): MachineInfo {
    const { ctx } = p
    const lights: Pt[] = []
    const rail = o.golden ? goldColors() : faceColors(o.level >= 4 ? PAL.woodLight : PAL.wood)
    const felt = mix(o.accent, '#1d5a3c', 0.4)
    plate(p, 2, 2, o)
    if (o.level >= 3) {
        // A sign post at the back corner with a big die on it.
        p.box(1.78, 0.12, 0, 0.07, 0.07, 58, o.level >= 4 || o.golden ? goldColors() : faceColors(PAL.woodDark))
        const [sx, sy] = p.pt(1.815, 0.155, 66)
        p.reset()
        ctx.fillStyle = INK
        roundRect(ctx, sx - 11, sy - 11, 22, 22, 6)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        roundRect(ctx, sx - 9.5, sy - 9.5, 19, 19, 5)
        ctx.fill()
        ctx.fillStyle = o.accent
        for (const [dx, dy] of [[-4.5, -4.5], [4.5, 4.5], [0, 0], [-4.5, 4.5], [4.5, -4.5]]) {
            ctx.beginPath()
            ctx.arc(sx + dx!, sy + dy!, 2, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    if (o.level >= 2) {
        p.reset()
        const [dx, dy] = p.pt(1.0, 0.34, 0)
        drawFigure(ctx, dx, dy, DEALER_LOOK, 'front', 0, 0)
    }
    p.box(0.55, 0.85, 0, 0.9, 0.7, 12, PAL.woodDark)
    const tablePoly = roundRectPoly(0.1, 0.55, 1.8, 1.36, 0.45)
    p.prism(tablePoly, 12, 9, rail)
    const feltPoly = roundRectPoly(0.22, 0.67, 1.56, 1.12, 0.34)
    p.flat(feltPoly, 21, felt, darken(felt, 0.25), 1.2)
    p.top(0, 0, 21)
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 1.2
    roundRect(ctx, 0.34 * 32, 0.79 * 32, 1.32 * 32, 0.88 * 32, 9)
    ctx.stroke()
    p.text('PASS LINE', 1.0 * 32, 1.55 * 32, 5.5, 'rgba(255,255,255,0.6)', { font: '"Fredoka", system-ui, sans-serif' })
    p.reset()
    if (o.level >= 2) {
        const chips: [number, number, string, number][] = [[0.45, 0.95, PAL.chip, 5], [0.55, 1.0, '#3b82f6', 3], [1.55, 1.5, '#16a34a', 6], [1.45, 1.6, PAL.chip, 3]]
        for (const [cx, cy, c, h] of chips) p.cylinder(cx, cy, 21, 0.075, h, faceColors(c), { lineWidth: 1 })
    }
    if (o.level >= 4) {
        p.polyPath(tablePoly, 21)
        ctx.strokeStyle = PAL.gold
        ctx.lineWidth = 1.4
        ctx.stroke()
        for (let i = 0; i < tablePoly.length; i += 3) {
            const [gx, gy] = tablePoly[i]!
            if (gx + gy < 1.6) continue
            const at = local(gx, gy, 21)
            bulb(p, at, 1.3)
            lights.push(at)
        }
    }
    if (o.level >= 5) hangingLamp(p, 1.0, 1.2, 82, o.golden ? PAL.gold : o.accent)
    return { lights, height: machineHeight('dice', o.level) }
}

// ── rocket pad (limbo) ─────────────────────────────────────────────────────

export const ROCKET_BASE = local(1, 1, 8)

function drawRocketPad(p: Painter, o: MachineOpts): MachineInfo {
    const { ctx } = p
    const lights: Pt[] = []
    plate(p, 2, 2, o)
    if (o.level >= 2) {
        // A multiplier board behind the pad.
        p.box(0.2, 0.08, 0, 0.07, 0.07, 46, faceColors(PAL.slate))
        p.box(1.73, 0.08, 0, 0.07, 0.07, 46, faceColors(PAL.slate))
        p.box(0.12, 0.04, 38, 1.76, 0.12, 24, o.golden ? goldColors() : faceColors(darken(o.accent, 0.3)))
        p.faceY(0.12, 0.16, 62)
        roundRect(ctx, 3, 3, 1.76 * 32 - 6, 18, 4)
        ctx.fillStyle = PAL.screen
        ctx.fill()
        p.text('100.00×', (1.76 * 32) / 2, 12.5, 12, lighten(o.accent, 0.4), { stroke: darken(o.accent, 0.5), strokeWidth: 2 })
        p.reset()
    }
    if (o.level >= 3) {
        // The gantry: four posts and rungs at the back left.
        const metal = o.golden || o.level >= 4 ? goldColors() : faceColors('#d9644a')
        for (const [gx, gy] of [[0.14, 0.62], [0.42, 0.62], [0.14, 0.9], [0.42, 0.9]] as const) p.box(gx, gy, 0, 0.06, 0.06, 84, metal, { lineWidth: 1 })
        for (let z = 18; z <= 78; z += 20) {
            p.box(0.14, 0.62, z, 0.34, 0.06, 3, metal, { lineWidth: 0.8 })
            p.box(0.14, 0.9, z, 0.34, 0.06, 3, metal, { lineWidth: 0.8 })
        }
        p.box(0.42, 0.84, 52, 0.42, 0.08, 4, metal, { lineWidth: 1 })
    }
    p.cylinder(1, 1, 0, 0.92, 7, faceColors(o.golden ? PAL.goldDark : PAL.slate))
    p.top(0, 0, 7)
    ctx.lineWidth = 3
    ctx.strokeStyle = o.golden ? PAL.goldLight : o.accent
    ctx.beginPath()
    ctx.arc(32, 32, 22, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 2.2
    ctx.strokeStyle = '#ffd23f'
    ctx.beginPath()
    ctx.arc(32, 32, 27, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = rgba(o.accent, 0.35)
    ctx.beginPath()
    ctx.arc(32, 32, 14, 0, Math.PI * 2)
    ctx.fill()
    p.reset()
    p.cylinder(1, 1, 7, 0.2, 3, faceColors('#d8dbe8'), { lineWidth: 1 })
    if (o.level >= 4) {
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2
            const gx = 1 + Math.cos(a) * 0.84
            const gy = 1 + Math.sin(a) * 0.84
            if (gx + gy < 1.6) continue
            const at = local(gx, gy, 7)
            bulb(p, at, 1.3, i % 2 ? PAL.goldLight : lighten(o.accent, 0.5))
            lights.push(at)
        }
    }
    return { lights, height: machineHeight('rocket', o.level) }
}

// ── money wheel ────────────────────────────────────────────────────────────

const WHEEL_Z = 60
export const WHEEL_RADIUS = 25
export const WHEEL_CENTER = onFaceY(local(0, 0.5, WHEEL_Z), 32, 0)

function drawWheel(p: Painter, o: MachineOpts): MachineInfo {
    const { ctx } = p
    const lights: Pt[] = []
    const body = bodyOf(o)
    const metal = o.golden || o.level >= 4 ? goldColors() : faceColors(PAL.steel)
    plate(p, 2, 1, o)
    if (o.level >= 4) {
        // Light columns either side.
        for (const gx of [0.05, 1.8]) {
            p.box(gx, 0.36, 0, 0.15, 0.15, 96, o.golden ? goldColors() : faceColors(darken(o.accent, 0.3)))
            for (let z = 14; z <= 90; z += 12) {
                const at = local(gx + 0.075, 0.51, z)
                bulb(p, at, 1.3)
                lights.push(at)
            }
        }
    }
    p.box(0.42, 0.44, 12, 0.1, 0.1, 50, metal, { lineWidth: 1.2 })
    p.box(1.48, 0.44, 12, 0.1, 0.1, 50, metal, { lineWidth: 1.2 })
    // Back board: a disc in the face plane, ringed with bulbs from level 2.
    p.faceY(0, 0.5, WHEEL_Z)
    ctx.beginPath()
    ctx.arc(32, 0, WHEEL_RADIUS + 6.5, 0, Math.PI * 2)
    ctx.fillStyle = INK
    ctx.fill()
    ctx.beginPath()
    ctx.arc(32, 0, WHEEL_RADIUS + 5, 0, Math.PI * 2)
    const board = ctx.createLinearGradient(0, -30, 0, 30)
    board.addColorStop(0, lighten(body, 0.15))
    board.addColorStop(1, darken(body, 0.25))
    ctx.fillStyle = board
    ctx.fill()
    p.reset()
    if (o.level >= 2) {
        const n = 16
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2
            const at = onFaceY(local(0, 0.5, WHEEL_Z), 32 + Math.cos(a) * (WHEEL_RADIUS + 2.5), Math.sin(a) * (WHEEL_RADIUS + 2.5))
            bulb(p, at, 1.3)
            lights.push(at)
        }
    }
    p.box(0.15, 0.3, 0, 1.7, 0.55, 12, darken(body, 0.25))
    p.faceY(0.15, 0.85, 12)
    roundRect(ctx, 6, 3, 1.7 * 32 - 12, 6, 3)
    ctx.fillStyle = rgba(PAL.goldLight, 0.7)
    ctx.fill()
    p.reset()
    if (o.level >= 3) {
        p.box(0.3, 0.42, 92, 1.4, 0.14, 18, o.golden ? goldColors() : faceColors(darken(o.accent, 0.2)))
        p.faceY(0.3, 0.56, 110)
        roundRect(ctx, 2.5, 2.5, 1.4 * 32 - 5, 13, 4)
        ctx.fillStyle = PAL.cream
        ctx.fill()
        p.text(o.name.toUpperCase(), 0.7 * 32, 9.5, 10, darken(o.accent, 0.35), { maxWidth: 1.4 * 32 - 8 })
        p.reset()
    }
    return { lights, height: machineHeight('wheel', o.level) }
}

// ── flight diorama (poly masters) ──────────────────────────────────────────

export const FLIGHT_CENTER = local(1.05, 1.0, 34)

function palm(p: Painter, gx: number, gy: number, z: number, scale = 1) {
    const { ctx } = p
    const [x, y] = p.pt(gx, gy, z)
    p.reset()
    ctx.strokeStyle = INK
    ctx.lineWidth = 5 * scale
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + 4 * scale, y - 14 * scale, x + 2 * scale, y - 26 * scale)
    ctx.stroke()
    ctx.strokeStyle = '#a0703f'
    ctx.lineWidth = 3 * scale
    ctx.stroke()
    const tx = x + 2 * scale
    const ty = y - 26 * scale
    const leaves = [[-1, -0.2], [1, -0.25], [-0.8, 0.5], [0.85, 0.45], [0.1, -0.9]]
    for (const [dx, dy] of leaves) {
        ctx.beginPath()
        ctx.ellipse(tx + dx! * 8 * scale, ty + dy! * 6 * scale, 9 * scale, 3.6 * scale, Math.atan2(dy!, dx!), 0, Math.PI * 2)
        ctx.fillStyle = PAL.leaf
        ctx.strokeStyle = INK
        ctx.lineWidth = 1.4
        ctx.fill()
        ctx.stroke()
    }
    ctx.fillStyle = '#8a5a2b'
    ctx.beginPath()
    ctx.arc(tx, ty + 1, 2.2 * scale, 0, Math.PI * 2)
    ctx.fill()
}

function drawFlight(p: Painter, o: MachineOpts): MachineInfo {
    const { ctx } = p
    const lights: Pt[] = []
    const basin = roundRectPoly(0.04, 0.04, 1.92, 1.92, 0.4)
    p.prism(basin, 0, 10, o.golden ? goldColors() : faceColors('#5f7ea8'))
    p.top(0, 0, 10)
    const water = ctx.createLinearGradient(0, 0, 64, 64)
    water.addColorStop(0, lighten(PAL.water, 0.2))
    water.addColorStop(1, darken(PAL.water, 0.15))
    roundRect(ctx, 0.12 * 32, 0.12 * 32, 1.76 * 32, 1.76 * 32, 10)
    ctx.fillStyle = water
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 1.2
    ctx.lineCap = 'round'
    for (const [wx, wy] of [[12, 14], [44, 12], [50, 46], [14, 50], [28, 56], [54, 28]]) {
        ctx.beginPath()
        ctx.arc(wx!, wy!, 3, Math.PI * 1.1, Math.PI * 1.9)
        ctx.stroke()
    }
    p.reset()
    p.prism(circlePoly(1.05, 1.0, 0.58, 22), 8, 5, faceColors(PAL.sand))
    p.flat(circlePoly(1.05, 1.0, 0.44, 22), 13, PAL.leaf)
    p.top(0, 0, 13)
    ctx.fillStyle = '#4a4a5e'
    ctx.fillRect(0.62 * 32, 0.9 * 32, 0.88 * 32, 0.22 * 32)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(0.66 * 32, 1.01 * 32)
    ctx.lineTo(1.46 * 32, 1.01 * 32)
    ctx.stroke()
    ctx.setLineDash([])
    p.reset()
    if (o.level >= 2) palm(p, 1.42, 0.74, 13, 0.7)
    if (o.level >= 3) {
        p.cylinder(0.72, 0.72, 13, 0.08, 22, faceColors(PAL.cream), { lineWidth: 1.2 })
        p.cylinder(0.72, 0.72, 35, 0.13, 6, faceColors('#9fdcf5', 0.25), { lineWidth: 1.2 })
        p.cylinder(0.72, 0.72, 41, 0.06, 3, faceColors(o.accent), { lineWidth: 1 })
    }
    if (o.level >= 4) {
        for (const [gx, gy] of [[1.7, 0.3], [0.3, 1.7], [1.72, 1.72]] as const) {
            p.cylinder(gx, gy, 10, 0.07, 6, faceColors('#ef4444'), { lineWidth: 1 })
            const at = local(gx, gy, 18)
            bulb(p, at, 1.4)
            lights.push(at)
        }
        palm(p, 0.8, 1.3, 13, 0.55)
    }
    if (o.level >= 5) {
        p.polyPath(basin, 10)
        ctx.strokeStyle = PAL.gold
        ctx.lineWidth = 2
        ctx.stroke()
    }
    return { lights, height: machineHeight('flight', o.level) }
}

// ── magic hands grid table ─────────────────────────────────────────────────

export const HANDS_GRID = { origin: local(0.3, 0.46, 18), cell: 0.35 * 32, n: 4 }
export const HANDS_GLOVES: Pt[] = [local(0.6, 1.0, 44), local(1.3, 1.2, 44)]

function drawHands(p: Painter, o: MachineOpts): MachineInfo {
    const { ctx } = p
    const lights: Pt[] = []
    plate(p, 2, 2, o)
    if (o.level >= 3) {
        // A velvet curtain backdrop on a gold rod.
        p.box(0.05, 0.04, 0, 1.9, 0.1, 74, faceColors(mix(o.accent, PAL.velvet, 0.5)))
        p.faceY(0.05, 0.14, 74)
        const w = 1.9 * 32
        for (let i = 0; i < 9; i++) {
            const g = ctx.createLinearGradient((i * w) / 9, 0, ((i + 1) * w) / 9, 0)
            g.addColorStop(0, 'rgba(0,0,0,0.18)')
            g.addColorStop(0.5, 'rgba(255,255,255,0.12)')
            g.addColorStop(1, 'rgba(0,0,0,0.18)')
            ctx.fillStyle = g
            ctx.fillRect((i * w) / 9, 4, w / 9, 70)
        }
        ctx.fillStyle = PAL.gold
        roundRect(ctx, -2, 0, w + 4, 4, 2)
        ctx.fill()
        p.reset()
        if (o.level >= 4) {
            const origin = local(0.05, 0.14, 74)
            for (let i = 0; i < 7; i++) {
                const at = onFaceY(origin, 8 + i * 8.5, 12 + (i % 2) * 8)
                bulb(p, at, 1.4, PAL.goldLight)
                lights.push(at)
            }
        }
    }
    const tableCol = o.golden ? goldColors() : faceColors(mix(o.accent, '#2c1a40', 0.55))
    const tablePoly = roundRectPoly(0.14, 0.3, 1.72, 1.5, 0.3)
    p.prism(tablePoly, 0, 18, tableCol)
    p.flat(roundRectPoly(0.24, 0.4, 1.52, 1.3, 0.22), 18, '#21163a')
    p.top(0.3, 0.46, 18)
    const cell = HANDS_GRID.cell
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            roundRect(ctx, i * cell + 1, j * cell * 0.86 + 1, cell - 2, cell * 0.86 - 2, 3)
            ctx.fillStyle = (i + j) % 2 ? '#33245a' : '#2b1f4c'
            ctx.fill()
            ctx.strokeStyle = rgba(o.accent, 0.75)
            ctx.lineWidth = 0.9
            ctx.stroke()
        }
    }
    p.reset()
    if (o.level >= 2) {
        p.cylinder(1.68, 0.5, 18, 0.08, 4, goldColors(), { lineWidth: 1 })
        const [bx, by] = p.pt(1.68, 0.5, 29)
        p.reset()
        const g = ctx.createRadialGradient(bx - 2, by - 3, 1, bx, by, 8)
        g.addColorStop(0, '#ffffff')
        g.addColorStop(0.4, lighten(o.accent, 0.5))
        g.addColorStop(1, o.accent)
        ctx.fillStyle = INK
        ctx.beginPath()
        ctx.arc(bx, by, 8, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(bx, by, 6.8, 0, Math.PI * 2)
        ctx.fill()
    }
    if (o.level >= 5 || o.golden) {
        p.polyPath(tablePoly, 18)
        ctx.strokeStyle = PAL.goldLight
        ctx.lineWidth = 1.4
        ctx.stroke()
    }
    return { lights, height: machineHeight('hands', o.level) }
}

/** Grid cell (i, j) of the hands table, in the top-plane matrix's local units. */
export function handsCell(i: number, j: number): Pt {
    const c = HANDS_GRID.cell
    return { x: i * c + c / 2, y: j * c * 0.86 + (c * 0.86) / 2 }
}

// ── roulette ───────────────────────────────────────────────────────────────

export const ROULETTE_CENTER = local(0.7, 1.15, 23)
export const ROULETTE_RADIUS = 0.38 * 32

function drawRoulette(p: Painter, o: MachineOpts): MachineInfo {
    const { ctx } = p
    const lights: Pt[] = []
    plate(p, 3, 2, o)
    if (o.level >= 5) backSign(p, 0.5, 2.0, 66, 20, o, lights)
    if (o.level >= 2) {
        const [dx, dy] = p.pt(0.75, 0.36, 0)
        p.reset()
        drawFigure(ctx, dx, dy, DEALER_LOOK_2, 'front', 0, 0)
    }
    const rail = o.golden ? goldColors() : faceColors(o.level >= 4 ? PAL.woodLight : PAL.wood)
    const tablePoly = roundRectPoly(0.08, 0.52, 2.84, 1.32, 0.34)
    p.prism(tablePoly, 0, 18, rail)
    p.flat(roundRectPoly(0.18, 0.62, 2.64, 1.12, 0.26), 18, '#2a8a55', '#1f6b41', 1)
    // The betting layout: a zero and 12×3 red/black numbers.
    p.top(0, 0, 18)
    const x0 = 1.32 * 32
    const y0 = 0.74 * 32
    const cw = (1.38 * 32) / 12
    const ch = (0.84 * 32) / 3
    ctx.fillStyle = '#1f9d55'
    ctx.fillRect(x0 - cw * 1.2, y0, cw * 1.2, ch * 3)
    for (let i = 0; i < 12; i++) {
        for (let j = 0; j < 3; j++) {
            ctx.fillStyle = (i + j) % 2 ? '#1d1a26' : '#d22e3b'
            ctx.fillRect(x0 + i * cw, y0 + j * ch, cw, ch)
        }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 0.6
    for (let i = 0; i <= 12; i++) {
        ctx.beginPath()
        ctx.moveTo(x0 + i * cw, y0)
        ctx.lineTo(x0 + i * cw, y0 + ch * 3)
        ctx.stroke()
    }
    for (let j = 0; j <= 3; j++) {
        ctx.beginPath()
        ctx.moveTo(x0 - cw * 1.2, y0 + j * ch)
        ctx.lineTo(x0 + 12 * cw, y0 + j * ch)
        ctx.stroke()
    }
    p.reset()
    p.cylinder(0.7, 1.15, 18, 0.48, 5, faceColors(o.golden ? PAL.goldDark : PAL.woodDark))
    p.top(0.7, 1.15, 23)
    ctx.strokeStyle = PAL.gold
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, 0.44 * 32, 0, Math.PI * 2)
    ctx.stroke()
    p.reset()
    if (o.level >= 2) {
        const chips: [number, number, string, number][] = [[1.6, 0.9, PAL.chip, 4], [2.1, 1.25, '#3b82f6', 6], [2.45, 0.95, '#16a34a', 3], [1.85, 1.4, '#f59e0b', 5]]
        for (const [cx, cy, c, h] of chips) p.cylinder(cx, cy, 18, 0.07, h, faceColors(c), { lineWidth: 1 })
    }
    if (o.level >= 3) hangingLamp(p, 1.7, 1.15, 74, o.golden ? PAL.gold : darken(o.accent, 0.1))
    if (o.level >= 4) {
        p.polyPath(tablePoly, 18)
        ctx.strokeStyle = PAL.gold
        ctx.lineWidth = 1.4
        ctx.stroke()
        for (let i = 0; i < tablePoly.length; i += 2) {
            const [gx, gy] = tablePoly[i]!
            if (gy < 1.1 && gx < 2.7) continue
            const at = local(gx, gy, 18)
            bulb(p, at, 1.3)
            lights.push(at)
        }
    }
    return { lights, height: machineHeight('roulette', o.level) }
}

// ── live card table ────────────────────────────────────────────────────────

function kidney(scale: number, inset: number, steps = 18): [number, number][] {
    const out: [number, number][] = [[0.12 + inset, 0.42 + inset * 0.6], [2.88 - inset, 0.42 + inset * 0.6]]
    for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI
        out.push([1.5 + Math.cos(a) * (1.38 - inset) * scale, 0.42 + inset * 0.6 + Math.sin(a) * (1.02 - inset) * scale])
    }
    return out
}

/** Where stool i of n stands (grid coords inside the footprint). */
export function cardSeat(i: number, n: number): { gx: number, gy: number } {
    const a0 = 0.3
    const a = n <= 1 ? Math.PI / 2 : a0 + (i / (n - 1)) * (Math.PI - 2 * a0)
    // Seat 0 sits on the player's right (high gx) like a real table's first base.
    return { gx: 1.5 + Math.cos(a) * 1.42, gy: 0.42 + Math.sin(a) * 1.22 }
}

export const STOOL_Z = 12

function drawCards(p: Painter, o: MachineOpts): MachineInfo {
    const { ctx } = p
    const lights: Pt[] = []
    plate(p, 3, 2, o)
    if (o.level >= 4) backSign(p, 0.55, 1.9, 58, 18, o, lights)
    const [dx, dy] = p.pt(1.5, 0.24, 0)
    p.reset()
    drawFigure(ctx, dx, dy, DEALER_LOOK, 'front', 0, 0)
    const rail = o.golden ? goldColors() : faceColors(o.level >= 4 ? '#6b3a2e' : PAL.leather)
    const outer = kidney(1, 0)
    p.prism(outer, 0, 17, rail)
    const felt = mix(o.accent, '#17122a', 0.3)
    p.flat(kidney(1, 0.12), 17, felt, darken(felt, 0.3), 1)
    // Felt markings: an arc and a betting box per seat.
    p.top(0, 0, 17)
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.ellipse(1.5 * 32, 0.5 * 32, 0.85 * 32, 0.55 * 32, 0, 0.1 * Math.PI, 0.9 * Math.PI)
    ctx.stroke()
    for (let i = 0; i < o.seats; i++) {
        const s = cardSeat(i, o.seats)
        const bx = (1.5 + (s.gx - 1.5) * 0.62) * 32
        const by = (0.42 + (s.gy - 0.42) * 0.62) * 32
        ctx.save()
        ctx.translate(bx, by)
        ctx.rotate(Math.atan2(s.gy - 0.42, s.gx - 1.5) + Math.PI / 2)
        roundRect(ctx, -4, -3, 8, 6, 1.5)
        ctx.stroke()
        if (o.level >= 2) {
            ctx.fillStyle = '#ffffff'
            roundRect(ctx, -3.6, -7.5, 4.4, 6, 0.8)
            ctx.fill()
            roundRect(ctx, -0.6, -7, 4.4, 6, 0.8)
            ctx.fill()
        }
        ctx.restore()
    }
    p.reset()
    // Chip tray in front of the dealer.
    p.box(1.22, 0.46, 17, 0.56, 0.16, 2, faceColors('#2a2236'), { lineWidth: 1 })
    p.top(1.22, 0.46, 19)
    const chipColors = [PAL.chip, '#3b82f6', '#16a34a', '#f59e0b', '#1f2937', '#a855f7']
    chipColors.forEach((c, i) => {
        ctx.fillStyle = c
        ctx.fillRect(1 + i * 2.9, 1, 2.3, 3.2)
    })
    p.reset()
    if (o.level >= 2) {
        p.box(2.28, 0.5, 17, 0.2, 0.14, 6, faceColors('#3a2e4a'), { lineWidth: 1 })
    }
    // Stools.
    for (let i = 0; i < o.seats; i++) {
        const s = cardSeat(i, o.seats)
        p.cylinder(s.gx, s.gy, 0, 0.035, STOOL_Z - 3, faceColors(o.level >= 4 || o.golden ? PAL.gold : '#c9cbd6'), { lineWidth: 1, shine: false })
        p.cylinder(s.gx, s.gy, STOOL_Z - 3, 0.13, 3, faceColors(o.golden ? PAL.gold : darken(o.accent, 0.35)), { lineWidth: 1.2 })
    }
    if (o.level >= 3) hangingLamp(p, 1.5, 0.95, 72, o.golden ? PAL.gold : darken(o.accent, 0.15))
    if (o.level >= 4) {
        p.polyPath(outer, 17)
        ctx.strokeStyle = PAL.gold
        ctx.lineWidth = 1.4
        ctx.stroke()
    }
    if (o.level >= 5) {
        for (let i = 2; i < outer.length; i += 2) {
            const [gx, gy] = outer[i]!
            const at = local(gx, gy, 17)
            bulb(p, at, 1.3)
            lights.push(at)
        }
    }
    return { lights, height: machineHeight('cards', o.level) }
}

// ── peg board (pegfall) ────────────────────────────────────────────────────

const PLINKO_Z = 14
const PLINKO_FACE_GY = 0.46
/** The board's face: origin (top-left, face plane), size in px, rows of pegs and where the slots sit. */
export function plinkoBoard(level: number): { origin: Pt, w: number, h: number, rows: number, top: number, gap: number, dx: number, slotY: number } {
    const h = level >= 3 ? 70 : 58
    const w = 1.76 * 32
    const rows = level >= 3 ? 7 : 6
    const dx = w / (rows + 3)
    const top = 8
    const gap = (h - 22) / rows
    return { origin: local(0.12, PLINKO_FACE_GY, PLINKO_Z + h), w, h, rows, top, gap, dx, slotY: top + rows * gap + 2 }
}

const PLINKO_SLOT_COLORS = ['#ff3d8b', '#ff9a2e', '#ffd23f', '#7bdc5a', '#6d84d8']

function drawPlinko(p: Painter, o: MachineOpts): MachineInfo {
    const { ctx } = p
    const lights: Pt[] = []
    const body = bodyOf(o)
    const b = plinkoBoard(o.level)
    plate(p, 2, 1, o)
    if (o.level >= 5) {
        // Light columns either side of the cabinet.
        for (const gx of [0.0, 1.86]) {
            p.box(gx, 0.34, 0, 0.14, 0.14, 104, o.golden ? goldColors() : faceColors(darken(o.accent, 0.3)))
            for (let z = 16; z <= 98; z += 12) {
                const at = local(gx + 0.07, 0.48, z)
                bulb(p, at, 1.3, z % 24 ? PAL.goldLight : lighten(o.accent, 0.5))
                lights.push(at)
            }
        }
    }
    // The counter with the prize trays.
    p.box(0.08, 0.3, 0, 1.84, 0.62, PLINKO_Z, darken(body, 0.25))
    p.faceY(0.08, 0.92, PLINKO_Z)
    const fw = 1.84 * 32
    roundRect(ctx, 4, 3, fw - 8, 7, 3)
    ctx.fillStyle = o.level >= 4 || o.golden ? PAL.gold : rgba(PAL.goldLight, 0.75)
    ctx.fill()
    p.reset()
    // The upright board.
    const frame = o.golden ? goldColors() : faceColors(o.level >= 4 ? PAL.woodLight : lighten(body, 0.05))
    p.box(0.08, 0.3, PLINKO_Z, 1.84, 0.16, b.h, frame)
    p.faceY(0.12, PLINKO_FACE_GY, PLINKO_Z + b.h)
    roundRect(ctx, 2.5, 2.5, b.w - 5, b.h - 5, 5)
    const bg = ctx.createLinearGradient(0, 0, 0, b.h)
    bg.addColorStop(0, '#1c3f86')
    bg.addColorStop(1, '#0d1d45')
    ctx.fillStyle = bg
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.4
    ctx.stroke()
    // Pegs: a triangle, three on top.
    for (let r = 0; r < b.rows; r++) {
        for (let k = 0; k < r + 3; k++) {
            const x = b.w / 2 + (k - (r + 2) / 2) * b.dx
            const y = b.top + r * b.gap
            ctx.fillStyle = '#ffffff'
            ctx.beginPath()
            ctx.arc(x, y, 1.25, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    // Prize slots along the bottom, hot at the edges.
    const n = b.rows + 1
    for (let k = 0; k < n; k++) {
        const x = b.w / 2 + (k - b.rows / 2) * b.dx
        const tone = PLINKO_SLOT_COLORS[Math.min(PLINKO_SLOT_COLORS.length - 1, Math.round(Math.abs(k - b.rows / 2) === 0 ? 4 : 4 - Math.abs(k - b.rows / 2) * (4 / (b.rows / 2))))]!
        roundRect(ctx, x - b.dx / 2 + 0.6, b.slotY, b.dx - 1.2, 7, 1.6)
        ctx.fillStyle = o.golden && (k === 0 || k === n - 1) ? PAL.gold : tone
        ctx.fill()
        ctx.strokeStyle = rgba(INK, 0.7)
        ctx.lineWidth = 0.8
        ctx.stroke()
    }
    p.reset()
    if (o.level >= 2) {
        // A drop chute on top, where the balls go in.
        p.box(0.86, 0.32, PLINKO_Z + b.h, 0.28, 0.12, 6, o.golden || o.level >= 4 ? goldColors() : faceColors(darken(o.accent, 0.2)), { lineWidth: 1.2 })
    }
    if (o.level >= 3) {
        // The name topper.
        const z = PLINKO_Z + b.h + 6
        p.box(0.2, 0.3, z, 1.6, 0.14, 18, o.golden ? goldColors() : faceColors(darken(o.accent, 0.2)))
        p.faceY(0.2, 0.44, z + 18)
        roundRect(ctx, 2.5, 2.5, 1.6 * 32 - 5, 13, 4)
        ctx.fillStyle = o.level >= 4 || o.golden ? PAL.screen : PAL.cream
        ctx.fill()
        p.text(o.name.toUpperCase(), 0.8 * 32, 9.5, 10, o.level >= 4 || o.golden ? PAL.goldLight : darken(o.accent, 0.35), { maxWidth: 1.6 * 32 - 8, stroke: o.level >= 4 ? INK : undefined, strokeWidth: 2 })
        p.reset()
    }
    if (o.level >= 4) {
        // Bulbs round the board.
        const origin = b.origin
        for (let i = 0; i <= 8; i++) {
            const top = onFaceY(origin, 3 + (i / 8) * (b.w - 6), 1.5)
            bulb(p, top, 1.25)
            lights.push(top)
        }
        for (let i = 1; i <= 3; i++) {
            for (const u of [1.5, b.w - 1.5]) {
                const at = onFaceY(origin, u, (i / 4) * b.h)
                bulb(p, at, 1.25)
                lights.push(at)
            }
        }
    }
    return { lights, height: machineHeight('plinko', o.level) }
}

// ── gem dig table (mines) ──────────────────────────────────────────────────

const MINES_Z = 18
/** The 5×5 field on the table top, in the top plane's local units. */
export const MINES_GRID = { origin: local(0.36, 0.52, MINES_Z), cellW: (1.28 * 32) / 5, cellH: (1.1 * 32) / 5, n: 5 }

/** Field cell (i, j) of the mines table, in the top-plane matrix's local units. */
export function minesCell(i: number, j: number): Pt {
    return { x: i * MINES_GRID.cellW + MINES_GRID.cellW / 2, y: j * MINES_GRID.cellH + MINES_GRID.cellH / 2 }
}

/** A cut gem centred at (x, y), r across. */
export function drawGem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color = '#2fe0d0') {
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(x - r, y - r * 0.3)
    ctx.lineTo(x - r * 0.55, y - r * 0.9)
    ctx.lineTo(x + r * 0.55, y - r * 0.9)
    ctx.lineTo(x + r, y - r * 0.3)
    ctx.lineTo(x, y + r)
    ctx.closePath()
    const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r)
    g.addColorStop(0, lighten(color, 0.7))
    g.addColorStop(0.5, color)
    g.addColorStop(1, darken(color, 0.35))
    ctx.fillStyle = g
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = Math.max(0.8, r * 0.22)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = Math.max(0.6, r * 0.16)
    ctx.beginPath()
    ctx.moveTo(x - r * 0.45, y - r * 0.6)
    ctx.lineTo(x - r * 0.2, y - r * 0.2)
    ctx.stroke()
}

function drawMines(p: Painter, o: MachineOpts): MachineInfo {
    const { ctx } = p
    const lights: Pt[] = []
    plate(p, 2, 2, o)
    if (o.level >= 4) backSign(p, 0.2, 1.6, 50, 18, o, lights)
    if (o.level >= 2) {
        const [dx, dy] = p.pt(1.0, 0.3, 0)
        p.reset()
        drawFigure(ctx, dx, dy, DEALER_LOOK_2, 'front', 0, 0)
    }
    const rail = o.golden ? goldColors() : faceColors(o.level >= 3 ? PAL.woodLight : PAL.wood)
    const tablePoly = roundRectPoly(0.14, 0.38, 1.72, 1.46, 0.28)
    p.prism(tablePoly, 0, MINES_Z, rail)
    const felt = mix(o.accent, '#123b2b', 0.45)
    p.flat(roundRectPoly(0.24, 0.46, 1.52, 1.28, 0.2), MINES_Z, felt, darken(felt, 0.3), 1.2)
    // The field: dirt tiles, a few dug to show gems.
    p.top(0.36, 0.52, MINES_Z)
    const dug = o.level >= 3 ? [1, 7, 13, 17, 23] : [6, 12, 18]
    const { cellW, cellH } = MINES_GRID
    for (let j = 0; j < 5; j++) {
        for (let i = 0; i < 5; i++) {
            const n = j * 5 + i
            roundRect(ctx, i * cellW + 0.7, j * cellH + 0.7, cellW - 1.4, cellH - 1.4, 1.6)
            ctx.fillStyle = dug.includes(n) ? '#1c1531' : (i + j) % 2 ? '#a5714a' : '#94633e'
            ctx.fill()
            ctx.strokeStyle = rgba(INK, 0.55)
            ctx.lineWidth = 0.6
            ctx.stroke()
        }
    }
    p.reset()
    for (const n of dug) {
        const c = minesCell(n % 5, Math.floor(n / 5))
        const [sx, sy] = p.pt(0.36 + c.x / 32, 0.52 + c.y / 32, MINES_Z)
        drawGem(ctx, sx, sy - 1.5, 2.6, o.golden ? PAL.gold : '#2fe0d0')
    }
    if (o.level >= 2) {
        // A pickaxe leaning on the table and a chip stack.
        p.cylinder(1.66, 1.62, MINES_Z, 0.07, 5, faceColors(PAL.chip), { lineWidth: 1 })
        const [hx, hy] = p.pt(1.86, 1.0, 0)
        p.reset()
        ctx.strokeStyle = INK
        ctx.lineWidth = 3.4
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(hx, hy - 2)
        ctx.lineTo(hx + 5, hy - 26)
        ctx.stroke()
        ctx.strokeStyle = '#a0703f'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.fillStyle = o.golden || o.level >= 4 ? PAL.gold : '#c9cbd6'
        ctx.strokeStyle = INK
        ctx.lineWidth = 1.3
        ctx.beginPath()
        ctx.moveTo(hx - 6, hy - 22)
        ctx.quadraticCurveTo(hx + 5, hy - 31, hx + 15, hy - 21)
        ctx.quadraticCurveTo(hx + 5, hy - 27, hx - 6, hy - 22)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
    }
    if (o.level >= 3) hangingLamp(p, 1.0, 1.1, 70, o.golden ? PAL.gold : '#f2b23d')
    if (o.level >= 4) {
        p.polyPath(tablePoly, MINES_Z)
        ctx.strokeStyle = PAL.gold
        ctx.lineWidth = 1.4
        ctx.stroke()
    }
    if (o.level >= 5) {
        // A pile of gems on the corner and bulbs round the rail.
        p.reset()
        const [gx, gy] = p.pt(0.32, 1.66, MINES_Z)
        for (const [ox, oy, c] of [[0, 0, '#2fe0d0'], [5, 1.5, '#f43f5e'], [2.5, -3, '#a855f7'], [-4, 1, '#facc15']] as const) drawGem(ctx, gx + ox, gy + oy - 2, 2.8, c)
        for (let i = 0; i < tablePoly.length; i += 2) {
            const [tx, ty] = tablePoly[i]!
            if (tx + ty < 1.6) continue
            const at = local(tx, ty, MINES_Z)
            bulb(p, at, 1.3)
            lights.push(at)
        }
    }
    return { lights, height: machineHeight('mines', o.level) }
}

// ── card climb table (hi-lo) ───────────────────────────────────────────────

const HILO_Z = 17
/** The giant card standing behind the table: face-plane origin (its top-left) and size. */
export const HILO_CARD = { origin: local(0.74, 0.34, 64), w: 17, h: 24 }

export function hiloSeat(i: number, n: number): { gx: number, gy: number } {
    const a0 = 0.55
    const a = n <= 1 ? Math.PI / 2 : a0 + (i / (n - 1)) * (Math.PI - 2 * a0)
    return { gx: 1 + Math.cos(a) * 0.96, gy: 0.62 + Math.sin(a) * 1.18 }
}

/** A playing card face (rank and suit), w × h with its top-left at (x, y). */
export function drawCardFace(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rank: string, red: boolean) {
    ctx.lineJoin = 'round'
    roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.16)
    ctx.fillStyle = PAL.paper
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.4
    ctx.stroke()
    const ink = red ? '#e11d48' : '#2a1b30'
    ctx.fillStyle = ink
    ctx.font = `${Math.round(h * 0.42)}px "Lilita One", "Fredoka", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(rank, x + w / 2, y + h * 0.4)
    // A suit pip under the rank: a heart or a spade.
    const cx = x + w / 2
    const cy = y + h * 0.76
    const r = h * 0.12
    ctx.beginPath()
    if (red) {
        ctx.moveTo(cx, cy + r)
        ctx.bezierCurveTo(cx - r * 1.6, cy - r * 0.2, cx - r * 0.7, cy - r * 1.4, cx, cy - r * 0.5)
        ctx.bezierCurveTo(cx + r * 0.7, cy - r * 1.4, cx + r * 1.6, cy - r * 0.2, cx, cy + r)
    } else {
        ctx.moveTo(cx, cy - r * 1.1)
        ctx.bezierCurveTo(cx - r * 1.6, cy, cx - r * 0.8, cy + r, cx, cy + r * 0.3)
        ctx.bezierCurveTo(cx + r * 0.8, cy + r, cx + r * 1.6, cy, cx, cy - r * 1.1)
        ctx.rect(cx - r * 0.18, cy, r * 0.36, r * 1.1)
    }
    ctx.fill()
}

function arrowOnFelt(ctx: CanvasRenderingContext2D, x: number, y: number, up: boolean, color: string) {
    const d = up ? -1 : 1
    ctx.beginPath()
    ctx.moveTo(x, y + d * 6)
    ctx.lineTo(x + 5, y)
    ctx.lineTo(x + 2, y)
    ctx.lineTo(x + 2, y - d * 5)
    ctx.lineTo(x - 2, y - d * 5)
    ctx.lineTo(x - 2, y)
    ctx.lineTo(x - 5, y)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = rgba(INK, 0.7)
    ctx.lineWidth = 0.8
    ctx.stroke()
}

function drawHilo(p: Painter, o: MachineOpts): MachineInfo {
    const { ctx } = p
    const lights: Pt[] = []
    plate(p, 2, 2, o)
    if (o.level >= 4) {
        // Twin bulb posts behind the card.
        for (const gx of [0.18, 1.74]) {
            p.box(gx, 0.12, 0, 0.08, 0.08, 78, o.golden ? goldColors() : faceColors(darken(o.accent, 0.3)))
            for (let z = 30; z <= 74; z += 11) {
                const at = local(gx + 0.04, 0.2, z)
                bulb(p, at, 1.3)
                lights.push(at)
            }
        }
    }
    // The card stand: a post with a frame the giant card sits in (the card itself is an overlay that flips).
    const stand = o.golden || o.level >= 3 ? goldColors() : faceColors(PAL.woodDark)
    p.box(0.96, 0.26, 0, 0.08, 0.08, 40, stand, { lineWidth: 1.2 })
    p.box(0.66, 0.24, 38, 0.68, 0.1, 28, o.golden ? goldColors() : faceColors(darken(o.accent, 0.25)))
    p.faceY(0.66, 0.34, 66)
    roundRect(ctx, 2, 2, 0.68 * 32 - 4, 24, 3)
    ctx.fillStyle = PAL.screen
    ctx.fill()
    p.reset()
    if (o.level >= 3) {
        // A second, face-down card beside it.
        p.faceY(0.34, 0.3, 58)
        roundRect(ctx, 0, 0, 9, 13, 2)
        ctx.fillStyle = '#c2187a'
        ctx.fill()
        ctx.strokeStyle = INK
        ctx.lineWidth = 1.2
        ctx.stroke()
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.lineWidth = 0.8
        roundRect(ctx, 1.8, 1.8, 5.4, 9.4, 1.2)
        ctx.stroke()
        p.reset()
    }
    // The dealer behind the table.
    const [dx, dy] = p.pt(1.32, 0.36, 0)
    p.reset()
    drawFigure(ctx, dx, dy, DEALER_LOOK, 'front', 0, 0)
    // A half-moon table.
    const outer: [number, number][] = [[0.1, 0.62], [1.9, 0.62]]
    for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI
        outer.push([1 + Math.cos(a) * 0.9, 0.62 + Math.sin(a) * 1.0])
    }
    const rail = o.golden ? goldColors() : faceColors(o.level >= 4 ? '#6b3a2e' : PAL.leather)
    p.prism(outer, 0, HILO_Z, rail)
    const inner: [number, number][] = [[0.22, 0.68], [1.78, 0.68]]
    for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI
        inner.push([1 + Math.cos(a) * 0.78, 0.68 + Math.sin(a) * 0.86])
    }
    const felt = mix(o.accent, '#1c1036', 0.35)
    p.flat(inner, HILO_Z, felt, darken(felt, 0.3), 1)
    // Felt markings: HIGHER / LOWER arrows and a card box.
    p.top(0, 0, HILO_Z)
    arrowOnFelt(ctx, 0.62 * 32, 1.12 * 32, true, '#3fd25a')
    arrowOnFelt(ctx, 1.38 * 32, 1.12 * 32, false, '#ff5470')
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 0.9
    roundRect(ctx, 0.86 * 32, 0.92 * 32, 0.28 * 32, 0.38 * 32, 2)
    ctx.stroke()
    p.reset()
    // The card shoe on the dealer's side.
    p.box(1.42, 0.7, HILO_Z, 0.26, 0.18, 5, faceColors('#2a2236'), { lineWidth: 1 })
    if (o.level >= 2) {
        const chips: [number, number, string, number][] = [[0.42, 0.86, PAL.chip, 4], [0.52, 0.94, '#3b82f6', 6]]
        for (const [cx, cy, c, h] of chips) p.cylinder(cx, cy, HILO_Z, 0.065, h, faceColors(c), { lineWidth: 1 })
    }
    // Stools.
    for (let i = 0; i < o.seats; i++) {
        const s = hiloSeat(i, o.seats)
        p.cylinder(s.gx, s.gy, 0, 0.035, STOOL_Z - 3, faceColors(o.level >= 4 || o.golden ? PAL.gold : '#c9cbd6'), { lineWidth: 1, shine: false })
        p.cylinder(s.gx, s.gy, STOOL_Z - 3, 0.12, 3, faceColors(o.golden ? PAL.gold : darken(o.accent, 0.35)), { lineWidth: 1.2 })
    }
    if (o.level >= 4) {
        p.polyPath(outer, HILO_Z)
        ctx.strokeStyle = PAL.gold
        ctx.lineWidth = 1.4
        ctx.stroke()
    }
    if (o.level >= 5) {
        for (let i = 2; i < outer.length; i += 2) {
            const [gx, gy] = outer[i]!
            const at = local(gx, gy, HILO_Z)
            bulb(p, at, 1.3)
            lights.push(at)
        }
        hangingLamp(p, 1.0, 1.1, 84, o.golden ? PAL.gold : darken(o.accent, 0.1))
    }
    return { lights, height: machineHeight('hilo', o.level) }
}

// ── entry point ────────────────────────────────────────────────────────────

export function drawMachine(p: Painter, arch: Archetype, o: MachineOpts): MachineInfo {
    const size = ARCH_SIZE[arch]
    p.shadow([[0.1, 0.1], [size.w - 0.1, 0.1], [size.w - 0.1, size.h - 0.1], [0.1, size.h - 0.1]], 8, 0.4)
    switch (arch) {
        case 'slot': return drawSlot(p, o)
        case 'dice': return drawDice(p, o)
        case 'rocket': return drawRocketPad(p, o)
        case 'wheel': return drawWheel(p, o)
        case 'flight': return drawFlight(p, o)
        case 'hands': return drawHands(p, o)
        case 'roulette': return drawRoulette(p, o)
        case 'cards': return drawCards(p, o)
        case 'plinko': return drawPlinko(p, o)
        case 'mines': return drawMines(p, o)
        case 'hilo': return drawHilo(p, o)
    }
}

// ── flat overlay art (screen-space shapes the overlays animate) ────────────

/** The money wheel's face, centred at (cx, cy). */
export function drawWheelFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, accent: string, golden: boolean) {
    const colors = [accent, PAL.cream, golden ? PAL.gold : '#f59e0b', PAL.cream, darken(accent, 0.25), PAL.cream, '#38bdf8', PAL.cream]
    const n = 16
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2)
    ctx.fill()
    for (let i = 0; i < n; i++) {
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, r, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2)
        ctx.closePath()
        ctx.fillStyle = colors[i % colors.length]!
        ctx.fill()
        ctx.strokeStyle = rgba(INK, 0.5)
        ctx.lineWidth = 0.8
        ctx.stroke()
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.beginPath()
    ctx.arc(cx, cy, r, Math.PI * 1.05, Math.PI * 1.75)
    ctx.lineTo(cx, cy)
    ctx.fill()
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.28 + 1.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = golden ? PAL.gold : PAL.goldLight
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.28, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(cx - r * 0.08, cy - r * 0.08, r * 0.08, 0, Math.PI * 2)
    ctx.fill()
}

/** A roulette wheel seen from above, centred at (cx, cy). */
export function drawRouletteFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    const n = 18
    ctx.fillStyle = PAL.woodDark
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    for (let i = 0; i < n; i++) {
        ctx.beginPath()
        ctx.arc(cx, cy, r * 0.92, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2)
        ctx.arc(cx, cy, r * 0.62, ((i + 1) / n) * Math.PI * 2, (i / n) * Math.PI * 2, true)
        ctx.closePath()
        ctx.fillStyle = i === 0 ? '#1f9d55' : i % 2 ? '#1d1a26' : '#d22e3b'
        ctx.fill()
    }
    ctx.fillStyle = PAL.wood
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = PAL.gold
    ctx.lineWidth = r * 0.08
    ctx.beginPath()
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2
        ctx.moveTo(cx + Math.cos(a) * r * 0.08, cy + Math.sin(a) * r * 0.08)
        ctx.lineTo(cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42)
    }
    ctx.stroke()
    ctx.fillStyle = PAL.gold
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.14, 0, Math.PI * 2)
    ctx.fill()
}

/** A chunky rocket standing on its tail at (x, y). */
export function drawRocket(ctx: CanvasRenderingContext2D, x: number, y: number, accent: string, golden: boolean) {
    const body = golden ? PAL.gold : '#f4f1fa'
    ctx.lineJoin = 'round'
    // Fins.
    ctx.fillStyle = golden ? PAL.goldDark : accent
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.8
    ctx.beginPath()
    ctx.moveTo(x - 7, y - 16)
    ctx.lineTo(x - 13, y - 2)
    ctx.lineTo(x - 7, y - 4)
    ctx.closePath()
    ctx.moveTo(x + 7, y - 16)
    ctx.lineTo(x + 13, y - 2)
    ctx.lineTo(x + 7, y - 4)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // Body.
    const g = ctx.createLinearGradient(x - 8, 0, x + 8, 0)
    g.addColorStop(0, lighten(body, 0.4))
    g.addColorStop(0.55, body)
    g.addColorStop(1, darken(body, 0.25))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(x - 7.5, y - 4)
    ctx.lineTo(x - 7.5, y - 26)
    ctx.quadraticCurveTo(x - 7, y - 40, x, y - 48)
    ctx.quadraticCurveTo(x + 7, y - 40, x + 7.5, y - 26)
    ctx.lineTo(x + 7.5, y - 4)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // Nose cone.
    ctx.fillStyle = golden ? '#e11d48' : accent
    ctx.beginPath()
    ctx.moveTo(x - 5.2, y - 37)
    ctx.quadraticCurveTo(x - 3, y - 44, x, y - 48)
    ctx.quadraticCurveTo(x + 3, y - 44, x + 5.2, y - 37)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // Window.
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(x, y - 25, 4.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#9fdcf5'
    ctx.beginPath()
    ctx.arc(x, y - 25, 3.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x - 1, y - 26, 1.1, 0, Math.PI * 2)
    ctx.fill()
    // Nozzle.
    ctx.fillStyle = '#4b4668'
    ctx.beginPath()
    ctx.moveTo(x - 5, y - 4)
    ctx.lineTo(x + 5, y - 4)
    ctx.lineTo(x + 4, y)
    ctx.lineTo(x - 4, y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
}

/** A cartoon plane facing right, centred at (x, y). */
export function drawPlane(ctx: CanvasRenderingContext2D, x: number, y: number, accent: string, golden: boolean) {
    const body = golden ? PAL.gold : accent
    ctx.lineJoin = 'round'
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.6
    // Back wing.
    ctx.fillStyle = darken(body, 0.25)
    ctx.beginPath()
    ctx.ellipse(x - 1, y - 3, 4, 10, 0.25, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    // Fuselage.
    const g = ctx.createLinearGradient(0, y - 6, 0, y + 6)
    g.addColorStop(0, lighten(body, 0.35))
    g.addColorStop(1, darken(body, 0.15))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(x, y, 13, 5.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    // Tail.
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.moveTo(x - 9, y - 2)
    ctx.lineTo(x - 15, y - 11)
    ctx.lineTo(x - 11, y - 11)
    ctx.lineTo(x - 5, y - 3)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // Front wing.
    ctx.fillStyle = lighten(body, 0.1)
    ctx.beginPath()
    ctx.ellipse(x + 1, y + 3, 3.5, 9, -0.25, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    // Cockpit and prop.
    ctx.fillStyle = '#9fdcf5'
    ctx.beginPath()
    ctx.ellipse(x + 6, y - 2.2, 3.4, 2.2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#f4f1fa'
    ctx.beginPath()
    ctx.ellipse(x + 14, y, 1.6, 6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
}

/** A white cartoon glove, palm down, centred at (x, y). */
export function drawGlove(ctx: CanvasRenderingContext2D, x: number, y: number, flip: boolean) {
    ctx.save()
    ctx.translate(x, y)
    if (flip) ctx.scale(-1, 1)
    ctx.lineJoin = 'round'
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.6
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    roundRect(ctx, -6, -5, 12, 11, 5)
    ctx.fill()
    ctx.stroke()
    for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        roundRect(ctx, -5 + i * 3.6, -12, 3.4, 9, 1.7)
        ctx.fill()
        ctx.stroke()
    }
    ctx.beginPath()
    roundRect(ctx, 5, -3, 6, 3.4, 1.7)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#e9e4f5'
    ctx.beginPath()
    roundRect(ctx, -6.5, 5, 13, 4, 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
}
