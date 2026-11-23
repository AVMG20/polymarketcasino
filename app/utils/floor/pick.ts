import type { Container, Texture } from 'pixi.js'

type Pixi = typeof import('pixi.js')

/**
 * Pixel-precise picking on the floor. Sprites are tested against the alpha of
 * their baked canvas (one byte per texture pixel, built on first use), labels
 * (Graphics, Text) against their local bounds. Additive light sprites never
 * catch a click: they are glow, not a surface.
 */

interface Mask {
    /** Texture units (world px) per mask cell: 1. */
    w: number
    h: number
    data: Uint8Array
}

/** Alpha above this (0-255) counts as a visible pixel. */
const SOLID = 72

const masks = new WeakMap<object, Mask | null>()

function maskOf(texture: Texture): Mask | null {
    const source = texture.source
    const cached = masks.get(source)
    if (cached !== undefined) return cached
    let mask: Mask | null = null
    const resource = source.resource as unknown
    if (typeof HTMLCanvasElement !== 'undefined' && resource instanceof HTMLCanvasElement) {
        try {
            const ctx = resource.getContext('2d')
            if (ctx && resource.width && resource.height) {
                const res = source.resolution || 1
                const pw = resource.width
                const ph = resource.height
                const img = ctx.getImageData(0, 0, pw, ph).data
                // One cell per world px: the strongest alpha in that block of canvas pixels.
                const w = Math.max(1, Math.ceil(pw / res))
                const h = Math.max(1, Math.ceil(ph / res))
                const data = new Uint8Array(w * h)
                for (let py = 0; py < ph; py++) {
                    const cy = Math.min(h - 1, Math.floor(py / res)) * w
                    for (let px = 0; px < pw; px++) {
                        const a = img[(py * pw + px) * 4 + 3]!
                        const i = cy + Math.min(w - 1, Math.floor(px / res))
                        if (a > data[i]!) data[i] = a
                    }
                }
                mask = { w, h, data }
            }
        } catch {
            mask = null
        }
    }
    masks.set(source, mask)
    return mask
}

const scratch = { x: 0, y: 0 }

export class Picker {
    constructor(private readonly PIXI: Pixi) {}

    /**
     * True when the screen point (canvas CSS px) lands on a visible pixel of
     * `node` or one of its descendants.
     */
    hit(node: Container, sx: number, sy: number): boolean {
        if (!node.visible || node.alpha < 0.05 || node.destroyed) return false
        const kids = node.children
        for (let i = kids.length - 1; i >= 0; i--) {
            if (this.hit(kids[i]!, sx, sy)) return true
        }
        const { PIXI } = this
        if (node instanceof PIXI.Sprite) {
            if (node.blendMode === 'add') return false
            const tex = node.texture
            if (!tex || tex === PIXI.Texture.EMPTY) return false
            node.toLocal({ x: sx, y: sy }, undefined, scratch)
            const ow = tex.orig.width
            const oh = tex.orig.height
            const u = scratch.x + node.anchor.x * ow
            const v = scratch.y + node.anchor.y * oh
            if (u < 0 || v < 0 || u >= ow || v >= oh) return false
            const mask = maskOf(tex)
            // No readable pixels (e.g. an image texture): the box is the shape.
            if (!mask) return true
            const mx = Math.floor(tex.frame.x + u)
            const my = Math.floor(tex.frame.y + v)
            if (mx < 0 || my < 0 || mx >= mask.w || my >= mask.h) return false
            return mask.data[my * mask.w + mx]! > SOLID
        }
        if (node instanceof PIXI.Graphics || node instanceof PIXI.Text) {
            node.toLocal({ x: sx, y: sy }, undefined, scratch)
            const b = node.getLocalBounds()
            return scratch.x >= b.minX && scratch.x <= b.maxX && scratch.y >= b.minY && scratch.y <= b.maxY
        }
        return false
    }
}
