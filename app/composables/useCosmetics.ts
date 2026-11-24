import {
    DEFAULT_AVATAR,
    DEFAULT_SKIN,
    findCosmetic,
    isFree,
    ownsCosmetic,
    skinOf,
    type CosmeticDef,
    type CosmeticsState,
    type SkinId,
    type WearSlot
} from '#shared/cosmetics'
import type { ZoneId } from '#shared/tycoon'

/** The wardrobe's tabs: your look (hair, colour, skin), what you wear, and room skins. */
export type WardrobeTab = 'look' | WearSlot | 'rooms'

/** A zone skin shown on the floor before it is bought or put on (picker hover / tap). */
export interface SkinPreview {
    zone: ZoneId
    skin: SkinId
}

const EMPTY: CosmeticsState = { avatar: DEFAULT_AVATAR, skins: {}, owned: [] }

/**
 * Avatar cosmetics and zone skins on the client: what the player owns and
 * wears (from the tycoon state), the wardrobe panel (opened from your own
 * avatar on the floor or the shop) and the skin preview the floor shows
 * while a picker is open.
 */
export function useCosmetics() {
    const tycoon = useTycoon()
    const wardrobe = useState('cosmetics:wardrobe', () => ({ open: false, tab: 'look' as WardrobeTab, zone: null as ZoneId | null }))
    const preview = useState<SkinPreview | null>('cosmetics:skin-preview', () => null)

    const state = computed<CosmeticsState>(() => tycoon.state.value?.cosmetics ?? EMPTY)
    const gems = computed(() => (tycoon.state.value?.gemsEnabled ? tycoon.gems.value : null))

    function owns(key: string): boolean {
        return ownsCosmetic(state.value.owned, key)
    }

    /** Why `def` can't be bought now, or null. */
    function blocker(def: CosmeticDef): string | null {
        if (isFree(def) || owns(def.key)) return null
        if (def.gems) {
            if (!tycoon.state.value?.gemsEnabled) return 'Gems need a Polynux account'
            if (gems.value === null || gems.value < def.gems) return `Need ${def.gems - (gems.value ?? 0)} more gems`
        } else if (tycoon.chips.value < def.chips) {
            return 'Not enough chips'
        }
        return null
    }

    /** Buy `def` (chips or gems) and put it on: worn, or on `zone` for a skin. True when it went through. */
    async function buy(def: CosmeticDef, zone?: ZoneId): Promise<boolean> {
        if (blocker(def)) return false
        if (def.chips) {
            if (!(await tycoon.buyCosmetic(def.key, def.slot === 'skin' ? zone : undefined))) return false
            // The chip buy only puts a skin on (with its zone); an avatar item is worn right after.
            if (def.slot !== 'skin') await tycoon.equipCosmetic(def.key)
            return true
        }
        if (!(await tycoon.buyGem('cosmetic', def.key))) return false
        if (def.slot !== 'skin' || zone) await tycoon.equipCosmetic(def.key, def.slot === 'skin' ? zone : undefined)
        return true
    }

    async function equip(key: string, zone?: ZoneId): Promise<boolean> {
        if (!findCosmetic(key) || !owns(key)) return false
        return !!(await tycoon.equipCosmetic(key, zone))
    }

    function skinOn(zone: ZoneId): SkinId {
        return skinOf(state.value.skins, zone)
    }

    function show(tab: WardrobeTab = 'look', zone: ZoneId | null = null) {
        wardrobe.value = { open: true, tab, zone }
    }

    function hide() {
        wardrobe.value = { ...wardrobe.value, open: false }
        preview.value = null
    }

    return { state, gems, wardrobe, preview, owns, blocker, buy, equip, skinOn, show, hide, DEFAULT_SKIN }
}
