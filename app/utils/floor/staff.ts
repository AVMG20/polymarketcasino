import type { Container } from 'pixi.js'
import { Actor, figureFrames, type FigureFrames } from './actors'
import type { TextureBank } from './art/bank'
import { lookKey } from './art/characters'
import type { FxTextures } from './art/fx'
import { emptyTray, staffLooks } from './art/staff'
import type { GuestCrowd } from './guests'
import type { Tile } from '#shared/floor/layout'
import type { NavGrid } from '#shared/floor/nav'

type Pixi = typeof import('pixi.js')

type State = 'rest' | 'out' | 'serve' | 'back'

interface Member {
    actor: Actor
    key: string
    loaded: FigureFrames
    empty: FigureFrames
    /** The tray is full (swapped to `empty` once served, refilled at the station). */
    full: boolean
    state: State
    timer: number
    /** The guest being served (an actor the crowd owns: checked with `isPlaying` before every use). */
    guest: Actor | null
    home: Tile
    fade: number
}

/** Where the staff wait between rounds: along the back wall of the backroom (the nearest free tiles). */
const STATIONS: readonly { x: number, y: number }[] = [{ x: 20.5, y: 14.5 }, { x: 18.5, y: 14.5 }, { x: 21.5, y: 15.5 }]

/**
 * The Hospitality upgrade on the floor: waiters (more and smarter dressed
 * with each level, art/staff.ts) wait at their station, now and then carry a
 * tray to a guest at a machine, pause to serve and walk back for a refill.
 * Pure decoration: they are not guests, take no seats, earn nothing and can't
 * be clicked; they walk the same grid with the same Actor as everyone else.
 */
export class StaffCrew {
    private members: Member[] = []
    private nav: NavGrid | null = null
    private walkable: Tile[] = []
    private level = 0
    private wanted = ''
    /** 0..1: arrange mode fades them with the guests. */
    visibility = 1

    constructor(private readonly PIXI: Pixi, private readonly bank: TextureBank, private readonly fx: FxTextures, private readonly layer: Container, private readonly reduced: boolean) {}

    eachActor(fn: (actor: Actor) => void) {
        for (const m of this.members) fn(m.actor)
    }

    setWorld(nav: NavGrid) {
        this.nav = nav
        this.walkable = nav.tiles().filter(t => t.y < 22)
        for (const m of this.members) {
            m.home = this.station(this.members.indexOf(m))
            const t = m.actor.tile
            if (!nav.isWalkable(t.x, t.y)) {
                const near = nav.nearestWalkable(m.actor.x, m.actor.y, 6)
                if (near) {
                    m.actor.x = near.x + 0.5
                    m.actor.y = near.y + 0.5
                    m.actor.place()
                }
            }
            if (m.actor.path.length) {
                const route = nav.findPath(m.actor.nextTile, m.actor.path[m.actor.path.length - 1]!)
                if (route) m.actor.walk(route)
                else this.goHome(m)
            }
        }
        this.sync()
    }

    /** The Hospitality level (0 = no staff). */
    setLevel(level: number) {
        this.level = Math.max(0, Math.floor(level || 0))
        this.sync()
    }

    private station(i: number): Tile {
        const at = STATIONS[i % STATIONS.length]!
        return this.nav?.nearestWalkable(at.x, at.y, 6) ?? { x: 18, y: 19 }
    }

    /** Hire, dress or let go staff to match the level (needs the walk grid). */
    private sync() {
        if (!this.nav) return
        const looks = staffLooks(this.level)
        const id = looks.map(lookKey).join(',')
        if (id === this.wanted) return
        this.wanted = id
        while (this.members.length > looks.length) this.members.pop()!.actor.destroy()
        looks.forEach((look, i) => {
            const key = lookKey(look)
            const loaded = figureFrames(this.bank, look)
            const empty = figureFrames(this.bank, emptyTray(look))
            const m = this.members[i]
            if (m) {
                if (m.key === key) return
                m.key = key
                m.loaded = loaded
                m.empty = empty
                m.actor.setFrames(m.full ? loaded : empty)
                return
            }
            const home = this.station(i)
            const actor = new Actor(this.PIXI, loaded, this.fx, home)
            actor.speed = 2.3 + i * 0.15
            this.layer.addChild(actor.container)
            this.members.push({ actor, key, loaded, empty, full: true, state: 'rest', timer: 2 + i * 3 + Math.random() * 4, guest: null, home, fade: 0 })
        })
    }

    private goHome(m: Member) {
        m.guest = null
        const path = this.nav?.findPath(m.actor.nextTile, m.home)
        if (path && path.length) {
            m.actor.walk(path)
            m.state = 'back'
        } else {
            m.actor.stop()
            this.rest(m)
        }
    }

    private rest(m: Member) {
        m.state = 'rest'
        m.timer = (this.reduced ? 10 : 5) + Math.random() * 9
        if (!m.full) {
            m.full = true
            m.actor.setFrames(m.loaded)
        }
    }

    /** A free tile next to the guest that the waiter can reach, or null. */
    private besideGuest(m: Member, guest: Actor): Tile | null {
        if (!this.nav) return null
        const g = guest.tile
        const around: Tile[] = [{ x: g.x + 1, y: g.y }, { x: g.x - 1, y: g.y }, { x: g.x, y: g.y + 1 }, { x: g.x + 1, y: g.y + 1 }, { x: g.x - 1, y: g.y + 1 }]
        // Not a tile another waiter is heading for or standing on.
        const taken = new Set(this.members.filter(o => o !== m).map((o) => {
            const t = o.actor.path[o.actor.path.length - 1] ?? o.actor.tile
            return `${t.x},${t.y}`
        }))
        for (const t of around) {
            if (!this.nav.isWalkable(t.x, t.y) || taken.has(`${t.x},${t.y}`)) continue
            const path = this.nav.findPath(m.actor.nextTile, t)
            if (path && path.length) return t
        }
        return null
    }

    private goOut(m: Member, crowd: GuestCrowd) {
        if (!this.nav) return
        const served = new Set(this.members.map(o => o.guest))
        const guest = crowd.servable(served)
        const to = guest ? this.besideGuest(m, guest) : null
        if (guest && to) {
            const path = this.nav.findPath(m.actor.nextTile, to)
            if (path) {
                m.guest = guest
                m.actor.walk(path)
                m.state = 'out'
                return
            }
        }
        // Nobody to serve: a short round of the floor, now and then.
        if (this.walkable.length && Math.random() < 0.4) {
            const dest = this.walkable[Math.floor(Math.random() * this.walkable.length)]!
            const path = this.nav.findPath(m.actor.nextTile, dest)
            if (path && path.length) {
                m.guest = null
                m.actor.walk(path)
                m.state = 'out'
                return
            }
        }
        this.rest(m)
    }

    update(dt: number, crowd: GuestCrowd) {
        if (!this.nav) return
        for (const m of this.members) {
            const arrived = m.actor.update(dt)
            if (m.fade < 1) m.fade = Math.min(1, m.fade + dt * 2)
            m.actor.container.alpha = m.fade * this.visibility
            switch (m.state) {
                case 'rest':
                    m.timer -= dt
                    if (m.timer <= 0) this.goOut(m, crowd)
                    break
                case 'out': {
                    if (!arrived && m.actor.moving) break
                    const guest = m.guest && crowd.isPlaying(m.guest) ? m.guest : null
                    if (guest) {
                        m.actor.face(guest.tile)
                        if (!this.reduced || Math.random() < 0.5) guest.showEmote(Math.random() < 0.6 ? 'heart' : 'smile', 1.6)
                    } else {
                        m.guest = null
                    }
                    m.state = 'serve'
                    m.timer = guest ? 2.2 : 1.4
                    break
                }
                case 'serve': {
                    m.timer -= dt
                    // A little bow while the tray is offered.
                    m.actor.jump = m.guest && !this.reduced ? -Math.max(0, Math.sin((2.2 - m.timer) * Math.PI / 1.1)) * 1.6 : 0
                    if (m.timer <= 0) {
                        m.actor.jump = 0
                        if (m.guest && m.full) {
                            m.full = false
                            m.actor.setFrames(m.empty)
                        }
                        this.goHome(m)
                    }
                    break
                }
                case 'back':
                    if (!arrived && m.actor.moving) break
                    this.rest(m)
                    break
            }
        }
    }

    destroy() {
        for (const m of this.members) m.actor.destroy()
        this.members = []
    }
}
