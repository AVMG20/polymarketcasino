import type { Container, Graphics, Sprite } from 'pixi.js'
import { GRID_H, GRID_W, ZONE_RECTS, type Rect, type Tile } from '#shared/floor/layout'
import type { ZoneId } from '#shared/tycoon'
import type { Baked } from './art/bank'
import type { FxTextures } from './art/fx'
import type { Camera } from './camera'
import type { Particles } from './effects'
import { project, unproject, type Pt } from './iso'
import type { ArrangeItem, ArrangeState } from './types'

type Pixi = typeof import('pixi.js')

/**
 * Arrange mode: pick up a machine or a decoration, carry a ghost of it over
 * the floor (snapped to tiles, green where it fits, red where it doesn't)
 * and put it down. The engine draws the floor; this owns the gesture, the
 * ghost and its animations, and tells the page through ArrangeEvents.
 *
 * Gestures (FloorInput hands them over through press/drag/release/tap):
 * - Nothing carried: press an item to lift it. Release without moving keeps
 *   it in hand (click-click, tap-tap); drag and release moves it in one go.
 *   Dragging the floor pans as usual.
 * - Carried, mouse: the ghost follows the mouse; a click puts it down.
 * - Carried, touch: drag the ghost and let go to put it down, or tap a tile
 *   to move it there and tap the ghost to put it down. Dragging anywhere
 *   else pans.
 * - A put-down on a red spot keeps it in hand (a little shake). A good one
 *   lands with a bounce and a puff of dust and stays drawn there until the
 *   next scene shows the item there (`sceneChanged`); `{ carrying: null }`
 *   before that means the page's call failed: it flies back with a shake.
 */

/** A key per item: what the engine hides while it is carried. */
export function arrangeKey(item: ArrangeItem): string {
    return item.kind === 'game' ? `game:${item.id}` : item.kind === 'decor' ? `decor:${item.id}` : `new:${item.type}`
}

export interface ArrangeEvents {
    /** Picked up from the floor (the page answers with `arrange({ carrying: item, at })`). */
    pick: (item: ArrangeItem) => void
    /** The ghost moved (or the carry ended: null, null). */
    hover: (at: Tile | null, problem: string | null) => void
    /** Put down on a spot that fits. */
    drop: (item: ArrangeItem, at: Tile) => void
    /** The carry ended without a change (Esc, or put back where it was). */
    cancel: () => void
}

/** What the controller needs from the engine. */
export interface ArrangeHost {
    PIXI: Pixi
    fx: FxTextures
    camera: Camera
    particles: Particles
    reduced: boolean
    /** The floor decal layer (grid, footprint) and the layer above everything standing (the lifted ghost). */
    floorLayer: Container
    ghostLayer: Container
    owned: () => ReadonlySet<ZoneId>
    /** The movable item under a screen point. */
    itemAt: (sx: number, sy: number, touch: boolean) => ArrangeItem | null
    /** Where an item stands now, or null when it is not on the floor (stored, or being bought). */
    itemRect: (item: ArrangeItem) => Rect | null
    itemSize: (item: ArrangeItem) => { w: number, h: number }
    itemArt: (item: ArrangeItem) => Baked
    /** Tiles in front of a game where players stand (drawn lighter under the ghost). */
    itemFront: (item: ArrangeItem, at: Tile) => Tile[]
    /** Why it can't stand at `at`, or null. */
    problem: (item: ArrangeItem, at: Tile) => string | null
    /** The engine's own views: hide one while its ghost stands in. */
    setHidden: (key: string, hidden: boolean) => void
    /** The mouse rests on a movable item (nothing carried): highlight it. */
    highlight: (item: ArrangeItem | null) => void
    /** The scene shows `item` standing at `at` (for a new one: a decoration of its type whose id isn't in `known`). */
    landed: (item: ArrangeItem, at: Tile, known: ReadonlySet<number>) => boolean
    decorIds: () => Set<number>
    events: ArrangeEvents
}

/** How high a carried ghost floats (px). */
const LIFT = 16
const GRAVITY = 2600
/** A held drop the page never confirmed nor failed goes back after this long (s). */
const HOLD_MAX = 10
/** Screen px from the edge where a drag pans the camera along. */
const EDGE = 44

const GREEN = 0x4ade80
const RED = 0xff5470

/** A lifted copy of an item's art with a shadow under it. */
class Ghost {
    readonly container: Container
    private readonly inner: Container
    private readonly art: Sprite
    private readonly shadow: Sprite
    shown: Pt
    lift = 0
    /** Where the lift eases to while not falling. */
    liftTo = LIFT
    falling = false
    private v = 0
    private squash = 0
    private shakeT = 0
    private pop: number
    private t = Math.random() * 10
    private bad = false
    fade = 1
    /** The first impact of a fall (dust puff). */
    onImpact: (() => void) | null = null
    private impacts = 0

    constructor(PIXI: Pixi, fx: FxTextures, baked: Baked, readonly size: { w: number, h: number }, at: Pt, lifted: boolean, pop: boolean, layer: Container, private readonly reduced: boolean) {
        this.container = new PIXI.Container()
        this.inner = new PIXI.Container()
        const c = project(size.w / 2, size.h / 2)
        this.shadow = new PIXI.Sprite(fx.shadow.texture)
        this.shadow.anchor.set(0.5)
        this.shadow.position.set(c.x, c.y)
        this.art = new PIXI.Sprite(baked.texture)
        this.art.anchor.set(baked.ox / baked.width, baked.oy / baked.height)
        this.art.position.set(-c.x, -c.y)
        this.inner.position.set(c.x, c.y)
        this.inner.addChild(this.art)
        this.container.addChild(this.shadow, this.inner)
        this.shown = { ...at }
        this.lift = lifted ? LIFT : 0
        this.pop = pop && !reduced ? 0 : 1
        layer.addChild(this.container)
        this.place()
    }

    setBad(bad: boolean) {
        if (bad === this.bad) return
        this.bad = bad
        this.art.tint = bad ? 0xff8a98 : 0xffffff
    }

    fall() {
        this.falling = true
        this.v = 0
        this.impacts = 0
        this.liftTo = 0
    }

    shake() {
        this.shakeT = this.reduced ? 0 : 0.34
    }

    /** True while it still moves on its own (a fall, a shake, a pop). */
    get busy(): boolean {
        return this.falling || this.shakeT > 0 || this.pop < 1
    }

    /** Ease toward `goal` (grid origin) at `rate`; float and wobble. */
    update(dt: number, goal: Pt | null, rate: number) {
        this.t += dt
        if (goal) {
            if (this.reduced) this.shown = { ...goal }
            else {
                const k = 1 - Math.exp(-dt * rate)
                this.shown.x += (goal.x - this.shown.x) * k
                this.shown.y += (goal.y - this.shown.y) * k
                if (Math.abs(goal.x - this.shown.x) < 0.003) this.shown.x = goal.x
                if (Math.abs(goal.y - this.shown.y) < 0.003) this.shown.y = goal.y
            }
        }
        if (this.falling) {
            if (this.reduced) {
                this.lift = 0
                this.falling = false
                this.onImpact?.()
            } else {
                this.v -= GRAVITY * dt
                this.lift += this.v * dt
                if (this.lift <= 0) {
                    this.lift = 0
                    if (this.impacts === 0) this.onImpact?.()
                    this.impacts++
                    this.squash = Math.min(1, -this.v / 260)
                    if (-this.v > 90 && this.impacts < 3) this.v = -this.v * 0.3
                    else {
                        this.v = 0
                        this.falling = false
                    }
                }
            }
        } else {
            const k = this.reduced ? 1 : 1 - Math.exp(-dt * 14)
            this.lift += (this.liftTo - this.lift) * k
        }
        if (this.pop < 1) this.pop = Math.min(1, this.pop + dt * 5)
        this.squash *= Math.exp(-dt * 12)
        if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt)
        this.place()
    }

    private place() {
        const p = project(this.shown.x, this.shown.y)
        this.container.position.set(p.x, p.y)
        const carried = this.liftTo > 0 && !this.falling
        const bob = carried && !this.reduced ? Math.sin(this.t * 3.2) * 1.6 : 0
        const shake = this.shakeT > 0 ? Math.sin(this.shakeT * 60) * 4.5 * (this.shakeT / 0.34) : 0
        // An elastic pop for things that appear in hand (from storage, being bought).
        const e = this.pop
        const pop = e >= 1 ? 1 : 1 - Math.cos(e * Math.PI * 2.5) * Math.exp(-e * 5) * 0.4 - (1 - e) * 0.25
        this.inner.position.x = project(this.size.w / 2, this.size.h / 2).x + shake
        this.art.y = -project(this.size.w / 2, this.size.h / 2).y - this.lift - bob
        this.inner.scale.set((1 + this.squash * 0.08) * pop, (1 - this.squash * 0.1) * pop)
        const s = (this.size.w + this.size.h) * 0.62 * (1 - this.lift / 70)
        this.shadow.scale.set(Math.max(0.3, s), Math.max(0.2, s * 0.9))
        this.shadow.alpha = Math.max(0.12, 0.62 - this.lift * 0.016) * this.fade
        this.art.alpha = (this.lift > 1 ? 0.84 : 1) * this.fade
    }

    destroy() {
        this.container.destroy({ children: true })
    }
}

interface Carry {
    item: ArrangeItem
    key: string
    size: { w: number, h: number }
    /** Where it stood when lifted (null: it comes from storage or the shop). */
    origin: Tile | null
    at: Tile
    /** The pointer's grid offset from the ghost's origin. */
    grab: Pt
    problem: string | null
    ghost: Ghost
    /** Lifted by the press still going on: a release without a move keeps it in hand. */
    fresh: boolean
}

/** A ghost no longer in hand: held where it was dropped, flying back, or fading away. */
interface Loose {
    ghost: Ghost
    key: string
    /** On the floor (its view is hidden while the ghost stands in). */
    onFloor: boolean
    mode: 'held' | 'return' | 'fade' | 'settle'
    item: ArrangeItem
    at: Tile
    origin: Tile | null
    known: ReadonlySet<number>
    t: number
    /** The scene shows it at the drop spot: swap for the real view once the bounce is done. */
    landed: boolean
    /** A failed drop shakes once it is back. */
    shake: boolean
}

export class ArrangeController {
    active = false
    private carry: Carry | null = null
    private loose: Loose[] = []
    private grid: Graphics
    private foot: Graphics
    private gridKey = ''
    private gridAlpha = 0
    private footKey = ''
    private t = 0
    private dragging = false
    private pointer: Pt | null = null
    /** Frames until a `{ carrying: null }` is acted on (the scene from a successful call may be on its way). */
    private putDownIn = 0
    private highlighted = ''
    private readonly onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || !this.carry) return
        e.preventDefault()
        this.cancelCarry()
        this.host.events.cancel()
    }

    constructor(private readonly host: ArrangeHost) {
        const { PIXI } = host
        this.grid = new PIXI.Graphics()
        this.grid.visible = false
        // The footprint draws over what stands around it (and under the ghost), so a big item can't hide it.
        this.foot = new PIXI.Graphics()
        host.floorLayer.addChild(this.grid)
        host.ghostLayer.addChildAt(this.foot, 0)
    }

    /** Keys of the items whose own views must stay hidden (a ghost stands in for them). */
    hides(key: string): boolean {
        if (this.carry?.key === key && this.carry.origin) return true
        return this.loose.some(l => l.key === key && l.onFloor)
    }

    // ── the page's calls ──────────────────────────────────────────────────

    set(state: ArrangeState | null) {
        if (!state) {
            this.leave()
            return
        }
        this.enter()
        const item = state.carrying
        if (!item) {
            // Act a couple of frames later: a successful call's new scene lands first.
            this.putDownIn = 2
            return
        }
        this.putDownIn = 0
        if (this.carry && this.carry.key === arrangeKey(item)) return
        if (this.carry) this.letGo(this.carry, false)
        this.carry = this.startCarry(item, state.at ?? null)
        this.emitHover()
    }

    private enter() {
        if (this.active) return
        this.active = true
        this.refreshGrid()
        window.addEventListener('keydown', this.onKey)
    }

    private leave() {
        if (!this.active) return
        this.active = false
        this.putDownIn = 0
        this.dragging = false
        window.removeEventListener('keydown', this.onKey)
        this.setHighlight(null)
        if (this.carry) {
            this.letGo(this.carry, false)
            this.carry = null
        }
        // A held drop the scene hasn't confirmed: the scene is the truth now.
        for (const l of [...this.loose]) if (l.mode === 'held') this.finish(l)
        this.foot.clear()
        this.footKey = ''
    }

    /** The scene changed: a held drop may have landed; the grid may need the new rooms. */
    sceneChanged() {
        this.refreshGrid()
        for (const l of this.loose) {
            if (l.mode === 'held' && !l.landed && this.host.landed(l.item, l.at, l.known)) l.landed = true
        }
        // The carried item may have moved (another tab): follow its new spot.
        const c = this.carry
        if (c && c.origin) {
            const r = this.host.itemRect(c.item)
            if (r) c.origin = { x: r.x, y: r.y }
        }
    }

    // ── gestures ──────────────────────────────────────────────────────────

    /** A press: true takes the gesture (an item lifted or the ghost grabbed). */
    press(sx: number, sy: number, touch: boolean): boolean {
        if (!this.active) return false
        const c = this.carry
        if (c) {
            if (touch && !this.overGhost(c, sx, sy)) return false
            if (touch) {
                // Grab it where the finger is, so it doesn't jump.
                const g = this.gridAt(sx, sy)
                c.grab = { x: g.x - c.at.x, y: g.y - c.at.y }
            }
            c.fresh = false
            this.dragging = true
            this.pointer = { x: sx, y: sy }
            return true
        }
        if (this.loose.some(l => l.mode === 'held')) return false
        const item = this.host.itemAt(sx, sy, touch)
        if (!item) return false
        this.setHighlight(null)
        const carry = this.startCarry(item, null)
        const g = this.gridAt(sx, sy)
        carry.grab = { x: g.x - carry.at.x, y: g.y - carry.at.y }
        carry.fresh = true
        this.carry = carry
        this.dragging = true
        this.pointer = { x: sx, y: sy }
        this.host.events.pick(item)
        this.emitHover()
        return true
    }

    drag(sx: number, sy: number) {
        this.pointer = { x: sx, y: sy }
        if (this.carry) this.follow(sx, sy)
    }

    release(sx: number, sy: number, moved: boolean) {
        this.dragging = false
        this.pointer = null
        const c = this.carry
        if (!c) return
        if (!moved && c.fresh) {
            // Picked with a click or a tap: it stays in hand.
            c.fresh = false
            return
        }
        if (moved) this.follow(sx, sy)
        this.putDown()
    }

    dragCancel() {
        this.dragging = false
        this.pointer = null
    }

    /** A tap the press didn't take: on touch, the ghost goes to that tile. */
    tap(sx: number, sy: number) {
        const c = this.carry
        if (!this.active || !c) return
        c.grab = { x: c.size.w / 2, y: c.size.h / 2 }
        this.follow(sx, sy)
    }

    /** The mouse moved (no button): the ghost follows, or the item under it lights up. True: show a hand. */
    hover(sx: number, sy: number): boolean {
        if (!this.active) return false
        if (this.carry) {
            this.follow(sx, sy)
            return true
        }
        const item = this.loose.some(l => l.mode === 'held') ? null : this.host.itemAt(sx, sy, false)
        this.setHighlight(item)
        return !!item
    }

    hoverEnd() {
        this.setHighlight(null)
    }

    private setHighlight(item: ArrangeItem | null) {
        const key = item ? arrangeKey(item) : ''
        if (key === this.highlighted) return
        this.highlighted = key
        this.host.highlight(item)
    }

    // ── carrying ──────────────────────────────────────────────────────────

    private startCarry(item: ArrangeItem, at: Tile | null): Carry {
        const key = arrangeKey(item)
        // A ghost of the same item still on its way somewhere: this one replaces it.
        for (const l of [...this.loose]) if (l.key === key) this.finish(l)
        const rect = this.host.itemRect(item)
        const size = this.host.itemSize(item)
        const origin = rect ? { x: rect.x, y: rect.y } : null
        const start = this.clamp(at ?? origin ?? this.centreTile(size), size)
        const ghost = new Ghost(this.host.PIXI, this.host.fx, this.host.itemArt(item), size, origin ?? start, !origin, !origin, this.host.ghostLayer, this.host.reduced)
        if (origin) this.host.setHidden(key, true)
        const carry: Carry = { item, key, size, origin, at: start, grab: { x: size.w / 2, y: size.h / 2 }, problem: null, ghost, fresh: false }
        carry.problem = this.host.problem(item, start)
        ghost.setBad(!!carry.problem)
        return carry
    }

    private follow(sx: number, sy: number) {
        const c = this.carry
        if (!c) return
        const g = this.gridAt(sx, sy)
        const at = this.clamp({ x: Math.round(g.x - c.grab.x), y: Math.round(g.y - c.grab.y) }, c.size)
        if (at.x === c.at.x && at.y === c.at.y) return
        c.at = at
        c.problem = this.host.problem(c.item, at)
        c.ghost.setBad(!!c.problem)
        this.emitHover()
    }

    /** Put the carried item down where the ghost is (if it fits). */
    private putDown() {
        const c = this.carry
        if (!c) return
        if (c.problem) {
            c.ghost.shake()
            this.emitHover()
            return
        }
        this.carry = null
        if (c.origin && c.at.x === c.origin.x && c.at.y === c.origin.y) {
            // Back where it was: nothing to save.
            this.letGo(c, false)
            this.host.events.hover(null, null)
            this.host.events.cancel()
            return
        }
        const l: Loose = { ghost: c.ghost, key: c.key, onFloor: !!c.origin, mode: 'held', item: c.item, at: c.at, origin: c.origin, known: this.host.decorIds(), t: 0, landed: false, shake: false }
        l.ghost.onImpact = () => this.dust(l.at, c.size)
        l.ghost.fall()
        this.loose.push(l)
        this.host.events.hover(null, null)
        this.host.events.drop(c.item, c.at)
    }

    /** Esc: back where it came from, nothing changed. */
    private cancelCarry() {
        const c = this.carry
        if (!c) return
        this.carry = null
        this.dragging = false
        this.letGo(c, false)
        this.host.events.hover(null, null)
    }

    /** The carried item leaves the hand without a drop: it flies home (or fades if it has none). */
    private letGo(c: Carry, shake: boolean) {
        const rect = c.origin ? this.host.itemRect(c.item) : null
        const home = rect ? { x: rect.x, y: rect.y } : null
        const l: Loose = { ghost: c.ghost, key: c.key, onFloor: !!c.origin, mode: home ? 'return' : 'fade', item: c.item, at: c.at, origin: home, known: new Set(), t: 0, landed: false, shake }
        if (home) l.ghost.liftTo = LIFT
        this.loose.push(l)
    }

    /** `{ carrying: null }` came in: a held drop failed, or the hand is emptied. */
    private emptyHand() {
        for (const l of this.loose) {
            if (l.mode !== 'held' || l.landed) continue
            // The page's call failed: back where it was, with a shake.
            const rect = l.onFloor ? this.host.itemRect(l.item) : null
            l.origin = rect ? { x: rect.x, y: rect.y } : null
            l.mode = l.origin ? 'return' : 'fade'
            l.shake = true
            l.t = 0
            l.ghost.liftTo = LIFT
            l.ghost.falling = false
            if (!l.origin) l.ghost.shake()
        }
        if (this.carry) {
            const c = this.carry
            this.carry = null
            this.dragging = false
            this.letGo(c, false)
            this.host.events.hover(null, null)
        }
    }

    /** Done with a loose ghost: drop it and show the item's own view again. */
    private finish(l: Loose) {
        const i = this.loose.indexOf(l)
        if (i >= 0) this.loose.splice(i, 1)
        l.ghost.destroy()
        if (l.onFloor && !this.hides(l.key)) this.host.setHidden(l.key, false)
    }

    private emitHover() {
        const c = this.carry
        this.host.events.hover(c ? { ...c.at } : null, c?.problem ?? null)
    }

    // ── frame ─────────────────────────────────────────────────────────────

    update(dt: number) {
        this.t += dt
        if (this.putDownIn > 0 && --this.putDownIn === 0) this.emptyHand()
        // The grid fades in and out with the mode.
        const want = this.active ? 1 : 0
        if (this.gridAlpha !== want) {
            this.gridAlpha = this.host.reduced ? want : want > this.gridAlpha ? Math.min(1, this.gridAlpha + dt * 4) : Math.max(0, this.gridAlpha - dt * 4)
        }
        this.grid.visible = this.gridAlpha > 0.01
        this.grid.alpha = this.gridAlpha

        const c = this.carry
        if (c) {
            if (this.dragging && this.pointer) this.edgePan(dt)
            c.ghost.update(dt, c.at, 22)
        }
        this.drawFoot()
        for (const l of [...this.loose]) {
            l.t += dt
            if (l.mode === 'held') {
                l.ghost.update(dt, l.at, 22)
                if (l.landed && !l.ghost.busy) this.finish(l)
                else if (l.t > HOLD_MAX) {
                    l.mode = l.onFloor ? 'return' : 'fade'
                    l.t = 0
                    l.ghost.liftTo = LIFT
                }
            } else if (l.mode === 'return' && l.origin) {
                l.ghost.update(dt, l.origin, 11)
                const home = Math.abs(l.ghost.shown.x - l.origin.x) + Math.abs(l.ghost.shown.y - l.origin.y) < 0.02
                if (home && l.t > 0.12) {
                    l.mode = 'settle'
                    l.t = 0
                    if (l.shake) l.ghost.shake()
                }
            } else if (l.mode === 'settle') {
                l.ghost.update(dt, l.origin, 22)
                if (!l.ghost.falling && l.t > (l.shake ? 0.34 : 0) && l.ghost.lift > 0.5) l.ghost.fall()
                else if (!l.ghost.busy && l.ghost.lift <= 0.5) this.finish(l)
            } else {
                l.ghost.update(dt, null, 0)
                if (l.t > (l.shake ? 0.3 : 0)) {
                    l.ghost.fade = Math.max(0, l.ghost.fade - dt * 5)
                    if (l.ghost.fade <= 0) this.finish(l)
                }
            }
        }
    }

    /** Dragging near the edge of the view pans the camera along. */
    private edgePan(dt: number) {
        const p = this.pointer!
        const cam = this.host.camera
        const push = (d: number) => (d < EDGE ? (EDGE - Math.max(0, d)) / EDGE : 0)
        const vx = push(p.x) - push(cam.viewW - p.x)
        const vy = push(p.y) - push(cam.viewH - p.y)
        if (!vx && !vy) return
        const speed = 560 * dt
        cam.panBy(vx * speed, vy * speed)
        this.follow(p.x, p.y)
    }

    private drawFoot() {
        const c = this.carry
        const g = this.foot
        if (!c) {
            if (this.footKey) {
                g.clear()
                this.footKey = ''
            }
            return
        }
        const key = `${c.at.x},${c.at.y},${c.size.w},${c.size.h},${c.problem ? 1 : 0}`
        if (key !== this.footKey) {
            this.footKey = key
            g.clear()
            const color = c.problem ? RED : GREEN
            for (const t of this.host.itemFront(c.item, c.at)) {
                const pts = diamond(t.x, t.y, 1, 1)
                g.poly(pts).fill({ color, alpha: 0.14 }).stroke({ color, width: 1.4, alpha: 0.5 })
            }
            const foot = diamond(c.at.x, c.at.y, c.size.w, c.size.h)
            g.poly(foot).stroke({ color, width: 11, alpha: 0.22, join: 'round' })
            g.poly(foot).fill({ color, alpha: 0.42 }).stroke({ color, width: 3, alpha: 1, join: 'round' })
        }
        g.alpha = this.host.reduced ? 1 : 0.82 + Math.sin(this.t * 5) * 0.18
    }

    /** A soft grid over the owned rooms. */
    private refreshGrid() {
        const owned = [...this.host.owned()].sort()
        const key = owned.join(',')
        if (key === this.gridKey) return
        this.gridKey = key
        const g = this.grid
        g.clear()
        // A dark line with a light one beside it reads on pale wood and dark carpet alike.
        const lines = (dy: number) => {
            for (const id of owned) {
                const r = ZONE_RECTS[id as ZoneId]
                for (let i = 0; i <= r.w; i++) {
                    const a = project(r.x + i, r.y)
                    const b = project(r.x + i, r.y + r.h)
                    g.moveTo(a.x, a.y + dy).lineTo(b.x, b.y + dy)
                }
                for (let j = 0; j <= r.h; j++) {
                    const a = project(r.x, r.y + j)
                    const b = project(r.x + r.w, r.y + j)
                    g.moveTo(a.x, a.y + dy).lineTo(b.x, b.y + dy)
                }
            }
        }
        lines(0)
        g.stroke({ color: 0x2a1b30, width: 1.4, alpha: 0.24 })
        lines(1)
        g.stroke({ color: 0xffffff, width: 1, alpha: 0.16 })
    }

    /** Dust puffs out along the footprint's edges as a drop lands. */
    private dust(at: Tile, size: { w: number, h: number }) {
        if (this.host.reduced) return
        const { particles, fx } = this.host
        const cx = at.x + size.w / 2
        const cy = at.y + size.h / 2
        const n = 8 + (size.w + size.h) * 3
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2
            const gx = cx + Math.cos(a) * (size.w / 2 + 0.1)
            const gy = cy + Math.sin(a) * (size.h / 2 + 0.1)
            const p = project(gx, gy)
            const c = project(cx, cy)
            const dx = p.x - c.x
            const dy = p.y - c.y
            const len = Math.hypot(dx, dy) || 1
            particles.spawn(fx.dust.texture, p.x, p.y - 4, {
                vx: (dx / len) * (50 + Math.random() * 30),
                vy: (dy / len) * (24 + Math.random() * 14) - 14,
                drag: 3,
                max: 0.45 + Math.random() * 0.25,
                scale0: 0.45,
                scale1: 1.15,
                alpha: 0.8
            })
        }
    }

    // ── helpers ───────────────────────────────────────────────────────────

    private gridAt(sx: number, sy: number): Pt {
        const w = this.host.camera.screenToWorld(sx, sy)
        return unproject(w.x, w.y)
    }

    /** The tile at the middle of the view, the item centred on it. */
    private centreTile(size: { w: number, h: number }): Tile {
        const cam = this.host.camera
        const g = unproject(cam.x, cam.y + 30)
        return { x: Math.round(g.x - size.w / 2), y: Math.round(g.y - size.h / 2) }
    }

    private clamp(at: Tile, size: { w: number, h: number }): Tile {
        return {
            x: Math.max(0, Math.min(GRID_W - size.w, at.x)),
            y: Math.max(0, Math.min(GRID_H - 1 - size.h, at.y))
        }
    }

    /** A finger on the carried ghost (its footprint with some slop, or its picture). */
    private overGhost(c: Carry, sx: number, sy: number): boolean {
        const g = this.gridAt(sx, sy)
        const slop = 0.6
        if (g.x >= c.at.x - slop && g.x <= c.at.x + c.size.w + slop && g.y >= c.at.y - slop && g.y <= c.at.y + c.size.h + slop) return true
        const b = c.ghost.container.getBounds()
        return sx >= b.minX && sx <= b.maxX && sy >= b.minY && sy <= b.maxY
    }

    destroy() {
        window.removeEventListener('keydown', this.onKey)
        this.carry?.ghost.destroy()
        this.carry = null
        for (const l of this.loose) l.ghost.destroy()
        this.loose = []
        this.grid.destroy()
        this.foot.destroy()
    }
}

/** A footprint's floor diamond as a flat point list. */
function diamond(x: number, y: number, w: number, h: number): number[] {
    return [project(x, y), project(x + w, y), project(x + w, y + h), project(x, y + h)].flatMap(p => [p.x, p.y])
}
