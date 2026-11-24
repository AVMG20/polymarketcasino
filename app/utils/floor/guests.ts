import type { Container, Text, Graphics, Sprite } from 'pixi.js'
import { Actor, figureFrames } from './actors'
import type { TextureBank } from './art/bank'
import type { Emote, FxTextures } from './art/fx'
import { LOOKS_PER_TIER, tierLooks } from './art/visitors'
import { project } from './iso'
import { SPAWN, type Tile } from '#shared/floor/layout'
import type { NavGrid } from '#shared/floor/nav'
import { VISITOR_TIER_IDS, type VisitorCounts, type VisitorTierId } from '#shared/visitors'

type Pixi = typeof import('pixi.js')

/** A place a guest can stand to play a machine. */
export interface GuestSpot {
    key: string
    tile: Tile
    /** Tile to face while playing. */
    face: { x: number, y: number }
}

type State = 'idle' | 'walk' | 'play' | 'leave' | 'cheer'

interface Guest {
    actor: Actor
    tier: VisitorTierId
    /** A Whale's gold glow behind them (pulses), else null. */
    glow: Sprite | null
    state: State
    timer: number
    spot: string | null
    /** State to go back to after cheering. */
    resume: State
    emoteT: number
    fade: number
    /** Coins this guest has spent at their machine since the last pop. */
    earned: number
    /** Seconds until the next coin pops off their machine. */
    popT: number
}

const LINES = ['Feeling lucky!', 'One more spin…', 'Jackpot?!', 'Nice place!', 'Ooh, shiny!', 'Hit me!', 'Let it ride!', 'So close!', 'Red, red, red!', 'This one\'s hot']
const RUSH_LINES = ['What a crowd!', 'Party time!', 'Love this place!']
const PLAY_EMOTES: Emote[] = ['coin', 'heart', 'star', 'bang', 'smile', 'note']

const WHALE_LINES = ['Bring me the high limit!', 'Put it all on red.', 'Champagne for the table!']

const ZERO: VisitorCounts = { tourist: 0, regular: 0, highroller: 0, whale: 0 }

/**
 * The NPC guests: they come in at the entrance, wander, play machines, pop
 * the odd emote or line, cheer at big wins and leave when the floor gets
 * quieter. Each walks as a visitor tier (`setMix`): dressed for it
 * (art/visitors.ts, a fixed set of looks so the baked figure textures stay
 * bounded), on a small disc in the tier's colour; a Whale glows gold.
 */
export class GuestCrowd {
    private guests: Guest[] = []
    private nav: NavGrid | null = null
    private walkable: Tile[] = []
    private spots: GuestSpot[] = []
    private spotByKey = new Map<string, GuestSpot>()
    private taken = new Set<string>()
    private target: VisitorCounts = { ...ZERO }
    private targetTotal = 0
    private colors: Record<VisitorTierId, string> = { tourist: '#7dd3fc', regular: '#3fd25a', highroller: '#c084fc', whale: '#ffc93a' }
    private time = 0
    private spawnT = 0
    private rush = false
    private lineT = 6
    private bubbles: { box: Container, text: Text, bg: Graphics, actor: Actor | null, t: number }[] = []
    /**
     * What one playing guest of each tier brings in, coins a second. Every
     * 8-16 s a coin pops off their machine, labelled with the whole coins
     * they spent since the last label (0 = just the coin), so a busy floor
     * visibly makes money (and a Whale's pops are bigger).
     */
    earnPerSec: VisitorCounts = { ...ZERO }
    onEarn: ((x: number, y: number, amount: number) => void) | null = null
    /** 0..1: arrange mode fades the crowd so the furniture reads. */
    visibility = 1
    private seq = Math.floor(Math.random() * LOOKS_PER_TIER)
    private initialised = false

    constructor(private readonly PIXI: Pixi, private readonly bank: TextureBank, private readonly fx: FxTextures, private readonly layer: Container, private readonly overlay: Container, private readonly reduced: boolean) {}

    /** Visit every guest's actor (no allocation; runs every frame). */
    eachActor(fn: (actor: Actor) => void) {
        for (const g of this.guests) fn(g.actor)
    }

    get size(): number {
        return this.guests.length
    }

    setWorld(nav: NavGrid, spots: GuestSpot[]) {
        this.nav = nav
        // Wander inside the building, not on the porch.
        this.walkable = nav.tiles().filter(t => t.y < 22)
        this.spots = spots
        this.spotByKey = new Map(spots.map(s => [s.key, s]))
        const valid = this.spotByKey
        for (const key of [...this.taken]) if (!valid.has(key)) this.taken.delete(key)
        for (const g of this.guests) {
            if (g.spot && !valid.has(g.spot)) {
                g.spot = null
                g.state = 'idle'
                g.timer = Math.random()
            }
            const t = g.actor.tile
            if (!nav.isWalkable(t.x, t.y)) {
                const near = nav.nearestWalkable(g.actor.x, g.actor.y, 6)
                if (near) {
                    g.actor.x = near.x + 0.5
                    g.actor.y = near.y + 0.5
                    g.actor.place()
                }
            }
            if (g.actor.path.length) {
                const dest = g.actor.path[g.actor.path.length - 1]!
                const route = nav.findPath(g.actor.nextTile, dest)
                if (route) g.actor.walk(route)
                else {
                    g.actor.stop()
                    g.state = 'idle'
                }
            }
        }
    }

    /** Guests to have on the floor per tier, and each tier's colour (for its disc and clothes). */
    setMix(counts: VisitorCounts, colors: Record<VisitorTierId, string>, rush: boolean) {
        this.target = { ...counts }
        this.targetTotal = VISITOR_TIER_IDS.reduce((sum, id) => sum + Math.max(0, counts[id] ?? 0), 0)
        this.colors = colors
        this.rush = rush
    }

    /** Active (not leaving) guests per tier. */
    private activeCounts(): VisitorCounts {
        const out = { ...ZERO }
        for (const g of this.guests) if (g.state !== 'leave') out[g.tier]++
        return out
    }

    private spawn(atEntrance: boolean, tier: VisitorTierId) {
        if (!this.nav || !this.walkable.length) return
        // Each visitor gets the next look of their tier (a stride, so neighbours rarely match).
        this.seq = (this.seq + 5) % (LOOKS_PER_TIER * 7)
        const color = this.colors[tier]
        const look = tierLooks(tier, color)[this.seq % LOOKS_PER_TIER]!
        const start = atEntrance ? SPAWN : this.walkable[Math.floor(Math.random() * this.walkable.length)]!
        const actor = new Actor(this.PIXI, figureFrames(this.bank, look), this.fx, start)
        actor.speed = (tier === 'whale' ? 1.5 : 1.9) + Math.random() * 0.8
        // The tier's colour as a soft disc under the feet, over the shadow.
        const disc = new this.PIXI.Sprite(this.fx.pool.texture)
        disc.anchor.set(0.5)
        disc.scale.set(tier === 'whale' ? 0.36 : 0.3)
        disc.tint = color
        disc.alpha = 0.6
        actor.container.addChildAt(disc, 1)
        let glow: Sprite | null = null
        if (tier === 'whale') {
            glow = new this.PIXI.Sprite(this.fx.glow.texture)
            glow.anchor.set(0.5)
            glow.position.set(0, -26)
            glow.scale.set(1.15)
            glow.blendMode = 'add'
            glow.tint = color
            glow.alpha = 0.4
            actor.container.addChildAt(glow, 0)
        }
        this.layer.addChild(actor.container)
        const g: Guest = { actor, tier, glow, state: 'idle', timer: atEntrance ? 0 : Math.random() * 3, spot: null, resume: 'idle', emoteT: 3 + Math.random() * 6, fade: atEntrance ? 0 : 1, earned: Math.random(), popT: 4 + Math.random() * 8 }
        actor.container.alpha = g.fade
        this.guests.push(g)
        if (atEntrance) this.wander(g)
    }

    /** The tier furthest below its target (richest first on a tie), or null when every tier has its guests. */
    private shortTier(active: VisitorCounts): VisitorTierId | null {
        let best: VisitorTierId | null = null
        let gap = 0
        for (let i = VISITOR_TIER_IDS.length - 1; i >= 0; i--) {
            const id = VISITOR_TIER_IDS[i]!
            const d = (this.target[id] ?? 0) - active[id]
            if (d > gap) {
                gap = d
                best = id
            }
        }
        return best
    }

    private freeSpot(): GuestSpot | null {
        const free = this.spots.filter(s => !this.taken.has(s.key))
        return free.length ? free[Math.floor(Math.random() * free.length)]! : null
    }

    private wander(g: Guest) {
        if (!this.nav || !this.walkable.length) return
        const dest = this.walkable[Math.floor(Math.random() * this.walkable.length)]!
        const path = this.nav.findPath(g.actor.nextTile, dest)
        if (path && path.length) {
            g.actor.walk(path)
            g.state = 'walk'
        } else {
            g.state = 'idle'
            g.timer = 1 + Math.random() * 2
        }
    }

    private goPlay(g: Guest, spot: GuestSpot) {
        if (!this.nav) return
        const path = this.nav.findPath(g.actor.nextTile, spot.tile)
        if (!path) {
            this.wander(g)
            return
        }
        this.taken.add(spot.key)
        g.spot = spot.key
        g.actor.walk(path)
        g.state = 'walk'
    }

    private leave(g: Guest) {
        if (g.spot) this.taken.delete(g.spot)
        g.spot = null
        const path = this.nav?.findPath(g.actor.nextTile, SPAWN)
        if (path) {
            g.actor.walk(path)
            g.state = 'leave'
        } else {
            g.state = 'leave'
            g.actor.stop()
        }
    }

    /** Guests near a world point jump and cheer. */
    cheer(wx: number, wy: number, radius = 260) {
        for (const g of this.guests) {
            if (g.state === 'leave') continue
            const p = project(g.actor.x, g.actor.y)
            if (Math.hypot(p.x - wx, p.y - wy) > radius) continue
            if (g.state !== 'cheer') g.resume = g.state === 'walk' ? 'idle' : g.state
            // Stopping mid-walk gives up the machine they were heading for.
            if (g.resume === 'idle' && g.spot) {
                this.taken.delete(g.spot)
                g.spot = null
            }
            g.state = 'cheer'
            g.timer = 1.3 + Math.random() * 0.5
            g.actor.stop()
            g.actor.showEmote(Math.random() < 0.5 ? 'bang' : 'star', 1.6)
        }
    }

    private say(actor: Actor, line: string) {
        let b = this.bubbles.find(x => !x.actor)
        if (!b) {
            if (this.bubbles.length >= 3) return
            const box = new this.PIXI.Container()
            const bg = new this.PIXI.Graphics()
            const text = new this.PIXI.Text({ text: '', resolution: 2, style: { fontFamily: '"Fredoka", system-ui, sans-serif', fontSize: 10.5, fontWeight: '600', fill: 0x2a1b30 } })
            text.anchor.set(0.5)
            box.addChild(bg, text)
            this.overlay.addChild(box)
            b = { box, text, bg, actor: null, t: 0 }
            this.bubbles.push(b)
        }
        b.actor = actor
        b.t = 0
        b.text.text = line
        const w = b.text.width + 14
        b.bg.clear()
        b.bg.roundRect(-w / 2, -10, w, 20, 9).fill(0xffffff).stroke({ color: 0x2a1b30, width: 1.6 })
        b.bg.moveTo(-4, 9).lineTo(0, 15).lineTo(4, 9).fill(0xffffff)
        b.box.visible = true
    }

    update(dt: number, partyOn: boolean) {
        if (!this.nav) return
        this.time += dt
        if (!this.initialised && this.targetTotal > 0) {
            this.initialised = true
            let room = Math.max(0, this.walkable.length - 6)
            for (const id of VISITOR_TIER_IDS) {
                const n = Math.min(this.target[id] ?? 0, room)
                for (let i = 0; i < n; i++) this.spawn(false, id)
                room -= n
            }
        }
        // Arrivals and departures, per tier.
        const active = this.activeCounts()
        const short = this.shortTier(active)
        const extra = VISITOR_TIER_IDS.find(id => active[id] > (this.target[id] ?? 0))
        this.spawnT -= dt
        if (short && this.spawnT <= 0 && this.guests.length < this.targetTotal + 4) {
            this.spawn(true, short)
            this.spawnT = this.rush ? 0.35 : 0.9 + Math.random() * 1.2
        } else if (extra) {
            const g = this.guests.find(x => x.tier === extra && (x.state === 'idle' || x.state === 'walk')) ?? this.guests.find(x => x.tier === extra && x.state !== 'leave')
            if (g) this.leave(g)
        }

        for (let i = this.guests.length - 1; i >= 0; i--) {
            const g = this.guests[i]!
            const arrived = g.actor.update(dt)
            if (g.glow) g.glow.alpha = this.reduced ? 0.4 : 0.34 + Math.sin(this.time * 2.2 + i) * 0.1
            if (g.fade < 1 && g.state !== 'leave') g.fade = Math.min(1, g.fade + dt * 2)
            g.actor.container.alpha = Math.max(0, g.fade) * this.visibility
            switch (g.state) {
                case 'idle': {
                    g.timer -= dt
                    // Dance a little during a rush.
                    g.actor.jump = partyOn && !this.reduced ? Math.abs(Math.sin(performance.now() / 180 + i)) * 3 : 0
                    if (g.timer <= 0) {
                        g.actor.jump = 0
                        const spot = Math.random() < 0.7 ? this.freeSpot() : null
                        if (spot) this.goPlay(g, spot)
                        else this.wander(g)
                    }
                    break
                }
                case 'walk': {
                    if (!arrived && g.actor.moving) break
                    const spot = g.spot ? this.spotByKey.get(g.spot) : null
                    if (spot) {
                        g.state = 'play'
                        g.timer = 6 + Math.random() * 12
                        g.actor.face(spot.face)
                    } else {
                        g.state = 'idle'
                        g.timer = 1 + Math.random() * 3
                    }
                    break
                }
                case 'play': {
                    g.timer -= dt
                    const rate = this.earnPerSec[g.tier] ?? 0
                    if (this.onEarn && rate > 0) {
                        g.earned += rate * dt
                        g.popT -= dt
                        if (g.popT <= 0) {
                            g.popT = 8 + Math.random() * 8
                            const whole = Math.floor(g.earned)
                            g.earned -= whole
                            const p = g.actor.container.position
                            this.onEarn(p.x, p.y, whole)
                        }
                    }
                    g.emoteT -= dt * (this.rush ? 1.8 : 1)
                    if (g.emoteT <= 0) {
                        g.emoteT = 4 + Math.random() * 8
                        if (!this.reduced || Math.random() < 0.4) g.actor.showEmote(PLAY_EMOTES[Math.floor(Math.random() * PLAY_EMOTES.length)]!)
                    }
                    if (g.timer <= 0) {
                        if (g.spot) this.taken.delete(g.spot)
                        g.spot = null
                        this.wander(g)
                    }
                    break
                }
                case 'cheer': {
                    g.timer -= dt
                    g.actor.jump = this.reduced ? 0 : Math.abs(Math.sin(g.timer * 9)) * 7
                    if (g.timer <= 0) {
                        g.actor.jump = 0
                        g.state = g.resume === 'cheer' ? 'idle' : g.resume
                        if (g.state === 'walk') g.state = 'idle'
                        g.timer = Math.max(g.timer, 1)
                    }
                    break
                }
                case 'leave': {
                    const t = g.actor.tile
                    if (!g.actor.moving || (t.x === SPAWN.x && t.y === SPAWN.y)) {
                        g.fade -= dt * 2.5
                        if (g.fade <= 0) {
                            for (const b of this.bubbles) if (b.actor === g.actor) b.actor = null
                            g.actor.destroy()
                            this.guests.splice(i, 1)
                        }
                    }
                    break
                }
            }
        }

        // The occasional line from someone playing.
        this.lineT -= dt
        if (this.lineT <= 0) {
            this.lineT = (this.reduced ? 14 : 6) + Math.random() * 8
            const players = this.guests.filter(g => g.state === 'play' || (g.state === 'idle' && this.rush))
            const who = players[Math.floor(Math.random() * players.length)]
            if (who) {
                const pool = who.tier === 'whale' && Math.random() < 0.6 ? WHALE_LINES : this.rush && Math.random() < 0.5 ? RUSH_LINES : LINES
                this.say(who.actor, pool[Math.floor(Math.random() * pool.length)]!)
            }
        }
        for (const b of this.bubbles) {
            if (!b.actor) {
                b.box.visible = false
                continue
            }
            b.t += dt
            const p = b.actor.container.position
            b.box.position.set(p.x, p.y - 66 - Math.min(1, b.t * 6) * 4)
            b.box.alpha = (b.t > 2.4 ? Math.max(0, 1 - (b.t - 2.4) / 0.4) : Math.min(1, b.t * 6)) * this.visibility
            if (b.t > 2.8) b.actor = null
        }
    }

    destroy() {
        for (const g of this.guests) g.actor.destroy()
        this.guests = []
        for (const b of this.bubbles) b.box.destroy({ children: true })
        this.bubbles = []
    }
}
