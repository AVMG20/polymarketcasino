import { INK, darken, lighten, roundRect } from '../iso'
import type { Baked, TextureBank } from './bank'
import { PAL } from './palette'

/**
 * Small screen-space textures: particles, glows, markers, emote bubbles,
 * reel symbols and dice faces. Baked once per engine.
 */

export type Emote = 'heart' | 'coin' | 'bang' | 'note' | 'star' | 'what' | 'smile'

export const EMOTES: Emote[] = ['heart', 'coin', 'bang', 'note', 'star', 'what', 'smile']

export interface FxTextures {
    glow: Baked
    pool: Baked
    coin: Baked
    chip: Baked
    confetti: Baked
    sparkle: Baked
    dust: Baked
    cloud: Baked
    shadow: Baked
    ring: Baked
    cross: Baked
    emotes: Record<Emote, Baked>
    symbols: Baked[]
    dice: Baked[]
    flame: Baked
    pointer: Baked
    chipStacks: Baked[]
    /** Gold coin stacks 1-6 high (the cage pays coins). */
    coinStacks: Baked[]
    arrow: Baked
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | CanvasGradient) {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
}

function bubble(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = INK
    roundRect(ctx, 1, 1, w - 2, h - 8, 9)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(w / 2 - 6, h - 9)
    ctx.lineTo(w / 2, h - 1)
    ctx.lineTo(w / 2 + 6, h - 9)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, 2.6, 2.6, w - 5.2, h - 11.2, 7.5)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(w / 2 - 4, h - 9.5)
    ctx.lineTo(w / 2, h - 4)
    ctx.lineTo(w / 2 + 4, h - 9.5)
    ctx.closePath()
    ctx.fill()
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string) {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(x, y + s * 0.9)
    ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35)
    ctx.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9)
    ctx.fill()
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, points = 5, inner = 0.45) {
    ctx.fillStyle = fill
    ctx.beginPath()
    for (let i = 0; i < points * 2; i++) {
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
        const rr = i % 2 ? r * inner : r
        if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
        else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    }
    ctx.closePath()
    ctx.fill()
}

export function bakeFx(bank: TextureBank): FxTextures {
    const flat = (key: string, w: number, h: number, ox: number, oy: number, draw: (ctx: CanvasRenderingContext2D) => void) =>
        bank.get(`fx:${key}`, () => bank.bake(w, h, ox, oy, (_p, ctx) => draw(ctx)))

    const glow = flat('glow', 64, 64, 32, 32, (ctx) => {
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
        g.addColorStop(0, 'rgba(255,255,255,1)')
        g.addColorStop(0.35, 'rgba(255,255,255,0.45)')
        g.addColorStop(1, 'rgba(255,255,255,0)')
        circle(ctx, 32, 32, 32, g)
    })
    const pool = flat('pool', 128, 64, 64, 32, (ctx) => {
        ctx.save()
        ctx.scale(1, 0.5)
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
        g.addColorStop(0, 'rgba(255,255,255,0.9)')
        g.addColorStop(0.5, 'rgba(255,255,255,0.3)')
        g.addColorStop(1, 'rgba(255,255,255,0)')
        circle(ctx, 64, 64, 64, g)
        ctx.restore()
    })
    const coin = flat('coin', 18, 18, 9, 9, (ctx) => {
        circle(ctx, 9, 9, 8, INK)
        const g = ctx.createLinearGradient(2, 2, 16, 16)
        g.addColorStop(0, PAL.goldLight)
        g.addColorStop(0.5, PAL.coin)
        g.addColorStop(1, PAL.goldDark)
        circle(ctx, 9, 9, 6.6, g)
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(9, 9, 4.2, Math.PI * 1.1, Math.PI * 1.8)
        ctx.stroke()
    })
    const chip = flat('chip', 18, 18, 9, 9, (ctx) => {
        circle(ctx, 9, 9, 8, INK)
        circle(ctx, 9, 9, 6.8, PAL.chip)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.setLineDash([2.4, 2.6])
        ctx.beginPath()
        ctx.arc(9, 9, 5.6, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
        circle(ctx, 9, 9, 3.4, PAL.chipDark)
        circle(ctx, 9, 9, 1.4, 'rgba(255,255,255,0.85)')
    })
    const confetti = flat('confetti', 6, 10, 3, 5, (ctx) => {
        ctx.fillStyle = '#ffffff'
        roundRect(ctx, 0.5, 0.5, 5, 9, 1.5)
        ctx.fill()
    })
    const sparkle = flat('sparkle', 20, 20, 10, 10, (ctx) => {
        star(ctx, 10, 10, 9, '#ffffff', 4, 0.22)
    })
    const dust = flat('dust', 32, 32, 16, 16, (ctx) => {
        const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
        g.addColorStop(0, 'rgba(255, 248, 235, 0.95)')
        g.addColorStop(1, 'rgba(255, 248, 235, 0)')
        circle(ctx, 16, 16, 16, g)
    })
    const cloud = flat('cloud', 200, 100, 100, 50, (ctx) => {
        ctx.save()
        ctx.scale(1, 0.5)
        for (const [x, y, r] of [[100, 100, 70], [60, 110, 45], [140, 95, 50], [100, 70, 40]] as const) {
            const g = ctx.createRadialGradient(x, y, 0, x, y, r)
            g.addColorStop(0, 'rgba(230, 220, 255, 0.5)')
            g.addColorStop(1, 'rgba(230, 220, 255, 0)')
            circle(ctx, x, y, r, g)
        }
        ctx.restore()
    })
    const shadow = flat('shadow', 40, 20, 20, 10, (ctx) => {
        ctx.save()
        ctx.scale(1, 0.5)
        const g = ctx.createRadialGradient(20, 20, 0, 20, 20, 20)
        g.addColorStop(0, 'rgba(20, 8, 30, 0.55)')
        g.addColorStop(0.6, 'rgba(20, 8, 30, 0.35)')
        g.addColorStop(1, 'rgba(20, 8, 30, 0)')
        circle(ctx, 20, 20, 20, g)
        ctx.restore()
    })
    const ring = flat('ring', 52, 28, 26, 14, (ctx) => {
        ctx.strokeStyle = 'rgba(255,255,255,1)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.ellipse(26, 14, 22, 11, 0, 0, Math.PI * 2)
        ctx.stroke()
    })
    const cross = flat('cross', 24, 16, 12, 8, (ctx) => {
        ctx.lineCap = 'round'
        for (const [w, c] of [[5, INK], [2.6, '#ffffff']] as const) {
            ctx.strokeStyle = c
            ctx.lineWidth = w
            ctx.beginPath()
            ctx.moveTo(5, 3)
            ctx.lineTo(19, 13)
            ctx.moveTo(19, 3)
            ctx.lineTo(5, 13)
            ctx.stroke()
        }
    })
    const emote = (kind: Emote) => flat(`emote:${kind}`, 30, 32, 15, 31, (ctx) => {
        bubble(ctx, 30, 32)
        const cx = 15
        const cy = 13
        if (kind === 'heart') heart(ctx, cx, cy, 6, '#f43f5e')
        else if (kind === 'star') star(ctx, cx, cy, 7.5, '#f5b82e')
        else if (kind === 'coin') {
            circle(ctx, cx, cy, 7, INK)
            circle(ctx, cx, cy, 5.8, PAL.coin)
            ctx.font = '9px "Lilita One", system-ui, sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillStyle = PAL.goldDark
            ctx.fillText('$', cx, cy + 0.5)
        } else if (kind === 'note') {
            ctx.fillStyle = '#8b5cf6'
            ctx.beginPath()
            ctx.ellipse(cx - 3, cy + 4, 3.4, 2.6, -0.4, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillRect(cx - 0.2, cy - 7, 2, 11)
            ctx.beginPath()
            ctx.moveTo(cx + 1.8, cy - 7)
            ctx.quadraticCurveTo(cx + 7, cy - 4, cx + 5, cy)
            ctx.quadraticCurveTo(cx + 5, cy - 4, cx + 1.8, cy - 4)
            ctx.fill()
        } else if (kind === 'smile') {
            circle(ctx, cx, cy, 7, '#facc15')
            ctx.fillStyle = INK
            circle(ctx, cx - 2.4, cy - 1.5, 1.1, INK)
            circle(ctx, cx + 2.4, cy - 1.5, 1.1, INK)
            ctx.strokeStyle = INK
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.arc(cx, cy + 0.5, 3.4, 0.15 * Math.PI, 0.85 * Math.PI)
            ctx.stroke()
        } else {
            ctx.font = '17px "Lilita One", system-ui, sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillStyle = kind === 'bang' ? '#f97316' : '#3b82f6'
            ctx.fillText(kind === 'bang' ? '!' : '?', cx, cy + 1)
        }
    })
    const emotes = Object.fromEntries((['heart', 'coin', 'bang', 'note', 'star', 'what', 'smile'] as Emote[]).map(k => [k, emote(k)])) as Record<Emote, Baked>

    // Reel symbols: tiny, bold, readable as a flicker.
    const symbolDraws: ((ctx: CanvasRenderingContext2D) => void)[] = [
        (ctx) => {
            ctx.font = '9px "Lilita One", system-ui, sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillStyle = '#ef4444'
            ctx.fillText('7', 4, 5)
        },
        (ctx) => {
            circle(ctx, 2.6, 6, 1.9, '#dc2626')
            circle(ctx, 5.4, 6.4, 1.9, '#dc2626')
            ctx.strokeStyle = '#16a34a'
            ctx.lineWidth = 0.8
            ctx.beginPath()
            ctx.moveTo(2.6, 4.5)
            ctx.lineTo(5, 1.4)
            ctx.lineTo(5.4, 4.8)
            ctx.stroke()
        },
        ctx => star(ctx, 4, 5, 3.6, '#facc15'),
        (ctx) => {
            ctx.fillStyle = '#38bdf8'
            ctx.beginPath()
            ctx.moveTo(4, 1.5)
            ctx.lineTo(7, 4.5)
            ctx.lineTo(4, 8.5)
            ctx.lineTo(1, 4.5)
            ctx.closePath()
            ctx.fill()
        },
        (ctx) => {
            ctx.fillStyle = '#f5f5f5'
            roundRect(ctx, 0.6, 3, 6.8, 3.6, 1)
            ctx.fill()
            ctx.fillStyle = INK
            ctx.fillRect(1.6, 4.4, 4.8, 0.9)
        },
        ctx => heart(ctx, 4, 5, 2.8, '#f472b6')
    ]
    const symbols = symbolDraws.map((draw, i) => flat(`sym:${i}`, 8, 10, 4, 5, draw))

    const dice = [1, 2, 3, 4, 5, 6].map(n => flat(`die:${n}`, 12, 12, 6, 6, (ctx) => {
        ctx.fillStyle = INK
        roundRect(ctx, 0.5, 0.5, 11, 11, 3)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        roundRect(ctx, 1.5, 1.5, 9, 9, 2.4)
        ctx.fill()
        const pips: Record<number, [number, number][]> = {
            1: [[6, 6]],
            2: [[4, 4], [8, 8]],
            3: [[3.6, 3.6], [6, 6], [8.4, 8.4]],
            4: [[4, 4], [8, 4], [4, 8], [8, 8]],
            5: [[3.6, 3.6], [8.4, 3.6], [6, 6], [3.6, 8.4], [8.4, 8.4]],
            6: [[4, 3.4], [8, 3.4], [4, 6], [8, 6], [4, 8.6], [8, 8.6]]
        }
        for (const [x, y] of pips[n]!) circle(ctx, x, y, 0.95, n === 1 ? '#dc2626' : INK)
    }))

    const flame = flat('flame', 16, 26, 8, 2, (ctx) => {
        const g = ctx.createLinearGradient(0, 2, 0, 24)
        g.addColorStop(0, '#fff7c2')
        g.addColorStop(0.4, '#ffb020')
        g.addColorStop(1, 'rgba(255, 80, 40, 0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(3, 2)
        ctx.quadraticCurveTo(8, 34, 13, 2)
        ctx.closePath()
        ctx.fill()
    })
    const pointer = flat('pointer', 14, 14, 7, 12, (ctx) => {
        ctx.fillStyle = INK
        ctx.beginPath()
        ctx.moveTo(1, 1)
        ctx.lineTo(13, 1)
        ctx.lineTo(7, 13)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = PAL.chip
        ctx.beginPath()
        ctx.moveTo(3.2, 2.4)
        ctx.lineTo(10.8, 2.4)
        ctx.lineTo(7, 10)
        ctx.closePath()
        ctx.fill()
    })
    const stacks = (key: string, face: string, edge: string, spots: boolean) => [1, 2, 3, 4, 5, 6].map(n => flat(`${key}:${n}`, 16, 10 + n * 3, 8, 6 + n * 3, (ctx) => {
        const base = 6 + n * 3
        for (let i = 0; i < n; i++) {
            const y = base - i * 3
            ctx.fillStyle = INK
            ctx.beginPath()
            ctx.ellipse(8, y, 6.6, 3.4, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = i % 2 ? edge : face
            ctx.fillRect(2, y - 2.5, 12, 2.5)
            ctx.beginPath()
            ctx.ellipse(8, y - 0.2, 5.6, 2.4, 0, 0, Math.PI)
            ctx.fill()
            ctx.fillStyle = lighten(face, 0.15)
            ctx.beginPath()
            ctx.ellipse(8, y - 2.6, 5.6, 2.4, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = spots ? 'rgba(255,255,255,0.85)' : 'rgba(255,246,194,0.9)'
            ctx.lineWidth = 0.9
            if (spots) ctx.setLineDash([1.6, 1.8])
            ctx.beginPath()
            ctx.ellipse(8, y - 2.6, 4.4, 1.8, 0, 0, Math.PI * 2)
            ctx.stroke()
            ctx.setLineDash([])
        }
    }))
    const chipStacks = stacks('stack', PAL.chip, PAL.chipDark, true)
    const coinStacks = stacks('coinstack', PAL.coin, PAL.goldDark, false)
    const arrow = flat('arrow', 18, 16, 9, 15, (ctx) => {
        ctx.fillStyle = INK
        ctx.beginPath()
        ctx.moveTo(1, 1)
        ctx.lineTo(17, 1)
        ctx.lineTo(9, 15)
        ctx.closePath()
        ctx.fill()
        const g = ctx.createLinearGradient(0, 2, 0, 12)
        g.addColorStop(0, PAL.goldLight)
        g.addColorStop(1, darken(PAL.gold, 0.1))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(3.6, 2.6)
        ctx.lineTo(14.4, 2.6)
        ctx.lineTo(9, 12)
        ctx.closePath()
        ctx.fill()
    })
    return { glow, pool, coin, chip, confetti, sparkle, dust, cloud, shadow, ring, cross, emotes, symbols, dice, flame, pointer, chipStacks, coinStacks, arrow }
}
