import type { Container, Graphics, Sprite, Text } from 'pixi.js'
import type { AvatarLook } from '#shared/cosmetics'
import { formatCoins } from '#shared/money'
import { figureFrames, makeNameTag } from './actors'
import type { Baked, TextureBank } from './art/bank'
import { FIGURE_FOOT, FIGURE_H, FIGURE_W, WORKER_LOOK, avatarLook, lookKey } from './art/characters'
import type { FxTextures } from './art/fx'
import {
    DICE_SPOTS, FLIGHT_CENTER, HANDS_GLOVES, HANDS_GRID, HILO_CARD, MINES_GRID, ROCKET_BASE, ROULETTE_CENTER, ROULETTE_RADIUS, STOOL_Z, WHEEL_CENTER, WHEEL_RADIUS,
    cardSeat, drawCardFace, drawGem, drawGlove, drawMachine, drawPlane, drawRocket, drawRouletteFace, drawWheelFace, handsCell, machineHeight, minesCell, plinkoBoard, slotScreens, type MachineInfo
} from './art/machines'
import { BADGE, BUILD_SIGN, CAGE_PILE, CAGE_TOP, DESK_TOP, SALE_SIGN, craneHook, drawBuildBadge, drawBuildSign, drawCage, drawDesk, drawLockSign, drawPlotOutline, drawSaleSign, drawScaffold } from './art/props'
import { footprintCanvas, hexNum, project, type Pt } from './iso'
import type { PlotLayout } from '#shared/floor/layout'
import type { FloorPlot } from './types'

type Pixi = typeof import('pixi.js')

/** What every view needs from the engine. */
export interface ViewContext {
    PIXI: Pixi
    bank: TextureBank
    fx: FxTextures
    /** Floor decals (plot outlines, glows under machines). */
    floorLayer: Container
    /** Labels that float above everything (countdowns, name tags). */
    overlay: Container
    reduced: boolean
    names: Record<string, string>
    /** Server time now (ms). */
    now: () => number
}

// ── texture helpers ────────────────────────────────────────────────────────

const machineInfo = new Map<string, MachineInfo>()

export function machineTexture(ctx: ViewContext, plot: Pick<FloorPlot, 'id' | 'archetype' | 'accent'>, layout: PlotLayout, level: number, golden: boolean, seats: number): { baked: Baked, info: MachineInfo } {
    const key = `m:${plot.id}:${level}:${golden ? 1 : 0}:${seats}`
    const { w, h } = layout.rect
    const height = machineHeight(plot.archetype, level) + 8
    const baked = ctx.bank.get(key, () => {
        const c = footprintCanvas(w, h, height, 16)
        return ctx.bank.bake(c.width, c.height, c.ox, c.oy, (p) => {
            machineInfo.set(key, drawMachine(p, plot.archetype, { accent: plot.accent, level, golden, name: ctx.names[plot.id] ?? plot.id, seats }))
        }, true)
    })
    return { baked, info: machineInfo.get(key) ?? { lights: [], height } }
}

function flatTexture(ctx: ViewContext, key: string, w: number, h: number, ox: number, oy: number, draw: (c: CanvasRenderingContext2D) => void): Baked {
    return ctx.bank.get(key, () => ctx.bank.bake(w, h, ox, oy, (_p, c) => draw(c)))
}

function sprite(ctx: ViewContext, baked: Baked): Sprite {
    const s = new ctx.PIXI.Sprite(baked.texture)
    s.anchor.set(baked.ox / baked.width, baked.oy / baked.height)
    return s
}

export function formatLeft(ms: number): string {
    const s = Math.max(0, Math.ceil(ms / 1000))
    if (s >= 3600) {
        const h = Math.floor(s / 3600)
        const m = Math.floor((s % 3600) / 60)
        return `${h}u ${String(m).padStart(2, '0')}m`
    }
    if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    return `${s}s`
}

/** A countdown pill with a progress bar, floating in the overlay layer. */
export class Countdown {
    readonly container: Container
    private text: Text
    private bar: Graphics
    private shown = ''
    private barW = -1

    constructor(private readonly ctx: ViewContext, private startedAt: number, private readyAt: number) {
        const { PIXI } = ctx
        this.container = new PIXI.Container()
        const bg = new PIXI.Graphics()
        bg.roundRect(-30, -11, 60, 24, 9).fill({ color: 0x2a1b30, alpha: 0.88 }).stroke({ color: 0xffd23f, width: 1.4 })
        this.text = new PIXI.Text({
            text: '',
            resolution: 2,
            style: { fontFamily: '"Fredoka", system-ui, sans-serif', fontSize: 11, fontWeight: '600', fill: 0xffffff }
        })
        this.text.anchor.set(0.5)
        this.text.y = -3
        this.bar = new PIXI.Graphics()
        this.container.addChild(bg, this.bar, this.text)
        ctx.overlay.addChild(this.container)
        this.update()
    }

    set(startedAt: number, readyAt: number) {
        this.startedAt = startedAt
        this.readyAt = readyAt
        this.barW = -1
    }

    update() {
        const now = this.ctx.now()
        const left = this.readyAt - now
        const label = left <= 0 ? 'Done!' : formatLeft(left)
        if (label !== this.shown) {
            this.shown = label
            this.text.text = label
        }
        const total = Math.max(1, this.readyAt - this.startedAt)
        const k = Math.max(0, Math.min(1, (now - this.startedAt) / total))
        // Redraw only when the bar grows by a whole pixel (it changes a few times a minute on long builds).
        const w = k > 0 ? Math.max(4, Math.round(48 * k)) : 0
        if (w === this.barW) return
        this.barW = w
        this.bar.clear()
        this.bar.roundRect(-24, 5, 48, 4, 2).fill({ color: 0x000000, alpha: 0.45 })
        if (w > 0) this.bar.roundRect(-24, 5, w, 4, 2).fill({ color: 0xffd23f })
    }

    destroy() {
        this.container.destroy({ children: true })
    }
}

// ── plots ──────────────────────────────────────────────────────────────────

interface Twinkle {
    sprite: Sprite
    phase: number
    speed: number
}

/** Plot status as the floor shows it (an unowned zone's plots are only outlines). */
export type PlotShow = 'ghost' | 'locked' | 'available' | 'building' | 'built'

export function plotKey(plot: FloorPlot, show: PlotShow): string {
    return [show, plot.level, plot.golden ? 1 : 0, plot.occupancy?.seats ?? 0, plot.construction?.readyAt ?? 0, plot.construction?.startedAt ?? 0, plot.accent].join('|')
}

/**
 * One game's spot on the floor. The container depth-sorts as one static;
 * its outline sits in the floor layer and its labels in the overlay.
 */
export class PlotView {
    readonly container: Container
    readonly key: string
    readonly height: number
    private floor: Sprite | null = null
    private base: Sprite | null = null
    private glow: Sprite | null = null
    private sign: Sprite | null = null
    private worker: Sprite | null = null
    private workerY = 0
    private hook: Graphics | null = null
    private countdown: Countdown | null = null
    private twinkles: Twinkle[] = []
    private sparkles: Sprite[] = []
    private seated: Sprite[] = []
    private tags: Container[] = []
    private seatKey = ''
    /** Looks (lookKey) of the players seated here, so the engine keeps their textures. */
    seatLookKeys: string[] = []
    private anim: ((dt: number, t: number, intensity: number) => void) | null = null
    private animShown = false
    private twinklesSet = false
    private top: Pt | null = null
    private t = Math.random() * 100
    private dustT = 1
    playing = false
    private intensity = 0
    /** Called to puff construction dust at a world point. */
    onDust: ((x: number, y: number) => void) | null = null

    constructor(private readonly ctx: ViewContext, readonly layout: PlotLayout, readonly plot: FloorPlot, readonly show: PlotShow) {
        const { PIXI } = ctx
        this.key = plotKey(plot, show)
        this.container = new PIXI.Container()
        const origin = project(layout.rect.x, layout.rect.y)
        this.container.position.set(origin.x, origin.y)
        const { w, h } = layout.rect
        const seats = plot.occupancy?.seats ?? 5
        this.height = show === 'built' || (show === 'building' && plot.level >= 1)
            ? machineHeight(plot.archetype, Math.max(1, plot.level)) : show === 'building' ? 80 : 56

        if (show !== 'built' && !(show === 'building' && plot.level >= 1)) {
            const outlineColor = show === 'locked' ? '#9c95b8' : plot.accent
            const alpha = show === 'ghost' ? 0.42 : show === 'locked' ? 0.5 : 0.9
            const baked = ctx.bank.get(`outline:${w}x${h}:${outlineColor}:${alpha}`, () => {
                const c = footprintCanvas(w, h, 0, 4)
                return ctx.bank.bake(c.width, c.height, c.ox, c.oy, p => drawPlotOutline(p, w, h, outlineColor, alpha))
            })
            this.floor = sprite(ctx, baked)
            this.floor.position.set(origin.x, origin.y)
            ctx.floorLayer.addChild(this.floor)
        }
        if (show === 'ghost') return

        if (show === 'available' || show === 'locked') {
            // A faint preview of the machine, and the sign.
            const { baked } = machineTexture(ctx, plot, layout, 1, false, seats)
            this.base = sprite(ctx, baked)
            this.base.alpha = show === 'available' ? 0.22 : 0.12
            this.base.tint = 0xb8b0d8
            this.container.addChild(this.base)
            const signBaked = show === 'available'
                ? flatTexture(ctx, `buildsign:${plot.accent}`, BUILD_SIGN.width, BUILD_SIGN.height, BUILD_SIGN.ox, BUILD_SIGN.oy, c => drawBuildSign(c, plot.accent))
                : flatTexture(ctx, 'locksign', BUILD_SIGN.width, BUILD_SIGN.height, BUILD_SIGN.ox, BUILD_SIGN.oy, c => drawLockSign(c))
            this.sign = sprite(ctx, signBaked)
            const front = project(layout.front.x + 0.5 - layout.rect.x, layout.rect.h - 0.35)
            const mid = project(w / 2, h / 2)
            this.sign.position.set(mid.x * 0.4 + front.x * 0.6, mid.y * 0.4 + front.y * 0.6)
            this.container.addChild(this.sign)
            return
        }

        if (show === 'building') {
            if (plot.level >= 1) {
                const { baked } = machineTexture(ctx, plot, layout, plot.level, plot.golden, seats)
                this.base = sprite(ctx, baked)
                this.container.addChild(this.base)
            } else {
                const { baked } = machineTexture(ctx, plot, layout, 1, false, seats)
                this.base = sprite(ctx, baked)
                this.base.alpha = 0.35
                this.base.tint = 0xd8cfe8
                this.container.addChild(this.base)
            }
            const crane = w * h >= 4
            const sh = Math.max(46, Math.min(90, this.height * 0.75))
            const scaffold = ctx.bank.get(`scaffold:${w}x${h}:${Math.round(sh)}:${plot.accent}:${crane ? 1 : 0}`, () => {
                const c = footprintCanvas(w + 0.4, h + 0.4, sh + 60, 16)
                return ctx.bank.bake(c.width, c.height, c.ox, c.oy, p => drawScaffold(p, w, h, sh, plot.accent, crane))
            })
            const sc = sprite(ctx, scaffold)
            this.container.addChild(sc)
            if (crane) {
                this.hook = new PIXI.Graphics()
                this.container.addChild(this.hook)
                const at = craneHook(w, sh)
                this.anim = (dt, t) => {
                    const swing = Math.sin(t * 1.3) * 4
                    const len = 22 + Math.sin(t * 0.7) * 6
                    this.hook!.clear()
                    this.hook!.moveTo(at.x, at.y).lineTo(at.x + swing, at.y + len).stroke({ color: 0x2a1b30, width: 1.2 })
                    this.hook!.roundRect(at.x + swing - 4, at.y + len, 8, 6, 2).fill(0xffd23f).stroke({ color: 0x2a1b30, width: 1.2 })
                }
            }
            // A worker hammering away at the front corner.
            const frames = figureFrames(ctx.bank, WORKER_LOOK)
            this.worker = new PIXI.Sprite(frames.front[0])
            this.worker.anchor.set(FIGURE_FOOT.x / FIGURE_W, FIGURE_FOOT.y / FIGURE_H)
            const wp = project(w - 0.1, h + 0.05)
            this.workerY = wp.y
            this.worker.position.set(wp.x, wp.y)
            this.worker.scale.set(-0.9, 0.9)
            this.container.addChild(this.worker)
            if (plot.construction) {
                this.countdown = new Countdown(ctx, plot.construction.startedAt, plot.construction.readyAt)
                const top = this.topPoint()
                this.countdown.container.position.set(top.x, top.y - 6)
            }
            return
        }

        // Built.
        const { baked, info } = machineTexture(ctx, plot, layout, plot.level, plot.golden, seats)
        this.glow = new PIXI.Sprite(ctx.fx.pool.texture)
        this.glow.anchor.set(0.5)
        const mid = project(w / 2, h / 2)
        this.glow.position.set(origin.x + mid.x, origin.y + mid.y)
        this.glow.scale.set((w + h) * 0.42, (w + h) * 0.42)
        this.glow.tint = hexNum(plot.accent)
        this.glow.blendMode = 'add'
        this.glow.alpha = 0.16 + plot.level * 0.04
        ctx.floorLayer.addChild(this.glow)
        this.base = sprite(ctx, baked)
        this.container.addChild(this.base)
        this.buildAnimation()
        for (let i = 0; i < info.lights.length; i += 1) {
            if (i % 2 && info.lights.length > 14) continue
            const l = info.lights[i]!
            const s = new PIXI.Sprite(ctx.fx.glow.texture)
            s.anchor.set(0.5)
            s.position.set(l.x, l.y)
            s.scale.set(0.16)
            s.tint = 0xffe39a
            s.blendMode = 'add'
            this.container.addChild(s)
            this.twinkles.push({ sprite: s, phase: Math.random() * Math.PI * 2, speed: 2 + Math.random() * 3 })
        }
        if (plot.golden && !ctx.reduced) {
            for (let i = 0; i < 3; i++) {
                const s = new PIXI.Sprite(ctx.fx.sparkle.texture)
                s.anchor.set(0.5)
                s.blendMode = 'add'
                s.tint = 0xfff1b8
                s.alpha = 0
                this.container.addChild(s)
                this.sparkles.push(s)
            }
        }
        if (plot.occupancy) this.setSeated(plot.occupancy.seated, plot.occupancy.seats)
    }

    private buildAnimation() {
        const { ctx, plot } = this
        const { PIXI, bank, fx } = ctx
        const golden = plot.golden
        const accent = plot.accent
        switch (plot.archetype) {
            case 'slot': {
                const screens = slotScreens(plot.level)
                const reels: { s: Sprite, next: number }[] = []
                for (const sc of screens) {
                    const holder = new PIXI.Container()
                    holder.setFromMatrix(new PIXI.Matrix(1, 0.5, 0, 1, sc.origin.x, sc.origin.y))
                    for (let k = 0; k < 3; k++) {
                        const s = new PIXI.Sprite(fx.symbols[Math.floor(Math.random() * fx.symbols.length)]!.texture)
                        s.anchor.set(0.5)
                        s.position.set(sc.x + ((k + 0.5) * sc.w) / 3, sc.y + sc.h / 2)
                        s.scale.set(Math.min(1, sc.w / 3 / 8))
                        holder.addChild(s)
                        reels.push({ s, next: Math.random() * 2 })
                    }
                    const shine = new PIXI.Sprite(fx.glow.texture)
                    shine.anchor.set(0.5)
                    shine.position.set(sc.x + sc.w / 2, sc.y + sc.h / 2)
                    shine.scale.set(sc.w / 50, sc.h / 60)
                    shine.tint = hexNum(accent)
                    shine.blendMode = 'add'
                    shine.alpha = 0.35
                    holder.addChild(shine)
                    this.container.addChild(holder)
                }
                this.anim = (dt, _t, intensity) => {
                    for (const r of reels) {
                        r.next -= dt * (1 + intensity * 14)
                        if (r.next <= 0) {
                            r.s.texture = fx.symbols[Math.floor(Math.random() * fx.symbols.length)]!.texture
                            r.next = intensity > 0.5 ? 0.06 : 1.2 + Math.random() * 2.5
                            r.s.alpha = intensity > 0.5 ? 0.75 : 1
                        }
                    }
                }
                return
            }
            case 'dice': {
                const dice = DICE_SPOTS.map((p) => {
                    const s = new PIXI.Sprite(fx.dice[Math.floor(Math.random() * 6)]!.texture)
                    s.anchor.set(0.5, 0.8)
                    s.position.set(p.x, p.y)
                    this.container.addChild(s)
                    return { s, base: p, hop: -1, wait: 1 + Math.random() * 3 }
                })
                this.anim = (dt, _t, intensity) => {
                    for (const d of dice) {
                        if (d.hop < 0) {
                            d.wait -= dt * (1 + intensity * 4)
                            if (d.wait <= 0) d.hop = 0
                            continue
                        }
                        d.hop += dt * 2.2
                        const k = Math.min(1, d.hop)
                        d.s.y = d.base.y - Math.sin(k * Math.PI) * (12 + intensity * 10)
                        d.s.rotation = (1 - k) * 4
                        if (Math.random() < dt * 14) d.s.texture = fx.dice[Math.floor(Math.random() * 6)]!.texture
                        if (k >= 1) {
                            d.hop = -1
                            d.s.rotation = 0
                            d.wait = 2 + Math.random() * 4
                        }
                    }
                }
                return
            }
            case 'rocket': {
                const rocketBaked = bank.get(`rocket:${accent}:${golden ? 1 : 0}`, () => bank.bake(30, 52, 15, 50, (_p, c) => drawRocket(c, 15, 50, accent, golden)))
                const rocket = sprite(ctx, rocketBaked)
                const flame = sprite(ctx, fx.flame)
                flame.blendMode = 'add'
                const pad = new PIXI.Sprite(fx.glow.texture)
                pad.anchor.set(0.5)
                pad.tint = 0xffa53d
                pad.blendMode = 'add'
                pad.scale.set(0.9, 0.45)
                pad.position.set(ROCKET_BASE.x, ROCKET_BASE.y + 2)
                this.container.addChild(pad, flame, rocket)
                this.anim = (_dt, t, intensity) => {
                    const lift = 6 + Math.sin(t * 2.2) * 3 + intensity * (10 + Math.sin(t * 9) * 2)
                    const shake = intensity > 0.3 ? (Math.random() - 0.5) * 1.6 : 0
                    rocket.position.set(ROCKET_BASE.x + shake, ROCKET_BASE.y - lift)
                    flame.position.set(ROCKET_BASE.x + shake, ROCKET_BASE.y - lift + 1)
                    flame.scale.set(0.8 + Math.random() * 0.15 + intensity * 0.4, 0.7 + Math.random() * 0.3 + intensity * 0.8)
                    pad.alpha = 0.35 + intensity * 0.4 + Math.random() * 0.1
                }
                return
            }
            case 'wheel': {
                const r = WHEEL_RADIUS
                const wheelBaked = bank.get(`wheelface:${accent}:${golden ? 1 : 0}`, () => bank.bake(r * 2 + 4, r * 2 + 4, r + 2, r + 2, (_p, c) => drawWheelFace(c, r + 2, r + 2, r, accent, golden)))
                const holder = new PIXI.Container()
                holder.setFromMatrix(new PIXI.Matrix(1, 0.5, 0, 1, WHEEL_CENTER.x, WHEEL_CENTER.y))
                const wheel = sprite(ctx, wheelBaked)
                holder.addChild(wheel)
                const pointer = sprite(ctx, fx.pointer)
                pointer.position.set(WHEEL_CENTER.x, WHEEL_CENTER.y - r + 3)
                this.container.addChild(holder, pointer)
                let speed = 0.4
                this.anim = (dt, _t, intensity) => {
                    const target = 0.35 + intensity * 9
                    speed += (target - speed) * Math.min(1, dt * 2)
                    wheel.rotation += speed * dt
                }
                return
            }
            case 'flight': {
                const planeBaked = bank.get(`plane:${accent}:${golden ? 1 : 0}`, () => bank.bake(34, 26, 17, 13, (_p, c) => drawPlane(c, 17, 13, accent, golden)))
                const plane = sprite(ctx, planeBaked)
                const shadow = sprite(ctx, fx.shadow)
                shadow.scale.set(0.5, 0.5)
                shadow.alpha = 0.6
                this.container.addChild(shadow, plane)
                let a = Math.random() * 6
                this.anim = (dt, t, intensity) => {
                    a += dt * (0.7 + intensity * 1.8)
                    const x = Math.cos(a) * 20
                    const y = Math.sin(a) * 9
                    plane.position.set(FLIGHT_CENTER.x + x, FLIGHT_CENTER.y + y - Math.sin(t * 2) * 2)
                    plane.scale.x = -Math.sin(a) >= 0 ? 1 : -1
                    plane.rotation = Math.cos(a) * 0.12 * plane.scale.x
                    shadow.position.set(FLIGHT_CENTER.x + x, FLIGHT_CENTER.y + y + 24)
                }
                return
            }
            case 'hands': {
                const grid = new PIXI.Container()
                grid.setFromMatrix(new PIXI.Matrix(1, 0.5, -1, 0.5, HANDS_GRID.origin.x, HANDS_GRID.origin.y))
                const cellGlow = new PIXI.Sprite(fx.glow.texture)
                cellGlow.anchor.set(0.5)
                cellGlow.tint = hexNum(accent)
                cellGlow.blendMode = 'add'
                cellGlow.scale.set(0.42)
                grid.addChild(cellGlow)
                const gloves = HANDS_GLOVES.map((p, i) => {
                    const b = bank.get(`glove:${i}`, () => bank.bake(26, 26, 13, 13, (_p, c) => drawGlove(c, 13, 13, i === 1)))
                    const s = sprite(ctx, b)
                    s.position.set(p.x, p.y)
                    return { s, base: p, phase: i * 1.7 }
                })
                this.container.addChild(grid, ...gloves.map(g => g.s))
                let next = 0
                this.anim = (dt, t, intensity) => {
                    next -= dt * (1 + intensity * 4)
                    if (next <= 0) {
                        next = 0.7
                        const c = handsCell(Math.floor(Math.random() * 4), Math.floor(Math.random() * 4))
                        cellGlow.position.set(c.x, c.y)
                    }
                    cellGlow.alpha = 0.55 + Math.sin(t * 6) * 0.2
                    for (const g of gloves) g.s.position.set(g.base.x + Math.sin(t * 1.1 + g.phase) * 3, g.base.y - Math.sin(t * 2 + g.phase) * 3 - intensity * 6)
                }
                return
            }
            case 'roulette': {
                const R = ROULETTE_RADIUS
                const faceBaked = bank.get('roulette-face', () => bank.bake(R * 2 + 2, R * 2 + 2, R + 1, R + 1, (_p, c) => drawRouletteFace(c, R + 1, R + 1, R)))
                const holder = new PIXI.Container()
                holder.setFromMatrix(new PIXI.Matrix(1, 0.5, -1, 0.5, ROULETTE_CENTER.x, ROULETTE_CENTER.y))
                const face = sprite(ctx, faceBaked)
                const ball = new PIXI.Graphics()
                ball.circle(0, 0, 1.6).fill(0xffffff).stroke({ color: 0x2a1b30, width: 0.6 })
                holder.addChild(face, ball)
                this.container.addChild(holder)
                let ballA = 0
                let speed = 0.5
                this.anim = (dt, _t, intensity) => {
                    speed += (0.5 + intensity * 7 - speed) * Math.min(1, dt * 2)
                    face.rotation += speed * dt
                    ballA -= speed * 1.6 * dt
                    const br = R * (intensity > 0.3 ? 0.88 : 0.76)
                    ball.position.set(Math.cos(ballA) * br, Math.sin(ballA) * br)
                }
                return
            }
            case 'plinko': {
                // Balls drop through the board, peg to peg, into the slots.
                const b = plinkoBoard(plot.level)
                const holder = new PIXI.Container()
                holder.setFromMatrix(new PIXI.Matrix(1, 0.5, 0, 1, b.origin.x, b.origin.y))
                const balls = [0, 1, 2].map(() => {
                    const g = new PIXI.Graphics()
                    g.circle(0, 0, 2.1).fill(golden ? 0xffe9a6 : 0xffd23f).stroke({ color: 0x2a1b30, width: 0.8 })
                    g.visible = false
                    holder.addChild(g)
                    return { g, t: -Math.random() * 3, path: [] as number[] }
                })
                this.container.addChild(holder)
                const rowTime = 0.16
                this.anim = (dt, _t, intensity) => {
                    balls.forEach((ball, i) => {
                        // One ball idles; a played machine drops all three.
                        if (i > 0 && intensity < 0.3 && ball.t < 0) return
                        ball.t += dt * (1 + intensity * 1.5)
                        if (ball.t < 0) return
                        if (!ball.path.length) ball.path = Array.from({ length: b.rows + 1 }, () => (Math.random() < 0.5 ? -1 : 1))
                        const total = (b.rows + 1) * rowTime
                        if (ball.t >= total) {
                            ball.g.visible = false
                            ball.t = -(intensity > 0.3 ? 0.15 + Math.random() * 0.3 : 1.5 + Math.random() * 2.5)
                            ball.path = []
                            return
                        }
                        const seg = Math.min(b.rows, Math.floor(ball.t / rowTime))
                        const f = (ball.t - seg * rowTime) / rowTime
                        let off = 0
                        for (let k = 0; k < seg; k++) off += ball.path[k]!
                        const x0 = b.w / 2 + (off / 2) * b.dx
                        const x1 = x0 + (ball.path[seg]! / 2) * b.dx
                        const y0 = seg === 0 ? b.top - b.gap : b.top + (seg - 1) * b.gap
                        const y1 = b.top + seg * b.gap
                        // A little hop up off each peg, then down to the next.
                        const y = y0 + (y1 - y0) * f - Math.sin(f * Math.PI) * (seg === 0 ? 0 : b.gap * 0.45) - 2.4
                        ball.g.visible = true
                        ball.g.position.set(x0 + (x1 - x0) * f, y)
                    })
                }
                return
            }
            case 'mines': {
                // A tile is dug now and then: it pops a gem and glints.
                const grid = new PIXI.Container()
                grid.setFromMatrix(new PIXI.Matrix(1, 0.5, -1, 0.5, MINES_GRID.origin.x, MINES_GRID.origin.y))
                const glint = new PIXI.Sprite(fx.glow.texture)
                glint.anchor.set(0.5)
                glint.tint = 0x2fe0d0
                glint.blendMode = 'add'
                glint.scale.set(0.3)
                glint.alpha = 0
                grid.addChild(glint)
                const gemBaked = bank.get(`gem:${golden ? 1 : 0}`, () => bank.bake(12, 12, 6, 6, (_p, c) => drawGem(c, 6, 6, 4.2, golden ? '#f4c14f' : '#2fe0d0')))
                const gem = sprite(ctx, gemBaked)
                gem.alpha = 0
                const sparkle = new PIXI.Sprite(fx.sparkle.texture)
                sparkle.anchor.set(0.5)
                sparkle.blendMode = 'add'
                sparkle.alpha = 0
                this.container.addChild(grid, gem, sparkle)
                let next = 0.5
                let age = 9
                let at = { x: 0, y: 0 }
                this.anim = (dt, _t, intensity) => {
                    next -= dt * (1 + intensity * 3)
                    age += dt
                    if (next <= 0) {
                        next = 1.4 + Math.random() * 1.2
                        age = 0
                        const c = minesCell(Math.floor(Math.random() * MINES_GRID.n), Math.floor(Math.random() * MINES_GRID.n))
                        glint.position.set(c.x, c.y)
                        // The cell in machine space: top-plane local → screen.
                        at = { x: MINES_GRID.origin.x + c.x - c.y, y: MINES_GRID.origin.y + 0.5 * c.x + 0.5 * c.y }
                    }
                    const k = Math.min(1, age / 0.9)
                    glint.alpha = (1 - k) * 0.8
                    gem.alpha = age < 0.9 ? 1 - Math.max(0, (age - 0.6) / 0.3) : 0
                    gem.position.set(at.x, at.y - 3 - Math.sin(Math.min(1, age / 0.5) * Math.PI / 2) * 9)
                    sparkle.alpha = (1 - k) * 0.9
                    sparkle.rotation = age * 3
                    sparkle.position.set(at.x + 3, at.y - 12 - k * 4)
                }
                return
            }
            case 'hilo': {
                // The giant card flips to a new rank every few seconds.
                const { w, h } = HILO_CARD
                const ranks: [string, boolean][] = [['A', false], ['7', true], ['K', false], ['3', true], ['Q', true], ['9', false]]
                const faces = ranks.map(([rank, red]) => bank.get(`hilocard:${rank}:${red ? 1 : 0}`, () => bank.bake(w + 2, h + 2, (w + 2) / 2, 1, (_p, c) => drawCardFace(c, 1, 1, w, h, rank, red))))
                const holder = new PIXI.Container()
                holder.setFromMatrix(new PIXI.Matrix(1, 0.5, 0, 1, HILO_CARD.origin.x, HILO_CARD.origin.y))
                const card = sprite(ctx, faces[0]!)
                card.position.set(w / 2 + 1, 1)
                holder.addChild(card)
                const arrows = new PIXI.Sprite(fx.glow.texture)
                arrows.anchor.set(0.5)
                arrows.blendMode = 'add'
                arrows.scale.set(0.35, 0.2)
                arrows.alpha = 0
                this.container.addChild(holder, arrows)
                let face = 0
                let wait = 1.5 + Math.random() * 2
                let flip = -1
                this.anim = (dt, _t, intensity) => {
                    if (flip < 0) {
                        wait -= dt * (1 + intensity * 3)
                        if (wait <= 0) flip = 0
                    } else {
                        flip += dt * 3.2
                        if (flip >= 0.5 && card.texture !== faces[(face + 1) % faces.length]!.texture) {
                            face = (face + 1) % faces.length
                            card.texture = faces[face]!.texture
                            // Which call won: up or down glows on the felt.
                            const up = Math.random() < 0.5
                            const p = project(up ? 0.62 : 1.38, 1.12, 17)
                            arrows.position.set(p.x, p.y)
                            arrows.tint = up ? 0x3fd25a : 0xff5470
                            arrows.alpha = 0.9
                        }
                        card.scale.x = Math.max(0.04, Math.abs(Math.cos(flip * Math.PI)))
                        if (flip >= 1) {
                            flip = -1
                            card.scale.x = 1
                            wait = intensity > 0.3 ? 0.6 : 2.5 + Math.random() * 2.5
                        }
                    }
                    arrows.alpha = Math.max(0, arrows.alpha - dt * 0.9)
                }
                return
            }
            case 'cards':
                // Seated players come from occupancy (setSeated); the dealer is baked in.
                break
        }
    }

    /** Players seated at a live table, drawn on the stools with name tags. */
    setSeated(seated: { name: string, image: string | null, avatar?: AvatarLook }[], seats: number) {
        const looks = seated.slice(0, Math.max(seats, 1)).map(who => avatarLook(who.name, who.avatar))
        const key = seated.map(s => s.name).join('\u0001') + `|${seats}|` + looks.map(lookKey).join('\u0001')
        if (key === this.seatKey || this.show !== 'built') return
        this.seatKey = key
        for (const s of this.seated) s.destroy()
        for (const t of this.tags) t.destroy({ children: true })
        this.seated = []
        this.tags = []
        const { PIXI, bank } = this.ctx
        const n = Math.max(seats, 1)
        const order: { s: Sprite, depth: number }[] = []
        this.seatLookKeys = looks.map(lookKey)
        seated.slice(0, n).forEach((who, i) => {
            const seat = cardSeat(i, n)
            const frames = figureFrames(bank, looks[i]!)
            const s = new PIXI.Sprite(frames.sit)
            s.anchor.set(FIGURE_FOOT.x / FIGURE_W, FIGURE_FOOT.y / FIGURE_H)
            const p = project(seat.gx, seat.gy, STOOL_Z + 1)
            s.position.set(p.x, p.y)
            s.scale.x = seat.gx > 1.5 ? -1 : 1
            order.push({ s, depth: seat.gx + seat.gy })
            this.seated.push(s)
            const tag = makeNameTag(PIXI, who.name, false)
            const world = project(this.layout.rect.x + seat.gx, this.layout.rect.y + seat.gy, STOOL_Z + 52)
            tag.position.set(world.x, world.y)
            this.ctx.overlay.addChild(tag)
            this.tags.push(tag)
        })
        order.sort((a, b) => a.depth - b.depth).forEach(o => this.container.addChild(o.s))
    }

    setPlaying(on: boolean) {
        this.playing = on
    }

    /** World point above the machine, for floating text and labels. */
    topPoint(): Pt {
        if (!this.top) {
            const { rect } = this.layout
            this.top = project(rect.x + rect.w / 2, rect.y + rect.h / 2, this.height + 6)
        }
        return this.top
    }

    /** Overlay parts (countdown pill) that belong to this plot for clicks and hover. */
    overlays(): Container[] {
        return this.countdown ? [this.countdown.container] : []
    }

    update(dt: number) {
        this.t += dt
        const target = this.playing ? 1 : 0
        this.intensity += (target - this.intensity) * Math.min(1, dt * 4)
        const reduced = this.ctx.reduced
        if (this.anim) {
            // Reduced motion: machines hold still unless a round is playing on them.
            if (!reduced) this.anim(dt, this.t, this.intensity)
            else if (this.intensity > 0.02 || !this.animShown) this.anim(dt * 0.4, this.t * 0.4, this.intensity)
            this.animShown = true
        }
        if (!reduced) {
            for (const tw of this.twinkles) {
                tw.sprite.alpha = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(this.t * tw.speed * (1 + this.intensity * 2) + tw.phase))
            }
        } else if (!this.twinklesSet) {
            this.twinklesSet = true
            for (const tw of this.twinkles) tw.sprite.alpha = 0.55
        }
        if (this.glow) this.glow.alpha = 0.16 + this.plot.level * 0.04 + this.intensity * (0.25 + (reduced ? 0 : Math.sin(this.t * 8) * 0.08))
        if (this.sparkles.length) {
            const { rect } = this.layout
            this.sparkles.forEach((s, i) => {
                const phase = (this.t * 0.6 + i / this.sparkles.length) % 1
                if (phase < 0.02 || s.alpha === 0) {
                    const p = project(Math.random() * rect.w, Math.random() * rect.h, 10 + Math.random() * this.height * 0.8)
                    s.position.set(p.x, p.y)
                }
                const k = Math.sin(phase * Math.PI)
                s.alpha = k
                s.scale.set(0.2 + k * 0.45)
                s.rotation = phase * 3
            })
        }
        if (this.sign) {
            const s = this.ctx.reduced ? 0 : Math.sin(this.t * 2.4)
            this.sign.rotation = s * 0.04
            this.sign.scale.set(1 + Math.max(0, s) * 0.03)
        }
        if (this.worker) {
            const hit = reduced ? 0 : Math.abs(Math.sin(this.t * 5))
            this.worker.y = this.workerY - hit * 3
            this.dustT -= dt
            if (this.dustT <= 0 && this.onDust && !this.ctx.reduced) {
                this.dustT = 0.8 + Math.random() * 1.4
                const { rect } = this.layout
                const p = project(rect.x + Math.random() * rect.w, rect.y + rect.h - 0.1, 2)
                this.onDust(p.x, p.y)
            }
        }
        if (this.countdown) this.countdown.update()
    }

    /** Hidden while arrange mode carries it (a ghost stands in for it). */
    setHidden(hidden: boolean) {
        const show = !hidden
        if (this.container.visible === show) return
        this.container.visible = show
        if (this.floor) this.floor.visible = show
        if (this.glow) this.glow.visible = show
        if (this.countdown) this.countdown.container.visible = show
        for (const t of this.tags) t.visible = show
    }

    destroy() {
        this.floor?.destroy()
        this.glow?.destroy()
        this.countdown?.destroy()
        for (const t of this.tags) t.destroy({ children: true })
        this.container.destroy({ children: true })
    }
}

// ── cashier cage ───────────────────────────────────────────────────────────

export class CageView {
    readonly container: Container
    private base: Sprite
    private stacks: Sprite[] = []
    private glow: Sprite
    private bubble: Sprite
    private label: Container
    private labelText: Text
    private fill = 0
    private stored = -1
    private labelFull = false
    private t = 0

    constructor(private readonly ctx: ViewContext, origin: Pt, decor: number) {
        const { PIXI, bank, fx } = ctx
        this.container = new PIXI.Container()
        this.container.position.set(origin.x, origin.y)
        const rich = decor >= 3 ? 1 : 0
        const baked = bank.get(`cage:${rich}`, () => {
            const c = footprintCanvas(2, 2, 104, 14)
            return bank.bake(c.width, c.height, c.ox, c.oy, p => drawCage(p, decor), true)
        })
        this.base = sprite(ctx, baked)
        this.glow = new PIXI.Sprite(fx.glow.texture)
        this.glow.anchor.set(0.5)
        this.glow.blendMode = 'add'
        this.glow.tint = 0xffd23f
        this.glow.position.set(CAGE_PILE.x, CAGE_PILE.y - 10)
        this.glow.scale.set(2.2, 1.4)
        this.glow.alpha = 0
        this.container.addChild(this.base, this.glow)
        const slots = [-0.55, -0.25, 0.05, 0.35, 0.62, -0.4]
        for (let i = 0; i < 6; i++) {
            // The cage pays coins: gold stacks.
            const s = new PIXI.Sprite(fx.coinStacks[0]!.texture)
            const p = project(1 + slots[i]! * 1.1, 1.55 - slots[i]! * 0.1, 30)
            s.anchor.set(0.5, 1)
            s.position.set(p.x, p.y + 4)
            s.visible = false
            this.container.addChild(s)
            this.stacks.push(s)
        }
        this.bubble = new PIXI.Sprite(fx.emotes.bang.texture)
        this.bubble.anchor.set(0.5, 1)
        this.bubble.position.set(CAGE_TOP.x + 30, CAGE_TOP.y - 4)
        this.bubble.visible = false
        this.container.addChild(this.bubble)
        // Amount label in the overlay.
        this.label = new PIXI.Container()
        const bg = new PIXI.Graphics()
        this.labelText = new PIXI.Text({
            text: '',
            resolution: 2,
            style: { fontFamily: '"Lilita One", "Fredoka", system-ui, sans-serif', fontSize: 12, fill: 0xffffff, stroke: { color: 0x2a1b30, width: 3, join: 'round' } }
        })
        this.labelText.anchor.set(0, 0.5)
        const chip = new PIXI.Sprite(fx.coin.texture)
        chip.anchor.set(0.5)
        chip.scale.set(0.8)
        this.label.addChild(bg, chip, this.labelText)
        ;(this.label as Container & { bg?: Graphics, chipIcon?: Sprite }).bg = bg
        ;(this.label as Container & { bg?: Graphics, chipIcon?: Sprite }).chipIcon = chip
        ctx.overlay.addChild(this.label)
        const world = { x: origin.x + CAGE_TOP.x, y: origin.y + CAGE_TOP.y - 16 }
        this.label.position.set(world.x, world.y)
    }

    /** Returns true when the amount label changed size or visibility (the engine re-measures labels). */
    set(fill: number, stored: number): boolean {
        this.fill = Math.max(0, Math.min(1, fill))
        const n = Math.ceil(this.fill * 6 - 0.001)
        this.stacks.forEach((s, i) => {
            s.visible = i < n
            const h = Math.max(1, Math.min(6, Math.round(this.fill * 6 - i * 0.5)))
            s.texture = this.ctx.fx.coinStacks[h - 1]!.texture
        })
        const full = this.fill >= 1
        const wasVisible = this.label.visible
        let changed = false
        if (Math.floor(stored) !== this.stored || full !== this.labelFull) {
            changed = true
            this.stored = Math.floor(stored)
            this.labelFull = full
            this.labelText.text = formatCoins(this.stored, true)
            const label = this.label as Container & { bg: Graphics, chipIcon: Sprite }
            const w = this.labelText.width + 26
            label.bg.clear()
            label.bg.roundRect(-w / 2, -9, w, 18, 9).fill({ color: 0x2a1b30, alpha: 0.85 }).stroke({ color: this.fill >= 1 ? 0xffd23f : 0x5b4a6e, width: 1.4 })
            label.chipIcon.position.set(-w / 2 + 10, 0)
            this.labelText.position.set(-w / 2 + 19, 0.5)
        }
        this.label.visible = this.stored > 0
        return changed || wasVisible !== this.label.visible
    }

    /** Overlay parts (the amount label) that belong to the cage for clicks and hover. */
    overlays(): Container[] {
        return [this.label]
    }

    /** Where flying coins start (world). */
    pilePoint(): Pt {
        return { x: this.container.x + CAGE_PILE.x, y: this.container.y + CAGE_PILE.y - 8 }
    }

    update(dt: number) {
        this.t += dt
        const full = this.fill >= 0.999
        this.bubble.visible = full
        if (full) {
            const b = this.ctx.reduced ? 0 : Math.abs(Math.sin(this.t * 4)) * 4
            this.bubble.y = CAGE_TOP.y - 4 - b
            this.glow.alpha = 0.45 + (this.ctx.reduced ? 0 : Math.sin(this.t * 5) * 0.2)
            this.stacks.forEach((s, i) => (s.scale.y = 1 + (this.ctx.reduced ? 0 : Math.max(0, Math.sin(this.t * 6 - i * 0.6)) * 0.08)))
        } else {
            this.glow.alpha = this.fill * 0.25
        }
    }

    destroy() {
        this.label.destroy({ children: true })
        this.container.destroy({ children: true })
    }
}

// ── architect's desk ───────────────────────────────────────────────────────

export class DeskView {
    readonly container: Container
    private badge: Sprite
    private t = 0

    constructor(private readonly ctx: ViewContext, origin: Pt) {
        const { PIXI, bank } = ctx
        this.container = new PIXI.Container()
        this.container.position.set(origin.x, origin.y)
        const baked = bank.get('desk', () => {
            const c = footprintCanvas(2, 1, 80, 14)
            return bank.bake(c.width, c.height, c.ox, c.oy, p => drawDesk(p), true)
        })
        this.container.addChild(sprite(ctx, baked))
        const badge = flatTexture(ctx, 'buildbadge', BADGE.width, BADGE.height, BADGE.ox, BADGE.oy, c => drawBuildBadge(c))
        this.badge = sprite(ctx, badge)
        this.badge.position.set(DESK_TOP.x, DESK_TOP.y)
        this.container.addChild(this.badge)
    }

    update(dt: number) {
        this.t += dt
        if (this.ctx.reduced) return
        this.badge.y = DESK_TOP.y - Math.sin(this.t * 2.2) * 3
        this.badge.rotation = Math.sin(this.t * 1.3) * 0.08
    }

    destroy() {
        this.container.destroy({ children: true })
    }
}

// ── FOR SALE / OPENING SOON sign ───────────────────────────────────────────

export class SaleSignView {
    readonly container: Container
    private board: Sprite
    private countdown: Countdown | null = null
    private t = Math.random() * 10

    constructor(private readonly ctx: ViewContext, at: Pt, zoneName: string, construction: { startedAt: number, readyAt: number } | null) {
        const { PIXI } = ctx
        this.container = new PIXI.Container()
        this.container.position.set(at.x, at.y)
        const building = !!construction
        const baked = flatTexture(ctx, `sale:${zoneName}:${building ? 1 : 0}`, SALE_SIGN.width, SALE_SIGN.height, SALE_SIGN.ox, SALE_SIGN.oy, c => drawSaleSign(c, zoneName, building))
        this.board = sprite(ctx, baked)
        this.board.scale.set(0.82)
        this.container.addChild(this.board)
        if (construction) {
            this.countdown = new Countdown(ctx, construction.startedAt, construction.readyAt)
            this.countdown.container.position.set(at.x, at.y - 78)
        }
    }

    /** Overlay parts (the countdown) that belong to this sign for clicks and hover. */
    overlays(): Container[] {
        return this.countdown ? [this.countdown.container] : []
    }

    update(dt: number) {
        this.t += dt
        if (!this.ctx.reduced) {
            // A gentle "look at me" wiggle every few seconds.
            const phase = this.t % 4
            this.board.rotation = phase < 0.6 ? Math.sin(phase * Math.PI * 5) * 0.05 * (1 - phase / 0.6) : 0
        }
        this.countdown?.update()
    }

    destroy() {
        this.countdown?.destroy()
        this.container.destroy({ children: true })
    }
}
