import type { SkinId } from '#shared/cosmetics'
import type { ZoneId } from '#shared/tycoon'

/**
 * One warm, toy-like palette for the whole floor: cream, wood, gold and a
 * deep plum for outlines and shadows. Machines add their game's accent.
 */
export const PAL = {
    gold: '#f4c14f',
    goldDark: '#b98228',
    goldLight: '#ffe9a6',
    coin: '#ffd23f',
    /** The chip colour, royal blue (matches components/casino/ChipIcon.vue). */
    chip: '#3b82f6',
    chipDark: '#1d4ed8',
    wood: '#b9784a',
    woodDark: '#7c4a2d',
    woodLight: '#dba26d',
    leather: '#5a2f2c',
    cream: '#fcefd8',
    paper: '#fff8ea',
    felt: '#2c9460',
    steel: '#9aa3c2',
    slate: '#4b4668',
    screen: '#1c1531',
    leaf: '#5fb35a',
    leafDark: '#3f8a45',
    pot: '#d77b4f',
    water: '#45b6e6',
    sand: '#f2d08b',
    velvet: '#b3243f',
    bgTop: '#2b2046',
    bgBottom: '#120d1f',
    slab: '#3d2b49',
    slabDark: '#271a30',
    fog: '#2f2945',
    fogAlt: '#2a243e',
    fogWall: '#3e3657',
    fogWallDark: '#2e2843'
}

/** Coin gold and chip blue as numbers, for tints (the chip tint a shade lighter, to read on the dark floor). */
export const COIN_TINT = 0xffd23f
export const CHIP_TINT = 0x60a5fa

export type FloorKind = 'wood' | 'carpet' | 'marble'

export interface ZoneStyle {
    wall: string
    trim: string
    floor: string
    floorAlt: string
    pattern: string
    kind: FloorKind
    /** Rug laid on a wood floor from decor 2. */
    rug: string
}

export const ZONE_STYLE: Record<ZoneId, ZoneStyle> = {
    backroom: { wall: '#c7765a', trim: '#f2d2a8', floor: '#d79d66', floorAlt: '#c78a54', pattern: '#f1c27a', kind: 'wood', rug: '#a8384a' },
    main: { wall: '#a73a4c', trim: '#f3cf8a', floor: '#b4404f', floorAlt: '#9b3343', pattern: '#f4c14f', kind: 'carpet', rug: '#7d2333' },
    pit: { wall: '#2f7d5c', trim: '#f0d79a', floor: '#2f8a64', floorAlt: '#277553', pattern: '#f5d48c', kind: 'carpet', rug: '#1f5c42' },
    lounge: { wall: '#6a4ab0', trim: '#f2d39b', floor: '#7553c2', floorAlt: '#6446ab', pattern: '#ffd47e', kind: 'carpet', rug: '#4c3388' },
    highlimit: { wall: '#2c4a8e', trim: '#f4cf7c', floor: '#30509c', floorAlt: '#284486', pattern: '#f4c14f', kind: 'carpet', rug: '#1d3166' },
    penthouse: { wall: '#e6d8c2', trim: '#f4c14f', floor: '#f2ebe0', floorAlt: '#e4d8c6', pattern: '#e0b452', kind: 'marble', rug: '#b3243f' }
}

/** A zone skin's signature motif, painted into its floor (and echoed on its walls). */
export type Motif = 'none' | 'fan' | 'palm' | 'horseshoe' | 'crown' | 'moon'

export interface SkinStyle extends ZoneStyle {
    motif: Motif
}

/** Zone skins (shared/cosmetics.ts): one theme that fits any zone. Classic is the zone's own style. */
const SKIN_STYLE: Record<Exclude<SkinId, 'classic'>, SkinStyle> = {
    deco: { wall: '#1f2a2e', trim: '#e0b85a', floor: '#22343a', floorAlt: '#1a2a2f', pattern: '#e0b85a', kind: 'carpet', rug: '#0f1d21', motif: 'fan' },
    tropical: { wall: '#2a9d8f', trim: '#ffe0a3', floor: '#e6c98f', floorAlt: '#d8b878', pattern: '#2fa58f', kind: 'wood', rug: '#2fa58f', motif: 'palm' },
    western: { wall: '#8a5a36', trim: '#e8c58c', floor: '#a8673a', floorAlt: '#97592f', pattern: '#e8c58c', kind: 'wood', rug: '#7d2f22', motif: 'horseshoe' },
    royal: { wall: '#7d1328', trim: '#f4c14f', floor: '#9d1b32', floorAlt: '#871629', pattern: '#f4c14f', kind: 'carpet', rug: '#5c0d1d', motif: 'crown' },
    midnight: { wall: '#1d2a5c', trim: '#c9d3f0', floor: '#202e66', floorAlt: '#1a2655', pattern: '#c9d3f0', kind: 'carpet', rug: '#121a3d', motif: 'moon' }
}

/** The style a zone wears with a skin. */
export function skinStyle(zone: ZoneId, skin: SkinId = 'classic'): SkinStyle {
    return skin === 'classic' ? { ...ZONE_STYLE[zone], motif: 'none' } : SKIN_STYLE[skin] ?? { ...ZONE_STYLE[zone], motif: 'none' }
}

export const SKINS = ['#f7d2b6', '#eab68f', '#cf946a', '#a86c47', '#7b4b31', '#f1c7a2']
export const HAIRS = ['#2d1d17', '#5b3a24', '#a5582c', '#e0b85a', '#20202e', '#8f8fa3', '#b8463a', '#f2e2c4']
export const SHIRTS = ['#e8594f', '#f2a23d', '#4ea6e0', '#5cc07c', '#9d6ddb', '#f27fb4', '#3fc4b2', '#f5d24a', '#ef7a3a', '#6f86e8']
export const PANTS = ['#3b3552', '#2f4a6b', '#5a3f2e', '#44445a', '#2b2b3a', '#6b4a6e']
export const CONFETTI = [0xf43f5e, 0xfacc15, 0x38bdf8, 0x4ade80, 0xc084fc, 0xfb923c, 0xffffff]
