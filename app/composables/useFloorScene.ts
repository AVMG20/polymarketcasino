import { skinOf } from '#shared/cosmetics'
import { gameUnlockLevel, roomLook } from '#shared/casino-level'
import { homeSpot, type Rect } from '#shared/floor/layout'
import { buildSpot, layoutOf, layoutStateOf, targetRect, type LayoutInput } from '#shared/floor/placement'
import { activeCampaign, findTycoonGame, TYCOON_GAMES, ZONES, type TableOccupancy, type TycoonState } from '#shared/tycoon'
import type { FloorDecoration, FloorPlot, FloorScene, FloorZone } from '~/utils/floor/types'

/** Where a game on the floor stands: its stored spot, else its home spot. */
export function standingRect(placements: TycoonState['placements'], slug: string): Rect | null {
    const at = placements?.[slug] ?? homeSpot(slug)
    return at ? targetRect({ kind: 'game', id: slug }, at) : null
}

/**
 * The dashed "build here" hints of the games the level allows but that aren't
 * on the floor yet: each exactly where the server would build it
 * (`newGameSpot`: the same layout, hints ignored). Two hints on the same tiles
 * would both promise one spot: only the cheaper game's is drawn, the other's
 * shows once that one is built.
 */
function hintRects(layout: LayoutInput, slugs: readonly string[]): Map<string, Rect> {
    const out = new Map<string, Rect>()
    const byPrice = [...slugs].sort((a, b) => (findTycoonGame(a)?.levels[0]?.chips ?? 0) - (findTycoonGame(b)?.levels[0]?.chips ?? 0))
    for (const slug of byPrice) {
        const at = buildSpot(layout, slug)
        if (!at) continue
        const rect = targetRect({ kind: 'game', id: slug }, at)
        if ([...out.values()].some(other => overlaps(rect, other))) continue
        out.set(slug, rect)
    }
    return out
}

function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** The decorations standing on the floor (put-away ones are not drawn). */
export function placedDecorations(decor: TycoonState['decor']): FloorDecoration[] {
    return (decor ?? []).flatMap(d => (d.x !== null && d.y !== null ? [{ id: d.id, type: d.type, x: d.x, y: d.y }] : []))
}

const TABLES_POLL_MS = 10_000

/**
 * Maps the tycoon state and the live table occupancy into the FloorScene the
 * Pixi floor draws. `startPolling()` keeps the occupancy fresh (~10 s) while
 * the page is visible.
 */
export function useFloorScene() {
    const tycoon = useTycoon()
    const session = useCasinoSession()
    const cosmetics = useCosmetics()
    const occupancy = useState<TableOccupancy[]>('tycoon:tables', () => [])
    let timer: ReturnType<typeof setInterval> | null = null
    let cageTimer: ReturnType<typeof setInterval> | null = null
    // The cage fills continuously, but the floor only needs it for a glow: it is
    // updated in place about once a second, so the scene itself is not rebuilt.
    const cage = reactive({ fill: 0, stored: 0 })
    const syncCage = () => {
        cage.fill = tycoon.cageFill.value
        // The label shows what a collect takes: the guest income and the rakeback pots.
        cage.stored = Math.floor(tycoon.cageTotal.value)
    }

    async function refreshTables() {
        try {
            occupancy.value = await $fetch<TableOccupancy[]>('/api/tables')
        } catch {
            // The floor just shows empty tables until the next poll.
        }
    }

    function startPolling() {
        void refreshTables()
        timer = setInterval(() => {
            if (document.visibilityState === 'visible') void refreshTables()
        }, TABLES_POLL_MS)
        syncCage()
        cageTimer = setInterval(syncCage, 1000)
        onBeforeUnmount(() => {
            if (timer) clearInterval(timer)
            if (cageTimer) clearInterval(cageTimer)
        })
    }

    // A new state (collect, build, rush) updates the cage at once.
    watch(() => tycoon.state.value, syncCage, { immediate: true })

    const scene = computed<FloorScene | null>(() => {
        const s = tycoon.state.value
        if (!s) return null
        const owned = new Set(s.zones)
        const zones: FloorZone[] = ZONES.map(zone => ({
            id: zone.id,
            owned: owned.has(zone.id),
            available: !owned.has(zone.id) && (zone.requires === null || owned.has(zone.requires)),
            construction: s.constructions.find(c => c.kind === 'zone' && c.id === zone.id) ?? null,
            // A skin picker's preview wins over the skin the zone wears.
            skin: cosmetics.preview.value?.zone === zone.id ? cosmetics.preview.value.skin : skinOf(s.cosmetics?.skins, zone.id)
        }))
        const casinoLevel = tycoon.level.value.level
        const layout = layoutOf(layoutStateOf(s))
        const hints = hintRects(layout, TYCOON_GAMES
            .filter(game => (s.games[game.slug] ?? 0) === 0 && !s.constructions.some(c => c.kind === 'game' && c.id === game.slug) && gameUnlockLevel(game.slug) <= casinoLevel)
            .map(game => game.slug))
        const plots: FloorPlot[] = TYCOON_GAMES.map((game) => {
            const level = s.games[game.slug] ?? 0
            const construction = s.constructions.find(c => c.kind === 'game' && c.id === game.slug) ?? null
            const table = occupancy.value.find(t => t.slug === game.slug)
            // Put away: built, but not on the floor (no plot, no hint).
            const stored = !construction && level >= 1 && !!s.storedGames?.includes(game.slug)
            const onFloor = !stored && (!!construction || level >= 1)
            // A game not built yet: a dashed "build here" hint where it would go, once the level allows it.
            const unlocked = gameUnlockLevel(game.slug) <= casinoLevel
            const rect = onFloor ? standingRect(s.placements, game.slug) : unlocked && !stored ? hints.get(game.slug) ?? null : null
            const status = stored ? 'stored' : construction ? 'building' : level >= 1 ? 'built' : unlocked && rect ? 'available' : 'locked'
            return {
                id: game.slug,
                archetype: game.archetype,
                accent: game.accent,
                zone: game.zone,
                status,
                rect,
                level,
                golden: s.golden.includes(game.slug),
                construction: construction ? { startedAt: construction.startedAt, readyAt: construction.readyAt } : null,
                occupancy: game.archetype === 'cards' && table ? { seated: table.seated, seats: table.seats } : null
            }
        })
        return {
            zones,
            plots,
            decorations: placedDecorations(s.decor),
            cage,
            // The room look (carpet, walls, lights, chandeliers) grows with the casino level.
            decor: roomLook(casinoLevel),
            cageLevel: s.upgrades.cage ?? 0,
            hospitality: s.upgrades.hospitality ?? 0,
            guestsPerHour: s.floor.perHour,
            // The floor's tick, from the state: a new tick, a rush or a campaign running out re-reads it (useTycoon's ticker).
            visitors: s.floor.visitors,
            queue: s.floor.turnedAway,
            campaign: activeCampaign(s, s.serverNow)?.id ?? null,
            rush: tycoon.rushActive.value,
            player: { name: session.player.value?.name ?? 'You', image: session.player.value?.image ?? null, avatar: s.cosmetics?.avatar ?? null },
            clockOffset: tycoon.offset.value
        }
    })

    return { scene, occupancy, refreshTables, startPolling }
}
