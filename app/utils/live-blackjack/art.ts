import type { Graphics, Renderer, Texture } from 'pixi.js'
import { RANKS, SUITS, type Rank, type Suit } from '#shared/tables/cards'
import { CHIP_ART, PIP_LAYOUTS, shade, type ChipArt } from '~/utils/live-table/art'

/**
 * The old site's Pixi table art (app/utils/live-blackjack/art.ts), baked into
 * textures once. Same drawing; the chips are the casino's ladder (CHIP_ART).
 */

type Pixi = typeof import('pixi.js')

export const CARD_W = 112
export const CARD_H = 156
export const CHIP_R = 46

const SUIT_COLOR: Record<Suit, number> = {
    hearts: 0xc02434,
    diamonds: 0xc02434,
    clubs: 0x14181f,
    spades: 0x14181f
}

const CARD_FACE = 0xfbfaf6
const CARD_EDGE = 0xc8c3b4
const SERIF = 'Georgia, "Times New Roman", "DejaVu Serif", serif'

/**
 * Suits are drawn as vector paths rather than unicode glyphs: ♣ and ♠ fall back
 * to wildly different shapes across platforms, and these have to read the same
 * for everyone at the table.
 */
function drawSuit(g: Graphics, suit: Suit, x: number, y: number, size: number, color: number) {
    const s = size
    switch (suit) {
        case 'hearts':
            g.moveTo(x, y + 0.75 * s)
            g.bezierCurveTo(x - 1.1 * s, y + 0.05 * s, x - 0.6 * s, y - 0.85 * s, x, y - 0.25 * s)
            g.bezierCurveTo(x + 0.6 * s, y - 0.85 * s, x + 1.1 * s, y + 0.05 * s, x, y + 0.75 * s)
            g.fill(color)
            break
        case 'diamonds':
            g.moveTo(x, y - 0.9 * s)
            g.lineTo(x + 0.66 * s, y)
            g.lineTo(x, y + 0.9 * s)
            g.lineTo(x - 0.66 * s, y)
            g.closePath()
            g.fill(color)
            break
        case 'spades':
            g.moveTo(x, y - 0.85 * s)
            g.bezierCurveTo(x + 0.55 * s, y - 0.2 * s, x + 1.05 * s, y + 0.15 * s, x + 0.42 * s, y + 0.5 * s)
            g.bezierCurveTo(x + 0.18 * s, y + 0.62 * s, x + 0.06 * s, y + 0.5 * s, x + 0.1 * s, y + 0.34 * s)
            g.lineTo(x + 0.34 * s, y + 0.86 * s)
            g.lineTo(x - 0.34 * s, y + 0.86 * s)
            g.lineTo(x - 0.1 * s, y + 0.34 * s)
            g.bezierCurveTo(x - 0.06 * s, y + 0.5 * s, x - 0.18 * s, y + 0.62 * s, x - 0.42 * s, y + 0.5 * s)
            g.bezierCurveTo(x - 1.05 * s, y + 0.15 * s, x - 0.55 * s, y - 0.2 * s, x, y - 0.85 * s)
            g.fill(color)
            break
        case 'clubs':
            g.circle(x, y - 0.4 * s, 0.37 * s)
            g.circle(x - 0.44 * s, y + 0.2 * s, 0.37 * s)
            g.circle(x + 0.44 * s, y + 0.2 * s, 0.37 * s)
            g.fill(color)
            g.moveTo(x - 0.3 * s, y + 0.88 * s)
            g.bezierCurveTo(x - 0.08 * s, y + 0.5 * s, x - 0.06 * s, y + 0.3 * s, x - 0.07 * s, y + 0.18 * s)
            g.lineTo(x + 0.07 * s, y + 0.18 * s)
            g.bezierCurveTo(x + 0.06 * s, y + 0.3 * s, x + 0.08 * s, y + 0.5 * s, x + 0.3 * s, y + 0.88 * s)
            g.closePath()
            g.fill(color)
            break
    }
}

function cornerIndex(PIXI: Pixi, rank: Rank, suit: Suit, color: number) {
    const box = new PIXI.Container()
    const label = new PIXI.Text({
        text: rank,
        style: {
            fontFamily: SERIF,
            fontSize: rank === '10' ? 24 : 27,
            fontWeight: '700',
            fill: color,
            align: 'center'
        }
    })
    label.anchor.set(0.5, 0)
    box.addChild(label)

    const pip = new PIXI.Graphics()
    drawSuit(pip, suit, 0, label.height + 11, 8.5, color)
    box.addChild(pip)
    return box
}

function courtPanel(PIXI: Pixi, rank: Rank, suit: Suit, color: number) {
    const box = new PIXI.Container()
    const bodyW = CARD_W - 34
    const bodyH = CARD_H - 44

    const frame = new PIXI.Graphics()
    frame.roundRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH, 5)
        .fill(0xfdfcf8)
        .stroke({ width: 1.6, color, alpha: 0.55 })
    // Court cards are mirrored top-to-bottom on a real deck; the diagonal split
    // is what sells that at a glance.
    frame.moveTo(-bodyW / 2, bodyH / 2).lineTo(bodyW / 2, -bodyH / 2)
        .stroke({ width: 1, color, alpha: 0.22 })
    box.addChild(frame)

    const letter = new PIXI.Text({
        text: rank,
        style: { fontFamily: SERIF, fontSize: 46, fontWeight: '700', fill: color }
    })
    letter.anchor.set(0.5)
    letter.position.set(0, 0)
    box.addChild(letter)

    const top = new PIXI.Graphics()
    drawSuit(top, suit, 0, -bodyH / 2 + 17, 11, color)
    box.addChild(top)

    const bottom = new PIXI.Graphics()
    drawSuit(bottom, suit, 0, 0, 11, color)
    bottom.position.set(0, bodyH / 2 - 17)
    bottom.rotation = Math.PI
    box.addChild(bottom)

    return box
}

function buildCardFace(PIXI: Pixi, rank: Rank, suit: Suit) {
    const color = SUIT_COLOR[suit]
    const card = new PIXI.Container()

    const base = new PIXI.Graphics()
    base.roundRect(0, 0, CARD_W, CARD_H, 9).fill(CARD_FACE).stroke({ width: 1.4, color: CARD_EDGE })
    card.addChild(base)

    if (rank === 'A') {
        const ace = new PIXI.Graphics()
        drawSuit(ace, suit, CARD_W / 2, CARD_H / 2, 34, color)
        card.addChild(ace)
    } else if (rank === 'J' || rank === 'Q' || rank === 'K') {
        const panel = courtPanel(PIXI, rank, suit, color)
        panel.position.set(CARD_W / 2, CARD_H / 2)
        card.addChild(panel)
    } else {
        const layout = PIP_LAYOUTS[rank] ?? []
        const left = 20
        const top = 26
        const width = CARD_W - left * 2
        const height = CARD_H - top * 2
        for (const [fx, fy] of layout) {
            const pip = new PIXI.Graphics()
            drawSuit(pip, suit, 0, 0, 11.5, color)
            pip.position.set(left + fx * width, top + fy * height)
            // Pips on the lower half sit upside down, exactly as on a real card.
            if (fy > 0.55) pip.rotation = Math.PI
            card.addChild(pip)
        }
    }

    const tl = cornerIndex(PIXI, rank, suit, color)
    tl.position.set(15, 8)
    card.addChild(tl)

    const br = cornerIndex(PIXI, rank, suit, color)
    br.position.set(CARD_W - 15, CARD_H - 8)
    br.rotation = Math.PI
    card.addChild(br)

    return card
}

function buildCardBack(PIXI: Pixi) {
    const card = new PIXI.Container()
    const base = new PIXI.Graphics()
    base.roundRect(0, 0, CARD_W, CARD_H, 9).fill(0xfbfaf6)
    base.roundRect(4, 4, CARD_W - 8, CARD_H - 8, 6).fill(0x8f1230)
    base.roundRect(9, 9, CARD_W - 18, CARD_H - 18, 4).stroke({ width: 1.4, color: 0xf0c674, alpha: 0.85 })
    card.addChild(base)

    const lattice = new PIXI.Graphics()
    const step = 13
    for (let y = 12; y < CARD_H - 12; y += step) {
        for (let x = 12; x < CARD_W - 12; x += step) {
            const off = ((y / step) | 0) % 2 ? step / 2 : 0
            const px = x + off
            if (px > CARD_W - 14) continue
            lattice.moveTo(px, y - 4)
            lattice.lineTo(px + 4, y)
            lattice.lineTo(px, y + 4)
            lattice.lineTo(px - 4, y)
            lattice.closePath()
        }
    }
    lattice.fill({ color: 0xf0c674, alpha: 0.2 })
    const mask = new PIXI.Graphics()
    mask.roundRect(10, 10, CARD_W - 20, CARD_H - 20, 4).fill(0xffffff)
    lattice.mask = mask
    card.addChild(mask)
    card.addChild(lattice)

    const medallion = new PIXI.Graphics()
    medallion.circle(CARD_W / 2, CARD_H / 2, 24).fill({ color: 0x6d0c24 })
    medallion.circle(CARD_W / 2, CARD_H / 2, 24).stroke({ width: 2, color: 0xf0c674, alpha: 0.9 })
    drawSuit(medallion, 'spades', CARD_W / 2, CARD_H / 2, 14, 0xf0c674)
    card.addChild(medallion)

    return card
}

/**
 * Chips are built from concentric rings plus a rim spot pattern that gets more
 * elaborate with the denomination, so a 100B plaque never reads as a 100 chip
 * at a glance.
 */
function buildChip(PIXI: Pixi, chip: ChipArt) {
    const box = new PIXI.Container()
    const r = CHIP_R
    const g = new PIXI.Graphics()

    g.circle(0, 3, r).fill({ color: 0x000000, alpha: 0.28 })
    g.circle(0, 0, r).fill(chip.base)
    g.circle(0, 0, r).stroke({ width: 2, color: shade(chip.base, -0.35) })

    // Rim spots: wedges drawn full-radius, then covered back to a band by the
    // inner disc — the same silhouette as the inlays on a real clay chip.
    const spots = chip.tier >= 3 ? 12 : chip.tier >= 1 ? 8 : 6
    const spotArc = Math.PI / spots / 1.9
    for (let i = 0; i < spots; i++) {
        const mid = (i / spots) * Math.PI * 2 - Math.PI / 2
        g.moveTo(0, 0)
        g.arc(0, 0, r, mid - spotArc, mid + spotArc)
        g.closePath()
    }
    g.fill(chip.edge)
    g.circle(0, 0, r * 0.79).fill(chip.base)
    box.addChild(g)

    const face = new PIXI.Graphics()
    face.circle(0, 0, r * 0.74).fill(shade(chip.base, 0.1))
    face.circle(0, 0, r * 0.74).stroke({ width: 2, color: chip.accent, alpha: 0.85 })
    face.circle(0, 0, r * 0.6).stroke({ width: 1.2, color: chip.edge, alpha: 0.6 })

    if (chip.tier >= 2) {
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2
            face.moveTo(Math.cos(a) * r * 0.64, Math.sin(a) * r * 0.64)
            face.lineTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7)
        }
        face.stroke({ width: 1.2, color: chip.accent, alpha: 0.5 })
    }
    if (chip.tier >= 3) {
        // Metallic sweep across the top-left, the way a polished plaque catches light.
        face.moveTo(-r * 0.72, -r * 0.2)
        face.arc(0, 0, r * 0.74, Math.PI * 1.08, Math.PI * 1.62)
        face.lineTo(r * 0.1, -r * 0.55)
        face.closePath()
        face.fill({ color: 0xffffff, alpha: 0.16 })
    }
    if (chip.tier >= 4) {
        const bands = [0xf87171, 0xfbbf24, 0x34d399, 0x60a5fa, 0xc084fc, 0xf472b6]
        for (let i = 0; i < bands.length; i++) {
            const a0 = (i / bands.length) * Math.PI * 2
            const a1 = ((i + 1) / bands.length) * Math.PI * 2
            face.moveTo(0, 0)
            face.arc(0, 0, r * 0.58, a0, a1)
            face.closePath()
            face.fill({ color: bands[i]!, alpha: 0.5 })
        }
        face.circle(0, 0, r * 0.44).fill({ color: chip.base, alpha: 0.92 })
    }
    box.addChild(face)

    const label = new PIXI.Text({
        text: chip.label,
        style: {
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            fontSize: chip.label.length > 3 ? 17 : 21,
            fontWeight: '800',
            fill: chip.text,
            letterSpacing: -0.4
        }
    })
    label.anchor.set(0.5)
    box.addChild(label)

    return box
}

export interface LbTextures {
    card: Map<string, Texture>
    back: Texture
    chip: Map<number, Texture>
    /** Bakes a few more of the not-yet-baked faces; returns true while some are left. */
    warm: (batch: number) => boolean
    /** Frees every baked texture (call before the renderer goes). */
    destroy: () => void
}

export function cardKey(rank: Rank, suit: Suit) {
    return `${rank}${suit[0]}`
}

/** A map that bakes a missing entry on first read. */
class LazyMap<K, V> extends Map<K, V> {
    constructor(private bake: (key: K) => V | undefined) {
        super()
    }

    override get(key: K): V | undefined {
        let value = super.get(key)
        if (value === undefined) {
            value = this.bake(key)
            if (value !== undefined) this.set(key, value)
        }
        return value
    }
}

/**
 * Cards and chips bake on first use (a deal never waits on 53 faces at once),
 * and `warm` fills in the rest a few per frame. `destroy` frees them all.
 */
export function buildTextures(PIXI: Pixi, renderer: Renderer): LbTextures {
    const make = (target: import('pixi.js').Container) =>
        renderer.generateTexture({ target, resolution: 2, antialias: true })

    const faces = new Map<string, { rank: Rank, suit: Suit }>()
    for (const suit of SUITS) {
        for (const rank of RANKS) faces.set(cardKey(rank, suit), { rank, suit })
    }
    const card = new LazyMap<string, Texture>((key) => {
        const def = faces.get(key)
        if (!def) return undefined
        const face = buildCardFace(PIXI, def.rank, def.suit)
        const texture = make(face)
        face.destroy({ children: true })
        return texture
    })
    const chips = new Map(CHIP_ART.map(def => [def.value, def]))
    const chip = new LazyMap<number, Texture>((value) => {
        const def = chips.get(value)
        if (!def) return undefined
        const built = buildChip(PIXI, def)
        const texture = make(built)
        built.destroy({ children: true })
        return texture
    })

    const backSprite = buildCardBack(PIXI)
    const back = make(backSprite)
    backSprite.destroy({ children: true })

    let destroyed = false
    return {
        card,
        back,
        chip,
        warm(batch) {
            if (destroyed) return false
            let left = batch
            for (const key of faces.keys()) {
                if (card.has(key)) continue
                card.get(key)
                if (--left <= 0) break
            }
            for (const value of chips.keys()) {
                if (!chip.has(value)) chip.get(value)
            }
            return [...faces.keys()].some(key => !card.has(key))
        },
        destroy() {
            destroyed = true
            for (const texture of card.values()) texture.destroy(true)
            for (const texture of chip.values()) texture.destroy(true)
            back.destroy(true)
            card.clear()
            chip.clear()
        }
    }
}
