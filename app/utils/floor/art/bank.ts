import type { Sprite, Texture } from 'pixi.js'
import { Painter, RES } from '../iso'

type Pixi = typeof import('pixi.js')

export interface Baked {
    texture: Texture
    /** Where the art's origin sits inside the texture, in world px. */
    ox: number
    oy: number
    width: number
    height: number
}

/**
 * Every texture the floor uses, drawn once on a canvas and cached by key.
 * Machines bake per (game, level, skin); floors and walls per zone state.
 */
export class TextureBank {
    private cache = new Map<string, Baked>()
    /** Canvas pixels per world pixel (2 on Retina desktops, less on phones). */
    readonly res: number

    constructor(private readonly PIXI: Pixi, res = RES) {
        this.res = Math.max(1, Math.min(2, res))
    }

    get(key: string, make: () => Baked): Baked {
        let baked = this.cache.get(key)
        if (!baked) {
            baked = make()
            this.cache.set(key, baked)
        }
        return baked
    }

    has(key: string): boolean {
        return this.cache.has(key)
    }

    /**
     * A canvas of width×height world px; `draw` gets a Painter whose grid
     * origin is at (ox, oy).
     */
    bake(width: number, height: number, ox: number, oy: number, draw: (p: Painter, ctx: CanvasRenderingContext2D) => void, mipmap = false): Baked {
        // Whole canvas pixels on both axes, so the texture is exactly w×h world px.
        const fit = (n: number) => {
            let v = Math.max(1, Math.ceil(n))
            while ((v * this.res) % 1 && v < n + 4) v++
            return v
        }
        const w = fit(width)
        const h = fit(height)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(w * this.res)
        canvas.height = Math.round(h * this.res)
        const ctx = canvas.getContext('2d')!
        ctx.imageSmoothingEnabled = true
        const painter = new Painter(ctx, ox, oy, this.res)
        draw(painter, ctx)
        const source = new this.PIXI.CanvasSource({
            resource: canvas,
            resolution: this.res,
            autoGenerateMipmaps: mipmap,
            scaleMode: 'linear'
        })
        const texture = new this.PIXI.Texture({ source, defaultAnchor: { x: ox / w, y: oy / h } })
        return { texture, ox, oy, width: w, height: h }
    }

    /** Drop (and free) every texture whose key starts with `prefix`. */
    drop(prefix: string) {
        for (const [key, baked] of this.cache) {
            if (!key.startsWith(prefix)) continue
            baked.texture.destroy(true)
            this.cache.delete(key)
        }
    }

    /** How many textures are cached (dev diagnostics). */
    get size(): number {
        return this.cache.size
    }

    /** Free textures under `prefix` that are not in `keep` (old floor states). */
    prune(prefix: string, keep: ReadonlySet<string>) {
        for (const [key, baked] of this.cache) {
            if (!key.startsWith(prefix) || keep.has(key)) continue
            baked.texture.destroy(true)
            this.cache.delete(key)
        }
    }

    destroy() {
        for (const baked of this.cache.values()) baked.texture.destroy(true)
        this.cache.clear()
    }
}

/** Point a sprite at a baked texture, anchored at its origin. */
export function useBaked(sprite: Sprite, baked: Baked) {
    sprite.texture = baked.texture
    sprite.anchor.set(baked.ox / baked.width, baked.oy / baked.height)
}
