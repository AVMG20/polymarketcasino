import { AUTO, DEFAULT_AVATAR, cosmeticsIn, findCosmetic, type AvatarLook, type LookSlot } from '#shared/cosmetics'
import { INK, darken, hashString, lighten, roundRect } from '../iso'
import { HAIRS, PANTS, SHIRTS, SKINS } from './palette'

/**
 * Chunky chibi figures: a big round head, a small body, stubby legs. Drawn
 * in screen space (not iso) with their feet at (x, y), facing right in a
 * three-quarter view; sprites flip for the other side.
 */

export type HairStyle = 'short' | 'long' | 'bun' | 'spiky' | 'ponytail' | 'afro' | 'mohawk' | 'bald'
export type Hat = 'none' | 'hardhat' | 'cap' | 'crown' | 'bow' | 'party' | 'beanie' | 'tophat' | 'cowboy' | 'fedora' | 'laurel'
/** Patterns and suits over the shirt (avatar cosmetics). */
export type Outfit = 'classic' | 'stripes' | 'hoodie' | 'hawaiian' | 'tuxedo' | 'velvet' | 'goldsuit' | 'robe' | 'diamond'
export type Accessory = 'none' | 'shades' | 'bowtie' | 'headphones' | 'monocle' | 'goldchain' | 'icechain'

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
    /** A guest dressed by visitor tier (art/visitors.ts): its outfit looks are a fixed set, kept out of the players' key space. */
    npc?: boolean
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
    if (!look.outfit) return base
    return `${look.npc ? 'g' : 'p'}|${look.outfit}|${look.accessory ?? 'none'}|${base}`
}

/** Every look key of a player's avatar starts with this (see lookKey). */
export const PLAYER_LOOK_PREFIX = 'p|'

const HAT_IDS: readonly Hat[] = ['none', 'cap', 'party', 'beanie', 'tophat', 'cowboy', 'fedora', 'crown', 'laurel']
const OUTFIT_IDS: readonly Outfit[] = ['classic', 'stripes', 'hoodie', 'hawaiian', 'tuxedo', 'velvet', 'goldsuit', 'robe', 'diamond']
const ACCESSORY_IDS: readonly Accessory[] = ['none', 'shades', 'bowtie', 'headphones', 'monocle', 'goldchain', 'icechain']
const HAIR_IDS: readonly HairStyle[] = ['short', 'long', 'bun', 'spiky', 'ponytail', 'afro', 'mohawk', 'bald']
/** Suits replace the shirt colour; patterns keep the player's own colour. */
const SUIT_COLOR: Partial<Record<Outfit, string>> = {
    hoodie: '#6f86e8',
    hawaiian: '#ef7a3a',
    tuxedo: '#2b2236',
    velvet: '#7a1840',
    goldsuit: '#e9b73c',
    robe: '#a3182f',
    diamond: '#9fdcf5'
}

/** The catalog colour of a look item (`haircolor:blond`), or null for `auto` and unknown ids. */
function lookColor(slot: LookSlot, id: string | undefined): string | null {
    return id && id !== AUTO ? findCosmetic(`${slot}:${id}`)?.color ?? null : null
}

/**
 * A player's figure: the look their name gives (skin, hair, colours) with
 * their own look choices and avatar cosmetics on top. Unknown items fall
 * back to the defaults, `auto` to the name's.
 */
export function avatarLook(name: string, avatar?: AvatarLook | null): Look {
    const base = lookFromName(name)
    const a = avatar ?? DEFAULT_AVATAR
    const hat = HAT_IDS.includes(a.hat as Hat) ? a.hat as Hat : 'none'
    const outfit = OUTFIT_IDS.includes(a.outfit as Outfit) ? a.outfit as Outfit : 'classic'
    const accessory = ACCESSORY_IDS.includes(a.accessory as Accessory) ? a.accessory as Accessory : 'none'
    return {
        ...base,
        style: HAIR_IDS.includes(a.hair as HairStyle) ? a.hair as HairStyle : base.style,
        hair: lookColor('haircolor', a.haircolor) ?? base.hair,
        skin: lookColor('skintone', a.skintone) ?? base.skin,
        hat,
        hatColor: findCosmetic(`hat:${hat}`)?.color ?? base.hatColor,
        shirt: SUIT_COLOR[outfit] ?? base.shirt,
        outfit,
        accessory
    }
}

/** The look items a player's name gives them: what `auto` shows, as catalog ids. */
export function nameLookIds(name: string): Record<LookSlot, string> {
    const base = lookFromName(name)
    const byColor = (slot: LookSlot, color: string) => cosmeticsIn(slot).find(c => c.color.toLowerCase() === color.toLowerCase())?.id ?? AUTO
    return { hair: base.style, haircolor: byColor('haircolor', base.hair), skintone: byColor('skintone', base.skin) }
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

type Path = (ctx: CanvasRenderingContext2D) => void

interface Shape {
    path: Path
    fill: string | CanvasGradient
}

/** Hats that cover the crown: hair under them shows only below the brim (tucked). */
const COVERING: ReadonlySet<Hat> = new Set<Hat>(['cap', 'beanie', 'cowboy', 'tophat', 'fedora', 'hardhat'])

/** How far a hat that sits on the hair (party hat, crown, bow) rides up on tall hair. */
function hatLift(look: Look): number {
    if (look.hat !== 'party' && look.hat !== 'crown' && look.hat !== 'bow') return 0
    if (look.style === 'afro') return look.hat === 'party' ? 4 : 6
    if (look.style === 'spiky' && look.hat !== 'bow') return 3
    return look.style === 'mohawk' ? 4 : 0
}

// How high each hat and hair style reaches above the head's centre (figure px, outline included).
const HAT_TOP: Record<Hat, number> = { none: 0, hardhat: 17, cap: 16, beanie: 20, crown: 22.5, bow: 14, party: 29.5, tophat: 27.6, cowboy: 21.6, fedora: 19, laurel: 16 }
const HAIR_TOP: Record<HairStyle, number> = { short: 13.1, long: 13.1, ponytail: 13.1, bun: 18.7, spiky: 18.6, afro: 19.6, mohawk: 22.6, bald: 12.1 }

/**
 * The top of a standing figure's head, hat or hair (figure px, feet at
 * FIGURE_FOOT): where a portrait crop starts.
 */
export function figureTop(look: Look): number {
    const hy = FIGURE_FOOT.y - 35
    const hair = COVERING.has(look.hat) ? 0 : HAIR_TOP[look.style]
    return hy - Math.max(HAT_TOP[look.hat] + hatLift(look), hair)
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
    const torsoY = y - 25 + bodyDrop
    const robe = look.outfit === 'robe'
    const cape = robeCape(x, y, torsoY, sit)

    // A royal robe's cape hangs behind the body (from the back it covers it, see below).
    if (robe && !back) shapes.push({ path: cape, fill: darken(look.shirt, 0.18) })

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
    const torsoGrad = ctx.createLinearGradient(x - 8, torsoY, x + 8, torsoY + 15)
    torsoGrad.addColorStop(0, lighten(look.shirt, 0.18))
    torsoGrad.addColorStop(1, darken(look.shirt, 0.08))
    shapes.push({ path: c => roundRect(c, x - 8, torsoY, 16, 15, 6), fill: torsoGrad })
    if (robe && back) {
        const g = ctx.createLinearGradient(x - 12, torsoY, x + 12, y)
        g.addColorStop(0, lighten(look.shirt, 0.12))
        g.addColorStop(1, darken(look.shirt, 0.2))
        shapes.push({ path: cape, fill: g })
    }

    // Head; hair that frames it (long, ponytail, afro) falls behind it.
    const hx = x + 0.5 + t * 0.3
    const hy = y - 35 + bodyDrop
    const hair = hairShapes(look, hx, hy, back, t)
    for (const path of hair.behind) shapes.push({ path, fill: look.hair })
    const headGrad = ctx.createRadialGradient(hx - 3, hy - 4, 2, hx, hy, 12)
    headGrad.addColorStop(0, lighten(look.skin, 0.18))
    headGrad.addColorStop(1, darken(look.skin, 0.06))
    shapes.push({ path: c => { c.beginPath(); c.arc(hx, hy, 10.5, 0, Math.PI * 2) }, fill: headGrad })

    // Hair (behind the face from the front, covering the head from the back).
    for (const path of hair.over) shapes.push({ path, fill: look.hair })

    // Hats: a hat that sits on the hair rides up on an afro or a mohawk.
    const ty = hy - hatLift(look)
    hatShapes(ctx, shapes, look, hx, hy, ty, back, t, turn)
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

    drawHairDetail(ctx, look, hx, hy, back, t)
    if (robe) drawRobeTrim(ctx, x, y, torsoY, back, sit)

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
    drawHatDetail(ctx, look, hx, ty, back, t, turn)

    // Shirt highlight.
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    roundRect(ctx, x - 6, torsoY + 2, 4, 7, 2)
    ctx.fill()

    if (look.hat === 'bow' && !back) {
        ctx.fillStyle = look.hatColor
        ctx.strokeStyle = INK
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.ellipse(hx - 6, ty - 9, 3.5, 2.6, -0.5, 0, Math.PI * 2)
        ctx.ellipse(hx - 0.5, ty - 10.5, 3.5, 2.6, 0.5, 0, Math.PI * 2)
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
    // Head shine (on a bald head or under the hat it reads as skin; under hair it's a hair gloss).
    ctx.fillStyle = 'rgba(255,255,255,0.28)'
    ctx.beginPath()
    ctx.ellipse(hx - 4, hy - 6.5, 3, 1.6, -0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
}

/** A four-point sparkle (diamonds, gold). */
function sparkle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color = '#ffffff') {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(cx, cy - r)
    ctx.quadraticCurveTo(cx, cy, cx + r, cy)
    ctx.quadraticCurveTo(cx, cy, cx, cy + r)
    ctx.quadraticCurveTo(cx, cy, cx - r, cy)
    ctx.quadraticCurveTo(cx, cy, cx, cy - r)
    ctx.fill()
}

/** The royal robe's long cape: from the shoulders to the ankles. */
function robeCape(x: number, y: number, torsoY: number, sit: boolean): Path {
    const bottom = sit ? torsoY + 17 : y - 1.5
    return (c) => {
        c.beginPath()
        c.moveTo(x - 8.5, torsoY + 1)
        c.quadraticCurveTo(x - 12.5, torsoY + 8, x - 13.5, bottom)
        c.quadraticCurveTo(x, bottom + 2.5, x + 13.5, bottom)
        c.quadraticCurveTo(x + 12.5, torsoY + 8, x + 8.5, torsoY + 1)
        c.closePath()
    }
}

/** Ermine (white fur with black tails) along the cape's hem, gold piping on its edges. */
function drawRobeTrim(ctx: CanvasRenderingContext2D, x: number, y: number, torsoY: number, back: boolean, sit: boolean) {
    const bottom = sit ? torsoY + 17 : y - 1.5
    ctx.save()
    robeCape(x, y, torsoY, sit)(ctx)
    ctx.clip()
    // Velvet sheen down the cape.
    const sheen = ctx.createLinearGradient(x - 13, 0, x + 13, 0)
    sheen.addColorStop(0, 'rgba(255,140,170,0)')
    sheen.addColorStop(0.3, 'rgba(255,140,170,0.22)')
    sheen.addColorStop(0.45, 'rgba(255,140,170,0)')
    ctx.fillStyle = sheen
    ctx.fillRect(x - 14, torsoY, 28, bottom - torsoY + 3)
    ctx.fillStyle = '#fbf6ee'
    ctx.beginPath()
    ctx.moveTo(x - 15, bottom - 3)
    ctx.quadraticCurveTo(x, bottom - 0.5, x + 15, bottom - 3)
    ctx.lineTo(x + 15, bottom + 4)
    ctx.lineTo(x - 15, bottom + 4)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#1a1424'
    for (let k = -12; k <= 12; k += 4) {
        ctx.beginPath()
        ctx.ellipse(x + k, bottom - 0.6 + Math.abs(k) * -0.04, 0.6, 1.1, 0, 0, Math.PI * 2)
        ctx.fill()
    }
    ctx.restore()
    if (back) return
    // Gold piping on the cape's sides.
    ctx.strokeStyle = '#f4c14f'
    ctx.lineWidth = 0.9
    ctx.beginPath()
    ctx.moveTo(x - 9.2, torsoY + 3)
    ctx.quadraticCurveTo(x - 12, torsoY + 9, x - 12.6, bottom - 3)
    ctx.moveTo(x + 9.2, torsoY + 3)
    ctx.quadraticCurveTo(x + 12, torsoY + 9, x + 12.6, bottom - 3)
    ctx.stroke()
}

/** The hat's outlined shapes (the outline and fill passes draw them). `ty` is the hat's head centre (lifted on tall hair). */
function hatShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], look: Look, hx: number, hy: number, ty: number, back: boolean, t: number, turn: 0 | 1) {
    const gold = (top: number, bottom: number) => {
        const g = ctx.createLinearGradient(hx, top, hx, bottom)
        g.addColorStop(0, '#fff1a8')
        g.addColorStop(0.5, '#f4c14f')
        g.addColorStop(1, '#c98a1e')
        return g
    }
    switch (look.hat) {
        case 'hardhat':
            shapes.push({ path: c => { c.beginPath(); c.ellipse(hx, hy - 5, 12.5, 3.2, 0, 0, Math.PI * 2) }, fill: darken(look.hatColor, 0.1) })
            shapes.push({ path: c => { c.beginPath(); c.arc(hx, hy - 5.5, 10, Math.PI, 0); c.closePath() }, fill: look.hatColor })
            return
        case 'cap':
            shapes.push({ path: c => { c.beginPath(); c.arc(hx, hy - 4, 10.2, Math.PI, 0); c.closePath() }, fill: look.hatColor })
            if (!back) shapes.push({ path: c => { c.beginPath(); c.ellipse(hx + 7 * (turn || 1), hy - 4, 6, 2.2, 0, 0, Math.PI * 2) }, fill: darken(look.hatColor, 0.15) })
            return
        case 'crown':
            shapes.push({
                path: (c) => {
                    c.beginPath()
                    c.moveTo(hx - 7, ty - 9)
                    c.lineTo(hx - 8, ty - 18)
                    c.lineTo(hx - 3.5, ty - 13)
                    c.lineTo(hx, ty - 20)
                    c.lineTo(hx + 3.5, ty - 13)
                    c.lineTo(hx + 8, ty - 18)
                    c.lineTo(hx + 7, ty - 9)
                    c.closePath()
                },
                fill: gold(ty - 20, ty - 9)
            })
            return
        case 'party':
            shapes.push({
                path: (c) => {
                    c.beginPath()
                    c.moveTo(hx - 6.5, ty - 8)
                    c.lineTo(hx + 1 + t * 0.5, ty - 25)
                    c.lineTo(hx + 6.5, ty - 8)
                    c.quadraticCurveTo(hx, ty - 6, hx - 6.5, ty - 8)
                    c.closePath()
                },
                fill: look.hatColor
            })
            shapes.push({ path: c => { c.beginPath(); c.arc(hx + 1 + t * 0.5, ty - 25, 2.8, 0, Math.PI * 2) }, fill: '#ffe066' })
            return
        case 'beanie':
            shapes.push({ path: c => { c.beginPath(); c.arc(hx, hy - 3, 11, Math.PI, 0); c.closePath() }, fill: look.hatColor })
            shapes.push({ path: c => roundRect(c, hx - 11.5, hy - 5.5, 23, 5.5, 2.6), fill: darken(look.hatColor, 0.18) })
            shapes.push({ path: c => { c.beginPath(); c.arc(hx, hy - 15, 3.4, 0, Math.PI * 2) }, fill: lighten(look.hatColor, 0.45) })
            return
        case 'tophat':
            shapes.push({ path: c => { c.beginPath(); c.ellipse(hx, hy - 8, 13.5, 3.4, 0, 0, Math.PI * 2) }, fill: lighten(look.hatColor, 0.08) })
            shapes.push({ path: c => roundRect(c, hx - 7.5, hy - 26, 15, 18.5, 2), fill: look.hatColor })
            return
        case 'cowboy':
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
            return
        case 'fedora': {
            // A snap brim (down in front, up at the back) and a pinched crown.
            const dip = back ? 0 : 1.6
            shapes.push({
                path: (c) => {
                    c.beginPath()
                    c.moveTo(hx - 14, hy - 9.5)
                    c.quadraticCurveTo(hx - 12, hy - 4.5 + dip * 0.4, hx + 1, hy - 4 + dip)
                    c.quadraticCurveTo(hx + 12.5, hy - 4.5 + dip, hx + 14.5, hy - 8)
                    c.quadraticCurveTo(hx + 1, hy - 12.5, hx - 14, hy - 9.5)
                    c.closePath()
                },
                fill: darken(look.hatColor, 0.12)
            })
            shapes.push({
                path: (c) => {
                    c.beginPath()
                    c.moveTo(hx - 9, hy - 7.5)
                    c.lineTo(hx - 8.2, hy - 15)
                    c.quadraticCurveTo(hx - 4.5, hy - 19, hx + 0.5, hy - 15.4)
                    c.quadraticCurveTo(hx + 4.5, hy - 18.6, hx + 8, hy - 15.4)
                    c.lineTo(hx + 9, hy - 7.5)
                    c.quadraticCurveTo(hx, hy - 6, hx - 9, hy - 7.5)
                    c.closePath()
                },
                fill: look.hatColor
            })
            return
        }
        case 'laurel':
            for (const leaf of laurelLeaves(look, hx, hy, t)) {
                shapes.push({ path: c => { c.beginPath(); c.ellipse(leaf.x, leaf.y, 2.9, 1.35, leaf.rot, 0, Math.PI * 2) }, fill: gold(leaf.y - 2, leaf.y + 2) })
            }
    }
}

interface Leaf {
    x: number
    y: number
    rot: number
}

/** The golden laurel: two leafy branches round the head at the hairline, their tips meeting in front. */
function laurelLeaves(look: Look, hx: number, hy: number, t: number): Leaf[] {
    const afro = look.style === 'afro'
    const cx = hx + t * 0.4
    const cy = laurelY(look, hy)
    const rx = afro ? 14 : 11.4
    const ry = 3.4
    const out: Leaf[] = []
    for (const side of [-1, 1]) {
        // A herringbone of leaves along the band: an upper row leaning out, a lower row lying flat.
        for (let k = 0; k < 8; k++) {
            const a = Math.PI / 2 - side * Math.PI * (0.06 + k * 0.075)
            const upper = k % 2 === 0
            out.push({
                x: cx + Math.cos(a) * rx,
                y: cy + Math.sin(a) * ry + (upper ? -1.3 : 0.6),
                rot: side * (upper ? 0.62 : 0.12) + Math.cos(a) * 0.25 * (1 - Math.sin(a))
            })
        }
    }
    // The back leaves first, so the front ones overlap them.
    return out.sort((a, b) => a.y - b.y)
}

/** The laurel ring's centre height (its front sits at the hairline, higher on an afro). */
function laurelY(look: Look, hy: number): number {
    return hy - (look.style === 'afro' ? 12 : 9.2)
}

/** What goes on a hat after the outlined fill: bands, jewels, stitching and a shine. `hy` is the hat's head centre. */
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
        case 'fedora': {
            // A gold band with a little teal feather tucked in at the back, the crown's crease and a shine.
            ctx.save()
            ctx.beginPath()
            ctx.moveTo(hx - 9, hy - 7.5)
            ctx.lineTo(hx - 8.2, hy - 15)
            ctx.lineTo(hx + 8, hy - 15)
            ctx.lineTo(hx + 9, hy - 7.5)
            ctx.quadraticCurveTo(hx, hy - 6, hx - 9, hy - 7.5)
            ctx.clip()
            ctx.fillStyle = '#e0a640'
            ctx.fillRect(hx - 10, hy - 10.6, 20, 3)
            ctx.fillStyle = 'rgba(255,255,255,0.35)'
            ctx.fillRect(hx - 10, hy - 10.6, 20, 0.8)
            ctx.restore()
            if (!back) {
                ctx.fillStyle = '#3fc4b2'
                ctx.strokeStyle = INK
                ctx.lineWidth = 0.8
                ctx.beginPath()
                ctx.ellipse(hx - 7.4, hy - 12.4, 1.3, 3.6, -0.5, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
                ctx.strokeStyle = darken('#3fc4b2', 0.4)
                ctx.lineWidth = 0.5
                ctx.beginPath()
                ctx.moveTo(hx - 6, hy - 9.6)
                ctx.lineTo(hx - 8.6, hy - 15)
                ctx.stroke()
            }
            ctx.strokeStyle = darken(look.hatColor, 0.4)
            ctx.lineWidth = 0.9
            ctx.beginPath()
            ctx.moveTo(hx + 0.5, hy - 15.2)
            ctx.quadraticCurveTo(hx + 1, hy - 13, hx + 0.6, hy - 11)
            ctx.stroke()
            shine(hx - 4.6, hy - 14.4, 1, 2.2, 0.3)
            shine(hx + 8, hy - 9.2, 2.8, 0.6, 0.18)
            return
        }
        case 'laurel': {
            // Veins on the leaves, a ruby where the branches meet and a sparkle.
            const leaves = laurelLeaves(look, hx, hy, t)
            ctx.strokeStyle = 'rgba(140, 80, 10, 0.6)'
            ctx.lineWidth = 0.5
            ctx.beginPath()
            for (const leaf of leaves) {
                ctx.moveTo(leaf.x - Math.cos(leaf.rot) * 2.2, leaf.y - Math.sin(leaf.rot) * 2.2)
                ctx.lineTo(leaf.x + Math.cos(leaf.rot) * 2.2, leaf.y + Math.sin(leaf.rot) * 2.2)
            }
            ctx.stroke()
            ctx.fillStyle = 'rgba(255,255,255,0.55)'
            for (const leaf of leaves) {
                ctx.beginPath()
                ctx.ellipse(leaf.x - 0.6, leaf.y - 0.5, 1.2, 0.45, leaf.rot, 0, Math.PI * 2)
                ctx.fill()
            }
            if (!back) {
                const gx = hx + t * 0.4
                const gy = laurelY(look, hy) + 3.6
                ctx.fillStyle = '#e8304f'
                ctx.strokeStyle = INK
                ctx.lineWidth = 0.9
                ctx.beginPath()
                ctx.moveTo(gx, gy - 2.2)
                ctx.lineTo(gx + 1.8, gy)
                ctx.lineTo(gx, gy + 2.2)
                ctx.lineTo(gx - 1.8, gy)
                ctx.closePath()
                ctx.fill()
                ctx.stroke()
                ctx.fillStyle = 'rgba(255,255,255,0.75)'
                ctx.fillRect(gx - 0.8, gy - 1, 0.9, 0.9)
                const top = leaves[0]!
                sparkle(ctx, top.x + 2, top.y - 2.5, 2.4)
            }
            return
        }
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
        case 'velvet': {
            // Deep velvet with a soft sheen, satin lapels over a black shirt, a gold pocket square.
            const sheen = ctx.createLinearGradient(x - 8, torsoY, x + 8, torsoY + 15)
            sheen.addColorStop(0.15, 'rgba(255,150,200,0)')
            sheen.addColorStop(0.38, 'rgba(255,150,200,0.38)')
            sheen.addColorStop(0.55, 'rgba(255,150,200,0)')
            sheen.addColorStop(1, 'rgba(40,0,20,0.25)')
            ctx.fillStyle = sheen
            ctx.fillRect(x - 9, torsoY, 18, 16)
            if (back) {
                ctx.fillStyle = 'rgba(0,0,0,0.18)'
                ctx.fillRect(x - 0.6, torsoY + 5, 1.2, 10)
                break
            }
            ctx.fillStyle = '#1a1424'
            ctx.beginPath()
            ctx.moveTo(x - 4.2, torsoY)
            ctx.lineTo(x, torsoY + 10)
            ctx.lineTo(x + 4.2, torsoY)
            ctx.closePath()
            ctx.fill()
            // Shawl lapels in a darker satin, edged with a pink shine.
            ctx.fillStyle = '#4a0c26'
            for (const side of [-1, 1]) {
                ctx.beginPath()
                ctx.moveTo(x + side * 4.2, torsoY)
                ctx.lineTo(x + side * 0.2, torsoY + 10)
                ctx.lineTo(x + side * 2.2, torsoY + 10)
                ctx.quadraticCurveTo(x + side * 5.6, torsoY + 4, x + side * 6.8, torsoY)
                ctx.closePath()
                ctx.fill()
            }
            ctx.strokeStyle = 'rgba(255,170,210,0.75)'
            ctx.lineWidth = 0.7
            ctx.beginPath()
            ctx.moveTo(x - 6.8, torsoY)
            ctx.quadraticCurveTo(x - 5.6, torsoY + 4, x - 2.2, torsoY + 10)
            ctx.stroke()
            ctx.fillStyle = '#f4c14f'
            ctx.beginPath()
            ctx.arc(x + 1.2, torsoY + 11.6, 0.85, 0, Math.PI * 2)
            ctx.arc(x + 1.2, torsoY + 13.8, 0.85, 0, Math.PI * 2)
            ctx.fill()
            ctx.beginPath()
            ctx.moveTo(x + 3.4, torsoY + 5.6)
            ctx.lineTo(x + 4.6, torsoY + 3.6)
            ctx.lineTo(x + 5.6, torsoY + 5)
            ctx.lineTo(x + 6.6, torsoY + 3.8)
            ctx.lineTo(x + 6.8, torsoY + 5.6)
            ctx.closePath()
            ctx.fill()
            break
        }
        case 'robe': {
            // An ermine collar and front, a gold clasp and chain.
            const ermine = (px: number, py: number, w: number, h: number) => {
                ctx.fillStyle = '#fbf6ee'
                roundRect(ctx, px, py, w, h, 1.4)
                ctx.fill()
                ctx.fillStyle = '#1a1424'
                for (let sx = px + 1.6; sx < px + w - 0.5; sx += 3.2) {
                    for (let sy = py + 1.8; sy < py + h - 0.5; sy += 4) {
                        ctx.beginPath()
                        ctx.ellipse(sx + ((sy - py) % 8 > 3 ? 1.6 : 0), sy, 0.5, 0.95, 0, 0, Math.PI * 2)
                        ctx.fill()
                    }
                }
            }
            if (back) {
                ermine(x - 9, torsoY - 0.5, 18, 4.2)
                break
            }
            ermine(x - 2.2, torsoY + 2, 4.4, 14)
            ermine(x - 9, torsoY - 0.5, 18, 4.2)
            ctx.strokeStyle = '#f4c14f'
            ctx.lineWidth = 0.9
            ctx.beginPath()
            ctx.moveTo(x - 5.5, torsoY + 4.6)
            ctx.quadraticCurveTo(x, torsoY + 7.4, x + 5.5, torsoY + 4.6)
            ctx.stroke()
            ctx.fillStyle = '#ffd23f'
            ctx.strokeStyle = '#8a5a12'
            ctx.lineWidth = 0.7
            for (const side of [-1, 1]) {
                ctx.beginPath()
                ctx.arc(x + side * 5.5, torsoY + 4.6, 1.3, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
            }
            break
        }
        case 'diamond': {
            // Ice facets: a lattice of lit and shaded triangles, a navy shirt and a diamond brooch.
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 5; col++) {
                    const px = x - 10 + col * 4.4 + (row % 2) * 2.2
                    const py = torsoY + row * 4
                    ctx.fillStyle = (row + col) % 3 === 0 ? 'rgba(255,255,255,0.55)' : (row + col) % 3 === 1 ? 'rgba(30,110,190,0.22)' : 'rgba(255,255,255,0.18)'
                    ctx.beginPath()
                    ctx.moveTo(px, py)
                    ctx.lineTo(px + 4.4, py)
                    ctx.lineTo(px + 2.2, py + 4)
                    ctx.closePath()
                    ctx.fill()
                }
            }
            ctx.strokeStyle = 'rgba(255,255,255,0.7)'
            ctx.lineWidth = 0.45
            ctx.beginPath()
            for (let row = 0; row <= 4; row++) {
                ctx.moveTo(x - 10, torsoY + row * 4)
                ctx.lineTo(x + 10, torsoY + row * 4)
            }
            for (let k = -3; k <= 3; k++) {
                ctx.moveTo(x + k * 4.4 - 8, torsoY + 16)
                ctx.lineTo(x + k * 4.4 + 0.8, torsoY)
                ctx.moveTo(x + k * 4.4 + 8, torsoY + 16)
                ctx.lineTo(x + k * 4.4 - 0.8, torsoY)
            }
            ctx.stroke()
            if (back) {
                sparkle(ctx, x - 3, torsoY + 6, 2.2)
                break
            }
            ctx.fillStyle = '#1d2a5c'
            ctx.beginPath()
            ctx.moveTo(x - 4, torsoY)
            ctx.lineTo(x, torsoY + 9)
            ctx.lineTo(x + 4, torsoY)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 0.9
            ctx.beginPath()
            ctx.moveTo(x - 4.6, torsoY)
            ctx.lineTo(x - 0.3, torsoY + 9.6)
            ctx.moveTo(x + 4.6, torsoY)
            ctx.lineTo(x + 0.3, torsoY + 9.6)
            ctx.stroke()
            // The brooch: a cut diamond on the lapel.
            ctx.fillStyle = '#e9fbff'
            ctx.strokeStyle = '#2b6f9c'
            ctx.lineWidth = 0.6
            ctx.beginPath()
            ctx.moveTo(x + 3.6, torsoY + 4.4)
            ctx.lineTo(x + 6.6, torsoY + 4.4)
            ctx.lineTo(x + 7.4, torsoY + 5.4)
            ctx.lineTo(x + 5.1, torsoY + 8.2)
            ctx.lineTo(x + 2.8, torsoY + 5.4)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            sparkle(ctx, x - 4.6, torsoY + 10.6, 2)
            sparkle(ctx, x + 6.2, torsoY + 12.4, 1.4)
            break
        }
    }
    ctx.restore()
    // The diamond suit catches the light past its own edge.
    if (look.outfit === 'diamond') {
        sparkle(ctx, x + 9.2, torsoY - 0.5, 2.8)
        sparkle(ctx, x - 10.5, torsoY + 8, 1.8, '#dff8ff')
    }
}

/** Shades, a bow tie, a monocle, a gold or ice chain, the headphone band. */
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
        case 'bowtie': {
            if (back) return
            const by = torsoY + 1.6
            ctx.fillStyle = '#d6264b'
            ctx.strokeStyle = INK
            ctx.lineWidth = 1
            ctx.lineJoin = 'round'
            ctx.beginPath()
            ctx.moveTo(x, by)
            ctx.lineTo(x - 4.8, by - 2.6)
            ctx.lineTo(x - 4.8, by + 2.6)
            ctx.closePath()
            ctx.moveTo(x, by)
            ctx.lineTo(x + 4.8, by - 2.6)
            ctx.lineTo(x + 4.8, by + 2.6)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = '#a3163a'
            ctx.beginPath()
            ctx.arc(x, by, 1.5, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = 'rgba(255,255,255,0.55)'
            ctx.fillRect(x - 4, by - 1.4, 1.6, 0.8)
            ctx.fillRect(x + 2.4, by - 1.4, 1.6, 0.8)
            return
        }
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
        case 'icechain': {
            if (back) return
            // A heavy iced-out link chain and a big cut diamond.
            const at = (k: number) => {
                const u = 1 - k
                return [u * u * (x - 6) + 2 * u * k * x + k * k * (x + 6), u * u * (torsoY + 0.4) + 2 * u * k * (torsoY + 10.4) + k * k * (torsoY + 0.4)] as const
            }
            ctx.strokeStyle = '#1d4a6b'
            ctx.lineWidth = 3.2
            ctx.beginPath()
            ctx.moveTo(x - 6, torsoY + 0.4)
            ctx.quadraticCurveTo(x, torsoY + 10.4, x + 6, torsoY + 0.4)
            ctx.stroke()
            ctx.strokeStyle = '#cdf3ff'
            ctx.lineWidth = 2
            ctx.stroke()
            for (let k = 0.06; k < 0.96; k += 0.11) {
                const [px, py] = at(k)
                ctx.fillStyle = Math.round(k * 100) % 2 ? '#ffffff' : '#7fd8f7'
                ctx.beginPath()
                ctx.arc(px, py, 0.75, 0, Math.PI * 2)
                ctx.fill()
            }
            const dy = torsoY + 9.6
            ctx.fillStyle = '#e9fbff'
            ctx.strokeStyle = INK
            ctx.lineWidth = 0.9
            ctx.beginPath()
            ctx.moveTo(x - 2.2, dy - 2.2)
            ctx.lineTo(x + 2.2, dy - 2.2)
            ctx.lineTo(x + 3.6, dy - 0.6)
            ctx.lineTo(x, dy + 3.6)
            ctx.lineTo(x - 3.6, dy - 0.6)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = '#8fe0fb'
            ctx.beginPath()
            ctx.moveTo(x - 3.2, dy - 0.6)
            ctx.lineTo(x, dy + 3.2)
            ctx.lineTo(x - 0.6, dy - 0.6)
            ctx.closePath()
            ctx.moveTo(x + 3.2, dy - 0.6)
            ctx.lineTo(x, dy + 3.2)
            ctx.lineTo(x + 1.2, dy - 0.6)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = 'rgba(43,111,156,0.7)'
            ctx.lineWidth = 0.4
            ctx.beginPath()
            ctx.moveTo(x - 3.4, dy - 0.6)
            ctx.lineTo(x + 3.4, dy - 0.6)
            ctx.stroke()
            sparkle(ctx, x + 3.2, dy - 2.6, 2.6)
            sparkle(ctx, x - 5.2, torsoY + 3.2, 1.5)
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

const circle = (cx: number, cy: number, r: number): Path => (c) => {
    c.beginPath()
    c.arc(cx, cy, r, 0, Math.PI * 2)
}

/** An afro's cloud: a big ball with a ring of puffs, so its outline is bumpy. */
function cloud(cx: number, cy: number, r: number, lower = false): Path[] {
    const out: Path[] = [circle(cx, cy, r)]
    for (let k = 0; k < 11; k++) {
        const a = (k / 11) * Math.PI * 2 + 0.2
        // Under a hat only the puffs below the brim line show.
        if (lower && Math.sin(a) < 0.1) continue
        out.push(circle(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86, r * 0.32))
    }
    return out
}

/**
 * The hair: `behind` goes under the head (long hair, a ponytail, an afro's
 * cloud), `over` on it (the fringe, a bun, spikes; from the back the whole
 * head). Under a hat that covers the crown the hair is tucked: only what
 * shows below the brim is drawn (a fringe, side tufts, an afro's side puffs,
 * a low bun or a ponytail at the back), so nothing pokes through the hat.
 */
function hairShapes(look: Look, hx: number, hy: number, back: boolean, t: number): { behind: Path[], over: Path[] } {
    const style = look.style
    const behind: Path[] = []
    const over: Path[] = []
    if (style === 'bald') return { behind, over }
    // Workers and architects: a hard hat over short hair, as it always was.
    if (look.hat === 'hardhat') {
        if (back) over.push((c) => { c.beginPath(); c.arc(hx, hy + 1, 10.4, Math.PI * 0.95, Math.PI * 0.05, true); c.closePath() })
        return { behind, over }
    }
    const covered = COVERING.has(look.hat)
    const s = t * 1.5
    const backHair: Path = (c) => { c.beginPath(); c.arc(hx, hy - 0.5, 11.2, 0, Math.PI * 2) }

    if (back) {
        if (style === 'mohawk') {
            // Shaved sides: a strip down the middle, and (bare) the crest on top.
            over.push(c => roundRect(c, hx - 3, covered ? hy - 6 : hy - 12, 6, covered ? 14 : 20, 3))
            if (!covered) {
                over.push((c) => {
                    c.beginPath()
                    c.moveTo(hx - 3.4, hy - 9)
                    c.lineTo(hx - 5, hy - 16.5)
                    c.lineTo(hx - 1.2, hy - 13.6)
                    c.lineTo(hx + 0.4, hy - 20)
                    c.lineTo(hx + 2, hy - 13.6)
                    c.lineTo(hx + 5.4, hy - 16.5)
                    c.lineTo(hx + 3.4, hy - 9)
                    c.closePath()
                })
            }
            return { behind, over }
        }
        if (style === 'afro') {
            if (covered) {
                over.push(...cloud(hx, hy - 1.5, 10.8, true))
            } else {
                over.push(...cloud(hx, hy - 4, 12))
            }
            return { behind, over }
        }
        over.push(backHair)
        if (style === 'long') over.push(c => roundRect(c, hx - 11, hy - 2, 22, 16, 6))
        if (style === 'bun') over.push(covered ? circle(hx, hy + 6, 4.4) : circle(hx, hy - 12, 4.6))
        if (style === 'ponytail') {
            over.push((c) => {
                c.beginPath()
                c.moveTo(hx - 3.2, hy - 3)
                c.quadraticCurveTo(hx - 6.5, hy + 8, hx, hy + 15.5)
                c.quadraticCurveTo(hx + 6.5, hy + 8, hx + 3.2, hy - 3)
                c.closePath()
            })
        }
        if (style === 'spiky' && !covered) over.push(spikes(hx, hy))
        return { behind, over }
    }

    // Front: what frames the head from behind.
    if (style === 'long') behind.push(c => roundRect(c, hx - 12, hy - 6, 24, 19, 7))
    if (style === 'ponytail') {
        behind.push((c) => {
            c.beginPath()
            c.moveTo(hx - 6, hy - 8.5)
            c.quadraticCurveTo(hx - 17.5, hy - 8, hx - 16.5, hy + 3)
            c.quadraticCurveTo(hx - 16, hy + 11, hx - 11.5, hy + 14)
            c.quadraticCurveTo(hx - 12.5, hy + 6, hx - 7, hy + 0.5)
            c.closePath()
        })
    }
    if (style === 'afro') {
        if (covered) behind.push(circle(hx - 11, hy + 0.5, 5), circle(hx - 8.5, hy + 5.5, 4.4), circle(hx + 11, hy + 0.5, 4.6))
        else behind.push(...cloud(hx - s * 0.3, hy - 4, 12))
    }
    if (style === 'bun' && covered) behind.push(circle(hx - 10.6, hy + 3, 4))

    // On the head.
    if (style === 'bun' && !covered) over.push(circle(hx - s, hy - 12.5, 4.6))
    if (style === 'spiky') {
        if (covered) {
            // Tufts poking out under the brim, not through the crown.
            over.push((c) => {
                c.beginPath()
                c.moveTo(hx - 9.6, hy - 4.2)
                c.lineTo(hx - 14.2, hy - 2.6)
                c.lineTo(hx - 10.8, hy - 0.8)
                c.lineTo(hx - 13.4, hy + 2.6)
                c.lineTo(hx - 9.4, hy + 2)
                c.closePath()
                c.moveTo(hx + 9.6, hy - 4.2)
                c.lineTo(hx + 13, hy - 1.6)
                c.lineTo(hx + 10, hy - 0.4)
                c.closePath()
            })
        } else {
            over.push(spikes(hx, hy))
        }
    }
    if (style === 'mohawk') {
        if (!covered) {
            // A crest swept back along the top of the head; the sides are shaved (drawHairDetail).
            over.push((c) => {
                c.beginPath()
                c.moveTo(hx - 8.5, hy - 5.5)
                c.lineTo(hx - 13.5, hy - 12)
                c.lineTo(hx - 7.5, hy - 11.8)
                c.lineTo(hx - 9, hy - 18.5)
                c.lineTo(hx - 2.6, hy - 13.6)
                c.lineTo(hx - 1.4, hy - 20.5)
                c.lineTo(hx + 2.6, hy - 13.6)
                c.lineTo(hx + 7.4, hy - 16.5)
                c.lineTo(hx + 6.6 + s * 0.4, hy - 9.4)
                c.quadraticCurveTo(hx - 1, hy - 12.6, hx - 8.5, hy - 5.5)
                c.closePath()
            })
        }
        return { behind, over }
    }
    // The fringe cap, swept toward the facing side.
    over.push((c) => {
        c.beginPath()
        c.moveTo(hx - 10.8, hy + 1)
        c.arc(hx, hy - 0.5, 11, Math.PI * 1.02, Math.PI * 1.98)
        c.quadraticCurveTo(hx + 7 + s, hy - 1, hx + 2 + s, hy - 4)
        c.quadraticCurveTo(hx - 2 + s, hy - 0.5, hx - 6 + s, hy - 3.5)
        c.quadraticCurveTo(hx - 8, hy - 1, hx - 10.8, hy + 1)
        c.closePath()
    })
    return { behind, over }
}

function spikes(hx: number, hy: number): Path {
    return (c) => {
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
    }
}

/** Hair touches after the fill: a mohawk's shaved sides, an afro's texture, a ponytail's tie, a gloss. */
function drawHairDetail(ctx: CanvasRenderingContext2D, look: Look, hx: number, hy: number, back: boolean, t: number) {
    const covered = COVERING.has(look.hat)
    if (look.hat === 'hardhat' || look.style === 'bald') return
    switch (look.style) {
        case 'mohawk':
            if (back) return
            // Stubble on the shaved sides (under the crest).
            ctx.save()
            ctx.beginPath()
            ctx.arc(hx, hy, 10.5, 0, Math.PI * 2)
            ctx.clip()
            ctx.fillStyle = look.hair
            ctx.globalAlpha = 0.28
            ctx.beginPath()
            ctx.arc(hx, hy - 0.5, 11, Math.PI * 1.02, Math.PI * 1.98)
            ctx.lineTo(hx + 10, hy - 3)
            ctx.quadraticCurveTo(hx, hy - 6.5, hx - 10.8, hy - 1)
            ctx.closePath()
            ctx.fill()
            ctx.restore()
            if (!covered) {
                ctx.fillStyle = 'rgba(255,255,255,0.3)'
                ctx.beginPath()
                ctx.ellipse(hx - 4, hy - 13, 0.8, 2.6, 0.5, 0, Math.PI * 2)
                ctx.fill()
            }
            return
        case 'afro':
            if (covered) return
            // A few darker curls in the cloud.
            ctx.fillStyle = darken(look.hair, 0.25)
            for (const [dx, dy] of back ? [[-6, -8], [4, -11], [7, -2], [-8, 2], [0, -4]] as const : [[-12, -8], [-9, -14], [8, -14], [11, -7], [-13, 1]] as const) {
                ctx.beginPath()
                ctx.arc(hx + dx, hy + dy, 1.1, 0, Math.PI * 2)
                ctx.fill()
            }
            ctx.fillStyle = 'rgba(255,255,255,0.22)'
            ctx.beginPath()
            ctx.ellipse(hx - 6, hy - 13, 3.2, 1.6, -0.5, 0, Math.PI * 2)
            ctx.fill()
            return
        case 'ponytail': {
            // Under a hat the tie sits below the brim, not over it.
            const tie = covered ? hy + 1.4 : hy - 3.6
            if (back) {
                // The tail hangs over the hair: its edges in a darker strand.
                ctx.strokeStyle = darken(look.hair, 0.32)
                ctx.lineWidth = 0.9
                ctx.beginPath()
                ctx.moveTo(hx - 2.6, tie + 2.1)
                ctx.quadraticCurveTo(hx - 5.6, hy + 6, hx - 3.8, hy + 10.4)
                ctx.moveTo(hx + 2.6, tie + 2.1)
                ctx.quadraticCurveTo(hx + 5.6, hy + 6, hx + 3.8, hy + 10.4)
                ctx.stroke()
            }
            ctx.fillStyle = '#e8594f'
            ctx.strokeStyle = INK
            ctx.lineWidth = 0.8
            ctx.beginPath()
            if (back) roundRect(ctx, hx - 3.4, tie, 6.8, 2.4, 1.2)
            else ctx.ellipse(hx - 11.6, hy - 6.2, 1.4, 2.4, 0.7, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            return
        }
        case 'bun':
            if (back && covered) {
                // A low bun on the back of the head: its rim in a darker strand (the outline pass merges it with the hair).
                ctx.strokeStyle = darken(look.hair, 0.38)
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.arc(hx, hy + 6, 4.4, 0, Math.PI * 2)
                ctx.stroke()
                ctx.fillStyle = 'rgba(255,255,255,0.3)'
                ctx.beginPath()
                ctx.ellipse(hx - 1.6, hy + 4.4, 1.6, 0.9, -0.5, 0, Math.PI * 2)
                ctx.fill()
            }
            ctx.strokeStyle = darken(look.hair, 0.3)
            ctx.lineWidth = 0.7
            ctx.beginPath()
            if (back) ctx.arc(hx, covered ? hy + 6.4 : hy - 12, 2.4, Math.PI * 1.1, Math.PI * 1.9)
            else if (!covered) ctx.arc(hx - t * 1.5, hy - 12.5, 2.4, Math.PI * 1.1, Math.PI * 1.9)
            ctx.stroke()
    }
}

/** A small seated figure's head-and-shoulders seen from behind (spectator rows, sofas). */
export function drawSeatedBack(ctx: CanvasRenderingContext2D, x: number, y: number, look: Look) {
    drawFigure(ctx, x, y, look, 'sit', 0, 1)
}
