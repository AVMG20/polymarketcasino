import type { Application, ColorMatrixFilter, Container, Graphics, Sprite, Ticker } from 'pixi.js'
import { formatCoins } from '#shared/money'
import { ZONES, type ZoneId } from '#shared/tycoon'
import { DEFAULT_SKIN, type AvatarLook, type SkinId } from '#shared/cosmetics'
import { Actor, figureFrames, figureKeys, makeNameTag, type NameTag } from './actors'
import { TextureBank, type Baked } from './art/bank'
import { PLAYER_LOOK_PREFIX, avatarLook, lookKey } from './art/characters'
import { drawBackdrop, drawBuildingShadow, drawPillar, drawPorch, drawWall, drawZoneFloor, rectBounds, sconceLight, wallHeight, wallKey, WALL_T, type WallLook, type WallVariant, type ZoneLook } from './art/floor'
import { bakeFx, type FxTextures } from './art/fx'
import { CHIP_TINT, COIN_TINT, CONFETTI } from './art/palette'
import { CHANDELIER_LIGHT, CHANDELIER_Z, LAMP_POST_LIGHT, drawChandelier, drawDoorRope, drawLampPost } from './art/props'
import { decorSize } from './art/decor'
import { ArrangeController, arrangeKey, type ArrangeEvents } from './arrange'
import { DecorView, decorTexture } from './decor-view'
import { Camera, FloorInput } from './camera'
import { rankStatics, tileRanks, type DepthBox } from './depth'
import { FloatTexts, Particles, coinBurst } from './effects'
import { GuestCrowd, type GuestSpot } from './guests'
import { StaffCrew } from './staff'
import { HH, HW, footprintCanvas, hashString, project, unproject, type Pt } from './iso'
import {
    ARCH_SIZE, CAGE, CHANDELIERS, DESK, DOORWAYS, GRID_H, GRID_W, PLOTS, PORCH, SPAWN, ZONE_RECTS, ZONE_ORDER,
    areaAt, doorwayBetween, frontRow, plotAt, saleSpot, zoneAt, zonesBounds, type PlotLayout, type Rect, type Tile
} from '#shared/floor/layout'
import { NavGrid } from '#shared/floor/nav'
import { layoutOf, placementProblem, type LayoutInput, type LayoutState, type PlaceTarget } from '#shared/floor/placement'
import { Picker } from './pick'
import { VISITOR_TIER_IDS, type VisitorCounts, type VisitorTierId } from '#shared/visitors'
import { TIERS } from '~/utils/visitor-tiers'
import { MAX_GUESTS, MAX_REMOTES, type ArrangeItem, type ArrangeState, type FloorApi, type FloorCollectOptions, type FloorFocusOptions, type FloorMove, type FloorPlot, type FloorRemote, type FloorScene, type FloorTarget } from './types'
import { CageView, DeskView, PlotView, SaleSignView, machineTexture, plotKey, type PlotShow, type ViewContext } from './views'

type Pixi = typeof import('pixi.js')

export interface FloorEngineOptions {
    PIXI: Pixi
    app: Application
    /** The element pointer input listens on (the canvas). */
    input: HTMLElement
    onInteract: (target: FloorTarget) => void
    reducedMotion: boolean
    /** Display names per game slug (signs on the machines). */
    names: Record<string, string>
    /** Where the camera and avatar were in a previous engine (rebuilt after a lost WebGL context). */
    resume?: FloorView | null
    /** Rendering threw (corrupted renderer state): the owner rebuilds the floor. Called once. */
    onRenderError?: (error: unknown) => void
    /** The avatar set off for a tile or was put on one (live presence tells the room). */
    onMove?: (move: FloorMove) => void
    /** Arrange mode: an item picked up, the ghost moved, put down, or the carry given up (Esc). */
    onArrange?: Partial<ArrangeEvents>
}

/** Camera and avatar position, carried over when the engine is rebuilt. */
export interface FloorView {
    camera: { x: number, y: number, zoom: number }
    player: { x: number, y: number }
}

/** Canvas pixels per world pixel for baked art: sharp on Retina, cheaper on phones. */
function bakeResolution(app: Application): number {
    const r = app.renderer.resolution || 1
    const small = Math.min(app.screen.width, app.screen.height) < 520
    return small ? Math.min(1.5, Math.max(1, r)) : Math.min(2, Math.max(1.5, r))
}

interface Static {
    id: string
    box: DepthBox
    view: Container
}

interface Interactable {
    target: FloorTarget
    stand: Tile
    face: { x: number, y: number }
    /** Grid footprint (drawn as the hover outline). */
    rect: Rect | null
    /** Where the camera looks when focusing it (world). */
    center: Pt
}

/** What a click at a screen point does. */
type Click =
    | { kind: 'use', it: Interactable }
    | { kind: 'walk', tile: Tile }
    | { kind: 'what' }
    | { kind: 'none' }

function targetKey(t: FloorTarget): string {
    return t.kind === 'game' || t.kind === 'zone' ? `${t.kind}:${t.id}` : t.kind
}

/** A label name tags keep clear of: its node and its local bounds (world box = position + bounds × scale). */
interface LabelBox {
    node: Container
    /** Overlay labels grow with the label scale; signs in the world don't. */
    scaled: boolean
    minX: number
    minY: number
    maxX: number
    maxY: number
}

/** A name tag over a label fades to this and shrinks by TAG_SHRINK, so the label reads. */
const TAG_FADED = 0.18
const TAG_SHRINK = 0.82

/** Offsets tried around a finger tap that missed (screen px). */
const TOUCH_RING: [number, number][] = [[0, -7], [7, 0], [0, 7], [-7, 0], [5, -5], [5, 5], [-5, 5], [-5, -5]]

const ZONE_NAMES = Object.fromEntries(ZONES.map(z => [z.id, z.name])) as Record<ZoneId, string>

/**
 * Visit mode, owner away: where they doze, beside their builder desk facing
 * the entrance. Games and decorations can stand there now, so the engine
 * takes the nearest free tile to it (`ownerSpot`).
 */
const OWNER_HOME: Tile = { x: DESK.rect.x + DESK.rect.w, y: DESK.rect.y }
const OWNER_FACE: Tile = { x: OWNER_HOME.x + 2, y: OWNER_HOME.y + 2 }

/** Another player on the floor, as drawn. */
interface RemoteView {
    actor: Actor
    seq: number
    look: string
}

/** Canvas origin moved so grid (sx, sy) of the footprint becomes the art's origin. */
function shifted(c: { ox: number, oy: number }, sx: number, sy: number): { ox: number, oy: number } {
    return { ox: c.ox + (sx - sy) * HW, oy: c.oy + (sx + sy) * HH }
}

function boxOf(rect: Rect, height: number): DepthBox {
    return { minX: rect.x, minY: rect.y, maxX: rect.x + rect.w, maxY: rect.y + rect.h, height }
}

/** Where a plot stands (an older scene without rects: its home spot). */
function plotRect(plot: FloorPlot): Rect | null {
    if (plot.rect !== undefined) return plot.rect
    return PLOTS[plot.id]?.rect ?? null
}

/** Built or being built: it stands on the floor (and can be moved). */
function standing(plot: FloorPlot): boolean {
    return plot.status === 'built' || plot.status === 'building'
}

/** A plot's layout at its rect: the avatar's tile in front, the guests' spots. */
function plotLayout(plot: FloorPlot, rect: Rect): PlotLayout {
    const at = plotAt(plot.id, rect)
    if (at) return at
    return { id: plot.id, zone: plot.zone, archetype: plot.archetype, rect, front: { x: rect.x + Math.floor((rect.w - 1) / 2), y: rect.y + rect.h }, spots: frontRow(rect) }
}

/** What stands where in a scene, as placement.ts reads it. */
function sceneLayout(scene: FloorScene, owned: ReadonlySet<ZoneId>): LayoutState {
    const games: Record<string, Tile> = {}
    for (const plot of scene.plots) {
        const r = plotRect(plot)
        if (r && standing(plot)) games[plot.id] = { x: r.x, y: r.y }
    }
    return { zones: [...owned], games, decor: (scene.decorations ?? []).map(d => ({ id: d.id, type: d.type, x: d.x, y: d.y })) }
}

/** The Cashier Cage upgrade level the cage is drawn at (0-5). */
function cageLevel(scene: FloorScene): number {
    return Math.max(0, Math.min(5, Math.floor(scene.cageLevel ?? 0)))
}

function sameRect(a: Rect, b: Rect): boolean {
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

const TIER_COLORS = Object.fromEntries(TIERS.map(t => [t.id, t.color])) as Record<VisitorTierId, string>
/** What a tier spends, relative (1 when the catalog has no number yet). */
const TIER_SPEND = Object.fromEntries(TIERS.map(t => [t.id, t.spend > 0 ? t.spend : 1])) as Record<VisitorTierId, number>

/** Guests to draw per tier: the counts, scaled down to MAX_GUESTS (largest remainder) on a huge floor. */
export function drawnGuests(counts: VisitorCounts): VisitorCounts {
    const clean = { tourist: 0, regular: 0, highroller: 0, whale: 0 }
    for (const id of VISITOR_TIER_IDS) clean[id] = Math.max(0, Math.round(counts[id] ?? 0))
    const total = VISITOR_TIER_IDS.reduce((sum, id) => sum + clean[id], 0)
    if (total <= MAX_GUESTS) return clean
    const scaled = VISITOR_TIER_IDS.map(id => ({ id, exact: (clean[id] * MAX_GUESTS) / total }))
    const out = { tourist: 0, regular: 0, highroller: 0, whale: 0 }
    for (const s of scaled) out[s.id] = Math.floor(s.exact)
    let left = MAX_GUESTS - VISITOR_TIER_IDS.reduce((sum, id) => sum + out[id], 0)
    for (const s of [...scaled].sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
        if (left <= 0) break
        out[s.id]++
        left--
    }
    return out
}

/** NPC count for a guest income: busier floors look busier, capped for phones. */
export function guestCount(perHour: number, rush: boolean, cap = 40): number {
    const base = Math.round(2 + Math.sqrt(Math.max(0, perHour)) * 0.6)
    return Math.min(cap, rush ? Math.round(base * 1.5) + 2 : base)
}

/**
 * The casino floor: owns the Pixi scene graph, diffs FloorScene updates into
 * it, runs characters, camera and effects on the ticker. Vue never touches
 * anything in the frame loop.
 */
export class FloorEngine implements FloorApi {
    private readonly PIXI: Pixi
    private readonly app: Application
    private readonly bank: TextureBank
    private readonly fx: FxTextures
    private readonly reduced: boolean
    private readonly onInteract: (target: FloorTarget) => void
    private readonly names: Record<string, string>

    private readonly bg: Sprite
    private readonly vignette: Sprite
    private readonly world: Container
    private readonly ground: Container
    private readonly floorFx: Container
    private readonly fog: Container
    private readonly objects: Container
    private readonly lights: Container
    private readonly overlay: Container
    private readonly fxLayer: Container
    private readonly screenFx: Container
    /** Rugs: flat decorations under everything else. */
    private readonly rugLayer: Container
    /** Arrange mode's lifted ghosts, above everything standing. */
    private readonly ghostLayer: Container

    private readonly camera: Camera
    private readonly input: FloorInput
    private readonly particles: Particles
    private readonly screenParticles: Particles
    private readonly floaters: FloatTexts
    private readonly ctx: ViewContext

    private scene: FloorScene | null = null
    private structureKey = ''
    private owned = new Set<ZoneId>()
    /** Zones drawn on the floor: all of them, so the player sees what they can grow into. */
    private readonly visible = new Set<ZoneId>(ZONE_ORDER)
    private nav: NavGrid
    /** What stands where (games, decorations, cage, desk): placement checks and the walk grid. */
    private layout: LayoutInput | null = null
    private layoutKey = ''
    /** Doorway tiles a FOR SALE sign stands on (blocked on the walk grid). */
    private saleBlocks: Tile[] = []
    private decorViews = new Map<number, DecorView>()
    private readonly arranger: ArrangeController
    /** Arrange mode: display roots and floor tiles of the movable items. */
    private arrangeRoots = new Map<Container, ArrangeItem>()
    private arrangeTiles = new Map<number, ArrangeItem>()
    private arrangeLit: Container[] = []
    /** 0..1: how far the floor has gone into arrange mode (guests fade, the avatar hides). */
    private arrangeFade = 0
    private structureViews: Container[] = []
    private structureSigns: SaleSignView[] = []
    private structureStatics: Static[] = []
    private glows: { sprite: Sprite, base: number, phase: number }[] = []
    private clouds: { sprite: Sprite, rect: Rect, vx: number, phase: number }[] = []
    private plots = new Map<string, PlotView>()
    private cage: CageView | null = null
    private cageLevel = -1
    private desk: DeskView | null = null
    private ranks = new Map<string, number>()
    private tileRank: Int32Array = new Int32Array(GRID_W * GRID_H).fill(-1)
    private saleTargets = new Map<ZoneId, Interactable>()
    private saleViews = new Map<ZoneId, SaleSignView>()
    private playingSet = new Set<string>()
    /** Picking: display roots that belong to a target (machines, their badges and labels). */
    private readonly picker: Picker
    private hitRoots = new Map<Container, string>()
    private rootsByKey = new Map<string, Container[]>()
    private targetsByKey = new Map<string, Interactable>()
    /** Floor tiles that belong to a target (a plot's footprint), by tile index. */
    private tileTargets = new Map<number, string>()
    /** Solid scenery that hides what is behind it (walls, furniture). */
    private occluders = new Set<Container>()
    private hoverKey = ''
    private hoverPos: { x: number, y: number } | null = null
    private hoverT = 0
    private hoverRoots: Container[] = []
    private readonly hoverFilter: ColorMatrixFilter
    private readonly hoverGfx: Graphics
    /** Owned zones' grid bounds (party lights), cached per structure. */
    private ownedBounds: Rect | null = null
    private rankKey = ''
    private rankCache: { rank: number[], tiles: Int32Array } | null = null
    /** Labels the walking figures' name tags give way to (cage amount, countdowns, sale signs). */
    private labelBoxes: LabelBox[] = []
    private labelsDirty = true
    private labelK = 1

    private player: Actor
    private playerArrow: Sprite
    private playerRing: Sprite
    private pending: Interactable | null = null
    private guests: GuestCrowd
    /** The Hospitality upgrade's waiters (decoration only, never guests). */
    private staff: StaffCrew
    private marker: Container
    private markerT = 1
    private party: { sprite: Sprite, phase: number, speed: number }[] = []
    private partyOn = false
    private time = 0
    private renderFailed = false
    private onRenderError: ((error: unknown) => void) | null = null
    private glowsSet = -1
    private paused = false
    private destroyed = false
    private firstScene = true
    private resume: FloorView | null = null
    private playerName = ''
    private playerLook = ''
    /** The skin each zone is drawn with (diffed so a skin change re-bakes only that zone). */
    private skins = new Map<ZoneId, SkinId>()
    /** Sprites that show a zone's skin: its floor, and its walls and pillars with their looks. */
    /** Texture keys of the floors of zones not owned (no skin). */
    private plainFloors: string[] = []
    private skinned: { sprite: Sprite, zone: ZoneId, key: (skin: SkinId) => string, bake: (skin: SkinId) => Baked }[] = []
    /** Player looks whose figure textures are in the bank, to free them when nobody wears them. */
    private figureLooks = ''
    /** Visit mode: the casino's owner, dozing by the builder desk while they are away. */
    private owner: Actor | null = null
    private ownerName = ''
    private ownerT = 0
    private ownerZzz: Container | null = null
    private ownerScene: FloorScene['owner'] = null
    /** Other players on the floor right now, by player id. */
    private remotes = new Map<string, RemoteView>()
    private ownerLive = false
    private readonly onMove: ((move: FloorMove) => void) | null
    private lastMove = ''

    constructor(opts: FloorEngineOptions) {
        const { PIXI, app } = opts
        this.PIXI = PIXI
        this.app = app
        this.reduced = opts.reducedMotion
        this.onInteract = opts.onInteract
        this.onMove = opts.onMove ?? null
        this.names = opts.names
        this.bank = new TextureBank(PIXI, bakeResolution(app))
        this.fx = bakeFx(this.bank)

        // Backdrop: a warm night gradient with a soft glow behind the building.
        const bgTex = this.bank.get('bg', () => this.bank.bake(256, 256, 0, 0, (_p, c) => drawBackdrop(c, 256)))
        this.bg = new PIXI.Sprite(bgTex.texture)
        this.bg.anchor.set(0)
        const vigTex = this.bank.get('vignette', () => this.bank.bake(128, 128, 0, 0, (_p, c) => {
            const g = c.createRadialGradient(64, 60, 20, 64, 64, 92)
            g.addColorStop(0, 'rgba(10, 5, 20, 0)')
            g.addColorStop(0.75, 'rgba(10, 5, 20, 0.06)')
            g.addColorStop(1, 'rgba(10, 5, 20, 0.34)')
            c.fillStyle = g
            c.fillRect(0, 0, 128, 128)
        }))
        this.vignette = new PIXI.Sprite(vigTex.texture)
        this.vignette.anchor.set(0)

        this.world = new PIXI.Container()
        this.ground = new PIXI.Container()
        this.floorFx = new PIXI.Container()
        this.fog = new PIXI.Container()
        this.objects = new PIXI.Container()
        this.objects.sortableChildren = true
        this.lights = new PIXI.Container()
        this.overlay = new PIXI.Container()
        this.fxLayer = new PIXI.Container()
        this.screenFx = new PIXI.Container()
        this.rugLayer = new PIXI.Container()
        this.ghostLayer = new PIXI.Container()
        this.world.addChild(this.ground, this.rugLayer, this.floorFx, this.fog, this.objects, this.lights, this.ghostLayer, this.overlay, this.fxLayer)
        app.stage.addChild(this.bg, this.world, this.vignette, this.screenFx)

        this.camera = new Camera(this.reduced)
        this.camera.resize(app.screen.width, app.screen.height)
        this.picker = new Picker(PIXI)
        this.hoverFilter = new PIXI.ColorMatrixFilter()
        this.hoverFilter.brightness(1.28, false)
        this.hoverGfx = new PIXI.Graphics()
        this.input = new FloorInput(opts.input, this.camera, {
            tap: (x, y, touch) => this.tap(x, y, touch),
            hover: (x, y) => {
                this.hoverPos = { x, y }
                return this.hover(x, y)
            },
            hoverEnd: () => {
                this.hoverPos = null
                this.setHover(null)
                this.arranger?.hoverEnd()
            },
            press: (x, y, touch) => this.arranger.press(x, y, touch),
            drag: (x, y) => this.arranger.drag(x, y),
            release: (x, y, moved) => this.arranger.release(x, y, moved),
            dragCancel: () => this.arranger.dragCancel()
        })
        this.particles = new Particles(PIXI, this.fxLayer, this.reduced ? 80 : 260)
        this.screenParticles = new Particles(PIXI, this.screenFx, 60)
        this.floaters = new FloatTexts(PIXI, this.fxLayer)

        this.ctx = {
            PIXI,
            bank: this.bank,
            fx: this.fx,
            floorLayer: this.floorFx,
            overlay: this.overlay,
            reduced: this.reduced,
            names: this.names,
            now: () => Date.now() + (this.scene?.clockOffset ?? 0)
        }

        this.nav = new NavGrid({ zones: ['backroom'], pieces: [] })
        const events = opts.onArrange ?? {}
        this.arranger = new ArrangeController({
            PIXI,
            fx: this.fx,
            camera: this.camera,
            particles: this.particles,
            reduced: this.reduced,
            floorLayer: this.floorFx,
            ghostLayer: this.ghostLayer,
            owned: () => this.owned,
            itemAt: (sx, sy, touch) => this.itemAt(sx, sy, touch),
            itemRect: item => this.itemRect(item),
            itemSize: item => this.itemSize(item),
            itemArt: item => this.itemArt(item),
            itemFront: (item, at) => item.kind === 'game' ? frontRow({ ...at, ...this.itemSize(item) }) : [],
            problem: (item, at) => this.itemProblem(item, at),
            setHidden: (key, hidden) => this.setItemHidden(key, hidden),
            highlight: item => this.arrangeHighlight(item),
            landed: (item, at, known) => this.landed(item, at, known),
            decorIds: () => new Set((this.scene?.decorations ?? []).map(d => d.id)),
            events: {
                pick: item => events.pick?.(item),
                hover: (at, problem) => events.hover?.(at, problem),
                drop: (item, at) => events.drop?.(item, at),
                cancel: () => events.cancel?.()
            }
        })

        // The player's avatar starts on the porch and walks in.
        this.player = new Actor(PIXI, figureFrames(this.bank, avatarLook('player')), this.fx, SPAWN)
        this.playerRing = new PIXI.Sprite(this.fx.ring.texture)
        this.playerRing.anchor.set(0.5)
        this.playerRing.tint = 0xffd23f
        this.playerRing.alpha = 0.7
        this.playerRing.scale.set(0.62)
        this.player.container.addChildAt(this.playerRing, 1)
        this.playerArrow = new PIXI.Sprite(this.fx.arrow.texture)
        this.playerArrow.anchor.set(0.5, 1)
        this.player.container.addChild(this.playerArrow)
        this.objects.addChild(this.player.container)

        this.guests = new GuestCrowd(PIXI, this.bank, this.fx, this.objects, this.overlay, this.reduced)
        this.guests.onEarn = (x, y, amount) => this.guestEarned(x, y, amount)
        this.staff = new StaffCrew(PIXI, this.bank, this.fx, this.objects, this.reduced)

        // Click marker: a ring and an X, yellow for walking, red for using.
        this.marker = new PIXI.Container()
        const ring = new PIXI.Sprite(this.fx.ring.texture)
        ring.anchor.set(0.5)
        const cross = new PIXI.Sprite(this.fx.cross.texture)
        cross.anchor.set(0.5)
        this.marker.addChild(ring, cross)
        this.marker.visible = false
        this.floorFx.addChild(this.hoverGfx, this.marker)

        for (let i = 0; i < 6; i++) {
            const s = new PIXI.Sprite(this.fx.pool.texture)
            s.anchor.set(0.5)
            s.blendMode = 'add'
            s.scale.set(2.6)
            s.alpha = 0
            s.tint = CONFETTI[i % CONFETTI.length]!
            this.floorFx.addChild(s)
            this.party.push({ sprite: s, phase: i * 1.3, speed: 0.25 + Math.random() * 0.2 })
        }

        if (opts.resume) {
            // The camera is restored on the first scene, once the bounds are known.
            this.resume = opts.resume
            this.player.x = opts.resume.player.x
            this.player.y = opts.resume.player.y
            this.player.place()
            this.announce(false)
        }

        this.resize(app.screen.width, app.screen.height)
        app.ticker.add(this.tick, this)
        // Render through a guard instead of the Application's own listener: a throwing
        // render would otherwise repeat every frame and leave the canvas empty.
        this.onRenderError = opts.onRenderError ?? null
        app.ticker.remove(app.render, app)
        app.ticker.add(this.renderFrame, this, PIXI.UPDATE_PRIORITY.LOW)
    }

    private renderFrame() {
        if (this.destroyed || this.renderFailed) return
        try {
            this.app.render()
        } catch (err) {
            this.failRender(err)
        }
    }

    private failRender(err: unknown) {
        if (this.renderFailed) return
        this.renderFailed = true
        console.error('[floor] render failed', err)
        this.app.ticker.stop()
        this.onRenderError?.(err)
    }

    /** Camera and avatar position, to hand to a rebuilt engine. */
    view(): FloorView {
        return { camera: { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom }, player: { x: this.player.x, y: this.player.y } }
    }

    // ── scene ─────────────────────────────────────────────────────────────

    setScene(scene: FloorScene) {
        if (this.destroyed) return
        this.scene = scene
        const look = avatarLook(scene.player.name || 'player', scene.player.avatar)
        if (scene.player.name && lookKey(look) !== this.playerLook) {
            this.playerLook = lookKey(look)
            this.player.setFrames(figureFrames(this.bank, look))
        }
        if (scene.player.name && scene.player.name !== this.playerName) {
            this.playerName = scene.player.name
            this.player.tag?.destroy({ children: true })
            this.player.tag = makeNameTag(this.PIXI, scene.player.name, true)
            this.overlay.addChild(this.player.tag)
            this.player.place()
        }
        this.ownerScene = scene.owner ?? null
        this.syncOwner()
        const owned = new Set(scene.zones.filter(z => z.owned).map(z => z.id))
        if (!owned.size) owned.add('backroom')
        const key = JSON.stringify([
            [...owned].sort(),
            scene.zones.map(z => [z.id, z.available, z.construction?.readyAt ?? 0, z.construction?.startedAt ?? 0]),
            Math.max(0, Math.min(5, Math.round(scene.decor))),
            cageLevel(scene)
        ])
        const skins = new Map(scene.zones.map(z => [z.id, owned.has(z.id) ? z.skin ?? DEFAULT_SKIN : DEFAULT_SKIN] as const))
        const layoutState = sceneLayout(scene, owned)
        const layoutKey = JSON.stringify(layoutState)
        const moved = layoutKey !== this.layoutKey
        if (moved) {
            this.layoutKey = layoutKey
            this.layout = layoutOf(layoutState)
        }
        if (key !== this.structureKey) {
            const grew = !this.firstScene && owned.size > this.owned.size
            this.structureKey = key
            this.owned = owned
            this.ownedBounds = zonesBounds(owned)
            this.skins = skins
            this.buildStructure(scene)
            if (grew) this.frameOwned(true)
        } else {
            this.reskin(skins)
            // Something moved: a new walk grid (guests re-path), views at their new spots.
            if (moved) this.rebuildNav()
            const decor = this.syncDecor(scene)
            this.syncPlots(scene, moved || decor)
        }
        this.arranger.sceneChanged()
        this.pruneFigures()
        this.setCage(scene.cage.fill, scene.cage.stored)
        this.partyOn = scene.rush
        const mix = drawnGuests(scene.visitors ?? { tourist: guestCount(scene.guestsPerHour, scene.rush), regular: 0, highroller: 0, whale: 0 })
        this.guests.setMix(mix, TIER_COLORS, scene.rush)
        this.staff.setLevel(scene.hospitality ?? 0)
        // Playing guests pop coins off their machines, labelled with their real share of the income (by what their tier spends).
        const weight = VISITOR_TIER_IDS.reduce((sum, id) => sum + mix[id] * TIER_SPEND[id], 0)
        const perUnit = weight > 0 ? Math.max(0, scene.guestsPerHour) / weight / 3600 : 0
        this.guests.earnPerSec = { tourist: perUnit * TIER_SPEND.tourist, regular: perUnit * TIER_SPEND.regular, highroller: perUnit * TIER_SPEND.highroller, whale: perUnit * TIER_SPEND.whale }
        if (this.firstScene) {
            this.firstScene = false
            if (this.resume) {
                const c = this.resume.camera
                this.camera.jumpTo(c.x, c.y, c.zoom)
                this.resume = null
            } else {
                this.frameOwned(false)
                const path = this.nav.findPath(SPAWN, { x: 18, y: 19 })
                if (path) this.player.walk(path)
                this.announce(!!path)
            }
        }
    }

    /**
     * Visit mode: the casino's owner. On the floor, they are a live figure
     * (setRemotes); away, they doze by their builder desk (or, on your own
     * floor, there is no one).
     */
    private syncOwner() {
        const owner = this.ownerLive ? null : this.ownerScene ?? null
        const name = owner ? `${owner.name}\u0001${lookKey(avatarLook(owner.name, owner.avatar))}` : ''
        if (name === this.ownerName) return
        this.ownerName = name
        this.owner?.destroy()
        this.owner = null
        this.ownerZzz = null
        if (!owner) return
        this.owner = new Actor(this.PIXI, figureFrames(this.bank, avatarLook(owner.name, owner.avatar)), this.fx, this.ownerSpot())
        this.owner.tag = makeNameTag(this.PIXI, owner.name, false)
        this.overlay.addChild(this.owner.tag)
        this.objects.addChild(this.owner.container)
        this.owner.face(OWNER_FACE)
        // Away: a little dimmer, a softer tag, and a Zzz.
        this.owner.body.tint = 0xc9c0d6
        this.owner.tag.alpha = 0.8
        // The Z's float off the end of the name tag (above it in the overlay, never hidden by it).
        this.ownerZzz = this.makeZzz()
        this.ownerZzz.position.set(this.owner.tag.halfW + 5, -2)
        this.owner.tag.addChild(this.ownerZzz)
        this.owner.place()
        this.ownerT = 0
    }

    /** Three Z's that drift up from a dozing figure's head. */
    private makeZzz(): Container {
        const { PIXI } = this
        const box = new PIXI.Container()
        for (let i = 0; i < 3; i++) {
            const z = new PIXI.Text({
                text: 'z',
                resolution: 2,
                style: { fontFamily: '"Lilita One", system-ui, sans-serif', fontSize: 9 + i * 2.5, fill: 0xe8e0ff, stroke: { color: 0x2a1b30, width: 2.5 } }
            })
            z.anchor.set(0.5)
            box.addChild(z)
        }
        return box
    }

    /** The free tile nearest the owner's dozing spot by the desk (something may stand on it). */
    private ownerSpot(): Tile {
        if (this.nav.isWalkable(OWNER_HOME.x, OWNER_HOME.y)) return OWNER_HOME
        return this.nav.nearestWalkable(OWNER_HOME.x + 0.5, OWNER_HOME.y + 0.5, 6) ?? OWNER_HOME
    }

    /** The layout changed: a dozing owner moves off anything now standing where they were. */
    private placeOwner() {
        const owner = this.owner
        if (!owner) return
        const spot = this.ownerSpot()
        const here = owner.tile
        if (here.x === spot.x && here.y === spot.y) return
        owner.x = spot.x + 0.5
        owner.y = spot.y + 0.5
        owner.face(OWNER_FACE)
        owner.place()
    }

    /** The away owner breathes slowly and the Z's float up. */
    private updateOwner(dt: number) {
        const owner = this.owner
        if (!owner) return
        owner.update(dt)
        owner.container.zIndex = this.actorZ(owner)
        this.ownerT += dt
        const zzz = this.ownerZzz
        if (!zzz) return
        zzz.children.forEach((z, i) => {
            if (this.reduced) {
                z.position.set(i * 6, -i * 5)
                z.alpha = 0.9
                return
            }
            const k = (this.ownerT * 0.45 + i / 3) % 1
            z.position.set(k * 14 + Math.sin((this.ownerT + i) * 2.2) * 1.5, 4 - k * 18)
            z.alpha = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85
            z.scale.set(0.7 + k * 0.5)
        })
        if (!this.reduced) owner.body.scale.y = 1 + Math.sin(this.ownerT * 1.6) * 0.018
    }

    // ── live presence ─────────────────────────────────────────────────────

    /**
     * Other players on this floor now. Newcomers appear where they stand; a
     * move walks the path our own grid finds to their tile (or hops there
     * when there is none, or the floor is paused). At most MAX_REMOTES are
     * drawn, the owner first.
     */
    setRemotes(list: FloorRemote[]) {
        if (this.destroyed) return
        const shown = [...list].sort((a, b) => Number(b.owner) - Number(a.owner)).slice(0, MAX_REMOTES)
        const ids = new Set(shown.map(r => r.id))
        for (const [id, view] of this.remotes) {
            if (ids.has(id)) continue
            if (!this.paused) this.poof(view.actor.x, view.actor.y)
            view.actor.destroy()
            this.remotes.delete(id)
        }
        for (const r of shown) {
            const look = avatarLook(r.name, r.avatar)
            const key = lookKey(look)
            const view = this.remotes.get(r.id)
            if (!view) {
                const actor = new Actor(this.PIXI, figureFrames(this.bank, look), this.fx, r.tile)
                actor.tag = makeNameTag(this.PIXI, r.name, false)
                this.overlay.addChild(actor.tag)
                this.objects.addChild(actor.container)
                actor.face({ x: r.tile.x + 1, y: r.tile.y + 1 })
                actor.place()
                if (!this.paused) this.poof(actor.x, actor.y)
                this.remotes.set(r.id, { actor, seq: r.seq, look: key })
                continue
            }
            if (key !== view.look) {
                view.look = key
                view.actor.setFrames(figureFrames(this.bank, look))
                if (!this.reduced && !this.paused) view.actor.showEmote('star', 1.2)
            }
            if (r.seq !== view.seq) {
                view.seq = r.seq
                this.moveRemote(view.actor, r.tile, r.walk)
            }
        }
        this.ownerLive = shown.some(r => r.owner)
        this.syncOwner()
        this.pruneFigures()
    }

    private moveRemote(actor: Actor, tile: Tile, walk: boolean) {
        const here = actor.tile
        if (!actor.moving && here.x === tile.x && here.y === tile.y) return
        const path = walk && !this.paused ? this.nav.findPath(actor.nextTile, tile) : null
        if (path) {
            actor.walk(path)
            return
        }
        const show = !this.paused
        if (show) this.poof(actor.x, actor.y)
        actor.stop()
        actor.x = tile.x + 0.5
        actor.y = tile.y + 0.5
        actor.place()
        if (show) this.poof(actor.x, actor.y)
    }

    /** Tell the room where the avatar is headed (walking) or stands (put there). */
    private announce(walk: boolean) {
        if (!this.onMove) return
        const dest = this.player.path.at(-1) ?? this.player.tile
        const key = `${dest.x},${dest.y},${walk}`
        if (key === this.lastMove) return
        this.lastMove = key
        this.onMove({ x: dest.x, y: dest.y, walk })
    }

    /** The cage fills between scene rebuilds (the page updates it in place every second or so). */
    setCage(fill: number, stored: number) {
        if (this.destroyed) return
        if (this.cage?.set(fill, stored)) this.labelsDirty = true
    }

    /** Centre and zoom the camera on everything owned. */
    private frameOwned(glide: boolean) {
        const gb = zonesBounds(this.owned)
        if (!gb) return
        const b = rectBounds(gb)
        const zoom = this.camera.fitZoom(b.maxX - b.minX + 16, b.maxY - b.minY + 110)
        const x = (b.minX + b.maxX) / 2
        const y = (b.minY + b.maxY) / 2 - 34
        this.camera.slack = { x: 0, y: 0 }
        if (glide) this.camera.glideTo(x, y, zoom, 1.1)
        else this.camera.jumpTo(x, y, zoom)
    }

    private zoneLook(id: ZoneId, scene: FloorScene): ZoneLook {
        const z = scene.zones.find(x => x.id === id)
        if (this.owned.has(id)) return 'owned'
        if (z?.construction) return 'building'
        if (z?.available) return 'available'
        return 'locked'
    }

    private buildStructure(scene: FloorScene) {
        const { PIXI, bank } = this
        const decor = Math.max(0, Math.min(5, Math.round(scene.decor)))
        const oldViews = this.structureViews
        const oldSigns = this.structureSigns
        this.structureViews = []
        this.structureSigns = []
        this.structureStatics = []
        this.occluders.clear()
        this.saleTargets.clear()
        this.saleViews.clear()
        for (const g of this.glows) g.sprite.destroy()
        this.glows = []
        for (const c of this.clouds) c.sprite.destroy()
        this.clouds = []
        this.ground.removeChildren().forEach(c => c.destroy())

        const usedFloors = new Set<string>()
        const worldBaked = (key: string, bounds: { minX: number, minY: number, maxX: number, maxY: number }, draw: Parameters<TextureBank['bake']>[4], mip = true): Baked => {
            const m = 16
            return bank.get(key, () => bank.bake(bounds.maxX - bounds.minX + m * 2, bounds.maxY - bounds.minY + m * 2, -bounds.minX + m, -bounds.minY + m, draw, mip))
        }
        const worldSprite = (baked: Baked, layer: Container) => {
            const s = new PIXI.Sprite(baked.texture)
            s.anchor.set(baked.ox / baked.width, baked.oy / baked.height)
            layer.addChild(s)
            return s
        }

        // Building shadow, floors, porch.
        const shown = ZONE_ORDER.filter(id => this.visible.has(id))
        const shadowKey = `shadow:${shown.join(',')}`
        usedFloors.add(shadowKey)
        worldSprite(worldBaked(shadowKey, { minX: -22 * HW - 60, minY: -60, maxX: 22 * HW + 60, maxY: 44 * HH + 120 }, p => drawBuildingShadow(p, shown.map(id => ZONE_RECTS[id]), this.owned), false), this.ground)
        this.plainFloors = []
        this.skinned = []
        for (const id of shown) {
            const look = this.zoneLook(id, scene)
            const skin = look === 'owned' ? this.skins.get(id) ?? DEFAULT_SKIN : DEFAULT_SKIN
            const floorKey = (k: SkinId) => `floor:${id}:${look}:${look === 'owned' ? decor : 0}${k === DEFAULT_SKIN ? '' : `:${k}`}`
            const bake = (k: SkinId) => worldBaked(floorKey(k), rectBounds(ZONE_RECTS[id]), p => drawZoneFloor(p, id, look, decor, ZONE_NAMES[id], k))
            usedFloors.add(floorKey(skin))
            const sprite = worldSprite(bake(skin), this.ground)
            if (look === 'owned') this.skinned.push({ sprite, zone: id, key: floorKey, bake })
            else this.plainFloors.push(floorKey(skin))
        }
        worldSprite(worldBaked('porch', rectBounds({ x: 18, y: 22, w: 2, h: 1 }, 20), p => drawPorch(p, PORCH)), this.ground)

        const addStatic = (id: string, view: Container, box: DepthBox, occludes = true) => {
            this.objects.addChild(view)
            this.structureViews.push(view)
            this.structureStatics.push({ id, view, box })
            if (occludes) this.occluders.add(view)
        }
        const addGlow = (x: number, y: number, scale: number, alpha: number, tint = 0xffc76b) => {
            const s = new PIXI.Sprite(this.fx.glow.texture)
            s.anchor.set(0.5)
            s.position.set(x, y)
            s.scale.set(scale)
            s.blendMode = 'add'
            s.tint = tint
            s.alpha = alpha
            this.lights.addChild(s)
            this.glows.push({ sprite: s, base: alpha, phase: Math.random() * 10 })
        }
        const addPool = (x: number, y: number, scale: number, alpha: number) => {
            const s = new PIXI.Sprite(this.fx.pool.texture)
            s.anchor.set(0.5)
            s.position.set(x, y)
            s.scale.set(scale)
            s.blendMode = 'add'
            s.tint = 0xffc76b
            s.alpha = alpha
            this.floorFx.addChildAt(s, 0)
            this.glows.push({ sprite: s, base: alpha, phase: Math.random() * 10 })
        }

        // Walls on every edge between two areas (or an area and outside), minus doorways.
        interface Seg { axis: 'x' | 'y', x: number, y: number, look: WallLook }
        const segs: Seg[] = []
        for (let y = 0; y < GRID_H; y++) {
            for (let x = 0; x < GRID_W; x++) {
                const a = areaAt(x, y)
                if (!a || a === 'porch') continue
                for (const [bx, by, axis] of [[x - 1, y, 'x'], [x, y - 1, 'y']] as const) {
                    const b = areaAt(bx, by)
                    if (b === a) continue
                    if (b && doorwayBetween(x, y, bx, by)) continue
                    const aOwned = this.owned.has(a)
                    // Walls belong to owned rooms; zones beyond stay open and soft.
                    if (!aOwned) continue
                    const bOwned = !!b && b !== 'porch' && this.owned.has(b)
                    const tall = !b || (aOwned && !bOwned)
                    const index = axis === 'x' ? y : x
                    let variant: WallVariant = 'plain'
                    if (tall && aOwned) {
                        if (decor >= 1 && index % 3 === 1) variant = 'sconce'
                        else if (!b && index % 4 === 2) variant = 'window'
                        else if (b && index % 5 === 3) variant = 'art'
                        else if (!b && decor >= 2 && index % 6 === 4) variant = 'art'
                    }
                    segs.push({ axis, x, y, look: { zone: a, owned: aOwned, tall, decor, variant, skin: this.skins.get(a) ?? DEFAULT_SKIN } })
                }
            }
        }
        const wallBaked = (axis: 'x' | 'y', look: WallLook) => bank.get(wallKey(axis, look), () => {
            const c = footprintCanvas(1.3, 1.3, wallHeight(look.tall) + 6, 10)
            // The seed ignores the skin, so a re-skinned wall keeps its picture.
            return bank.bake(c.width, c.height, c.ox, c.oy, p => drawWall(p, axis, look, hashString(wallKey(axis, { ...look, skin: undefined }))), true)
        })
        for (const s of segs) {
            const baked = wallBaked(s.axis, s.look)
            const view = new PIXI.Sprite(baked.texture)
            view.anchor.set(baked.ox / baked.width, baked.oy / baked.height)
            const seg = s
            this.skinned.push({ sprite: view, zone: s.look.zone, key: k => wallKey(seg.axis, { ...seg.look, skin: k }), bake: k => wallBaked(seg.axis, { ...seg.look, skin: k }) })
            const at = project(s.x, s.y)
            view.position.set(at.x, at.y)
            const box: DepthBox = s.axis === 'y'
                ? { minX: s.x, maxX: s.x + 1, minY: s.y - WALL_T, maxY: s.y, height: wallHeight(s.look.tall) }
                : { minX: s.x - WALL_T, maxX: s.x, minY: s.y, maxY: s.y + 1, height: wallHeight(s.look.tall) }
            addStatic(`wall:${s.axis}:${s.x}:${s.y}`, view, box)
            if (s.look.variant === 'sconce') {
                const l = sconceLight(s.axis)
                addGlow(at.x + l.x, at.y + l.y, 0.75, 0.55)
            }
        }

        // Pillars where walls end, turn, or change height.
        const verts = new Map<string, { x: number, y: number, segs: Seg[] }>()
        const vert = (x: number, y: number, s: Seg) => {
            const k = `${x},${y}`
            const v = verts.get(k) ?? { x, y, segs: [] }
            v.segs.push(s)
            verts.set(k, v)
        }
        for (const s of segs) {
            vert(s.x, s.y, s)
            if (s.axis === 'y') vert(s.x + 1, s.y, s)
            else vert(s.x, s.y + 1, s)
        }
        for (const v of verts.values()) {
            const axes = new Set(v.segs.map(s => s.axis))
            const heights = new Set(v.segs.map(s => s.look.tall))
            if (v.segs.length > 1 && axes.size === 1 && heights.size === 1) continue
            const best = v.segs.reduce((a, b) => (Number(b.look.tall) * 2 + Number(b.look.owned) > Number(a.look.tall) * 2 + Number(a.look.owned) ? b : a))
            const look = { ...best.look, variant: 'plain' as const }
            const pillarBaked = (k: SkinId) => {
                const skinned = { ...look, skin: k }
                return bank.get(`pillar:${wallKey('y', skinned)}`, () => {
                    const c = footprintCanvas(0.6, 0.6, wallHeight(look.tall) + 12, 8)
                    const o = shifted(c, 0.3, 0.3)
                    return bank.bake(c.width, c.height, o.ox, o.oy, p => drawPillar(p, skinned), true)
                })
            }
            const baked = pillarBaked(look.skin ?? DEFAULT_SKIN)
            const view = new PIXI.Sprite(baked.texture)
            view.anchor.set(baked.ox / baked.width, baked.oy / baked.height)
            this.skinned.push({ sprite: view, zone: look.zone, key: k => `pillar:${wallKey('y', { ...look, skin: k })}`, bake: pillarBaked })
            const at = project(v.x, v.y)
            view.position.set(at.x, at.y)
            addStatic(`pillar:${v.x}:${v.y}`, view, { minX: v.x - 0.14, maxX: v.x + 0.06, minY: v.y - 0.14, maxY: v.y + 0.06, height: wallHeight(look.tall) + 6 })
        }

        // Ropes across doorways into zones not owned yet.
        for (const door of DOORWAYS) {
            if (door.front === 'porch' || door.back === 'porch') continue
            const fo = this.owned.has(door.front)
            const bo = this.owned.has(door.back)
            if (fo === bo) continue
            const len = door.to - door.from
            const baked = bank.get(`rope:${door.axis}:${len}`, () => {
                const c = footprintCanvas(door.axis === 'y' ? len + 0.4 : 0.6, door.axis === 'x' ? len + 0.4 : 0.6, 40, 12)
                const o = door.axis === 'y' ? shifted(c, 0.2, 0.3) : shifted(c, 0.3, 0.2)
                return bank.bake(c.width, c.height, o.ox, o.oy, p => drawDoorRope(p, door.axis, len))
            })
            const view = new PIXI.Sprite(baked.texture)
            view.anchor.set(baked.ox / baked.width, baked.oy / baked.height)
            const gx = door.axis === 'x' ? door.at : door.from
            const gy = door.axis === 'x' ? door.from : door.at
            const at = project(gx, gy)
            view.position.set(at.x, at.y)
            const box: DepthBox = door.axis === 'y'
                ? { minX: door.from, maxX: door.to, minY: door.at - 0.12, maxY: door.at, height: 24 }
                : { minX: door.at - 0.12, maxX: door.at, minY: door.from, maxY: door.to, height: 24 }
            addStatic(`rope:${door.front}:${door.back}`, view, box)
        }

        // Warm ceiling light on every owned floor, even before decor.
        for (const id of ZONE_ORDER) {
            if (!this.owned.has(id)) continue
            const r = ZONE_RECTS[id]
            const n = Math.max(2, Math.round((r.w * r.h) / 22))
            for (let i = 0; i < n; i++) {
                const a = (i + 0.5) / n
                const gx = r.w >= r.h ? r.x + r.w * a : r.x + r.w / 2
                const gy = r.w >= r.h ? r.y + r.h / 2 : r.y + r.h * a
                const f = project(gx, gy)
                addPool(f.x, f.y, 3.4, 0.2)
            }
        }

        if (decor >= 4) {
            for (const ch of CHANDELIERS) {
                if (!this.owned.has(ch.zone)) continue
                const baked = bank.get('chandelier', () => bank.bake(60, 70 + CHANDELIER_Z, 30, CHANDELIER_Z + 30, p => drawChandelier(p), true))
                const view = new PIXI.Sprite(baked.texture)
                view.anchor.set(baked.ox / baked.width, baked.oy / baked.height)
                const at = project(ch.at.x, ch.at.y)
                view.position.set(at.x, at.y)
                // Hangs from the ceiling: clicks pass through to the floor and machines below.
                addStatic(`chandelier:${ch.at.x}:${ch.at.y}`, view, { minX: ch.at.x - 0.05, maxX: ch.at.x + 0.05, minY: ch.at.y - 0.05, maxY: ch.at.y + 0.05, height: CHANDELIER_Z + 20 }, false)
                addGlow(at.x + CHANDELIER_LIGHT.x, at.y + CHANDELIER_LIGHT.y, 1.6, 0.5)
                addPool(at.x, at.y, 2.6, 0.3)
            }
        }
        // Lamp posts outside the entrance.
        for (const lx of [17, 20]) {
            const baked = bank.get('lamppost', () => {
                const c = footprintCanvas(1, 1, 80, 10)
                return bank.bake(c.width, c.height, c.ox, c.oy, p => drawLampPost(p), true)
            })
            const view = new PIXI.Sprite(baked.texture)
            view.anchor.set(baked.ox / baked.width, baked.oy / baked.height)
            const at = project(lx, 22)
            view.position.set(at.x, at.y)
            addStatic(`lamppost:${lx}`, view, { minX: lx + 0.3, maxX: lx + 0.7, minY: 22.3, maxY: 22.7, height: 80 })
            addGlow(at.x + LAMP_POST_LIGHT.x, at.y + LAMP_POST_LIGHT.y, 1.3, 0.7)
            addPool(at.x + LAMP_POST_LIGHT.x, project(lx + 0.5, 22.5).y, 1.5, 0.3)
        }

        // Fog drifting over zones not owned.
        for (const id of ZONE_ORDER) {
            if (this.owned.has(id) || !this.visible.has(id)) continue
            const rect = ZONE_RECTS[id]
            const n = Math.max(1, Math.round((rect.w * rect.h) / 28))
            for (let i = 0; i < n; i++) {
                const s = new PIXI.Sprite(this.fx.cloud.texture)
                s.anchor.set(0.5)
                s.alpha = 0.3
                s.scale.set(0.7 + Math.random() * 0.5)
                this.fog.addChild(s)
                const c = { sprite: s, rect, vx: (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.08), phase: Math.random() }
                this.clouds.push(c)
                const gx = rect.x + Math.random() * rect.w
                const gy = rect.y + Math.random() * rect.h
                const p = project(gx, gy)
                s.position.set(p.x, p.y)
                ;(s as Sprite & { g?: Pt }).g = { x: gx, y: gy }
            }
        }

        // FOR SALE / OPENING SOON signs.
        this.saleBlocks = []
        for (const z of scene.zones) {
            if (this.owned.has(z.id) || (!z.available && !z.construction)) continue
            const spot = saleSpot(z.id, this.owned)
            if (!spot) continue
            this.saleBlocks.push(spot.sign)
            const at = project(spot.sign.x + 0.5, spot.sign.y + 0.5)
            const view = new SaleSignView(this.ctx, at, ZONE_NAMES[z.id], z.construction)
            this.structureSigns.push(view)
            this.saleViews.set(z.id, view)
            const rect = { x: spot.sign.x, y: spot.sign.y, w: 1, h: 1 }
            addStatic(`sale:${z.id}`, view.container, { minX: rect.x + 0.2, maxX: rect.x + 0.8, minY: rect.y + 0.2, maxY: rect.y + 0.8, height: 70 }, false)
            this.saleTargets.set(z.id, { target: { kind: 'zone', id: z.id }, stand: spot.stand, face: spot.sign, rect, center: { x: at.x, y: at.y - 30 } })
        }

        // Navigation: the floor of the owned rooms, minus what stands on it.
        this.rebuildNav()

        // Cage and desk (the cage is re-baked only when its upgrade level changes).
        const cage = cageLevel(scene)
        if (!this.cage || this.cageLevel !== cage) {
            this.cage?.destroy()
            this.cage = new CageView(this.ctx, project(CAGE.rect.x, CAGE.rect.y), cage)
            this.cageLevel = cage
            this.objects.addChild(this.cage.container)
        }
        if (!this.desk) {
            this.desk = new DeskView(this.ctx, project(DESK.rect.x, DESK.rect.y))
            this.objects.addChild(this.desk.container)
        }

        for (const v of oldViews) if (!this.structureViews.includes(v)) v.destroy({ children: true })
        for (const s of oldSigns) s.destroy()
        bank.prune('shadow:', usedFloors)
        this.pruneSkinned()

        this.syncDecor(scene)
        this.syncPlots(scene, true)

        // Camera bounds: the whole building, so every future zone can be panned to.
        const gb = zonesBounds(ZONE_ORDER)!
        const b = rectBounds(gb)
        this.camera.setBounds({ minX: b.minX - 40, minY: b.minY - 110, maxX: b.maxX + 40, maxY: b.maxY + 50 })
    }

    /**
     * Only skins changed (a purchase, or a picker previewing one): point the
     * changed zones' floor, wall and pillar sprites at that skin's textures.
     * Nothing else is rebuilt; the textures no sprite shows any more are freed,
     * so previewing every skin keeps at most one set per zone in memory.
     */
    private reskin(next: Map<ZoneId, SkinId>) {
        const changed = new Set<ZoneId>()
        for (const [zone, skin] of next) if ((this.skins.get(zone) ?? DEFAULT_SKIN) !== skin) changed.add(zone)
        if (!changed.size) return
        this.skins = next
        for (const item of this.skinned) {
            if (!changed.has(item.zone) || item.sprite.destroyed) continue
            const baked = item.bake(next.get(item.zone) ?? DEFAULT_SKIN)
            item.sprite.texture = baked.texture
            item.sprite.anchor.set(baked.ox / baked.width, baked.oy / baked.height)
        }
        this.pruneSkinned()
    }

    /** Free floor, wall and pillar textures no sprite shows (old skins, old states). */
    private pruneSkinned() {
        const keep = new Set<string>(this.plainFloors)
        for (const item of this.skinned) keep.add(item.key(this.skins.get(item.zone) ?? DEFAULT_SKIN))
        this.bank.prune('floor:', keep)
        this.bank.prune('wall:', keep)
        this.bank.prune('pillar:', keep)
    }

    /** Free the figure textures of player looks nobody on the floor wears any more. */
    private pruneFigures() {
        const looks = new Set<string>([this.playerLook])
        if (this.owner) looks.add(this.ownerName.split('\u0001')[1] ?? '')
        for (const view of this.remotes.values()) looks.add(view.look)
        for (const view of this.plots.values()) for (const key of view.seatLookKeys) looks.add(key)
        const id = [...looks].sort().join(',')
        if (id === this.figureLooks) return
        this.figureLooks = id
        const keep = new Set<string>()
        for (const key of looks) for (const k of figureKeys(key)) keep.add(k)
        this.bank.prune(`fig:${PLAYER_LOOK_PREFIX}`, keep)
    }

    /** The walk grid from what stands on the floor, FOR SALE signs blocking their doorway tiles. */
    private rebuildNav() {
        this.nav = new NavGrid(this.layout ?? { zones: [...this.owned], pieces: [] })
        for (const t of this.saleBlocks) this.nav.setBlocked(t, true)
        this.placeOwner()
    }

    /** Decorations on the floor: new ones drawn, moved ones redrawn, gone ones removed. True when any changed. */
    private syncDecor(scene: FloorScene): boolean {
        let changed = false
        const seen = new Set<number>()
        for (const d of scene.decorations ?? []) {
            const zone = zoneAt(d.x, d.y)
            if (!zone || !this.owned.has(zone)) continue
            seen.add(d.id)
            const existing = this.decorViews.get(d.id)
            if (existing && existing.key === `${d.type}:${d.x}:${d.y}`) continue
            existing?.destroy()
            const view = new DecorView(this.ctx, d.id, d.type, d.x, d.y)
            if (view.flat) this.rugLayer.addChild(view.container)
            else this.objects.addChild(view.container)
            this.decorViews.set(d.id, view)
            changed = true
        }
        for (const [id, view] of this.decorViews) {
            if (seen.has(id)) continue
            view.destroy()
            this.decorViews.delete(id)
            changed = true
        }
        return changed
    }

    private plotShow(plot: FloorPlot, rect: Rect): PlotShow {
        const zone = zoneAt(rect.x, rect.y) ?? plot.zone
        if (!this.owned.has(zone)) return 'ghost'
        if (plot.status === 'locked') return 'locked'
        // A put-away game has no rect, so it never gets here; drawn as built should one slip through.
        if (plot.status === 'stored') return 'built'
        return plot.status
    }

    private syncPlots(scene: FloorScene, force = false) {
        let changed = force
        const seen = new Set<string>()
        for (const plot of scene.plots) {
            const rect = plotRect(plot)
            if (!rect) continue
            seen.add(plot.id)
            const show = this.plotShow(plot, rect)
            const existing = this.plots.get(plot.id)
            const view = existing && existing.key === plotKey(plot, show) && sameRect(existing.layout.rect, rect) ? existing : null
            if (view) {
                if (plot.occupancy) view.setSeated(plot.occupancy.seated, plot.occupancy.seats)
                continue
            }
            existing?.destroy()
            const next = new PlotView(this.ctx, plotLayout(plot, rect), plot, show)
            next.onDust = (x, y) => this.dust(x, y)
            next.setPlaying(this.playingSet.has(plot.id))
            this.plots.set(plot.id, next)
            this.objects.addChild(next.container)
            changed = true
        }
        for (const [id, view] of this.plots) {
            if (seen.has(id)) continue
            view.destroy()
            this.plots.delete(id)
            changed = true
        }
        if (changed) this.reorder()
    }

    /** Depth-rank every static, then rebuild hit areas and guest spots. */
    private reorder() {
        const statics: Static[] = [...this.structureStatics]
        for (const [id, view] of this.plots) {
            if (view.show === 'ghost') continue
            statics.push({ id: `plot:${id}`, view: view.container, box: boxOf(view.layout.rect, view.height) })
        }
        for (const [id, view] of this.decorViews) {
            if (view.flat) continue
            statics.push({ id: `decor:${id}`, view: view.container, box: boxOf(view.rect, view.height) })
        }
        if (this.cage) statics.push({ id: 'cage', view: this.cage.container, box: boxOf(CAGE.rect, 96) })
        if (this.desk) statics.push({ id: 'desk', view: this.desk.container, box: boxOf(DESK.rect, 80) })
        const boxes = statics.map(s => s.box)
        // The ranking is O(n²) in statics: reuse it while the boxes are the same (a plot changed state, not size).
        const rankKey = `${this.structureKey}|${this.layoutKey}|${statics.map(s => `${s.id}:${s.box.height}`).join(',')}`
        if (rankKey !== this.rankKey || !this.rankCache) {
            const rank = rankStatics(boxes)
            this.rankCache = { rank, tiles: tileRanks(boxes, rank) }
            this.rankKey = rankKey
        }
        const { rank } = this.rankCache
        this.labelsDirty = true
        this.ranks.clear()
        statics.forEach((s, i) => {
            s.view.zIndex = (rank[i]! + 1) * 1000
            this.ranks.set(s.id, rank[i]!)
        })
        this.tileRank = this.rankCache.tiles

        // Targets: what each one is, which display roots belong to it, and its floor tiles.
        this.hitRoots.clear()
        this.rootsByKey.clear()
        this.targetsByKey.clear()
        this.tileTargets.clear()
        const register = (it: Interactable, roots: Container[]) => {
            const key = targetKey(it.target)
            this.targetsByKey.set(key, it)
            this.rootsByKey.set(key, roots)
            for (const r of roots) this.hitRoots.set(r, key)
            const r = it.rect
            if (r) {
                for (let x = r.x; x < r.x + r.w; x++) {
                    for (let y = r.y; y < r.y + r.h; y++) if (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H) this.tileTargets.set(y * GRID_W + x, key)
                }
            }
        }
        for (const [id, view] of this.plots) {
            if (view.show === 'ghost') continue
            const layout = view.layout
            const r = layout.rect
            register({
                target: { kind: 'game', id },
                stand: layout.front,
                face: { x: r.x + r.w / 2 - 0.5, y: r.y + r.h / 2 - 0.5 },
                rect: r,
                center: project(r.x + r.w / 2, r.y + r.h / 2, 30)
            }, [view.container, ...view.overlays()])
        }
        if (this.cage) register({ target: { kind: 'cage' }, stand: CAGE.front, face: { x: CAGE.rect.x + 0.5, y: CAGE.rect.y + 0.5 }, rect: CAGE.rect, center: project(CAGE.rect.x + 1, CAGE.rect.y + 1, 30) }, [this.cage.container, ...this.cage.overlays()])
        if (this.desk) register({ target: { kind: 'builder' }, stand: DESK.front, face: { x: DESK.rect.x + 0.5, y: DESK.rect.y }, rect: DESK.rect, center: project(DESK.rect.x + 1, DESK.rect.y + 0.5, 30) }, [this.desk.container])
        for (const [id, it] of this.saleTargets) {
            const view = this.saleViews.get(id)
            register(it, view ? [view.container, ...view.overlays()] : [])
        }
        // The highlighted target may have been rebuilt: re-resolve it.
        if (this.hoverKey) {
            const key = this.hoverKey
            this.hoverKey = ''
            this.setHover(this.targetsByKey.has(key) ? key : null)
        }

        // Where guests play: in front of built machines in owned zones.
        const spots: GuestSpot[] = []
        for (const [id, view] of this.plots) {
            if (view.show !== 'built') continue
            const layout = view.layout
            const r = layout.rect
            const occupied = layout.archetype === 'cards' ? view.plot.occupancy?.seated.length ?? 0 : 0
            layout.spots.forEach((t, i) => {
                if (!this.nav.isWalkable(t.x, t.y)) return
                // Leave the middle spot of a full live table to the players watching.
                if (occupied >= (view.plot.occupancy?.seats ?? 99) && i === 1) return
                spots.push({ key: `${id}:${i}`, tile: t, face: { x: t.x, y: r.y + r.h - 1 } })
            })
        }
        this.guests.setWorld(this.nav, spots)
        this.staff.setWorld(this.nav)
        this.indexArrange()
        // Keep the player on walkable ground.
        const pt = this.player.tile
        if (!this.nav.isWalkable(pt.x, pt.y)) {
            const near = this.nav.nearestWalkable(this.player.x, this.player.y, 6)
            if (near) {
                this.player.stop()
                this.player.x = near.x + 0.5
                this.player.y = near.y + 0.5
                this.player.place()
            }
        }
    }

    // ── arrange mode ──────────────────────────────────────────────────────

    /** Arrange mode's picking tables: which display roots and floor tiles belong to a movable item. */
    private indexArrange() {
        this.arrangeRoots.clear()
        this.arrangeTiles.clear()
        const tiles = (r: Rect, item: ArrangeItem, under = false) => {
            for (let x = r.x; x < r.x + r.w; x++) {
                for (let y = r.y; y < r.y + r.h; y++) {
                    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue
                    const i = y * GRID_W + x
                    if (!under || !this.arrangeTiles.has(i)) this.arrangeTiles.set(i, item)
                }
            }
        }
        for (const [id, view] of this.plots) {
            if (view.show !== 'built' && view.show !== 'building') continue
            const item: ArrangeItem = { kind: 'game', id }
            this.arrangeRoots.set(view.container, item)
            tiles(view.layout.rect, item)
            view.setHidden(this.arranger.hides(arrangeKey(item)))
        }
        for (const [id, view] of this.decorViews) {
            const item: ArrangeItem = { kind: 'decor', id, type: view.type }
            if (!view.flat) {
                this.arrangeRoots.set(view.container, item)
                tiles(view.rect, item)
            }
            view.setHidden(this.arranger.hides(arrangeKey(item)))
        }
        // Rugs last: a tile shared with something standing on it picks that.
        for (const [id, view] of this.decorViews) if (view.flat) tiles(view.rect, { kind: 'decor', id, type: view.type }, true)
    }

    /** The movable item under a screen point: its picture first, else the floor tile it stands on. */
    private itemAt(sx: number, sy: number, touch: boolean): ArrangeItem | null {
        const at = (x: number, y: number): ArrangeItem | null => {
            this.objects.sortChildren()
            const objects = this.objects.children
            for (let i = objects.length - 1; i >= 0; i--) {
                const c = objects[i]!
                const item = this.arrangeRoots.get(c)
                if (item && this.picker.hit(c, x, y)) return item
            }
            const w = this.camera.screenToWorld(x, y)
            const g = unproject(w.x, w.y)
            const tx = Math.floor(g.x)
            const ty = Math.floor(g.y)
            if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return null
            return this.arrangeTiles.get(ty * GRID_W + tx) ?? null
        }
        const hit = at(sx, sy)
        if (hit || !touch) return hit
        for (const [dx, dy] of TOUCH_RING) {
            const near = at(sx + dx, sy + dy)
            if (near) return near
        }
        return null
    }

    private itemRect(item: ArrangeItem): Rect | null {
        const scene = this.scene
        if (!scene || item.kind === 'new') return null
        if (item.kind === 'game') {
            const plot = scene.plots.find(p => p.id === item.id)
            return plot && standing(plot) ? plotRect(plot) : null
        }
        const d = scene.decorations?.find(x => x.id === item.id)
        return d ? { x: d.x, y: d.y, ...decorSize(d.type) } : null
    }

    private itemSize(item: ArrangeItem): { w: number, h: number } {
        if (item.kind !== 'game') return decorSize(item.type)
        const plot = this.scene?.plots.find(p => p.id === item.id)
        const r = plot ? plotRect(plot) : null
        return r ? { w: r.w, h: r.h } : plot ? ARCH_SIZE[plot.archetype] : { w: 1, h: 1 }
    }

    private itemArt(item: ArrangeItem) {
        if (item.kind !== 'game') return decorTexture(this.ctx, item.type)
        const plot = this.scene?.plots.find(p => p.id === item.id)
        if (!plot) return this.fx.dust
        const rect = plotRect(plot) ?? { x: 0, y: 0, ...ARCH_SIZE[plot.archetype] }
        return machineTexture(this.ctx, plot, plotLayout(plot, rect), Math.max(1, plot.level), plot.golden, plot.occupancy?.seats ?? 5).baked
    }

    /** Why `item` can't stand at `at`, in the words the server uses (a game being built moves like any other). */
    private itemProblem(item: ArrangeItem, at: Tile): string | null {
        if (!this.layout) return null
        const target: PlaceTarget = item.kind === 'game' ? { kind: 'game', id: item.id } : item.kind === 'decor' ? { kind: 'decor', id: item.id, type: item.type } : { kind: 'decor', type: item.type }
        try {
            return placementProblem(this.layout, target, at)
        } catch (err) {
            console.error('[floor] placement check failed', err)
            return null
        }
    }

    private setItemHidden(key: string, hidden: boolean) {
        const [kind, id] = key.split(':') as [string, string]
        if (kind === 'game') this.plots.get(id)?.setHidden(hidden)
        else if (kind === 'decor') this.decorViews.get(Number(id))?.setHidden(hidden)
    }

    /** The scene shows a dropped item where it was put. */
    private landed(item: ArrangeItem, at: Tile, known: ReadonlySet<number>): boolean {
        const scene = this.scene
        if (!scene) return false
        if (item.kind === 'game') {
            const plot = scene.plots.find(p => p.id === item.id)
            const r = plot ? plotRect(plot) : null
            return !!r && r.x === at.x && r.y === at.y
        }
        const list = scene.decorations ?? []
        if (item.kind === 'decor') return list.some(d => d.id === item.id && d.x === at.x && d.y === at.y)
        return list.some(d => d.type === item.type && d.x === at.x && d.y === at.y && !known.has(d.id))
    }

    /** The mouse rests on a movable item: it brightens and its footprint shows. */
    private arrangeHighlight(item: ArrangeItem | null) {
        for (const r of this.arrangeLit) if (!r.destroyed) r.filters = null
        this.arrangeLit = []
        const g = this.hoverGfx
        g.clear()
        this.hoverKey = ''
        if (!item) return
        const view = item.kind === 'game' ? this.plots.get(item.id)?.container : item.kind === 'decor' ? this.decorViews.get(item.id)?.container : undefined
        if (view) {
            view.filters = [this.hoverFilter]
            this.arrangeLit = [view]
        }
        const r = this.itemRect(item)
        if (r) {
            const pts = [project(r.x, r.y), project(r.x + r.w, r.y), project(r.x + r.w, r.y + r.h), project(r.x, r.y + r.h)]
            g.poly(pts.flatMap(p => [p.x, p.y])).fill({ color: 0xffe9a8, alpha: 0.16 }).stroke({ color: 0xfff1c4, width: 2, alpha: 0.9 })
        }
    }

    /**
     * Arrange mode on (a state) or off (null). The avatar hides and guests
     * fade; taps pick things up (arrange.ts).
     */
    arrange(state: ArrangeState | null) {
        if (this.destroyed) return
        const was = this.arranger.active
        if (state && !was) {
            // Leave walking behind: no route, no pending use, no highlight.
            this.pending = null
            this.player.stop()
            this.marker.visible = false
            this.setHover(null)
        }
        this.arranger.set(state)
        if (!state && was) this.input.setCursor('default')
    }

    // ── input ─────────────────────────────────────────────────────────────

    /**
     * The front-most visible thing at a screen point: a target (its pixels,
     * or its badge and label in the overlay), `blocked` when solid scenery
     * (a wall, furniture) is in front, null when only the floor is there.
     * Characters, name tags, speech bubbles and lights let clicks through.
     */
    private pickScreen(sx: number, sy: number): Interactable | 'blocked' | null {
        const overlay = this.overlay.children
        for (let i = overlay.length - 1; i >= 0; i--) {
            const c = overlay[i]!
            const key = this.hitRoots.get(c)
            if (key && this.picker.hit(c, sx, sy)) return this.targetsByKey.get(key) ?? null
        }
        this.objects.sortChildren()
        const objects = this.objects.children
        for (let i = objects.length - 1; i >= 0; i--) {
            const c = objects[i]!
            const key = this.hitRoots.get(c)
            if (key) {
                if (this.picker.hit(c, sx, sy)) return this.targetsByKey.get(key) ?? null
            } else if (this.occluders.has(c) && this.picker.hit(c, sx, sy)) {
                return 'blocked'
            }
        }
        return null
    }

    /** What a click at a screen point would do. Hover and tap share it, so the highlight never lies. */
    private resolveClick(sx: number, sy: number, touch: boolean): Click {
        let hit = this.pickScreen(sx, sy)
        if (touch && !hit) {
            // A fingertip is wide: a near miss on a small target still counts.
            for (const [dx, dy] of TOUCH_RING) {
                const near = this.pickScreen(sx + dx, sy + dy)
                if (near && near !== 'blocked') {
                    hit = near
                    break
                }
            }
        }
        if (hit && hit !== 'blocked') return { kind: 'use', it: hit }
        const w = this.camera.screenToWorld(sx, sy)
        const g = unproject(w.x, w.y)
        const tx = Math.floor(g.x)
        const ty = Math.floor(g.y)
        if (!hit) {
            // Only the floor here: a plot's tiles belong to that plot.
            const key = tx >= 0 && ty >= 0 && tx < GRID_W && ty < GRID_H ? this.tileTargets.get(ty * GRID_W + tx) : undefined
            const it = key ? this.targetsByKey.get(key) : undefined
            if (it) return { kind: 'use', it }
            const zone = zoneAt(tx, ty)
            if (zone && !this.owned.has(zone)) {
                const sale = this.saleTargets.get(zone)
                return sale ? { kind: 'use', it: sale } : { kind: 'what' }
            }
        }
        const dest = this.nav.isWalkable(tx, ty) ? { x: tx, y: ty } : this.nav.nearestWalkable(g.x, g.y, 1)
        return dest ? { kind: 'walk', tile: dest } : { kind: 'none' }
    }

    /** The player's own figure is under this screen point (it opens the wardrobe). */
    private onSelf(sx: number, sy: number): boolean {
        return !this.player.moving && this.picker.hit(this.player.body, sx, sy)
    }

    private tap(sx: number, sy: number, touch: boolean) {
        if (this.arranger.active) {
            this.arranger.tap(sx, sy)
            return
        }
        if (this.onSelf(sx, sy)) {
            this.pending = null
            if (!this.reduced) this.player.showEmote('smile', 1)
            this.onInteract({ kind: 'self' })
            return
        }
        const click = this.resolveClick(sx, sy, touch)
        switch (click.kind) {
            case 'use':
                this.goInteract(click.it)
                return
            case 'walk':
                this.pending = null
                this.walkPlayer(click.tile)
                return
            case 'what':
                this.player.showEmote('what', 1.2)
                return
        }
    }

    /** Mouse over the floor: outline what a click would do. True when that is a target. */
    private hover(sx: number, sy: number): boolean {
        if (this.arranger.active) return this.arranger.hover(sx, sy)
        if (this.onSelf(sx, sy)) {
            this.setHover(null)
            return true
        }
        const click = this.resolveClick(sx, sy, false)
        if (click.kind === 'use') {
            this.setHover(targetKey(click.it.target))
            return true
        }
        this.setHover(null, click.kind === 'walk' ? click.tile : null)
        return false
    }

    private setHover(key: string | null, tile: Tile | null = null) {
        const tileKey = tile ? `tile:${tile.x}:${tile.y}` : ''
        const next = key ?? tileKey
        if (next === this.hoverKey) return
        this.hoverKey = next
        for (const r of this.hoverRoots) {
            if (!r.destroyed) r.filters = null
        }
        this.hoverRoots = []
        const g = this.hoverGfx
        g.clear()
        if (key) {
            const it = this.targetsByKey.get(key)
            this.hoverRoots = this.rootsByKey.get(key) ?? []
            for (const r of this.hoverRoots) r.filters = [this.hoverFilter]
            if (it?.rect) {
                const r = it.rect
                const pts = [project(r.x, r.y), project(r.x + r.w, r.y), project(r.x + r.w, r.y + r.h), project(r.x, r.y + r.h)]
                g.poly(pts.flatMap(p => [p.x, p.y])).fill({ color: 0xffe9a8, alpha: 0.14 }).stroke({ color: 0xfff1c4, width: 2, alpha: 0.85 })
            }
        } else if (tile) {
            const pts = [project(tile.x, tile.y), project(tile.x + 1, tile.y), project(tile.x + 1, tile.y + 1), project(tile.x, tile.y + 1)]
            g.poly(pts.flatMap(p => [p.x, p.y])).fill({ color: 0xffffff, alpha: 0.08 }).stroke({ color: 0xffffff, width: 1.5, alpha: 0.45 })
        }
    }

    private walkPlayer(dest: Tile) {
        const path = this.nav.findPath(this.player.nextTile, dest)
        if (!path) {
            this.player.showEmote('what', 1.2)
            return
        }
        this.showMarker(dest, false)
        this.player.walk(path)
        this.announce(true)
    }

    /** A tile next to `stand` the avatar can actually reach, with the route there. */
    private reachableNear(stand: Tile): { tile: Tile, path: Tile[] } | null {
        const from = this.player.nextTile
        const direct = this.nav.findPath(from, stand)
        if (direct) return { tile: stand, path: direct }
        const candidates: Tile[] = []
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if ((dx || dy) && this.nav.isWalkable(stand.x + dx, stand.y + dy)) candidates.push({ x: stand.x + dx, y: stand.y + dy })
            }
        }
        candidates.sort((a, b) => Math.hypot(a.x - stand.x, a.y - stand.y) - Math.hypot(b.x - stand.x, b.y - stand.y))
        for (const t of candidates) {
            const path = this.nav.findPath(from, t)
            if (path) return { tile: t, path }
        }
        return null
    }

    private goInteract(it: Interactable) {
        const here = this.player.tile
        if (!this.player.moving && here.x === it.stand.x && here.y === it.stand.y) {
            this.pending = it
            this.arrive()
            return
        }
        const route = this.reachableNear(it.stand)
        if (!route) {
            // Never use something from across the room: say we can't get there.
            this.pending = null
            this.player.showEmote('what', 1.4)
            return
        }
        this.pending = it
        this.showMarker(route.tile, true)
        this.player.walk(route.path)
        this.announce(true)
        if (!this.player.moving) this.arrive()
    }

    private arrive() {
        const it = this.pending
        this.pending = null
        if (!it) return
        this.player.face(it.face)
        this.onInteract(it.target)
    }

    private showMarker(t: Tile, interact: boolean) {
        const p = project(t.x + 0.5, t.y + 0.5)
        this.marker.position.set(p.x, p.y)
        this.marker.visible = true
        const tint = interact ? 0xff5a5f : 0xffd23f
        for (const c of this.marker.children as Sprite[]) c.tint = tint
        this.markerT = 0
    }

    private resolve(target: FloorTarget): Interactable | null {
        if (target.kind === 'zone') {
            const sale = this.saleTargets.get(target.id)
            if (sale) return sale
            const r = ZONE_RECTS[target.id]
            const near = this.nav.nearestWalkable(r.x + r.w / 2, r.y + r.h / 2, 5)
            const c = project(r.x + r.w / 2, r.y + r.h / 2)
            return near ? { target, stand: near, face: near, rect: null, center: c } : null
        }
        const found = this.targetsByKey.get(targetKey(target))
        if (found) return found
        if (target.kind === 'game') {
            // A game not on the floor: its hint spot, or its home in a zone not owned yet (that zone's sign).
            const plot = this.scene?.plots.find(p => p.id === target.id)
            const home = PLOTS[target.id]
            const r = (plot && plotRect(plot)) ?? home?.rect
            if (!r) return null
            const zone = zoneAt(r.x, r.y) ?? home?.zone
            const sale = zone && !this.owned.has(zone) ? this.saleTargets.get(zone) : undefined
            return { target, stand: sale?.stand ?? this.player.tile, face: { x: r.x, y: r.y }, rect: null, center: project(r.x + r.w / 2, r.y + r.h / 2, 30) }
        }
        return null
    }

    // ── FloorApi ──────────────────────────────────────────────────────────

    walkTo(target: FloorTarget) {
        const it = this.resolve(target)
        if (it) this.goInteract(it)
    }

    teleportTo(target: FloorTarget, poof = true) {
        const it = this.resolve(target)
        if (!it) return
        this.pending = null
        const here = this.player.tile
        if (!(here.x === it.stand.x && here.y === it.stand.y)) {
            const spot = this.nav.isWalkable(it.stand.x, it.stand.y) ? it.stand : this.nav.nearestWalkable(it.stand.x + 0.5, it.stand.y + 0.5, 3)
            if (!spot) return
            if (poof) this.poof(this.player.x, this.player.y)
            this.player.stop()
            this.player.x = spot.x + 0.5
            this.player.y = spot.y + 0.5
            this.player.place()
            if (poof) this.poof(this.player.x, this.player.y)
            this.announce(false)
        }
        this.marker.visible = false
        this.player.face(it.face)
    }

    /** A puff of dust and sparkles around a grid point (the avatar vanishing or landing). */
    private poof(gx: number, gy: number) {
        if (this.reduced) return
        const p = project(gx, gy)
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2
            this.particles.spawn(this.fx.dust.texture, p.x + Math.cos(a) * 8, p.y - 14 + Math.sin(a) * 5, {
                vx: Math.cos(a) * (40 + Math.random() * 20),
                vy: Math.sin(a) * 18 - 20,
                max: 0.5 + Math.random() * 0.25,
                scale0: 0.5,
                scale1: 1.2,
                alpha: 0.85
            })
        }
    }

    focus(target: FloorTarget, options: FloorFocusOptions = {}) {
        if (target.kind === 'zone') {
            // Frame the whole zone (its floor shows a skin preview, its plots what it holds),
            // in the part of the screen a panel doesn't cover.
            const b = rectBounds(ZONE_RECTS[target.id])
            const right = Math.max(0, Math.min(this.camera.viewW * 0.6, options.right ?? 0))
            const bottom = Math.max(0, Math.min(this.camera.viewH * 0.7, options.bottom ?? 0))
            const w = b.maxX - b.minX + 40
            const h = b.maxY - b.minY + 150
            const zoom = Math.max(0.3, Math.min(1.35, (this.camera.viewW - right) / w, (this.camera.viewH - bottom) / h))
            this.camera.slack = { x: right / 2 / zoom, y: bottom / 2 / zoom }
            this.camera.glideTo((b.minX + b.maxX) / 2 + right / 2 / zoom, (b.minY + b.maxY) / 2 - 20 + bottom / 2 / zoom, zoom, 0.8)
            return
        }
        const it = this.resolve(target)
        if (!it) return
        this.camera.slack = { x: 0, y: 0 }
        this.camera.glideTo(it.center.x, it.center.y, Math.max(this.camera.zoom, 0.9))
    }

    celebrate(slug: string, info: { payout: number, stake: number, chipsEarned: number, big: boolean }) {
        const view = this.plots.get(slug)
        const at = view && view.show !== 'ghost' ? view.topPoint() : (() => {
            const p = project(this.player.x, this.player.y)
            return { x: p.x, y: p.y - 70 }
        })()
        // Every payout is chips (economy v2).
        const won = Math.max(info.payout, info.chipsEarned)
        if (won > 0) this.floaters.spawn(`+${formatCoins(won, true)} chips`, at.x, at.y, CHIP_TINT, info.big ? 26 : 19)
        if (info.payout > info.stake) coinBurst(this.particles, this.fx, at.x, at.y + 20, info.big, this.reduced, true)
        if (info.big) {
            this.guests.cheer(at.x, at.y + 60)
            const pp = project(this.player.x, this.player.y)
            if (Math.hypot(pp.x - at.x, pp.y - at.y) < 300) this.player.showEmote('star', 1.6)
        }
    }

    /** A visitor's bet at `slug` put `amount` coins of rakeback in the cage: "+N" and a coin rise over that machine (over the cage when it isn't on the floor). */
    rakeback(slug: string, amount: number) {
        if (this.paused || this.destroyed || this.arranger.active || !(amount > 0)) return
        const view = this.plots.get(slug)
        const pile = this.cage?.pilePoint()
        const at = view && view.show !== 'ghost' ? view.topPoint() : pile ? { x: pile.x, y: pile.y - 30 } : null
        if (!at) return
        this.floaters.spawn(`+${formatCoins(amount, amount >= 10_000)}`, at.x + 10, at.y - 6, COIN_TINT, 17)
        if (!this.reduced) {
            this.particles.spawn(this.fx.coin.texture, at.x - 6, at.y, {
                vx: (Math.random() - 0.5) * 12,
                vy: -46,
                gravity: 0,
                life: 0,
                max: 0.9,
                scale0: 0.6,
                scale1: 0.5,
                drag: 0.4
            })
        }
    }

    playing(slug: string, on: boolean) {
        if (on) this.playingSet.add(slug)
        else this.playingSet.delete(slug)
        this.plots.get(slug)?.setPlaying(on)
    }

    /** `options.to`: the HUD pill in canvas pixels (default: the top right). */
    /** A playing guest spent `amount` at their machine: a small coin rises with "+N". */
    private guestEarned(x: number, y: number, amount: number) {
        if (this.paused || this.destroyed || this.arranger.active) return
        if (amount >= 1) this.floaters.spawn(`+${formatCoins(amount, true)}`, x + 10, y - 58, COIN_TINT, 14)
        if (!this.reduced) {
            this.particles.spawn(this.fx.coin.texture, x - 6, y - 52, {
                vx: (Math.random() - 0.5) * 12,
                vy: -46,
                gravity: 0,
                life: 0,
                max: 0.9,
                scale0: 0.55,
                scale1: 0.45,
                drag: 0.4
            })
        }
    }

    collected(amount: number, options: FloorCollectOptions = {}) {
        if (!this.cage) return
        const { currency = 'chips', to } = options
        const from = this.cage.pilePoint()
        const coins = currency === 'coins'
        this.floaters.spawn(`+${formatCoins(amount, true)} ${currency}`, from.x, from.y - 30, coins ? COIN_TINT : CHIP_TINT, 22)
        const s = this.camera.worldToScreen(from.x, from.y)
        const tx = to?.x ?? this.camera.viewW - 40
        const ty = to?.y ?? 26
        const texture = coins ? this.fx.coin.texture : this.fx.chip.texture
        // A shower that reads the amount: more coins for a bigger collect. The first land
        // at about COLLECT_LAND_MS (the page counts the pill up from then), the last by ~1.2 s.
        const n = this.reduced ? 6 : Math.min(30, 12 + Math.round(Math.log10(Math.max(10, amount)) * 4))
        for (let i = 0; i < n; i++) {
            const ox = (Math.random() - 0.5) * 44
            const oy = (Math.random() - 0.5) * 22
            this.screenParticles.spawn(texture, s.x + ox, s.y + oy, {
                max: 0.5 + Math.random() * 0.15,
                scale0: 1.45,
                scale1: 0.75,
                spin: (Math.random() - 0.5) * 8,
                path: { x0: s.x + ox, y0: s.y + oy, cx: (s.x + tx) / 2 + (Math.random() - 0.5) * 160, cy: Math.min(s.y, ty) - 70 - Math.random() * 80, x1: tx + (Math.random() - 0.5) * 10, y1: ty, delay: i * 0.02 }
            })
        }
        if (this.reduced) return
        // The cage bursts: coins up and out, and a flash of sparkles over the pile.
        coinBurst(this.particles, this.fx, from.x, from.y, false, this.reduced, !coins)
        coinBurst(this.particles, this.fx, from.x, from.y - 6, false, this.reduced, !coins)
        for (let i = 0; i < 8; i++) {
            this.particles.spawn(this.fx.sparkle.texture, from.x + (Math.random() - 0.5) * 60, from.y - 10 - Math.random() * 40, {
                max: 0.45 + Math.random() * 0.3,
                scale0: 0.2,
                scale1: 1,
                spin: 3,
                additive: true,
                tint: 0xffe9a6
            })
        }
    }

    // ── runtime ───────────────────────────────────────────────────────────

    private dust(x: number, y: number) {
        for (let i = 0; i < 3; i++) {
            this.particles.spawn(this.fx.dust.texture, x + (Math.random() - 0.5) * 20, y, {
                vx: (Math.random() - 0.5) * 20,
                vy: -10 - Math.random() * 14,
                max: 0.9 + Math.random() * 0.5,
                scale0: 0.3,
                scale1: 0.9,
                alpha: 0.7
            })
        }
    }

    resize(w: number, h: number) {
        // A hidden host measures 0: keep the last real size instead of collapsing the view.
        if (w < 2 || h < 2) return
        this.camera.resize(w, h)
        this.bg.width = w
        this.bg.height = h
        this.vignette.width = w
        this.vignette.height = h
    }

    setPaused(paused: boolean) {
        if (this.destroyed || this.renderFailed || paused === this.paused) return
        this.paused = paused
        if (paused) {
            this.app.ticker.stop()
        } else {
            this.app.ticker.start()
            // Draw now: the canvas may have been cleared (resized, context restored) while stopped.
            this.redraw()
        }
    }

    /** Render one frame right away, even while paused (after a resize clears the canvas). */
    redraw() {
        if (this.destroyed || this.renderFailed) return
        this.camera.apply(this.world)
        this.scaleLabels()
        this.declutter(1)
        this.renderFrame()
    }

    /** True once a render threw: the floor needs rebuilding. */
    get broken(): boolean {
        return this.renderFailed
    }

    private scaleLabels() {
        // Labels keep a readable size when zoomed out on a phone.
        const k = Math.max(1, Math.min(1.7, 0.95 / this.camera.zoom))
        this.labelK = k
        for (const c of this.overlay.children) if (c.scale.x !== k) c.scale.set(k)
    }

    /** Measure the labels name tags give way to (on a structure, plot or cage label change; never per frame). */
    private collectLabels() {
        this.labelsDirty = false
        const boxes: LabelBox[] = []
        const add = (node: Container, scaled: boolean) => {
            if (node.destroyed) return
            const b = node.getLocalBounds()
            if (b.maxX > b.minX) boxes.push({ node, scaled, minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY })
        }
        if (this.cage) for (const o of this.cage.overlays()) add(o, true)
        for (const view of this.plots.values()) for (const o of view.overlays()) add(o, true)
        for (const sign of this.structureSigns) {
            add(sign.container, false)
            for (const o of sign.overlays()) add(o, true)
        }
        this.labelBoxes = boxes
    }

    /**
     * Name tags give way to labels: a tag over the cage's amount, a countdown
     * or a FOR SALE sign fades and shrinks while it overlaps. `ease` 1 jumps.
     */
    private declutter(ease: number) {
        if (this.labelsDirty) this.collectLabels()
        this.yieldTag(this.player.tag, ease)
        if (this.owner) this.yieldTag(this.owner.tag, ease)
        for (const view of this.remotes.values()) this.yieldTag(view.actor.tag, ease)
    }

    private yieldTag(tag: NameTag | null, ease: number) {
        if (!tag || tag.destroyed) return
        const k = this.labelK
        const hw = tag.halfW * k
        const hh = tag.halfH * k
        const x0 = tag.x - hw
        const x1 = tag.x + hw
        const y0 = tag.y - hh
        const y1 = tag.y + hh
        let hit = false
        for (const b of this.labelBoxes) {
            const n = b.node
            if (!n.visible || n.destroyed) continue
            const s = b.scaled ? k : 1
            if (x1 > n.x + b.minX * s && x0 < n.x + b.maxX * s && y1 > n.y + b.minY * s && y0 < n.y + b.maxY * s) {
                hit = true
                break
            }
        }
        const alpha = tag.alpha + ((hit ? TAG_FADED : 1) - tag.alpha) * ease
        tag.alpha = Math.abs(alpha - (hit ? TAG_FADED : 1)) < 0.01 ? (hit ? TAG_FADED : 1) : alpha
        // Shrink with the fade (1 → TAG_SHRINK as alpha goes 1 → TAG_FADED).
        const shrink = 1 - (1 - TAG_SHRINK) * ((1 - tag.alpha) / (1 - TAG_FADED))
        tag.scale.set(k * shrink)
    }

    /** Depth for a walking figure: just in front of the statics behind its tile. */
    private actorZ(a: Actor): number {
        const t = a.tile
        const r = t.x >= 0 && t.y >= 0 && t.x < GRID_W && t.y < GRID_H ? this.tileRank[t.y * GRID_W + t.x]! : -1
        return (r + 1) * 1000 + 500 + Math.round((a.x + a.y) * 10)
    }

    private readonly setActorZ = (a: Actor) => {
        a.container.zIndex = this.actorZ(a)
    }

    private tick(ticker: Ticker) {
        if (this.destroyed) return
        const dt = Math.min(0.05, ticker.deltaMS / 1000)
        this.time += dt

        // Player.
        if (this.player.update(dt) && this.pending) this.arrive()
        const idle = !this.player.moving
        this.playerArrow.visible = idle
        this.playerArrow.y = -60 - (this.reduced ? 0 : Math.abs(Math.sin(this.time * 3)) * 4) - this.player.jump
        this.playerRing.alpha = this.reduced ? 0.5 : 0.45 + Math.sin(this.time * 3) * 0.15
        this.guests.update(dt, this.partyOn)
        this.staff.update(dt, this.guests)
        this.updateOwner(dt)
        for (const view of this.remotes.values()) {
            view.actor.update(dt)
            view.actor.container.zIndex = this.actorZ(view.actor)
        }

        // Arrange mode: guests and other players fade, the avatar steps out of the picture.
        this.updateArrange(dt)

        // Machines and props.
        for (const view of this.plots.values()) view.update(dt)
        for (const view of this.decorViews.values()) view.update(dt)
        this.cage?.update(dt)
        this.desk?.update(dt)
        for (const s of this.structureSigns) s.update(dt)
        if (!this.reduced) {
            for (const g of this.glows) g.sprite.alpha = g.base * (0.88 + Math.sin(this.time * 2.3 + g.phase) * 0.08 + Math.sin(this.time * 13 + g.phase) * 0.03)
        } else if (this.glowsSet !== this.glows.length) {
            this.glowsSet = this.glows.length
            for (const g of this.glows) g.sprite.alpha = g.base * 0.9
        }
        if (!this.reduced) {
            for (const c of this.clouds) {
                const s = c.sprite as Sprite & { g: Pt }
                s.g.x += c.vx * dt
                if (s.g.x < c.rect.x - 0.5) c.vx = Math.abs(c.vx)
                if (s.g.x > c.rect.x + c.rect.w + 0.5) c.vx = -Math.abs(c.vx)
                const p = project(s.g.x, s.g.y)
                s.position.set(p.x, p.y)
                c.phase += dt * 0.2
                s.alpha = 0.26 + Math.sin(c.phase * Math.PI * 2) * 0.1
            }
        }
        // Party lights sweep the owned floor during a rush.
        const owned = this.ownedBounds
        for (const l of this.party) {
            const target = this.partyOn ? 0.42 : 0
            l.sprite.alpha += (target - l.sprite.alpha) * Math.min(1, dt * 2)
            if (l.sprite.alpha < 0.01 || !owned) continue
            const sp = this.reduced ? 0.2 : 1
            const gx = owned.x + owned.w * (0.5 + 0.42 * Math.sin(this.time * l.speed * sp + l.phase))
            const gy = owned.y + owned.h * (0.5 + 0.42 * Math.cos(this.time * l.speed * 1.3 * sp + l.phase * 2))
            const p = project(gx, gy)
            l.sprite.position.set(p.x, p.y)
        }

        // Effects.
        this.particles.update(dt)
        this.screenParticles.update(dt)
        this.floaters.update(dt)
        if (this.marker.visible) {
            this.markerT += dt
            const k = this.markerT
            const ring = this.marker.children[0] as Sprite
            const cross = this.marker.children[1] as Sprite
            ring.scale.set(1.1 - Math.min(1, k * 2.5) * 0.45)
            cross.scale.set(k < 0.12 ? 0.5 + k * 5 : 1)
            this.marker.alpha = k > 0.6 ? Math.max(0, 1 - (k - 0.6) / 0.4) : 1
            if (k > 1) this.marker.visible = false
        }

        // Depth for everyone walking around.
        this.player.container.zIndex = this.actorZ(this.player) + 1
        this.guests.eachActor(this.setActorZ)
        this.staff.eachActor(this.setActorZ)

        // Camera.
        this.camera.update(dt)
        if (this.player.moving && !this.arranger.active) {
            const p = project(this.player.x, this.player.y)
            this.camera.follow(p.x, p.y - 30, dt)
        }
        this.camera.apply(this.world)
        this.scaleLabels()
        this.declutter(Math.min(1, dt * 12))

        // Keep the hover highlight true while things move under a resting mouse.
        if (this.hoverPos) {
            this.hoverT -= dt
            if (this.hoverT <= 0) {
                this.hoverT = 0.15
                const hit = this.hover(this.hoverPos.x, this.hoverPos.y)
                this.input.setCursor(hit ? 'pointer' : 'default')
            }
        }
    }

    private updateArrange(dt: number) {
        this.arranger.update(dt)
        const want = this.arranger.active ? 1 : 0
        // Off and settled: nothing to do (on, it keeps newcomers faded too).
        if (this.arrangeFade === want && want === 0) return
        const step = this.reduced ? 1 : dt * 4
        this.arrangeFade = want > this.arrangeFade ? Math.min(1, this.arrangeFade + step) : Math.max(0, this.arrangeFade - step)
        const k = this.arrangeFade
        const seen = 1 - k * 0.85
        this.guests.visibility = seen
        this.staff.visibility = seen
        const hidePlayer = k > 0.5
        this.player.container.visible = !hidePlayer
        if (this.player.tag) this.player.tag.visible = !hidePlayer
        for (const view of this.remotes.values()) {
            view.actor.container.alpha = seen
            if (view.actor.tag) view.actor.tag.visible = !hidePlayer
        }
        if (this.owner) {
            this.owner.container.alpha = seen
            if (this.owner.tag) this.owner.tag.visible = !hidePlayer
        }
    }

    destroy() {
        if (this.destroyed) return
        this.destroyed = true
        this.app.ticker.remove(this.tick, this)
        this.app.ticker.remove(this.renderFrame, this)
        this.input.destroy()
        this.arranger.destroy()
        for (const v of this.decorViews.values()) v.destroy()
        this.decorViews.clear()
        this.hoverRoots = []
        this.hitRoots.clear()
        this.guests.destroy()
        this.staff.destroy()
        for (const v of this.plots.values()) v.destroy()
        this.plots.clear()
        for (const s of this.structureSigns) s.destroy()
        this.cage?.destroy()
        this.desk?.destroy()
        this.particles.clear()
        this.screenParticles.clear()
        this.floaters.clear()
        this.player.destroy()
        this.owner?.destroy()
        this.owner = null
        for (const view of this.remotes.values()) view.actor.destroy()
        this.remotes.clear()
        this.app.stage.removeChildren().forEach(c => c.destroy({ children: true }))
        this.bank.destroy()
    }
}

