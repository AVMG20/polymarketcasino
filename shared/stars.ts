import { casinoLevel, type LevelView } from './casino-level'
import { COSMETICS } from './cosmetics'
import { DECOR, ownedSpecials, type OwnedDecor } from './decor'
import { MAX_LEVEL, TYCOON_GAMES } from './tycoon'

/**
 * The casino's star level, 0 to 10: how many of the ten casino goals the
 * player has reached, in any order. Every goal is something built, bought or
 * played, so the level never goes down. The level is reported to the hub
 * whenever it differs from what the hub holds (server/utils/stars.ts).
 *
 * The hub sees a level track (`STAR_LEVELS`): entry n names level n, "earn n
 * of the 10 casino stars". The goals themselves live here and in the Stars
 * sheet.
 */

export const CASINO_GAME_SLUG = 'casino'

export type StarGoalKey =
    | 'level-5' | 'level-10' | 'level-15' | 'level-20' | 'level-25'
    | 'build-all' | 'play-all' | 'all-specials' | 'max-all' | 'all-cosmetics'

export interface StarGoalDef {
    key: StarGoalKey
    name: string
    description: string
}

/** The ten goals, in the order the Stars sheet lists them. */
export const STAR_GOALS: readonly StarGoalDef[] = [
    { key: 'level-5', name: 'Open for business', description: 'Reach casino level 5' },
    { key: 'level-10', name: 'Neighbourhood joint', description: 'Reach casino level 10' },
    { key: 'level-15', name: 'Going places', description: 'Reach casino level 15' },
    { key: 'level-20', name: 'Big league', description: 'Reach casino level 20' },
    { key: 'level-25', name: 'Grand casino', description: 'Reach casino level 25' },
    { key: 'build-all', name: 'Full floor', description: 'Build every game' },
    { key: 'play-all', name: 'Tried them all', description: 'Play a round of every game' },
    { key: 'all-specials', name: 'Collector', description: 'Own every special decoration' },
    { key: 'max-all', name: 'Top of the line', description: `Bring every game to level ${MAX_LEVEL}` },
    { key: 'all-cosmetics', name: 'Best dressed', description: 'Own every cosmetic sold for chips' }
]

export const MAX_STAR_LEVEL = STAR_GOALS.length

/** The level track the hub shows: entry n names level n (manifest keys, `[a-z0-9-]{1,40}`). */
export const STAR_LEVELS: readonly { key: string, name: string, description: string }[] = [
    'Opening night', 'Rising star', 'Local favourite', 'Talk of the town', 'High stakes',
    'Big shot', 'Headliner', 'High society', 'Casino mogul', 'Casino legend'
].map((name, i) => ({
    key: `goals-${i + 1}`,
    name,
    description: i === 0
        ? 'Earn 1 of the 10 casino stars. A star per goal, in any order: casino level 5, 10, 15, 20 and 25; every game built, played and maxed; every special and every chip cosmetic owned'
        : `Earn ${i + 1} of the 10 casino stars`
}))

/** The title of a star level (null at 0). */
export function starTitle(level: number): string | null {
    return level > 0 ? STAR_LEVELS[Math.min(level, STAR_LEVELS.length) - 1]?.name ?? null : null
}

/** What the goals read: the build, the decorations owned, the games played and the cosmetics bought. */
export interface StarView {
    casino: LevelView
    decor: readonly Pick<OwnedDecor, 'type'>[]
    /** Slugs of the games the player has a settled round of (anywhere, visits included). */
    played: readonly string[]
    /** Cosmetic keys bought (only the ones sold for chips count: free and gem-only ones never do). */
    cosmetics: readonly string[]
}

export interface StarGoal extends StarGoalDef {
    done: boolean
    /** Progress: `have` of `need` (casino level 12 of 15, 14 of 21 games built). */
    have: number
    need: number
}

export interface StarSummary {
    /** Goals done: 0-10. */
    level: number
    max: number
    /** The level the hub has confirmed; differs from `level` while a report is due. */
    reported: number
    goals: StarGoal[]
}

const SPECIALS = DECOR.filter(def => def.special).map(def => def.type)
/** The cosmetics the Best dressed goal asks for: every one sold for chips (a star level is never sold for gems). */
export const CHIP_COSMETICS = COSMETICS.filter(def => def.chips > 0).map(def => def.key)

function progress(have: number, need: number): { have: number, need: number } {
    return { have: Math.min(have, need), need }
}

function count<T>(list: readonly T[], test: (item: T) => boolean): number {
    return list.filter(test).length
}

/** Every goal with its progress, in STAR_GOALS order. */
export function starGoals(view: StarView): StarGoal[] {
    const level = casinoLevel(view.casino).level
    const games = TYCOON_GAMES.map(game => game.slug)
    const levelOf = (slug: string) => view.casino.games[slug] ?? 0
    const played = new Set(view.played)
    const specials = new Set(ownedSpecials(view.decor))
    const cosmetics = new Set(view.cosmetics)
    const tally: Record<StarGoalKey, { have: number, need: number }> = {
        'level-5': progress(level, 5),
        'level-10': progress(level, 10),
        'level-15': progress(level, 15),
        'level-20': progress(level, 20),
        'level-25': progress(level, 25),
        'build-all': progress(count(games, slug => levelOf(slug) >= 1), games.length),
        'play-all': progress(count(games, slug => played.has(slug)), games.length),
        'all-specials': progress(count(SPECIALS, type => specials.has(type)), SPECIALS.length),
        'max-all': progress(count(games, slug => levelOf(slug) >= MAX_LEVEL), games.length),
        'all-cosmetics': progress(count(CHIP_COSMETICS, key => cosmetics.has(key)), CHIP_COSMETICS.length)
    }
    return STAR_GOALS.map(def => ({ ...def, ...tally[def.key], done: tally[def.key].have >= tally[def.key].need }))
}

/** The star level: the number of goals done. */
export function goalLevel(view: StarView): number {
    return count(starGoals(view), goal => goal.done)
}

/** What the wallet and the Stars sheet show. */
export function goalSummary(view: StarView, reported: number): StarSummary {
    const goals = starGoals(view)
    return { level: count(goals, goal => goal.done), max: MAX_STAR_LEVEL, reported, goals }
}
