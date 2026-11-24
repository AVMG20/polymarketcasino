import { findZone } from '#shared/tycoon'
import { VISITOR_TIER_IDS, VISITOR_TIERS, type FloorNow, type HistoryHour, type VisitorCounts, type VisitorTierDef, type VisitorTierId } from '#shared/visitors'

/**
 * Visitor tiers as the UI shows them: the shared catalog (VISITOR_TIERS) in
 * order, one line on each tier, and their colours for the charts page.
 */

/** Every tier, cheapest first. */
export const TIERS: readonly VisitorTierDef[] = VISITOR_TIER_IDS.map(id => VISITOR_TIERS.find(t => t.id === id)!)

export function tierDef(id: VisitorTierId): VisitorTierDef {
    return TIERS.find(t => t.id === id)!
}

/** Plural name for counts ("3 High Rollers"). */
export function tierPlural(id: VisitorTierId, n: number): string {
    const name = tierDef(id).name
    return n === 1 ? name : `${name}s`
}

const BLURB: Record<VisitorTierId, string> = {
    tourist: 'Drop in from the start and spend a little.',
    regular: 'Steady guests who spend a bit more than Tourists.',
    highroller: 'Come for a classy casino: Decor, Hospitality, new rooms and top machine levels bring more of them, VIP Invitations too.',
    whale: 'Rare: one stays one to three hours and spends as much as a room full of Tourists. A Private Jet brings more.'
}

/** One sentence on a tier. */
export function tierBlurb(id: VisitorTierId): string {
    return BLURB[id]
}

/** "come once you open the Table Pit", or null when the tier comes from the start. */
export function tierUnlockLine(id: VisitorTierId): string | null {
    const zone = tierDef(id).unlockZone
    return zone ? `come once you open the ${findZone(zone)?.name ?? zone}` : null
}

/**
 * A tier colour for the app-shell pages (light and dark): the catalog's
 * colours are bright for the dark floor, so a fifth of the page's text
 * colour goes in (darker on a light page, a touch lighter on a dark one).
 */
export function tierChartColor(id: VisitorTierId): string {
    // sRGB, not oklch: oklch would also mix in the text colour's hue (a Whale's amber turned lime).
    return `color-mix(in srgb, ${tierDef(id).color} 78%, var(--foreground))`
}

/**
 * History hours with `income` as what came into the cage: the server's
 * income is before the cage cap, so it includes what a full cage lost.
 * The strip and the chart stack the lost part on top of this.
 */
export function cageHours(hours: readonly HistoryHour[]): HistoryHour[] {
    return hours.map(h => ({ ...h, income: Math.max(0, h.income - h.lost) }))
}

export function countTotal(counts: VisitorCounts): number {
    return VISITOR_TIER_IDS.reduce((sum, id) => sum + (counts[id] ?? 0), 0)
}

/** Tiers that can visit now (they have odds) or are on the floor. */
export function openTiers(floor: FloorNow | null): VisitorTierDef[] {
    if (!floor) return [tierDef('tourist')]
    return TIERS.filter(t => (floor.odds[t.id] ?? 0) > 0 || (floor.visitors[t.id] ?? 0) > 0)
}

const HOUR = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' })
const DAY_HOUR = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

/** A time of day, "22:00". */
export function formatClock(ms: number): string {
    return HOUR.format(new Date(ms))
}

/** A weekday and time, "Mon 22:00". */
export function formatDayClock(ms: number): string {
    return DAY_HOUR.format(new Date(ms))
}
