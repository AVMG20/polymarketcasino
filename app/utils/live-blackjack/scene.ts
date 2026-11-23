import gsap from 'gsap'
import type { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import { formatCoins } from '#shared/money'
import { BJ_SIDE_BETS as LB_SIDE_BETS, type BjAction as LbAction, type BjHand as LbHand, type BjSideBet as LbSideBetKey, type BjSpot as LbBetSpot } from '#shared/tables/blackjack'
import type { BjSeat, BjShared } from '#shared/tables/blackjack-wire'
import { chipStack } from '#shared/tables/chips'
import type { SeatView, TableState } from '#shared/tables/protocol'
import { CARD_H, CARD_W, cardKey, type LbTextures } from './art'

/**
 * The old site's Pixi blackjack table (app/utils/live-blackjack/scene.ts):
 * felt, shoe and discard, the house's chips, seats with stacked bets, cards
 * dealt from the shoe, the hole card turning over and chips flying at payout.
 * Plumbing changed for the casino's snapshot (`TableState<BjSeat, BjShared>`),
 * and the chip rack moved off the canvas into the control band, where it
 * stays thumb-sized on a phone: a click on a spot places the band's chip.
 */
type LbTableState = TableState<BjSeat, BjShared>
type LbSeat = SeatView<BjSeat>

type Pixi = typeof import('pixi.js')

export const STAGE_W = 1600
// Tall enough that the middle seat's nameplate and side bet spots clear the
// action controls, which sit at a fixed percentage up from the bottom.
export const STAGE_H = 980

const FELT_HI = 0x1d8a55
const FELT = 0x116b43
const FELT_LO = 0x083a24
const RAIL_HI = 0x74452a
const RAIL_LO = 0x2a170c
const WOOD = 0x8a5a2e
const GOLD = 0xd9b167

const DEALER_POS = { x: 800, y: 196 }
/**
 * The shoe is a side-on block of cards, laid along the top rail so it drains
 * toward the cut card horizontally; the discard tray opposite fills by the same
 * amount. Both used to sit at mid-table height, where the outermost seats' cards
 * reached them.
 */
const SHOE_POS = { x: 1330, y: 140 }
const SHOE_STACK = { width: 188, height: 96 }
const DISCARD_POS = { x: 270, y: 140 }
// Below the discard tray and left of the dealer's fan, which is centred on
// DEALER_POS and grows both ways — seven cards reach x=606.
const DEALER_BANK_POS = { x: 400, y: 320 }

// 296 apart rather than 274: the felt has the room, and the extra 22 is what
// keeps one seat's side bet spots off the next seat's.
export const SEAT_LAYOUT = [
    { x: 208, y: 546 },
    { x: 504, y: 604 },
    { x: 800, y: 630 },
    { x: 1096, y: 604 },
    { x: 1392, y: 546 }
] as const

const SEAT_WIDTH = 272
const HAND_Y_OFFSET = -100
/** Between the cards and the chips, clear of a full stack of either. */
const HAND_BADGE_Y = 0
export const BET_Y_OFFSET = 106
/**
 * Split hands are drawn smaller, which frees a band above them. The stakes and
 * score badges rise into it so they are not crowding the side bet spots.
 */
const SPLIT_LIFT = 24
/** A taller stack than this reaches up into the hand's score badge. */
const MAX_STAKE_CHIPS = 8
// Dropped far enough to leave a clear row between the main stake's total and
// the plate, which is where a side bet's outcome goes.
export const PLATE_Y_OFFSET = 226
/**
 * Side bet outcomes and insurance. Directly under the spot they belong to, and
 * below the split stakes' totals so a three-way split cannot reach them.
 */
const RESULT_Y_OFFSET = 180

interface CardTarget {
    id: string
    key: string | null
    x: number
    y: number
    rotation: number
    scale: number
    order: number
    alpha: number
}

interface LiveCard {
    sprite: Sprite
    key: string | null
    x: number
    y: number
    rotation: number
    scale: number
    alpha: number
    /**
     * The move currently in flight, cleared when it lands. gsap.isTweening()
     * cannot stand in for this: it reports false both in the frame a tween is
     * created and for the whole of a staggered deal's delay.
     */
    moving: gsap.core.Tween | null
}

/**
 * The nameplates, open seats and the phase banner are DOM over the canvas
 * (LiveTablePlate, LiveTableSit, LiveTablePhase), the same as every table.
 */
export interface LbSceneCallbacks {
    /** A bet spot was clicked; the band's selected chip goes on it. */
    onPlace: (spot: LbBetSpot) => void
}

/** Short caps that fit inside a 28px spot. */
const SIDE_SPOT_LABELS: Record<LbSideBetKey, string> = {
    perfectPairs: 'PP',
    twentyOnePlusThree: '21+3'
}

/**
 * Flanking the main circle, clear of its ring at r=56 and of the neighbouring
 * seat, which sits 274 away.
 */
const SIDE_SPOT_X: Record<LbSideBetKey, number> = {
    perfectPairs: -96,
    twentyOnePlusThree: 96
}

const SIDE_SPOT_R = 28
/** Below the main circle's row, so each spot sits close to its own result. */
const SIDE_SPOT_Y_OFFSET = 134

/** Colour-coded so a glance across the table tells you what someone did. */
const ACTION_FLASH: Record<LbAction, { text: string, color: number }> = {
    hit: { text: 'HIT', color: 0x2563eb },
    stand: { text: 'STAND', color: 0x475569 },
    double: { text: 'DOUBLE', color: 0x15803d },
    split: { text: 'SPLIT', color: 0x7c3aed },
    surrender: { text: 'SURRENDER', color: 0xb45309 }
}

/**
 * Pixi nulls a destroyed object's transform, so any tween still pointing at one
 * writes into null on its next tick. Two tweens on the same sprite is the usual
 * way in — one finishes and destroys it while the other is still running — and a
 * hidden tab makes it certain, because the ticker stops while snapshots keep
 * arriving and the orphans all resume at once.
 */
function killAndDestroy(target: Container, options?: boolean | { children?: boolean }) {
    if (target.destroyed) return
    gsap.killTweensOf(target)
    gsap.killTweensOf(target.scale)
    gsap.killTweensOf(target.position)
    target.destroy(options)
}

/** A hidden tab gets no animation: nothing is watching, and every queued tween is a liability. */
const animating = () => typeof document === 'undefined' || !document.hidden

/** Just inside the side bet spots, whose inner edge is 68 from the seat centre. */
const TIMER_R = 62

/**
 * Whose clock the current one actually is. Betting and insurance run a single
 * timer against everyone still to act, so the ring belongs on all of them —
 * without this the only seat that ever showed one was the player in turn.
 */
function waitingSeats(state: LbTableState): number[] {
    const seats = state.seats.filter(seat => !!seat)
    if (state.phase === 'playing') return state.game.activeSeat === null ? [] : [state.game.activeSeat]
    if (state.phase === 'betting') return seats.filter(s => s.game.pendingBet === 0).map(s => s.index)
    if (state.phase === 'insurance') {
        return seats.filter(s => s.game.hands.length && !s.game.insuranceDecided).map(s => s.index)
    }
    return []
}

/** Hands share a seat's width, so more of them means smaller cards. */
function handScale(handCount: number): number {
    return handCount === 1 ? 0.92 : handCount === 2 ? 0.66 : 0.48
}

/** Width a fanned hand occupies, matching how layoutSeat places the cards. */
function handWidth(cardCount: number, scale: number): number {
    return CARD_W * scale + Math.max(0, cardCount - 1) * 30 * scale
}

/** A soft total reads both ways, 7/17, until it reaches 21. */
const scoreText = (score: number, soft: boolean) => (soft && score < 21 ? `${score - 10}/${score}` : String(score))

const label = (PIXI: Pixi, text: string, size: number, color: number, weight: '400' | '600' | '700' | '800' = '600') =>
    new PIXI.Text({
        text,
        style: {
            // The casino's game font (one weight); the page loads it before the scene starts.
            fontFamily: weight === '400' || weight === '600' ? 'Fredoka, system-ui, sans-serif' : '"Lilita One", Fredoka, system-ui, sans-serif',
            fontSize: size,
            fontWeight: weight === '400' || weight === '600' ? weight : '400',
            letterSpacing: weight === '400' || weight === '600' ? 0 : 1,
            fill: color
        }
    })

export class LiveBlackjackScene {
    private felt: Container
    /** Bet spots live under the chips, the way a painted felt circle does. */
    private spotLayer: Container
    private cardLayer: Container
    private chipLayer: Container
    private uiLayer: Container
    private flashLayer: Container

    private cards = new Map<string, LiveCard>()
    /** Sprites on their way to the discard tray, already out of `cards`. */
    private discarding = new Set<Sprite>()
    private seatNodes: SeatNode[] = []
    private dealerScore: Container
    private dealerScoreText!: Text
    private timerArc: Graphics
    private shoeStack!: Graphics

    private state: LbTableState | null = null
    private dealtOrder = 0
    /** Rounds whose chips have already flown, so each settlement fires once. */
    private settledRound = -1
    private sideSettledRound = -1
    /** serverNow - clientNow, so countdowns stay honest on a drifting clock. */
    private clockSkew = 0
    /** Moments already celebrated (a blackjack, a 21, a bust), so each fires once. */
    private moments = new Set<string>()
    private momentsRound = -1
    private lastDealerText = ''

    constructor(
        private PIXI: Pixi,
        private app: Application,
        private tex: LbTextures,
        private callbacks: LbSceneCallbacks
    ) {
        this.felt = new PIXI.Container()
        this.spotLayer = new PIXI.Container()
        this.chipLayer = new PIXI.Container()
        this.cardLayer = new PIXI.Container()
        this.uiLayer = new PIXI.Container()
        // Above everything: seat badges are rebuilt on every snapshot and would
        // otherwise be drawn over the flash mid-animation.
        this.flashLayer = new PIXI.Container()
        app.stage.addChild(
            this.felt, this.spotLayer, this.chipLayer, this.cardLayer,
            this.uiLayer, this.flashLayer
        )

        this.drawTable()
        this.seatNodes = SEAT_LAYOUT.map((pos, i) => new SeatNode(
            PIXI, this.uiLayer, this.chipLayer, this.spotLayer, i, pos,
            spot => this.placeOnSpot(spot)
        ))

        this.dealerScore = this.buildDealerBadge()
        this.dealerScore.position.set(DEALER_POS.x, DEALER_POS.y + 118)
        this.uiLayer.addChild(this.dealerScore)

        // Under the chips: a split fans its stacks out across the ring, and a
        // gold stroke cutting through them reads as the chips being clipped.
        this.timerArc = new PIXI.Graphics()
        this.spotLayer.addChild(this.timerArc)

        app.ticker.add(this.tick)
    }

    // ─── static table art ──────────────────────────────────────────────────

    private drawTable() {
        const g = new this.PIXI.Graphics()
        const { FillGradient } = this.PIXI

        g.roundRect(0, 0, STAGE_W, STAGE_H, 0).fill(0x120c08)
        // A wooden trim, then the padded leather rail with light on its top edge.
        g.roundRect(14, 24, STAGE_W - 28, 940, 200).fill(WOOD).stroke({ width: 4, color: 0x1a0d06 })
        g.roundRect(24, 34, STAGE_W - 48, 920, 190).fill(new FillGradient({
            type: 'linear',
            start: { x: 0, y: 0 },
            end: { x: 0, y: 1 },
            colorStops: [{ offset: 0, color: RAIL_HI }, { offset: 0.5, color: 0x4a2a17 }, { offset: 1, color: RAIL_LO }],
            textureSpace: 'local'
        }))
        g.roundRect(26, 36, STAGE_W - 52, 916, 188).stroke({ width: 3, color: 0xffdeaa, alpha: 0.18 })
        // The stitching along the rail.
        this.drawStitches(g, 35, 45, STAGE_W - 70, 898, 180)
        // The felt, sunk into the rail, lit from above the dealer.
        g.roundRect(50, 60, STAGE_W - 100, 868, 170).fill({ color: 0x000000, alpha: 0.5 })
        g.roundRect(54, 64, STAGE_W - 108, 860, 166).fill(new FillGradient({
            type: 'radial',
            center: { x: 0.5, y: 0.3 },
            innerRadius: 0,
            outerCenter: { x: 0.5, y: 0.3 },
            outerRadius: 0.75,
            colorStops: [{ offset: 0, color: FELT_HI }, { offset: 0.5, color: FELT }, { offset: 1, color: FELT_LO }],
            textureSpace: 'local'
        }))
        // A soft vignette where the felt meets the rail.
        for (let i = 0; i < 6; i++) {
            const inset = 54 + i * 7
            g.roundRect(inset, inset + 10, STAGE_W - inset * 2, 860 - (inset - 54) * 2, 166 - i * 7).stroke({ width: 8, color: 0x000000, alpha: 0.09 - i * 0.012 })
        }

        // Dealer arc and the payout legend that sits on every real table.
        // arc() draws a line in from the last point, so each one starts its
        // own subpath at the arc's first point.
        const dealerArc = (radius: number, from: number, to: number) => {
            g.moveTo(DEALER_POS.x + Math.cos(from) * radius, 40 + Math.sin(from) * radius)
            g.arc(DEALER_POS.x, 40, radius, from, to)
        }
        dealerArc(470, 0.18 * Math.PI, 0.82 * Math.PI)
        g.stroke({ width: 3, color: GOLD, alpha: 0.35 })
        dealerArc(486, 0.19 * Math.PI, 0.81 * Math.PI)
        g.stroke({ width: 1.5, color: GOLD, alpha: 0.2 })

        for (const seat of SEAT_LAYOUT) {
            g.circle(seat.x, seat.y + BET_Y_OFFSET, 48).stroke({ width: 2.5, color: GOLD, alpha: 0.4 })
            g.circle(seat.x, seat.y + BET_Y_OFFSET, 41).stroke({ width: 1, color: GOLD, alpha: 0.22 })
        }

        // Empty trays; the card stacks inside them are redrawn as the shoe drains.
        for (const pos of [SHOE_POS, DISCARD_POS]) {
            g.roundRect(
                pos.x - SHOE_STACK.width / 2 - 8,
                pos.y - SHOE_STACK.height / 2 - 8,
                SHOE_STACK.width + 16,
                SHOE_STACK.height + 16,
                8
            ).fill(0x1b1009).stroke({ width: 2, color: GOLD, alpha: 0.45 })
        }

        this.felt.addChild(g)
        // After the felt graphics is in the display list, or the tray it draws
        // would paint straight over the chips standing in it.
        this.drawDealerBank(g)

        // Single legend line: the countdown now owns the space the second one had.
        const rules = label(this.PIXI, 'BLACKJACK PAYS 3 TO 2  ·  DEALER STANDS ON ALL 17', 19, GOLD, '700')
        rules.anchor.set(0.5)
        rules.alpha = 0.7
        rules.position.set(DEALER_POS.x, 432)
        this.felt.addChild(rules)

        const labelY = SHOE_POS.y + SHOE_STACK.height / 2 + 26
        const shoeLabel = label(this.PIXI, 'SHOE', 14, GOLD, '700')
        shoeLabel.anchor.set(0.5)
        shoeLabel.alpha = 0.75
        shoeLabel.position.set(SHOE_POS.x, labelY)
        this.felt.addChild(shoeLabel)

        const discardLabel = label(this.PIXI, 'DISCARD', 14, GOLD, '700')
        discardLabel.anchor.set(0.5)
        discardLabel.alpha = 0.6
        discardLabel.position.set(DISCARD_POS.x, labelY)
        this.felt.addChild(discardLabel)

        this.shoeStack = new this.PIXI.Graphics()
        this.uiLayer.addChild(this.shoeStack)
    }

    /** Short dashes around a rounded rectangle: the rail's stitching. */
    private drawStitches(g: Graphics, x: number, y: number, w: number, h: number, r: number) {
        const straight = [
            [x + r, y, x + w - r, y], [x + w, y + r, x + w, y + h - r],
            [x + w - r, y + h, x + r, y + h], [x, y + h - r, x, y + r]
        ] as const
        const DASH = 14
        const GAP = 10
        for (const [x0, y0, x1, y1] of straight) {
            const length = Math.hypot(x1 - x0, y1 - y0)
            for (let d = 0; d + DASH <= length; d += DASH + GAP) {
                const t0 = d / length
                const t1 = (d + DASH) / length
                g.moveTo(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0).lineTo(x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1)
            }
        }
        const corners = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]] as const
        const step = (DASH + GAP) / r
        for (const [cx, cy, start] of corners) {
            for (let a = start; a + DASH / r <= start + Math.PI / 2; a += step) {
                g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
                g.arc(cx, cy, r, a, a + DASH / r)
            }
        }
        g.stroke({ width: 2.5, color: 0xffd696, alpha: 0.3 })
    }

    /**
     * The house's chips. Purely decorative — it never grows or shrinks. It only
     * exists to give payouts somewhere to fly from and sweeps somewhere to go.
     */
    private drawDealerBank(g: Graphics) {
        const { x, y } = DEALER_BANK_POS
        // A shallow well the stacks stand in, rather than a panel behind them.
        g.ellipse(x, y + 34, 104, 20).fill({ color: 0x000000, alpha: 0.32 })
        g.roundRect(x - 104, y + 26, 208, 16, 8).fill(0x1b1009)
        g.roundRect(x - 104, y + 26, 208, 16, 8).stroke({ width: 2, color: GOLD, alpha: 0.4 })

        const stacks = [
            { value: 100, height: 7 },
            { value: 5_000, height: 11 },
            { value: 100_000, height: 9 },
            { value: 1_000, height: 5 }
        ]
        stacks.forEach((stack, s) => {
            const sx = x - 78 + s * 52
            for (let i = 0; i < stack.height; i++) {
                const sprite = new this.PIXI.Sprite(this.tex.chip.get(stack.value)!)
                sprite.anchor.set(0.5)
                sprite.scale.set(0.55)
                // Half a pixel of wobble per chip: a perfectly straight column
                // reads as one tall cylinder rather than chips.
                sprite.position.set(sx + (i % 2 ? 1 : -1), y + 28 - i * 8)
                this.felt.addChild(sprite)
            }
        })

        const caption = label(this.PIXI, 'HOUSE', 13, GOLD, '700')
        caption.anchor.set(0.5)
        caption.alpha = 0.6
        caption.position.set(x, y + 60)
        this.felt.addChild(caption)
    }

    /**
     * The shoe drawn as the block of cards still in it, draining down to the red
     * cut card. The discard tray opposite grows by whatever has left the shoe.
     */
    private drawShoe(dealt: number, total: number, untilShuffle: number) {
        const g = this.shoeStack
        g.clear()

        const remaining = Math.max(0, total - dealt)
        const half = SHOE_STACK.height / 2
        const step = SHOE_STACK.width / 42

        const drawBlock = (pos: { x: number, y: number }, cards: number, tint: number) => {
            const w = Math.round((cards / total) * SHOE_STACK.width)
            if (w <= 0) return
            const left = pos.x - SHOE_STACK.width / 2
            const top = pos.y - half
            g.roundRect(left, top, w, SHOE_STACK.height, 3).fill(tint)
            // One line per few cards reads as a stack rather than a solid slab.
            for (let x = left + step; x < left + w - 1; x += step) {
                g.moveTo(x, top + 4)
                g.lineTo(x, top + SHOE_STACK.height - 4)
            }
            g.stroke({ width: 1, color: 0x000000, alpha: 0.22 })
        }

        drawBlock(SHOE_POS, remaining, 0x8f1230)
        drawBlock(DISCARD_POS, dealt, 0x4a3520)

        // Cut card: once the stack drains past it the shoe is reshuffled.
        const cutWidth = Math.round((Math.max(0, remaining - untilShuffle) / total) * SHOE_STACK.width)
        if (remaining > 0) {
            const x = SHOE_POS.x - SHOE_STACK.width / 2 + cutWidth
            g.moveTo(x, SHOE_POS.y - half - 6)
            g.lineTo(x, SHOE_POS.y + half + 6)
            g.stroke({ width: 4, color: 0xf1c40f, alpha: 0.95 })
        }
    }

    private buildDealerBadge(): Container {
        const box = new this.PIXI.Container()
        const bg = new this.PIXI.Graphics()
        bg.roundRect(-52, -21, 104, 46, 23).fill({ color: 0x000000, alpha: 0.4 })
        bg.roundRect(-52, -25, 104, 46, 23).fill({ color: 0x1f1109, alpha: 0.96 })
        bg.roundRect(-52, -25, 104, 46, 23).stroke({ width: 2.5, color: GOLD, alpha: 0.75 })
        box.addChild(bg)
        this.dealerScoreText = label(this.PIXI, '', 28, 0xfff7ea, '700')
        this.dealerScoreText.y = -2
        this.dealerScoreText.anchor.set(0.5)
        box.addChild(this.dealerScoreText)
        box.visible = false
        return box
    }

    private placeOnSpot(spot: LbBetSpot) {
        this.callbacks.onPlace(spot)
    }

    // ─── per-frame timer ring ──────────────────────────────────────────────

    private tick = () => {
        const state = this.state
        this.timerArc.clear()
        if (!state?.phaseEndsAt) return

        // The server sends how long the phase runs, so this no longer has to
        // keep its own copy of every timer.
        const total = state.phaseDuration ?? 0
        if (total <= 0 || state.phase === 'dealing') return
        const left = Math.max(0, state.phaseEndsAt - (Date.now() + this.clockSkew))
        const frac = Math.max(0, Math.min(1, left / total))
        if (frac <= 0) return

        const color = frac < 0.28 ? 0xef4444 : GOLD
        for (const index of waitingSeats(state)) {
            const pos = SEAT_LAYOUT[index]!
            const y = pos.y + BET_Y_OFFSET
            // arc() would draw a line in from wherever the last one ended, so
            // every ring has to start its own subpath.
            this.timerArc.moveTo(pos.x, y - TIMER_R)
            this.timerArc.arc(pos.x, y, TIMER_R, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
            this.timerArc.stroke({ width: 7, color, alpha: 0.95, cap: 'round' })
        }
    }

    // ─── state application ─────────────────────────────────────────────────

    update(state: LbTableState, youId: string | null) {
        this.clockSkew = state.now - Date.now()
        if (this.state?.roundId !== state.roundId) this.dealtOrder = 0
        this.state = state

        this.drawShoe(state.game.shoe.dealt, state.game.shoe.total, state.game.shoe.untilShuffle)

        this.dealerScore.visible = state.game.dealer.cards.length > 0
        const dealer = state.game.dealer
        const dealerText = dealer.blackjack ? 'BJ' : dealer.busted ? 'BUST' : scoreText(dealer.score, dealer.soft)
        this.dealerScoreText.text = dealerText
        this.dealerScoreText.style.fill = dealer.busted ? 0xff8a9a : 0xfff7ea
        // The total ticks: every new value lands with a little pop.
        if (dealerText !== this.lastDealerText && this.dealerScore.visible && animating()) {
            gsap.fromTo(this.dealerScore.scale, { x: 1.3, y: 1.3 }, { x: 1, y: 1, duration: 0.32, ease: 'back.out(3)', overwrite: true })
        }
        this.lastDealerText = dealerText

        const targets: CardTarget[] = []
        this.layoutDealer(state, targets)
        for (let i = 0; i < this.seatNodes.length; i++) {
            const node = this.seatNodes[i]!
            node.update(state, state.seats[i] ?? null, youId, this.tex)
            this.layoutSeat(state, i, targets)
        }
        this.syncCards(targets)
        this.celebrate(state)
        this.settleSideChips(state)
        this.settleChips(state)
    }

    /**
     * The moments of a hand, each once: a blackjack gets a gold starburst, a
     * drawn 21 a smaller one, and a bust shakes the cards with a red stamp.
     */
    private celebrate(state: LbTableState) {
        if (state.roundId !== this.momentsRound) {
            this.moments.clear()
            this.momentsRound = state.roundId
        }
        const once = (key: string) => {
            if (this.moments.has(key)) return false
            this.moments.add(key)
            return true
        }
        for (const seat of state.seats) {
            if (!seat) continue
            const pos = SEAT_LAYOUT[seat.index]!
            const hands = seat.game.hands
            hands.forEach((hand, h) => {
                const x = pos.x + (h - (hands.length - 1) / 2) * (SEAT_WIDTH / hands.length)
                const y = pos.y + HAND_Y_OFFSET
                const key = `${seat.index}-${h}`
                if (hand.status === 'blackjack' && once(`${key}-bj`)) this.burst(x, y, 'BLACKJACK!', 0xffc93a, 1)
                else if (hand.status === 'busted' && once(`${key}-bust`)) this.bust(hand.cards.map(c => c.id), x, y)
                else if (hand.score === 21 && hand.status !== 'blackjack' && once(`${key}-21`)) this.burst(x, y, '21!', 0x7ee08f, 0.75)
            })
        }
        const dealer = state.game.dealer
        if (dealer.blackjack && once('dealer-bj')) this.burst(DEALER_POS.x, DEALER_POS.y, 'BLACKJACK', 0xffc93a, 0.9)
        else if (dealer.busted && once('dealer-bust')) this.bust(dealer.cards.map(c => c.id), DEALER_POS.x, DEALER_POS.y)
    }

    /** A starburst of rays behind a word that slams in and floats off. */
    private burst(x: number, y: number, text: string, color: number, size: number) {
        if (!animating()) return
        const box = new this.PIXI.Container()
        box.position.set(x, y)
        const rays = new this.PIXI.Graphics()
        const count = 14
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2
            const b = a + Math.PI / count * 0.55
            rays.moveTo(0, 0).lineTo(Math.cos(a) * 150, Math.sin(a) * 150).lineTo(Math.cos(b) * 150, Math.sin(b) * 150).closePath()
        }
        rays.fill({ color, alpha: 0.32 })
        rays.circle(0, 0, 54).fill({ color, alpha: 0.35 })
        const word = new this.PIXI.Text({
            text,
            style: {
                fontFamily: '"Lilita One", Fredoka, system-ui, sans-serif',
                fontSize: 46 * size,
                letterSpacing: 2,
                fill: 0xffffff,
                stroke: { color: 0x5a3200, width: 7, join: 'round' },
                dropShadow: { color: color, blur: 12, distance: 0, alpha: 0.9 }
            }
        })
        word.anchor.set(0.5)
        box.addChild(rays, word)
        box.scale.set(0.3)
        this.flashLayer.addChild(box)
        const spin = { r: 0 }
        gsap.timeline({ onComplete: () => killAndDestroy(box, { children: true }) })
            .to(box.scale, { x: 1, y: 1, duration: 0.36, ease: 'back.out(2.6)' })
            .to(spin, { r: 0.6, duration: 1.5, ease: 'none', onUpdate: () => { if (!rays.destroyed) rays.rotation = spin.r } }, 0)
            .to(box, { alpha: 0, duration: 0.35 }, 1.15)
            .to(box.position, { y: y - 30, duration: 0.5, ease: 'power1.in' }, 1.0)
    }

    /** A bust: the hand's cards shudder and a red stamp drops on them. */
    private bust(cardIds: string[], x: number, y: number) {
        if (!animating()) return
        for (const id of cardIds) {
            const sprite = this.cards.get(id)?.sprite
            if (!sprite) continue
            const shake = { t: 0 }
            gsap.to(shake, {
                t: 1,
                duration: 0.42,
                ease: 'none',
                onUpdate: () => {
                    if (sprite.destroyed) return
                    sprite.pivot.x = Math.sin(shake.t * Math.PI * 7) * 9 * (1 - shake.t)
                },
                onComplete: () => { if (!sprite.destroyed) sprite.pivot.x = 0 }
            })
        }
        const box = new this.PIXI.Container()
        const word = label(this.PIXI, 'BUST', 30, 0xffffff, '800')
        word.anchor.set(0.5)
        const w = word.width + 34
        const bg = new this.PIXI.Graphics()
        bg.roundRect(-w / 2, -24, w, 48, 14).fill(0xd62f4b).stroke({ width: 3, color: 0xffffff, alpha: 0.9 })
        box.addChild(bg, word)
        box.position.set(x, y)
        box.rotation = -0.12
        box.scale.set(2)
        box.alpha = 0
        this.flashLayer.addChild(box)
        gsap.timeline({ onComplete: () => killAndDestroy(box, { children: true }) })
            .to(box, { alpha: 1, duration: 0.08 })
            .to(box.scale, { x: 1, y: 1, duration: 0.22, ease: 'power3.in' }, 0)
            .to(box, { alpha: 0, duration: 0.3 }, 1.1)
    }

    private layoutDealer(state: LbTableState, out: CardTarget[]) {
        const cards = state.game.dealer.cards
        const gap = 46
        const width = cards.length ? CARD_W + (cards.length - 1) * gap : 0
        const startX = DEALER_POS.x - width / 2 + CARD_W / 2
        cards.forEach((card, i) => {
            out.push({
                id: card.id,
                key: card.hidden || !card.rank || !card.suit ? null : cardKey(card.rank, card.suit),
                x: startX + i * gap,
                y: DEALER_POS.y,
                rotation: 0,
                scale: 1,
                order: i,
                alpha: 1
            })
        })
    }

    private layoutSeat(state: LbTableState, index: number, out: CardTarget[]) {
        const seat = state.seats[index]
        if (!seat?.game.hands.length) return
        const pos = SEAT_LAYOUT[index]!
        const hands = seat.game.hands
        const scale = handScale(hands.length)
        const slot = SEAT_WIDTH / hands.length
        // With split hands it has to be obvious which one the buttons apply to,
        // so the hand in play keeps full colour and its siblings fade back.
        const activeHand = state.game.activeSeat === index ? state.game.activeHand : null
        const dimSiblings = activeHand !== null && hands.length > 1

        hands.forEach((hand, h) => {
            const centerX = pos.x + (h - (hands.length - 1) / 2) * slot
            const gap = 30 * scale
            const width = handWidth(hand.cards.length, scale)
            const startX = centerX - width / 2 + (CARD_W * scale) / 2
            hand.cards.forEach((card, i) => {
                out.push({
                    id: card.id,
                    key: card.hidden || !card.rank || !card.suit ? null : cardKey(card.rank, card.suit),
                    x: startX + i * gap,
                    y: pos.y + HAND_Y_OFFSET - i * 4 * scale,
                    rotation: (i - (hand.cards.length - 1) / 2) * 0.026,
                    scale,
                    order: 10 + index + h * 5 + i * 5,
                    alpha: dimSiblings && h !== activeHand ? 0.45 : 1
                })
            })
        })
    }

    private syncCards(targets: CardTarget[]) {
        const seen = new Set<string>()

        for (const target of targets) {
            seen.add(target.id)
            const existing = this.cards.get(target.id)

            if (!existing) {
                const texture = target.key ? this.tex.card.get(target.key)! : this.tex.back
                const sprite = new this.PIXI.Sprite(texture)
                sprite.anchor.set(0.5)
                sprite.position.set(SHOE_POS.x, SHOE_POS.y)
                sprite.scale.set(target.scale)
                sprite.rotation = -0.5
                sprite.alpha = target.alpha
                this.cardLayer.addChild(sprite)
                const card: LiveCard = { sprite, ...target, moving: null }
                this.cards.set(target.id, card)

                if (!animating()) {
                    sprite.position.set(target.x, target.y)
                    sprite.rotation = target.rotation
                    continue
                }

                // Only the opening deal is staggered; a mid-turn hit should land
                // the instant the player asked for it.
                const delay = this.state?.phase === 'dealing'
                    ? Math.min(0.55, this.dealtOrder++ * 0.1)
                    : 0
                card.moving = gsap.to(sprite, {
                    x: target.x,
                    y: target.y,
                    rotation: target.rotation,
                    duration: 0.42,
                    delay,
                    ease: 'power2.out',
                    overwrite: 'auto',
                    // A tween killed by a later one never completes, so the
                    // in-flight marker has to clear on both endings.
                    onComplete: () => { card.moving = null },
                    onInterrupt: () => { card.moving = null }
                })
                continue
            }

            // Hole card turning over: squash to nothing, swap face, spring back.
            if (existing.key !== target.key) {
                existing.key = target.key
                const texture = target.key ? this.tex.card.get(target.key)! : this.tex.back
                if (!animating()) {
                    existing.sprite.texture = texture
                } else {
                    // The hole card is a small moment: it lifts, turns, and lands
                    // with a flash of gold behind it.
                    const lift = target.key && existing.y === DEALER_POS.y ? 1.14 : 1.06
                    gsap.to(existing.sprite.scale, { y: target.scale * lift, duration: 0.18, ease: 'power1.out' })
                    gsap.to(existing.sprite.scale, {
                        x: 0,
                        duration: 0.18,
                        ease: 'power2.in',
                        onComplete: () => {
                            // The round can end mid-flip, taking the sprite with it.
                            if (existing.sprite.destroyed) return
                            existing.sprite.texture = texture
                            if (lift > 1.1) this.flashBehind(existing.sprite.x, existing.sprite.y)
                            gsap.to(existing.sprite.scale, { x: target.scale, y: target.scale, duration: 0.3, ease: 'back.out(2.2)' })
                        }
                    })
                }
            }

            if (existing.alpha !== target.alpha) {
                if (animating()) gsap.to(existing.sprite, { alpha: target.alpha, duration: 0.2 })
                else existing.sprite.alpha = target.alpha
            }

            // Compare against where the sprite actually is, not only against the
            // target it was last given: a tween that was interrupted — by a
            // round ending mid-deal, or by a reconnect swapping the state out
            // from under it — otherwise leaves the card stranded at the shoe it
            // spawned on, and nothing ever moves it again.
            const moved = existing.x !== target.x || existing.y !== target.y || existing.scale !== target.scale
            const stranded = !existing.moving
                && (Math.abs(existing.sprite.x - target.x) > 0.5 || Math.abs(existing.sprite.y - target.y) > 0.5)

            if (stranded || !animating()) {
                gsap.killTweensOf(existing.sprite)
                gsap.killTweensOf(existing.sprite.scale)
                existing.moving = null
                existing.sprite.position.set(target.x, target.y)
                existing.sprite.rotation = target.rotation
                existing.sprite.scale.set(target.scale)
                existing.sprite.alpha = target.alpha
            } else if (moved) {
                existing.moving = gsap.to(existing.sprite, {
                    x: target.x,
                    y: target.y,
                    rotation: target.rotation,
                    duration: 0.26,
                    ease: 'power2.out',
                    overwrite: 'auto',
                    onComplete: () => { existing.moving = null },
                    onInterrupt: () => { existing.moving = null }
                })
                if (existing.scale !== target.scale) {
                    gsap.to(existing.sprite.scale, { x: target.scale, y: target.scale, duration: 0.26 })
                }
            }
            const { moving } = existing
            Object.assign(existing, target, { moving })
        }

        for (const [id, live] of this.cards.entries()) {
            if (seen.has(id)) continue
            this.cards.delete(id)

            // Nobody is watching a hidden tab, and a discard that cannot finish
            // leaves the sprite on the felt with a tween still pointing at it.
            if (!animating()) {
                killAndDestroy(live.sprite)
                continue
            }

            this.discarding.add(live.sprite)
            gsap.to(live.sprite, {
                x: DISCARD_POS.x,
                y: DISCARD_POS.y,
                rotation: 0.4,
                duration: 0.4,
                ease: 'power2.in',
                overwrite: 'auto',
                // killAndDestroy takes the sibling scale tween below with it,
                // which is the one that used to outlive the sprite.
                onComplete: () => {
                    this.discarding.delete(live.sprite)
                    killAndDestroy(live.sprite)
                }
            })
            gsap.to(live.sprite.scale, { x: 0.55, y: 0.55, duration: 0.4 })
        }

        // Removal takes a card out of the map before animating it away, so a
        // discard tween that never finishes leaves a sprite nothing is tracking
        // — not the map, not the targets. Only a sweep of the layer reaches
        // those, and without it they sit on the felt for the rest of the session.
        const tracked = new Set([...this.cards.values()].map(c => c.sprite))
        for (const child of [...this.cardLayer.children]) {
            const sprite = child as Sprite
            if (tracked.has(sprite) || this.discarding.has(sprite)) continue
            killAndDestroy(sprite)
        }
    }

    /**
     * Side bets are decided by the deal, not by how the hand plays, so the
     * house settles them right there — long before the main stake resolves.
     */
    private settleSideChips(state: LbTableState) {
        if (state.roundId === this.sideSettledRound) return
        if (!state.seats.some(seat => seat?.game.sideResults)) return
        this.sideSettledRound = state.roundId
        if (!animating()) return

        for (const seat of state.seats) {
            if (!seat?.game.sideResults) continue
            const pos = SEAT_LAYOUT[seat.index]!
            for (const side of seat.game.sideResults) {
                if (!side.stake) continue
                const spot = { x: pos.x + SIDE_SPOT_X[side.key], y: pos.y + SIDE_SPOT_Y_OFFSET }
                if (side.payout > 0) this.flyChips(DEALER_BANK_POS, spot, side.payout - side.stake)
                else this.flyChips(spot, DEALER_BANK_POS, side.stake)
            }
        }
    }

    /**
     * Chips crossing the felt at payout: the house pays winners, and sweeps the
     * losers. Fires once per round on the way into the payout phase.
     */
    private settleChips(state: LbTableState) {
        if (state.phase !== 'payout' || state.roundId === this.settledRound) return
        this.settledRound = state.roundId
        if (!animating()) return

        for (const seat of state.seats) {
            if (!seat) continue
            const pos = SEAT_LAYOUT[seat.index]!
            const lift = seat.game.hands.length > 1 ? SPLIT_LIFT : 0
            const main = { x: pos.x, y: pos.y + BET_Y_OFFSET - lift }

            // Winnings and losses are two separate journeys, not one netted
            // arrow: a player can lose one split hand and win another, and both
            // have to be seen to happen.
            let won = 0
            let lost = 0
            for (const hand of seat.game.hands) {
                if (hand.net === undefined || hand.net === 0) continue
                if (hand.net > 0) won += hand.net
                else lost -= hand.net
            }

            if (lost > 0) this.flyChips(main, DEALER_BANK_POS, lost)
            // Paid onto the main circle whatever it was won on, so there is one
            // place to look for money coming back.
            if (won > 0) this.flyChips(DEALER_BANK_POS, main, won)
        }
    }

    /**
     * The tween drives a plain object and the sprite is written from it, so no
     * tween ever holds the sprite's transform — the arc costs nothing in the
     * risk that two tweens on one chip would carry.
     */
    private flyChips(from: { x: number, y: number }, to: { x: number, y: number }, amount: number) {
        chipStack(amount, 7).forEach((chip, i) => {
            const sprite = new this.PIXI.Sprite(this.tex.chip.get(chip.value)!)
            sprite.anchor.set(0.5)
            sprite.scale.set(0.62)
            sprite.position.set(from.x, from.y - i * 8)
            // Over the cards: a payout crossing the felt is the moment of the
            // round and should not be read through a hand of cards.
            this.flashLayer.addChild(sprite)

            const endX = to.x + (i % 2 ? 5 : -5)
            const endY = to.y - i * 8
            const flight = { t: 0 }
            gsap.to(flight, {
                t: 1,
                duration: 0.72,
                delay: i * 0.09,
                ease: 'power1.inOut',
                onUpdate: () => {
                    if (sprite.destroyed) return
                    sprite.x = from.x + (endX - from.x) * flight.t
                    sprite.y = from.y - i * 8 + (endY - (from.y - i * 8)) * flight.t
                        - Math.sin(flight.t * Math.PI) * 74
                    sprite.rotation = flight.t * 1.4
                },
                onComplete: () => killAndDestroy(sprite)
            })
        })
    }

    /** A soft gold flash behind a card that just turned over. */
    private flashBehind(x: number, y: number) {
        const glow = new this.PIXI.Graphics()
        glow.roundRect(-CARD_W / 2 - 14, -CARD_H / 2 - 14, CARD_W + 28, CARD_H + 28, 20).fill({ color: 0xffd36b, alpha: 0.55 })
        glow.position.set(x, y)
        this.uiLayer.addChildAt(glow, 0)
        gsap.timeline({ onComplete: () => killAndDestroy(glow) })
            .fromTo(glow.scale, { x: 0.9, y: 0.9 }, { x: 1.25, y: 1.25, duration: 0.5, ease: 'power2.out' })
            .to(glow, { alpha: 0, duration: 0.5, ease: 'power1.in' }, 0)
    }

    /**
     * Stamp what a player just did over their hand. Fires for every seat, so the
     * table can follow each other's decisions rather than only seeing the cards
     * that result from them.
     */
    flashAction(seatIndex: number, action: string) {
        const pos = SEAT_LAYOUT[seatIndex]
        const style = ACTION_FLASH[action as LbAction]
        if (!pos || !style) return

        const box = new this.PIXI.Container()
        const text = label(this.PIXI, style.text, 19, 0xffffff, '800')
        text.anchor.set(0.5)
        const w = text.width + 30
        const bg = new this.PIXI.Graphics()
        bg.roundRect(-w / 2, -18, w, 36, 18).fill(style.color)
        bg.roundRect(-w / 2, -18, w, 36, 18).stroke({ width: 2, color: 0xffffff, alpha: 0.7 })
        box.addChild(bg, text)
        box.position.set(pos.x, pos.y + HAND_BADGE_Y)
        box.scale.set(0.4)
        this.flashLayer.addChild(box)

        gsap.timeline({ onComplete: () => killAndDestroy(box, { children: true }) })
            .to(box.scale, { x: 1, y: 1, duration: 0.24, ease: 'back.out(3)' })
            .to(box, { y: pos.y + HAND_BADGE_Y - 36, duration: 1.1, ease: 'power1.out' }, 0)
            .to(box, { alpha: 0, duration: 0.32 }, 0.86)
    }

    destroy() {
        this.app.ticker.remove(this.tick)
        // Cards on their way to the discard tray, and chips mid-flight between
        // the house and a seat, are tracked by nothing but the layer they sit on.
        gsap.killTweensOf(this.cardLayer.children)
        gsap.killTweensOf(this.chipLayer.children)
        gsap.killTweensOf(this.flashLayer.children)
        this.cards.clear()
        this.discarding.clear()
    }
}

/** Everything anchored to one seat on the canvas: bet spots, chips, per-hand badges. */
class SeatNode {
    private badges: Container[] = []
    /** What stood on each spot last, so a chip added to it drops on. */
    private chipAmounts = new Map<string, number>()
    /** What each hand's badge said last, so a changed total pops. */
    private badgeText = new Map<string, string>()
    private chipSprites: Sprite[] = []
    private ring: Graphics
    private mainSpot!: Container
    private sideSpots: { key: LbSideBetKey, node: Container, x: number }[] = []
    /** Side bet results already announced, so the pop fires once and not every frame. */
    private popped = new Set<string>()
    private poppedRound = -1

    constructor(
        private PIXI: Pixi,
        private uiLayer: Container,
        private chipLayer: Container,
        private spotLayer: Container,
        private index: number,
        private pos: { readonly x: number, readonly y: number },
        onSpot: (spot: LbBetSpot) => void
    ) {
        this.ring = new PIXI.Graphics()
        this.ring.circle(pos.x, pos.y + BET_Y_OFFSET, 56).stroke({ width: 4, color: GOLD, alpha: 0.9 })
        this.ring.visible = false
        spotLayer.addChild(this.ring)

        for (const key of LB_SIDE_BETS) {
            const x = pos.x + SIDE_SPOT_X[key]
            const y = pos.y + SIDE_SPOT_Y_OFFSET
            const node = new PIXI.Container()

            const ring = new PIXI.Graphics()
            ring.circle(0, 0, SIDE_SPOT_R).fill({ color: 0x000000, alpha: 0.28 })
            ring.circle(0, 0, SIDE_SPOT_R).stroke({ width: 2, color: GOLD, alpha: 0.5 })
            const caption = label(PIXI, SIDE_SPOT_LABELS[key], 13, GOLD, '800')
            caption.anchor.set(0.5)
            node.addChild(ring, caption)
            node.position.set(x, y)
            // Painted on the felt, so it is always there — only the chips come
            // and go, exactly like the main bet circle beside it.
            node.on('pointerdown', () => onSpot(key))
            node.on('pointerover', () => gsap.to(node.scale, { x: 1.14, y: 1.14, duration: 0.14 }))
            node.on('pointerout', () => gsap.to(node.scale, { x: 1, y: 1, duration: 0.14 }))
            spotLayer.addChild(node)
            this.sideSpots.push({ key, node, x })
        }

        // The main bet circle doubles as a drop target once you are seated.
        this.mainSpot = new PIXI.Container()
        const mainHit = new PIXI.Graphics()
        mainHit.circle(pos.x, pos.y + BET_Y_OFFSET, 56).fill({ color: 0xffffff, alpha: 0.001 })
        this.mainSpot.addChild(mainHit)
        this.mainSpot.visible = false
        this.mainSpot.on('pointerdown', () => onSpot('main'))
        uiLayer.addChild(this.mainSpot)
    }

    update(state: LbTableState, seat: LbSeat | null, youId: string | null, tex: LbTextures) {
        this.ring.visible = state.game.activeSeat === this.index

        // Tweens have to die with their target. Pixi nulls a destroyed object's
        // transform, so a tween still holding one writes into null on its next
        // tick — and a backgrounded tab pauses the ticker while snapshots keep
        // arriving, so they pile up and all throw at once when it resumes.
        for (const badge of this.badges) killAndDestroy(badge, { children: true })
        this.badges = []
        for (const chip of this.chipSprites) killAndDestroy(chip)
        this.chipSprites = []

        if (!seat) {
            for (const spot of this.sideSpots) spot.node.eventMode = 'none'
            this.mainSpot.visible = false
            return
        }

        const isYou = seat.playerId === youId

        const stakeSpots: { x: number, amount: number }[] = []
        const lift = seat.game.hands.length > 1 ? SPLIT_LIFT : 0
        if (seat.game.hands.length) {
            const slot = SEAT_WIDTH / seat.game.hands.length
            const activeHand = state.game.activeSeat === this.index ? state.game.activeHand : null
            seat.game.hands.forEach((hand, h) => {
                const x = this.pos.x + (h - (seat.game.hands.length - 1) / 2) * slot
                // Once settled the stack is what the hand returns, not what it
                // staked: a winning bet is paid beside itself, so 25K back on
                // 25K down stands as 50K. A losing one returns nothing and goes.
                const amount = hand.payout ?? (hand.doubled ? hand.bet * 2 : hand.bet)
                stakeSpots.push({ x, amount })
                const active = activeHand === h && seat.game.hands.length > 1
                if (active) this.addActiveHandMarker(x, hand.cards.length, seat.game.hands.length)
                this.addHandBadge(hand, x, state, active, lift, `${state.roundId}-${h}`)
            })
        } else if (seat.game.pendingBet > 0) {
            stakeSpots.push({ x: this.pos.x, amount: seat.game.pendingBet })
        }

        const betY = this.pos.y + BET_Y_OFFSET - lift
        stakeSpots.forEach((spot, i) => this.addChips(spot.x, betY, spot.amount, tex, 0.62, MAX_STAKE_CHIPS, this.chipLayer, `m${i}`))
        if (seat.game.insurance > 0) this.addInsuranceBadge(seat.game.insurance)
        this.updateSideSpots(state, seat, isYou, tex)
    }

    /**
     * Both side bets are settled off the opening two cards, so the spot itself
     * has done its job the moment the deal lands: it clears away and leaves the
     * outcome badge behind. That is what lets the spots sit against the main
     * circle where they belong — a split fans out over ground they have already
     * given up, however many hands it makes.
     */
    private updateSideSpots(
        state: LbTableState,
        seat: LbSeat,
        isYou: boolean,
        tex: LbTextures
    ) {
        const betting = state.phase === 'betting'
        if (state.roundId !== this.poppedRound) {
            this.popped.clear()
            this.poppedRound = state.roundId
        }

        for (const spot of this.sideSpots) {
            const stake = seat.game.pendingSide[spot.key] ?? 0
            const result = seat.game.sideResults?.find(r => r.key === spot.key) ?? null

            spot.node.eventMode = isYou && betting ? 'static' : 'none'
            spot.node.cursor = isYou && betting ? 'pointer' : 'default'

            // Side bets are settled off the deal, so they are paid or taken
            // there and then: a loser's chips go and leave the bare spot, a
            // winner's grow to what the bet returns.
            const chips = result ? result.payout : stake
            if (chips > 0) {
                this.addChips(spot.x, this.pos.y + SIDE_SPOT_Y_OFFSET, chips, tex, 0.42, 6, this.spotLayer, spot.key)
            }
            if (result && stake > 0) {
                // The badge is rebuilt on every snapshot, so the pop has to be
                // tied to the result rather than the rebuild or it restarts for
                // the whole payout phase.
                this.addSideResultBadge(spot.x, result, !this.popped.has(spot.key))
                this.popped.add(spot.key)
            }
        }

        this.mainSpot.visible = isYou && betting
        this.mainSpot.eventMode = isYou && betting ? 'static' : 'none'
        this.mainSpot.cursor = isYou && betting ? 'pointer' : 'default'
    }

    /**
     * Sits under its spot and outlives it, so it is the one thing left saying
     * what a side bet did once the spot itself has cleared.
     */
    private addSideResultBadge(
        x: number,
        result: { key: LbSideBetKey, payout: number, multiplier: number },
        pop: boolean
    ) {
        const won = result.payout > 0
        const box = new this.PIXI.Container()
        // Which bet it was, in front of what it did — two spots side by side
        // both saying only "MISS" tell you nothing about which one lost.
        const tag = label(this.PIXI, SIDE_SPOT_LABELS[result.key], 11, won ? 0x14532d : 0x64748b, '800')
        // The multiple is what the bet did; the amount alone reads as a payout
        // without saying whether it was a 6x pair or a 101x suited trips. Odds
        // are quoted to-one on the paytable, so the chip comes back as 1 + them.
        const value = label(
            this.PIXI,
            won ? `${1 + result.multiplier}x (${formatCoins(result.payout)})` : 'MISS',
            won ? 15 : 12,
            won ? 0x052e16 : 0x94a3b8,
            '800'
        )
        tag.anchor.set(0, 0.5)
        value.anchor.set(0, 0.5)
        const w = tag.width + value.width + 24
        tag.position.set(-w / 2 + 9, 0)
        value.position.set(tag.x + tag.width + 6, 0)

        const bg = new this.PIXI.Graphics()
        bg.roundRect(-w / 2, -11, w, 22, 11).fill({ color: won ? 0x4ade80 : 0x0b0806, alpha: won ? 1 : 0.8 })
        box.addChild(bg, tag, value)
        box.position.set(x, this.pos.y + RESULT_Y_OFFSET)
        this.uiLayer.addChild(box)
        this.badges.push(box)

        if (won && pop) {
            gsap.fromTo(box.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.42, ease: 'back.out(2.4)' })
        }
    }

    /**
     * A lit frame around the hand currently being played. Without it, a player
     * holding three split hands has no way to tell which one the buttons act on.
     */
    private addActiveHandMarker(x: number, cardCount: number, handCount: number) {
        const scale = handScale(handCount)
        const w = handWidth(cardCount, scale) + 22
        const h = CARD_H * scale + 26
        const box = new this.PIXI.Graphics()
        box.roundRect(x - w / 2, this.pos.y + HAND_Y_OFFSET - h / 2, w, h, 12)
            .fill({ color: GOLD, alpha: 0.12 })
            .stroke({ width: 3, color: GOLD, alpha: 0.95 })
        this.uiLayer.addChild(box)
        this.badges.push(box)
    }

    private addHandBadge(hand: LbHand, x: number, state: LbTableState, active = false, lift = 0, key = '') {
        const done = hand.net !== undefined && state.phase === 'payout'
        const text = done
            ? (hand.net === 0 ? 'PUSH' : `${hand.net! > 0 ? '+' : '−'}${formatCoins(Math.abs(hand.net!))}`)
            : hand.status === 'busted'
                ? 'BUST'
                : hand.status === 'blackjack'
                    ? 'BLACKJACK'
                    : hand.status === 'surrendered'
                        ? 'SURRENDER'
                        : scoreText(hand.score, hand.soft)

        // A win reads like every win in the casino: white on the chip's blue, gold edge.
        const tone = done
            ? (hand.net! > 0 ? 0x1d4ed8 : hand.net! < 0 ? 0x2e2020 : 0x34304a)
            : hand.status === 'busted'
                ? 0x8a1c2c
                : hand.status === 'blackjack'
                    ? 0xd99a00
                    : 0x1f1109
        const won = done && hand.net! > 0

        const box = new this.PIXI.Container()
        const value = label(this.PIXI, text, won ? 28 : 26, done && hand.net! < 0 ? 0xb8ab9c : 0xffffff, '800')
        value.anchor.set(0.5)
        value.y = -1
        const w = Math.max(74, value.width + 30)
        const bg = new this.PIXI.Graphics()
        if (won) bg.roundRect(-w / 2 - 7, -27, w + 14, 54, 27).fill({ color: 0xffc428, alpha: 0.35 })
        bg.roundRect(-w / 2, -16, w, 42, 21).fill({ color: 0x000000, alpha: 0.45 })
        bg.roundRect(-w / 2, -21, w, 42, 21).fill({ color: tone, alpha: 0.96 })
        bg.roundRect(-w / 2, -21, w, 42, 21).stroke({
            width: active || won ? 3 : 2,
            color: active ? 0xffffff : won ? 0xffd36b : GOLD,
            alpha: active || won ? 0.95 : 0.6
        })
        box.addChild(bg, value)
        box.position.set(x, this.pos.y + HAND_BADGE_Y - lift)
        this.uiLayer.addChild(box)
        this.badges.push(box)
        // The total ticks: a new value lands with a pop, a settled win bigger.
        if (key && this.badgeText.get(key) !== text) {
            if (this.badgeText.has(key) || done) {
                if (animating()) gsap.fromTo(box.scale, { x: won ? 1.6 : 1.3, y: won ? 1.6 : 1.3 }, { x: 1, y: 1, duration: won ? 0.45 : 0.3, ease: 'back.out(3)' })
            }
            this.badgeText.set(key, text)
        }
        if (this.badgeText.size > 40) this.badgeText.clear()
    }

    private addInsuranceBadge(amount: number) {
        const box = new this.PIXI.Container()
        const value = label(this.PIXI, `INS ${formatCoins(amount)}`, 14, 0x0b0806, '800')
        value.anchor.set(0.5)
        const w = value.width + 18
        const bg = new this.PIXI.Graphics()
        bg.roundRect(-w / 2, -12, w, 24, 12).fill(0xd9b167)
        box.addChild(bg, value)
        // Centred between the two side bet result badges on the same row.
        box.position.set(this.pos.x, this.pos.y + RESULT_Y_OFFSET)
        this.uiLayer.addChild(box)
        this.badges.push(box)
    }

    private addChips(
        x: number,
        y: number,
        amount: number,
        tex: LbTextures,
        scale = 0.62,
        max = MAX_STAKE_CHIPS,
        layer = this.chipLayer,
        key = ''
    ) {
        const before = this.chipAmounts.get(key) ?? 0
        this.chipAmounts.set(key, amount)
        if (amount <= 0) return
        const stack = chipStack(amount, max)
        // A bet that grew drops its new top chip on with a bounce.
        const drop = key && amount > before && animating()
        stack.forEach((chip, i) => {
            const sprite = new this.PIXI.Sprite(tex.chip.get(chip.value)!)
            sprite.anchor.set(0.5)
            sprite.scale.set(scale)
            const restY = y - i * 7 * (scale / 0.62)
            sprite.position.set(x + (i % 2 ? 2 : -2), restY)
            layer.addChild(sprite)
            this.chipSprites.push(sprite)
            if (drop && i === stack.length - 1) {
                const fall = { t: 0 }
                sprite.alpha = 0
                gsap.to(fall, {
                    t: 1,
                    duration: 0.32,
                    ease: 'bounce.out',
                    onUpdate: () => {
                        if (sprite.destroyed) return
                        sprite.y = restY - 34 * (1 - fall.t)
                        sprite.alpha = Math.min(1, fall.t * 3)
                    }
                })
            }
        })

        // Side stakes are read off their own result badge, and a second label
        // under a small stack only crowds the nameplate row.
        if (scale < 0.5) return

        const total = label(this.PIXI, formatCoins(amount), 16, 0xf7f3e8, '800')
        total.anchor.set(0.5)
        total.position.set(x, y + 34)
        const box = new this.PIXI.Container()
        const bg = new this.PIXI.Graphics()
        const w = total.width + 16
        bg.roundRect(x - w / 2, y + 22, w, 24, 12).fill({ color: 0x0b0806, alpha: 0.8 })
        box.addChild(bg, total)
        this.uiLayer.addChild(box)
        this.badges.push(box)
    }
}
