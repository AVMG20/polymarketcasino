import type { Container, Sprite, Text, Texture } from 'pixi.js'
import type { FxTextures } from './art/fx'
import { CONFETTI } from './art/palette'

type Pixi = typeof import('pixi.js')

/**
 * Pooled particles, floating "+x" texts and chips flying to the HUD. Every
 * sprite is reused; nothing here allocates per frame once warmed up.
 */

interface Particle {
    sprite: Sprite
    vx: number
    vy: number
    gravity: number
    life: number
    max: number
    spin: number
    fadeIn: number
    scale0: number
    scale1: number
    drag: number
    /** Flight to a target (chips to the HUD). */
    path: { x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, delay: number } | null
}

export class Particles {
    private free: Sprite[] = []
    private live: Particle[] = []

    constructor(private readonly PIXI: Pixi, private readonly layer: Container, private readonly limit: number) {}

    get count(): number {
        return this.live.length
    }

    spawn(texture: Texture, x: number, y: number, opts: Partial<Omit<Particle, 'sprite'>> & { tint?: number, additive?: boolean, alpha?: number } = {}): Particle | null {
        if (this.live.length >= this.limit) return null
        const sprite = this.free.pop() ?? new this.PIXI.Sprite()
        sprite.texture = texture
        sprite.anchor.set(0.5)
        sprite.position.set(x, y)
        sprite.tint = opts.tint ?? 0xffffff
        sprite.blendMode = opts.additive ? 'add' : 'normal'
        sprite.alpha = opts.alpha ?? 1
        sprite.rotation = 0
        sprite.visible = true
        if (!sprite.parent) this.layer.addChild(sprite)
        const p: Particle = {
            sprite,
            vx: opts.vx ?? 0,
            vy: opts.vy ?? 0,
            gravity: opts.gravity ?? 0,
            life: 0,
            max: opts.max ?? 1,
            spin: opts.spin ?? 0,
            fadeIn: opts.fadeIn ?? 0,
            scale0: opts.scale0 ?? 1,
            scale1: opts.scale1 ?? opts.scale0 ?? 1,
            drag: opts.drag ?? 0,
            path: opts.path ?? null
        }
        sprite.scale.set(p.scale0)
        if (p.path) sprite.visible = p.path.delay <= 0
        this.live.push(p)
        return p
    }

    update(dt: number) {
        for (let i = this.live.length - 1; i >= 0; i--) {
            const p = this.live[i]!
            const s = p.sprite
            if (p.path && p.path.delay > 0) {
                p.path.delay -= dt
                s.visible = p.path.delay <= 0
                continue
            }
            p.life += dt
            const k = Math.min(1, p.life / p.max)
            if (p.path) {
                // Quadratic bezier with ease-in.
                const t = k * k * (3 - 2 * k)
                const a = 1 - t
                s.x = a * a * p.path.x0 + 2 * a * t * p.path.cx + t * t * p.path.x1
                s.y = a * a * p.path.y0 + 2 * a * t * p.path.cy + t * t * p.path.y1
            } else {
                p.vy += p.gravity * dt
                if (p.drag) {
                    const d = Math.exp(-p.drag * dt)
                    p.vx *= d
                    p.vy *= d
                }
                s.x += p.vx * dt
                s.y += p.vy * dt
            }
            s.rotation += p.spin * dt
            const sc = p.scale0 + (p.scale1 - p.scale0) * k
            s.scale.set(sc)
            const fadeOut = p.path ? 1 : Math.min(1, (1 - k) * 4)
            const fadeIn = p.fadeIn > 0 ? Math.min(1, p.life / p.fadeIn) : 1
            s.alpha = Math.min(fadeOut, fadeIn)
            if (k >= 1) {
                s.visible = false
                this.free.push(s)
                this.live[i] = this.live[this.live.length - 1]!
                this.live.pop()
            }
        }
    }

    clear() {
        for (const p of this.live) {
            p.sprite.visible = false
            this.free.push(p.sprite)
        }
        this.live.length = 0
    }
}

interface Floater {
    text: Text
    life: number
    max: number
    x: number
    y: number
    delay: number
}

export class FloatTexts {
    private free: Text[] = []
    private live: Floater[] = []

    constructor(private readonly PIXI: Pixi, private readonly layer: Container) {}

    spawn(label: string, x: number, y: number, fill: number, size = 18, delay = 0) {
        const text = this.free.pop() ?? new this.PIXI.Text({
            text: '',
            resolution: 2,
            style: {
                fontFamily: '"Lilita One", "Fredoka", system-ui, sans-serif',
                fontSize: 18,
                fill: 0xffffff,
                stroke: { color: 0x2a1b30, width: 5, join: 'round' },
                dropShadow: { color: 0x120a1a, alpha: 0.5, blur: 0, distance: 2, angle: Math.PI / 2 }
            }
        })
        text.text = label
        text.style.fill = fill
        text.style.fontSize = size
        text.anchor.set(0.5, 1)
        text.position.set(x, y)
        text.alpha = 0
        text.visible = delay <= 0
        if (!text.parent) this.layer.addChild(text)
        this.live.push({ text, life: 0, max: 1.7, x, y, delay })
    }

    update(dt: number) {
        for (let i = this.live.length - 1; i >= 0; i--) {
            const f = this.live[i]!
            if (f.delay > 0) {
                f.delay -= dt
                if (f.delay > 0) continue
                f.text.visible = true
            }
            f.life += dt
            const k = f.life / f.max
            // Pop in, float up, fade out.
            const pop = Math.min(1, f.life / 0.18)
            const over = pop < 1 ? 1 + (1 - pop) * 0.6 : 1
            f.text.scale.set(over * (0.6 + 0.4 * pop))
            f.text.y = f.y - 34 * (1 - (1 - Math.min(1, k * 1.4)) ** 2)
            f.text.alpha = k < 0.75 ? Math.min(1, f.life / 0.1) : Math.max(0, 1 - (k - 0.75) / 0.25)
            if (k >= 1) {
                f.text.visible = false
                this.free.push(f.text)
                this.live.splice(i, 1)
            }
        }
    }

    clear() {
        for (const f of this.live) {
            f.text.visible = false
            this.free.push(f.text)
        }
        this.live.length = 0
    }
}

/** A burst of coins (and confetti on a big win) from a world point. */
export function coinBurst(particles: Particles, fx: FxTextures, x: number, y: number, big: boolean, reduced: boolean, chips = false) {
    const coins = Math.round((big ? 26 : 10) * (reduced ? 0.35 : 1))
    for (let i = 0; i < coins; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9
        const sp = 90 + Math.random() * (big ? 170 : 90)
        particles.spawn(chips && i % 2 ? fx.chip.texture : fx.coin.texture, x, y, {
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            gravity: 420,
            max: 0.9 + Math.random() * 0.5,
            spin: (Math.random() - 0.5) * 8,
            scale0: 0.8 + Math.random() * 0.4
        })
    }
    if (!big || reduced) return
    for (let i = 0; i < 34; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4
        const sp = 120 + Math.random() * 200
        particles.spawn(fx.confetti.texture, x, y - 10, {
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            gravity: 260,
            drag: 2.2,
            max: 1.4 + Math.random() * 0.8,
            spin: (Math.random() - 0.5) * 14,
            tint: CONFETTI[i % CONFETTI.length],
            scale0: 0.9
        })
    }
    for (let i = 0; i < 8; i++) {
        particles.spawn(fx.sparkle.texture, x + (Math.random() - 0.5) * 70, y - Math.random() * 50, {
            max: 0.6 + Math.random() * 0.4,
            scale0: 0.2,
            scale1: 1.1,
            spin: 3,
            additive: true,
            tint: 0xffe9a6
        })
    }
}
