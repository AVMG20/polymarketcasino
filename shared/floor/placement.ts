import { findDecor, type DecorType, type OwnedDecor } from '../decor'
import { findTycoonGame, type ZoneId } from '../tycoon'
import {
    ARCH_SIZE,
    CAGE,
    DESK,
    DOORWAYS,
    GRID_H,
    GRID_W,
    PORCH,
    PROPS,
    SPAWN,
    ZONE_RECTS,
    doorBackTiles,
    doorFrontTiles,
    frontRow,
    homeSpot,
    inGrid,
    inRect,
    zoneAt,
    type Rect,
    type Tile
} from './layout'
import { NavGrid } from './nav'

/**
 * Where things stand on the floor. Every game has a home spot (its old fixed
 * plot, layout.ts) and can be moved to any free spot in a room the player
 * owns, or (built, not under construction) put away; decorations are placed
 * and put away the same way. One pure check
 * (`placementProblem`) is shared by the server (POST /api/tycoon/place and
 * /decor), the floor engine (the ghost turns red) and the floor socket's
 * walk grid, so they always agree.
 *
 * A spot is fine when the whole footprint lies in one room the player owns,
 * off every doorway tile (both sides, doorways to unowned rooms too: the FOR
 * SALE signs stand there) and the porch, on nothing else, off every piece's
 * front (where guests stand), with a game's own front on open floor in the
 * same room, and when afterwards every front and every doorway tile of the
 * owned rooms can still be walked to from the entrance.
 */

/** What stands where, as the server stores it. */
export interface LayoutState {
    zones: readonly ZoneId[]
    /** The origin (top-left tile) of every game standing on the floor: built or under construction. */
    games: Readonly<Record<string, Tile>>
    /** Placed decorations only (put-away ones are not on the floor). */
    decor: readonly { id: number, type: DecorType, x: number, y: number }[]
}

/** One thing on the floor. */
export interface LayoutPiece {
    /** `game:<slug>`, `decor:<id>`, `cage`, `desk`. */
    key: string
    rect: Rect
    /** False for a rug: guests walk over it, and it may lie under nothing else. */
    blocks: boolean
    /** Tiles that must stay walkable and reachable (a game's front row, the cage's and desk's front). */
    front: Tile[]
}

export interface LayoutInput {
    zones: readonly ZoneId[]
    pieces: LayoutPiece[]
}

/** What is being placed: a built game, a decoration the casino owns, or one being bought (no id yet). */
export type PlaceTarget =
    | { kind: 'game', id: string }
    | { kind: 'decor', id?: number, type: DecorType }

// ── Building a layout ────────────────────────────────────────────────────

/** The fixed pieces: the cashier cage and the builder's desk. */
function fixedPieces(): LayoutPiece[] {
    return [
        { key: 'cage', rect: { ...CAGE.rect }, blocks: true, front: [{ ...CAGE.front }] },
        { key: 'desk', rect: { ...DESK.rect }, blocks: true, front: [{ ...DESK.front }] }
    ]
}

/** The piece a target makes with its origin at `at`. */
function pieceOf(target: PlaceTarget, at: Tile): LayoutPiece {
    const rect = targetRect(target, at)
    if (target.kind === 'game') return { key: `game:${target.id}`, rect, blocks: true, front: frontRow(rect) }
    return { key: target.id === undefined ? 'new' : `decor:${target.id}`, rect, blocks: findDecor(target.type)?.blocks ?? true, front: [] }
}

/** Everything on the floor, ready for `placementProblem` and `NavGrid`. */
export function layoutOf(state: LayoutState): LayoutInput {
    const pieces = fixedPieces()
    for (const [slug, at] of Object.entries(state.games)) {
        if (findTycoonGame(slug)) pieces.push(pieceOf({ kind: 'game', id: slug }, at))
    }
    for (const item of state.decor) {
        if (findDecor(item.type)) pieces.push(pieceOf({ kind: 'decor', id: item.id, type: item.type }, item))
    }
    return { zones: [...state.zones], pieces }
}

/** What `layoutStateOf` reads of a casino (a TycoonState, a server casino or a visit). */
export interface LayoutSource {
    zones: readonly ZoneId[]
    games: Readonly<Record<string, number>>
    /** Running constructions: a game being built for the first time already stands on the floor. */
    constructions?: readonly { kind: string, id: string }[]
    /** Stored spots; a game without one stands at its home spot. */
    placements?: Readonly<Record<string, Tile>>
    /** Built games put away: not on the floor (never at their home spot either). */
    storedGames?: readonly string[]
    decor?: readonly OwnedDecor[]
}

/**
 * The layout of a casino: every game built or under construction at its
 * stored spot (else its home spot), the put-away ones left out, and the
 * placed decorations.
 */
export function layoutStateOf(source: LayoutSource): LayoutState {
    const games: Record<string, Tile> = {}
    const onFloor = new Set<string>()
    for (const [slug, level] of Object.entries(source.games)) if (level >= 1) onFloor.add(slug)
    for (const c of source.constructions ?? []) if (c.kind === 'game') onFloor.add(c.id)
    for (const slug of source.storedGames ?? []) onFloor.delete(slug)
    for (const slug of onFloor) {
        const at = source.placements?.[slug] ?? homeSpot(slug)
        if (at && findTycoonGame(slug)) games[slug] = { x: at.x, y: at.y }
    }
    const decor = (source.decor ?? []).flatMap(item => (item.x !== null && item.y !== null ? [{ id: item.id, type: item.type, x: item.x, y: item.y }] : []))
    return { zones: [...source.zones], games, decor }
}

/** The rect a game or a decoration takes with its origin at `at`. */
export function targetRect(target: PlaceTarget, at: Tile): Rect {
    if (target.kind === 'game') {
        const game = findTycoonGame(target.id)
        const size = game ? ARCH_SIZE[game.archetype] : { w: 1, h: 1 }
        return { x: at.x, y: at.y, w: size.w, h: size.h }
    }
    const def = findDecor(target.type)
    return { x: at.x, y: at.y, w: def?.w ?? 1, h: def?.h ?? 1 }
}

// ── The check ────────────────────────────────────────────────────────────

let doorTiles: Uint8Array | null = null

/** Doorway tiles (both sides of every doorway) and the porch: nothing may stand there. */
function doorMask(): Uint8Array {
    if (doorTiles) return doorTiles
    const mask = new Uint8Array(GRID_W * GRID_H)
    for (const door of DOORWAYS) {
        for (const t of [...doorFrontTiles(door), ...doorBackTiles(door)]) if (inGrid(t.x, t.y)) mask[t.y * GRID_W + t.x] = 1
    }
    for (const t of PORCH) mask[t.y * GRID_W + t.x] = 1
    doorTiles = mask
    return mask
}

function isDoorTile(t: Tile): boolean {
    return inGrid(t.x, t.y) && doorMask()[t.y * GRID_W + t.x] === 1
}

function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function tilesOf(rect: Rect): Tile[] {
    const out: Tile[] = []
    for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) out.push({ x, y })
    }
    return out
}

/** Every tile walkable from the entrance (8 directions, no corner cutting), as a mask. */
function reachableFrom(nav: NavGrid, from: Tile): Uint8Array {
    const seen = new Uint8Array(GRID_W * GRID_H)
    const queue: number[] = [from.y * GRID_W + from.x]
    seen[queue[0]!] = 1
    for (let head = 0; head < queue.length; head++) {
        const i = queue[head]!
        const cx = i % GRID_W
        const cy = Math.floor(i / GRID_W)
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (!dx && !dy) continue
                const nx = cx + dx
                const ny = cy + dy
                if (!inGrid(nx, ny)) continue
                const ni = ny * GRID_W + nx
                if (seen[ni] || !nav.canMove(cx, cy, dx, dy)) continue
                seen[ni] = 1
                queue.push(ni)
            }
        }
    }
    return seen
}

/** The doorway tiles inside the owned rooms: the way into every room (and to every FOR SALE sign) must stay open. */
function ownedDoorTiles(owned: ReadonlySet<ZoneId>): Tile[] {
    const out: Tile[] = []
    for (const door of DOORWAYS) {
        for (const t of [...doorFrontTiles(door), ...doorBackTiles(door)]) {
            const zone = zoneAt(t.x, t.y)
            if (zone && owned.has(zone)) out.push(t)
        }
    }
    return out
}

/**
 * The tiles that must be reachable but aren't (`x,y` keys): every front and
 * every owned doorway tile that can't be walked to from the entrance.
 */
export function unreachableTiles(layout: LayoutInput): Set<string> {
    const nav = new NavGrid(layout)
    const seen = reachableFrom(nav, SPAWN)
    const need = [...layout.pieces.flatMap(piece => piece.front), ...ownedDoorTiles(new Set(layout.zones))]
    const out = new Set<string>()
    for (const t of need) if (!inGrid(t.x, t.y) || seen[t.y * GRID_W + t.x] !== 1) out.add(`${t.x},${t.y}`)
    return out
}

/** Whether every front and every owned doorway tile can be walked to from the entrance. */
export function layoutReachable(layout: LayoutInput): boolean {
    return unreachableTiles(layout).size === 0
}

const cutOffCache = new Map<string, Set<string>>()
const CUT_OFF_CACHE_SIZE = 64

/** `unreachableTiles` of a layout, remembered for a while (a spot search checks one layout hundreds of times). */
function cutOffNow(layout: LayoutInput): Set<string> {
    const key = signature(layout)
    const hit = cutOffCache.get(key)
    if (hit) return hit
    const tiles = unreachableTiles(layout)
    if (cutOffCache.size >= CUT_OFF_CACHE_SIZE) cutOffCache.delete(cutOffCache.keys().next().value!)
    cutOffCache.set(key, tiles)
    return tiles
}

function knownTarget(target: PlaceTarget): boolean {
    return target.kind === 'game' ? !!findTycoonGame(target.id) : !!findDecor(target.type)
}

/**
 * Why `target` can't stand with its origin at `at`, in a few plain words
 * ("Blocks a doorway", "Not in a room you own", "Something is in the way"),
 * or null when it can. The item's own current spot is ignored (moving it a
 * tile is fine).
 */
export function placementProblem(layout: LayoutInput, target: PlaceTarget, at: Tile): string | null {
    if (!knownTarget(target)) return 'Unknown item'
    if (!Number.isInteger(at.x) || !Number.isInteger(at.y)) return 'Not in a room you own'
    const piece = pieceOf(target, at)
    const owned = new Set(layout.zones)
    const tiles = tilesOf(piece.rect)
    let zone: ZoneId | null = null
    for (const t of tiles) {
        const here = zoneAt(t.x, t.y)
        if (!here || !owned.has(here)) return 'Not in a room you own'
        if (zone && here !== zone) return 'Keep it inside one room'
        zone = here
    }
    // A flat piece (a rug, the red carpet) is walked over: it may lie in a doorway or where guests
    // stand in front of a game, and a game's front may reach over it. It still can't overlap anything.
    if (piece.blocks && tiles.some(isDoorTile)) return 'Keep the doorways clear'
    const others = layout.pieces.filter(p => p.key !== piece.key)
    if (others.some(p => overlaps(p.rect, piece.rect))) return 'Something is in the way'
    if (piece.blocks && others.some(p => p.front.some(t => inRect(piece.rect, t.x, t.y)))) return 'Blocks where guests stand'
    for (const t of piece.front) {
        if (zoneAt(t.x, t.y) !== zone || isDoorTile(t) || others.some(p => p.blocks && inRect(p.rect, t.x, t.y))) return 'Needs open floor in front'
    }
    // A rug blocks nothing: taking it away or putting it down can't cut anything off. Otherwise the move
    // may cut nothing off that is reachable now: a floor that is already cut off somewhere (an odd old
    // layout) can still be fixed one move at a time, and no move makes it worse.
    if (piece.blocks) {
        const after = unreachableTiles({ zones: layout.zones, pieces: [...others, piece] })
        if (after.size) {
            const before = cutOffNow(layout)
            for (const t of after) if (!before.has(t)) return 'Blocks the way through'
        }
    }
    return null
}

// ── Finding a spot ───────────────────────────────────────────────────────

/**
 * The first free spot for `target` in the owned rooms, nearest to `near`
 * first (ties: top row first, then left), or null when there is none. The
 * same layout and target always give the same spot.
 */
export function findSpot(layout: LayoutInput, target: PlaceTarget, near: Tile): Tile | null {
    const owned = new Set(layout.zones)
    const candidates: Tile[] = []
    for (const zone of owned) {
        const r = ZONE_RECTS[zone]
        if (!r) continue
        for (let y = r.y; y < r.y + r.h; y++) {
            for (let x = r.x; x < r.x + r.w; x++) candidates.push({ x, y })
        }
    }
    const d = (t: Tile) => (t.x - near.x) ** 2 + (t.y - near.y) ** 2
    candidates.sort((a, b) => d(a) - d(b) || a.y - b.y || a.x - b.x)
    for (const at of candidates) if (placementProblem(layout, target, at) === null) return at
    return null
}

const spotCache = new Map<string, Tile | null>()
const SPOT_CACHE_SIZE = 256

function signature(layout: LayoutInput): string {
    return `${layout.zones.join(',')}|${layout.pieces.map(p => `${p.key}@${p.rect.x},${p.rect.y},${p.rect.w},${p.rect.h}${p.blocks ? '' : 'r'}`).join(';')}`
}

/**
 * Where a game not on the floor yet would stand when built: its home spot
 * when that lies in an owned room and is free, else the free spot nearest to
 * it in an owned room; null when no owned room has space for it (build
 * nothing, or move things first). The server stores this spot when the
 * first build starts; the floor draws an unbuilt game's "build here" plot
 * here (null: not drawn).
 */
export function buildSpot(layout: LayoutInput, slug: string): Tile | null {
    const home = homeSpot(slug)
    if (!home || !findTycoonGame(slug)) return null
    const key = `${slug}|${signature(layout)}`
    if (spotCache.has(key)) {
        const hit = spotCache.get(key)!
        return hit ? { ...hit } : null
    }
    const target: PlaceTarget = { kind: 'game', id: slug }
    const spot = placementProblem(layout, target, home) === null ? home : findSpot(layout, target, home)
    if (spotCache.size >= SPOT_CACHE_SIZE) spotCache.delete(spotCache.keys().next().value!)
    spotCache.set(key, spot)
    return spot ? { ...spot } : null
}

/** The middle tile of a room (where a decoration with no spot in mind is looked for). */
export function roomCentre(zone: ZoneId): Tile {
    const r = ZONE_RECTS[zone]
    return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) }
}

// ── Free furniture ───────────────────────────────────────────────────────

/** A piece of free furniture due to a casino: placed at `at`, or put away (null) when its old spot is taken. */
export interface FurnitureGrant {
    /** Unique per casino (`PropLayout.key`): a grant is given once, whatever happens to it later. */
    key: string
    type: DecorType
    at: Tile | null
}

/**
 * The free furniture (layout.ts PROPS) a casino is due and hasn't been given
 * yet: every piece of every owned room. Each goes to its old spot when that
 * is a fine spot now (checked against the layout and the pieces placed
 * before it), else into storage.
 */
export function furnitureGrants(layout: LayoutInput, given: ReadonlySet<string>): FurnitureGrant[] {
    const owned = new Set(layout.zones)
    const pieces = [...layout.pieces]
    const out: FurnitureGrant[] = []
    for (const prop of PROPS) {
        if (given.has(prop.key) || !owned.has(prop.zone)) continue
        const type = prop.kind as DecorType
        if (!findDecor(type)) continue
        const at = { x: prop.rect.x, y: prop.rect.y }
        const target: PlaceTarget = { kind: 'decor', type }
        const fits = placementProblem({ zones: layout.zones, pieces }, target, at) === null
        if (fits) pieces.push({ ...pieceOf(target, at), key: `grant:${prop.key}` })
        out.push({ key: prop.key, type, at: fits ? at : null })
    }
    return out
}
