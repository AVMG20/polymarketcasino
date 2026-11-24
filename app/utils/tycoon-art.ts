import type { Component } from 'vue'
import { Castle, Cherry, Crown, DoorClosed, Gem, HardHat, LayoutGrid, LockOpen, Megaphone, ScrollText, Spade, Sparkles, Store, Users, Vault, Wine } from 'lucide-vue-next'
import { findGame } from '#shared/games/registry'
import { formatCoins } from '#shared/money'
import {
    cageCapacity, CAMPAIGNS, campaignEffect, seatsOf, findTycoonGame, findUpgrade, findZone, floorSeats, floorView, fullIncomePerHour, guestsPerHour, TYCOON_GAMES, visitorCount,
    type BuildKind, type CampaignId, type TycoonState, type UpgradeId, type VisitorView, type ZoneId
} from '#shared/tycoon'
import { expectedFloor, richerLevel, RULE_UNLOCKS, seatedTotal, tierOdds, tierShift, VISITOR_MODEL, VISITOR_TIERS, type VisitorTierDef } from '#shared/visitors'
import { formatFixed } from '~/utils/format-decimal'
import CasinoCoinIcon from '~/components/casino/CoinIcon.vue'

/** The hand-drawn pictures of TycoonIllo (zones, upgrades, gem shop items). */
export type IlloName =
    | 'backroom' | 'main' | 'pit' | 'lounge' | 'highlimit' | 'penthouse'
    | 'cage' | 'marketing' | 'decor' | 'hospitality' | 'crew'
    | 'rush' | 'builder' | 'golden' | 'wardrobe'
    | 'dice' | 'cherry' | 'bigwin' | 'cards' | 'coins' | 'visit' | 'chest'

/**
 * How a build item looks in the game UI: a game's cover, or (zones and
 * upgrades) its TycoonIllo picture; `icon` is the small glyph for badges.
 */
export interface BuildArt {
    cover: string | null
    icon: Component | null
    illo: IlloName | null
    /** Main colour, hex. */
    color: string
}

const ZONE_ART: Record<string, { icon: Component, color: string }> = {
    backroom: { icon: DoorClosed, color: '#b7791f' },
    main: { icon: Store, color: '#ff9f1c' },
    pit: { icon: Spade, color: '#22c55e' },
    lounge: { icon: Cherry, color: '#ec4899' },
    highlimit: { icon: Crown, color: '#8b5cf6' },
    penthouse: { icon: Castle, color: '#eab308' }
}

const UPGRADE_ART: Record<string, { icon: Component, color: string }> = {
    cage: { icon: Vault, color: '#f59e0b' },
    marketing: { icon: Megaphone, color: '#3b82f6' },
    decor: { icon: Sparkles, color: '#a855f7' },
    hospitality: { icon: Wine, color: '#ff5470' },
    crew: { icon: HardHat, color: '#f59e0b' }
}

/** Building something new (a game, a zone, the crew) rather than levelling up what stands: the hard hat vs the up arrow. */
export function isNewBuild(kind: BuildKind, id: string, level: number): boolean {
    return level === 0 && (kind !== 'upgrade' || id === 'crew')
}

export function buildArt(kind: BuildKind, id: string): BuildArt {
    if (kind === 'game') return { cover: findGame(id)?.cover ?? null, icon: null, illo: null, color: findTycoonGame(id)?.accent ?? '#a879ff' }
    const art = (kind === 'zone' ? ZONE_ART : UPGRADE_ART)[id]
    return { cover: null, icon: art?.icon ?? null, illo: art ? id as IlloName : null, color: art?.color ?? '#a879ff' }
}

export function zoneArt(id: string): { icon: Component, color: string } {
    return ZONE_ART[id] ?? { icon: Store, color: '#a879ff' }
}

const CAMPAIGN_COLOR: Record<CampaignId, string> = { flyers: '#ff9a2e', billboard: '#4aa6ff', tv: '#ff5470', invites: '#c084fc', jet: '#fbbf24' }

export function campaignColor(id: CampaignId): string {
    return CAMPAIGN_COLOR[id] ?? '#4aa6ff'
}

/** A crowd multiplier as "×1,5" (up to two decimals, Dutch). */
export function formatBoost(boost: number): string {
    const rounded = Math.round(boost * 100) / 100
    const digits = Number.isInteger(rounded) ? 0 : Number.isInteger(Math.round(rounded * 100) / 10) ? 1 : 2
    return `×${formatFixed(rounded, digits)}`
}

const ODDS = new Intl.NumberFormat('nl-NL', { style: 'percent', maximumSignificantDigits: 2 })
/** A tier's share as the cards show it: "9,7%", "<0,1%" for a sliver. */
export function formatShare(share: number): string {
    return share > 0 && share < 0.001 ? '<0,1%' : ODDS.format(share)
}
/** A share as a whole percentage: "45%". */
const fillPct = (share: number) => `${Math.round(share * 100)}%`
/** The campaign the next Marketing level unlocks, if any. */
const unlockedAt = (level: number) => CAMPAIGNS.find(c => c.requiresMarketing > 0 && c.requiresMarketing === level) ?? null
const RULE_NAMES: Record<string, string> = { door: 'Door policy', vip: 'VIP room' }
/** What each Hospitality level adds. */
const HOSPITALITY_LEVELS = ['Free drinks', 'Free snacks and drinks', 'A buffet', 'Fine dining', 'A champagne bar'] as const

/** The tile badge of a wealth step: the richest open tier's share after it (▲), the title says now → next. */
function richBadge(before: StatState, after: StatState, what: string): BuildEffect {
    const tier = richTier(before)
    const odds = (s: StatState) => tierShift(floorView(before), floorView(s)).find(t => t.id === tier.id)
    const shift = odds(after)
    const a = formatShare(shift?.now ?? 0)
    const b = formatShare(shift?.next ?? 0)
    return { icon: Gem, text: `${b}▲`, title: `${what}: ${tier.name}s ${a} → ${b} of the guests who come`, color: tier.color }
}

/** One effect of the next step, as an icon badge: `text` is short, `title` explains. */
export interface BuildEffect {
    icon: Component
    text: string
    title: string
    color: string
}

/** What the build and income stats read of the state (zones and rules when known: the visitor model uses them). */
type StatState = VisitorView & Partial<Pick<TycoonState, 'builders'>>

/** Expected coins an hour (no luck) of a state at `now`: what the HUD's "avg" shows. */
function expected(state: StatState, now: number): number {
    return guestsPerHour(state, now)
}

/** A state with an upgrade at `level`. */
function withUpgrade(state: StatState, id: UpgradeId, level: number): StatState {
    return { ...state, upgrades: { ...state.upgrades, [id]: level } }
}

/** A state with a game at `level` (0 = not built). */
function withGame(state: StatState, id: string, level: number): StatState {
    const games = { ...state.games }
    if (level > 0) games[id] = level
    else delete games[id]
    return { ...state, games }
}

/**
 * The tier a wealth step's badge shows: the richest one open apart from
 * Whales (a fraction of a percent reads as nothing), else the next one to
 * open (its share as it will be).
 */
function richTier(state: StatState): VisitorTierDef {
    const odds = tierOdds(floorView(state))
    return [...VISITOR_TIERS].reverse().find(t => t.id !== 'tourist' && t.id !== 'whale' && odds[t.id] > 0) ?? VISITOR_TIERS[1]!
}

/** A state with a zone open. */
function withZone(state: StatState, id: string): StatState {
    const zones = [...(state.zones ?? ['backroom'])]
    if (!zones.includes(id)) zones.push(id)
    return { ...state, zones }
}

/**
 * Every open tier (and the next one to open) as a row: its share of the
 * guests now → after the step, ▲ or ▼. A richer mix reads as the cheap
 * tiers going down and the rich ones up.
 */
export function tierRows(before: StatState, after: StatState, now?: number): BuildStat[] {
    // A tier that has not opened yet and only loses share (a new room's guests dilute it) reads as a loss: leave it out.
    return tierShift(floorView(before), floorView(after), now).filter(t => !(t.from && formatShare(t.next) !== formatShare(t.now) && t.next < t.now)).map((t) => {
        const def = VISITOR_TIERS.find(d => d.id === t.id)!
        const zone = t.from ? findZone(t.from)?.name ?? t.from : null
        const a = formatShare(t.now)
        const b = formatShare(t.next)
        return {
            icon: Users,
            label: `${def.name}s${zone ? ` (from ${zone})` : ''}`,
            now: a,
            next: b,
            trend: a === b ? 0 : Math.sign(t.next - t.now),
            arrow: true,
            color: def.color,
            title: zone
                ? `${def.name}s come once the ${zone} opens: their share of the guests then, now and after this step`
                : `${def.name}s' share of the guests who come (${formatCoins(def.spend)} coins an hour each), now and after this step`
        }
    })
}

/** Guests on the floor on average now → after a step (Marketing, Hospitality, ads). */
function guestsRow(before: StatState, after: StatState, now?: number): BuildStat {
    const count = (s: StatState) => {
        const f = expectedFloor(floorView(s), now)
        return Math.round(seatedTotal(f.visitors))
    }
    const a = count(before)
    const b = count(after)
    return { icon: Users, label: 'Guests', now: `~${a}`, next: `~${b}`, trend: Math.sign(b - a), arrow: true, color: '#7dd3fc', title: 'Guests on your floor on average (they need free seats), now and after this step' }
}

/** Whether the next level of a game is one of the top levels that draw richer guests. */
export function richerStep(kind: BuildKind, level: number): boolean {
    return kind === 'game' && richerLevel(level + 1)
}

/** The game levels (2-5) that draw richer guests, for the pips. */
export const RICHER_LEVELS: readonly number[] = [2, 3, 4, 5].filter(l => richerLevel(l))

/** One line above a card's rows when the next step does something special (a top machine level), else null. */
export function buildHeadline(kind: BuildKind, id: string, level: number): string | null {
    if (!richerStep(kind, level)) return null
    const max = findTycoonGame(id)?.levels.length ?? 5
    return level + 1 >= max ? 'Max level: draws High Rollers and Whales ▲' : `Level ${level + 1}: draws richer guests ▲`
}

/** What the next level of `kind:id` (now at `level`) adds. */
export function buildEffects(kind: BuildKind, id: string, level: number, state: StatState | null = null, now = Date.now()): BuildEffect[] {
    const next = level + 1
    if (kind === 'zone') {
        const games = TYCOON_GAMES.filter(game => game.zone === id).length
        const tier = VISITOR_TIERS.find(t => t.unlockZone === id)
        return [
            ...(tier ? [{ icon: Users, text: `${tier.name}s`, title: `${tier.name}s start to visit (${formatCoins(tier.spend)} coins an hour each)`, color: tier.color }] : []),
            ...(games ? [{ icon: LayoutGrid, text: `+${games}`, title: `Room for ${games} games`, color: '#ffc93a' }] : []),
            ...(state && !tier ? [richBadge(state, withZone(state, id), 'A new room makes the casino classier')] : [])
        ]
    }
    if (kind === 'game') {
        if (!findTycoonGame(id)) return []
        // Built: what it adds to the cage now. Not built yet: what it would once built.
        const built = level > 0
        const at = built ? level : 1
        const earns = state ? gameIncomePerHour(withGame(state, id, at), id, at, now) : fullIncomePerHour({ games: { [id]: at } })
        const richer = state && built && richerStep(kind, level) ? [richBadge(state, withGame(state, id, next), `Level ${next} draws richer guests`)] : []
        return [...richer, {
            icon: CasinoCoinIcon,
            text: `${built ? '' : '+'}${formatCoins(earns)}/h`,
            // By its seats: a three-seat machine earns half again what a two-seat one does at the same level.
            title: `${built ? 'This game adds' : 'Once built, this game adds'} about ${formatCoins(earns)} coins an hour to your cage (${seatsOf(id, at)} seats)`,
            color: '#ffc93a'
        }]
    }
    switch (id) {
        case 'cage':
            return [{ icon: Vault, text: `${formatCoins(cageCapacity(next), true)}`, title: `The cage holds ${formatCoins(cageCapacity(next))} coins (now ${formatCoins(cageCapacity(level))})`, color: '#ffc93a' }]
        case 'marketing': {
            const unlock = unlockedAt(next)
            return [
                { icon: Users, text: `+${Math.round(VISITOR_MODEL.brand * 100)}%`, title: `${Math.round(VISITOR_MODEL.brand * 100)}% more guests come in`, color: '#7dd3fc' },
                { icon: Megaphone, text: fillPct(campaignEffect('invites', next).prestige), title: `Stronger wealth ads: VIP Invitations' pull ${fillPct(campaignEffect('invites', level).prestige)} → ${fillPct(campaignEffect('invites', next).prestige)}`, color: '#4aa6ff' },
                ...(unlock ? [{ icon: LockOpen, text: unlock.name, title: `Unlocks the ${unlock.name} campaign`, color: '#ffc93a' }] : [])
            ]
        }
        case 'decor':
        case 'hospitality': {
            if (!state) return [{ icon: Sparkles, text: 'Richer', title: findUpgrade(id)?.description ?? 'Richer guests', color: '#c084fc' }]
            return [richBadge(state, withUpgrade(state, id as UpgradeId, next), id === 'decor' ? 'Richer guests' : 'More and richer guests')]
        }
        case 'crew':
            return [{ icon: HardHat, text: '+1', title: 'One more builder: one more construction at once', color: '#ffc93a' }]
    }
    return []
}

/** One line of the detail card: what something is now and what the next step makes it. */
export interface BuildStat {
    icon: Component
    label: string
    /** Null when it is new (not built yet). */
    now: string | null
    next: string
    color: string
    title?: string
    /** Whether `next` is more (1) or less (-1) than `now`; colours the change. */
    trend?: number
    /** Show ▲ / ▼ by the change (tier shares, guests). */
    arrow?: boolean
}

/**
 * What one game adds to the cage an hour at `level` (which `state.games`
 * must hold): the casino's expected income with it, minus without it (the
 * same guests may sit elsewhere, so this is what building it is worth, not a
 * share of the total). Never below 0.
 */
export function gameIncomePerHour(state: StatState, id: string, level: number, now: number): number {
    if (level < 1) return 0
    const gain = expected(withGame(state, id, level), now) - expected(withGame(state, id, 0), now)
    return Math.max(0, Math.round(gain * 100) / 100)
}

/** The cage's expected coins an hour now and after a step (a step never reads as a loss). */
function cageRow(before: StatState, after: StatState, now: number): BuildStat {
    const cageNow = expected(before, now)
    const cageNext = Math.max(cageNow, expected(after, now))
    return {
        icon: CasinoCoinIcon,
        label: 'Your income',
        now: `${formatCoins(cageNow)}/h`,
        next: `${formatCoins(cageNext)}/h`,
        trend: Math.sign(Math.round(cageNext - cageNow)),
        color: '#ffc93a',
        title: 'Coins an hour your cashier cage earns on average (good and quiet hours even out), now and after this step'
    }
}

/** The detail card's rows for the next level of `kind:id` (now at `level`), against the live state. */
export function buildStats(kind: BuildKind, id: string, level: number, state: StatState | null, now: number): BuildStat[] {
    const next = level + 1
    if (kind === 'zone') {
        const games = TYCOON_GAMES.filter(game => game.zone === id).length
        const tier = VISITOR_TIERS.find(t => t.unlockZone === id)
        const rule = RULE_UNLOCKS.find(r => r.zone === id)
        return [
            ...(games ? [{ icon: LayoutGrid, label: 'Room for games', now: null, next: String(games), color: '#ffc93a' }] : []),
            ...(tier ? [{ icon: Users, label: 'New guests', now: null, next: `${tier.name}s`, color: tier.color, title: `${tier.name}s start to visit: ${formatCoins(tier.spend)} coins an hour each` }] : []),
            ...(rule ? [{ icon: ScrollText, label: 'House rule', now: null, next: RULE_NAMES[rule.rule] ?? rule.rule, color: '#a879ff', title: `Unlocks the ${RULE_NAMES[rule.rule] ?? rule.rule} house rule` }] : []),
            ...(state ? tierRows(state, withZone(state, id), now) : [])
        ]
    }
    if (kind === 'game') {
        const def = findTycoonGame(id)
        if (!def || next > def.levels.length) return []
        if (!state) {
            const income = (l: number) => (l > 0 ? `+${formatCoins(fullIncomePerHour({ games: { [id]: l } }))}/h` : null)
            return [{ icon: CasinoCoinIcon, label: 'Income, full', now: income(level), next: income(next)!, color: '#ffc93a', title: 'Coins an hour this game earns with every seat taken' }]
        }
        // What the player cares about: what this game brings in, now and after.
        // Each level adds a seat and makes guests there spend a little more; the best seats fill first.
        const after = withGame(state, id, next)
        const gameNow = level > 0 ? gameIncomePerHour(state, id, level, now) : 0
        const gameNext = Math.max(gameNow, gameIncomePerHour(after, id, next, now))
        return [
            // One income number, the same one the tile's badge shows; the casino total lives in the HUD.
            { icon: CasinoCoinIcon, label: 'This game earns', now: level > 0 ? `${formatCoins(gameNow)}/h` : null, next: `${formatCoins(gameNext)}/h`, trend: Math.sign(Math.round(gameNext - gameNow)), color: '#ffc93a', title: `Coins an hour this game brings into your cage on average, now and after this step: it earns by its seats (${seatsOf(id, Math.max(1, level))} now)` },
            { icon: Users, label: 'Guests / seats', now: `${visitorCount(state, now)}/${floorSeats(state)}`, next: `${visitorCount(after, now)}/${floorSeats(after)}`, color: '#7dd3fc', title: 'Guests on your floor on average / seats. Every level adds a seat and makes guests there spend more. Marketing and ads bring more guests, Decor and Hospitality richer ones.' },
            // The top levels draw richer guests: the whole mix, up and down.
            ...(richerStep(kind, level) ? tierRows(state, after, now) : [])
        ]
    }
    switch (id as UpgradeId) {
        case 'cage':
            return [{ icon: Vault, label: 'Cage holds', now: formatCoins(cageCapacity(level)), next: formatCoins(cageCapacity(next)), color: '#ffc93a' }]
        case 'marketing': {
            const unlock = unlockedAt(next)
            const after = state ? withUpgrade(state, 'marketing', next) : null
            return [
                ...(state && after ? [guestsRow(state, after, now)] : []),
                { icon: Megaphone, label: 'Wealth ads', now: `+${fillPct(campaignEffect('invites', level).prestige)}`, next: `+${fillPct(campaignEffect('invites', next).prestige)}`, color: '#4aa6ff', title: 'The wealth ads pull harder: the prestige VIP Invitations add (the Private Jet grows the same way)' },
                ...(unlock ? [{ icon: LockOpen, label: 'Unlocks', now: null, next: unlock.name, color: '#ffc93a', title: `The ${unlock.name} campaign` }] : []),
                ...(state && after ? [cageRow(state, after, now)] : [])
            ]
        }
        case 'decor':
        case 'hospitality': {
            if (!state) return [{ icon: Sparkles, label: 'Guests', now: null, next: 'Richer', color: '#c084fc', title: findUpgrade(id)?.description }]
            const after = withUpgrade(state, id as UpgradeId, next)
            const rows: BuildStat[] = [...(id === 'hospitality' ? [guestsRow(state, after, now)] : []), ...tierRows(state, after, now)]
            const income = cageRow(state, after, now)
            // No income change yet (only Tourists come, so a richer mix shows once the Main Floor opens): say when, not "0".
            if (income.trend) rows.push(income)
            else if (!(state.zones ?? []).includes('main')) rows.push({ ...income, now: null, next: 'once the Main Floor opens', trend: 0 })
            return rows
        }
        case 'crew': {
            const builders = state?.builders ?? 1
            return [{ icon: HardHat, label: 'Builders', now: String(builders), next: String(builders + 1), color: '#ffc93a', title: 'Constructions that can run at once' }]
        }
    }
    return []
}

/** The one line under the name in the detail card. */
export function buildLine(kind: BuildKind, id: string, level: number): string | null {
    if (kind === 'zone') return 'A new room on your floor'
    if (kind === 'game') return level === 0 ? 'A new machine on your floor' : 'A bigger machine on your floor'
    if (id === 'decor') return 'Carpet, lights and chandeliers: richer guests'
    if (id === 'hospitality') return HOSPITALITY_LEVELS[level] ? `${HOSPITALITY_LEVELS[level]}: more and richer guests` : 'More and richer guests'
    if (id === 'crew') return 'A second crew for good: one more builder'
    if (id === 'marketing') {
        const unlocks = CAMPAIGNS.filter(c => c.requiresMarketing > level).map(c => `${c.name} at Lv ${c.requiresMarketing}`).join(', ')
        return unlocks ? `More guests and stronger ads · ${unlocks}` : 'More guests and stronger ads'
    }
    return null
}
