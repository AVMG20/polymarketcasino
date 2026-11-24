import { skinOf } from '#shared/cosmetics'
import { activeCampaign, decorLook, TYCOON_GAMES, ZONES, type TableOccupancy } from '#shared/tycoon'
import type { FloorPlot, FloorScene, FloorZone } from '~/utils/floor/types'

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
        cage.stored = Math.floor(tycoon.cageStored.value)
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
        const plots: FloorPlot[] = TYCOON_GAMES.map((game) => {
            const level = s.games[game.slug] ?? 0
            const construction = s.constructions.find(c => c.kind === 'game' && c.id === game.slug) ?? null
            const table = occupancy.value.find(t => t.slug === game.slug)
            const status = construction ? 'building' : level >= 1 ? 'built' : owned.has(game.zone) ? 'available' : 'locked'
            return {
                id: game.slug,
                archetype: game.archetype,
                accent: game.accent,
                zone: game.zone,
                status,
                level,
                golden: s.golden.includes(game.slug),
                construction: construction ? { startedAt: construction.startedAt, readyAt: construction.readyAt } : null,
                occupancy: game.archetype === 'cards' && table ? { seated: table.seated, seats: table.seats } : null
            }
        })
        return {
            zones,
            plots,
            cage,
            decor: decorLook(s.upgrades.decor ?? 0),
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
