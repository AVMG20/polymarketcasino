import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../server/database'
import { casinoConstructions, casinoDecor, casinoProfiles, chipTransactions } from '../server/database/schema'
import { dbPresenceSource } from '../server/utils/floor-socket'
import { getCasinoVisit, hostHasGame } from '../server/utils/social'
import { playRound } from '../server/utils/rounds'
import { writeTx } from '../server/database'
import { buyDecor, collectCage, finishConstruction, getTycoonState, hasBuiltGame, luckSeed, onFloorChange, parseBuyDecorBody, parsePlaceBody, placeItem, startBuild } from '../server/utils/tycoon'
import { casinoLevel, casinoXp, gameUnlockLevel, LEVEL_XP, levelUnlocks, MAX_CASINO_LEVEL } from '../shared/casino-level'
import { DECOR, findDecor, specialBonus, type DecorType } from '../shared/decor'
import * as T from '../shared/tycoon'
import { DOORWAYS, PLOTS, PROPS, homeSpot, zoneAt, doorBackTiles, doorFrontTiles, type Tile } from '../shared/floor/layout'
import { NavGrid } from '../shared/floor/nav'
import { buildSpot, findSpot, furnitureGrants, layoutOf, layoutReachable, layoutStateOf, placementProblem, type LayoutInput, type LayoutPiece } from '../shared/floor/placement'
import { COINS_PER_GEM } from '../shared/economy'
import {
    CAMPAIGNS,
    campaignBlocker,
    campaignCost,
    floorView,
    specialOdds,
    fullIncomePerHour,
    rushExtraCoins,
    rushGems,
    RUSH_MAX_GEMS,
    RUSH_MS,
    TYCOON_GAMES,
    UPGRADES,
    ZONES,
    type ZoneId
} from '../shared/tycoon'
import { missionReward } from '../shared/missions'
import { expectedFloor, expectedPerHour, ruleCombos, runFloor, tierOdds, type FloorView } from '../shared/visitors'
import { chipsOf, coinsOf, giveChips, seedPlayer } from './setup/players'

const HOUR = 3_600_000
const ALL_ZONES = ZONES.map(zone => zone.id)
const SPECIALS = DECOR.filter(def => def.special).map(def => def.type)

/** A casino's layout: these zones, these games built (at home unless placed), these decorations placed. */
function layout(zones: ZoneId[], games: string[], decor: { id: number, type: DecorType, x: number, y: number }[] = [], placements: Record<string, Tile> = {}): LayoutInput {
    return layoutOf(layoutStateOf({ zones, games: Object.fromEntries(games.map(slug => [slug, 1])), placements, decor }))
}
const STARTERS = ['plinko', 'spinata']
const plant = (x: number, y: number) => ({ x, y })
const plantProblem = (l: LayoutInput, at: Tile) => placementProblem(l, { kind: 'decor', type: 'plant' }, at)

describe('placement rules', () => {
    it('keeps everything inside one owned room, off the doorways and the porch', () => {
        const backroom = layout(['backroom'], STARTERS)
        expect(plantProblem(backroom, plant(18, 18))).toBeNull()
        expect(plantProblem(backroom, plant(10, 16))).toBe('Not in a room you own')
        expect(plantProblem(backroom, plant(-1, 3))).toBe('Not in a room you own')
        expect(plantProblem(backroom, plant(18, 22))).toBe('Not in a room you own') // the porch
        // Both sides of a doorway, also one into a room nobody owns yet (its FOR SALE sign stands there).
        expect(plantProblem(backroom, plant(14, 17))).toBe('Keep the doorways clear')
        expect(plantProblem(backroom, plant(17, 14))).toBe('Keep the doorways clear')
        expect(plantProblem(backroom, plant(18, 21))).toBe('Keep the doorways clear') // inside the entrance
        const two = layout(['backroom', 'main'], STARTERS)
        expect(plantProblem(two, plant(13, 17))).toBe('Keep the doorways clear')
        expect(placementProblem(two, { kind: 'decor', type: 'sofa' }, { x: 13, y: 15 })).toBe('Keep it inside one room')
        // Every doorway tile is refused in a full casino.
        const full = layout(ALL_ZONES, STARTERS)
        for (const door of DOORWAYS) {
            for (const t of [...doorFrontTiles(door), ...doorBackTiles(door)]) {
                if (zoneAt(t.x, t.y)) expect(plantProblem(full, t), `${t.x},${t.y}`).toBe('Keep the doorways clear')
            }
        }
    })

    it('refuses overlaps and the tiles where guests stand, and needs open floor in front of a machine', () => {
        const l = layout(['backroom'], [...STARTERS, 'limbo'])
        const plinko = PLOTS.plinko!.rect
        expect(plantProblem(l, plant(plinko.x, plinko.y))).toBe('Something is in the way')
        expect(plantProblem(l, plant(20, 19))).toBe('Something is in the way') // the cage
        expect(plantProblem(l, plant(16, 17))).toBe('Blocks where guests stand') // Pegfall's front row
        expect(plantProblem(l, plant(20, 21))).toBe('Blocks where guests stand') // the cage's front
        // A machine faces +gy: its front row must be open floor in the same room.
        expect(placementProblem(l, { kind: 'game', id: 'limbo' }, { x: 16, y: 20 })).toBe('Needs open floor in front')
        expect(placementProblem(l, { kind: 'game', id: 'limbo' }, { x: 15, y: 17 })).toBe('Blocks where guests stand')
        // Its own spot doesn't count: moving it a tile is fine.
        expect(placementProblem(l, { kind: 'game', id: 'limbo' }, { x: 20, y: 16 })).toBeNull()
        // A flat rug is walked over: it may lie where guests stand, in the entrance, and under a machine's front row.
        const carpet = (x: number, y: number) => placementProblem(l, { kind: 'decor', type: 'red-carpet' }, { x, y })
        expect(carpet(16, 17)).toBeNull()
        expect(carpet(17, 21)).toBeNull()
        expect(carpet(plinko.x, plinko.y)).toBe('Something is in the way')
        const rugged = layout(['backroom'], [...STARTERS, 'limbo'], [{ id: 1, type: 'red-carpet', x: 16, y: 17 }])
        expect(placementProblem(rugged, { kind: 'game', id: 'limbo' }, { x: 16, y: 15 })).not.toBe('Needs open floor in front')
        // A game standing on a rug, a rug on a plant: no overlaps at all.
        const rug = layout(['backroom'], STARTERS, [{ id: 1, type: 'rug', x: 16, y: 18 }])
        expect(plantProblem(rug, plant(17, 19))).toBe('Something is in the way')
        expect(placementProblem(rug, { kind: 'decor', type: 'rug' }, { x: 17, y: 18 })).toBe('Something is in the way')
        expect(placementProblem(rug, { kind: 'decor', id: 1, type: 'rug' }, { x: 17, y: 18 })).toBeNull()
        expect(placementProblem(rug, { kind: 'game', id: 'nope' }, { x: 17, y: 18 })).toBe('Unknown item')
    })

    it('keeps every front and doorway reachable from the entrance', () => {
        // A wall of plants across the backroom with one gap: closing the gap cuts off the way to the Table Pit.
        const wall: LayoutPiece[] = Array.from({ length: 7 }, (_, i) => ({ key: `decor:${i + 1}`, rect: { x: 14 + i, y: 16, w: 1, h: 1 }, blocks: true, front: [] }))
        const base = layout(['backroom'], [])
        const walled: LayoutInput = { zones: base.zones, pieces: [...base.pieces, ...wall] }
        expect(layoutReachable(walled)).toBe(true)
        expect(plantProblem(walled, plant(21, 16))).toBe('Blocks the way through')
        // A rug never blocks: it lies in the gap just fine.
        expect(placementProblem(walled, { kind: 'decor', type: 'rug' }, { x: 20, y: 15 })).toBe('Something is in the way')
        const rugGap: LayoutInput = { zones: base.zones, pieces: [...base.pieces, ...wall.slice(0, 6)] }
        expect(placementProblem(rugGap, { kind: 'decor', type: 'rug' }, { x: 20, y: 16 })).toBeNull()
    })

    it('lays out a full casino at home with all its free furniture, every spot valid and reachable', () => {
        const all = TYCOON_GAMES.map(game => game.slug)
        const l = layout(ALL_ZONES, all)
        for (const slug of all) expect(placementProblem(l, { kind: 'game', id: slug }, homeSpot(slug)!), slug).toBeNull()
        const grants = furnitureGrants(l, new Set())
        expect(grants).toHaveLength(PROPS.length)
        for (const grant of grants) expect(grant.at, grant.key).not.toBeNull()
        const furnished = layout(ALL_ZONES, all, grants.map((g, i) => ({ id: i + 1, type: g.type, ...g.at! })))
        expect(layoutReachable(furnished)).toBe(true)
        // The furniture comes with the rooms, once each.
        const backroom = furnitureGrants(layout(['backroom'], STARTERS), new Set())
        expect(backroom.map(g => g.key)).toEqual(PROPS.filter(p => p.zone === 'backroom').map(p => p.key))
        expect(furnitureGrants(layout(['backroom'], STARTERS), new Set(backroom.map(g => g.key)))).toEqual([])
        // A taken spot puts the piece away instead.
        const taken = PROPS.find(p => p.zone === 'backroom')!
        const blocked = layout(['backroom'], STARTERS, [{ id: 9, type: 'plant', ...taken.rect }])
        expect(furnitureGrants(blocked, new Set()).find(g => g.key === taken.key)!.at).toBeNull()
    })

    it('starts every casino reachable: any rooms, games at home, all its free furniture', () => {
        // Every state the migration can meet: rooms are bought in order, games stood in their own room
        // at home, and the furniture comes at its old spot. Game sets: none, all, all but one, and random ones.
        let seed = 7
        const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648
        let checked = 0
        for (let zi = 0; zi < ZONES.length; zi++) {
            const zones = ALL_ZONES.slice(0, zi + 1)
            const here = TYCOON_GAMES.filter(g => zones.includes(g.zone) && !g.starter).map(g => g.slug)
            const sets = [[], here, ...here.map(slug => here.filter(s => s !== slug)), ...Array.from({ length: 12 }, () => here.filter(() => random() < 0.5))]
            for (const games of sets) {
                const l = layout(zones, [...STARTERS, ...games])
                expect(layoutReachable(l), `${zones.at(-1)} ${games.join(',')}`).toBe(true)
                const grants = furnitureGrants(l, new Set())
                if (games === here) for (const g of grants) expect(g.at, g.key).not.toBeNull()
                const furnished = layout(zones, [...STARTERS, ...games], grants.flatMap((g, i) => (g.at ? [{ id: i + 1, type: g.type, ...g.at }] : [])))
                expect(layoutReachable(furnished), `${zones.at(-1)} ${games.join(',')}`).toBe(true)
                checked++
            }
        }
        expect(checked).toBeGreaterThan(80)
    })

    it('lets a cut-off floor be fixed one move at a time, and never made worse', () => {
        // An old floor where a wall of plants already cuts off the way to the Table Pit's doorway.
        const wall: LayoutPiece[] = Array.from({ length: 8 }, (_, i) => ({ key: `decor:${i + 1}`, rect: { x: 14 + i, y: 16, w: 1, h: 1 }, blocks: true, front: [] }))
        const base = layout(['backroom'], [])
        const stuck: LayoutInput = { zones: base.zones, pieces: [...base.pieces, ...wall] }
        expect(layoutReachable(stuck)).toBe(false)
        // Moves elsewhere that cut nothing more off are fine; so is taking a plant out of the wall.
        expect(plantProblem(stuck, plant(18, 19))).toBeNull()
        expect(placementProblem(stuck, { kind: 'decor', id: 8, type: 'plant' }, { x: 18, y: 19 })).toBeNull()
        // One that cuts off more (the way to the builder's desk) is not.
        expect(plantProblem(stuck, plant(16, 21))).toBe('Blocks the way through')
    })

    it('finds a new game its home spot, else the nearest free one, else none', () => {
        const l = layout(['backroom'], STARTERS)
        expect(buildSpot(l, 'limbo')).toEqual(homeSpot('limbo'))
        const home = homeSpot('limbo')!
        const crowded = layout(['backroom'], STARTERS, [{ id: 1, type: 'plant', x: home.x, y: home.y }])
        const spot = buildSpot(crowded, 'limbo')!
        expect(spot).not.toEqual(home)
        expect(placementProblem(crowded, { kind: 'game', id: 'limbo' }, spot)).toBeNull()
        expect(buildSpot(crowded, 'limbo')).toEqual(spot) // deterministic
        // A game whose old room isn't owned stands in one that is.
        const roulette = buildSpot(l, 'roulette')!
        expect(zoneAt(roulette.x, roulette.y)).toBe('backroom')
        // No free spot at all: a rug over the whole room.
        const full: LayoutInput = { zones: ['backroom'], pieces: [{ key: 'decor:1', rect: { x: 14, y: 14, w: 8, h: 8 }, blocks: false, front: [] }] }
        expect(buildSpot(full, 'limbo')).toBeNull()
    })

    it('walks the layout: machines and furniture block, rugs and unbuilt plots do not', () => {
        const nav = new NavGrid(layout(['backroom'], STARTERS, [{ id: 1, type: 'rug', x: 16, y: 18 }, { id: 2, type: 'plant', x: 18, y: 18 }]))
        expect(nav.isWalkable(16, 18)).toBe(true)
        expect(nav.isWalkable(18, 18)).toBe(false)
        expect(nav.isWalkable(PLOTS.plinko!.rect.x, PLOTS.plinko!.rect.y)).toBe(false)
        expect(nav.isWalkable(PLOTS.limbo!.rect.x, PLOTS.limbo!.rect.y)).toBe(true) // not built
        expect(nav.isWalkable(10, 16)).toBe(false) // main floor, not owned
        expect(nav.owned.has('backroom')).toBe(true)
    })
})

describe('casino level', () => {
    const maxed = { zones: ALL_ZONES, games: Object.fromEntries(TYCOON_GAMES.map(g => [g.slug, g.levels.length])), upgrades: Object.fromEntries(UPGRADES.map(u => [u.id, u.levels.length])) as never }
    const fresh = { zones: ['backroom'] as ZoneId[], games: { plinko: 1, spinata: 1 }, upgrades: { cage: 0, marketing: 0, decor: 0, hospitality: 0, crew: 0 } }

    it('climbs from 1 to the top with the builds, every level further than the last', () => {
        expect(LEVEL_XP).toHaveLength(MAX_CASINO_LEVEL)
        for (let i = 1; i < LEVEL_XP.length; i++) expect(LEVEL_XP[i]!).toBeGreaterThan(LEVEL_XP[i - 1]!)
        for (let i = 2; i < LEVEL_XP.length; i++) expect(LEVEL_XP[i]! - LEVEL_XP[i - 1]!, `level ${i + 1}`).toBeGreaterThanOrEqual(LEVEL_XP[i - 1]! - LEVEL_XP[i - 2]!)
        expect(casinoLevel(fresh)).toEqual({ level: 1, xp: 0, levelXp: 0, nextXp: LEVEL_XP[1] })
        const top = casinoLevel(maxed)
        expect(top.level).toBe(MAX_CASINO_LEVEL)
        expect(top.nextXp).toBeNull()
        // Every step adds XP, a bigger step more.
        const limbo = casinoXp({ ...fresh, games: { ...fresh.games, limbo: 1 } })
        const wheel = casinoXp({ ...fresh, games: { ...fresh.games, wheel: 1 } })
        expect(limbo).toBeGreaterThan(0)
        expect(wheel).toBeGreaterThan(limbo)
        expect(casinoLevel({ ...fresh, zones: ['backroom', 'main'] }).level).toBeGreaterThan(1)
    })

    it('unlocks every game and decoration on some level, the starters at once, later rooms later', () => {
        for (const game of TYCOON_GAMES) {
            const level = gameUnlockLevel(game.slug)
            expect(level).toBeGreaterThanOrEqual(1)
            expect(level).toBeLessThan(MAX_CASINO_LEVEL)
            if (game.starter) expect(level).toBe(1)
        }
        const zoneIndex = (id: string) => ZONES.findIndex(zone => zone.id === id)
        for (const a of TYCOON_GAMES) {
            for (const b of TYCOON_GAMES) {
                if (zoneIndex(a.zone) < zoneIndex(b.zone)) expect(gameUnlockLevel(a.slug), `${a.slug} before ${b.slug}`).toBeLessThanOrEqual(gameUnlockLevel(b.slug))
            }
        }
        const unlocks = levelUnlocks()
        expect(unlocks.flatMap(u => u.games).sort()).toEqual(TYCOON_GAMES.filter(g => gameUnlockLevel(g.slug) > 1).map(g => g.slug).sort())
        expect(unlocks.flatMap(u => u.decor).sort()).toEqual(DECOR.filter(d => d.level > 1).map(d => d.type).sort())
        for (const u of unlocks) expect(u.games.length + u.decor.length).toBeGreaterThan(0)
    })
})

describe('specials in the visitor model', () => {
    const top: FloorView = { zones: ALL_ZONES, games: Object.fromEntries(TYCOON_GAMES.map(g => [g.slug, 5])), upgrades: { cage: 5, marketing: 5, hospitality: 8, crew: 1 } }
    const all = specialBonus(SPECIALS)
    const richer = DECOR.filter(d => d.special?.stat === 'prestige')

    it('lifts what guests spend and the tier odds while placed, never the crowd', () => {
        const spend = specialBonus(['jackpot-sign'])
        const prestige = specialBonus(['aquarium'])
        expect(spend.prestige).toBe(0)
        expect(prestige.spend).toBe(0)
        expect(specialBonus(['plant', 'jackpot-sign', 'jackpot-sign'])).toEqual(spend)
        expect(expectedPerHour({ ...top, specials: spend })).toBeGreaterThan(expectedPerHour(top))
        expect(tierOdds({ ...top, specials: prestige }).whale).toBeGreaterThan(tierOdds(top).whale)
        expect(expectedFloor({ ...top, specials: all }).demand).toBeCloseTo(expectedFloor(top).demand, 9)
        // At the top: the richer-guests specials take over the old Decor upgrade's ~+15% (no more), all of
        // them together about +25%, and with every ad running they don't stack past +100%.
        const best = (v: FloorView, at?: number) => Math.max(...ruleCombos(v).map(rules => expectedPerHour({ ...v, rules }, at)))
        const lift = (bonus: ReturnType<typeof specialBonus>, at?: number, campaigns: FloorView['campaigns'] = []) => best({ ...top, campaigns, specials: bonus }, at) / best({ ...top, campaigns }, at) - 1
        expect(lift(specialBonus(richer.map(d => d.type)))).toBeGreaterThan(0.12)
        expect(lift(specialBonus(richer.map(d => d.type)))).toBeLessThan(0.18)
        expect(lift(all)).toBeGreaterThan(0.2)
        expect(lift(all)).toBeLessThan(0.3)
        expect(lift(all, 0, CAMPAIGNS.map(c => ({ id: c.id, until: 1e15 })))).toBeLessThan(1)
    })

    it('climbs the rarity ladder: a richer-guests special every few levels, each shifting guests up at its level', () => {
        const levels = richer.map(d => d.level)
        for (let i = 1; i < levels.length; i++) {
            expect(levels[i]! - levels[i - 1]!).toBeGreaterThanOrEqual(2)
            expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(5)
        }
        // At the level each one unlocks (the rooms open by then, the earlier ones placed), it moves guests up a tier.
        const roomAt = (level: number) => ALL_ZONES.slice(0, level < 6 ? 1 : level < 11 ? 2 : level < 16 ? 3 : level < 25 ? 4 : level < 28 ? 5 : 6)
        const placed: { id: number, type: DecorType, x: number, y: number }[] = []
        for (const def of richer) {
            const zones = roomAt(def.level)
            const state = { zones, games: Object.fromEntries(TYCOON_GAMES.filter(g => zones.includes(g.zone)).map(g => [g.slug, 3])), upgrades: { cage: 2, marketing: 2, hospitality: 2, crew: 0 }, rushUntil: null, campaign: null, decor: [...placed] }
            const odds = specialOdds(state, def.type)
            expect(odds.with.tourist, def.type).toBeLessThan(odds.without.tourist - 0.01)
            expect(odds.with.regular + odds.with.highroller + odds.with.whale, def.type).toBeGreaterThan(odds.without.regular + odds.without.highroller + odds.without.whale + 0.01)
            placed.push({ id: placed.length + 1, type: def.type, x: 0, y: 0 })
        }
    })

    it('keeps the maxed rush with every special owned under the gem cap, so the 1.25 premium holds', () => {
        const owned = SPECIALS.map((type, i) => ({ id: i + 1, type, x: null, y: null }))
        const state = { ...top, decor: owned }
        const fair = Math.ceil(rushExtraCoins(state) / COINS_PER_GEM * 1.25)
        expect(fair).toBeLessThanOrEqual(RUSH_MAX_GEMS)
        expect(rushGems(state)).toBe(fair)
        // Every coin the rush can bring costs at least 1.25 × the convert rate in gems.
        expect(rushExtraCoins(state) / rushGems(state)).toBeLessThanOrEqual(COINS_PER_GEM / 1.25 + 1e-9)
    })

    it('prices a rush as if every special the casino owns stood on the floor: never cheaper than converting', () => {
        const owned = SPECIALS.map((type, i) => ({ id: i + 1, type, x: null, y: null }))
        const state = { ...top, rushUntil: null, campaign: null }
        const price = rushGems({ ...state, decor: owned })
        expect(price).toBeGreaterThanOrEqual(rushGems(state))
        const open = CAMPAIGNS.filter(c => !campaignBlocker(state, c.id, 0)).map(c => c.id)
        for (const mix of [[], open]) {
            for (const rules of ruleCombos(state)) {
                // Every special placed during the rush, any ads, any rules.
                const base = { ...state, rules, specials: all, campaigns: mix.map(id => ({ id, until: RUSH_MS })) }
                const extra = (expectedPerHour({ ...base, rushUntil: RUSH_MS }, 0) - expectedPerHour(base, 0)) * RUSH_MS / HOUR
                expect(extra / price).toBeLessThan(COINS_PER_GEM)
            }
        }
    })
})

describe('decorations on the server', () => {
    /** A casino with every room and every game at level 1 (a high casino level), and chips. */
    const builtPlayer = (chips = 1_000_000) => seedPlayer(0, 0, { origin: 'dev', chips })
    const decorRows = (id: string) => db.select().from(casinoDecor).where(eq(casinoDecor.playerId, id)).all()

    it('reads bodies strictly', () => {
        expect(parseBuyDecorBody({ type: 'plant' })).toEqual({ type: 'plant' })
        expect(parseBuyDecorBody({ type: 'plant', x: 3, y: 4 })).toEqual({ type: 'plant', x: 3, y: 4 })
        expect(() => parseBuyDecorBody({ type: 'gnome' })).toThrow()
        expect(() => parseBuyDecorBody({ type: 'plant', x: 3 })).toThrow()
        expect(() => parseBuyDecorBody({ type: 'plant', x: '3', y: 4 })).toThrow()
        expect(() => parseBuyDecorBody({ type: 'plant', x: 1.5, y: 4 })).toThrow()
        expect(parsePlaceBody({ item: 'game', id: 'limbo', x: 1, y: 2 })).toEqual({ item: 'game', id: 'limbo', x: 1, y: 2 })
        expect(parsePlaceBody({ item: 'decor', id: 3, store: true })).toEqual({ item: 'decor', id: 3, store: true })
        expect(parsePlaceBody({ item: 'game', id: 'limbo', store: true })).toEqual({ item: 'game', id: 'limbo', store: true })
        expect(() => parsePlaceBody({ item: 'game', id: 'limbo', store: true, x: 1, y: 2 })).toThrow()
        expect(() => parsePlaceBody({ item: 'game', id: 'limbo', store: 'yes' })).toThrow()
        expect(parsePlaceBody({ item: 'decor', id: 3, x: 1, y: 2 })).toEqual({ item: 'decor', id: 3, x: 1, y: 2 })
        expect(() => parsePlaceBody({ item: 'decor', id: '3', x: 1, y: 2 })).toThrow()
        expect(() => parsePlaceBody({ item: 'decor', id: 3, store: true, x: 1, y: 2 })).toThrow()
        expect(() => parsePlaceBody({ item: 'decor', id: 3, store: false })).toThrow()
        expect(() => parsePlaceBody({ item: 'game', id: 'limbo' })).toThrow()
        expect(() => parsePlaceBody({ item: 'zone', id: 'main', x: 1, y: 2 })).toThrow()
    })

    it('grants the free furniture of every owned room once, where it stood, and never again once moved or put away', () => {
        const id = builtPlayer()
        const first = getTycoonState(id)
        expect(first.decor).toHaveLength(PROPS.length)
        expect(first.decor!.every(d => d.x !== null)).toBe(true)
        expect(getTycoonState(id).decor).toHaveLength(PROPS.length)
        const sofa = first.decor!.find(d => d.type === 'sofa')!
        placeItem(id, { item: 'decor', id: sofa.id, store: true })
        // Read again: the stored sofa stays stored, nothing comes twice.
        const later = getTycoonState(id)
        expect(later.decor).toHaveLength(PROPS.length)
        expect(later.decor!.find(d => d.id === sofa.id)).toMatchObject({ x: null, y: null })
        expect(decorRows(id).filter(row => row.grantKey)).toHaveLength(PROPS.length)
        // Visitors and the floor socket see the same casino.
        const visit = getCasinoVisit(seedPlayer(0, 0, { casino: 'none', origin: 'dev' }), id)
        expect(visit.decorations).toHaveLength(PROPS.length - 1)
        expect(visit.placements!.plinko).toEqual(homeSpot('plinko'))
        const placed = later.decor!.find(d => d.x !== null)!
        expect(dbPresenceSource.walkable(id)(placed.x!, placed.y!)).toBe(false)
    })

    it('gives a room\'s furniture on the first read after it opens, once', () => {
        const id = seedPlayer(0, 0, { casino: 'none', origin: 'dev' })
        const backroom = PROPS.filter(p => p.zone === 'backroom')
        expect(getTycoonState(id).decor!.map(d => d.type).sort()).toEqual(backroom.map(p => p.kind).sort())
        db.update(casinoProfiles).set({ zones: ['backroom', 'main', 'pit'] }).where(eq(casinoProfiles.playerId, id)).run()
        const due = PROPS.filter(p => ['backroom', 'main', 'pit'].includes(p.zone))
        const first = getTycoonState(id).decor!
        expect(first.map(d => d.type).sort()).toEqual(due.map(p => p.kind).sort())
        expect(first.every(d => d.x !== null)).toBe(true)
        expect(getTycoonState(id).decor).toEqual(first)
        expect(decorRows(id)).toHaveLength(due.length)
    })

    it('pays back the removed Decor upgrade once, levels built and building, however many reads race', async () => {
        const id = seedPlayer(0, 0, { origin: 'dev', chips: 1_000 })
        const now = Date.now()
        db.update(casinoProfiles).set({ upgrades: { cage: 1, marketing: 2, decor: 6, hospitality: 1, crew: 0 } }).where(eq(casinoProfiles.playerId, id)).run()
        db.insert(casinoConstructions).values({ playerId: id, kind: 'upgrade', target: 'decor', level: 7, startedAt: new Date(now - HOUR), readyAt: new Date(now - 1) }).run()
        // A gem skip can't finish the Decor level (the upgrade is gone): the skip is handed back, the level refunded.
        expect(writeTx(tx => finishConstruction(tx, id, 'upgrade', 'decor', now))).toBe(false)
        expect(db.select().from(casinoConstructions).where(eq(casinoConstructions.playerId, id)).all()).toHaveLength(1)
        // A write that isn't a coin unit first keeps the Decor levels on the row; its response (an owner's read) pays them.
        const moved = placeItem(id, { item: 'game', id: 'plinko', ...homeSpot('plinko')! }, now)
        const reads = await Promise.allSettled(Array.from({ length: 6 }, () => Promise.resolve().then(() => getTycoonState(id, now))))
        expect(reads.every(r => r.status === 'fulfilled')).toBe(true)
        const paid = T.decorRefund(7)
        // The read that paid it says so (once), for the notice.
        expect(moved.state.decorRefund).toBe(paid)
        expect(reads.map(r => (r.status === 'fulfilled' ? r.value.decorRefund : undefined)).filter(Boolean)).toEqual([])
        expect(paid).toBe(T.DECOR_REFUND_CHIPS.slice(0, 7).reduce((a, b) => a + b, 0))
        expect(chipsOf(id)).toBe(1_000 + paid)
        const rows = db.select().from(chipTransactions).where(eq(chipTransactions.playerId, id)).all()
        expect(rows.filter(r => r.reason === 'refund:decor')).toEqual([expect.objectContaining({ type: 'credit', amount: paid })])
        const row = db.select({ upgrades: casinoProfiles.upgrades }).from(casinoProfiles).where(eq(casinoProfiles.playerId, id)).get()!
        expect(row.upgrades).toEqual({ cage: 1, marketing: 2, hospitality: 1, crew: 0 })
        expect(db.select().from(casinoConstructions).where(eq(casinoConstructions.playerId, id)).all()).toEqual([])
        expect(getTycoonState(id, now).upgrades).toEqual({ cage: 1, marketing: 2, hospitality: 1, crew: 0 })
        expect(chipsOf(id)).toBe(1_000 + paid)
    })

    it('buys plain decorations for chips, into storage or placed at once, level-gated', async () => {
        const id = builtPlayer(10_000)
        getTycoonState(id)
        const plant = findDecor('plant')!
        const stored = await buyDecor(id, { type: 'plant' })
        const bought = stored.state.decor!.filter(d => d.type === 'plant' && d.x === null)
        expect(bought).toHaveLength(1)
        expect(chipsOf(id)).toBe(10_000 - plant.chips)
        expect(db.select().from(chipTransactions).where(eq(chipTransactions.playerId, id)).all().at(-1)).toMatchObject({ reason: 'decor:plant', amount: plant.chips })
        const placed = await buyDecor(id, { type: 'plant', x: 18, y: 18 })
        expect(placed.state.decor!.filter(d => d.x === 18 && d.y === 18)).toHaveLength(1)
        // A bad spot buys nothing.
        await expect(buyDecor(id, { type: 'plant', x: 18, y: 18 })).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Something is in the way' })
        await expect(buyDecor(id, { type: 'plant', x: 14, y: 17 })).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Keep the doorways clear' })
        expect(chipsOf(id)).toBe(10_000 - 2 * plant.chips)
        // Too poor, too low a level.
        giveChips(id, 10)
        await expect(buyDecor(id, { type: 'plant' })).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Not enough chips' })
        const fresh = seedPlayer(0, 0, { casino: 'none', origin: 'dev' })
        getTycoonState(fresh)
        giveChips(fresh, 10_000)
        const flowers = findDecor('flowers')!
        await expect(buyDecor(fresh, { type: 'flowers' })).rejects.toMatchObject({ statusCode: 403, statusMessage: `Reach casino level ${flowers.level}` })
        expect(chipsOf(fresh)).toBe(10_000)
    })

    it('sells each special once, even to a burst, and counts it only while it stands on the floor', async () => {
        const id = builtPlayer()
        const t0 = Date.now()
        const before = getTycoonState(id, t0)
        const burst = await Promise.allSettled(Array.from({ length: 6 }, () => buyDecor(id, { type: 'jackpot-sign' }, t0)))
        expect(burst.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(burst.find(r => r.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } })
        expect(chipsOf(id)).toBe(1_000_000 - findDecor('jackpot-sign')!.chips)
        const sign = getTycoonState(id, t0).decor!.find(d => d.type === 'jackpot-sign')!
        expect(sign.x).toBeNull()
        // Stored, it does nothing; placed, guests spend more; the cage ran at the old rate up to the move.
        expect(getTycoonState(id, t0).floor.expectedPerHour).toBe(before.floor.expectedPerHour)
        const t1 = t0 + HOUR
        const placed = placeItem(id, { item: 'decor', id: sign.id, x: 16, y: 19 }, t1)
        expect(placed.state.floor.expectedPerHour).toBeGreaterThan(before.floor.expectedPerHour)
        expect(db.select({ at: casinoProfiles.cageAt }).from(casinoProfiles).where(eq(casinoProfiles.playerId, id)).get()!.at.getTime()).toBe(t1)
        const stored = placeItem(id, { item: 'decor', id: sign.id, store: true }, t1 + HOUR)
        expect(stored.state.floor.expectedPerHour).toBe(before.floor.expectedPerHour)
        expect(db.select({ at: casinoProfiles.cageAt }).from(casinoProfiles).where(eq(casinoProfiles.playerId, id)).get()!.at.getTime()).toBe(t1 + HOUR)
        await expect(buyDecor(id, { type: 'jackpot-sign' })).rejects.toMatchObject({ statusCode: 409 })
        // A rush is priced with every special owned, placed or not.
        expect(rushGems(stored.state)).toBe(rushGems({ ...stored.state, decor: stored.state.decor!.map(d => ({ ...d, x: 1, y: 1 })) }))
    })

    it('prices campaigns and mission rewards from every special owned, placed or put away', () => {
        const base = { zones: ALL_ZONES, games: Object.fromEntries(TYCOON_GAMES.map(g => [g.slug, 3])), upgrades: { cage: 3, marketing: 3, decor: 6, hospitality: 2, crew: 0 } }
        const stored = { ...base, decor: SPECIALS.map((type, i) => ({ id: i + 1, type, x: null, y: null })) }
        const placed = { ...base, decor: SPECIALS.map((type, i) => ({ id: i + 1, type, x: 1, y: 1 })) }
        expect(fullIncomePerHour(stored)).toBe(fullIncomePerHour(placed))
        expect(fullIncomePerHour(stored)).toBeGreaterThan(fullIncomePerHour(base))
        for (const c of CAMPAIGNS) expect(campaignCost(stored, c.id, 0), c.id).toBe(campaignCost(placed, c.id, 0))
        expect(missionReward(stored, 1)).toBe(missionReward(placed, 1))
    })

    it('leaves a Decor level from before it left out of "while you were away"', () => {
        const id = builtPlayer()
        const t0 = Date.now()
        const snap = { at: t0, cage: 0, zones: ALL_ZONES, games: { plinko: 1 }, upgrades: { decor: 4 }, constructions: [{ kind: 'upgrade', id: 'decor', level: 5, readyAt: t0 + 60_000 }, { kind: 'upgrade', id: 'cage', level: 1, readyAt: t0 + 60_000 }], rushUntil: null, campaigns: [], rules: { door: 'open', vip: false } }
        db.update(casinoProfiles).set({ lastSeenAt: new Date(t0), lastSeen: snap }).where(eq(casinoProfiles.playerId, id)).run()
        const away = getTycoonState(id, t0 + 3 * HOUR, { welcome: true }).welcome!
        expect(away.finished).toEqual([{ kind: 'upgrade', id: 'cage', level: 1 }])
    })

    it('replays a placed special in "while you were away"', async () => {
        const id = builtPlayer()
        const t0 = Date.now()
        getTycoonState(id, t0)
        await collectCage(id, t0)
        const bought = await buyDecor(id, { type: 'jackpot-sign', x: 16, y: 19 }, t0)
        const t1 = t0 + 30 * 60_000
        const away = getTycoonState(id, t1, { welcome: true }).welcome!
        const withSign = runFloor(floorView(bought.state), luckSeed(id), t0, t1).income
        const without = runFloor(floorView({ ...bought.state, decor: [] }), luckSeed(id), t0, t1).income
        expect(withSign).toBeGreaterThan(without + 1)
        expect(Math.abs(away.earned + away.lost - withSign)).toBeLessThanOrEqual(1)
    })

    it('shows visitors a game under its first construction where the walk grid blocks it, the same floor everywhere', async () => {
        const id = seedPlayer(0, 0, { casino: 'none', origin: 'dev' })
        const t0 = Date.now()
        getTycoonState(id, t0)
        giveChips(id, 100_000)
        db.insert(casinoDecor).values({ playerId: id, type: 'rug', x: 16, y: 18 }).run()
        await buyDecor(id, { type: 'plant', x: 21, y: 18 }, t0)
        const owner = (await startBuild(id, { kind: 'game', id: 'limbo' }, t0)).state
        const visit = getCasinoVisit(seedPlayer(0, 0, { casino: 'none', origin: 'dev' }), id, t0)
        expect(visit.building).toEqual(['limbo'])
        expect(visit.games.limbo).toBeUndefined()
        expect(visit.placements!.limbo).toEqual(owner.placements!.limbo)
        const socket = dbPresenceSource.walkable(id)
        const fromVisit = new NavGrid(layoutOf(layoutStateOf({ zones: visit.zones, games: visit.games, constructions: visit.building!.map(slug => ({ kind: 'game', id: slug })), placements: visit.placements, decor: visit.decorations })))
        const fromOwner = new NavGrid(layoutOf(layoutStateOf(owner)))
        for (let y = -1; y <= 23; y++) {
            for (let x = -1; x <= 22; x++) {
                expect(fromVisit.isWalkable(x, y), `${x},${y}`).toBe(socket(x, y))
                expect(fromOwner.isWalkable(x, y), `${x},${y}`).toBe(socket(x, y))
            }
        }
        const at = visit.placements!.limbo!
        expect(socket(at.x, at.y)).toBe(false)
        expect(socket(16, 18)).toBe(true) // the rug
        expect(socket(21, 18)).toBe(false) // the plant
    })

    it('tells the floor socket when the floor changed', async () => {
        const changed: string[] = []
        const stop = onFloorChange(casinoId => changed.push(casinoId))
        const id = builtPlayer()
        getTycoonState(id)
        changed.length = 0
        await buyDecor(id, { type: 'plant' })
        expect(changed).toEqual([])
        const plant = getTycoonState(id).decor!.find(d => d.type === 'plant' && d.x === null)!
        placeItem(id, { item: 'decor', id: plant.id, x: 18, y: 19 })
        expect(changed).toEqual([id])
        await buyDecor(id, { type: 'plant', x: 17, y: 19 })
        expect(changed).toEqual([id, id])
        stop()
    })

    it('lands one of two parallel moves onto the same tile', async () => {
        const id = builtPlayer()
        getTycoonState(id)
        await buyDecor(id, { type: 'plant' })
        await buyDecor(id, { type: 'plant' })
        const plants = getTycoonState(id).decor!.filter(d => d.type === 'plant' && d.x === null)
        const moves = await Promise.allSettled(plants.map(p => Promise.resolve().then(() => placeItem(id, { item: 'decor', id: p.id, x: 18, y: 18 }))))
        expect(moves.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(moves.find(r => r.status === 'rejected')).toMatchObject({ reason: { statusCode: 400, statusMessage: 'Something is in the way' } })
        expect(decorRows(id).filter(row => row.x === 18 && row.y === 18)).toHaveLength(1)
        await expect(Promise.resolve().then(() => placeItem(id, { item: 'decor', id: 999_999, store: true }))).rejects.toMatchObject({ statusCode: 404 })
    })

    it('moves built games and ones the builders are working on, and gives a new game a free spot', async () => {
        const id = seedPlayer(0, 0, { casino: 'none', origin: 'dev' })
        const t0 = Date.now()
        getTycoonState(id, t0)
        giveChips(id, 100_000)
        // Something stands on Limbo's home spot: it is built next to it instead, and stays there.
        const home = homeSpot('limbo')!
        await buyDecor(id, { type: 'plant', x: home.x, y: home.y }, t0)
        const started = await startBuild(id, { kind: 'game', id: 'limbo' }, t0)
        const spot = started.state.placements!.limbo!
        expect(spot).not.toEqual(home)
        expect(zoneAt(spot.x, spot.y)).toBe('backroom')
        // Moving it while the builders work is fine: the construction keeps running where it now stands.
        const during = findSpot(started.state.placements ? layoutOf(layoutStateOf(started.state)) : layout(['backroom'], STARTERS), { kind: 'game', id: 'limbo' }, { x: 16, y: 19 })!
        expect(placeItem(id, { item: 'game', id: 'limbo', ...during }, t0).state.placements!.limbo).toEqual(during)
        expect(() => placeItem(id, { item: 'game', id: 'limbo', store: true }, t0)).toThrow(expect.objectContaining({ statusCode: 400, statusMessage: 'A game under construction can\'t be put away' }))
        expect(() => placeItem(id, { item: 'game', id: 'wheel', x: 19, y: 16 }, t0)).toThrow(expect.objectContaining({ statusCode: 404 }))
        const done = getTycoonState(id, t0 + HOUR)
        expect(done.games.limbo).toBe(1)
        expect(done.placements!.limbo).toEqual(during)
        expect(() => placeItem(id, { item: 'game', id: 'plinko', x: 10, y: 16 }, t0 + HOUR)).toThrow(expect.objectContaining({ statusCode: 400, statusMessage: 'Not in a room you own' }))
        const to = findSpot(layoutOf(layoutStateOf(done)), { kind: 'game', id: 'plinko' }, { x: 17, y: 20 })!
        expect(to).not.toEqual(done.placements!.plinko)
        const moved = placeItem(id, { item: 'game', id: 'plinko', ...to }, t0 + HOUR)
        expect(moved.state.placements!.plinko).toEqual(to)
        // Income doesn't depend on where a machine stands.
        expect(moved.state.floor.expectedPerHour).toBe(done.floor.expectedPerHour)
        expect(db.select().from(casinoConstructions).where(eq(casinoConstructions.playerId, id)).all()).toEqual([])
    })

    it('refuses a new game below its level, and one with no room left', async () => {
        const id = seedPlayer(0, 0, { casino: 'none', origin: 'dev' })
        getTycoonState(id)
        giveChips(id, 1_000_000)
        await expect(startBuild(id, { kind: 'game', id: 'roulette' })).rejects.toMatchObject({ statusCode: 400, statusMessage: `Reach casino level ${gameUnlockLevel('roulette')}` })
        // A rug over every free tile of the backroom leaves no room for Limbo.
        const state = getTycoonState(id)
        const l = layoutOf(layoutStateOf(state))
        let n = 0
        for (let y = 14; y < 22; y++) {
            for (let x = 14; x < 22; x++) {
                if (placementProblem(l, { kind: 'decor', type: 'plant' }, { x, y }) === null) {
                    l.pieces.push({ key: `fill:${n++}`, rect: { x, y, w: 1, h: 1 }, blocks: false, front: [] })
                    db.insert(casinoDecor).values({ playerId: id, type: 'rug', x, y }).run()
                }
            }
        }
        expect(getTycoonState(id).decor!.length).toBe(n + PROPS.filter(p => p.zone === 'backroom').length)
        await expect(startBuild(id, { kind: 'game', id: 'limbo' })).rejects.toMatchObject({ statusCode: 400, statusMessage: 'No room for it: open a room or move things' })
    })
})

describe('putting games away', () => {
    const top = { zones: ALL_ZONES, games: Object.fromEntries(TYCOON_GAMES.map(g => [g.slug, 5])), upgrades: { cage: 5, marketing: 5, hospitality: 8, crew: 1 } }
    const cageAt = (id: string) => db.select({ at: casinoProfiles.cageAt }).from(casinoProfiles).where(eq(casinoProfiles.playerId, id)).get()!.at.getTime()

    it('takes a put-away game off the visitor model: no seats, no prestige, the rooms stay', () => {
        const away = ['limbo', 'roulette', 'baccarat']
        const state = { ...top, rushUntil: null, campaign: null }
        const view = floorView({ ...state, storedGames: away })
        for (const slug of away) expect(view.games[slug]).toBeUndefined()
        expect(T.floorSeats({ ...state, storedGames: away })).toBe(T.floorSeats(state) - away.reduce((n, slug) => n + T.seatsOf(slug, 5), 0))
        expect(expectedFloor(view).seats).toBe(T.floorSeats({ ...state, storedGames: away }))
        expect(expectedPerHour(view)).toBeLessThan(expectedPerHour(floorView(state)))
        // A top machine's prestige leaves with it.
        expect(tierOdds(view).whale).toBeLessThan(tierOdds(floorView(state)).whale)
        // Without zones they are read from every built game: putting the only game of a room away keeps the room.
        const noZones = { games: { plinko: 1, spinata: 1, limbo: 1, roulette: 1 }, upgrades: { cage: 0, marketing: 0, hospitality: 0, crew: 0 }, rushUntil: null, campaign: null }
        expect(floorView({ ...noZones, storedGames: ['roulette'] }).zones).toEqual(expect.arrayContaining([T.findTycoonGame('roulette')!.zone]))
    })

    it('prices campaigns, rushes and mission rewards as if every built game stood on the floor', () => {
        const state = { zones: ALL_ZONES, games: Object.fromEntries(TYCOON_GAMES.map(g => [g.slug, 3])), upgrades: { cage: 3, marketing: 5, hospitality: 2, crew: 0 }, rushUntil: null, campaign: null }
        const away = { ...state, storedGames: TYCOON_GAMES.map(g => g.slug).filter(slug => slug !== 'plinko') }
        // Income does drop, so the prices must not.
        expect(expectedPerHour(floorView(away))).toBeLessThan(expectedPerHour(floorView(state)) / 2)
        expect(fullIncomePerHour(away)).toBe(fullIncomePerHour(state))
        expect(rushGems(away)).toBe(rushGems(state))
        expect(missionReward(away, 1)).toBe(missionReward(state, 1))
        for (const c of CAMPAIGNS) expect(campaignCost(away, c.id, 0), c.id).toBe(campaignCost(state, c.id, 0))
    })

    it('puts a built game away: the cage runs at the old rate up to then, then seats and income drop', () => {
        const changed: string[] = []
        const stop = onFloorChange(casinoId => changed.push(casinoId))
        const id = seedPlayer(0, 0, { origin: 'dev', chips: 1_000_000 })
        const t0 = Date.now()
        getTycoonState(id, t0)
        const t1 = t0 + 2 * HOUR
        const before = getTycoonState(id, t1)
        changed.length = 0
        const after = placeItem(id, { item: 'game', id: 'limbo', store: true }, t1).state
        expect(changed).toEqual([id])
        expect(cageAt(id)).toBe(t1)
        expect(after.cage.stored).toBe(before.cage.stored)
        expect(after.storedGames).toEqual(['limbo'])
        expect(after.placements!.limbo).toBeUndefined()
        expect(after.floor.seats).toBe(before.floor.seats - T.seatsOf('limbo', 1))
        expect(after.floor.expectedPerHour).toBeLessThan(before.floor.expectedPerHour)
        // Still owned: level, progress, casino level, value; its spot is free floor now.
        expect(after.games.limbo).toBe(1)
        expect(after.progress).toBe(before.progress)
        expect(casinoLevel(after)).toEqual(casinoLevel(before))
        expect(hasBuiltGame(id, 'limbo')).toBe(true)
        const home = before.placements!.limbo!
        expect(dbPresenceSource.walkable(id)(home.x, home.y)).toBe(true)
        expect(placementProblem(layoutOf(layoutStateOf(after)), { kind: 'decor', type: 'plant' }, home)).toBeNull()
        // Again: nothing changes.
        expect(placeItem(id, { item: 'game', id: 'limbo', store: true }, t1 + HOUR).state.storedGames).toEqual(['limbo'])
        expect(cageAt(id)).toBe(t1)
        stop()
    })

    it('refuses an upgrade while it is away, and puts it back on a free spot only', async () => {
        const id = seedPlayer(0, 0, { origin: 'dev', chips: 1_000_000 })
        const t0 = Date.now()
        const before = getTycoonState(id, t0)
        placeItem(id, { item: 'game', id: 'limbo', store: true }, t0)
        expect(T.buildBlocker(getTycoonState(id, t0), 'game', 'limbo')).toBe(T.STORED_BLOCKER)
        await expect(startBuild(id, { kind: 'game', id: 'limbo' }, t0)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Place it on the floor first' })
        expect(chipsOf(id)).toBe(1_000_000)
        // Nowhere it can't stand.
        const plinko = before.placements!.plinko!
        expect(() => placeItem(id, { item: 'game', id: 'limbo', ...plinko }, t0)).toThrow(expect.objectContaining({ statusCode: 400, statusMessage: 'Something is in the way' }))
        expect(() => placeItem(id, { item: 'game', id: 'limbo', x: -5, y: 3 }, t0)).toThrow(expect.objectContaining({ statusCode: 400, statusMessage: 'Not in a room you own' }))
        expect(getTycoonState(id, t0).storedGames).toEqual(['limbo'])
        // Back on a free spot: the rate comes back, the cage first ran at the lower one.
        const t1 = t0 + HOUR
        const away = getTycoonState(id, t1)
        const spot = findSpot(layoutOf(layoutStateOf(away)), { kind: 'game', id: 'limbo' }, before.placements!.limbo!)!
        const back = placeItem(id, { item: 'game', id: 'limbo', ...spot }, t1).state
        expect(cageAt(id)).toBe(t1)
        expect(back.cage.stored).toBe(away.cage.stored)
        expect(back.storedGames).toEqual([])
        expect(back.placements!.limbo).toEqual(spot)
        expect(back.floor.seats).toBe(before.floor.seats)
        expect(back.floor.expectedPerHour).toBe(before.floor.expectedPerHour)
        await expect(startBuild(id, { kind: 'game', id: 'limbo' }, t1)).resolves.toBeTruthy()
    })

    it('can\'t put away a game under construction, first build or upgrade', async () => {
        const id = seedPlayer(0, 0, { casino: 'none', origin: 'dev' })
        const t0 = Date.now()
        getTycoonState(id, t0)
        giveChips(id, 100_000)
        await startBuild(id, { kind: 'game', id: 'spinata' }, t0)
        expect(() => placeItem(id, { item: 'game', id: 'spinata', store: true }, t0)).toThrow(expect.objectContaining({ statusCode: 400, statusMessage: 'A game under construction can\'t be put away' }))
        expect(() => placeItem(id, { item: 'game', id: 'wheel', store: true }, t0)).toThrow(expect.objectContaining({ statusCode: 404 }))
        const t1 = t0 + 24 * HOUR
        expect(getTycoonState(id, t1).games.spinata).toBe(2)
        await startBuild(id, { kind: 'game', id: 'limbo' }, t1)
        expect(() => placeItem(id, { item: 'game', id: 'limbo', store: true }, t1)).toThrow(expect.objectContaining({ statusCode: 400, statusMessage: 'A game under construction can\'t be put away' }))
        expect(getTycoonState(id, t1).storedGames).toEqual([])
    })

    it('keeps a put-away game playable at home, but not for visitors of that casino', async () => {
        const host = seedPlayer(10_000, 10_000, { origin: 'dev' })
        const t0 = Date.now()
        const visitor = seedPlayer(10_000, 10_000, { origin: 'dev' })
        db.update(casinoProfiles).set({ zones: ['backroom'], games: { plinko: 1, spinata: 1 } }).where(eq(casinoProfiles.playerId, visitor)).run()
        const before = getCasinoVisit(visitor, host, t0)
        placeItem(host, { item: 'game', id: 'limbo', store: true }, t0)
        expect(hostHasGame(host, 'limbo')).toBe(false)
        expect(hostHasGame(host, 'plinko')).toBe(true)
        await expect(playRound(visitor, 'limbo', { bet: 100, options: { target: 2 }, host })).rejects.toThrow(/Build Limbo/)
        await expect(playRound(host, 'limbo', { bet: 100, options: { target: 2 } })).resolves.toBeTruthy()
        expect(coinsOf(visitor).coins).toBe(10_000)
        // The visit doesn't draw it; the casino is worth the same.
        const visit = getCasinoVisit(visitor, host, t0)
        expect(visit.games.limbo).toBeUndefined()
        expect(visit.placements!.limbo).toBeUndefined()
        expect(visit.value).toBe(before.value)
        expect(visit.level).toBe(before.level)
        expect(visit.floor!.seats).toBe(before.floor!.seats - T.seatsOf('limbo', 1))
    })

    it('handles a burst: many put-aways of one game, and two games put back onto one spot', async () => {
        const id = seedPlayer(0, 0, { origin: 'dev' })
        const t0 = Date.now()
        const before = getTycoonState(id, t0)
        const burst = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => Promise.resolve().then(() => placeItem(id, { item: 'game', id: 'limbo', store: true }, t0 + i))))
        expect(burst.every(r => r.status === 'fulfilled')).toBe(true)
        expect(cageAt(id)).toBe(t0)
        placeItem(id, { item: 'game', id: 'dice', store: true }, t0 + 10)
        const away = getTycoonState(id, t0 + 10)
        expect(away.storedGames).toEqual(['dice', 'limbo'])
        const spot = before.placements!.limbo!
        const moves = await Promise.allSettled(['limbo', 'dice'].map(slug => Promise.resolve().then(() => placeItem(id, { item: 'game', id: slug, ...spot }, t0 + 20))))
        expect(moves.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        const after = getTycoonState(id, t0 + 20)
        expect(after.storedGames).toHaveLength(1)
        const placed = ['limbo', 'dice'].find(slug => !after.storedGames!.includes(slug))!
        expect(after.placements![placed]).toEqual(spot)
    })
})
