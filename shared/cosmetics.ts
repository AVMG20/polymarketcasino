/**
 * My Casino cosmetics: what your avatar wears (hats, outfits, accessories)
 * and zone skins (a room's carpet, walls and signature motif). Purely
 * cosmetic: nothing here changes odds, income, seats or the casino value.
 *
 * - Every item has a key, `<slot>:<id>` (`hat:tophat`, `skin:royal`).
 * - Free items are owned by everyone. Avatar items cost gems (the platform
 *   guide: cosmetic 5-50, a couple of premium ones up to ~100); zone skins
 *   cost chips (a sink: chips are what stars follow) or, the premium ones,
 *   gems. Gems go through the gem purchase flow (item 'cosmetic', target =
 *   the key); chips through POST /api/tycoon/cosmetics/buy.
 * - Buying owns an item for good. Equipping is free and needs it owned: an
 *   avatar slot holds one item, every owned zone one skin (any skin fits any
 *   zone).
 */

import type { ZoneId } from './tycoon'

export type AvatarSlot = 'hat' | 'outfit' | 'accessory'
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
    // Hats
    item('hat', 'none', 'No hat', '#8a7aa8'),
    item('hat', 'cap', 'Cap', '#e8594f'),
    item('hat', 'party', 'Party Hat', '#f27fb4', { gems: 5 }),
    item('hat', 'beanie', 'Beanie', '#3fc4b2', { gems: 10 }),
    item('hat', 'tophat', 'Top Hat', '#2b2236', { gems: 20 }),
    item('hat', 'cowboy', 'Cowboy Hat', '#a8673a', { gems: 30 }),
    item('hat', 'crown', 'Crown', '#f4c14f', { gems: 90 }, true),
    // Outfits
    item('outfit', 'classic', 'Classic', '#4ea6e0'),
    item('outfit', 'stripes', 'Stripes', '#f5d24a'),
    item('outfit', 'hoodie', 'Hoodie', '#6f86e8', { gems: 10 }),
    item('outfit', 'hawaiian', 'Hawaiian', '#ef7a3a', { gems: 15 }),
    item('outfit', 'tuxedo', 'Tuxedo', '#2b2236', { gems: 35 }),
    item('outfit', 'goldsuit', 'Gold Suit', '#f4c14f', { gems: 100 }, true),
    // Accessories
    item('accessory', 'none', 'Nothing', '#8a7aa8'),
    item('accessory', 'shades', 'Shades', '#2a1b30'),
    item('accessory', 'headphones', 'Headphones', '#e8594f', { gems: 12 }),
    item('accessory', 'monocle', 'Monocle', '#f4c14f', { gems: 18 }),
    item('accessory', 'goldchain', 'Gold Chain', '#f4c14f', { gems: 30 }),
    // Zone skins
    item('skin', 'classic', 'Classic', '#b4404f'),
    item('skin', 'deco', 'Art Deco', '#1f2a2e', { chips: 2_400 }),
    item('skin', 'tropical', 'Tropical', '#2fa58f', { chips: 4_800 }),
    item('skin', 'western', 'Wild West', '#a8673a', { chips: 7_200 }),
    item('skin', 'royal', 'Royal', '#9d1b32', { gems: 40 }, true),
    item('skin', 'midnight', 'Midnight', '#1d2a5c', { gems: 60 }, true)
]

export const AVATAR_SLOTS: readonly AvatarSlot[] = ['hat', 'outfit', 'accessory']

/** What the avatar wears: an item id per slot. */
export interface AvatarLook {
    hat: string
    outfit: string
    accessory: string
}

export const DEFAULT_AVATAR: AvatarLook = { hat: 'none', outfit: 'classic', accessory: 'none' }

export type SkinId = 'classic' | 'deco' | 'tropical' | 'western' | 'royal' | 'midnight'
export const DEFAULT_SKIN: SkinId = 'classic'
export const SKIN_IDS: readonly SkinId[] = COSMETICS.filter(c => c.slot === 'skin').map(c => c.id as SkinId)

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
    return { hat: pick('hat'), outfit: pick('outfit'), accessory: pick('accessory') }
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
