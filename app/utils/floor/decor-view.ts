import type { Container, Sprite } from 'pixi.js'
import { isSpecial, type DecorType } from '#shared/decor'
import type { Rect } from '#shared/floor/layout'
import type { Baked } from './art/bank'
import { decorCanvas, decorFlat, decorHeight, decorLights, decorPool, decorSize, drawDecor } from './art/decor'
import { project } from './iso'
import type { ViewContext } from './views'

/** A decoration's baked art (shared by every copy, the arrange ghost and the floor). */
export function decorTexture(ctx: ViewContext, type: DecorType): Baked {
    return ctx.bank.get(`decor:${type}`, () => {
        const c = decorCanvas(type)
        return ctx.bank.bake(c.width, c.height, c.ox, c.oy, p => drawDecor(p, type), true)
    })
}

interface Light {
    sprite: Sprite
    base: number
    phase: number
    twinkle: boolean
}

/**
 * One decoration on the floor. Its container depth-sorts as a static (a
 * rug's lies flat in the rug layer instead); a light pool goes on the floor.
 * Specials glow softly gold underneath and sparkle, so they read as special.
 */
export class DecorView {
    readonly container: Container
    readonly rect: Rect
    readonly height: number
    readonly flat: boolean
    readonly special: boolean
    /** What it is and where: a change rebuilds the view. */
    readonly key: string
    private pool: Sprite | null = null
    private lights: Light[] = []
    private sparkles: Sprite[] = []
    private t = Math.random() * 10
    private hidden = false

    constructor(private readonly ctx: ViewContext, readonly id: number, readonly type: DecorType, x: number, y: number) {
        const { PIXI, fx } = ctx
        const { w, h } = decorSize(type)
        this.rect = { x, y, w, h }
        this.key = `${type}:${x}:${y}`
        this.height = decorHeight(type)
        this.flat = decorFlat(type)
        this.special = isSpecial(type)
        this.container = new PIXI.Container()
        const origin = project(x, y)
        this.container.position.set(origin.x, origin.y)
        const baked = decorTexture(ctx, type)
        const art = new PIXI.Sprite(baked.texture)
        art.anchor.set(baked.ox / baked.width, baked.oy / baked.height)
        this.container.addChild(art)

        const pool = decorPool(type)
        if (pool) {
            this.pool = new PIXI.Sprite(fx.pool.texture)
            this.pool.anchor.set(0.5)
            const p = project(x + pool.gx, y + pool.gy)
            this.pool.position.set(p.x, p.y)
            this.pool.scale.set(pool.scale)
            this.pool.tint = pool.tint
            this.pool.blendMode = 'add'
            this.pool.alpha = pool.alpha
            ctx.floorLayer.addChildAt(this.pool, 0)
        }
        for (const l of decorLights(type)) {
            const s = new PIXI.Sprite(fx.glow.texture)
            s.anchor.set(0.5)
            s.position.set(l.x, l.y)
            s.scale.set(l.scale)
            s.tint = l.tint
            s.alpha = l.alpha
            s.blendMode = 'add'
            this.container.addChild(s)
            this.lights.push({ sprite: s, base: l.alpha, phase: Math.random() * Math.PI * 2, twinkle: !!l.twinkle })
        }
        if (this.special && !ctx.reduced) {
            for (let i = 0; i < 3; i++) {
                const s = new PIXI.Sprite(fx.sparkle.texture)
                s.anchor.set(0.5)
                s.blendMode = 'add'
                s.tint = 0xfff1b8
                s.alpha = 0
                this.container.addChild(s)
                this.sparkles.push(s)
            }
        }
    }

    /** Hidden while arrange mode carries it (the ghost stands in for it). */
    setHidden(hidden: boolean) {
        if (hidden === this.hidden) return
        this.hidden = hidden
        this.container.visible = !hidden
        if (this.pool) this.pool.visible = !hidden
    }

    update(dt: number) {
        if (this.hidden) return
        this.t += dt
        if (this.ctx.reduced) return
        for (const l of this.lights) {
            l.sprite.alpha = l.twinkle
                ? l.base * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.t * 4 + l.phase * 3)))
                : l.base * (0.88 + Math.sin(this.t * 2.1 + l.phase) * 0.1)
        }
        if (this.sparkles.length) {
            const { w, h } = this.rect
            this.sparkles.forEach((s, i) => {
                const phase = (this.t * 0.55 + i / this.sparkles.length) % 1
                if (phase < 0.03 || s.alpha === 0) {
                    const p = project(0.1 + Math.random() * (w - 0.2), 0.1 + Math.random() * (h - 0.2), 12 + Math.random() * this.height * 0.85)
                    s.position.set(p.x, p.y)
                }
                const k = Math.sin(phase * Math.PI)
                s.alpha = k
                s.scale.set(0.18 + k * 0.42)
                s.rotation = phase * 3
            })
        }
    }

    destroy() {
        this.pool?.destroy()
        this.container.destroy({ children: true })
    }
}
