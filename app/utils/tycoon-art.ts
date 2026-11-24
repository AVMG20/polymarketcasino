import type { Component } from 'vue'
import { Castle, Cherry, Crown, DoorClosed, HardHat, LayoutGrid, LockOpen, Megaphone, Spade, Sparkles, Store, Users, Vault } from 'lucide-vue-next'
import { findGame } from '#shared/games/registry'
import { formatCoins } from '#shared/money'
import {
    cageCapacity, CAMPAIGNS, campaignBoost, findTycoonGame, floorSeats, fullIncomePerHour, guestsPerHour, TYCOON_GAMES, visitorCount,
    visitorDemand, type BuildKind, type CampaignId, type TycoonState, type UpgradeId
} from '#shared/tycoon'
import { formatFixed } from '~/utils/format-decimal'
import CasinoCoinIcon from '~/components/casino/CoinIcon.vue'

/** The hand-drawn pictures of TycoonIllo (zones, upgrades, gem shop items). */
export type IlloName =
    | 'backroom' | 'main' | 'pit' | 'lounge' | 'highlimit' | 'penthouse'
    | 'cage' | 'marketing' | 'decor' | 'crew'
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

const CAMPAIGN_COLOR: Record<CampaignId, string> = { flyers: '#ff9a2e', billboard: '#4aa6ff', tv: '#ff5470' }

export function campaignColor(id: CampaignId): string {
    return CAMPAIGN_COLOR[id] ?? '#4aa6ff'
}

/** A demand multiplier as "×1,5" (up to two decimals, Dutch). */
export function formatBoost(boost: number): string {
    const rounded = Math.round(boost * 100) / 100
    const digits = Number.isInteger(rounded) ? 0 : Number.isInteger(Math.round(rounded * 100) / 10) ? 1 : 2
    return `×${formatFixed(rounded, digits)}`
}

/** Extra visitor demand from the Marketing (brand) or Decor level alone, as a share: 0.05 = +5%. */
function demandShare(upgrade: 'marketing' | 'decor', level: number): number {
    const at = (l: number) => visitorDemand({
        games: {},
        upgrades: { cage: 0, marketing: 0, decor: 0, crew: 0, [upgrade]: l },
        rushUntil: null,
        campaign: null
    }, 0)
    return at(level) / at(0) - 1
}

const pct = (share: number) => `+${Math.round(share * 100)}%`
/** The campaign the next Marketing level unlocks, if any. */
const unlockedAt = (level: number) => CAMPAIGNS.find(c => c.requiresMarketing > 0 && c.requiresMarketing === level) ?? null

/** One effect of the next step, as an icon badge: `text` is short, `title` explains. */
export interface BuildEffect {
    icon: Component
    text: string
    title: string
    color: string
}

/** What the next level of `kind:id` (now at `level`) adds. */
export function buildEffects(kind: BuildKind, id: string, level: number, state: StatState | null = null, now = Date.now()): BuildEffect[] {
    const next = level + 1
    if (kind === 'zone') {
        const games = TYCOON_GAMES.filter(game => game.zone === id).length
        return games ? [{ icon: LayoutGrid, text: `+${games}`, title: `Room for ${games} games`, color: '#ffc93a' }] : []
    }
    if (kind === 'game') {
        if (!findTycoonGame(id)) return []
        // Built: what it earns the cage now. Not built yet: what it would once built.
        const built = level > 0
        const at = built ? level : 1
        const earns = state
            ? gameIncomePerHour({ ...state, games: { ...state.games, [id]: at } }, id, at, now)
            : fullIncomePerHour({ games: { [id]: at } })
        return [{
            icon: CasinoCoinIcon,
            text: `${built ? '' : '+'}${formatCoins(earns)}/h`,
            title: built ? `This game earns your cage ${formatCoins(earns)} coins an hour` : `Once built, this game earns your cage about ${formatCoins(earns)} coins an hour`,
            color: '#ffc93a'
        }]
    }
    switch (id) {
        case 'cage':
            return [{ icon: Vault, text: `${formatCoins(cageCapacity(next), true)}`, title: `The cage holds ${formatCoins(cageCapacity(next))} coins (now ${formatCoins(cageCapacity(level))})`, color: '#ffc93a' }]
        case 'marketing': {
            const unlock = unlockedAt(next)
            return [
                { icon: Users, text: pct(demandShare('marketing', next) - demandShare('marketing', level)), title: 'More visitors want in', color: '#7dd3fc' },
                { icon: Megaphone, text: formatBoost(campaignBoost('flyers', next)), title: `Stronger ad campaigns: Flyers ${formatBoost(campaignBoost('flyers', level))} → ${formatBoost(campaignBoost('flyers', next))}`, color: '#4aa6ff' },
                ...(unlock ? [{ icon: LockOpen, text: unlock.name, title: `Unlocks the ${unlock.name} campaign`, color: '#ffc93a' }] : [])
            ]
        }
        case 'decor':
            return [{ icon: Users, text: pct(demandShare('decor', next) - demandShare('decor', level)), title: 'More visitors want in, and a nicer floor', color: '#7dd3fc' }]
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
}

type StatState = Pick<TycoonState, 'games' | 'upgrades' | 'rushUntil' | 'campaign'> & Partial<Pick<TycoonState, 'builders'>>

/**
 * What one game earns the cage an hour at `level` (which `state.games` must
 * hold): its full income × how full the floor is (× a rush). The games'
 * incomes add up to the cage's.
 */
export function gameIncomePerHour(state: StatState, id: string, level: number, now: number): number {
    const full = fullIncomePerHour(state)
    if (level < 1 || full <= 0) return 0
    return Math.round(guestsPerHour(state, now) * fullIncomePerHour({ games: { [id]: level } }) / full * 100) / 100
}

/** The detail card's rows for the next level of `kind:id` (now at `level`), against the live state. */
export function buildStats(kind: BuildKind, id: string, level: number, state: StatState | null, now: number): BuildStat[] {
    const next = level + 1
    if (kind === 'zone') {
        const games = TYCOON_GAMES.filter(game => game.zone === id).length
        return games ? [{ icon: LayoutGrid, label: 'Room for games', now: null, next: String(games), color: '#ffc93a' }] : []
    }
    if (kind === 'game') {
        const def = findTycoonGame(id)
        if (!def || next > def.levels.length) return []
        if (!state) {
            const income = (l: number) => (l > 0 ? `+${formatCoins(fullIncomePerHour({ games: { [id]: l } }))}/h` : null)
            return [{ icon: CasinoCoinIcon, label: 'Income, full', now: income(level), next: income(next)!, color: '#ffc93a', title: 'Coins an hour this game earns with every seat taken' }]
        }
        // What the player cares about: the coins this game and the whole cage earn an hour, now and after.
        // Seats ride along with the visitors (12/14): a visitor needs a seat, and a full floor needs more seats.
        const after = { ...state, games: { ...state.games, [id]: next } }
        const gameNow = level > 0 ? gameIncomePerHour(state, id, level, now) : 0
        const gameNext = gameIncomePerHour(after, id, next, now)
        const cageNow = guestsPerHour(state, now)
        const cageNext = guestsPerHour(after, now)
        const rows: BuildStat[] = [
            { icon: CasinoCoinIcon, label: 'This game', now: level > 0 ? `${formatCoins(gameNow)}/h` : null, next: `${formatCoins(gameNext)}/h`, trend: Math.sign(gameNext - gameNow), color: '#ffc93a', title: 'Coins an hour this game earns your cage, now and after this step' },
            { icon: CasinoCoinIcon, label: 'Cage total', now: `${formatCoins(cageNow)}/h`, next: `${formatCoins(cageNext)}/h`, trend: Math.sign(cageNext - cageNow), color: '#ffc93a', title: 'Coins an hour your cashier cage earns from every game, now and after this step' },
            { icon: Users, label: 'Visitors / seats', now: `${visitorCount(state, now)}/${floorSeats(state)}`, next: `${visitorCount(after, now)}/${floorSeats(after)}`, color: '#7dd3fc', title: 'Visitors on your floor / seats for them. Every visitor needs a seat to play, and only visitors who play earn coins: more seats let more visitors in. Ads, Marketing and Decor bring more visitors.' }
        ]
        return rows
    }
    switch (id as UpgradeId) {
        case 'cage':
            return [{ icon: Vault, label: 'Cage holds', now: formatCoins(cageCapacity(level)), next: formatCoins(cageCapacity(next)), color: '#ffc93a' }]
        case 'marketing': {
            const unlock = unlockedAt(next)
            return [
                { icon: Users, label: 'Visitors', now: pct(demandShare('marketing', level)), next: pct(demandShare('marketing', next)), color: '#7dd3fc', title: 'More visitors want in' },
                { icon: Megaphone, label: 'Campaign boost', now: formatBoost(campaignBoost('flyers', level)), next: formatBoost(campaignBoost('flyers', next)), color: '#4aa6ff', title: 'Every ad campaign gets stronger (Flyers shown)' },
                ...(unlock ? [{ icon: LockOpen, label: 'Unlocks', now: null, next: unlock.name, color: '#ffc93a', title: `The ${unlock.name} campaign` }] : [])
            ]
        }
        case 'decor':
            return [{ icon: Users, label: 'Visitors', now: pct(demandShare('decor', level)), next: pct(demandShare('decor', next)), color: '#7dd3fc', title: 'More visitors want in' }]
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
    if (id === 'decor') return 'Carpet, lights and chandeliers'
    if (id === 'crew') return 'A second crew for good: one more builder'
    if (id === 'marketing') {
        const unlocks = CAMPAIGNS.filter(c => c.requiresMarketing > level).map(c => `${c.name} at Lv ${c.requiresMarketing}`).join(', ')
        return unlocks ? `More visitors and stronger ads · ${unlocks}` : 'More visitors and stronger ads'
    }
    return null
}
