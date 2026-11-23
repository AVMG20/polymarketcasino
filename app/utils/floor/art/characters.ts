import { DEFAULT_AVATAR, findCosmetic, type AvatarLook } from '#shared/cosmetics'
import { INK, darken, hashString, lighten, roundRect } from '../iso'
import { HAIRS, PANTS, SHIRTS, SKINS } from './palette'

/**
 * Chunky chibi figures: a big round head, a small body, stubby legs. Drawn
 * in screen space (not iso) with their feet at (x, y), facing right in a
 * three-quarter view; sprites flip for the other side.
 */

export type HairStyle = 'short' | 'long' | 'bun' | 'spiky' | 'bald'
export type Hat = 'none' | 'hardhat' | 'cap' | 'crown' | 'bow' | 'party' | 'beanie' | 'tophat' | 'cowboy'
/** Patterns and suits over the shirt (avatar cosmetics). */
export type Outfit = 'classic' | 'stripes' | 'hoodie' | 'hawaiian' | 'tuxedo' | 'goldsuit'
export type Accessory = 'none' | 'shades' | 'headphones' | 'monocle' | 'goldchain'

export interface Look {
    skin: string
    hair: string
    style: HairStyle
    shirt: string
    pants: string
    hat: Hat
    hatColor: string
    /** Dealer's waistcoat and bow tie. */
    dealer?: boolean
    /** A player's avatar cosmetics (shared/cosmetics.ts). Set on players only, never on guests. */
    outfit?: Outfit
    accessory?: Accessory
}

export type Pose = 'front' | 'back' | 'sit'

/** Frame 0 stands, 1 and 2 are the two steps. */
export type Frame = 0 | 1 | 2

// Room above the head for tall hats (top hat, party hat) and on the sides for a cowboy brim.
export const FIGURE_W = 40
export const FIGURE_H = 74
/** Feet position inside a figure canvas. */
export const FIGURE_FOOT = { x: 20, y: 70 }

export function lookKey(look: Look): string {
    const base = [look.skin, look.hair, look.style, look.shirt, look.pants, look.hat, look.hatColor, look.dealer ? 'd' : ''].join('|')
    // A player's look (outfit set) gets its own key space, so its textures can be freed without touching a guest's.
    return look.outfit ? `p|${look.outfit}|${look.accessory ?? 'none'}|${base}` : base
}

/** Every look key of a player's avatar starts with this (see lookKey). */
export const PLAYER_LOOK_PREFIX = 'p|'

const HAT_IDS: readonly Hat[] = ['none', 'cap', 'party', 'beanie', 'tophat', 'cowboy', 'crown']
const OUTFIT_IDS: readonly Outfit[] = ['classic', 'stripes', 'hoodie', 'hawaiian', 'tuxedo', 'goldsuit']
const ACCESSORY_IDS: readonly Accessory[] = ['none', 'shades', 'headphones', 'monocle', 'goldchain']
/** Suits replace the shirt colour; patterns keep the player's own colour. */
const SUIT_COLOR: Partial<Record<Outfit, string>> = { hoodie: '#6f86e8', hawaiian: '#ef7a3a', tuxedo: '#2b2236', goldsuit: '#e9b73c' }

/**
 * A player's figure: the look their name gives (skin, hair, colours) with
 * their avatar cosmetics on top. Unknown items fall back to the defaults.
 */
export function avatarLook(name: string, avatar?: AvatarLook | null): Look {
    const base = lookFromName(name)
    const a = avatar ?? DEFAULT_AVATAR
    const hat = HAT_IDS.includes(a.hat as Hat) ? a.hat as Hat : 'none'
    const outfit = OUTFIT_IDS.includes(a.outfit as Outfit) ? a.outfit as Outfit : 'classic'
    const accessory = ACCESSORY_IDS.includes(a.accessory as Accessory) ? a.accessory as Accessory : 'none'
    return {
        ...base,
        hat,
        hatColor: findCosmetic(`hat:${hat}`)?.color ?? base.hatColor,
        shirt: SUIT_COLOR[outfit] ?? base.shirt,
        outfit,
        accessory
    }
}

const STYLES: HairStyle[] = ['short', 'long', 'bun', 'spiky', 'short', 'long', 'bald']
const HATS: Hat[] = ['none', 'none', 'none', 'none', 'cap', 'bow', 'none']

/** A guest's look from a seed (stable per seed). */
export function lookFromSeed(seed: number): Look {
    const pick = <T>(list: readonly T[], salt: number) => list[Math.abs(Math.imul(seed ^ salt, 2654435761)) % list.length]!
    const style = pick(STYLES, 0x51)
    return {
        skin: pick(SKINS, 0x13),
        hair: pick(HAIRS, 0x27),
        style,
        shirt: pick(SHIRTS, 0x3b),
        pants: pick(PANTS, 0x4f),
        hat: style === 'bald' ? 'cap' : pick(HATS, 0x63),
        hatColor: pick(SHIRTS, 0x77)
    }
}

export function lookFromName(name: string): Look {
    return lookFromSeed(hashString(name || 'player'))
}

export const DEALER_LOOK: Look = { skin: '#f1c7a2', hair: '#2d1d17', style: 'short', shirt: '#fbf6ee', pants: '#2b2b3a', hat: 'none', hatColor: '#000', dealer: true }
export const DEALER_LOOK_2: Look = { skin: '#a86c47', hair: '#20202e', style: 'bun', shirt: '#fbf6ee', pants: '#2b2b3a', hat: 'none', hatColor: '#000', dealer: true }
export const WORKER_LOOK: Look = { skin: '#eab68f', hair: '#5b3a24', style: 'short', shirt: '#f2a23d', pants: '#2f4a6b', hat: 'hardhat', hatColor: '#f5d24a' }
export const ARCHITECT_LOOK: Look = { skin: '#cf946a', hair: '#2d1d17', style: 'short', shirt: '#4ea6e0', pants: '#3b3552', hat: 'hardhat', hatColor: '#fbf6ee' }
export const CASHIER_LOOK: Look = { skin: '#f7d2b6', hair: '#a5582c', style: 'bun', shirt: '#fbf6ee', pants: '#2b2b3a', hat: 'none', hatColor: '#000', dealer: true }

interface Shape {
    path: (ctx: CanvasRenderingContext2D) => void
    fill: string | CanvasGradient
}

/**
 * Draw a figure with its feet at (x, y). `turn` 1 looks right, 0 straight
 * at the viewer (dealers).
 */
export function drawFigure(ctx: CanvasRenderingContext2D, x: number, y: number, look: Look, pose: Pose = 'front', frame: Frame = 0, turn: 0 | 1 = 1) {
    const back = pose !== 'front'
    const sit = pose === 'sit'
    const shapes: Shape[] = []
    const lift = (f: Frame, leg: 0 | 1) => (f === 1 && leg === 0) || (f === 2 && leg === 1) ? 2.5 : 0
    const bodyDrop = sit ? 7 : 0
    const t = back ? 0 : turn * 1.6

    // Legs (hidden when sitting: the stool and table take them).
    if (!sit) {
        for (const leg of [0, 1] as const) {
            const lx = x + (leg === 0 ? -6 : 1)
            const ly = y - 11 - lift(frame, leg)
            shapes.push({ path: c => roundRect(c, lx, ly, 5, 11, 2.4), fill: look.pants })
        }
    }

    // Arms swing with the step.
    const swing = frame === 1 ? 1.5 : frame === 2 ? -1.5 : 0
    const armY = y - 23 + bodyDrop
    shapes.push({ path: c => roundRect(c, x - 11.5, armY + swing, 5, 11, 2.5), fill: darken(look.shirt, 0.12) })
    shapes.push({ path: c => roundRect(c, x + 6.5, armY - swing, 5, 11, 2.5), fill: darken(look.shirt, 0.12) })

    // Torso.
    const torsoY = y - 25 + bodyDrop
    const torsoGrad = ctx.createLinearGradient(x - 8, torsoY, x + 8, torsoY + 15)
    torsoGrad.addColorStop(0, lighten(look.shirt, 0.18))
    torsoGrad.addColorStop(1, darken(look.shirt, 0.08))
    shapes.push({ path: c => roundRect(c, x - 8, torsoY, 16, 15, 6), fill: torsoGrad })

    // Head (long hair falls behind it, framing the face).
    const hx = x + 0.5 + t * 0.3
    const hy = y - 35 + bodyDrop
    if (!back && look.style === 'long' && look.hat !== 'hardhat') shapes.push({ path: c => roundRect(c, hx - 12, hy - 6, 24, 19, 7), fill: look.hair })
    const headGrad = ctx.createRadialGradient(hx - 3, hy - 4, 2, hx, hy, 12)
    headGrad.addColorStop(0, lighten(look.skin, 0.18))
    headGrad.addColorStop(1, darken(look.skin, 0.06))
    shapes.push({ path: c => { c.beginPath(); c.arc(hx, hy, 10.5, 0, Math.PI * 2) }, fill: headGrad })

    // Hair (behind the face from the front, covering the head from the back).
    const hairShapes = hairPaths(look, hx, hy, back, t)
    for (const path of hairShapes) shapes.push({ path, fill: look.hair })

    // Hats.
    if (look.hat === 'hardhat') {
        shapes.push({ path: c => { c.beginPath(); c.ellipse(hx, hy - 5, 12.5, 3.2, 0, 0, Math.PI * 2) }, fill: darken(look.hatColor, 0.1) })
        shapes.push({ path: c => { c.beginPath(); c.arc(hx, hy - 5.5, 10, Math.PI, 0); c.closePath() }, fill: look.hatColor })
    } else if (look.hat === 'cap') {
        shapes.push({ path: c => { c.beginPath(); c.arc(hx, hy - 4, 10.2, Math.PI, 0); c.closePath() }, fill: look.hatColor })
        if (!back) shapes.push({ path: c => { c.beginPath(); c.ellipse(hx + 7 * (turn || 1), hy - 4, 6, 2.2, 0, 0, Math.PI * 2) }, fill: darken(look.hatColor, 0.15) })
    } else if (look.hat === 'crown') {
        shapes.push({
            path: (c) => {
                c.beginPath()
                c.moveTo(hx - 7, hy - 9)
                c.lineTo(hx - 8, hy - 18)
                c.lineTo(hx - 3.5, hy - 13)
                c.lineTo(hx, hy - 20)
                c.lineTo(hx + 3.5, hy - 13)
                c.lineTo(hx + 8, hy - 18)
                c.lineTo(hx + 7, hy - 9)
                c.closePath()
            },
            fill: (() => {
                const g = ctx.createLinearGradient(hx, hy - 20, hx, hy - 9)
                g.addColorStop(0, '#fff1a8')
                g.addColorStop(0.5, '#f4c14f')
                g.addColorStop(1, '#c98a1e')
                return g
            })()
        })
    } else if (look.hat === 'party') {
        shapes.push({
            path: (c) => {
                c.beginPath()
                c.moveTo(hx - 6.5, hy - 8)
                c.lineTo(hx + 1 + t * 0.5, hy - 25)
                c.lineTo(hx + 6.5, hy - 8)
                c.quadraticCurveTo(hx, hy - 6, hx - 6.5, hy - 8)
                c.closePath()
            },
            fill: look.hatColor
        })
        shapes.push({ path: c => { c.beginPath(); c.arc(hx + 1 + t * 0.5, hy - 25, 2.8, 0, Math.PI * 2) }, fill: '#ffe066' })
    } else if (look.hat === 'beanie') {
        shapes.push({ path: c => { c.beginPath(); c.arc(hx, hy - 3, 11, Math.PI, 0); c.closePath() }, fill: look.hatColor })
        shapes.push({ path: c => roundRect(c, hx - 11.5, hy - 5.5, 23, 5.5, 2.6), fill: darken(look.hatColor, 0.18) })
        shapes.push({ path: c => { c.beginPath(); c.arc(hx, hy - 15, 3.4, 0, Math.PI * 2) }, fill: lighten(look.hatColor, 0.45) })
    } else if (look.hat === 'tophat') {
        shapes.push({ path: c => { c.beginPath(); c.ellipse(hx, hy - 8, 13.5, 3.4, 0, 0, Math.PI * 2) }, fill: lighten(look.hatColor, 0.08) })
        shapes.push({ path: c => roundRect(c, hx - 7.5, hy - 26, 15, 18.5, 2), fill: look.hatColor })
    } else if (look.hat === 'cowboy') {
        shapes.push({
            path: (c) => {
                c.beginPath()
                c.moveTo(hx - 17, hy - 10)
                c.quadraticCurveTo(hx, hy - 1, hx + 17, hy - 10)
                c.quadraticCurveTo(hx + 12, hy - 5.5, hx, hy - 5)
                c.quadraticCurveTo(hx - 12, hy - 5.5, hx - 17, hy - 10)
                c.closePath()
            },
            fill: darken(look.hatColor, 0.08)
        })
        shapes.push({
            path: (c) => {
                c.beginPath()
                c.moveTo(hx - 8, hy - 7)
                c.lineTo(hx - 7, hy - 18)
                c.quadraticCurveTo(hx - 3, hy - 20, hx, hy - 16.5)
                c.quadraticCurveTo(hx + 3, hy - 20, hx + 7, hy - 18)
                c.lineTo(hx + 8, hy - 7)
                c.closePath()
            },
            fill: look.hatColor
        })
    }
    // Headphones: the band arcs over the head, the cups sit on the ears.
    if (look.accessory === 'headphones') {
        for (const side of [-1, 1]) shapes.push({ path: c => { c.beginPath(); c.ellipse(hx + side * 10.6, hy + 1, 3.2, 4.6, 0, 0, Math.PI * 2) }, fill: '#e8594f' })
    }

    // Outline pass, then fill pass: one clean silhouette.
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.strokeStyle = INK
    ctx.lineWidth = 3.2
    for (const s of shapes) {
        s.path(ctx)
        ctx.stroke()
    }
    for (const s of shapes) {
        s.path(ctx)
        ctx.fillStyle = s.fill
        ctx.fill()
    }

    // Hands.
    if (!back) {
        ctx.fillStyle = look.skin
        ctx.beginPath()
        ctx.arc(x - 9, armY + 11 + swing, 2.6, 0, Math.PI * 2)
        ctx.arc(x + 9, armY + 11 - swing, 2.6, 0, Math.PI * 2)
        ctx.fill()
    }

    // Dealer waistcoat and bow tie.
    if (look.dealer) {
        ctx.fillStyle = '#2b2236'
        ctx.beginPath()
        if (back) {
            roundRect(ctx, x - 7, torsoY + 1, 14, 13, 5)
            ctx.fill()
        } else {
            ctx.moveTo(x - 7.5, torsoY + 2)
            ctx.lineTo(x - 1.5, torsoY + 9)
            ctx.lineTo(x - 1.5, torsoY + 15)
            ctx.lineTo(x - 7.5, torsoY + 15)
            ctx.closePath()
            ctx.moveTo(x + 7.5, torsoY + 2)
            ctx.lineTo(x + 1.5, torsoY + 9)
            ctx.lineTo(x + 1.5, torsoY + 15)
            ctx.lineTo(x + 7.5, torsoY + 15)
            ctx.closePath()
            ctx.fill()
            ctx.fillStyle = '#d6264b'
            ctx.beginPath()
            ctx.moveTo(x, torsoY + 2.5)
            ctx.lineTo(x - 4, torsoY + 0.5)
            ctx.lineTo(x - 4, torsoY + 4.5)
            ctx.closePath()
            ctx.moveTo(x, torsoY + 2.5)
            ctx.lineTo(x + 4, torsoY + 0.5)
            ctx.lineTo(x + 4, torsoY + 4.5)
            ctx.closePath()
            ctx.fill()
        }
    }

    if (look.outfit && look.outfit !== 'classic') drawOutfit(ctx, look, x, torsoY, back)
    drawHatDetail(ctx, look, hx, hy, back, t, turn)

    // Shirt highlight.
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    roundRect(ctx, x - 6, torsoY + 2, 4, 7, 2)
    ctx.fill()

    if (look.hat === 'bow' && !back) {
        ctx.fillStyle = look.hatColor
        ctx.strokeStyle = INK
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.ellipse(hx - 6, hy - 9, 3.5, 2.6, -0.5, 0, Math.PI * 2)
        ctx.ellipse(hx - 0.5, hy - 10.5, 3.5, 2.6, 0.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
    }

    // Face.
    if (!back) {
        const ex = hx + t * 1.6
        ctx.fillStyle = '#2a1b30'
        ctx.beginPath()
        ctx.ellipse(ex - 3.6, hy + 1, 1.5, 2.1, 0, 0, Math.PI * 2)
        ctx.ellipse(ex + 3.6, hy + 1, 1.5, 2.1, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(ex - 3.2, hy + 0.2, 0.6, 0, Math.PI * 2)
        ctx.arc(ex + 4, hy + 0.2, 0.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(244, 114, 140, 0.4)'
        ctx.beginPath()
        ctx.ellipse(ex - 6.4, hy + 4.4, 2.2, 1.3, 0, 0, Math.PI * 2)
        ctx.ellipse(ex + 6.4, hy + 4.4, 2.2, 1.3, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#2a1b30'
        ctx.lineWidth = 1.1
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.arc(ex, hy + 4.2, 2, 0.15 * Math.PI, 0.85 * Math.PI)
        ctx.stroke()
    }
    if (look.accessory && look.accessory !== 'none') drawAccessory(ctx, look, x, torsoY, hx, hy, back, t)
    // Head shine.
    ctx.fillStyle = 'rgba(255,255,255,0.28)'
    ctx.beginPath()
    ctx.ellipse(hx - 4, hy - 6.5, 3, 1.6, -0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
}

/** What goes on a hat after the outlined fill: bands, jewels, stitching and a shine. */
function drawHatDetail(ctx: CanvasRenderingContext2D, look: Look, hx: number, hy: number, back: boolean, t: number, turn: 0 | 1) {
    const shine = (cx: number, cy: number, rx: number, ry: number, alpha = 0.45) => {
        ctx.fillStyle = `rgba(255,255,255,${alpha})`
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx, ry, -0.5, 0, Math.PI * 2)
        ctx.fill()
    }
    switch (look.hat) {
        case 'cap':
            // Seam, button on top and a shine on the crown.
            ctx.strokeStyle = darken(look.hatColor, 0.3)
            ctx.lineWidth = 0.8
            ctx.beginPath()
            ctx.moveTo(hx + (back ? 0 : 1.5), hy - 14)
            ctx.quadraticCurveTo(hx + (back ? 0 : 3.5), hy - 9, hx + (back ? 0 : 3), hy - 4.4)
            ctx.stroke()
            ctx.fillStyle = darken(look.hatColor, 0.25)
            ctx.beginPath()
            ctx.arc(hx, hy - 14.2, 1.3, 0, Math.PI * 2)
            ctx.fill()
            shine(hx - 4.5, hy - 9.5, 2.6, 1.3)
            if (!back) {
                ctx.fillStyle = 'rgba(255,255,255,0.3)'
                ctx.beginPath()
                ctx.ellipse(hx + 7 * (turn || 1), hy - 4.8, 4.2, 0.9, 0, 0, Math.PI * 2)
                ctx.fill()
            }
            return
        case 'crown':
            // A darker band, a ruby in front, sapphires beside it, pearls on the tips.
            ctx.fillStyle = 'rgba(150, 90, 10, 0.45)'
            ctx.fillRect(hx - 7.2, hy - 12, 14.4, 2.6)
            ctx.fillStyle = '#e8304f'
            ctx.beginPath()
            ctx.arc(hx, hy - 13.2, 1.7, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = '#4aa6ff'
            ctx.beginPath()
            ctx.arc(hx - 4.4, hy - 12.2, 1.1, 0, Math.PI * 2)
            ctx.arc(hx + 4.4, hy - 12.2, 1.1, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = '#fff6d8'
            ctx.strokeStyle = INK
            ctx.lineWidth = 0.9
            for (const [dx, dy] of [[-8, -18.4], [0, -20.6], [8, -18.4]] as const) {
                ctx.beginPath()
                ctx.arc(hx + dx, hy + dy, 1.4, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
            }
            shine(hx - 5.2, hy - 14.6, 0.9, 2.2, 0.7)
            return
        case 'party':
            ctx.fillStyle = 'rgba(255,255,255,0.75)'
            for (const [dx, dy] of [[-2.5, -11], [2.5, -14], [-0.5, -18]] as const) {
                ctx.beginPath()
                ctx.arc(hx + dx + t * 0.3, hy + dy, 1.1, 0, Math.PI * 2)
                ctx.fill()
            }
            // A ruffle at the rim.
            ctx.fillStyle = '#ffe066'
            for (let k = -2; k <= 2; k++) {
                ctx.beginPath()
                ctx.arc(hx + k * 2.6, hy - 7.6, 1.15, 0, Math.PI * 2)
                ctx.fill()
            }
            return
        case 'beanie':
            // Ribbed cuff and a shine on the knit.
            ctx.strokeStyle = darken(look.hatColor, 0.36)
            ctx.lineWidth = 0.8
            ctx.beginPath()
            for (let k = -9; k <= 9; k += 3) {
                ctx.moveTo(hx + k, hy - 4.6)
                ctx.lineTo(hx + k, hy - 1)
            }
            ctx.stroke()
            shine(hx - 5, hy - 9, 2.8, 1.4)
            shine(hx - 1.2, hy - 16.2, 1, 0.8, 0.7)
            return
        case 'tophat':
            ctx.fillStyle = '#d6264b'
            ctx.fillRect(hx - 7.5, hy - 12.5, 15, 3)
            ctx.fillStyle = 'rgba(255,255,255,0.18)'
            ctx.fillRect(hx - 5.5, hy - 24.5, 2.2, 11)
            ctx.fillStyle = 'rgba(255,255,255,0.4)'
            ctx.fillRect(hx - 6.5, hy - 11.9, 4, 1)
            return
        case 'cowboy':
            ctx.fillStyle = darken(look.hatColor, 0.45)
            ctx.fillRect(hx - 7.6, hy - 10, 15.2, 2.4)
            // A gold buckle on the band and the crown's crease.
            ctx.fillStyle = '#f4c14f'
            ctx.fillRect(hx - 1.3 + t * 0.6, hy - 10.3, 2.6, 3)
            ctx.strokeStyle = darken(look.hatColor, 0.3)
            ctx.lineWidth = 0.9
            ctx.beginPath()
            ctx.moveTo(hx, hy - 16)
            ctx.lineTo(hx, hy - 11.5)
            ctx.stroke()
            shine(hx - 4.4, hy - 14.6, 1.1, 2.4, 0.35)
            return
        case 'hardhat':
            shine(hx - 4.5, hy - 10.5, 2.8, 1.4, 0.5)
    }
}

/** Patterns and suits on the torso (clipped to it). */
function drawOutfit(ctx: CanvasRenderingContext2D, look: Look, x: number, torsoY: number, back: boolean) {
    ctx.save()
    roundRect(ctx, x - 8, torsoY, 16, 15, 6)
    ctx.clip()
    switch (look.outfit) {
        case 'stripes':
            ctx.fillStyle = 'rgba(255,255,255,0.6)'
            for (let i = 0; i < 4; i++) ctx.fillRect(x - 9, torsoY + 2 + i * 3.8, 18, 1.7)
            break
        case 'hawaiian':
            for (const [dx, dy, r] of [[-4.5, 3, 1.9], [3, 5.5, 2.1], [-1.5, 10, 1.8], [5, 11.5, 1.5], [-6, 12, 1.4]] as const) {
                ctx.fillStyle = '#2fbf8f'
                ctx.beginPath()
                ctx.ellipse(x + dx + 1.4, torsoY + dy + 1, r * 0.9, r * 0.5, 0.6, 0, Math.PI * 2)
                ctx.fill()
                ctx.fillStyle = '#fff3b0'
                ctx.beginPath()
                ctx.arc(x + dx, torsoY + dy, r, 0, Math.PI * 2)
                ctx.fill()
                ctx.fillStyle = '#f27fb4'
                ctx.beginPath()
                ctx.arc(x + dx, torsoY + dy, r * 0.4, 0, Math.PI * 2)
                ctx.fill()
            }
            break
        case 'hoodie':
            ctx.fillStyle = darken(look.shirt, 0.22)
            ctx.beginPath()
            ctx.ellipse(x, torsoY + 0.5, back ? 7 : 6.5, back ? 5 : 2.6, 0, 0, Math.PI * 2)
            ctx.fill()
            if (!back) {
                roundRect(ctx, x - 5, torsoY + 8.5, 10, 5, 2)
                ctx.fill()
                ctx.strokeStyle = '#fbf6ee'
                ctx.lineWidth = 0.9
                ctx.beginPath()
                ctx.moveTo(x - 2, torsoY + 2)
                ctx.lineTo(x - 2.4, torsoY + 6.5)
                ctx.moveTo(x + 2, torsoY + 2)
                ctx.lineTo(x + 2.4, torsoY + 6.5)
                ctx.stroke()
            }
            break
        case 'tuxedo':
        case 'goldsuit': {
            if (back) {
                ctx.fillStyle = 'rgba(0,0,0,0.12)'
                ctx.fillRect(x - 0.6, torsoY, 1.2, 15)
                break
            }
            // White shirt in the V, lapels, bow tie, buttons.
            ctx.fillStyle = look.outfit === 'goldsuit' ? '#2a1b30' : '#fbf6ee'
            ctx.beginPath()
            ctx.moveTo(x - 4, torsoY)
            ctx.lineTo(x, torsoY + 9)
            ctx.lineTo(x + 4, torsoY)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = look.outfit === 'goldsuit' ? '#fff1b8' : '#4a3d5c'
            ctx.lineWidth = 0.9
            ctx.beginPath()
            ctx.moveTo(x - 4.6, torsoY)
            ctx.lineTo(x - 0.3, torsoY + 9.6)
            ctx.moveTo(x + 4.6, torsoY)
            ctx.lineTo(x + 0.3, torsoY + 9.6)
            ctx.stroke()
            ctx.fillStyle = look.outfit === 'goldsuit' ? '#d6264b' : '#120c1d'
            ctx.beginPath()
            ctx.moveTo(x, torsoY + 2)
            ctx.lineTo(x - 3.4, torsoY + 0.4)
            ctx.lineTo(x - 3.4, torsoY + 3.8)
            ctx.closePath()
            ctx.moveTo(x, torsoY + 2)
            ctx.lineTo(x + 3.4, torsoY + 0.4)
            ctx.lineTo(x + 3.4, torsoY + 3.8)
            ctx.closePath()
            ctx.fill()
            ctx.fillStyle = look.outfit === 'goldsuit' ? '#fff1b8' : '#fbf6ee'
            ctx.beginPath()
            ctx.arc(x - 0.2, torsoY + 11, 0.8, 0, Math.PI * 2)
            ctx.arc(x - 0.2, torsoY + 13.4, 0.8, 0, Math.PI * 2)
            ctx.fill()
            if (look.outfit === 'goldsuit') {
                ctx.fillStyle = 'rgba(255,255,255,0.7)'
                ctx.fillRect(x + 4.5, torsoY + 4, 1, 3)
                ctx.fillRect(x + 3.5, torsoY + 5, 3, 1)
            }
            break
        }
    }
    ctx.restore()
}

/** Shades, a monocle, a gold chain, the headphone band. */
function drawAccessory(ctx: CanvasRenderingContext2D, look: Look, x: number, torsoY: number, hx: number, hy: number, back: boolean, t: number) {
    const ex = hx + t * 1.6
    switch (look.accessory) {
        case 'shades':
            if (back) {
                ctx.strokeStyle = '#1a1424'
                ctx.lineWidth = 1.2
                ctx.beginPath()
                ctx.moveTo(hx - 10.4, hy)
                ctx.lineTo(hx + 10.4, hy)
                ctx.stroke()
                return
            }
            ctx.fillStyle = '#1a1424'
            roundRect(ctx, ex - 7, hy - 1.8, 6.2, 4.4, 1.6)
            ctx.fill()
            roundRect(ctx, ex + 0.8, hy - 1.8, 6.2, 4.4, 1.6)
            ctx.fill()
            ctx.fillRect(ex - 1.2, hy - 1.2, 2.4, 1.1)
            // Temple arm towards the ear.
            ctx.fillRect(ex - 10, hy - 1.4, 3.2, 1)
            ctx.fillStyle = 'rgba(255,255,255,0.6)'
            for (const lx of [ex - 6, ex + 1.8]) {
                ctx.beginPath()
                ctx.moveTo(lx, hy + 0.6)
                ctx.lineTo(lx + 1.6, hy - 1.2)
                ctx.lineTo(lx + 2.6, hy - 1.2)
                ctx.lineTo(lx + 1, hy + 0.6)
                ctx.closePath()
                ctx.fill()
            }
            return
        case 'monocle':
            if (back) return
            ctx.strokeStyle = '#f4c14f'
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.arc(ex + 3.6, hy + 1, 3, 0, Math.PI * 2)
            ctx.stroke()
            ctx.fillStyle = 'rgba(200, 230, 255, 0.3)'
            ctx.fill()
            ctx.lineWidth = 0.6
            ctx.beginPath()
            ctx.moveTo(ex + 6.4, hy + 2)
            ctx.quadraticCurveTo(ex + 8, hy + 7, ex + 5, hy + 10)
            ctx.stroke()
            return
        case 'goldchain': {
            if (back) return
            ctx.strokeStyle = '#8a5a12'
            ctx.lineWidth = 2.6
            ctx.beginPath()
            ctx.moveTo(x - 5.4, torsoY + 0.6)
            ctx.quadraticCurveTo(x, torsoY + 9.4, x + 5.4, torsoY + 0.6)
            ctx.stroke()
            ctx.strokeStyle = '#f4c14f'
            ctx.lineWidth = 1.6
            ctx.stroke()
            // Links: little bright beads along the chain.
            ctx.fillStyle = '#fff1a8'
            for (const k of [0.18, 0.36, 0.64, 0.82]) {
                const u = 1 - k
                ctx.beginPath()
                ctx.arc(u * u * (x - 5.4) + 2 * u * k * x + k * k * (x + 5.4), u * u * (torsoY + 0.6) + 2 * u * k * (torsoY + 9.4) + k * k * (torsoY + 0.6), 0.5, 0, Math.PI * 2)
                ctx.fill()
            }
            // A big gold medallion with a star.
            ctx.fillStyle = '#ffd23f'
            ctx.strokeStyle = '#8a5a12'
            ctx.lineWidth = 0.9
            ctx.beginPath()
            ctx.arc(x, torsoY + 7.4, 2.8, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = '#fff6c2'
            ctx.beginPath()
            for (let k = 0; k < 10; k++) {
                const rr = k % 2 ? 0.7 : 1.6
                const a = -Math.PI / 2 + (k * Math.PI) / 5
                ctx.lineTo(x + Math.cos(a) * rr, torsoY + 7.4 + Math.sin(a) * rr)
            }
            ctx.closePath()
            ctx.fill()
            return
        }
        case 'headphones':
            ctx.strokeStyle = '#2a1b30'
            ctx.lineWidth = 2.6
            ctx.beginPath()
            ctx.arc(hx, hy - 0.5, 11.6, Math.PI * 1.08, Math.PI * 1.92)
            ctx.stroke()
            ctx.strokeStyle = '#e8594f'
            ctx.lineWidth = 1.2
            ctx.stroke()
            // The cups: a dark speaker ring and a shine on each.
            for (const side of [-1, 1]) {
                ctx.fillStyle = darken('#e8594f', 0.35)
                ctx.beginPath()
                ctx.ellipse(hx + side * 10.6, hy + 1, 1.6, 2.6, 0, 0, Math.PI * 2)
                ctx.fill()
                ctx.fillStyle = 'rgba(255,255,255,0.55)'
                ctx.beginPath()
                ctx.ellipse(hx + side * 10.6 - 1.2, hy - 1.6, 0.9, 1.3, -0.4, 0, Math.PI * 2)
                ctx.fill()
            }
    }
}

function hairPaths(look: Look, hx: number, hy: number, back: boolean, t: number): ((c: CanvasRenderingContext2D) => void)[] {
    if (look.style === 'bald' || look.hat === 'hardhat') {
        return back && look.style !== 'bald' ? [c => { c.beginPath(); c.arc(hx, hy + 1, 10.4, Math.PI * 0.95, Math.PI * 0.05, true); c.closePath() }] : []
    }
    if (back) {
        const out: ((c: CanvasRenderingContext2D) => void)[] = [c => { c.beginPath(); c.arc(hx, hy - 0.5, 11.2, 0, Math.PI * 2) }]
        if (look.style === 'long') out.push(c => roundRect(c, hx - 11, hy - 2, 22, 16, 6))
        if (look.style === 'bun') out.push(c => { c.beginPath(); c.arc(hx, hy - 12, 4.6, 0, Math.PI * 2) })
        return out
    }
    const s = t * 1.5
    // Long hair is drawn behind the head (drawFigure); here only the fringe.
    const out: ((c: CanvasRenderingContext2D) => void)[] = []
    if (look.style === 'bun') out.push(c => { c.beginPath(); c.arc(hx - s, hy - 12.5, 4.6, 0, Math.PI * 2) })
    if (look.style === 'spiky') {
        out.push((c) => {
            c.beginPath()
            c.moveTo(hx - 11, hy - 1)
            c.lineTo(hx - 12, hy - 10)
            c.lineTo(hx - 7, hy - 9)
            c.lineTo(hx - 6, hy - 16)
            c.lineTo(hx - 1, hy - 11)
            c.lineTo(hx + 3, hy - 17)
            c.lineTo(hx + 5, hy - 10)
            c.lineTo(hx + 11, hy - 13)
            c.lineTo(hx + 10.5, hy - 4)
            c.closePath()
        })
    }
    // The fringe cap, swept toward the facing side.
    out.push((c) => {
        c.beginPath()
        c.moveTo(hx - 10.8, hy + 1)
        c.arc(hx, hy - 0.5, 11, Math.PI * 1.02, Math.PI * 1.98)
        c.quadraticCurveTo(hx + 7 + s, hy - 1, hx + 2 + s, hy - 4)
        c.quadraticCurveTo(hx - 2 + s, hy - 0.5, hx - 6 + s, hy - 3.5)
        c.quadraticCurveTo(hx - 8, hy - 1, hx - 10.8, hy + 1)
        c.closePath()
    })
    return out
}

/** A small seated figure's head-and-shoulders seen from behind (spectator rows, sofas). */
export function drawSeatedBack(ctx: CanvasRenderingContext2D, x: number, y: number, look: Look) {
    drawFigure(ctx, x, y, look, 'sit', 0, 1)
}
