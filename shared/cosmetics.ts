/**
 * My Casino cosmetics: what your avatar wears (hats, outfits, accessories)
 * and zone skins (a room's carpet, walls and signature motif). Purely
 * cosmetic: nothing here changes odds, income, seats or the casino value.
 *
 * - Every item has a key, `<slot>:<id>` (`hat:tophat`, `skin:royal`).
 * - Free items are owned by everyone: the avatar's own look (hair style,
 *   hair colour, skin tone) is all free. Avatar items cost gems (the platform
 *   guide: cosmetic 5-50, premium up to ~200) or, the mid and late game
 *   pieces, a lot of chips (a sink: chips are what stars follow); zone skins
 *   cost chips or, the premium ones, gems. Gems go through the gem purchase
 *   flow (item 'cosmetic', target = the key); chips through
 *   POST /api/tycoon/cosmetics/buy.
 * - Buying owns an item for good. Equipping is free and needs it owned: an
 *   avatar slot holds one item, every owned zone one skin (any skin fits any
 *   zone).
 */

import type { ZoneId } from './tycoon'

/** What the avatar wears (hats, outfits, extras). */
export type WearSlot = 'hat' | 'outfit' | 'accessory'
/** The avatar's own look: hair style, hair colour and skin tone. Every one is free. */
export type LookSlot = 'hair' | 'haircolor' | 'skintone'
export type AvatarSlot = WearSlot | LookSlot
export type CosmeticSlot = AvatarSlot | 'skin'

export interface CosmeticDef {
    /** `<slot>:<id>` */
    key: string
    slot: CosmeticSlot
    id: string
    name: string
    /** Price in gems, or 0. */
    gems: number
    /** Price in chips, or 0. Free when both are 0. */
    chips: number
    /** A premium piece (the dearest ones): drawn with a shine in the shop. */
    premium?: true
    /** Its main colour, for swatches. */
    color: string
}

function item(slot: CosmeticSlot, id: string, name: string, color: string, price: { gems?: number, chips?: number } = {}, premium = false): CosmeticDef {
    return { key: `${slot}:${id}`, slot, id, name, gems: price.gems ?? 0, chips: price.chips ?? 0, color, ...(premium ? { premium: true as const } : {}) }
}

export const COSMETICS: readonly CosmeticDef[] = [
    // Hair styles (free)
    item('hair', 'short', 'Short', '#5b3a24'),
    item('hair', 'long', 'Long', '#5b3a24'),
    item('hair', 'bun', 'Bun', '#5b3a24'),
    item('hair', 'spiky', 'Spiky', '#5b3a24'),
    item('hair', 'ponytail', 'Ponytail', '#5b3a24'),
    item('hair', 'afro', 'Afro', '#5b3a24'),
    item('hair', 'mohawk', 'Mohawk', '#5b3a24'),
    item('hair', 'bald', 'Bald', '#5b3a24'),
    // Hair colours (free)
    item('haircolor', 'black', 'Black', '#20202e'),
    item('haircolor', 'dark', 'Dark Brown', '#2d1d17'),
    item('haircolor', 'brown', 'Brown', '#5b3a24'),
    item('haircolor', 'auburn', 'Auburn', '#a5582c'),
    item('haircolor', 'red', 'Red', '#b8463a'),
    item('haircolor', 'blond', 'Blond', '#e0b85a'),
    item('haircolor', 'platinum', 'Platinum', '#f2e2c4'),
    item('haircolor', 'silver', 'Silver', '#8f8fa3'),
    item('haircolor', 'pink', 'Pink', '#f27fb4'),
    item('haircolor', 'blue', 'Blue', '#4aa6ff'),
    item('haircolor', 'mint', 'Mint', '#3fd2a0'),
    item('haircolor', 'purple', 'Purple', '#9d6ddb'),
    // Skin tones (free)
    item('skintone', 'ivory', 'Ivory', '#f7d2b6'),
    item('skintone', 'peach', 'Peach', '#f1c7a2'),
    item('skintone', 'sand', 'Sand', '#eab68f'),
    item('skintone', 'caramel', 'Caramel', '#cf946a'),
    item('skintone', 'bronze', 'Bronze', '#a86c47'),
    item('skintone', 'cocoa', 'Cocoa', '#7b4b31'),
    item('skintone', 'ebony', 'Ebony', '#5a3423'),
    // Hats
    item('hat', 'none', 'No hat', '#8a7aa8'),
    item('hat', 'cap', 'Cap', '#e8594f'),
    item('hat', 'party', 'Party Hat', '#f27fb4', { gems: 5 }),
    item('hat', 'beanie', 'Beanie', '#3fc4b2', { gems: 10 }),
    item('hat', 'tophat', 'Top Hat', '#2b2236', { gems: 20 }),
    item('hat', 'cowboy', 'Cowboy Hat', '#a8673a', { gems: 30 }),
    item('hat', 'fedora', 'Fedora', '#3b3552', { chips: 40_000 }),
    item('hat', 'crown', 'Crown', '#f4c14f', { gems: 90 }, true),
    item('hat', 'laurel', 'Golden Laurel', '#f4c14f', { chips: 750_000 }, true),
    // Outfits
    item('outfit', 'classic', 'Classic', '#4ea6e0'),
    item('outfit', 'stripes', 'Stripes', '#f5d24a'),
    item('outfit', 'hoodie', 'Hoodie', '#6f86e8', { gems: 10 }),
    item('outfit', 'hawaiian', 'Hawaiian', '#ef7a3a', { gems: 15 }),
    item('outfit', 'tuxedo', 'Tuxedo', '#2b2236', { gems: 35 }),
    item('outfit', 'velvet', 'Velvet Blazer', '#8e1d4a', { chips: 120_000 }),
    item('outfit', 'goldsuit', 'Gold Suit', '#f4c14f', { gems: 100 }, true),
    item('outfit', 'robe', 'Royal Robe', '#7d1328', { chips: 600_000 }, true),
    item('outfit', 'diamond', 'Diamond Suit', '#9fe8ff', { gems: 200 }, true),
    // Accessories
    item('accessory', 'none', 'Nothing', '#8a7aa8'),
    item('accessory', 'shades', 'Shades', '#2a1b30'),
    item('accessory', 'bowtie', 'Bow Tie', '#d6264b'),
    item('accessory', 'headphones', 'Headphones', '#e8594f', { gems: 12 }),
    item('accessory', 'monocle', 'Monocle', '#f4c14f', { gems: 18 }),
    item('accessory', 'goldchain', 'Gold Chain', '#f4c14f', { gems: 30 }),
    item('accessory', 'icechain', 'Ice Chain', '#9fe8ff', { chips: 250_000 }, true),
    // Zone skins
    item('skin', 'classic', 'Classic', '#b4404f'),
    // The rooms' own colours, free on any room (BASIC_SKINS)
    item('skin', 'oak', 'Oak Floor', '#d79d66'),
    item('skin', 'ruby', 'Ruby Carpet', '#b4404f'),
    item('skin', 'emerald', 'Emerald Carpet', '#2f8a64'),
    item('skin', 'violet', 'Violet Carpet', '#7553c2'),
    item('skin', 'sapphire', 'Sapphire Carpet', '#30509c'),
    item('skin', 'ivory', 'Ivory Marble', '#f2ebe0'),
    item('skin', 'deco', 'Art Deco', '#1f2a2e', { chips: 2_400 }),
    item('skin', 'tropical', 'Tropical', '#2fa58f', { chips: 4_800 }),
    item('skin', 'western', 'Wild West', '#a8673a', { chips: 7_200 }),
    item('skin', 'frost', 'Ice Palace', '#8fd3f4', { chips: 35_000 }),
    item('skin', 'royal', 'Royal', '#9d1b32', { gems: 40 }, true),
    item('skin', 'midnight', 'Midnight', '#1d2a5c', { gems: 60 }, true),
    item('skin', 'vegas', 'Vegas Gold', '#f4c14f', { chips: 150_000 }, true),
    item('skin', 'jade', 'Jade Temple', '#1f8a5c', { gems: 150 }, true),
    item('skin', 'cosmic', 'Cosmic', '#3a1f6e', { chips: 500_000 }, true)
]

/** The slots worn over the look (each has free items, its default among them). */
export const AVATAR_SLOTS: readonly WearSlot[] = ['hat', 'outfit', 'accessory']
/** The look's slots: `auto` (the default) keeps what the player's name gives them. */
export const LOOK_SLOTS: readonly LookSlot[] = ['hair', 'haircolor', 'skintone']
export const AUTO = 'auto'

/** What the avatar wears and looks like: an item id per slot (`auto` for a look slot: the name's). */
export interface AvatarLook {
    hat: string
    outfit: string
    accessory: string
    hair: string
    haircolor: string
    skintone: string
}

export const DEFAULT_AVATAR: AvatarLook = { hat: 'none', outfit: 'classic', accessory: 'none', hair: AUTO, haircolor: AUTO, skintone: AUTO }

export type SkinId = 'classic' | 'oak' | 'ruby' | 'emerald' | 'violet' | 'sapphire' | 'ivory' | 'deco' | 'tropical' | 'western' | 'frost' | 'royal' | 'midnight' | 'vegas' | 'jade' | 'cosmic'
export const DEFAULT_SKIN: SkinId = 'classic'
export const SKIN_IDS: readonly SkinId[] = COSMETICS.filter(c => c.slot === 'skin').map(c => c.id as SkinId)

/**
 * The free basic skins: each is one room's own (classic) colours, so any room
 * can wear another room's carpet. A room's own basic skin is its classic look.
 */
export const BASIC_SKINS: Readonly<Partial<Record<SkinId, ZoneId>>> = {
    oak: 'backroom',
    ruby: 'main',
    emerald: 'pit',
    violet: 'lounge',
    sapphire: 'highlimit',
    ivory: 'penthouse'
}

/** The skin on each zone (missing = classic). */
export type ZoneSkins = Partial<Record<ZoneId, SkinId>>

/** The player's cosmetics, in GET /api/tycoon (`state.cosmetics`). */
export interface CosmeticsState {
    avatar: AvatarLook
    skins: ZoneSkins
    /** Keys bought (free items are always owned and not listed). */
    owned: string[]
}

/** POST /api/tycoon/cosmetics/buy: buy an item priced in chips (a zone skin); `zone` also puts it on that zone. */
export interface CosmeticBuyBody {
    key: string
    zone?: ZoneId
}

/** POST /api/tycoon/cosmetics/equip: wear an avatar item, or put a skin on `zone`. */
export interface CosmeticEquipBody {
    key: string
    zone?: ZoneId
}

export function findCosmetic(key: string): CosmeticDef | undefined {
    return COSMETICS.find(c => c.key === key)
}

export function cosmeticsIn(slot: CosmeticSlot): CosmeticDef[] {
    return COSMETICS.filter(c => c.slot === slot)
}

export function isFree(def: CosmeticDef): boolean {
    return def.gems === 0 && def.chips === 0
}

/** Whether `key` is worn-able: free, or bought. */
export function ownsCosmetic(owned: readonly string[], key: string): boolean {
    const def = findCosmetic(key)
    return !!def && (isFree(def) || owned.includes(key))
}

/** A stored look made valid: unknown or missing slots fall back to the default. */
export function normalizeAvatar(raw: unknown): AvatarLook {
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    const pick = (slot: AvatarSlot): string => {
        const id = input[slot]
        return typeof id === 'string' && findCosmetic(`${slot}:${id}`) ? id : DEFAULT_AVATAR[slot]
    }
    return { hat: pick('hat'), outfit: pick('outfit'), accessory: pick('accessory'), hair: pick('hair'), haircolor: pick('haircolor'), skintone: pick('skintone') }
}

/** Stored zone skins made valid: unknown skins and classic (the default) are left out. */
export function normalizeSkins(raw: unknown): ZoneSkins {
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    const out: ZoneSkins = {}
    for (const [zone, skin] of Object.entries(input)) {
        if (typeof skin === 'string' && skin !== DEFAULT_SKIN && SKIN_IDS.includes(skin as SkinId)) out[zone as ZoneId] = skin as SkinId
    }
    return out
}

/** The skin a zone wears. */
export function skinOf(skins: ZoneSkins | undefined, zone: ZoneId): SkinId {
    return skins?.[zone] ?? DEFAULT_SKIN
}
