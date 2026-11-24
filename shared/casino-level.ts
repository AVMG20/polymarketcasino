import { DECOR, type DecorType } from './decor'
import { casinoValue } from './social'
import type { TycoonState } from './tycoon'
import { TYCOON_GAMES } from './tycoon'

/**
 * The casino level: every finished build step (a room, a game, a game level,
 * an upgrade level) earns XP, and the level unlocks games and decorations.
 * It is worked out from what is built (never stored), so every casino has
 * its level the moment this ships.
 *
 * XP is the chips the finished steps cost at catalog prices ÷ XP_CHIPS (the
 * casino value, shared/social.ts): a bigger step gives more. The levels start
 * close together (a level every couple of builds in the first sessions) and
 * spread out (a level a day or so late in the game); the top level comes with
 * the last few builds. Tuned with `bun scripts/tycoon-sim.ts`.
 *
 * Rooms still need the room before them and chips; they give floor space,
 * guest tiers and house rules. Games no longer need their room: a game
 * unlocked by the level can stand in any room the player owns.
 */

export type LevelView = Pick<TycoonState, 'zones' | 'games' | 'upgrades'>

export interface CasinoLevel {
    /** 1..MAX_CASINO_LEVEL. */
    level: number
    /** XP earned so far. */
    xp: number
    /** XP where this level starts. */
    levelXp: number
    /** XP where the next level starts, or null at the top. */
    nextXp: number | null
}

/** What a level unlocks. */
export interface LevelUnlocks {
    level: number
    games: string[]
    decor: DecorType[]
}

export const MAX_CASINO_LEVEL = 30

/** One XP for every this many chips a finished build step cost. */
export const XP_CHIPS = 10

/**
 * XP where each level starts (index = level - 1). Everything built is 144,962
 * XP, so the top level comes with the last few builds (the last one at the
 * latest).
 */
export const LEVEL_XP: readonly number[] = [
    0, 60, 140, 250, 400, 600, 850, 1_150, 1_500, 1_900,
    2_400, 3_000, 3_800, 4_800, 6_000, 7_500, 9_500, 12_000, 15_000, 19_000,
    24_000, 30_000, 37_000, 45_000, 54_000, 64_000, 76_000, 92_000, 115_000, 144_000
]

/**
 * The casino level each game needs. The starters come built; every other
 * game unlocks at about the level a casino has when it opens the room the
 * game used to need, so the pace stays where it was.
 */
const GAME_LEVELS: Readonly<Record<string, number>> = {
    // Backroom
    plinko: 1,
    spinata: 1,
    limbo: 1,
    wheel: 2,
    // Main floor
    roulette: 6,
    trashpanda: 6,
    fireinthehole: 7,
    candymadness: 7,
    dice: 8,
    // Table pit
    blackjack: 11,
    polymasters: 12,
    'three-card-poker': 12,
    // Slot lounge
    bookofshadows: 15,
    xenoslot: 16,
    magichands: 16,
    emberportals: 17,
    // High limit
    baccarat: 25,
    'casino-holdem': 26,
    aethergates: 26,
    // Penthouse
    mines: 29,
    hilo: 29
}

/** XP of a casino: its finished build steps. */
export function casinoXp(state: LevelView): number {
    return Math.floor(casinoValue(state) / XP_CHIPS)
}

/** The level `xp` reaches. */
export function levelForXp(xp: number): number {
    let level = 1
    while (level < MAX_CASINO_LEVEL && xp >= LEVEL_XP[level]!) level++
    return level
}

export function casinoLevel(state: LevelView): CasinoLevel {
    const xp = casinoXp(state)
    const level = levelForXp(xp)
    return {
        level,
        xp,
        levelXp: LEVEL_XP[level - 1]!,
        nextXp: level < MAX_CASINO_LEVEL ? LEVEL_XP[level]! : null
    }
}

/** The casino level a game needs before it can be built. */
export function gameUnlockLevel(slug: string): number {
    return GAME_LEVELS[slug] ?? MAX_CASINO_LEVEL
}

/**
 * The casino level each room look (1-5) starts at: the floor's carpet, walls,
 * lights and chandeliers (shared/floor/layout.ts CHANDELIERS from look 4) get
 * finer as the casino grows, about one look per room opened.
 */
export const ROOM_LOOK_LEVELS: readonly number[] = [5, 10, 15, 21, 26]

/** The room look (0-5) a casino of `level` has. */
export function roomLook(level: number): number {
    return ROOM_LOOK_LEVELS.filter(at => level >= at).length
}

/** What each level from 2 to the top unlocks (levels that unlock nothing are left out). */
export function levelUnlocks(): LevelUnlocks[] {
    const out: LevelUnlocks[] = []
    for (let level = 2; level <= MAX_CASINO_LEVEL; level++) {
        const games = TYCOON_GAMES.filter(game => gameUnlockLevel(game.slug) === level).map(game => game.slug)
        const decor = DECOR.filter(def => def.level === level).map(def => def.type)
        if (games.length || decor.length) out.push({ level, games, decor })
    }
    return out
}
