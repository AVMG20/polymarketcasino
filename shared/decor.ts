/**
 * Decorations: things a player buys with chips and places anywhere on the
 * floor of a room they own (shared/floor/placement.ts checks the spot).
 *
 * - Plain decorations have no stats: buy as many as you like, place them
 *   wherever, put them away and take them out again.
 * - Specials are one of a kind: each casino can own one, and while it stands
 *   on the floor it lifts the whole casino (where it stands doesn't matter;
 *   put away, it does nothing).
 *
 * Both unlock with the casino level (shared/casino-level.ts). Prices and
 * bonuses are tuned with `bun scripts/tycoon-sim.ts`.
 */

export type DecorType =
    // Plain
    | 'plant'
    | 'flowers'
    | 'palm'
    | 'lamp'
    | 'rope'
    | 'rug'
    | 'neon'
    | 'sofa'
    | 'statue'
    | 'fountain'
    | 'piano'
    | 'bar'
    // Specials
    | 'golden-statue'
    | 'jackpot-sign'
    | 'aquarium'
    | 'grand-piano'
    | 'grand-fountain'
    | 'champagne-bar'
    | 'red-carpet'
    | 'vip-booth'
    | 'diamond-display'
    | 'gold-slot'
    | 'showcase-car'
    | 'ice-sculpture'

/** What a special lifts: what every guest spends, or the casino's prestige (richer guests). */
export type DecorStat = 'spend' | 'prestige'

export interface DecorDef {
    type: DecorType
    name: string
    /** One line for the shop card. */
    blurb: string
    /** Chip price. */
    chips: number
    /** Casino level that unlocks it. */
    level: number
    /** Footprint in tiles (w along gx, h along gy). */
    w: number
    h: number
    /** False for flat things guests walk over (a rug). */
    blocks: boolean
    /** Set on a special: one per casino, and its bonus while placed (× (1 + bonus) on `stat`). */
    special?: { stat: DecorStat, bonus: number }
}

/** The richer-guests specials in ladder order: chips, level, prestige bonus (tuned with `bun scripts/tycoon-sim.ts`). */
const PRESTIGE: readonly [number, number, number][] = [
    [750, 7, 0.12],
    [1_500, 9, 0.15],
    [3_000, 12, 0.18],
    [5_000, 15, 0.2],
    [8_000, 19, 0.25],
    [12_000, 22, 0.25],
    [18_000, 24, 0.3],
    [25_000, 27, 0.35]
]

export const DECOR: readonly DecorDef[] = [
    // Plain: no stats, as many as you like.
    { type: 'plant', name: 'Potted Plant', blurb: 'A splash of green.', chips: 150, level: 1, w: 1, h: 1, blocks: true },
    { type: 'flowers', name: 'Flower Vase', blurb: 'Fresh flowers every morning.', chips: 250, level: 2, w: 1, h: 1, blocks: true },
    { type: 'rope', name: 'Velvet Rope', blurb: 'Feels exclusive already.', chips: 300, level: 3, w: 1, h: 1, blocks: true },
    { type: 'lamp', name: 'Floor Lamp', blurb: 'Warm light for a cosy corner.', chips: 400, level: 4, w: 1, h: 1, blocks: true },
    { type: 'rug', name: 'Carpet Rug', blurb: 'Guests walk right over it.', chips: 500, level: 5, w: 2, h: 2, blocks: false },
    { type: 'palm', name: 'Palm Tree', blurb: 'A little holiday indoors.', chips: 700, level: 6, w: 1, h: 1, blocks: true },
    { type: 'neon', name: 'Neon Sign', blurb: 'Bright, buzzing and pink.', chips: 900, level: 8, w: 1, h: 1, blocks: true },
    { type: 'sofa', name: 'Lounge Sofa', blurb: 'A soft seat between games.', chips: 1_200, level: 10, w: 2, h: 1, blocks: true },
    { type: 'statue', name: 'Marble Statue', blurb: 'Classic and a bit dramatic.', chips: 1_800, level: 13, w: 1, h: 1, blocks: true },
    { type: 'bar', name: 'Bar Counter', blurb: 'Drinks on the side.', chips: 2_500, level: 15, w: 3, h: 1, blocks: true },
    { type: 'fountain', name: 'Fountain', blurb: 'The sound of running water.', chips: 3_000, level: 18, w: 2, h: 2, blocks: true },
    { type: 'piano', name: 'Piano', blurb: 'Someone always plays it.', chips: 3_500, level: 22, w: 2, h: 2, blocks: true },
    // Specials: one each, they lift the whole casino while placed.
    // Richer guests (prestige): the rarity ladder, one every few levels from early to late game.
    { type: 'red-carpet', name: 'Red Carpet', blurb: 'A VIP welcome: more Regulars, fewer Tourists.', chips: PRESTIGE[0]![0], level: PRESTIGE[0]![1], w: 2, h: 1, blocks: false, special: { stat: 'prestige', bonus: PRESTIGE[0]![2] } },
    { type: 'vip-booth', name: 'VIP Booth', blurb: 'A velvet booth for the regulars who matter.', chips: PRESTIGE[1]![0], level: PRESTIGE[1]![1], w: 2, h: 1, blocks: true, special: { stat: 'prestige', bonus: PRESTIGE[1]![2] } },
    { type: 'diamond-display', name: 'Diamond Display', blurb: 'A rare diamond under glass draws High Rollers.', chips: PRESTIGE[2]![0], level: PRESTIGE[2]![1], w: 1, h: 1, blocks: true, special: { stat: 'prestige', bonus: PRESTIGE[2]![2] } },
    { type: 'gold-slot', name: 'Golden Slot Machine', blurb: 'A solid gold slot on show: High Rollers come to look.', chips: PRESTIGE[3]![0], level: PRESTIGE[3]![1], w: 1, h: 1, blocks: true, special: { stat: 'prestige', bonus: PRESTIGE[3]![2] } },
    { type: 'showcase-car', name: 'Showcase Car', blurb: 'A gleaming sports car: High Rollers stop to look.', chips: PRESTIGE[4]![0], level: PRESTIGE[4]![1], w: 2, h: 2, blocks: true, special: { stat: 'prestige', bonus: PRESTIGE[4]![2] } },
    { type: 'aquarium', name: 'Aquarium', blurb: 'High Rollers love the sharks.', chips: PRESTIGE[5]![0], level: PRESTIGE[5]![1], w: 2, h: 1, blocks: true, special: { stat: 'prestige', bonus: PRESTIGE[5]![2] } },
    { type: 'ice-sculpture', name: 'Ice Sculpture', blurb: 'A swan carved in ice, fresh every night.', chips: PRESTIGE[6]![0], level: PRESTIGE[6]![1], w: 1, h: 1, blocks: true, special: { stat: 'prestige', bonus: PRESTIGE[6]![2] } },
    { type: 'grand-fountain', name: 'Grand Fountain', blurb: 'Whales notice a casino like this.', chips: PRESTIGE[7]![0], level: PRESTIGE[7]![1], w: 2, h: 2, blocks: true, special: { stat: 'prestige', bonus: PRESTIGE[7]![2] } },
    // More spend: every guest bets a little more.
    { type: 'golden-statue', name: 'Golden Statue', blurb: 'Guests stop to admire it, then bet more.', chips: 3_000, level: 9, w: 1, h: 1, blocks: true, special: { stat: 'spend', bonus: 0.015 } },
    { type: 'jackpot-sign', name: 'Jackpot Sign', blurb: 'Every guest bets a little bigger.', chips: 8_000, level: 12, w: 2, h: 1, blocks: true, special: { stat: 'spend', bonus: 0.02 } },
    { type: 'grand-piano', name: 'Grand Piano', blurb: 'Live music: guests spend more.', chips: 18_000, level: 20, w: 2, h: 2, blocks: true, special: { stat: 'spend', bonus: 0.025 } },
    { type: 'champagne-bar', name: 'Champagne Bar', blurb: 'Bubbles all night: everyone spends more.', chips: 60_000, level: 28, w: 3, h: 1, blocks: true, special: { stat: 'spend', bonus: 0.03 } }
]

export const DECOR_TYPES: readonly DecorType[] = DECOR.map(def => def.type)

export function findDecor(type: string): DecorDef | undefined {
    return DECOR.find(def => def.type === type)
}

export function isSpecial(type: string): boolean {
    return !!findDecor(type)?.special
}

/** What the placed specials add, as shares: × (1 + spend) on what every guest spends, × (1 + prestige) on prestige. */
export interface SpecialBonus {
    spend: number
    prestige: number
}

/** The bonus of some specials (each type counted once; plain decorations and unknown types add nothing). */
export function specialBonus(types: Iterable<string>): SpecialBonus {
    const bonus = { spend: 0, prestige: 0 }
    for (const type of new Set(types)) {
        const special = findDecor(type)?.special
        if (special) bonus[special.stat] += special.bonus
    }
    return bonus
}

/** The specials standing on the floor (put-away ones do nothing). */
export function placedSpecials(decor: readonly Pick<OwnedDecor, 'type' | 'x' | 'y'>[]): DecorType[] {
    return decor.filter(item => item.x !== null && item.y !== null && isSpecial(item.type)).map(item => item.type)
}

/** The specials a casino owns, placed or put away. */
export function ownedSpecials(decor: readonly Pick<OwnedDecor, 'type'>[]): DecorType[] {
    return decor.filter(item => isSpecial(item.type)).map(item => item.type)
}

/** A decoration a casino owns: placed at (x, y), or put away when both are null. */
export interface OwnedDecor {
    id: number
    type: DecorType
    x: number | null
    y: number | null
}

/** POST /api/tycoon/decor: buy one; with x and y it is placed there at once, else it goes to storage. */
export interface BuyDecorBody {
    type: DecorType
    x?: number
    y?: number
}

/**
 * POST /api/tycoon/place: move a built game, or place, move or put away a
 * decoration. `store: true` (decorations only) puts it away.
 */
export type PlaceBody =
    | { item: 'game', id: string, x: number, y: number }
    | { item: 'decor', id: number, x: number, y: number }
    | { item: 'decor', id: number, store: true }
