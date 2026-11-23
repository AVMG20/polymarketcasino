import { TYCOON_GAMES, ZONES, type Archetype, type ZoneId } from '#shared/tycoon'

/**
 * The casino's floor plan, in grid tiles (see iso.ts). The building is a
 * 22×22 block: the backroom sits at the front corner by the entrance, and
 * every later zone lies behind (lower gx or gy) one already owned, so the
 * wall between owned and unowned is always a back wall that never hides
 * what the player owns.
 *
 *            penthouse  (0..13, 0..5)
 *   highlimit   lounge    pit
 *   (0..5,     (6..13,   (14..21, 6..13)
 *    6..21)     6..13)
 *               main      backroom ── entrance porch (18..19, 22)
 *              (6..13,   (14..21, 14..21)
 *               14..21)
 */

export const GRID_W = 22
export const GRID_H = 23

export interface Rect {
    x: number
    y: number
    w: number
    h: number
}

export interface Tile {
    x: number
    y: number
}

export const ZONE_RECTS: Record<ZoneId, Rect> = {
    backroom: { x: 14, y: 14, w: 8, h: 8 },
    main: { x: 6, y: 14, w: 8, h: 8 },
    pit: { x: 14, y: 6, w: 8, h: 8 },
    lounge: { x: 6, y: 6, w: 8, h: 8 },
    highlimit: { x: 0, y: 6, w: 6, h: 16 },
    penthouse: { x: 0, y: 0, w: 14, h: 6 }
}

export const ZONE_ORDER: ZoneId[] = ZONES.map(zone => zone.id)

/** Tiles in front of the entrance, outside the building. */
export const PORCH: Tile[] = [{ x: 18, y: 22 }, { x: 19, y: 22 }]
export const SPAWN: Tile = { x: 18, y: 22 }

export type Area = ZoneId | 'porch'

/**
 * A gap in the wall between two areas. `axis: 'x'` is a wall on the line
 * gx = at (between columns at-1 and at), spanning gy from..to-1; `axis: 'y'`
 * the line gy = at spanning gx from..to-1. `front` is the area on the larger
 * side (nearer the viewer), `back` the one behind.
 */
export interface Doorway {
    front: Area
    back: Area
    axis: 'x' | 'y'
    at: number
    from: number
    to: number
}

export const DOORWAYS: Doorway[] = [
    { front: 'backroom', back: 'main', axis: 'x', at: 14, from: 17, to: 19 },
    { front: 'backroom', back: 'pit', axis: 'y', at: 14, from: 17, to: 19 },
    { front: 'main', back: 'lounge', axis: 'y', at: 14, from: 11, to: 13 },
    { front: 'pit', back: 'lounge', axis: 'x', at: 14, from: 9, to: 11 },
    { front: 'main', back: 'highlimit', axis: 'x', at: 6, from: 17, to: 19 },
    { front: 'lounge', back: 'highlimit', axis: 'x', at: 6, from: 9, to: 11 },
    { front: 'lounge', back: 'penthouse', axis: 'y', at: 6, from: 9, to: 11 },
    { front: 'highlimit', back: 'penthouse', axis: 'y', at: 6, from: 2, to: 4 },
    { front: 'porch', back: 'backroom', axis: 'y', at: 22, from: 18, to: 20 }
]

/** Footprint (w along gx, h along gy) of each archetype. Machines face +gy. */
export const ARCH_SIZE: Record<Archetype, { w: number, h: number }> = {
    slot: { w: 3, h: 1 },
    dice: { w: 2, h: 2 },
    rocket: { w: 2, h: 2 },
    wheel: { w: 2, h: 1 },
    flight: { w: 2, h: 2 },
    hands: { w: 2, h: 2 },
    roulette: { w: 3, h: 2 },
    cards: { w: 3, h: 2 },
    plinko: { w: 2, h: 1 },
    mines: { w: 2, h: 2 },
    hilo: { w: 2, h: 2 }
}

const PLOT_ORIGINS: Record<string, Tile> = {
    // Backroom
    wheel: { x: 14, y: 14 },
    spinata: { x: 19, y: 14 },
    dice: { x: 15, y: 16 },
    limbo: { x: 19, y: 16 },
    // Main floor
    trashpanda: { x: 7, y: 14 },
    roulette: { x: 8, y: 17 },
    candymadness: { x: 6, y: 20 },
    fireinthehole: { x: 11, y: 20 },
    plinko: { x: 11, y: 17 },
    // Table pit
    'blackjack': { x: 15, y: 6 },
    'three-card-poker': { x: 19, y: 6 },
    'polymasters': { x: 19, y: 11 },
    // Slot lounge
    bookofshadows: { x: 6, y: 6 },
    xenoslot: { x: 11, y: 6 },
    magichands: { x: 9, y: 9 },
    emberportals: { x: 7, y: 12 },
    // High limit
    'baccarat': { x: 1, y: 8 },
    'aethergates': { x: 1, y: 12 },
    'casino-holdem': { x: 1, y: 15 },
    // Penthouse
    mines: { x: 3, y: 1 },
    hilo: { x: 8, y: 2 }
}

export interface PlotLayout {
    id: string
    zone: ZoneId
    archetype: Archetype
    rect: Rect
    /** Where the avatar stands to use it. */
    front: Tile
    /** Tiles guests stand on while playing. */
    spots: Tile[]
}

function frontRow(rect: Rect): Tile[] {
    return Array.from({ length: rect.w }, (_, i) => ({ x: rect.x + i, y: rect.y + rect.h }))
}

export const PLOTS: Record<string, PlotLayout> = Object.fromEntries(TYCOON_GAMES.map((game) => {
    const origin = PLOT_ORIGINS[game.slug]
    if (!origin) throw new Error(`floor layout: no plot for ${game.slug}`)
    const size = ARCH_SIZE[game.archetype]
    const rect = { x: origin.x, y: origin.y, w: size.w, h: size.h }
    return [game.slug, {
        id: game.slug,
        zone: game.zone,
        archetype: game.archetype,
        rect,
        front: { x: rect.x + Math.floor((rect.w - 1) / 2), y: rect.y + rect.h },
        spots: frontRow(rect)
    }]
}))

/** The cashier cage, by the entrance. */
export const CAGE = { rect: { x: 20, y: 19, w: 2, h: 2 }, front: { x: 20, y: 21 } }
/** The architect's builder desk, by the entrance. */
export const DESK = { rect: { x: 14, y: 20, w: 2, h: 1 }, front: { x: 15, y: 21 } }

export type PropKind = 'plant' | 'lamp' | 'rope' | 'statue' | 'sofa' | 'bar' | 'piano' | 'fountain' | 'palm'

export interface PropLayout {
    kind: PropKind
    zone: ZoneId
    rect: Rect
    /** Decor level that adds it (0 = always there). */
    decor: number
}

const prop = (kind: PropKind, zone: ZoneId, x: number, y: number, decor: number, w = 1, h = 1): PropLayout => ({ kind, zone, rect: { x, y, w, h }, decor })

/** Furniture and decoration. Placed so no door, plot front or walkable tile is ever cut off, at any decor level. */
export const PROPS: PropLayout[] = [
    // Backroom
    prop('plant', 'backroom', 21, 17, 1),
    prop('plant', 'backroom', 16, 14, 2),
    prop('lamp', 'backroom', 21, 16, 3),
    prop('palm', 'backroom', 17, 20, 5),
    // Main floor
    prop('plant', 'main', 13, 14, 1),
    prop('plant', 'main', 6, 14, 2),
    prop('rope', 'main', 7, 17, 3),
    prop('rope', 'main', 7, 18, 3),
    prop('lamp', 'main', 13, 15, 3),
    prop('statue', 'main', 10, 20, 5),
    // Table pit
    prop('plant', 'pit', 14, 6, 1),
    prop('plant', 'pit', 21, 13, 2),
    prop('lamp', 'pit', 18, 6, 3),
    prop('rope', 'pit', 15, 12, 3),
    prop('rope', 'pit', 16, 12, 3),
    prop('statue', 'pit', 14, 13, 5),
    // Slot lounge
    prop('plant', 'lounge', 13, 13, 1),
    prop('plant', 'lounge', 6, 13, 2),
    prop('lamp', 'lounge', 12, 10, 3),
    prop('palm', 'lounge', 13, 8, 4),
    prop('statue', 'lounge', 12, 12, 5),
    // High limit
    prop('sofa', 'highlimit', 1, 20, 0, 2, 1),
    prop('plant', 'highlimit', 0, 6, 1),
    prop('plant', 'highlimit', 5, 21, 1),
    prop('palm', 'highlimit', 0, 19, 2),
    prop('lamp', 'highlimit', 0, 11, 3),
    prop('rope', 'highlimit', 4, 15, 3),
    prop('rope', 'highlimit', 4, 16, 3),
    prop('statue', 'highlimit', 3, 20, 5),
    // Penthouse
    prop('bar', 'penthouse', 5, 0, 0, 4, 1),
    prop('piano', 'penthouse', 11, 1, 0, 2, 2),
    prop('fountain', 'penthouse', 6, 3, 0, 2, 2),
    prop('sofa', 'penthouse', 1, 1, 0, 2, 1),
    prop('sofa', 'penthouse', 1, 3, 0, 2, 1),
    prop('palm', 'penthouse', 0, 0, 0),
    prop('palm', 'penthouse', 13, 0, 0),
    prop('plant', 'penthouse', 4, 5, 1),
    prop('plant', 'penthouse', 11, 5, 1),
    prop('lamp', 'penthouse', 9, 0, 2),
    prop('statue', 'penthouse', 13, 4, 4)
]

/** Chandeliers hang over these tiles from decor level 4 (non-blocking). */
export const CHANDELIERS: { zone: ZoneId, at: Tile }[] = [
    { zone: 'backroom', at: { x: 17.5, y: 17.5 } },
    { zone: 'main', at: { x: 10, y: 16 } },
    { zone: 'pit', at: { x: 17, y: 10 } },
    { zone: 'lounge', at: { x: 10, y: 8 } },
    { zone: 'highlimit', at: { x: 3, y: 11 } },
    { zone: 'highlimit', at: { x: 3, y: 18 } },
    { zone: 'penthouse', at: { x: 4, y: 2.5 } },
    { zone: 'penthouse', at: { x: 10, y: 3 } }
]

// ── lookups ────────────────────────────────────────────────────────────────

const AREA_GRID: (Area | null)[] = (() => {
    const grid: (Area | null)[] = Array.from({ length: GRID_W * GRID_H }, () => null)
    for (const id of ZONE_ORDER) {
        const r = ZONE_RECTS[id]
        for (let x = r.x; x < r.x + r.w; x++) {
            for (let y = r.y; y < r.y + r.h; y++) grid[y * GRID_W + x] = id
        }
    }
    for (const t of PORCH) grid[t.y * GRID_W + t.x] = 'porch'
    return grid
})()

export function inGrid(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H
}

export function areaAt(x: number, y: number): Area | null {
    if (!inGrid(x, y)) return null
    return AREA_GRID[y * GRID_W + x] ?? null
}

export function zoneAt(x: number, y: number): ZoneId | null {
    const area = areaAt(x, y)
    return area === 'porch' ? null : area
}

export function inRect(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h
}

/** The doorway (if any) on the edge between two orthogonally adjacent tiles. */
export function doorwayBetween(ax: number, ay: number, bx: number, by: number): Doorway | null {
    for (const door of DOORWAYS) {
        if (door.axis === 'x' && ay === by && Math.max(ax, bx) === door.at && Math.min(ax, bx) === door.at - 1 && ay >= door.from && ay < door.to) return door
        if (door.axis === 'y' && ax === bx && Math.max(ay, by) === door.at && Math.min(ay, by) === door.at - 1 && ax >= door.from && ax < door.to) return door
    }
    return null
}

/** Tiles on the front side of a doorway. */
export function doorFrontTiles(door: Doorway): Tile[] {
    const out: Tile[] = []
    for (let i = door.from; i < door.to; i++) out.push(door.axis === 'x' ? { x: door.at, y: i } : { x: i, y: door.at })
    return out
}

/** Tiles on the back side of a doorway. */
export function doorBackTiles(door: Doorway): Tile[] {
    const out: Tile[] = []
    for (let i = door.from; i < door.to; i++) out.push(door.axis === 'x' ? { x: door.at - 1, y: i } : { x: i, y: door.at - 1 })
    return out
}

export interface SaleSpot {
    door: Doorway
    /** The sign's tile, on the owned side of the doorway. */
    sign: Tile
    /** Where the avatar stands to read it. */
    stand: Tile
}

/**
 * Where a zone's FOR SALE sign stands: in a doorway from an owned zone,
 * preferring the zone it requires. The sign takes the first doorway tile on
 * the owned side, the avatar stands on the second.
 */
export function saleSpot(zone: ZoneId, owned: ReadonlySet<ZoneId>): SaleSpot | null {
    const required = ZONES.find(z => z.id === zone)?.requires ?? null
    const candidates = DOORWAYS.filter((door) => {
        const other = door.front === zone ? door.back : door.back === zone ? door.front : null
        return other && other !== 'porch' && owned.has(other)
    })
    candidates.sort((a, b) => {
        const pa = a.front === required || a.back === required ? 0 : 1
        const pb = b.front === required || b.back === required ? 0 : 1
        return pa - pb
    })
    const door = candidates[0]
    if (!door) return null
    const ownedTiles = door.front === zone ? doorBackTiles(door) : doorFrontTiles(door)
    return { door, sign: ownedTiles[0]!, stand: ownedTiles[1] ?? ownedTiles[0]! }
}

/** The bounding box of some zones in grid space. */
export function zonesBounds(ids: Iterable<ZoneId>): Rect | null {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const id of ids) {
        const r = ZONE_RECTS[id]
        minX = Math.min(minX, r.x)
        minY = Math.min(minY, r.y)
        maxX = Math.max(maxX, r.x + r.w)
        maxY = Math.max(maxY, r.y + r.h)
    }
    if (!Number.isFinite(minX)) return null
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
