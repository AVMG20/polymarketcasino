import type { Container, Sprite, Texture } from 'pixi.js'
import type { TextureBank } from './art/bank'
import { FIGURE_FOOT, FIGURE_H, FIGURE_W, drawFigure, lookKey, type Frame, type Look, type Pose } from './art/characters'
import type { Emote, FxTextures } from './art/fx'
import { project } from './iso'
import type { Tile } from './layout'

type Pixi = typeof import('pixi.js')

/** The baked frames of one look. */
export interface FigureFrames {
    front: Texture[]
    back: Texture[]
    sit: Texture
}

const POSES: readonly [Pose, Frame][] = [['front', 0], ['front', 1], ['front', 2], ['back', 0], ['back', 1], ['back', 2], ['sit', 0]]

/** The bank keys of a look's baked frames (by `lookKey`), to keep or free them. */
export function figureKeys(key: string): string[] {
    return POSES.map(([pose, frame]) => `fig:${key}:${pose}:${frame}`)
}

export function figureFrames(bank: TextureBank, look: Look): FigureFrames {
    const key = lookKey(look)
    const make = (pose: Pose, frame: Frame) => bank.get(`fig:${key}:${pose}:${frame}`, () =>
        bank.bake(FIGURE_W, FIGURE_H, FIGURE_FOOT.x, FIGURE_FOOT.y, (_p, ctx) => drawFigure(ctx, FIGURE_FOOT.x, FIGURE_FOOT.y, look, pose, frame, 1))).texture
    return {
        front: [make('front', 0), make('front', 1), make('front', 2)],
        back: [make('back', 0), make('back', 1), make('back', 2)],
        sit: make('sit', 0)
    }
}

/** A name tag in the overlay layer, with its half size (unscaled) for the de-overlap test. */
export interface NameTag extends Container {
    halfW: number
    halfH: number
}

/** A name tag: a dark pill with the name, in the overlay layer. */
export function makeNameTag(PIXI: Pixi, name: string, highlight: boolean): NameTag {
    const tag = new PIXI.Container() as NameTag
    const text = new PIXI.Text({
        text: name.length > 16 ? `${name.slice(0, 15)}…` : name,
        resolution: 2,
        style: { fontFamily: '"Fredoka", system-ui, sans-serif', fontSize: 10.5, fontWeight: '600', fill: highlight ? 0x2a1b30 : 0xffffff }
    })
    text.anchor.set(0.5)
    const w = Math.ceil(text.width) + 12
    const h = 15
    const bg = new PIXI.Graphics()
    bg.roundRect(-w / 2, -h / 2, w, h, h / 2).fill({ color: highlight ? 0xffd86b : 0x2a1b30, alpha: highlight ? 1 : 0.78 })
    if (highlight) bg.roundRect(-w / 2, -h / 2, w, h, h / 2).stroke({ color: 0x2a1b30, width: 1.4 })
    tag.addChild(bg, text)
    tag.halfW = w / 2
    tag.halfH = h / 2
    return tag
}

export const WALK_SPEED = 3.1

/**
 * A walking figure on the grid: position in grid space (tile centres at
 * .5), a path of tiles, frames picked by direction, a bob while walking.
 */
export class Actor {
    readonly container: Container
    readonly body: Sprite
    readonly shadow: Sprite
    x: number
    y: number
    path: Tile[] = []
    speed = WALK_SPEED
    moving = false
    private right = true
    private back = false
    private step = Math.random() * 10
    private emote: Sprite | null = null
    private emoteT = 0
    private emoteMax = 0
    /** Extra hop (cheering, dancing), px. */
    jump = 0
    tag: NameTag | null = null

    constructor(private readonly PIXI: Pixi, private frames: FigureFrames, private readonly fx: FxTextures, tile: Tile) {
        this.container = new PIXI.Container()
        this.shadow = new PIXI.Sprite(fx.shadow.texture)
        this.shadow.anchor.set(0.5)
        this.shadow.scale.set(0.62, 0.62)
        this.body = new PIXI.Sprite(frames.front[0])
        this.body.anchor.set(FIGURE_FOOT.x / FIGURE_W, FIGURE_FOOT.y / FIGURE_H)
        this.container.addChild(this.shadow, this.body)
        this.x = tile.x + 0.5
        this.y = tile.y + 0.5
        this.place()
    }

    /** Swap the look: the body shows the new frames at once, so the old textures can be freed right after. */
    setFrames(frames: FigureFrames) {
        this.frames = frames
        this.applyFrame(this.moving ? (Math.floor(this.step) % 2 ? 1 : 2) : 0)
    }

    get tile(): Tile {
        return { x: Math.floor(this.x), y: Math.floor(this.y) }
    }

    /** The tile the actor is walking onto (or standing on). */
    get nextTile(): Tile {
        return this.path[0] ?? this.tile
    }

    walk(path: Tile[]) {
        // Keep the step in progress, then follow the new route from there.
        const current = this.path[0]
        if (current && (path[0]?.x !== current.x || path[0]?.y !== current.y)) this.path = [current, ...path]
        else this.path = path.slice()
        this.moving = this.path.length > 0
    }

    stop() {
        this.path = []
        this.moving = false
    }

    face(target: Tile | { x: number, y: number }) {
        const dx = target.x + 0.5 - this.x
        const dy = target.y + 0.5 - this.y
        const sx = dx - dy
        const sy = dx + dy
        if (Math.abs(sx) > 0.05) this.right = sx > 0
        this.back = sy < -0.05
        this.applyFrame(0)
    }

    showEmote(kind: Emote, duration = 1.8) {
        if (!this.emote) {
            this.emote = new this.PIXI.Sprite(this.fx.emotes[kind].texture)
            this.emote.anchor.set(0.5, 1)
            this.container.addChild(this.emote)
        }
        this.emote.texture = this.fx.emotes[kind].texture
        this.emote.visible = true
        this.emoteT = 0
        this.emoteMax = duration
    }

    /** Returns true on the frame the actor reaches the end of its path. */
    update(dt: number): boolean {
        let arrived = false
        if (this.path.length) {
            let budget = this.speed * dt
            while (budget > 0 && this.path.length) {
                const t = this.path[0]!
                const tx = t.x + 0.5
                const ty = t.y + 0.5
                const dx = tx - this.x
                const dy = ty - this.y
                const d = Math.hypot(dx, dy)
                if (d > 0.001) {
                    const sx = dx - dy
                    const sy = dx + dy
                    if (Math.abs(sx) > 0.01) this.right = sx > 0
                    if (Math.abs(sy) > 0.01) this.back = sy < 0
                }
                if (d <= budget) {
                    this.x = tx
                    this.y = ty
                    budget -= d
                    this.path.shift()
                } else {
                    this.x += (dx / d) * budget
                    this.y += (dy / d) * budget
                    budget = 0
                }
            }
            if (!this.path.length) {
                this.moving = false
                arrived = true
            } else {
                this.moving = true
            }
        }
        if (this.moving) this.step += dt * this.speed * 2.4
        const frame: Frame = this.moving ? (Math.floor(this.step) % 2 ? 1 : 2) : 0
        this.applyFrame(frame)
        // Walk bob and a little squash on each footfall.
        const bob = this.moving ? Math.abs(Math.sin(this.step * Math.PI)) * 2.2 : 0
        this.body.y = -bob - this.jump
        const squash = this.moving ? 1 + Math.sin(this.step * Math.PI * 2) * 0.025 : 1
        this.body.scale.set(this.right ? 1 : -1, squash)
        this.body.scale.x *= 1 / Math.sqrt(squash)
        this.shadow.scale.set(0.62 - this.jump * 0.006, 0.62 - this.jump * 0.006)
        if (this.emote?.visible) {
            this.emoteT += dt
            const k = this.emoteT / this.emoteMax
            const pop = Math.min(1, this.emoteT / 0.16)
            this.emote.scale.set(0.5 + pop * 0.5 + (pop < 1 ? 0 : Math.max(0, 0.08 - this.emoteT * 0.2)))
            this.emote.y = this.body.y - 50 - Math.sin(this.emoteT * 3) * 1.5
            this.emote.alpha = k > 0.8 ? (1 - k) / 0.2 : 1
            if (k >= 1) this.emote.visible = false
        }
        this.place()
        return arrived
    }

    private applyFrame(frame: Frame) {
        const set = this.back ? this.frames.back : this.frames.front
        const tex = set[frame]!
        if (this.body.texture !== tex) this.body.texture = tex
    }

    place() {
        const p = project(this.x, this.y)
        this.container.position.set(p.x, p.y)
        if (this.tag) this.tag.position.set(p.x, p.y - 62 - this.jump)
    }

    destroy() {
        this.tag?.destroy({ children: true })
        this.container.destroy({ children: true })
    }
}
