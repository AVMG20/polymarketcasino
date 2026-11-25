import { INK, roundRect } from '../iso'
import type { Look } from './characters'
import { HAIRS, SKINS } from './palette'

/**
 * The Hospitality staff: waiters who carry a tray round the floor. The
 * uniform smartens up with the upgrade (a waiter in an apron, a waistcoat, a
 * butler in tails with gold trim) and the tray follows the upgrade's ladder
 * (drinks, snacks, a buffet plate … champagne, the private chef's cloche).
 * Cosmetic only: staff are never guests.
 */

/** 1 waiter (apron), 2 waistcoat, 3 butler (tailcoat, gold trim, white gloves). */
export type StaffUniform = 1 | 2 | 3
export type TrayLoad = 'empty' | 'drinks' | 'snacks' | 'buffet' | 'wine' | 'dining' | 'cocktails' | 'champagne' | 'chef'

export interface StaffLook {
    uniform: StaffUniform
    tray: TrayLoad
}

/** Where the tray's centre sits from the feet's x and the arm's top (figure px). */
export const STAFF_TRAY = { x: 13, y: 3.2 }

/** What a tray carries at each Hospitality level 1-8: free drinks, snacks, a buffet, live music (wine), fine dining, a cocktail bar, champagne, a private chef. */
const TRAY_BY_LEVEL: readonly TrayLoad[] = ['drinks', 'snacks', 'buffet', 'wine', 'dining', 'cocktails', 'champagne', 'chef']

/** Staff on the floor at a Hospitality level: none at 0, one at 1-2, two at 3-5, three from 6. */
export function staffCount(level: number): number {
    if (level <= 0) return 0
    return level <= 2 ? 1 : level <= 5 ? 2 : 3
}

export function staffUniform(level: number): StaffUniform {
    return level <= 2 ? 1 : level <= 5 ? 2 : 3
}

const FACES: readonly { skin: number, hair: number, style: Look['style'] }[] = [
    { skin: 1, hair: 0, style: 'short' },
    { skin: 3, hair: 4, style: 'bun' },
    { skin: 0, hair: 2, style: 'ponytail' }
]

const DRESS: Record<StaffUniform, { shirt: string, pants: string }> = {
    1: { shirt: '#fbf6ee', pants: '#2b2b3a' },
    2: { shirt: '#fbf6ee', pants: '#241c30' },
    3: { shirt: '#221b2e', pants: '#17121f' }
}

/**
 * The looks of the staff at a Hospitality level (`staffCount` of them), each
 * with its tray loaded: the first carries the level's own treat, the others
 * the ones below it.
 */
export function staffLooks(level: number): Look[] {
    const n = staffCount(level)
    const uniform = staffUniform(level)
    const out: Look[] = []
    for (let i = 0; i < n; i++) {
        const face = FACES[i % FACES.length]!
        const tray = TRAY_BY_LEVEL[Math.max(0, Math.min(TRAY_BY_LEVEL.length, level) - 1 - i)]!
        out.push({
            skin: SKINS[face.skin]!,
            hair: HAIRS[face.hair]!,
            style: uniform === 3 && face.style === 'ponytail' ? 'bun' : face.style,
            shirt: DRESS[uniform].shirt,
            pants: DRESS[uniform].pants,
            hat: 'none',
            hatColor: '#000',
            staff: { uniform, tray }
        })
    }
    return out
}

/** The same staff member on the way back: an empty tray. */
export function emptyTray(look: Look): Look {
    return look.staff ? { ...look, staff: { ...look.staff, tray: 'empty' } } : look
}

function bowTie(ctx: CanvasRenderingContext2D, x: number, by: number, fill: string) {
    ctx.fillStyle = fill
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.8
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(x, by)
    ctx.lineTo(x - 3.6, by - 2)
    ctx.lineTo(x - 3.6, by + 2)
    ctx.closePath()
    ctx.moveTo(x, by)
    ctx.lineTo(x + 3.6, by - 2)
    ctx.lineTo(x + 3.6, by + 2)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
}

function buttons(ctx: CanvasRenderingContext2D, x: number, ys: number[], fill: string) {
    ctx.fillStyle = fill
    ctx.beginPath()
    for (const y of ys) {
        ctx.moveTo(x + 0.8, y)
        ctx.arc(x, y, 0.8, 0, Math.PI * 2)
    }
    ctx.fill()
}

/** The uniform over the shirt (after the outlined body, before the face). */
export function drawUniform(ctx: CanvasRenderingContext2D, uniform: StaffUniform, x: number, y: number, torsoY: number, back: boolean, sit: boolean) {
    ctx.save()
    switch (uniform) {
        case 1: {
            // A long black waiter's apron from the waist, tied at the back.
            if (back) {
                ctx.strokeStyle = '#2b2236'
                ctx.lineWidth = 1.4
                ctx.beginPath()
                ctx.moveTo(x - 7.5, torsoY + 10.5)
                ctx.lineTo(x + 7.5, torsoY + 10.5)
                ctx.stroke()
                ctx.fillStyle = '#2b2236'
                ctx.beginPath()
                ctx.ellipse(x - 1.6, torsoY + 10.5, 1.8, 1.1, 0.4, 0, Math.PI * 2)
                ctx.ellipse(x + 1.6, torsoY + 10.5, 1.8, 1.1, -0.4, 0, Math.PI * 2)
                ctx.fill()
                break
            }
            const bottom = sit ? torsoY + 15 : y - 3
            ctx.fillStyle = '#2b2236'
            ctx.strokeStyle = INK
            ctx.lineWidth = 1.1
            roundRect(ctx, x - 7.6, torsoY + 9.5, 15.2, bottom - torsoY - 9.5, 2)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = 'rgba(255,255,255,0.14)'
            ctx.fillRect(x - 6, torsoY + 11, 2, bottom - torsoY - 13)
            // A white cloth tucked in the string.
            ctx.fillStyle = '#ffffff'
            roundRect(ctx, x - 6.5, torsoY + 9.6, 3.4, 4.2, 0.8)
            ctx.fill()
            bowTie(ctx, x, torsoY + 1.6, '#2b2236')
            break
        }
        case 2: {
            // A burgundy waistcoat with gold buttons and a black bow tie.
            const vest = '#8a1f3d'
            ctx.fillStyle = vest
            ctx.beginPath()
            if (back) {
                roundRect(ctx, x - 7, torsoY + 1, 14, 13, 5)
                ctx.fill()
                ctx.fillStyle = 'rgba(0,0,0,0.18)'
                ctx.fillRect(x - 3.5, torsoY + 8, 7, 1.4)
                break
            }
            ctx.moveTo(x - 7.6, torsoY + 1.5)
            ctx.lineTo(x - 1.2, torsoY + 8.5)
            ctx.lineTo(x - 1.2, torsoY + 15)
            ctx.lineTo(x - 7.6, torsoY + 15)
            ctx.closePath()
            ctx.moveTo(x + 7.6, torsoY + 1.5)
            ctx.lineTo(x + 1.2, torsoY + 8.5)
            ctx.lineTo(x + 1.2, torsoY + 15)
            ctx.lineTo(x + 7.6, torsoY + 15)
            ctx.closePath()
            ctx.fill()
            ctx.fillStyle = 'rgba(255,255,255,0.18)'
            ctx.fillRect(x - 6.4, torsoY + 4, 1.4, 9)
            buttons(ctx, x - 2.4, [torsoY + 10, torsoY + 12.8], '#f4c14f')
            bowTie(ctx, x, torsoY + 1.8, '#1a1424')
            break
        }
        case 3: {
            // A black tailcoat: white shirt front, gold-edged lapels, white bow tie, gold buttons and shoulder trim.
            if (back) {
                // The tails hang over the legs.
                if (!sit) {
                    ctx.fillStyle = '#221b2e'
                    ctx.strokeStyle = INK
                    ctx.lineWidth = 1
                    ctx.beginPath()
                    ctx.moveTo(x - 6.5, torsoY + 12)
                    ctx.lineTo(x - 0.4, torsoY + 12)
                    ctx.lineTo(x - 1.2, y - 4)
                    ctx.lineTo(x - 5.6, y - 5.5)
                    ctx.closePath()
                    ctx.moveTo(x + 6.5, torsoY + 12)
                    ctx.lineTo(x + 0.4, torsoY + 12)
                    ctx.lineTo(x + 1.2, y - 4)
                    ctx.lineTo(x + 5.6, y - 5.5)
                    ctx.closePath()
                    ctx.fill()
                    ctx.stroke()
                }
                ctx.strokeStyle = '#f4c14f'
                ctx.lineWidth = 0.9
                ctx.beginPath()
                ctx.moveTo(x - 7, torsoY + 1.5)
                ctx.lineTo(x - 3.5, torsoY + 1)
                ctx.moveTo(x + 7, torsoY + 1.5)
                ctx.lineTo(x + 3.5, torsoY + 1)
                ctx.stroke()
                break
            }
            ctx.fillStyle = '#fbf6ee'
            ctx.beginPath()
            ctx.moveTo(x - 4.4, torsoY)
            ctx.lineTo(x, torsoY + 10)
            ctx.lineTo(x + 4.4, torsoY)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = '#f4c14f'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(x - 4.9, torsoY)
            ctx.lineTo(x - 0.3, torsoY + 10.6)
            ctx.moveTo(x + 4.9, torsoY)
            ctx.lineTo(x + 0.3, torsoY + 10.6)
            // Gold trim on the shoulders.
            ctx.moveTo(x - 7.4, torsoY + 1.8)
            ctx.lineTo(x - 5.2, torsoY + 0.6)
            ctx.moveTo(x + 7.4, torsoY + 1.8)
            ctx.lineTo(x + 5.2, torsoY + 0.6)
            ctx.stroke()
            buttons(ctx, x - 0.2, [torsoY + 12, torsoY + 14], '#f4c14f')
            // A gold pocket square.
            ctx.fillStyle = '#f4c14f'
            ctx.beginPath()
            ctx.moveTo(x - 6.6, torsoY + 5.6)
            ctx.lineTo(x - 4.6, torsoY + 4.4)
            ctx.lineTo(x - 4.2, torsoY + 5.6)
            ctx.closePath()
            ctx.fill()
            bowTie(ctx, x, torsoY + 1.8, '#ffffff')
            break
        }
    }
    ctx.restore()
}

/** An outlined shape: the path, then the fill, then a thin ink line. */
function solid(ctx: CanvasRenderingContext2D, path: () => void, fill: string | CanvasGradient, line = 0.9) {
    path()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = line
    ctx.stroke()
}

/** A straight glass `w` wide, `h` tall, standing on `by`, filled to `level` (0..1). */
function tumbler(ctx: CanvasRenderingContext2D, cx: number, by: number, w: number, h: number, drink: string, level = 0.75) {
    solid(ctx, () => roundRect(ctx, cx - w / 2, by - h, w, h, 0.8), 'rgba(230,245,255,0.75)')
    ctx.fillStyle = drink
    ctx.fillRect(cx - w / 2 + 0.6, by - h * level, w - 1.2, h * level - 0.6)
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillRect(cx - w / 2 + 0.8, by - h + 0.8, 0.8, h - 1.6)
}

function flute(ctx: CanvasRenderingContext2D, cx: number, by: number) {
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(cx, by)
    ctx.lineTo(cx, by - 3)
    ctx.moveTo(cx - 1.4, by)
    ctx.lineTo(cx + 1.4, by)
    ctx.stroke()
    solid(ctx, () => roundRect(ctx, cx - 1.3, by - 9.5, 2.6, 6.8, 1.2), '#f7dc7a', 0.8)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillRect(cx - 0.6, by - 8.6, 0.6, 1)
    ctx.fillRect(cx + 0.1, by - 6.6, 0.6, 0.8)
}

function bottle(ctx: CanvasRenderingContext2D, cx: number, by: number, glass: string, label: string, foil: string) {
    solid(ctx, () => {
        ctx.beginPath()
        ctx.moveTo(cx - 2.2, by)
        ctx.lineTo(cx - 2.2, by - 6.5)
        ctx.quadraticCurveTo(cx - 2.2, by - 8.5, cx - 0.9, by - 9.2)
        ctx.lineTo(cx - 0.9, by - 12)
        ctx.lineTo(cx + 0.9, by - 12)
        ctx.lineTo(cx + 0.9, by - 9.2)
        ctx.quadraticCurveTo(cx + 2.2, by - 8.5, cx + 2.2, by - 6.5)
        ctx.lineTo(cx + 2.2, by)
        ctx.closePath()
    }, glass)
    ctx.fillStyle = label
    ctx.fillRect(cx - 1.7, by - 5.4, 3.4, 2.8)
    ctx.fillStyle = foil
    ctx.fillRect(cx - 0.9, by - 12, 1.8, 2.6)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.fillRect(cx - 1.6, by - 7, 0.7, 5.5)
}

function cloche(ctx: CanvasRenderingContext2D, cx: number, by: number, r: number, gold: boolean) {
    const g = ctx.createLinearGradient(cx - r, by - r, cx + r, by)
    g.addColorStop(0, gold ? '#fff1a8' : '#ffffff')
    g.addColorStop(0.5, gold ? '#f4c14f' : '#cfd5e2')
    g.addColorStop(1, gold ? '#b98228' : '#8d95ab')
    solid(ctx, () => {
        ctx.beginPath()
        ctx.ellipse(cx, by, r, r * 0.9, 0, Math.PI, Math.PI * 2)
        ctx.closePath()
    }, g)
    solid(ctx, () => {
        ctx.beginPath()
        ctx.arc(cx, by - r * 0.9 - 0.8, 1.2, 0, Math.PI * 2)
    }, gold ? '#f4c14f' : '#cfd5e2', 0.7)
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.beginPath()
    ctx.ellipse(cx - r * 0.45, by - r * 0.5, 1, 1.8, -0.6, 0, Math.PI * 2)
    ctx.fill()
}

/** The tray held level, centred at (cx, cy), and what is on it. */
export function drawTray(ctx: CanvasRenderingContext2D, cx: number, cy: number, look: StaffLook) {
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const plate = look.uniform === 3
        ? { top: '#ffe58a', rim: '#c98a1e' }
        : look.uniform === 2 ? { top: '#e6eaf2', rim: '#9aa3b8' } : { top: '#a77650', rim: '#6e4a31' }
    // The rim (a thin edge under the top), then the top.
    solid(ctx, () => {
        ctx.beginPath()
        ctx.ellipse(cx, cy + 0.9, 7.6, 2.6, 0, 0, Math.PI * 2)
    }, plate.rim, 1.1)
    ctx.fillStyle = plate.top
    ctx.beginPath()
    ctx.ellipse(cx, cy, 7.2, 2.3, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.beginPath()
    ctx.ellipse(cx - 2.6, cy - 0.8, 2.6, 0.6, 0, 0, Math.PI * 2)
    ctx.fill()
    const by = cy + 0.4
    switch (look.tray) {
        case 'empty':
            // A folded napkin.
            solid(ctx, () => {
                ctx.beginPath()
                ctx.moveTo(cx - 2.5, by)
                ctx.lineTo(cx + 2.8, by)
                ctx.lineTo(cx + 0.4, by - 3)
                ctx.closePath()
            }, '#ffffff', 0.7)
            break
        case 'drinks':
            tumbler(ctx, cx - 2.6, by, 3.4, 5.4, '#f59e0b')
            tumbler(ctx, cx + 2.4, by, 3.4, 5.4, '#6b2f1a')
            ctx.strokeStyle = '#e8594f'
            ctx.lineWidth = 0.8
            ctx.beginPath()
            ctx.moveTo(cx - 2, by - 4)
            ctx.lineTo(cx - 1, by - 7.4)
            ctx.stroke()
            break
        case 'snacks':
            // A bowl of popcorn and a soda.
            solid(ctx, () => {
                ctx.beginPath()
                ctx.moveTo(cx - 6, by - 3.4)
                ctx.lineTo(cx + 0.8, by - 3.4)
                ctx.quadraticCurveTo(cx + 0.4, by, cx - 2.6, by)
                ctx.quadraticCurveTo(cx - 5.6, by, cx - 6, by - 3.4)
                ctx.closePath()
            }, '#e8594f')
            ctx.fillStyle = '#fff3c4'
            for (const [dx, dy] of [[-4.6, -4.2], [-2.6, -5], [-0.6, -4.2], [-3.5, -3.6], [-1.6, -3.6]] as const) {
                ctx.beginPath()
                ctx.arc(cx + dx, by + dy, 1.3, 0, Math.PI * 2)
                ctx.fill()
            }
            tumbler(ctx, cx + 3.6, by, 3.2, 5.4, '#3fd25a')
            break
        case 'buffet':
            // A plate piled high: salad, a drumstick, a tomato.
            ctx.fillStyle = '#ffffff'
            ctx.strokeStyle = INK
            ctx.lineWidth = 0.7
            ctx.beginPath()
            ctx.ellipse(cx, by - 0.6, 5.4, 1.7, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            solid(ctx, () => {
                ctx.beginPath()
                ctx.arc(cx - 2.2, by - 2, 2.4, Math.PI, Math.PI * 2)
                ctx.closePath()
            }, '#5fb35a', 0.7)
            solid(ctx, () => {
                ctx.beginPath()
                ctx.ellipse(cx + 1.6, by - 2.4, 2.4, 1.7, -0.3, 0, Math.PI * 2)
            }, '#b86a2c', 0.7)
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(cx + 3.6, by - 3.8, 1.8, 0.9)
            solid(ctx, () => {
                ctx.beginPath()
                ctx.arc(cx - 0.4, by - 3.2, 1.2, 0, Math.PI * 2)
            }, '#e8594f', 0.6)
            break
        case 'wine': {
            bottle(ctx, cx + 3.2, by, '#2f5a32', '#fbf6ee', '#7a1f35')
            // A glass of red.
            ctx.strokeStyle = INK
            ctx.lineWidth = 0.7
            ctx.beginPath()
            ctx.moveTo(cx - 2.6, by)
            ctx.lineTo(cx - 2.6, by - 3)
            ctx.moveTo(cx - 4.2, by)
            ctx.lineTo(cx - 1, by)
            ctx.stroke()
            solid(ctx, () => {
                ctx.beginPath()
                ctx.moveTo(cx - 5, by - 7.4)
                ctx.lineTo(cx - 0.2, by - 7.4)
                ctx.quadraticCurveTo(cx - 0.2, by - 3, cx - 2.6, by - 3)
                ctx.quadraticCurveTo(cx - 5, by - 3, cx - 5, by - 7.4)
                ctx.closePath()
            }, '#9f1239', 0.8)
            break
        }
        case 'dining':
            cloche(ctx, cx, by, 5.2, false)
            break
        case 'cocktails': {
            // A martini with an olive and a pink highball with an umbrella.
            ctx.strokeStyle = INK
            ctx.lineWidth = 0.7
            ctx.beginPath()
            ctx.moveTo(cx - 3, by)
            ctx.lineTo(cx - 3, by - 3.4)
            ctx.moveTo(cx - 4.6, by)
            ctx.lineTo(cx - 1.4, by)
            ctx.stroke()
            solid(ctx, () => {
                ctx.beginPath()
                ctx.moveTo(cx - 6.2, by - 7.8)
                ctx.lineTo(cx + 0.2, by - 7.8)
                ctx.lineTo(cx - 3, by - 3.4)
                ctx.closePath()
            }, '#9fe3f5', 0.8)
            ctx.fillStyle = '#5fb35a'
            ctx.beginPath()
            ctx.arc(cx - 3.2, by - 6.4, 1.1, 0, Math.PI * 2)
            ctx.fill()
            tumbler(ctx, cx + 3, by, 3.4, 6.4, '#f472b6', 0.85)
            solid(ctx, () => {
                ctx.beginPath()
                ctx.moveTo(cx + 1.4, by - 8.6)
                ctx.quadraticCurveTo(cx + 3.8, by - 11.4, cx + 6.2, by - 8.6)
                ctx.closePath()
            }, '#facc15', 0.7)
            break
        }
        case 'champagne':
            bottle(ctx, cx + 3.6, by, '#1f3d2a', '#f4c14f', '#f4c14f')
            flute(ctx, cx - 4, by)
            flute(ctx, cx - 0.8, by)
            break
        case 'chef':
            cloche(ctx, cx - 1.4, by, 5, true)
            flute(ctx, cx + 5, by)
            break
    }
    ctx.restore()
}
