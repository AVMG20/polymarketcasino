/**
 * My Casino, social: the casino leaderboard and visiting other players'
 * casinos (read-only), with a heart a visitor can leave once a day. Nothing
 * here moves money: no coins, chips or gems ever pass between players.
 *
 * **Casino value** (the leaderboard's score) is what everything finished in
 * a casino cost to build, in chips, at catalog prices: owned zones, every
 * game level and every upgrade level. A starter game's first level is free;
 * a construction counts once it is done. It only grows (nothing is ever
 * sold), it is the same for every player at the same build, and gems can't
 * buy it (a gem skip only makes a build finish sooner).
 */

import type { AvatarLook, ZoneSkins } from './cosmetics'
import { TYCOON_GAMES, UPGRADES, ZONES, type CampaignId, type ZoneId } from './tycoon'

/** What the value reads: owned zones, game levels and upgrade levels (missing = 0). */
type BuildView = { zones: readonly string[], games: Record<string, number>, upgrades: Partial<Record<string, number>> }

/** Chips it took to build everything finished in this casino (see above). */
export function casinoValue(state: BuildView): number {
    let chips = 0
    for (const zone of ZONES) if (state.zones.includes(zone.id)) chips += zone.cost.chips
    for (const game of TYCOON_GAMES) {
        const level = Math.max(0, Math.min(game.levels.length, Math.floor(state.games[game.slug] ?? 0)))
        for (let i = 0; i < level; i++) chips += game.levels[i]!.chips
    }
    for (const upgrade of UPGRADES) {
        const level = Math.max(0, Math.min(upgrade.levels.length, Math.floor(state.upgrades[upgrade.id] ?? 0)))
        for (let i = 0; i < level; i++) chips += upgrade.levels[i]!.chips
    }
    return chips
}

/** The furthest zone a casino owns (its tier badge). */
export function casinoTier(zones: readonly string[]): ZoneId {
    let tier: ZoneId = 'backroom'
    for (const zone of ZONES) if (zones.includes(zone.id)) tier = zone.id
    return tier
}

/** Who owns a casino, as other players see them. */
export interface CasinoOwner {
    id: string
    name: string
    image: string | null
    /** What their avatar wears (shared/cosmetics.ts). Missing on old payloads. */
    avatar?: AvatarLook
}

/** One row of GET /api/tycoon/leaderboard. */
export interface LeaderboardEntry {
    /** 1 = the most valuable casino. */
    rank: number
    owner: CasinoOwner
    /** Casino value in chips (`casinoValue`). */
    value: number
    /** The furthest zone owned. */
    tier: ZoneId
    /** Zones owned, in catalog order. */
    zones: ZoneId[]
    /** Games built. */
    games: number
    /** Share of everything buildable that is built, 0..1. */
    progress: number
    /** Hearts from visitors, all time. */
    likes: number
}

/** GET /api/tycoon/leaderboard: the top casinos and the player's own row. */
export interface LeaderboardResponse {
    entries: LeaderboardEntry[]
    /** The player's own row (also when it is outside the top), or null without a casino. */
    me: LeaderboardEntry | null
    /** Casinos ranked. */
    total: number
    /** Server ms the ranking was made (it is cached for a few seconds). */
    rankedAt: number
}

/** The leaderboard lists this many casinos. */
export const LEADERBOARD_SIZE = 50

/**
 * GET /api/tycoon/visit/:playerId: what anyone may see of a casino. No
 * balances (coins, chips, the cage), no constructions, no gem purchases.
 */
export interface CasinoVisit {
    serverNow: number
    owner: CasinoOwner
    rank: number | null
    value: number
    tier: ZoneId
    zones: ZoneId[]
    /** Built games and their level (1..5). */
    games: Record<string, number>
    /** Games with the golden skin. */
    golden: string[]
    /** Decor upgrade level 0..5. */
    decor: number
    /** The skin on each owned zone (missing = classic). */
    skins?: ZoneSkins
    /** Visitors on the floor now, the seats they fill and the queue at the door. */
    visitors: number
    seats: number
    queue: number
    /** The ad campaign running now, or null. */
    campaign: CampaignId | null
    likes: number
    /** The viewer already left a heart here today (Amsterdam day). */
    likedToday: boolean
}

/** POST /api/tycoon/visit/:playerId/like */
export interface LikeResponse {
    likes: number
    /** This request left the heart (false: one was already left today). */
    liked: boolean
}
